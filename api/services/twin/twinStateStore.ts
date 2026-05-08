// Denver Engineering — Twin State Store (v6.0.0)
// In-memory + DB cache layer for current twin state.
// Hot state is held in memory; DB is source of truth.

import { tenantQuery } from '../../db/pool'
import { OperationalTwin } from './twinTypes'
import { _mapTwin } from './twinRegistry'
import { getLatestSnapshot } from './twinSnapshotService'
import { TwinStateSnapshot } from './twinTypes'

// ─── In-memory hot state ──────────────────────────────────────────────────────

interface HotState {
  twin: OperationalTwin
  snapshot: TwinStateSnapshot | null
  cachedAt: Date
}

const _hotStore = new Map<string, HotState>()
const HOT_STATE_TTL_MS = 30_000 // 30s

// ─── Read current state ───────────────────────────────────────────────────────

export async function getCurrentState(
  twinId: string,
  tenantId: string
): Promise<{ twin: OperationalTwin; snapshot: TwinStateSnapshot | null } | null> {
  const hot = _hotStore.get(twinId)
  if (hot && Date.now() - hot.cachedAt.getTime() < HOT_STATE_TTL_MS) {
    return { twin: hot.twin, snapshot: hot.snapshot }
  }
  return _loadFromDb(twinId, tenantId)
}

async function _loadFromDb(
  twinId: string,
  tenantId: string
): Promise<{ twin: OperationalTwin; snapshot: TwinStateSnapshot | null } | null> {
  const res = await tenantQuery(
    tenantId,
    'SELECT * FROM operational_twins WHERE id = $1 AND tenant_id = $2',
    [twinId, tenantId]
  )
  if (res.rows.length === 0) return null

  const twin = _mapTwin(res.rows[0])
  const snapshot = await getLatestSnapshot(twinId, tenantId)

  _hotStore.set(twinId, { twin, snapshot, cachedAt: new Date() })
  return { twin, snapshot }
}

// ─── Write / invalidate ───────────────────────────────────────────────────────

export function invalidate(twinId: string): void {
  _hotStore.delete(twinId)
}

export function warmCache(twin: OperationalTwin, snapshot: TwinStateSnapshot | null): void {
  _hotStore.set(twin.id, { twin, snapshot, cachedAt: new Date() })
}

export function clearAll(): void {
  _hotStore.clear()
}

// ─── Bulk load for graph operations ──────────────────────────────────────────

export async function loadTwinStates(
  twinIds: string[],
  tenantId: string
): Promise<Map<string, OperationalTwin>> {
  if (twinIds.length === 0) return new Map()

  const placeholders = twinIds.map((_, i) => `$${i + 2}`).join(',')
  const res = await tenantQuery(
    tenantId,
    `SELECT * FROM operational_twins WHERE tenant_id = $1 AND id IN (${placeholders})`,
    [tenantId, ...twinIds]
  )
  const result = new Map<string, OperationalTwin>()
  for (const row of res.rows) {
    const twin = _mapTwin(row)
    result.set(twin.id, twin)
  }
  return result
}

// ─── Apply event delta ────────────────────────────────────────────────────────

export async function applyEventLink(
  twinId: string,
  tenantId: string,
  eventId: string,
  eventType: string,
  stateDelta: Record<string, unknown>,
  occurredAt: Date
): Promise<void> {
  await tenantQuery(
    tenantId,
    `INSERT INTO twin_event_links
       (tenant_id, twin_id, event_id, event_type, state_delta, occurred_at)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [tenantId, twinId, eventId, eventType, JSON.stringify(stateDelta), occurredAt.toISOString()]
  )
  invalidate(twinId)
}

export async function markEventApplied(eventLinkId: string, tenantId: string): Promise<void> {
  await tenantQuery(
    tenantId,
    `UPDATE twin_event_links SET applied = true WHERE id = $1 AND tenant_id = $2`,
    [eventLinkId, tenantId]
  )
}

export async function getPendingEventLinks(
  twinId: string,
  tenantId: string
): Promise<Array<{ id: string; eventId: string; eventType: string; stateDelta: Record<string, unknown>; occurredAt: Date }>> {
  const res = await tenantQuery(
    tenantId,
    `SELECT * FROM twin_event_links
     WHERE twin_id = $1 AND tenant_id = $2 AND applied = false
     ORDER BY occurred_at ASC`,
    [twinId, tenantId]
  )
  return res.rows.map(row => ({
    id: row.id as string,
    eventId: row.event_id as string,
    eventType: row.event_type as string,
    stateDelta: (row.state_delta ?? {}) as Record<string, unknown>,
    occurredAt: new Date(row.occurred_at as string),
  }))
}

export const __testHooks = { _hotStore, HOT_STATE_TTL_MS }
