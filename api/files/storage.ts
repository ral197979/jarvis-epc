/**
 * JARVIS EPC — File Storage Abstraction
 * ───────────────────────────────────────
 * v4.26.0 — Pluggable storage backend.
 *
 * Backends:
 *   local  — writes to STORAGE_LOCAL_DIR (default: ./uploads)
 *   s3     — AWS S3 or S3-compatible (MinIO, Tigris, Cloudflare R2)
 *
 * Selected via STORAGE_BACKEND env var.
 *
 * Interface:
 *   presignUpload(key, opts)         — Generate a presigned upload URL/token
 *   presignDownload(key, ttlSec)     — Generate a time-limited download URL
 *   deleteObject(key)                — Hard-delete a stored file
 *   copyObject(srcKey, dstKey)       — Copy within same bucket
 *   objectExists(key)                — Check if object exists
 *   getMetadata(key)                 — Size, ETag, last modified
 */

import fs        from 'node:fs'
import path      from 'node:path'
import crypto    from 'node:crypto'
import { slog }  from '../../src/modules/observability/index'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PresignUploadResult {
  uploadUrl:  string   // PUT this URL to upload the file
  uploadToken?: string // returned for local backend (replaces presigned URL)
  key:        string   // storage key to persist in DB
  expiresAt:  Date
}

export interface PresignDownloadResult {
  downloadUrl: string
  expiresAt:   Date
}

export interface ObjectMetadata {
  key:          string
  sizeBytes:    number
  etag?:        string
  lastModified: Date
  mimeType?:    string
}

export interface PresignUploadOptions {
  mimeType?:    string
  maxSizeBytes?: number
  metadata?:    Record<string, string>
}

// ─── Storage interface ────────────────────────────────────────────────────────

export interface IStorage {
  presignUpload(key: string, opts?: PresignUploadOptions): Promise<PresignUploadResult>
  presignDownload(key: string, ttlSeconds?: number): Promise<PresignDownloadResult>
  deleteObject(key: string): Promise<void>
  copyObject(srcKey: string, dstKey: string): Promise<void>
  objectExists(key: string): Promise<boolean>
  getMetadata(key: string): Promise<ObjectMetadata | null>
  streamToKey(key: string, stream: NodeJS.ReadableStream, mimeType?: string): Promise<{ sizeBytes: number; etag: string }>
}

// ─── Local filesystem backend ─────────────────────────────────────────────────

const LOCAL_DIR   = process.env['STORAGE_LOCAL_DIR'] ?? path.join(process.cwd(), 'uploads')
const PUBLIC_URL  = process.env['VITE_BACKEND_URL'] ?? 'http://localhost:3001'
const TOKEN_TTL   = 3600  // 1 hour presigned token validity

class LocalStorage implements IStorage {
  constructor() {
    fs.mkdirSync(LOCAL_DIR, { recursive: true })
    slog('INFO', 'storage', '[local] Initialized', { dir: LOCAL_DIR })
  }

  private _fullPath(key: string): string {
    // Prevent path traversal
    const safe = path.normalize(key).replace(/^(\.\.[/\\])+/, '')
    return path.join(LOCAL_DIR, safe)
  }

  async presignUpload(key: string, opts?: PresignUploadOptions): Promise<PresignUploadResult> {
    const token     = crypto.randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + TOKEN_TTL * 1000)

    // Store pending upload token in a sidecar JSON file
    const meta = {
      key,
      token,
      expiresAt: expiresAt.toISOString(),
      mimeType:  opts?.mimeType,
      maxSize:   opts?.maxSizeBytes ?? 100 * 1024 * 1024,
    }
    const metaPath = path.join(LOCAL_DIR, '.tokens', `${token}.json`)
    fs.mkdirSync(path.dirname(metaPath), { recursive: true })
    fs.writeFileSync(metaPath, JSON.stringify(meta))

    return {
      uploadUrl:   `${PUBLIC_URL}/api/v1/files/upload/${token}`,
      uploadToken: token,
      key,
      expiresAt,
    }
  }

  async presignDownload(key: string, ttlSeconds = 3600): Promise<PresignDownloadResult> {
    const token = crypto.randomBytes(24).toString('hex')
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000)

    const meta = { key, token, expiresAt: expiresAt.toISOString() }
    const metaPath = path.join(LOCAL_DIR, '.tokens', `dl_${token}.json`)
    fs.mkdirSync(path.dirname(metaPath), { recursive: true })
    fs.writeFileSync(metaPath, JSON.stringify(meta))

    return {
      downloadUrl: `${PUBLIC_URL}/api/v1/files/download/${token}`,
      expiresAt,
    }
  }

  async deleteObject(key: string): Promise<void> {
    const fp = this._fullPath(key)
    if (fs.existsSync(fp)) fs.unlinkSync(fp)
  }

  async copyObject(srcKey: string, dstKey: string): Promise<void> {
    const src = this._fullPath(srcKey)
    const dst = this._fullPath(dstKey)
    fs.mkdirSync(path.dirname(dst), { recursive: true })
    fs.copyFileSync(src, dst)
  }

  async objectExists(key: string): Promise<boolean> {
    return fs.existsSync(this._fullPath(key))
  }

  async getMetadata(key: string): Promise<ObjectMetadata | null> {
    const fp = this._fullPath(key)
    try {
      const stat = fs.statSync(fp)
      return { key, sizeBytes: stat.size, lastModified: stat.mtime }
    } catch {
      return null
    }
  }

  async streamToKey(
    key: string,
    stream: NodeJS.ReadableStream,
    _mimeType?: string,
  ): Promise<{ sizeBytes: number; etag: string }> {
    const fp = this._fullPath(key)
    fs.mkdirSync(path.dirname(fp), { recursive: true })

    return new Promise((resolve, reject) => {
      const hash   = crypto.createHash('sha256')
      const out    = fs.createWriteStream(fp)
      let sizeBytes = 0

      stream.on('data', (chunk: Buffer) => {
        sizeBytes += chunk.length
        hash.update(chunk)
      })
      stream.pipe(out)
      out.on('finish', () => resolve({ sizeBytes, etag: hash.digest('hex') }))
      out.on('error', reject)
      stream.on('error', reject)
    })
  }
}

// ─── S3 backend ───────────────────────────────────────────────────────────────

class S3Storage implements IStorage {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _client: any = null
  private _bucket: string

  constructor() {
    this._bucket = process.env['S3_BUCKET'] ?? 'jarvis-epc'
    this._init()
  }

  private _init(): void {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { S3Client } = require('@aws-sdk/client-s3')
      this._client = new S3Client({
        region:   process.env['AWS_REGION'] ?? 'us-east-1',
        endpoint: process.env['S3_ENDPOINT'],  // for MinIO / R2 / Tigris
        credentials: process.env['AWS_ACCESS_KEY_ID'] ? {
          accessKeyId:     process.env['AWS_ACCESS_KEY_ID']!,
          secretAccessKey: process.env['AWS_SECRET_ACCESS_KEY']!,
        } : undefined,
        forcePathStyle: Boolean(process.env['S3_FORCE_PATH_STYLE']),
      })
      slog('INFO', 'storage', '[s3] Client initialized', { bucket: this._bucket })
    } catch (err) {
      slog('ERROR', 'storage', '[s3] @aws-sdk/client-s3 not installed — run: npm i @aws-sdk/client-s3 @aws-sdk/s3-request-presigner', {})
      throw err
    }
  }

  async presignUpload(key: string, opts?: PresignUploadOptions): Promise<PresignUploadResult> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PutObjectCommand }  = require('@aws-sdk/client-s3')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getSignedUrl }      = require('@aws-sdk/s3-request-presigner')
    const expiresIn  = TOKEN_TTL
    const expiresAt  = new Date(Date.now() + expiresIn * 1000)
    const cmd = new PutObjectCommand({
      Bucket:      this._bucket,
      Key:         key,
      ContentType: opts?.mimeType,
    })
    const uploadUrl = await getSignedUrl(this._client, cmd, { expiresIn })
    return { uploadUrl, key, expiresAt }
  }

  async presignDownload(key: string, ttlSeconds = 3600): Promise<PresignDownloadResult> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { GetObjectCommand } = require('@aws-sdk/client-s3')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getSignedUrl }     = require('@aws-sdk/s3-request-presigner')
    const cmd = new GetObjectCommand({ Bucket: this._bucket, Key: key })
    const downloadUrl = await getSignedUrl(this._client, cmd, { expiresIn: ttlSeconds })
    return { downloadUrl, expiresAt: new Date(Date.now() + ttlSeconds * 1000) }
  }

  async deleteObject(key: string): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { DeleteObjectCommand } = require('@aws-sdk/client-s3')
    await this._client.send(new DeleteObjectCommand({ Bucket: this._bucket, Key: key }))
  }

  async copyObject(srcKey: string, dstKey: string): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { CopyObjectCommand } = require('@aws-sdk/client-s3')
    await this._client.send(new CopyObjectCommand({
      Bucket:     this._bucket,
      CopySource: `${this._bucket}/${srcKey}`,
      Key:        dstKey,
    }))
  }

  async objectExists(key: string): Promise<boolean> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { HeadObjectCommand } = require('@aws-sdk/client-s3')
    try {
      await this._client.send(new HeadObjectCommand({ Bucket: this._bucket, Key: key }))
      return true
    } catch { return false }
  }

  async getMetadata(key: string): Promise<ObjectMetadata | null> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { HeadObjectCommand } = require('@aws-sdk/client-s3')
    try {
      const res = await this._client.send(new HeadObjectCommand({ Bucket: this._bucket, Key: key }))
      return {
        key,
        sizeBytes:    res.ContentLength ?? 0,
        etag:         res.ETag,
        lastModified: res.LastModified ?? new Date(),
        mimeType:     res.ContentType,
      }
    } catch { return null }
  }

  async streamToKey(
    key: string,
    stream: NodeJS.ReadableStream,
    mimeType?: string,
  ): Promise<{ sizeBytes: number; etag: string }> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Upload } = require('@aws-sdk/lib-storage')
    const upload = new Upload({
      client: this._client,
      params: { Bucket: this._bucket, Key: key, Body: stream, ContentType: mimeType },
    })
    const result = await upload.done()
    const meta   = await this.getMetadata(key)
    return { sizeBytes: meta?.sizeBytes ?? 0, etag: result.ETag ?? '' }
  }
}

// ─── Singleton factory ────────────────────────────────────────────────────────

let _storage: IStorage | null = null

export function getStorage(): IStorage {
  if (!_storage) {
    const backend = process.env['STORAGE_BACKEND'] ?? 'local'
    _storage = backend === 's3' ? new S3Storage() : new LocalStorage()
    slog('INFO', 'storage', `[factory] Using ${backend} backend`)
  }
  return _storage
}

/** Test helper */
export function _resetStorage(): void {
  _storage = null
}
