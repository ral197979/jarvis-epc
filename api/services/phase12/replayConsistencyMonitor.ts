// Denver Engineering — Replay Consistency Monitor (Phase 12)
// Continuously monitors replay hash consistency across tenant streams

import crypto from 'crypto'
import { pool } from '../../db/pool'
import { tenantQuery } from '../../db/pool'
import { ReplayConsistencyRecord } from './phase12Types'

// ─── Mapper ──────────────────────────────────────────────────────────────────

function _mapConsistencyRecord(row: Record<string, unknown>): ReplayConsistencyRecord {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    streamId: row.stream_id as string,
    eventsChecked: Number(row.events_checked),
    eventsPassed: Number(row.events_passed),
    divergentHashes: row.divergent_hashes as string[],
    consistencyRate: Number(row.consistency_rate),
    checkedAt: new Date(row.checked_at as string),
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function computeReplayHash(payload: Record<string, unknown>): string {
  const canonical = JSON.stringify(payload, Object.keys(payload).sort())
  return crypto.createHash('sha256').update(canonical).digest('hex')
}

export function computeConsistencyRate(eventsChecked: number, eventsPassed: number): number {
  if (eventsChecked === 0) return 1.0
  return eventsPassed / eventsChecked
}

export function isConsistencyAcceptable(consistencyRate: number): boolean {
  return consistencyRate === 1.0
}

export function hasDivergence(record: ReplayConsistencyRecord): boolean {
  return record.divergentHashes.length > 0
}

// ─── Service ─────────────────────────────────────────────────────────────────

export async function recordConsistencyCheck(
  tenantId: string,
  streamId: string,
  eventsChecked: number,
  eventsPassed: number,
  divergentHashes: string[],
): Promise<ReplayConsistencyRecord> {
  const consistencyRate = computeConsistencyRate(eventsChecked, eventsPassed)
  const result = await pool.query(
    `INSERT INTO p12_replay_consistency
       (tenant_id, stream_id, events_checked, events_passed, divergent_hashes, consistency_rate, checked_at)
     VALUES ($1,$2,$3,$4,$5,$6,NOW())
     RETURNING *`,
    [tenantId, streamId, eventsChecked, eventsPassed, JSON.stringify(divergentHashes), consistencyRate],
  )
  return _mapConsistencyRecord(result.rows[0])
}

export async function getConsistencyHistory(tenantId: string, streamId: string, limit = 20): Promise<ReplayConsistencyRecord[]> {
  const result = await tenantQuery(
    tenantId,
    `SELECT * FROM p12_replay_consistency
     WHERE tenant_id = $1 AND stream_id = $2
     ORDER BY checked_at DESC
     LIMIT $3`,
    [tenantId, streamId, limit],
  )
  return result.rows.map(_mapConsistencyRecord)
}

export async function getDivergentStreams(): Promise<ReplayConsistencyRecord[]> {
  const result = await pool.query(
    `SELECT DISTINCT ON (stream_id) *
     FROM p12_replay_consistency
     WHERE consistency_rate < 1.0
     ORDER BY stream_id, checked_at DESC`,
  )
  return result.rows.map(_mapConsistencyRecord)
}

export async function getGlobalConsistencyRate(): Promise<number> {
  const result = await pool.query(
    `SELECT AVG(consistency_rate)::float AS rate
     FROM p12_replay_consistency
     WHERE checked_at >= NOW() - INTERVAL '24 hours'`,
  )
  return result.rows[0]?.rate ?? 1.0
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  computeReplayHash,
  computeConsistencyRate,
  isConsistencyAcceptable,
  hasDivergence,
  _mapConsistencyRecord,
}
