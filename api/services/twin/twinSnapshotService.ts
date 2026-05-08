// Denver Engineering — Twin Snapshot Service (v6.0.0)
// Captures, stores, and retrieves state snapshots with integrity checks.

import { createHash } from 'crypto'
import { tenantQuery } from '../../db/pool'
import { TwinStateSnapshot } from './twinTypes'

// ─── Capture snapshot ─────────────────────────────────────────────────────────

export async function captureSnapshot(
  twinId: string,
  tenantId: string,
  state: Record<string, unknown>,
  triggeringEventId?: string
): Promise<TwinStateSnapshot> {
  const checksum = _checksumState(state)

  // Get next sequence number and previous state in one query
  const seqRes = await tenantQuery(
    tenantId,
    `SELECT COALESCE(MAX(sequence_num), 0) + 1 AS next_seq,
            (SELECT state FROM twin_state_snapshots
             WHERE twin_id = $1
             ORDER BY sequence_num DESC LIMIT 1) AS prev_state
     FROM twin_state_snapshots WHERE twin_id = $1`,
    [twinId]
  )
  const nextSeq: number = Number(seqRes.rows[0]?.next_seq ?? 1)
  const prevStateRaw = seqRes.rows[0]?.prev_state as Record<string, unknown> | null
  const diff = prevStateRaw != null ? _computeDiff(prevStateRaw, state) : null

  const res = await tenantQuery(
    tenantId,
    `INSERT INTO twin_state_snapshots
       (tenant_id, twin_id, sequence_num, state, diff, checksum, triggering_event_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [
      tenantId, twinId, nextSeq,
      JSON.stringify(state),
      diff != null ? JSON.stringify(diff) : null,
      checksum,
      triggeringEventId ?? null,
    ]
  )
  return _mapSnapshot(res.rows[0])
}

// ─── Retrieve snapshots ───────────────────────────────────────────────────────

export async function getSnapshot(
  snapshotId: string,
  tenantId: string
): Promise<TwinStateSnapshot | null> {
  const res = await tenantQuery(
    tenantId,
    'SELECT * FROM twin_state_snapshots WHERE id = $1 AND tenant_id = $2',
    [snapshotId, tenantId]
  )
  return res.rows.length > 0 ? _mapSnapshot(res.rows[0]) : null
}

export async function getLatestSnapshot(
  twinId: string,
  tenantId: string
): Promise<TwinStateSnapshot | null> {
  const res = await tenantQuery(
    tenantId,
    `SELECT * FROM twin_state_snapshots
     WHERE twin_id = $1 AND tenant_id = $2
     ORDER BY sequence_num DESC LIMIT 1`,
    [twinId, tenantId]
  )
  return res.rows.length > 0 ? _mapSnapshot(res.rows[0]) : null
}

export async function getSnapshotAtTime(
  twinId: string,
  tenantId: string,
  at: Date
): Promise<TwinStateSnapshot | null> {
  const res = await tenantQuery(
    tenantId,
    `SELECT * FROM twin_state_snapshots
     WHERE twin_id = $1 AND tenant_id = $2 AND snapshot_at <= $3
     ORDER BY snapshot_at DESC LIMIT 1`,
    [twinId, tenantId, at.toISOString()]
  )
  return res.rows.length > 0 ? _mapSnapshot(res.rows[0]) : null
}

export async function listSnapshots(
  twinId: string,
  tenantId: string,
  limit = 50,
  offset = 0
): Promise<TwinStateSnapshot[]> {
  const res = await tenantQuery(
    tenantId,
    `SELECT * FROM twin_state_snapshots
     WHERE twin_id = $1 AND tenant_id = $2
     ORDER BY sequence_num DESC
     LIMIT $3 OFFSET $4`,
    [twinId, tenantId, limit, offset]
  )
  return res.rows.map(_mapSnapshot)
}

// ─── Integrity verification ───────────────────────────────────────────────────

export function verifySnapshot(snapshot: TwinStateSnapshot): boolean {
  return _checksumState(snapshot.state) === snapshot.checksum
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function _checksumState(state: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(state)).digest('hex')
}

export function _computeDiff(
  prev: Record<string, unknown>,
  next: Record<string, unknown>
): Record<string, unknown> {
  const diff: Record<string, unknown> = {}
  const allKeys = new Set([...Object.keys(prev), ...Object.keys(next)])
  for (const key of allKeys) {
    const pVal = prev[key]
    const nVal = next[key]
    if (JSON.stringify(pVal) !== JSON.stringify(nVal)) {
      diff[key] = { from: pVal ?? null, to: nVal ?? null }
    }
  }
  return diff
}

export function _mapSnapshot(row: Record<string, unknown>): TwinStateSnapshot {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    twinId: row.twin_id as string,
    snapshotAt: new Date(row.snapshot_at as string),
    sequenceNum: Number(row.sequence_num),
    state: (row.state ?? {}) as Record<string, unknown>,
    diff: row.diff != null ? (row.diff as Record<string, unknown>) : undefined,
    checksum: row.checksum as string,
    triggeringEventId: row.triggering_event_id != null ? row.triggering_event_id as string : undefined,
  }
}

export const __testHooks = { _checksumState, _computeDiff, _mapSnapshot }
