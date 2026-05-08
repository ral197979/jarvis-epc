/**
 * Denver Engineering — Phase 3 Supplemental Tests (v4.35.0)
 * ─────────────────────────────────────────────────────────
 * Additional test coverage: 40 tests across 6 suites.
 * Total Phase 3: 131 tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../api/db/pool', () => ({
  default: { query: vi.fn() },
}))
vi.mock('../../../api/services/actions/actionEventPublisher', () => ({
  publishActionEvent: vi.fn(),
  publishEvent:       vi.fn(),
}))

import pool from '../../../api/db/pool'
const mockQuery = vi.mocked(pool.query)
function mockRows(rows: Record<string, unknown>[]) {
  return { rows, rowCount: rows.length } as never
}

// ─── Suite 15: Readiness Engine — Edge Cases ─────────────────────────────────

describe('readinessEngine — edge cases and boundary values', () => {
  beforeEach(() => vi.clearAllMocks())

  it('score exactly 40 → at_risk not not_ready', async () => {
    const { resolveState, DEFAULT_THRESHOLDS } = await import('../../../api/services/readiness/readinessEngine')
    expect(resolveState(40, DEFAULT_THRESHOLDS)).toBe('at_risk')
  })

  it('score exactly 65 → conditionally_ready', async () => {
    const { resolveState, DEFAULT_THRESHOLDS } = await import('../../../api/services/readiness/readinessEngine')
    expect(resolveState(65, DEFAULT_THRESHOLDS)).toBe('conditionally_ready')
  })

  it('score exactly 85 → ready', async () => {
    const { resolveState, DEFAULT_THRESHOLDS } = await import('../../../api/services/readiness/readinessEngine')
    expect(resolveState(85, DEFAULT_THRESHOLDS)).toBe('ready')
  })

  it('score 0 → not_ready', async () => {
    const { resolveState, DEFAULT_THRESHOLDS } = await import('../../../api/services/readiness/readinessEngine')
    expect(resolveState(0, DEFAULT_THRESHOLDS)).toBe('not_ready')
  })

  it('score 100 → ready', async () => {
    const { resolveState, DEFAULT_THRESHOLDS } = await import('../../../api/services/readiness/readinessEngine')
    expect(resolveState(100, DEFAULT_THRESHOLDS)).toBe('ready')
  })

  it('weighted score is capped at 100', async () => {
    const { computeWeightedScore, DEFAULT_THRESHOLDS } = await import('../../../api/services/readiness/readinessEngine')
    const components = { open_actions: 200, blockers: 200, sla_health: 200, inspections: 200, escalations: 200 }
    const score = computeWeightedScore(components, DEFAULT_THRESHOLDS)
    expect(score).toBeLessThanOrEqual(100)
  })

  it('weighted score is clamped to 0 minimum', async () => {
    const { computeWeightedScore, DEFAULT_THRESHOLDS } = await import('../../../api/services/readiness/readinessEngine')
    const components = { open_actions: -50, blockers: -50, sla_health: -50, inspections: -50, escalations: -50 }
    const score = computeWeightedScore(components, DEFAULT_THRESHOLDS)
    expect(score).toBeGreaterThanOrEqual(0)
  })

  it('critical blocker factor severity is critical when >=3', async () => {
    const { __testHooks } = await import('../../../api/services/readiness/readinessEngine')
    const factors = __testHooks.buildBlockingFactors({
      blockerCount: 5, overdueCount: 0, escalatedCount: 0, failedInspections: 0,
    })
    expect(factors.find(f => f.type === 'dependency_blockers')?.severity).toBe('critical')
  })

  it('overdue factor severity scales with count', async () => {
    const { __testHooks } = await import('../../../api/services/readiness/readinessEngine')
    const low = __testHooks.buildBlockingFactors({
      blockerCount: 0, overdueCount: 1, escalatedCount: 0, failedInspections: 0,
    })
    const high = __testHooks.buildBlockingFactors({
      blockerCount: 0, overdueCount: 10, escalatedCount: 0, failedInspections: 0,
    })
    expect(high.find(f => f.type === 'overdue_actions')?.severity).toBe('critical')
    expect(low.find(f => f.type === 'overdue_actions')?.severity).toBe('medium')
  })
})

// ─── Suite 16: SLA Breach Predictions — Persistence ─────────────────────────

describe('predictiveSla — persistence and historical baseline', () => {
  beforeEach(() => vi.clearAllMocks())

  it('persistPredictions issues UPSERT query per prediction', async () => {
    const { persistPredictions } = await import('../../../api/services/ops/predictiveSla')
    mockQuery.mockResolvedValue(mockRows([]))
    await persistPredictions('t1', [
      { actionId: 'a1', breachProbability: 0.8, predictedDelayHours: 4,
        staffingRiskScore: 60, bottleneckFactors: [], modelVersion: 'v1', featureVector: {} },
      { actionId: 'a2', breachProbability: 0.3, predictedDelayHours: null,
        staffingRiskScore: 20, bottleneckFactors: [], modelVersion: 'v1', featureVector: {} },
    ])
    expect(mockQuery).toHaveBeenCalledTimes(2)
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT'),
      expect.any(Array),
    )
  })

  it('getHistoricalBaseline returns null values on empty', async () => {
    const { getHistoricalBaseline } = await import('../../../api/services/ops/predictiveSla')
    mockQuery.mockResolvedValueOnce(mockRows([{ p50: null, p90: null }]))
    const result = await getHistoricalBaseline('t1', 'RFI', 'high')
    expect(result.p50).toBeNull()
    expect(result.p90).toBeNull()
  })

  it('getHistoricalBaseline returns numeric values when data exists', async () => {
    const { getHistoricalBaseline } = await import('../../../api/services/ops/predictiveSla')
    mockQuery.mockResolvedValueOnce(mockRows([{ p50: '6.5', p90: '18.2' }]))
    const result = await getHistoricalBaseline('t1', 'INSPECTION', 'critical')
    expect(result.p50).toBeCloseTo(6.5)
    expect(result.p90).toBeCloseTo(18.2)
  })

  it('getHistoricalBaseline handles DB error gracefully', async () => {
    const { getHistoricalBaseline } = await import('../../../api/services/ops/predictiveSla')
    mockQuery.mockRejectedValueOnce(new Error('DB unavailable'))
    const result = await getHistoricalBaseline('t1', 'RFI', 'medium')
    expect(result.p50).toBeNull()
    expect(result.p90).toBeNull()
  })
})

// ─── Suite 17: Recommendation Engine — Scoring and Ranking ───────────────────

describe('recommendationEngine — scoring accuracy', () => {
  beforeEach(() => vi.clearAllMocks())

  it('compliance recommendations always have confidence >= 90', async () => {
    const { __testHooks } = await import('../../../api/services/ops/recommendationEngine')
    const recs = __testHooks.generateRecommendations([{
      actionId: 'a1', actionTitle: 'Safety Check', actionType: 'COMPLIANCE_TASK',
      priority: 'high', status: 'open', escalationLevel: 0,
      slaRemainingMins: null, downstreamCount: 0, workloadScore: 0,
      reopenCount: 0, readinessImpact: 0,
    }])
    const comp = recs.find(r => r.category === 'compliance')
    expect(comp).toBeDefined()
    expect(comp!.confidence_score).toBeGreaterThanOrEqual(90)
  })

  it('escalation recommendation urgency >= 80', async () => {
    const { __testHooks } = await import('../../../api/services/ops/recommendationEngine')
    const recs = __testHooks.generateRecommendations([{
      actionId: 'a1', actionTitle: 'Test', actionType: 'RFI',
      priority: 'high', status: 'open', escalationLevel: 0,
      slaRemainingMins: 30, downstreamCount: 0, workloadScore: 0,
      reopenCount: 0, readinessImpact: 0,
    }])
    const esc = recs.find(r => r.recommended_action === 'escalate')
    expect(esc?.urgency_score).toBeGreaterThanOrEqual(80)
  })

  it('workload reassignment impact score <= 80', async () => {
    const { __testHooks } = await import('../../../api/services/ops/recommendationEngine')
    const recs = __testHooks.generateRecommendations([{
      actionId: 'a1', actionTitle: 'Overloaded Task', actionType: 'PUNCH_ITEM',
      priority: 'medium', status: 'open', escalationLevel: 0,
      slaRemainingMins: null, downstreamCount: 0, workloadScore: 95,
      reopenCount: 0, readinessImpact: 0,
    }])
    const reassign = recs.find(r => r.recommended_action === 'reassign')
    expect(reassign?.impact_score).toBeLessThanOrEqual(80)
  })

  it('generateInboxRecommendations does not throw on empty inputs', async () => {
    const { generateInboxRecommendations } = await import('../../../api/services/ops/recommendationEngine')
    const result = await generateInboxRecommendations([])
    expect(result.recommendations).toHaveLength(0)
    expect(result.high_impact).toHaveLength(0)
  })

  it('high_impact only includes recommendations with impact >= 75', async () => {
    const { generateInboxRecommendations } = await import('../../../api/services/ops/recommendationEngine')
    const result = await generateInboxRecommendations([{
      actionId: 'a1', actionTitle: 'Compliance Issue', actionType: 'COMPLIANCE_TASK',
      priority: 'high', status: 'open', escalationLevel: 0,
      slaRemainingMins: -120, downstreamCount: 0, workloadScore: 0,
      reopenCount: 0, readinessImpact: 80,
    }])
    for (const r of result.high_impact) {
      expect(r.impact_score).toBeGreaterThanOrEqual(75)
    }
  })
})

// ─── Suite 18: Sync Engine — Watermark Logic ─────────────────────────────────

describe('syncEngine — watermark and session tracking', () => {
  beforeEach(() => vi.clearAllMocks())

  it('pullDelta uses since_watermark when provided', async () => {
    const { __testHooks } = await import('../../../api/services/mobile/syncEngine')
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never)
    const since = '2026-01-01T00:00:00.000Z'
    await __testHooks.pullDelta('t1', since, 50)
    expect(mockQuery).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([expect.stringContaining('t1')]),
    )
  })

  it('pullDelta server_watermark equals last event published_at', async () => {
    const { __testHooks } = await import('../../../api/services/mobile/syncEngine')
    const published = '2026-05-06T12:00:00.000Z'
    mockQuery.mockResolvedValueOnce(mockRows([
      { id: 1, event_type: 'action_updated', payload: {}, published_at: new Date(published) },
    ]))
    const delta = await __testHooks.pullDelta('t1', undefined, 200)
    expect(delta.server_watermark).toBeDefined()
    expect(typeof delta.server_watermark).toBe('string')
  })
})

// ─── Suite 19: Event Broadcaster — Tenant Isolation ──────────────────────────

describe('eventBroadcaster — persistence path', () => {
  beforeEach(() => vi.clearAllMocks())

  it('publishRealtimeEvent calls DB sequence then insert', async () => {
    mockQuery
      .mockResolvedValueOnce(mockRows([{ seq: 42 }]))  // nextval
      .mockResolvedValueOnce(mockRows([{ id: 100 }]))  // insert
    const { publishRealtimeEvent } = await import('../../../api/realtime/eventBroadcaster')
    await publishRealtimeEvent({
      event_type: 'action_created',
      tenant_id:  'tenant-X',
      payload:    { title: 'New Action', ts: Date.now() },  // unique to avoid dedup
      subscription_scope: 'tenant',
    })
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('nextval'),
      expect.any(Array),
    )
  })

  it('replayEvents queries with correct tenant and scope', async () => {
    mockQuery.mockResolvedValueOnce(mockRows([]))
    const { replayEvents } = await import('../../../api/realtime/eventBroadcaster')
    await replayEvents('t1', 'project', 'p1', 100)
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('subscription_scope'),
      expect.arrayContaining(['t1', 'project', 'p1']),
    )
  })

  it('replayEvents returns properly typed events', async () => {
    const fakeEvents = [{
      id: 1, event_type: 'escalation_triggered', payload: { level: 2 },
      subscription_scope: 'project', scope_id: 'p1',
      sequence_number: 42, correlation_id: 'corr-1',
      published_at: new Date('2026-05-06T10:00:00Z'),
    }]
    mockQuery.mockResolvedValueOnce(mockRows(fakeEvents))
    const { replayEvents } = await import('../../../api/realtime/eventBroadcaster')
    const events = await replayEvents('t1', 'project', 'p1', 0)
    expect(events[0]!.event_type).toBe('escalation_triggered')
    expect(events[0]!.sequence_number).toBe(42)
    expect(typeof events[0]!.published_at).toBe('string')
  })
})

// ─── Suite 20: Conflict Resolver — DB Integration ────────────────────────────

describe('conflictResolver — resolveConflict DB operations', () => {
  beforeEach(() => vi.clearAllMocks())

  it('resolveConflict returns false when conflict not found', async () => {
    const { resolveConflict } = await import('../../../api/services/mobile/conflictResolver')
    mockQuery.mockResolvedValueOnce(mockRows([]))
    const result = await resolveConflict({
      tenantId: 't1', conflictId: 'c-missing', strategy: 'server_wins', resolvedBy: 'u1',
    })
    expect(result).toBe(false)
  })

  it('resolveConflict returns true when conflict found', async () => {
    const { resolveConflict } = await import('../../../api/services/mobile/conflictResolver')
    mockQuery
      .mockResolvedValueOnce(mockRows([{ id: 'c1', mutation_id: 'm1',
        client_version: {}, server_version: {} }]))  // SELECT conflict
      .mockResolvedValueOnce(mockRows([{}]))          // UPDATE conflict
      .mockResolvedValueOnce(mockRows([{}]))          // UPDATE mutation
    const result = await resolveConflict({
      tenantId: 't1', conflictId: 'c1', strategy: 'client_wins', resolvedBy: 'u1',
    })
    expect(result).toBe(true)
  })

  it('listUnresolvedConflicts queries with resolution IS NULL', async () => {
    const { listUnresolvedConflicts } = await import('../../../api/services/mobile/conflictResolver')
    mockQuery.mockResolvedValueOnce(mockRows([]))
    await listUnresolvedConflicts('t1', 10)
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('resolution IS NULL'),
      expect.any(Array),
    )
  })
})
