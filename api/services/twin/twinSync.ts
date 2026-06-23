// Denver Engineering — Twin Sync Service (v6.0.0)
// Polls source entities, detects state changes, triggers snapshots, updates twin records.

import { tenantQuery } from '../../db/pool'
import { registerTwin, updateTwinScores, _mapTwin } from './twinRegistry'
import { captureSnapshot } from './twinSnapshotService'
import { invalidate } from './twinStateStore'
import { TwinEntityType, OperationalTwin } from './twinTypes'

// ─── Sync result ──────────────────────────────────────────────────────────────

export interface SyncResult {
  twinId: string
  entityType: TwinEntityType
  entityId: string
  changed: boolean
  snapshotId?: string
  syncLagMs: number
}

// ─── Sync a single twin ───────────────────────────────────────────────────────

export async function syncTwin(
  tenantId: string,
  twinId: string,
  newState: Record<string, unknown>,
  triggeringEventId?: string
): Promise<SyncResult> {
  const start = Date.now()

  // Load current twin
  const res = await tenantQuery(
    tenantId,
    'SELECT * FROM operational_twins WHERE id = $1 AND tenant_id = $2',
    [twinId, tenantId]
  )
  if (res.rows.length === 0) throw new Error(`Twin not found: ${twinId}`)
  const twin = _mapTwin(res.rows[0])

  // Get latest snapshot state
  const snapshotRes = await tenantQuery(
    tenantId,
    `SELECT state FROM twin_state_snapshots
     WHERE twin_id = $1 AND tenant_id = $2
     ORDER BY sequence_num DESC LIMIT 1`,
    [twinId, tenantId]
  )
  const prevState = snapshotRes.rows.length > 0
    ? (snapshotRes.rows[0].state as Record<string, unknown>)
    : null

  // Detect change
  const changed = _hasStateChanged(prevState, newState)
  const syncLagMs = Date.now() - start

  if (!changed) {
    // Just update sync timestamp
    await tenantQuery(
      tenantId,
      `UPDATE operational_twins SET last_synced_at = now(), sync_lag_ms = $3, updated_at = now()
       WHERE id = $1 AND tenant_id = $2`,
      [twinId, tenantId, syncLagMs]
    )
    return { twinId, entityType: twin.entityType, entityId: twin.entityId, changed: false, syncLagMs }
  }

  // Extract scores from new state if present
  const scores: { readinessScore?: number; riskScore?: number; healthScore?: number } = {}
  if (typeof newState.readinessScore === 'number') scores.readinessScore = newState.readinessScore
  if (typeof newState.riskScore === 'number') scores.riskScore = newState.riskScore
  if (typeof newState.healthScore === 'number') scores.healthScore = newState.healthScore

  if (Object.keys(scores).length > 0) {
    await updateTwinScores(twinId, tenantId, scores)
  }

  // Update sync markers
  await tenantQuery(
    tenantId,
    `UPDATE operational_twins SET last_synced_at = now(), sync_lag_ms = $3, updated_at = now()
     WHERE id = $1 AND tenant_id = $2`,
    [twinId, tenantId, syncLagMs]
  )

  // Capture snapshot
  const snapshot = await captureSnapshot(twinId, tenantId, newState, triggeringEventId)

  // Invalidate hot cache
  invalidate(twinId)

  return {
    twinId,
    entityType: twin.entityType,
    entityId: twin.entityId,
    changed: true,
    snapshotId: snapshot.id,
    syncLagMs,
  }
}

// ─── Bulk sync for a tenant ───────────────────────────────────────────────────

export async function syncTwins(
  tenantId: string,
  updates: Array<{ twinId: string; newState: Record<string, unknown>; triggeringEventId?: string }>
): Promise<SyncResult[]> {
  const results: SyncResult[] = []
  for (const u of updates) {
    results.push(await syncTwin(tenantId, u.twinId, u.newState, u.triggeringEventId))
  }
  return results
}

// ─── Register and sync entity ─────────────────────────────────────────────────

export async function registerAndSync(
  tenantId: string,
  entityType: TwinEntityType,
  entityId: string,
  name: string,
  state: Record<string, unknown>,
  options: {
    description?: string
    metadata?: Record<string, unknown>
    triggeringEventId?: string
  } = {}
): Promise<{ twin: OperationalTwin; snapshotId: string }> {
  const twin = await registerTwin({
    tenantId,
    entityType,
    entityId,
    name,
    description: options.description,
    metadata: options.metadata,
    readinessScore: typeof state.readinessScore === 'number' ? state.readinessScore : undefined,
    riskScore: typeof state.riskScore === 'number' ? state.riskScore : undefined,
    healthScore: typeof state.healthScore === 'number' ? state.healthScore : undefined,
  })

  const snapshot = await captureSnapshot(twin.id, tenantId, state, options.triggeringEventId)

  return { twin, snapshotId: snapshot.id }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function _hasStateChanged(
  prev: Record<string, unknown> | null,
  next: Record<string, unknown>
): boolean {
  if (prev === null) return true
  return JSON.stringify(prev) !== JSON.stringify(next)
}

export const __testHooks = { _hasStateChanged }
