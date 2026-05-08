// Denver Engineering — Failover Recovery Coordinator (Phase 12)
// Tracks failover events and validates replay-safe recovery

import { pool } from '../../db/pool'
import { FailoverRecord } from './phase12Types'

// ─── Mapper ──────────────────────────────────────────────────────────────────

function _mapFailoverRecord(row: Record<string, unknown>): FailoverRecord {
  return {
    id: row.id as string,
    component: row.component as string,
    trigger: row.trigger as string,
    failoverDurationMs: Number(row.failover_duration_ms),
    successful: row.successful as boolean,
    replaySafe: row.replay_safe as boolean,
    tenantsAffected: Number(row.tenants_affected),
    recoveredAt: row.recovered_at ? new Date(row.recovered_at as string) : null,
    createdAt: new Date(row.created_at as string),
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function computeFailoverSuccessRate(records: FailoverRecord[]): number {
  if (records.length === 0) return 1.0
  const successful = records.filter(r => r.successful).length
  return successful / records.length
}

export function isFailoverReplaySafe(record: FailoverRecord): boolean {
  return record.replaySafe && record.successful
}

export function classifyFailoverSeverity(tenantsAffected: number, durationMs: number): 'low' | 'medium' | 'high' | 'critical' {
  if (tenantsAffected >= 100 || durationMs >= 300000) return 'critical'
  if (tenantsAffected >= 20 || durationMs >= 60000) return 'high'
  if (tenantsAffected >= 5 || durationMs >= 10000) return 'medium'
  return 'low'
}

export function hasOpenFailovers(records: FailoverRecord[]): boolean {
  return records.some(r => r.recoveredAt === null)
}

// ─── Service ─────────────────────────────────────────────────────────────────

export async function recordFailover(
  component: string,
  trigger: string,
  tenantsAffected: number,
  replaySafe: boolean,
): Promise<FailoverRecord> {
  const result = await pool.query(
    `INSERT INTO p12_failover_records
       (component, trigger, failover_duration_ms, successful, replay_safe, tenants_affected)
     VALUES ($1,$2,0,FALSE,$3,$4)
     RETURNING *`,
    [component, trigger, replaySafe, tenantsAffected],
  )
  return _mapFailoverRecord(result.rows[0])
}

export async function completeFailover(
  recordId: string,
  failoverDurationMs: number,
  successful: boolean,
): Promise<FailoverRecord> {
  const result = await pool.query(
    `UPDATE p12_failover_records
     SET failover_duration_ms = $2, successful = $3, recovered_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [recordId, failoverDurationMs, successful],
  )
  if (!result.rows[0]) throw new Error(`FailoverRecord ${recordId} not found`)
  return _mapFailoverRecord(result.rows[0])
}

export async function getRecentFailovers(component?: string, limit = 20): Promise<FailoverRecord[]> {
  const result = await pool.query(
    `SELECT * FROM p12_failover_records
     WHERE ($1::text IS NULL OR component = $1)
     ORDER BY created_at DESC
     LIMIT $2`,
    [component ?? null, limit],
  )
  return result.rows.map(_mapFailoverRecord)
}

export async function getOpenFailovers(): Promise<FailoverRecord[]> {
  const result = await pool.query(
    `SELECT * FROM p12_failover_records
     WHERE recovered_at IS NULL
     ORDER BY created_at ASC`,
  )
  return result.rows.map(_mapFailoverRecord)
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  computeFailoverSuccessRate,
  isFailoverReplaySafe,
  classifyFailoverSeverity,
  hasOpenFailovers,
  _mapFailoverRecord,
}
