/**
 * Denver Engineering — Bulk knowledge ingest CLI (v4.31.0)
 *
 * Walks a directory recursively, registers every matching file as a
 * knowledge_sources row, and enqueues an ingest_pdf job for each. The
 * scheduler's existing polling worker (startScheduler + the registered
 * ingest_pdf handler) does the chunking asynchronously.
 *
 * Usage:
 *   TENANT_ID=<uuid> USER_ID=<uuid> \
 *     tsx api/scripts/ingest-directory.ts <root> [--ext=pdf,docx] [--tag=hvac,water] \
 *         [--license=owned] [--dry-run] [--limit=N]
 *
 * Environment:
 *   DATABASE_URL       — required
 *   TENANT_ID          — required; which tenant owns the corpus
 *   USER_ID            — optional; recorded as created_by
 *   SKIP_DIRS          — comma-sep dir-name substrings to skip (default:
 *                        "node_modules,.git,.DS_Store,Mine,AI Projects")
 *
 * Safety:
 *   - Dry-run prints the plan; no DB writes
 *   - Duplicate sha256 per tenant is caught by the UNIQUE constraint
 *     and reported as "already ingested" rather than erroring
 *   - Sensitive dir substrings (Mine, tax, personal) are skipped by
 *     default — override SKIP_DIRS if you know what you're doing
 *
 * This script does NOT run the scheduler itself — start the API server
 * (`npm run api:dev`) in another terminal so the ingest_pdf handler
 * actually processes the queued jobs. The CLI just loads the queue.
 */

import fs     from 'node:fs/promises'
import path   from 'node:path'
import crypto from 'node:crypto'
import { initPool, pool, query } from '../db/pool'
import { enqueueSourceIngest } from '../services/knowledgeIngest'

interface Args {
  root:      string
  exts:      Set<string>
  tags:      string[]
  license:   string
  dryRun:    boolean
  limit:     number
  assetSystem: string | null
}

function parseArgs(argv: string[]): Args {
  const rest = argv.slice(2)
  let root: string | null = null
  let exts = new Set(['pdf'])
  let tags: string[] = []
  let license = 'owned'
  let dryRun = false
  let limit = Number.POSITIVE_INFINITY
  let assetSystem: string | null = null

  for (const a of rest) {
    if (a.startsWith('--ext=')) {
      exts = new Set(a.slice(6).split(',').map(s => s.trim().toLowerCase()).filter(Boolean))
    } else if (a.startsWith('--tag=')) {
      tags = a.slice(6).split(',').map(s => s.trim()).filter(Boolean)
    } else if (a.startsWith('--license=')) {
      license = a.slice(10)
    } else if (a.startsWith('--limit=')) {
      limit = parseInt(a.slice(8), 10)
    } else if (a.startsWith('--asset-system=')) {
      assetSystem = a.slice(15)
    } else if (a === '--dry-run') {
      dryRun = true
    } else if (!a.startsWith('--')) {
      root = a
    }
  }

  if (!root) {
    console.error('usage: tsx api/scripts/ingest-directory.ts <root> [--ext=pdf] [--tag=a,b] [--license=owned] [--dry-run] [--limit=N] [--asset-system=chiller]')
    process.exit(2)
  }
  return { root, exts, tags, license, dryRun, limit, assetSystem }
}

const DEFAULT_SKIP = [
  'node_modules', '.git', '.DS_Store', '.Trash',
  'Mine',                    // personal files on the user's drive layout
  'AI Projects',             // Jarvis/Ava dev
  'ChatGPT', 'Claude',       // chat exports
  'Software', 'AutoCad',     // installers
  'Downloads', 'Roblox',
]

function getSkipList(): string[] {
  const env = process.env['SKIP_DIRS']
  if (env) return env.split(',').map(s => s.trim()).filter(Boolean)
  return DEFAULT_SKIP
}

async function* walk(dir: string, skip: string[]): AsyncGenerator<string> {
  // Declare explicitly as string-encoded Dirent to satisfy TS strict overload
  // resolution (`readdir` has Buffer and string variants).
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true, encoding: 'utf8' }) as unknown as import('node:fs').Dirent[]
  } catch (err) {
    console.warn(`[skip] ${dir}: ${err instanceof Error ? err.message : String(err)}`)
    return
  }
  for (const ent of entries) {
    const name = String(ent.name)
    const full = path.join(dir, name)
    if (skip.some(s => name.includes(s))) {
      continue
    }
    if (ent.isDirectory()) {
      yield* walk(full, skip)
    } else if (ent.isFile()) {
      yield full
    }
  }
}

async function computeSha(p: string): Promise<{ sha: string; size: number }> {
  const buf = await fs.readFile(p)
  return {
    sha:  crypto.createHash('sha256').update(buf).digest('hex'),
    size: buf.length,
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv)
  const tenantId = process.env['TENANT_ID']
  const userId   = process.env['USER_ID'] ?? null
  if (!tenantId) {
    console.error('TENANT_ID env var required')
    process.exit(2)
  }

  const skip = getSkipList()
  const rootAbs = path.resolve(args.root)
  console.log(`[ingest] root=${rootAbs}`)
  console.log(`[ingest] extensions=${[...args.exts].join(',')} skip=${skip.join(',')} license=${args.license}${args.dryRun ? ' (DRY RUN)' : ''}`)

  if (!args.dryRun) {
    await initPool()
  }

  let candidates = 0
  let queued = 0
  let duplicates = 0
  let errors = 0
  const queuedIds: string[] = []

  for await (const file of walk(rootAbs, skip)) {
    const ext = path.extname(file).slice(1).toLowerCase()
    if (!args.exts.has(ext)) continue
    candidates++
    if (candidates > args.limit) break

    if (args.dryRun) {
      console.log(`[plan] ${file}`)
      continue
    }

    try {
      const { sha, size } = await computeSha(file)
      const title = path.basename(file)
      const insRes = await query<{ id: string }>(`
        INSERT INTO knowledge_sources
          (tenant_id, title, kind, storage_path, original_filename,
           byte_size, sha256, license_type, status, tags, asset_system, created_by)
        VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9::text[], $10, $11)
        ON CONFLICT (tenant_id, sha256) DO NOTHING
        RETURNING id
      `, [
        tenantId, title, ext, file, title,
        size, sha, args.license,
        args.tags, args.assetSystem, userId,
      ])

      if (insRes.rows.length === 0) {
        duplicates++
        continue
      }

      const id = insRes.rows[0]!.id
      const jobId = await enqueueSourceIngest(tenantId, id, userId)
      queued++
      queuedIds.push(id)
      if (queued % 25 === 0) console.log(`[ingest] queued=${queued} dup=${duplicates} err=${errors}`)
      void jobId
    } catch (err) {
      errors++
      console.warn(`[error] ${file}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  console.log(`\n[ingest] DONE
  candidates found : ${candidates}
  queued           : ${queued}
  duplicates       : ${duplicates}
  errors           : ${errors}`)

  if (!args.dryRun) {
    await pool.end()
    if (queued > 0) {
      console.log(`\nNext: start the API (npm run api:start) so the scheduler can process the queue.`)
      console.log(`Progress: GET /api/v1/knowledge/sources?status=ingesting`)
    }
  }
}

main().catch(err => {
  console.error('[fatal]', err)
  process.exit(1)
})
