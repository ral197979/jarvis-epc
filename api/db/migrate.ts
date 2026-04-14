/**
 * JARVIS EPC — Migration Runner
 * ───────────────────────────────
 * v4.26.0 — Runs SQL migration files in sequence.
 *
 * - Tracks applied migrations in the `schema_migrations` table
 * - Idempotent: already-applied migrations are skipped
 * - Fails fast: any SQL error aborts the run
 * - Can be run standalone: `tsx api/db/migrate.ts`
 *   or imported and called from server startup
 */

import fs   from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pool, initPool } from './pool'
import { slog } from '../../src/modules/observability/index'

const __filename = fileURLToPath(import.meta.url)
const __dirname  = path.dirname(__filename)

const MIGRATIONS_DIR = path.join(__dirname, 'migrations')

// ─── Bootstrap migration tracking table ──────────────────────────────────────

async function ensureMigrationsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     VARCHAR(255) PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
}

// ─── Get already-applied versions ────────────────────────────────────────────

async function appliedVersions(): Promise<Set<string>> {
  const result = await pool.query<{ version: string }>('SELECT version FROM schema_migrations')
  return new Set(result.rows.map(r => r.version))
}

// ─── Run pending migrations ───────────────────────────────────────────────────

export async function runMigrations(): Promise<void> {
  await ensureMigrationsTable()
  const applied = await appliedVersions()

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort()

  if (files.length === 0) {
    slog('INFO', 'db', '[migrate] No migration files found', { dir: MIGRATIONS_DIR })
    return
  }

  let ran = 0
  for (const file of files) {
    if (applied.has(file)) {
      slog('INFO', 'db', '[migrate] Already applied — skipping', { file })
      continue
    }

    const sqlPath = path.join(MIGRATIONS_DIR, file)
    const sql     = fs.readFileSync(sqlPath, 'utf8')

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(sql)
      await client.query(
        'INSERT INTO schema_migrations (version) VALUES ($1)',
        [file],
      )
      await client.query('COMMIT')
      slog('INFO', 'db', '[migrate] Applied', { file })
      ran++
    } catch (err) {
      await client.query('ROLLBACK')
      const msg = err instanceof Error ? err.message : String(err)
      slog('ERROR', 'db', '[migrate] FAILED', { file, message: msg })
      throw new Error(`Migration failed: ${file} — ${msg}`)
    } finally {
      client.release()
    }
  }

  if (ran === 0) {
    slog('INFO', 'db', '[migrate] Database is up to date')
  } else {
    slog('INFO', 'db', `[migrate] Applied ${ran} migration(s)`)
  }
}

// ─── Standalone run ───────────────────────────────────────────────────────────

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await initPool()
  await runMigrations()
  await pool.end()
  process.exit(0)
}
