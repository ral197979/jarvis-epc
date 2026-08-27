/**
 * Denver Engineering — File Storage Abstraction
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
import { createRequire } from 'node:module'
import { slog }  from '../../src/modules/observability/index'

// OPS-001: this project is ESM ("type":"module"), where the bare `require` used
// by the S3 backend's lazy SDK loading is undefined. createRequire restores a
// working require bound to this module so the AWS SDK is loaded only when the
// S3 backend is actually selected (no eager cost for the local backend).
const require = createRequire(import.meta.url)

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PresignUploadResult {
  uploadUrl:  string   // PUT this URL to upload the file
  uploadToken?: string // returned for local backend (replaces presigned URL)
  key:        string   // storage key to persist in DB
  expiresAt:  Date
  requiredHeaders?: Record<string, string> // headers the client MUST send on the PUT (e.g. SSE)
}

export interface PresignDownloadResult {
  downloadUrl: string
  expiresAt:   Date
  /**
   * Whether the backend that minted this URL can still refuse it at redemption
   * time. True for the local backend, whose URL comes back through this API and
   * is re-authorized on every call. False for S3, whose presigned URL is
   * honoured by S3 itself — nothing in this process sees the request, so the
   * binding below cannot be enforced there. See ADR-014 Phase 3K.
   */
  enforceable: boolean
}

/**
 * Who a download token is for, and what it addresses (ADR-014 Phase 3K).
 *
 * A download token used to record only the storage key. That made it a pure
 * bearer credential: anything holding it got the bytes, for the token's whole
 * lifetime, whatever had happened to the holder's access in the meantime.
 *
 * Recording the principal and the record turns the token back into a POINTER.
 * It names what to re-authorize; it does not itself carry authority. The
 * redemption path re-derives the answer from the database on every call, so
 * revoking membership, demoting a role or deactivating the account takes effect
 * on the next request rather than an hour later.
 *
 * Required, not optional, on purpose: a mint site that cannot say who the token
 * is for is a mint site that would produce an unbound one.
 */
export interface DownloadBinding {
  /** The tenant the token was minted in. A token never crosses tenants. */
  tenantId:  string
  /** The user the token was minted for. A token is not transferable. */
  subjectId: string
  /** The `recordScopePolicies` resource whose scope ladder governs the file. */
  resource:  string
  /** The row id to re-authorize — NOT the storage key, which carries no scope. */
  recordId:  string
}

/** The on-disk shape of a local-backend download-token sidecar. */
export interface LocalDownloadTokenMeta extends DownloadBinding {
  key:       string
  token:     string
  expiresAt: string
}

/**
 * The exact shape of a minted token, and the only thing the redemption paths
 * will put into a filesystem path (ADR-014 Phase 3K).
 *
 * Both token routes build a sidecar path out of `req.params.token`. Express
 * percent-DECODES path parameters, so a request for
 * `/files/download/..%2F..%2Fsomething` arrives as the single parameter
 * `../../something` — one path segment as far as routing is concerned, and a
 * traversal as far as `path.join` is concerned. The sidecar's contents are then
 * parsed as JSON and its `key` used to open a file, so a readable JSON file
 * anywhere on the host was the head of a file-read chain.
 *
 * The fix is not to sanitise the value but to REJECT anything that is not a
 * token: 24 (download) or 32 (upload) random bytes as lowercase hex, and
 * nothing else. Validated before the value touches `path.join`.
 */
export const DOWNLOAD_TOKEN_PATTERN = /^[0-9a-f]{48}$/
export const UPLOAD_TOKEN_PATTERN   = /^[0-9a-f]{64}$/

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
  presignDownload(key: string, binding: DownloadBinding, ttlSeconds?: number): Promise<PresignDownloadResult>
  deleteObject(key: string): Promise<void>
  copyObject(srcKey: string, dstKey: string): Promise<void>
  objectExists(key: string): Promise<boolean>
  getMetadata(key: string): Promise<ObjectMetadata | null>
  streamToKey(key: string, stream: NodeJS.ReadableStream, mimeType?: string): Promise<{ sizeBytes: number; etag: string }>
  /**
   * Open a stored object for reading, or `null` when it is not there.
   *
   * Added for the in-app viewer (`GET /files/documents/:id/content`), which
   * must serve bytes through the API rather than hand out a URL: the viewer
   * renders INLINE, so the response has to stay under this process's control.
   */
  readStream(key: string): Promise<NodeJS.ReadableStream | null>
}

// ─── Local filesystem backend ─────────────────────────────────────────────────

const LOCAL_DIR   = process.env['STORAGE_LOCAL_DIR'] ?? path.join(process.cwd(), 'uploads')
const PUBLIC_URL  = process.env['VITE_BACKEND_URL'] ?? 'http://localhost:3001'
const TOKEN_TTL   = 3600  // 1 hour presigned token validity
// OPS-002: enforce server-side encryption at rest on every S3 upload path.
// 'AES256' = SSE-S3 (S3-managed keys). Set S3_SSE='aws:kms' + S3_SSE_KMS_KEY_ID
// to use SSE-KMS instead.
const SSE_ALGORITHM = process.env['S3_SSE'] ?? 'AES256'

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

  /**
   * ADR-014 Phase 3K. The sidecar records the BINDING alongside the key, so
   * `GET /files/download/:token` can re-derive authority instead of trusting
   * the bearer. Expiry is now a backstop on a re-authorized credential rather
   * than the only thing standing between a revoked user and the bytes.
   */
  async presignDownload(key: string, binding: DownloadBinding, ttlSeconds = 3600): Promise<PresignDownloadResult> {
    const token = crypto.randomBytes(24).toString('hex')
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000)

    const meta: LocalDownloadTokenMeta = {
      key, token,
      expiresAt: expiresAt.toISOString(),
      tenantId:  binding.tenantId,
      subjectId: binding.subjectId,
      resource:  binding.resource,
      recordId:  binding.recordId,
    }
    const metaPath = path.join(LOCAL_DIR, '.tokens', `dl_${token}.json`)
    fs.mkdirSync(path.dirname(metaPath), { recursive: true })
    fs.writeFileSync(metaPath, JSON.stringify(meta))

    return {
      downloadUrl: `${PUBLIC_URL}/api/v1/files/download/${token}`,
      expiresAt,
      enforceable: true,
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

  async readStream(key: string): Promise<NodeJS.ReadableStream | null> {
    const fp = this._fullPath(key)
    if (!fs.existsSync(fp)) return null
    return fs.createReadStream(fp)
  }
}

// ─── S3 backend ───────────────────────────────────────────────────────────────

class S3Storage implements IStorage {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _client: any = null
  private _bucket: string

  constructor() {
    this._bucket = process.env['S3_BUCKET'] ?? 'denver-engineering'
    this._init()
  }

  private _init(): void {
    try {
       
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
     
    const { PutObjectCommand }  = require('@aws-sdk/client-s3')
     
    const { getSignedUrl }      = require('@aws-sdk/s3-request-presigner')
    const expiresIn  = TOKEN_TTL
    const expiresAt  = new Date(Date.now() + expiresIn * 1000)
    const cmd = new PutObjectCommand({
      Bucket:              this._bucket,
      Key:                 key,
      ContentType:         opts?.mimeType,
      ServerSideEncryption: SSE_ALGORITHM,   // OPS-002: enforce encryption at rest
    })
    const uploadUrl = await getSignedUrl(this._client, cmd, { expiresIn })
    // The SSE algorithm is a signed header on the presigned PUT; the uploading
    // client must echo it. Surfaced here so callers can set it on the PUT.
    return { uploadUrl, key, expiresAt, requiredHeaders: { 'x-amz-server-side-encryption': SSE_ALGORITHM } }
  }

  /**
   * The binding is accepted and deliberately NOT stored: an S3 presigned URL is
   * validated by S3, so this process never sees the redemption and cannot
   * re-authorize it. `enforceable: false` says so rather than implying a
   * guarantee the backend does not give. Closing that window needs a streaming
   * proxy or short-lived STS credentials — an infrastructure decision, recorded
   * as a residual risk in the ADR-014 Phase 3K evidence, not papered over here.
   */
  async presignDownload(key: string, _binding: DownloadBinding, ttlSeconds = 3600): Promise<PresignDownloadResult> {
     
    const { GetObjectCommand } = require('@aws-sdk/client-s3')
     
    const { getSignedUrl }     = require('@aws-sdk/s3-request-presigner')
    const cmd = new GetObjectCommand({ Bucket: this._bucket, Key: key })
    const downloadUrl = await getSignedUrl(this._client, cmd, { expiresIn: ttlSeconds })
    return { downloadUrl, expiresAt: new Date(Date.now() + ttlSeconds * 1000), enforceable: false }
  }

  async deleteObject(key: string): Promise<void> {
     
    const { DeleteObjectCommand } = require('@aws-sdk/client-s3')
    await this._client.send(new DeleteObjectCommand({ Bucket: this._bucket, Key: key }))
  }

  async copyObject(srcKey: string, dstKey: string): Promise<void> {
     
    const { CopyObjectCommand } = require('@aws-sdk/client-s3')
    await this._client.send(new CopyObjectCommand({
      Bucket:     this._bucket,
      CopySource: `${this._bucket}/${srcKey}`,
      Key:        dstKey,
    }))
  }

  async objectExists(key: string): Promise<boolean> {
     
    const { HeadObjectCommand } = require('@aws-sdk/client-s3')
    try {
      await this._client.send(new HeadObjectCommand({ Bucket: this._bucket, Key: key }))
      return true
    } catch { return false }
  }

  async getMetadata(key: string): Promise<ObjectMetadata | null> {
     
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
     
    const { Upload } = require('@aws-sdk/lib-storage')
    const upload = new Upload({
      client: this._client,
      params: {
        Bucket: this._bucket, Key: key, Body: stream, ContentType: mimeType,
        ServerSideEncryption: SSE_ALGORITHM,   // OPS-002: encryption at rest
      },
    })
    const result = await upload.done()
    const meta   = await this.getMetadata(key)
    return { sizeBytes: meta?.sizeBytes ?? 0, etag: result.ETag ?? '' }
  }

  async readStream(key: string): Promise<NodeJS.ReadableStream | null> {

    const { GetObjectCommand } = require('@aws-sdk/client-s3')
    try {
      const res = await this._client.send(new GetObjectCommand({ Bucket: this._bucket, Key: key }))
      return (res.Body as NodeJS.ReadableStream | undefined) ?? null
    } catch { return null }
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
