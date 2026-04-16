/**
 * JARVIS EPC — PostgreSQL Connection Pool
 * ─────────────────────────────────────────
 * v4.26.0 — Production database layer.
 *
 * Features:
 *   - pg-pool with configurable min/max connections
 *   - Health-check query on startup
 *   - Tenant context injection via SET LOCAL app.current_tenant_id
 *   - Query helper with automatic tenant scoping
 *   - Transaction helper that enforces tenant context
 *   - Graceful shutdown hook
 *
 * Environment variables:
 *   DATABASE_URL  — full connection string (preferred, e.g. Render/Neon/Supabase)
 *   DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD — individual overrides
 *   DB_POOL_MIN   — minimum idle connections (default: 2)
 *   DB_POOL_MAX   — maximum connections     (default: 20)
 *   DB_SSL        — 'true' to force SSL (required for cloud PG providers)
 */

import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg'
import { slog } from '../../src/modules/observability/index'

// ─── Build pool config ────────────────────────────────────────────────────────

const DATABASE_URL = process.env['DATABASE_URL']

const poolConfig = DATABASE_URL
  ? {
      connectionString: DATABASE_URL,
      ssl: process.env['DB_SSL'] === 'true' ? { rejectUnauthorized: false } : undefined,
    }
  : {
      host:     process.env['DB_HOST']     ?? 'localhost',
      port:     Number(process.env['DB_PORT'])   || 5432,
      database: process.env['DB_NAME']     ?? 'jarvis_epc',
      user:     process.env['DB_USER']     ?? 'jarvis',
      password: process.env['DB_PASSWORD'] ?? '',
      ssl:      process.env['DB_SSL'] === 'true' ? { rejectUnauthorized: false } : undefined,
    }

const _pool = new Pool({
  ...poolConfig,
  min:             Number(process.env['DB_POOL_MIN']) || 2,
  max:             Number(process.env['DB_POOL_MAX']) || 20,
  idleTimeoutMillis:    30_000,
  connectionTimeoutMillis: 5_000,
})

// ─── Pool error handler ────────────────────────────────────────────────────────

_pool.on('error', (err) => {
  slog('ERROR', 'db', '[pool] Unexpected idle client error', { message: err.message })
})

// ─── Startup health check ─────────────────────────────────────────────────────

let _poolReady = false

export async function initPool(): Promise<void> {
  try {
    const client = await _pool.connect()
    const result = await client.query<{ now: Date }>('SELECT NOW() AS now')
    client.release()
    _poolReady = true
    slog('INFO', 'db', '[pool] PostgreSQL connected', {
      time: result.rows[0]?.now?.toISOString() ?? 'unknown',
      host: (poolConfig as Record<string, unknown>)['host'] ?? 'via DATABASE_URL',
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    slog('ERROR', 'db', '[pool] Failed to connect to PostgreSQL', { message: msg })
    if (process.env['NODE_ENV'] === 'production') {
      process.exit(1)
    }
    throw err
  }
}

// ─── Query helpers ────────────────────────────────────────────────────────────

/**
 * Run a query without tenant context (for admin / migration use only).
 */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values?: unknown[],
): Promise<QueryResult<T>> {
  const start = Date.now()
  const result = await _pool.query<T>(text, values)
  const duration = Date.now() - start
  if (duration > 500) {
    slog('WARN', 'db', '[query] Slow query', { duration, text: text.slice(0, 120) })
  }
  return result
}

/**
 * Run a query scoped to a specific tenant.
 * Sets `app.current_tenant_id` for the duration of the query
 * so that PostgreSQL Row Level Security policies apply correctly.
 */
export async function tenantQuery<T extends QueryResultRow = QueryResultRow>(
  tenantId: string,
  text: string,
  values?: unknown[],
): Promise<QueryResult<T>> {
  const client = await _pool.connect()
  try {
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId])
    const start  = Date.now()
    const result = await client.query<T>(text, values)
    const duration = Date.now() - start
    if (duration > 500) {
      slog('WARN', 'db', '[tenantQuery] Slow query', { tenantId, duration, text: text.slice(0, 120) })
    }
    return result
  } finally {
    client.release()
  }
}

/**
 * Run multiple queries in a single transaction with tenant context.
 * Rolls back automatically on error.
 */
export async function tenantTransaction<T>(
  tenantId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await _pool.connect()
  try {
    await client.query('BEGIN')
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId])
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// ─── Pool health ──────────────────────────────────────────────────────────────

export function poolHealthy(): boolean {
  return _poolReady && _pool.totalCount >= 0
}

export function poolStats() {
  return {
    total:   _pool.totalCount,
    idle:    _pool.idleCount,
    waiting: _pool.waitingCount,
  }
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────

process.on('SIGTERM', async () => {
  slog('INFO', 'db', '[pool] Draining connections on SIGTERM')
  await _pool.end()
})

export { _pool as pool }
