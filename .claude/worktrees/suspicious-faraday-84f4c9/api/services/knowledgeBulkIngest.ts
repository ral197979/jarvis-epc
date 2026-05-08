/**
 * JARVIS EPC — Knowledge Base Bulk Ingest Service (v4.31.0)
 *
 * Walks a directory tree, registers every matching file as a
 * knowledge_sources row (deduped by SHA256 within the tenant), and
 * enqueues an ingest_pdf job per new row. Used by:
 *   - POST /api/v1/knowledge/bulk-ingest    (admin UI)
 *   - api/scripts/ingest-directory.ts       (CLI, still standalone)
 *
 * Security:
 *   This lets an admin ask the server to read arbitrary filesystem
 *   paths. Prod deployments should set KNOWLEDGE_INGEST_ROOTS to a
 *   comma-separated allowlist of path prefixes; any request whose
 *   root_path is not under one of those is rejected. When the env var
 *   is unset, any path the server process can read is allowed (dev
 *   default, convenient for macOS /Volumes/ drives).
 *
 * Skip list:
 *   Default skip substrings catch personal dirs (Mine, tax), dev
 *   folders (node_modules, .git), and non-content folders (installers,
 *   AI chat exports). Override via the `skipDirs` option.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { tenantQuery } from '../db/pool'
import { enqueueSourceIngest } from './knowledgeIngest'
import { slog } from '../../src/modules/observability/index'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BulkIngestOptions {
  rootPath:      string
  extensions:    string[]       // lowercase, no dot. ['pdf']
  tags?:         string[]
  licenseType?:  string         // default 'owned'
  assetSystem?:  string | null
  skipDirs?:     string[]       // substring match on directory basenames
  limit?:        number         // max files to process (default 5000)
  dryRun?:       boolean        // if true, only return the plan
}

export interface BulkIngestCandidate {
  path:          string
  size:          number
  name:          string
  ext:           string
}

export interface BulkIngestResult {
  rootPath:         string
  dryRun:           boolean
  candidatesFound:  number
  queued:           number
  duplicates:       number
  errors:           number
  truncated:        boolean          // true if limit hit before end
  errorSamples:     Array<{ path: string; message: string }>
  queuedSourceIds:  string[]         // first N (capped) for UI display
  plan?:            BulkIngestCandidate[]   // only populated for dryRun
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_SKIP = [
  'node_modules', '.git', '.DS_Store', '.Trash', '.Spotlight-V100',
  '.fseventsd', '.TemporaryItems', '.DocumentRevisions-V100',
  'Mine',                              // personal on this user's drive layout
  'AI Projects',                       // Jarvis/Ava dev
  'ChatGPT', 'Claude',                 // AI chat exports
  'Software', 'AutoCad',               // installers
  'Downloads', 'Roblox',
]

const MAX_QUEUED_IDS_RETURNED = 50     // cap response size for UI
const MAX_ERROR_SAMPLES       = 20
const ABSOLUTE_LIMIT          = 10_000 // hard ceiling on `limit` option
const SHA_BUFFER_BYTES        = 8 * 1024 * 1024   // 8 MB — stream-hashable if we later swap to a streaming hash

// ─── Public: path-allowlist guard ─────────────────────────────────────────────

export function isPathAllowed(rootPath: string): { ok: true } | { ok: false; reason: string } {
  const allowlist = (process.env['KNOWLEDGE_INGEST_ROOTS'] ?? '')
    .split(',').map(s => s.trim()).filter(Boolean)

  if (allowlist.length === 0) return { ok: true }   // dev default — no restriction

  const resolved = path.resolve(rootPath)
  for (const prefix of allowlist) {
    const resolvedPrefix = path.resolve(prefix)
    // Must be the prefix itself OR a descendant (guard against string-prefix
    // attacks like "/mnt/knowledge-bad" matching "/mnt/knowledge").
    if (resolved === resolvedPrefix || resolved.startsWith(resolvedPrefix + path.sep)) {
      return { ok: true }
    }
  }
  return {
    ok: false,
    reason: `Path '${resolved}' is not under any KNOWLEDGE_INGEST_ROOTS prefix: ${allowlist.join(', ')}`,
  }
}

// ─── Public: enumerate (used by dry-run) ──────────────────────────────────────

export async function enumerateCandidates(
  opts: Pick<BulkIngestOptions, 'rootPath' | 'extensions' | 'skipDirs' | 'limit'>,
): Promise<{ candidates: BulkIngestCandidate[]; truncated: boolean }> {
  const limit = Math.min(opts.limit ?? 5_000, ABSOLUTE_LIMIT)
  const skip = opts.skipDirs && opts.skipDirs.length > 0 ? opts.skipDirs : DEFAULT_SKIP
  const exts = new Set(opts.extensions.map(e => e.replace(/^\./, '').toLowerCase()))

  const out: BulkIngestCandidate[] = []
  let truncated = false

  for await (const file of walk(opts.rootPath, skip)) {
    const ext = path.extname(file).slice(1).toLowerCase()
    if (!exts.has(ext)) continue
    try {
      const st = await fs.stat(file)
      if (!st.isFile()) continue
      out.push({ path: file, size: st.size, name: path.basename(file), ext })
      if (out.length >= limit) { truncated = true; break }
    } catch {
      // Permission/transient errors silently skipped in enumeration;
      // the real ingest path records them.
    }
  }
  return { candidates: out, truncated }
}

// ─── Public: bulk ingest ──────────────────────────────────────────────────────

export async function bulkIngestDirectory(
  tenantId: string,
  userId:   string | null,
  opts:     BulkIngestOptions,
): Promise<BulkIngestResult> {
  const guard = isPathAllowed(opts.rootPath)
  if (!guard.ok) {
    throw new Error(`path_not_allowed: ${guard.reason}`)
  }

  const limit = Math.min(opts.limit ?? 5_000, ABSOLUTE_LIMIT)
  const dryRun = !!opts.dryRun
  const license = opts.licenseType ?? 'owned'
  const tags = opts.tags ?? []
  const assetSystem = opts.assetSystem ?? null

  const { candidates, truncated } = await enumerateCandidates({
    rootPath:   opts.rootPath,
    extensions: opts.extensions,
    skipDirs:   opts.skipDirs,
    limit,
  })

  if (dryRun) {
    return {
      rootPath:        opts.rootPath,
      dryRun:          true,
      candidatesFound: candidates.length,
      queued:          0,
      duplicates:      0,
      errors:          0,
      truncated,
      errorSamples:    [],
      queuedSourceIds: [],
      plan:            candidates,
    }
  }

  let queued = 0
  let duplicates = 0
  let errors = 0
  const errorSamples: Array<{ path: string; message: string }> = []
  const queuedSourceIds: string[] = []

  for (const cand of candidates) {
    try {
      const { sha } = await computeSha256(cand.path)
      const insRes = await tenantQuery<{ id: string }>(tenantId, `
        INSERT INTO knowledge_sources
          (tenant_id, title, kind, storage_path, original_filename,
           byte_size, sha256, license_type, status, tags, asset_system, created_by)
        VALUES
          (current_setting('app.current_tenant_id',true)::uuid,
           $1, $2, $3, $4, $5, $6, $7, 'pending', $8::text[], $9, $10)
        ON CONFLICT (tenant_id, sha256) DO NOTHING
        RETURNING id
      `, [
        cand.name, cand.ext, cand.path, cand.name,
        cand.size, sha, license, tags, assetSystem, userId,
      ])

      if (insRes.rows.length === 0) {
        duplicates++
        continue
      }

      const id = insRes.rows[0]!.id
      await enqueueSourceIngest(tenantId, id, userId)
      queued++
      if (queuedSourceIds.length < MAX_QUEUED_IDS_RETURNED) {
        queuedSourceIds.push(id)
      }
    } catch (err) {
      errors++
      const msg = err instanceof Error ? err.message : String(err)
      if (errorSamples.length < MAX_ERROR_SAMPLES) {
        errorSamples.push({ path: cand.path, message: msg })
      }
    }
  }

  slog('INFO', 'knowledgeBulkIngest', '[bulk] complete', {
    tenantId, rootPath: opts.rootPath, candidates: candidates.length,
    queued, duplicates, errors, truncated,
  })

  return {
    rootPath:        opts.rootPath,
    dryRun:          false,
    candidatesFound: candidates.length,
    queued,
    duplicates,
    errors,
    truncated,
    errorSamples,
    queuedSourceIds,
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function* walk(dir: string, skip: string[]): AsyncGenerator<string> {
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true, encoding: 'utf8' }) as unknown as import('node:fs').Dirent[]
  } catch {
    return
  }
  for (const ent of entries) {
    const name = String(ent.name)
    if (skip.some(s => name.includes(s))) continue
    const full = path.join(dir, name)
    if (ent.isDirectory()) {
      yield* walk(full, skip)
    } else if (ent.isFile()) {
      yield full
    }
  }
}

async function computeSha256(filePath: string): Promise<{ sha: string; size: number }> {
  // Stream-hash so a single huge PDF doesn't balloon RAM.
  const fh = await fs.open(filePath, 'r')
  try {
    const hash = crypto.createHash('sha256')
    const buf = Buffer.allocUnsafe(SHA_BUFFER_BYTES)
    let total = 0
    while (true) {
      const { bytesRead } = await fh.read(buf, 0, buf.length, null)
      if (bytesRead === 0) break
      hash.update(buf.subarray(0, bytesRead))
      total += bytesRead
    }
    return { sha: hash.digest('hex'), size: total }
  } finally {
    await fh.close()
  }
}

// ─── Test-only ────────────────────────────────────────────────────────────────

export const __testHooks = {
  DEFAULT_SKIP,
  walk,
}
