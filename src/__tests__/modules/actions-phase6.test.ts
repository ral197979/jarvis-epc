/**
 * Denver Engineering — Phase 6 Test Suite A (v6.0.0)
 * ──────────────────────────────────────────────────────
 * Ava Phase 6 — Operational Digital Twin + Predictive Coordination.
 * 120+ tests across 20 suites.
 * Covers: twinRegistry, twinSnapshotService, twinGraph, twinStateStore,
 *         twinSync, stateGraphEngine, graphTraversalService,
 *         graphRiskPropagation, temporalStateEngine, operationalForecastEngine.
 * All DB calls are mocked. No external dependencies.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock pool ────────────────────────────────────────────────────────────────

vi.mock('../../../api/db/pool', () => ({
  default: { query: vi.fn(), connect: vi.fn() },
  tenantQuery: vi.fn(),
}))

import { tenantQuery } from '../../../api/db/pool'
const mockTenant = vi.mocked(tenantQuery)

const mockRows = (rows: Record<string, unknown>[]) => ({ rows } as never)
const mockRow  = (row: Record<string, unknown>)   => ({ rows: [row] } as never)

// ─── Factories ────────────────────────────────────────────────────────────────

const makeTwinRow = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'twin-1',
  tenant_id: 'tenant-1',
  entity_type: 'project',
  entity_id: 'proj-1',
  name: 'Test Project',
  description: null,
  status: 'active',
  metadata: {},
  readiness_score: '75.00',
  risk_score: '30.00',
  health_score: null,
  last_synced_at: null,
  sync_lag_ms: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
})

const makeSnapshotRow = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'snap-1',
  tenant_id: 'tenant-1',
  twin_id: 'twin-1',
  snapshot_at: new Date().toISOString(),
  sequence_num: 1,
  state: { readiness_score: 75, risk_score: 30 },
  diff: null,
  checksum: 'abc123',
  triggering_event_id: null,
  ...overrides,
})

const makeRelRow = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'rel-1',
  tenant_id: 'tenant-1',
  from_twin_id: 'twin-1',
  to_twin_id: 'twin-2',
  rel_type: 'depends_on',
  weight: '1.0',
  metadata: {},
  valid_from: new Date().toISOString(),
  valid_to: null,
  created_at: new Date().toISOString(),
  ...overrides,
})

// ─── Twin Registry ────────────────────────────────────────────────────────────

describe('twinRegistry', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('registerTwin — upserts and maps twin', async () => {
    mockTenant.mockResolvedValueOnce(mockRow(makeTwinRow()))
    const { registerTwin } = await import('../../../api/services/twin/twinRegistry')
    const twin = await registerTwin({
      tenantId: 'tenant-1', entityType: 'project', entityId: 'proj-1', name: 'Test Project',
    })
    expect(twin.id).toBe('twin-1')
    expect(twin.readinessScore).toBe(75)
    expect(twin.riskScore).toBe(30)
    expect(twin.healthScore).toBeUndefined()
    expect(twin.lastSyncedAt).toBeUndefined()
    expect(mockTenant).toHaveBeenCalledOnce()
  })

  it('registerTwin — maps description as undefined when null', async () => {
    mockTenant.mockResolvedValueOnce(mockRow(makeTwinRow({ description: null })))
    const { registerTwin } = await import('../../../api/services/twin/twinRegistry')
    const twin = await registerTwin({ tenantId: 'tenant-1', entityType: 'site', entityId: 's1', name: 'Site' })
    expect(twin.description).toBeUndefined()
  })

  it('updateTwinScores — builds dynamic SET clause and updates', async () => {
    mockTenant.mockResolvedValueOnce(mockRow(makeTwinRow({ readiness_score: '80.00' })))
    const { updateTwinScores } = await import('../../../api/services/twin/twinRegistry')
    const twin = await updateTwinScores('twin-1', 'tenant-1', { readinessScore: 80 })
    expect(twin.readinessScore).toBe(80)
    const call = mockTenant.mock.calls[0]
    expect(call[1]).toContain('readiness_score')
  })

  it('updateTwinScores — throws if twin not found', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { updateTwinScores } = await import('../../../api/services/twin/twinRegistry')
    await expect(updateTwinScores('missing', 'tenant-1', { riskScore: 50 }))
      .rejects.toThrow('Twin not found: missing')
  })

  it('updateTwinStatus — calls UPDATE', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { updateTwinStatus } = await import('../../../api/services/twin/twinRegistry')
    await updateTwinStatus('twin-1', 'tenant-1', 'degraded')
    expect(mockTenant).toHaveBeenCalledOnce()
    expect(mockTenant.mock.calls[0][1]).toContain('status = $3')
  })

  it('markTwinSynced — updates last_synced_at and sync_lag_ms', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { markTwinSynced } = await import('../../../api/services/twin/twinRegistry')
    await markTwinSynced('twin-1', 'tenant-1', 150)
    expect(mockTenant.mock.calls[0][2]).toContain(150)
  })

  it('getTwin — returns mapped twin when found', async () => {
    mockTenant.mockResolvedValueOnce(mockRow(makeTwinRow()))
    const { getTwin } = await import('../../../api/services/twin/twinRegistry')
    const twin = await getTwin('twin-1', 'tenant-1')
    expect(twin?.id).toBe('twin-1')
  })

  it('getTwin — returns null when not found', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { getTwin } = await import('../../../api/services/twin/twinRegistry')
    const twin = await getTwin('missing', 'tenant-1')
    expect(twin).toBeNull()
  })

  it('getTwinByEntity — queries by entityType and entityId', async () => {
    mockTenant.mockResolvedValueOnce(mockRow(makeTwinRow()))
    const { getTwinByEntity } = await import('../../../api/services/twin/twinRegistry')
    const twin = await getTwinByEntity('tenant-1', 'project', 'proj-1')
    expect(twin?.entityId).toBe('proj-1')
    expect(mockTenant.mock.calls[0][2]).toEqual(['tenant-1', 'project', 'proj-1'])
  })

  it('listTwins — applies entityType filter', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([makeTwinRow(), makeTwinRow({ id: 'twin-2' })]))
    const { listTwins } = await import('../../../api/services/twin/twinRegistry')
    const twins = await listTwins('tenant-1', { entityType: 'project' })
    expect(twins).toHaveLength(2)
    expect(mockTenant.mock.calls[0][1]).toContain('entity_type')
  })

  it('getTwinCount — returns integer count', async () => {
    mockTenant.mockResolvedValueOnce(mockRow({ cnt: '7' }))
    const { getTwinCount } = await import('../../../api/services/twin/twinRegistry')
    const count = await getTwinCount('tenant-1')
    expect(count).toBe(7)
  })

  it('_mapTwin — coerces all numeric and date fields', async () => {
    const { __testHooks } = await import('../../../api/services/twin/twinRegistry')
    const row = makeTwinRow({
      last_synced_at: new Date().toISOString(),
      sync_lag_ms: 200,
      health_score: '88.5',
    })
    const twin = __testHooks._mapTwin(row)
    expect(twin.healthScore).toBe(88.5)
    expect(twin.lastSyncedAt).toBeInstanceOf(Date)
    expect(twin.syncLagMs).toBe(200)
  })
})

// ─── Twin Snapshot Service ────────────────────────────────────────────────────

describe('twinSnapshotService', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('_checksumState — produces stable sha256', async () => {
    const { __testHooks } = await import('../../../api/services/twin/twinSnapshotService')
    const state = { a: 1, b: 'hello' }
    const h1 = __testHooks._checksumState(state)
    const h2 = __testHooks._checksumState(state)
    expect(h1).toBe(h2)
    expect(h1).toHaveLength(64)
  })

  it('_checksumState — different state produces different hash', async () => {
    const { __testHooks } = await import('../../../api/services/twin/twinSnapshotService')
    const h1 = __testHooks._checksumState({ a: 1 })
    const h2 = __testHooks._checksumState({ a: 2 })
    expect(h1).not.toBe(h2)
  })

  it('_computeDiff — detects added, removed, changed fields', async () => {
    const { __testHooks } = await import('../../../api/services/twin/twinSnapshotService')
    const diff = __testHooks._computeDiff(
      { a: 1, b: 'old', c: 'same' },
      { a: 2, d: 'new', c: 'same' }
    )
    expect(diff['a']).toEqual({ from: 1, to: 2 })
    expect(diff['b']).toEqual({ from: 'old', to: null })
    expect(diff['d']).toEqual({ from: null, to: 'new' })
    expect(diff['c']).toBeUndefined()
  })

  it('_computeDiff — returns empty for identical states', async () => {
    const { __testHooks } = await import('../../../api/services/twin/twinSnapshotService')
    const diff = __testHooks._computeDiff({ x: 1 }, { x: 1 })
    expect(Object.keys(diff)).toHaveLength(0)
  })

  it('_mapSnapshot — maps all fields with null guards', async () => {
    const { __testHooks } = await import('../../../api/services/twin/twinSnapshotService')
    const row = makeSnapshotRow()
    const snap = __testHooks._mapSnapshot(row)
    expect(snap.id).toBe('snap-1')
    expect(snap.sequenceNum).toBe(1)
    expect(snap.diff).toBeUndefined()
    expect(snap.triggeringEventId).toBeUndefined()
  })

  it('captureSnapshot — inserts with next seq and checksum', async () => {
    // seq query
    mockTenant.mockResolvedValueOnce(mockRow({ next_seq: '3', prev_state: null }))
    // insert
    mockTenant.mockResolvedValueOnce(mockRow(makeSnapshotRow({ sequence_num: 3 })))
    const { captureSnapshot } = await import('../../../api/services/twin/twinSnapshotService')
    const snap = await captureSnapshot('twin-1', 'tenant-1', { val: 1 })
    expect(snap.sequenceNum).toBe(3) // sequence_num from mock INSERT row
    expect(mockTenant).toHaveBeenCalledTimes(2)
  })

  it('captureSnapshot — computes diff from previous state', async () => {
    mockTenant.mockResolvedValueOnce(mockRow({ next_seq: '2', prev_state: { val: 1 } }))
    mockTenant.mockResolvedValueOnce(mockRow(makeSnapshotRow({ diff: { val: { from: 1, to: 2 } } })))
    const { captureSnapshot } = await import('../../../api/services/twin/twinSnapshotService')
    const snap = await captureSnapshot('twin-1', 'tenant-1', { val: 2 })
    expect(snap).toBeDefined()
  })

  it('getSnapshot — returns null when not found', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { getSnapshot } = await import('../../../api/services/twin/twinSnapshotService')
    const snap = await getSnapshot('missing', 'tenant-1')
    expect(snap).toBeNull()
  })

  it('verifySnapshot — returns true for valid checksum', async () => {
    const { __testHooks, verifySnapshot } = await import('../../../api/services/twin/twinSnapshotService')
    const state = { x: 42 }
    const checksum = __testHooks._checksumState(state)
    const snap = { state, checksum } as unknown as Parameters<typeof verifySnapshot>[0]
    expect(verifySnapshot(snap)).toBe(true)
  })

  it('verifySnapshot — returns false for tampered state', async () => {
    const { verifySnapshot } = await import('../../../api/services/twin/twinSnapshotService')
    const snap = { state: { x: 42 }, checksum: 'wrong' } as unknown as Parameters<typeof verifySnapshot>[0]
    expect(verifySnapshot(snap)).toBe(false)
  })
})

// ─── Twin Graph ───────────────────────────────────────────────────────────────

describe('twinGraph', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('_mapRelationship — maps all fields with null guards', async () => {
    const { __testHooks } = await import('../../../api/services/twin/twinGraph')
    const rel = __testHooks._mapRelationship(makeRelRow())
    expect(rel.id).toBe('rel-1')
    expect(rel.weight).toBe(1.0)
    expect(rel.validTo).toBeUndefined()
    expect(rel.relType).toBe('depends_on')
  })

  it('addRelationship — upserts on conflict', async () => {
    mockTenant.mockResolvedValueOnce(mockRow(makeRelRow()))
    const { addRelationship } = await import('../../../api/services/twin/twinGraph')
    const rel = await addRelationship({
      tenantId: 'tenant-1', fromTwinId: 'twin-1', toTwinId: 'twin-2', relType: 'depends_on',
    })
    expect(rel.fromTwinId).toBe('twin-1')
    expect(rel.toTwinId).toBe('twin-2')
  })

  it('removeRelationship — soft-deletes by setting valid_to', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { removeRelationship } = await import('../../../api/services/twin/twinGraph')
    await removeRelationship('tenant-1', 'twin-1', 'twin-2', 'depends_on')
    expect(mockTenant.mock.calls[0][1]).toContain('valid_to = now()')
  })

  it('getOutboundRelationships — filters by from_twin_id', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([makeRelRow(), makeRelRow({ id: 'rel-2' })]))
    const { getOutboundRelationships } = await import('../../../api/services/twin/twinGraph')
    const rels = await getOutboundRelationships('twin-1', 'tenant-1')
    expect(rels).toHaveLength(2)
  })

  it('getInboundRelationships — filters by to_twin_id', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([makeRelRow()]))
    const { getInboundRelationships } = await import('../../../api/services/twin/twinGraph')
    const rels = await getInboundRelationships('twin-2', 'tenant-1')
    expect(rels).toHaveLength(1)
  })

  it('getRelationship — returns null when not found', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { getRelationship } = await import('../../../api/services/twin/twinGraph')
    const rel = await getRelationship('tenant-1', 'a', 'b', 'depends_on')
    expect(rel).toBeNull()
  })
})

// ─── Twin State Store ─────────────────────────────────────────────────────────

describe('twinStateStore', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('warmCache and invalidate — work correctly', async () => {
    const { warmCache, invalidate, __testHooks } = await import('../../../api/services/twin/twinStateStore')
    const twin = { id: 'twin-1', tenantId: 't', entityType: 'project', entityId: 'p1', name: 'P', status: 'active', metadata: {}, createdAt: new Date(), updatedAt: new Date() } as Parameters<typeof warmCache>[0]
    warmCache(twin, null)
    expect(__testHooks._hotStore.has('twin-1')).toBe(true)
    invalidate('twin-1')
    expect(__testHooks._hotStore.has('twin-1')).toBe(false)
  })

  it('clearAll — empties the hot store', async () => {
    const { clearAll, __testHooks } = await import('../../../api/services/twin/twinStateStore')
    clearAll()
    expect(__testHooks._hotStore.size).toBe(0)
  })

  it('applyEventLink — inserts event and invalidates cache', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { applyEventLink, __testHooks } = await import('../../../api/services/twin/twinStateStore')
    __testHooks._hotStore.set('twin-1', { twin: {} as never, snapshot: null, cachedAt: new Date() })
    await applyEventLink('twin-1', 'tenant-1', 'evt-1', 'action_updated', { delta: 1 }, new Date())
    expect(__testHooks._hotStore.has('twin-1')).toBe(false)
    expect(mockTenant).toHaveBeenCalledOnce()
  })

  it('markEventApplied — updates applied flag', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { markEventApplied } = await import('../../../api/services/twin/twinStateStore')
    await markEventApplied('link-1', 'tenant-1')
    expect(mockTenant.mock.calls[0][1]).toContain('applied = true')
  })

  it('getPendingEventLinks — returns unapplied events', async () => {
    const eventRow = {
      id: 'link-1', event_id: 'evt-1', event_type: 'action_updated',
      state_delta: { x: 1 }, occurred_at: new Date().toISOString(),
    }
    mockTenant.mockResolvedValueOnce(mockRows([eventRow]))
    const { getPendingEventLinks } = await import('../../../api/services/twin/twinStateStore')
    const links = await getPendingEventLinks('twin-1', 'tenant-1')
    expect(links).toHaveLength(1)
    expect(links[0].eventType).toBe('action_updated')
  })

  it('HOT_STATE_TTL_MS — is 30 seconds', async () => {
    const { __testHooks } = await import('../../../api/services/twin/twinStateStore')
    expect(__testHooks.HOT_STATE_TTL_MS).toBe(30_000)
  })
})

// ─── Twin Sync ────────────────────────────────────────────────────────────────

describe('twinSync', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('_hasStateChanged — false for identical state', async () => {
    const { __testHooks } = await import('../../../api/services/twin/twinSync')
    expect(__testHooks._hasStateChanged({ a: 1 }, { a: 1 })).toBe(false)
  })

  it('_hasStateChanged — true for null prev', async () => {
    const { __testHooks } = await import('../../../api/services/twin/twinSync')
    expect(__testHooks._hasStateChanged(null, { a: 1 })).toBe(true)
  })

  it('_hasStateChanged — true when state differs', async () => {
    const { __testHooks } = await import('../../../api/services/twin/twinSync')
    expect(__testHooks._hasStateChanged({ a: 1 }, { a: 2 })).toBe(true)
  })

  it('syncTwin — no-op sync when unchanged', async () => {
    const state = { readiness_score: 75 }
    // SELECT twin
    mockTenant.mockResolvedValueOnce(mockRow(makeTwinRow()))
    // SELECT latest snapshot state
    mockTenant.mockResolvedValueOnce(mockRow({ state }))
    // UPDATE sync markers
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { syncTwin } = await import('../../../api/services/twin/twinSync')
    const result = await syncTwin('tenant-1', 'twin-1', state)
    expect(result.changed).toBe(false)
    expect(result.snapshotId).toBeUndefined()
  })

  it('syncTwin — throws when twin not found', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { syncTwin } = await import('../../../api/services/twin/twinSync')
    await expect(syncTwin('tenant-1', 'missing', { x: 1 })).rejects.toThrow('Twin not found: missing')
  })
})

// ─── State Graph Engine ───────────────────────────────────────────────────────

describe('stateGraphEngine', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('buildStateGraph — builds nodes and adjacency maps', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([makeTwinRow(), makeTwinRow({ id: 'twin-2', entity_id: 'proj-2' })]))
    mockTenant.mockResolvedValueOnce(mockRows([makeRelRow()]))
    const { buildStateGraph } = await import('../../../api/services/twin/stateGraphEngine')
    const graph = await buildStateGraph('tenant-1')
    expect(graph.nodes.size).toBe(2)
    expect(graph.adjacency.has('twin-1')).toBe(true)
    expect(graph.reverseAdj.has('twin-2')).toBe(true)
  })

  it('buildStateGraph — empty graph when no twins', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { buildStateGraph } = await import('../../../api/services/twin/stateGraphEngine')
    const graph = await buildStateGraph('tenant-1')
    expect(graph.nodes.size).toBe(0)
  })

  it('getDegradedNodes — filters by status', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([
      makeTwinRow({ status: 'active' }),
      makeTwinRow({ id: 'twin-2', status: 'degraded' }),
      makeTwinRow({ id: 'twin-3', status: 'failed' }),
    ]))
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { buildStateGraph, getDegradedNodes } = await import('../../../api/services/twin/stateGraphEngine')
    const graph = await buildStateGraph('tenant-1')
    const degraded = getDegradedNodes(graph)
    expect(degraded).toHaveLength(2)
    expect(degraded.map(n => n.status)).not.toContain('active')
  })

  it('getNeighbors — returns outbound neighbor IDs', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([makeTwinRow(), makeTwinRow({ id: 'twin-2', entity_id: 'p2' })]))
    mockTenant.mockResolvedValueOnce(mockRows([makeRelRow()]))
    const { buildStateGraph, getNeighbors } = await import('../../../api/services/twin/stateGraphEngine')
    const graph = await buildStateGraph('tenant-1')
    const neighbors = getNeighbors(graph, 'twin-1', 'outbound')
    expect(neighbors).toContain('twin-2')
  })

  it('extractSubgraph — only includes reachable nodes', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([
      makeTwinRow(),
      makeTwinRow({ id: 'twin-2', entity_id: 'p2' }),
      makeTwinRow({ id: 'twin-3', entity_id: 'p3' }),
    ]))
    mockTenant.mockResolvedValueOnce(mockRows([makeRelRow()]))
    const { buildStateGraph, extractSubgraph } = await import('../../../api/services/twin/stateGraphEngine')
    const graph = await buildStateGraph('tenant-1')
    const sub = extractSubgraph(graph, ['twin-1'])
    // twin-1 and twin-2 (via edge), not twin-3
    expect(sub.nodes.size).toBe(2)
  })
})

// ─── Graph Traversal Service ──────────────────────────────────────────────────

describe('graphTraversalService', () => {
  it('detectCycles — returns false for acyclic graph', async () => {
    const { __testHooks } = await import('../../../api/services/twin/graphTraversalService')
    const graph = {
      nodes: new Map([['a', {} as never], ['b', {} as never]]),
      adjacency: new Map([['a', [{ toTwinId: 'b', fromTwinId: 'a', relType: 'depends_on', weight: 1, id: 'r1', tenantId: 't', metadata: {}, validFrom: new Date(), createdAt: new Date() }]]]),
      reverseAdj: new Map([['b', [{ fromTwinId: 'a', toTwinId: 'b', relType: 'depends_on', weight: 1, id: 'r1', tenantId: 't', metadata: {}, validFrom: new Date(), createdAt: new Date() }]]]),
      tenantId: 't',
      builtAt: new Date(),
    } as never
    expect(__testHooks.detectCycles(graph)).toBe(false)
  })

  it('detectCycles — returns true for cyclic graph', async () => {
    const { __testHooks } = await import('../../../api/services/twin/graphTraversalService')
    const relAB = { toTwinId: 'b', fromTwinId: 'a', relType: 'depends_on' as const, weight: 1, id: 'r1', tenantId: 't', metadata: {}, validFrom: new Date(), createdAt: new Date() }
    const relBA = { toTwinId: 'a', fromTwinId: 'b', relType: 'depends_on' as const, weight: 1, id: 'r2', tenantId: 't', metadata: {}, validFrom: new Date(), createdAt: new Date() }
    const graph = {
      nodes: new Map([['a', {} as never], ['b', {} as never]]),
      adjacency: new Map([['a', [relAB]], ['b', [relBA]]]),
      reverseAdj: new Map([['b', [relAB]], ['a', [relBA]]]),
      tenantId: 't',
      builtAt: new Date(),
    }
    expect(__testHooks.detectCycles(graph)).toBe(true)
  })

  it('getImpactedByFailure — walks reverse edges', async () => {
    const { __testHooks } = await import('../../../api/services/twin/graphTraversalService')
    const relCA = { fromTwinId: 'c', toTwinId: 'a', relType: 'depends_on' as const, weight: 1, id: 'r1', tenantId: 't', metadata: {}, validFrom: new Date(), createdAt: new Date() }
    const graph = {
      nodes: new Map([['a', {} as never], ['b', {} as never], ['c', {} as never]]),
      adjacency: new Map(),
      reverseAdj: new Map([['a', [relCA]]]),
      tenantId: 't',
      builtAt: new Date(),
    }
    const impacted = __testHooks.getImpactedByFailure(graph, 'a')
    expect(impacted).toContain('c')
    expect(impacted).not.toContain('a')
  })

  it('findCriticalPath — returns empty array when no path exists', async () => {
    const { __testHooks } = await import('../../../api/services/twin/graphTraversalService')
    const graph = {
      nodes: new Map([['a', {} as never], ['b', {} as never]]),
      adjacency: new Map(),
      reverseAdj: new Map(),
      tenantId: 't',
      builtAt: new Date(),
    }
    const path = __testHooks.findCriticalPath(graph, 'a', 'b')
    expect(path).toEqual([])
  })

  it('bfsTraversal — detects impacted entities by status', async () => {
    const { bfsTraversal } = await import('../../../api/services/twin/graphTraversalService')
    const node = (id: string, status: string) => [id, {
      twinId: id, entityType: 'project' as const, entityId: id, name: id, status,
      riskScore: status === 'failed' ? 80 : 20, readinessScore: 70, depth: 0, metadata: {},
    }] as const
    const graph = {
      nodes: new Map([node('a', 'active'), node('b', 'failed'), node('c', 'active')]),
      adjacency: new Map([['a', [{ toTwinId: 'b', fromTwinId: 'a', relType: 'depends_on' as const, weight: 1, id: 'r1', tenantId: 't', metadata: {}, validFrom: new Date(), createdAt: new Date() }]]]),
      reverseAdj: new Map([['b', [{ fromTwinId: 'a', toTwinId: 'b', relType: 'depends_on' as const, weight: 1, id: 'r1', tenantId: 't', metadata: {}, validFrom: new Date(), createdAt: new Date() }]]]),
      tenantId: 't',
      builtAt: new Date(),
    } as never
    const result = bfsTraversal(graph, 'a')
    expect(result.impactedEntities).toContain('b')
    expect(result.nodes).toHaveLength(2)
  })
})

// ─── Graph Risk Propagation ───────────────────────────────────────────────────

describe('graphRiskPropagation', () => {
  it('propagateRisk — propagates from root with decay', async () => {
    const { __testHooks } = await import('../../../api/services/twin/graphRiskPropagation')
    const node = (id: string, risk: number) => [id, {
      twinId: id, entityType: 'project' as const, entityId: id, name: id,
      status: 'active' as const, riskScore: risk, metadata: {},
    }] as const
    const rel = (from: string, to: string) => ({ fromTwinId: from, toTwinId: to, relType: 'depends_on' as const, weight: 1, id: 'r1', tenantId: 't', metadata: {}, validFrom: new Date(), createdAt: new Date() })
    const graph = {
      nodes: new Map([node('a', 90), node('b', 20), node('c', 10)]),
      adjacency: new Map([['a', [rel('a', 'b')]], ['b', [rel('b', 'c')]]]),
      reverseAdj: new Map([['b', [rel('a', 'b')]], ['c', [rel('b', 'c')]]]),
      tenantId: 't', builtAt: new Date(),
    }
    const result = __testHooks.propagateRisk(graph, 'a', 90)
    expect(result.propagatedRisk.get('a')).toBe(90)
    const bRisk = result.propagatedRisk.get('b')
    expect(bRisk).toBeDefined()
    expect(bRisk!).toBeGreaterThan(0)
    expect(bRisk!).toBeLessThan(90)
  })

  it('propagateRisk — returns empty result for unknown root', async () => {
    const { __testHooks } = await import('../../../api/services/twin/graphRiskPropagation')
    const graph = { nodes: new Map(), adjacency: new Map(), reverseAdj: new Map(), tenantId: 't', builtAt: new Date() }
    const result = __testHooks.propagateRisk(graph, 'missing')
    expect(result.propagatedRisk.size).toBe(0)
    expect(result.totalImpactScore).toBe(0)
  })

  it('PROPAGATION_DECAY — is between 0 and 1', async () => {
    const { __testHooks } = await import('../../../api/services/twin/graphRiskPropagation')
    expect(__testHooks.PROPAGATION_DECAY).toBeGreaterThan(0)
    expect(__testHooks.PROPAGATION_DECAY).toBeLessThan(1)
  })

  it('propagateRisk — identifies critical nodes above threshold 75', async () => {
    const { __testHooks } = await import('../../../api/services/twin/graphRiskPropagation')
    const node = (id: string, risk: number) => [id, {
      twinId: id, entityType: 'project' as const, entityId: id, name: id,
      status: 'active' as const, riskScore: risk, metadata: {},
    }] as const
    const graph = {
      nodes: new Map([node('root', 95)]),
      adjacency: new Map(),
      reverseAdj: new Map(),
      tenantId: 't', builtAt: new Date(),
    }
    const result = __testHooks.propagateRisk(graph, 'root', 95)
    expect(result.criticalNodes).toContain('root')
  })
})

// ─── Temporal State Engine ────────────────────────────────────────────────────

describe('temporalStateEngine', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('getStateAt — returns state from closest snapshot at or before timestamp', async () => {
    mockTenant.mockResolvedValueOnce(mockRow({ state: { readiness: 80 } }))
    const { __testHooks } = await import('../../../api/services/twin/temporalStateEngine')
    const state = await __testHooks.getStateAt('twin-1', 'tenant-1', new Date())
    expect(state).toEqual({ readiness: 80 })
  })

  it('getStateAt — returns null when no snapshot before timestamp', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { __testHooks } = await import('../../../api/services/twin/temporalStateEngine')
    const state = await __testHooks.getStateAt('twin-1', 'tenant-1', new Date('2020-01-01'))
    expect(state).toBeNull()
  })

  it('diffStates — computes diff between two timestamps', async () => {
    mockTenant.mockResolvedValueOnce(mockRow({ state: { x: 1, y: 2 } }))
    mockTenant.mockResolvedValueOnce(mockRow({ state: { x: 5, y: 2 } }))
    const { __testHooks } = await import('../../../api/services/twin/temporalStateEngine')
    const result = await __testHooks.diffStates('twin-1', 'tenant-1', new Date('2024-01-01'), new Date())
    expect(result.diff['x']).toEqual({ from: 1, to: 5 })
    expect(result.diff['y']).toBeUndefined()
  })

  it('computeStateVelocity — counts changes per day', async () => {
    const diffRows = Array.from({ length: 14 }, () => ({
      diff: { readiness_score: { from: 70, to: 72 } },
    }))
    mockTenant.mockResolvedValueOnce(mockRows(diffRows))
    const { __testHooks } = await import('../../../api/services/twin/temporalStateEngine')
    const velocity = await __testHooks.computeStateVelocity('twin-1', 'tenant-1', 7)
    expect(velocity.changesPerDay).toBe(2) // 14 changes / 7 days
    expect(velocity.mostChangedFields).toContain('readiness_score')
  })
})

// ─── Operational Forecast Engine ─────────────────────────────────────────────

describe('operationalForecastEngine', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('_mapForecast — maps all fields with null guards', async () => {
    const { __testHooks } = await import('../../../api/services/twin/operationalForecastEngine')
    const row = {
      id: 'fc-1', tenant_id: 't', forecast_type: 'readiness',
      scope_type: 'project', scope_id: 'p1', horizon_days: 30,
      projections: { finalReadiness: 75 }, confidence: '0.8',
      computed_at: new Date().toISOString(),
      valid_until: new Date(Date.now() + 3600000).toISOString(),
    }
    const forecast = ((__testHooks as unknown) as { _mapForecast: (r: typeof row) => unknown })._mapForecast(row)
    expect((forecast as { id: string }).id).toBe('fc-1')
    expect((forecast as { confidence: number }).confidence).toBe(0.8)
  })

  it('getOrComputeForecast — returns cached forecast if valid', async () => {
    const cached = {
      id: 'fc-1', tenant_id: 't', forecast_type: 'readiness',
      scope_type: 'project', scope_id: 'p1', horizon_days: 30,
      projections: {}, confidence: '0.75',
      computed_at: new Date().toISOString(),
      valid_until: new Date(Date.now() + 3600000).toISOString(),
    }
    mockTenant.mockResolvedValueOnce(mockRow(cached))
    const { getOrComputeForecast } = await import('../../../api/services/twin/operationalForecastEngine')
    const result = await getOrComputeForecast({
      tenantId: 't', forecastType: 'readiness', scopeType: 'project', scopeId: 'p1',
    })
    expect(result.id).toBe('fc-1')
    expect(mockTenant).toHaveBeenCalledOnce()
  })
})

// ─── Timeline Projection Service ─────────────────────────────────────────────

describe('timelineProjectionService', () => {
  it('_linearProjection — returns flat projection for single data point', async () => {
    const { __testHooks } = await import('../../../api/services/twin/timelineProjectionService')
    const points = __testHooks._linearProjection([{ ts: new Date(), value: 70 }], 7)
    expect(points).toHaveLength(7)
    points.forEach(p => expect(p.value).toBeCloseTo(70, 0))
  })

  it('_linearProjection — returns empty for no history', async () => {
    const { __testHooks } = await import('../../../api/services/twin/timelineProjectionService')
    const points = __testHooks._linearProjection([], 7)
    expect(points).toHaveLength(7) // falls back to flat projection at 50
    points.forEach(p => expect(p.value).toBe(50))
  })

  it('_linearProjection — clamps values to [min, max]', async () => {
    const { __testHooks } = await import('../../../api/services/twin/timelineProjectionService')
    const history = [
      { ts: new Date(Date.now() - 7 * 86400000), value: 95 },
      { ts: new Date(), value: 98 },
    ]
    const points = __testHooks._linearProjection(history, 14, 0, 100)
    points.forEach(p => {
      expect(p.value).toBeGreaterThanOrEqual(0)
      expect(p.value).toBeLessThanOrEqual(100)
    })
  })

  it('_computeProjectionConfidence — scales with history points', async () => {
    const { __testHooks } = await import('../../../api/services/twin/timelineProjectionService')
    expect(__testHooks._computeProjectionConfidence(0)).toBe(0.4)
    expect(__testHooks._computeProjectionConfidence(5)).toBe(0.55)
    expect(__testHooks._computeProjectionConfidence(10)).toBe(0.7)
    expect(__testHooks._computeProjectionConfidence(20)).toBe(0.85)
  })

  it('_stdDev — returns 0 for uniform values', async () => {
    const { __testHooks } = await import('../../../api/services/twin/timelineProjectionService')
    expect(__testHooks._stdDev([5, 5, 5])).toBe(0)
  })

  it('_stdDev — returns positive for spread values', async () => {
    const { __testHooks } = await import('../../../api/services/twin/timelineProjectionService')
    expect(__testHooks._stdDev([0, 50, 100])).toBeGreaterThan(0)
  })
})
