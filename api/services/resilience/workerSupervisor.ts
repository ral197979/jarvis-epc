/**
 * Denver Engineering — Worker Supervisor + Distributed Locking (v4.40.0)
 * ───────────────────────────────────────────────────────────────────────
 * Ava Phase 4 — Database-backed distributed lease management.
 * Prevents duplicate execution, detects stale workers, and enables
 * automatic lease reclamation without advisory locks.
 *
 * Pattern:
 *   1. Worker calls acquireLease(key, workerId, ttlSeconds)
 *   2. On success: worker runs its job
 *   3. Worker calls startHeartbeat() to renew TTL periodically
 *   4. If worker dies: lease expires; next call to reclaimStaleLease() wins
 *   5. Worker calls releaseLease() on clean shutdown
 */

import pool from '../../db/pool'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LeaseInfo {
  leaseKey:    string
  workerId:    string
  acquiredAt:  string
  expiresAt:   string
  heartbeatAt: string
}

// ─── Acquire Lease ────────────────────────────────────────────────────────────
// Uses INSERT ON CONFLICT DO NOTHING + a subsequent SELECT to determine
// whether we won the lease or someone else holds it.

export async function acquireLease(
  key: string,
  workerId: string,
  ttlSeconds: number
): Promise<boolean> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Try to insert; fails silently if key already held
    const { rowCount } = await client.query(`
      INSERT INTO worker_leases (lease_key, worker_id, expires_at)
      VALUES ($1, $2, now() + ($3 || ' seconds')::interval)
      ON CONFLICT (lease_key) DO NOTHING
    `, [key, workerId, String(ttlSeconds)])

    if ((rowCount ?? 0) > 0) {
      await client.query('COMMIT')
      return true  // we inserted = we hold the lease
    }

    // Check if existing lease has expired
    const { rows } = await client.query(`
      SELECT worker_id, expires_at, heartbeat_at FROM worker_leases WHERE lease_key = $1
    `, [key])

    if (!rows[0]) {
      await client.query('ROLLBACK')
      return false
    }

    const isExpired = new Date(rows[0].heartbeat_at) < new Date(Date.now() - ttlSeconds * 1000)
    if (isExpired) {
      const { rowCount: updated } = await client.query(`
        UPDATE worker_leases SET worker_id = $1, acquired_at = now(),
          heartbeat_at = now(), expires_at = now() + ($2 || ' seconds')::interval
        WHERE lease_key = $3 AND heartbeat_at = $4
      `, [workerId, String(ttlSeconds), key, rows[0].heartbeat_at])
      await client.query('COMMIT')
      return (updated ?? 0) > 0
    }

    await client.query('ROLLBACK')
    return false
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

// ─── Renew Lease Heartbeat ────────────────────────────────────────────────────

export async function renewLease(
  key: string,
  workerId: string,
  ttlSeconds?: number
): Promise<boolean> {
  const q = ttlSeconds
    ? `UPDATE worker_leases SET heartbeat_at = now(),
         expires_at = now() + ($3 || ' seconds')::interval
       WHERE lease_key = $1 AND worker_id = $2`
    : `UPDATE worker_leases SET heartbeat_at = now()
       WHERE lease_key = $1 AND worker_id = $2`
  const params = ttlSeconds ? [key, workerId, String(ttlSeconds)] : [key, workerId]
  const { rowCount } = await pool.query(q, params)
  return (rowCount ?? 0) > 0
}

// ─── Release Lease ────────────────────────────────────────────────────────────

export async function releaseLease(
  key: string,
  workerId: string
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM worker_leases WHERE lease_key = $1 AND worker_id = $2`,
    [key, workerId])
  return (rowCount ?? 0) > 0
}

// ─── Reclaim Stale Lease ──────────────────────────────────────────────────────

export async function reclaimStaleLease(
  key: string,
  newWorkerId: string,
  ttlSeconds: number
): Promise<boolean> {
  const { rowCount } = await pool.query(`
    UPDATE worker_leases
    SET worker_id = $1, acquired_at = now(), heartbeat_at = now(),
        expires_at = now() + ($2 || ' seconds')::interval
    WHERE lease_key = $3 AND heartbeat_at < now() - ($2 || ' seconds')::interval
  `, [newWorkerId, String(ttlSeconds), key])
  return (rowCount ?? 0) > 0
}

// ─── Start Heartbeat ──────────────────────────────────────────────────────────

export function startHeartbeat(
  key: string,
  workerId: string,
  intervalMs = 10_000,
  ttlSeconds = 30
): NodeJS.Timeout {
  return setInterval(() => {
    renewLease(key, workerId, ttlSeconds).catch(() => {})
  }, intervalMs)
}

// ─── Get Lease Info ───────────────────────────────────────────────────────────

export async function getLeaseInfo(
  key: string
): Promise<LeaseInfo | null> {
  const { rows } = await pool.query(
    `SELECT lease_key, worker_id, acquired_at, expires_at, heartbeat_at
     FROM worker_leases WHERE lease_key = $1`,
    [key])
  if (!rows[0]) return null
  return {
    leaseKey:   rows[0].lease_key,
    workerId:   rows[0].worker_id,
    acquiredAt: new Date(rows[0].acquired_at).toISOString(),
    expiresAt:  new Date(rows[0].expires_at).toISOString(),
    heartbeatAt: new Date(rows[0].heartbeat_at).toISOString(),
  }
}

// ─── Clean Up Expired Leases ──────────────────────────────────────────────────

export async function purgeExpiredLeases(): Promise<number> {
  const { rowCount } = await pool.query(
    `DELETE FROM worker_leases WHERE expires_at < now()`)
  return rowCount ?? 0
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  acquireLease,
  renewLease,
  releaseLease,
  reclaimStaleLease,
  getLeaseInfo,
  purgeExpiredLeases,
}
