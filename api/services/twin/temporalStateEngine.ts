// Denver Engineering — Temporal State Engine (v6.0.0)
// Historical replay, time-travel queries, and state reconstruction.

import { tenantQuery } from '../../db/pool'
import { _mapSnapshot } from './twinSnapshotService'
import { TwinStateSnapshot } from './twinTypes'

// ─── Time-travel query ────────────────────────────────────────────────────────

export async function getStateAt(
  twinId: string,
  tenantId: string,
  at: Date
): Promise<Record<string, unknown> | null> {
  const res = await tenantQuery(
    tenantId,
    `SELECT state FROM twin_state_snapshots
     WHERE twin_id = $1 AND tenant_id = $2 AND snapshot_at <= $3
     ORDER BY snapshot_at DESC LIMIT 1`,
    [twinId, tenantId, at.toISOString()]
  )
  return res.rows.length > 0 ? (res.rows[0].state as Record<string, unknown>) : null
}

// ─── Replay range ─────────────────────────────────────────────────────────────

export async function replayRange(
  twinId: string,
  tenantId: string,
  from: Date,
  to: Date
): Promise<TwinStateSnapshot[]> {
  const res = await tenantQuery(
    tenantId,
    `SELECT * FROM twin_state_snapshots
     WHERE twin_id = $1 AND tenant_id = $2
       AND snapshot_at >= $3 AND snapshot_at <= $4
     ORDER BY sequence_num ASC`,
    [twinId, tenantId, from.toISOString(), to.toISOString()]
  )
  return res.rows.map(_mapSnapshot)
}

// ─── State diff between two points ───────────────────────────────────────────

export async function diffStates(
  twinId: string,
  tenantId: string,
  fromAt: Date,
  toAt: Date
): Promise<{
  from: Record<string, unknown> | null
  to: Record<string, unknown> | null
  diff: Record<string, unknown>
}> {
  const [fromState, toState] = await Promise.all([
    getStateAt(twinId, tenantId, fromAt),
    getStateAt(twinId, tenantId, toAt),
  ])

  const diff: Record<string, unknown> = {}
  if (fromState && toState) {
    const allKeys = new Set([...Object.keys(fromState), ...Object.keys(toState)])
    for (const key of allKeys) {
      const f = fromState[key]
      const t = toState[key]
      if (JSON.stringify(f) !== JSON.stringify(t)) {
        diff[key] = { from: f ?? null, to: t ?? null }
      }
    }
  }

  return { from: fromState, to: toState, diff }
}

// ─── Reconstruct state from sequence ─────────────────────────────────────────

export async function reconstructAtSequence(
  twinId: string,
  tenantId: string,
  sequenceNum: number
): Promise<Record<string, unknown> | null> {
  const res = await tenantQuery(
    tenantId,
    `SELECT state FROM twin_state_snapshots
     WHERE twin_id = $1 AND tenant_id = $2 AND sequence_num = $3`,
    [twinId, tenantId, sequenceNum]
  )
  return res.rows.length > 0 ? (res.rows[0].state as Record<string, unknown>) : null
}

// ─── State velocity (rate of change) ─────────────────────────────────────────

export async function computeStateVelocity(
  twinId: string,
  tenantId: string,
  windowDays = 7
): Promise<{ changesPerDay: number; mostChangedFields: string[] }> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000)

  const res = await tenantQuery(
    tenantId,
    `SELECT diff FROM twin_state_snapshots
     WHERE twin_id = $1 AND tenant_id = $2 AND snapshot_at >= $3 AND diff IS NOT NULL
     ORDER BY sequence_num ASC`,
    [twinId, tenantId, since.toISOString()]
  )

  const fieldChangeCounts = new Map<string, number>()
  for (const row of res.rows) {
    const diff = row.diff as Record<string, unknown>
    for (const key of Object.keys(diff)) {
      fieldChangeCounts.set(key, (fieldChangeCounts.get(key) ?? 0) + 1)
    }
  }

  const changesPerDay = res.rows.length / Math.max(1, windowDays)
  const mostChangedFields = [...fieldChangeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k]) => k)

  return { changesPerDay, mostChangedFields }
}

// ─── Historical trend ─────────────────────────────────────────────────────────

export async function getScoreTrend(
  twinId: string,
  tenantId: string,
  field: 'readinessScore' | 'riskScore' | 'healthScore',
  windowDays = 30
): Promise<Array<{ ts: Date; value: number }>> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000)

  const res = await tenantQuery(
    tenantId,
    `SELECT snapshot_at, state FROM twin_state_snapshots
     WHERE twin_id = $1 AND tenant_id = $2 AND snapshot_at >= $3
     ORDER BY snapshot_at ASC`,
    [twinId, tenantId, since.toISOString()]
  )

  const dbField = field === 'readinessScore' ? 'readiness_score'
    : field === 'riskScore' ? 'risk_score' : 'health_score'

  return res.rows
    .map(row => {
      const state = row.state as Record<string, unknown>
      const val = state[dbField] ?? state[field]
      return { ts: new Date(row.snapshot_at as string), value: Number(val) }
    })
    .filter(p => !isNaN(p.value))
}

export const __testHooks = { getStateAt, diffStates, computeStateVelocity }
