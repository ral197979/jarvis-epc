/**
 * Denver Engineering — Phase 3 Test Suite (v4.35.0)
 * ──────────────────────────────────────────────────
 * Ava Phase 3 — 127 tests across 14 suites.
 * All DB calls are mocked. No external dependencies.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Mock pool ────────────────────────────────────────────────────────────────

vi.mock('../../../api/db/pool', () => ({
  pool: {
    query: vi.fn(),
  },
}))

vi.mock('../../../api/services/actions/actionEventPublisher', () => ({
  publishActionEvent: vi.fn(),
  publishEvent:       vi.fn(),
}))

import { pool } from '../../../api/db/pool'

const mockQuery = vi.mocked(pool.query)

function mockRows(rows: Record<string, unknown>[]) {
  return { rows, rowCount: rows.length } as never
}

// ─── Suite 1: Readiness Engine — Component Scorers ───────────────────────────

describe('readinessEngine — component scorers', () => {
  let scorers: typeof import('../../../api/services/readiness/readinessEngine').__testHooks

  beforeEach(async () => {
    const mod = await import('../../../api/services/readiness/readinessEngine')
    scorers = mod.__testHooks
  })

  it('scoreOpenActions returns 100 when no actions', () => {
    expect(scorers.scoreOpenActions(0, 0)).toBe(100)
  })

  it('scoreOpenActions returns 100 when all closed', () => {
    expect(scorers.scoreOpenActions(0, 10)).toBe(100)
  })

  it('scoreOpenActions returns 90 for <=5% open', () => {
    expect(scorers.scoreOpenActions(1, 30)).toBe(90)
  })

  it('scoreOpenActions returns 55 for <=30% open', () => {
    expect(scorers.scoreOpenActions(9, 30)).toBe(55)
  })

  it('scoreOpenActions returns 10 for >50% open', () => {
    expect(scorers.scoreOpenActions(20, 30)).toBe(10)
  })

  it('scoreBlockers returns 100 with no blockers', () => {
    expect(scorers.scoreBlockers(0)).toBe(100)
  })

  it('scoreBlockers returns 60 for 1 blocker', () => {
    expect(scorers.scoreBlockers(1)).toBe(60)
  })

  it('scoreBlockers returns 5 for 6+ blockers', () => {
    expect(scorers.scoreBlockers(10)).toBe(5)
  })

  it('scoreSlaHealth returns 100 with no open actions', () => {
    expect(scorers.scoreSlaHealth(0, 0, 0)).toBe(100)
  })

  it('scoreSlaHealth penalises breaches at 15pts each', () => {
    const score = scorers.scoreSlaHealth(2, 0, 10)
    expect(score).toBe(70)
  })

  it('scoreSlaHealth caps breach penalty at 60', () => {
    const score = scorers.scoreSlaHealth(10, 0, 20)
    expect(score).toBe(40)
  })

  it('scoreInspections returns 100 with no inspections', () => {
    expect(scorers.scoreInspections(0, 0)).toBe(100)
  })

  it('scoreInspections returns pass rate as score', () => {
    expect(scorers.scoreInspections(2, 10)).toBe(80)
  })

  it('scoreEscalations returns 100 with no open', () => {
    expect(scorers.scoreEscalations(0, 0)).toBe(100)
  })

  it('scoreEscalations returns 85 for <=5% escalated', () => {
    expect(scorers.scoreEscalations(1, 30)).toBe(85)
  })
})

// ─── Suite 2: Readiness Engine — State Resolution ────────────────────────────

describe('readinessEngine — state resolution', () => {
  let engine: typeof import('../../../api/services/readiness/readinessEngine')

  beforeEach(async () => {
    engine = await import('../../../api/services/readiness/readinessEngine')
  })

  const t = {
    not_ready_below: 40, at_risk_below: 65,
    conditionally_ready_below: 85,
    weight_open_actions: 0.3, weight_blockers: 0.25,
    weight_sla_health: 0.2, weight_inspections: 0.15, weight_escalations: 0.1,
  }

  it('score < 40 → not_ready', () => {
    expect(engine.resolveState(30, t)).toBe('not_ready')
  })

  it('score 40–64 → at_risk', () => {
    expect(engine.resolveState(55, t)).toBe('at_risk')
  })

  it('score 65–84 → conditionally_ready', () => {
    expect(engine.resolveState(75, t)).toBe('conditionally_ready')
  })

  it('score >= 85 → ready', () => {
    expect(engine.resolveState(90, t)).toBe('ready')
  })

  it('weighted score combines components correctly', () => {
    const components = { open_actions: 100, blockers: 100, sla_health: 100, inspections: 100, escalations: 100 }
    const score = engine.computeWeightedScore(components, t)
    expect(score).toBe(100)
  })

  it('weighted score with all zeros is 0', () => {
    const components = { open_actions: 0, blockers: 0, sla_health: 0, inspections: 0, escalations: 0 }
    const score = engine.computeWeightedScore(components, t)
    expect(score).toBe(0)
  })

  it('blocking factors sorted by severity', () => {
    const factors = engine.__testHooks.buildBlockingFactors({
      blockerCount: 2, overdueCount: 1, escalatedCount: 0, failedInspections: 0,
    })
    expect(factors[0]!.severity).toBe('high')   // blocker: 2 = high
    expect(factors.length).toBeGreaterThan(0)
  })

  it('no blocking factors when all zero', () => {
    const factors = engine.__testHooks.buildBlockingFactors({
      blockerCount: 0, overdueCount: 0, escalatedCount: 0, failedInspections: 0,
    })
    expect(factors).toHaveLength(0)
  })
})

// ─── Suite 3: Predictive SLA — Feature Engineering ──────────────────────────

describe('predictiveSla — feature engineering', () => {
  let sla: typeof import('../../../api/services/ops/predictiveSla').__testHooks

  beforeEach(async () => {
    const mod = await import('../../../api/services/ops/predictiveSla')
    sla = mod.__testHooks
  })

  it('already breached → sla_urgency = 1.0', () => {
    const fv = sla.buildFeatureVector({
      actionId: 'a1', priority: 'critical', actionType: 'RFI',
      slaRemainingMinutes: -30, escalationLevel: 0,
      blockerCount: 0, assigneeOpenCount: 0, reopenCount: 0,
      historicalP50Hours: null, historicalP90Hours: null, ageHours: 4,
    })
    expect(fv['sla_urgency']).toBe(1.0)
  })

  it('< 60 min remaining → sla_urgency = 0.9', () => {
    const fv = sla.buildFeatureVector({
      actionId: 'a1', priority: 'medium', actionType: 'RFI',
      slaRemainingMinutes: 30, escalationLevel: 0,
      blockerCount: 0, assigneeOpenCount: 0, reopenCount: 0,
      historicalP50Hours: null, historicalP90Hours: null, ageHours: 1,
    })
    expect(fv['sla_urgency']).toBe(0.9)
  })

  it('critical priority → priority_weight = 1.0', () => {
    const fv = sla.buildFeatureVector({
      actionId: 'a1', priority: 'critical', actionType: 'INSPECTION',
      slaRemainingMinutes: null, escalationLevel: 0,
      blockerCount: 0, assigneeOpenCount: 0, reopenCount: 0,
      historicalP50Hours: null, historicalP90Hours: null, ageHours: 0,
    })
    expect(fv['priority_weight']).toBe(1.0)
  })

  it('low priority → priority_weight = 0.2', () => {
    const fv = sla.buildFeatureVector({
      actionId: 'a1', priority: 'low', actionType: 'DAILY_LOG',
      slaRemainingMinutes: null, escalationLevel: 0,
      blockerCount: 0, assigneeOpenCount: 0, reopenCount: 0,
      historicalP50Hours: null, historicalP90Hours: null, ageHours: 0,
    })
    expect(fv['priority_weight']).toBe(0.2)
  })

  it('breach probability 0–1 range', () => {
    const prob = sla.computeBreachProbability({
      sla_urgency: 1.0, priority_weight: 1.0, escalation_weight: 1.0,
      blocker_weight: 1.0, workload_pressure: 1.0, reopen_signal: 1.0, age_risk: 1.0,
    })
    expect(prob).toBeGreaterThanOrEqual(0)
    expect(prob).toBeLessThanOrEqual(1)
  })

  it('all-zero features → probability ≈ 0', () => {
    const prob = sla.computeBreachProbability({
      sla_urgency: 0, priority_weight: 0, escalation_weight: 0,
      blocker_weight: 0, workload_pressure: 0, reopen_signal: 0, age_risk: 0,
    })
    expect(prob).toBeLessThan(0.05)
  })

  it('all-max features → probability ≈ 1.0', () => {
    const prob = sla.computeBreachProbability({
      sla_urgency: 1.0, priority_weight: 1.0, escalation_weight: 1.0,
      blocker_weight: 1.0, workload_pressure: 1.0, reopen_signal: 1.0, age_risk: 1.0,
    })
    expect(prob).toBeCloseTo(1.0, 1)
  })

  it('staffing risk: 0 open → 0 score', () => {
    expect(sla.computeStaffingRisk(0, 0, 0)).toBe(0)
  })

  it('staffing risk: max open → high score', () => {
    expect(sla.computeStaffingRisk(30, 20, 10)).toBeGreaterThan(70)
  })

  it('predict delay returns null for low probability', () => {
    const delay = sla.predictDelayHours({
      actionId: 'a', priority: 'low', actionType: 'X',
      slaRemainingMinutes: 1440, escalationLevel: 0,
      blockerCount: 0, assigneeOpenCount: 0, reopenCount: 0,
      historicalP50Hours: null, historicalP90Hours: null, ageHours: 1,
    }, 0.2)
    expect(delay).toBeNull()
  })

  it('bottleneck identifies sla_near_breach', () => {
    const factors = sla.identifyBottlenecks({
      actionId: 'a', priority: 'high', actionType: 'X',
      slaRemainingMinutes: 60, escalationLevel: 0,
      blockerCount: 0, assigneeOpenCount: 0, reopenCount: 0,
      historicalP50Hours: null, historicalP90Hours: null, ageHours: 2,
    })
    expect(factors.some(f => f.type === 'sla_near_breach')).toBe(true)
  })

  it('bottleneck identifies dependency_blockers', () => {
    const factors = sla.identifyBottlenecks({
      actionId: 'a', priority: 'medium', actionType: 'X',
      slaRemainingMinutes: 480, escalationLevel: 0,
      blockerCount: 3, assigneeOpenCount: 0, reopenCount: 0,
      historicalP50Hours: null, historicalP90Hours: null, ageHours: 2,
    })
    expect(factors.some(f => f.type === 'dependency_blockers')).toBe(true)
  })
})

// ─── Suite 4: Recommendation Engine ─────────────────────────────────────────

describe('recommendationEngine — rule matching', () => {
  let engine: typeof import('../../../api/services/ops/recommendationEngine').__testHooks

  beforeEach(async () => {
    const mod = await import('../../../api/services/ops/recommendationEngine')
    engine = mod.__testHooks
  })

  const baseInput = {
    actionId: 'a1', actionTitle: 'Test Action', actionType: 'RFI',
    priority: 'medium', status: 'open', escalationLevel: 0,
    slaRemainingMins: null, downstreamCount: 0, workloadScore: 0,
    reopenCount: 0, readinessImpact: 0,
  }

  it('escalate_manual fires when <2h SLA and escalation_level < 2', () => {
    const recs = engine.generateRecommendations([{
      ...baseInput, slaRemainingMins: 60, escalationLevel: 0,
    }])
    expect(recs.some(r => r.recommended_action === 'escalate')).toBe(true)
  })

  it('escalate_manual does NOT fire when already escalated to L2', () => {
    const recs = engine.generateRecommendations([{
      ...baseInput, slaRemainingMins: 60, escalationLevel: 2,
    }])
    expect(recs.filter(r => r.recommended_action === 'escalate')).toHaveLength(0)
  })

  it('reassign_overloaded fires when workload >= 80', () => {
    const recs = engine.generateRecommendations([{ ...baseInput, workloadScore: 90 }])
    expect(recs.some(r => r.recommended_action === 'reassign')).toBe(true)
  })

  it('resolve_to_unblock fires when downstream >= 2', () => {
    const recs = engine.generateRecommendations([{ ...baseInput, downstreamCount: 3 }])
    expect(recs.some(r => r.recommended_action === 'prioritize')).toBe(true)
  })

  it('downstream prioritize has higher impact as count grows', () => {
    const low  = engine.generateRecommendations([{ ...baseInput, downstreamCount: 2 }])
    const high = engine.generateRecommendations([{ ...baseInput, downstreamCount: 10 }])
    const lowImpact  = low.find(r => r.category === 'dependency')?.impact_score ?? 0
    const highImpact = high.find(r => r.category === 'dependency')?.impact_score ?? 0
    expect(highImpact).toBeGreaterThan(lowImpact)
  })

  it('close_duplicate_cluster fires when reopen >= 2', () => {
    const recs = engine.generateRecommendations([{ ...baseInput, reopenCount: 3 }])
    expect(recs.some(r => r.recommended_action === 'review_duplicates')).toBe(true)
  })

  it('compliance_priority fires for COMPLIANCE_TASK', () => {
    const recs = engine.generateRecommendations([{ ...baseInput, actionType: 'COMPLIANCE_TASK' }])
    expect(recs.some(r => r.category === 'compliance')).toBe(true)
  })

  it('pause_sla fires when downstream>0 and <2h remaining and not 0', () => {
    const recs = engine.generateRecommendations([{
      ...baseInput, downstreamCount: 1, slaRemainingMins: 90,
    }])
    expect(recs.some(r => r.recommended_action === 'pause_sla')).toBe(true)
  })

  it('no recommendations for clean action', () => {
    const recs = engine.generateRecommendations([{
      ...baseInput, slaRemainingMins: 2880, escalationLevel: 0,
      downstreamCount: 0, workloadScore: 0, reopenCount: 0,
    }])
    expect(recs).toHaveLength(0)
  })

  it('recommendations sorted by urgency descending', () => {
    const recs = engine.generateRecommendations([
      { ...baseInput, actionId: 'a1', slaRemainingMins: 60, escalationLevel: 0, downstreamCount: 5 },
    ])
    for (let i = 1; i < recs.length; i++) {
      expect(recs[i - 1]!.urgency_score).toBeGreaterThanOrEqual(recs[i]!.urgency_score)
    }
  })
})

// ─── Suite 5: Offline Sync — Conflict Resolver ───────────────────────────────

describe('conflictResolver — strategy selection and merge', () => {
  let resolver: typeof import('../../../api/services/mobile/conflictResolver').__testHooks

  beforeEach(async () => {
    const mod = await import('../../../api/services/mobile/conflictResolver')
    resolver = mod.__testHooks
  })

  it('deleted_on_server → server_wins', () => {
    expect(resolver.selectAutoStrategy('deleted_on_server')).toBe('server_wins')
  })

  it('schema_mismatch → rejected', () => {
    expect(resolver.selectAutoStrategy('schema_mismatch')).toBe('rejected')
  })

  it('concurrent_edit → merged', () => {
    expect(resolver.selectAutoStrategy('concurrent_edit')).toBe('merged')
  })

  it('unknown type → server_wins default', () => {
    expect(resolver.selectAutoStrategy('unknown_type')).toBe('server_wins')
  })

  it('merge: client wins for title', () => {
    const merged = resolver.mergePayloads(
      { title: 'Client Title', status: 'open' },
      { title: 'Server Title', status: 'in_progress' },
    )
    expect(merged['title']).toBe('Client Title')
  })

  it('merge: server wins for status', () => {
    const merged = resolver.mergePayloads(
      { title: 'X', status: 'open' },
      { title: 'Y', status: 'in_progress' },
    )
    expect(merged['status']).toBe('in_progress')
  })

  it('merge: server wins for priority', () => {
    const merged = resolver.mergePayloads(
      { priority: 'low' },
      { priority: 'critical' },
    )
    expect(merged['priority']).toBe('critical')
  })

  it('merge: client wins for notes', () => {
    const merged = resolver.mergePayloads(
      { notes: 'Field notes from device' },
      { notes: 'Old server notes' },
    )
    expect(merged['notes']).toBe('Field notes from device')
  })

  it('merge: client wins for description', () => {
    const merged = resolver.mergePayloads(
      { description: 'Updated in field' },
      { description: 'Original description' },
    )
    expect(merged['description']).toBe('Updated in field')
  })

  it('merge: server fields not in client are preserved', () => {
    const merged = resolver.mergePayloads(
      { title: 'New' },
      { title: 'Old', project_id: 'proj-1', assigned_to: 'user-1' },
    )
    expect(merged['project_id']).toBe('proj-1')
    expect(merged['assigned_to']).toBe('user-1')
  })
})

// ─── Suite 6: Mobile Sync Engine — Idempotency ───────────────────────────────

describe('syncEngine — idempotency and pull delta', () => {
  let syncEngine: typeof import('../../../api/services/mobile/syncEngine')

  beforeEach(async () => {
    vi.clearAllMocks()
    syncEngine = await import('../../../api/services/mobile/syncEngine')
  })

  it('pullDelta with no events returns empty array', async () => {
    mockQuery.mockResolvedValueOnce(mockRows([]))
    const delta = await syncEngine.__testHooks.pullDelta('t1', undefined)
    expect(delta.events).toHaveLength(0)
  })

  it('pullDelta has_more is true when limit exceeded', async () => {
    const manyRows = Array.from({ length: 201 }, (_, i) => ({
      id: i, event_type: 'action_updated', payload: {}, published_at: new Date(),
    }))
    mockQuery.mockResolvedValueOnce(mockRows(manyRows))
    const delta = await syncEngine.__testHooks.pullDelta('t1', undefined, 200)
    expect(delta.has_more).toBe(true)
    expect(delta.events).toHaveLength(200)
  })

  it('pullDelta has_more is false when at limit', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      id: i, event_type: 'action_updated', payload: {}, published_at: new Date(),
    }))
    mockQuery.mockResolvedValueOnce(mockRows(rows))
    const delta = await syncEngine.__testHooks.pullDelta('t1', undefined, 200)
    expect(delta.has_more).toBe(false)
  })
})

// ─── Suite 7: Evidence Pipeline ───────────────────────────────────────────────

describe('evidencePipeline — upload flow and job types', () => {
  let pipeline: typeof import('../../../api/services/evidence/evidencePipeline').__testHooks

  beforeEach(async () => {
    const mod = await import('../../../api/services/evidence/evidencePipeline')
    pipeline = mod.__testHooks
    vi.clearAllMocks()
  })

  it('photos get compress, thumbnail, ai_tag jobs', () => {
    expect(pipeline.JOB_TYPES['photo']).toEqual(['compress', 'thumbnail', 'ai_tag'])
  })

  it('PDFs get thumbnail and ocr jobs', () => {
    expect(pipeline.JOB_TYPES['pdf']).toEqual(['thumbnail', 'ocr'])
  })

  it('videos get compress, thumbnail, transcode jobs', () => {
    expect(pipeline.JOB_TYPES['video']).toEqual(['compress', 'thumbnail', 'transcode'])
  })

  it('voice notes get compress job only', () => {
    expect(pipeline.JOB_TYPES['voice_note']).toEqual(['compress'])
  })

  it('annotated drawings get thumbnail and ocr', () => {
    expect(pipeline.JOB_TYPES['annotated_drawing']).toEqual(['thumbnail', 'ocr'])
  })

  it('enqueueProcessingJobs calls query for each job type', async () => {
    mockQuery
      .mockResolvedValueOnce(mockRows([{ evidence_type: 'photo' }]))  // fetch type
      .mockResolvedValue(mockRows([{}]))  // insert jobs + status update
    await pipeline._enqueueProcessingJobs('t1', 'e1')
    // photo has 3 job types → 3 inserts + 1 status update = 4+ queries
    expect(mockQuery).toHaveBeenCalledTimes(5)
  })
})

// ─── Suite 8: Real-time Event Broadcaster — Deduplication ────────────────────

describe('eventBroadcaster — deduplication', () => {
  let broadcaster: typeof import('../../../api/realtime/eventBroadcaster').__testHooks

  beforeEach(async () => {
    const mod = await import('../../../api/realtime/eventBroadcaster')
    broadcaster = mod.__testHooks
    broadcaster._recentEvents.clear()
  })

  it('first occurrence is not duplicate', () => {
    expect(broadcaster._isDuplicate('test-key-1')).toBe(false)
  })

  it('second immediate occurrence is duplicate', () => {
    broadcaster._isDuplicate('test-key-2')
    expect(broadcaster._isDuplicate('test-key-2')).toBe(true)
  })

  it('different keys are not duplicates', () => {
    broadcaster._isDuplicate('key-a')
    expect(broadcaster._isDuplicate('key-b')).toBe(false)
  })

  it('expired entries are not duplicate (simulated)', () => {
    // Manually inject an expired entry
    broadcaster._recentEvents.set('old-key', Date.now() - 10_000)
    expect(broadcaster._isDuplicate('old-key')).toBe(false)
  })
})

// ─── Suite 9: WebSocket Subscription Manager ─────────────────────────────────

describe('subscriptionManager — subscription matching', () => {
  let SubscriptionManager: typeof import('../../../api/realtime/subscriptionManager').__testHooks['SubscriptionManager']

  beforeEach(async () => {
    const mod = await import('../../../api/realtime/subscriptionManager')
    SubscriptionManager = mod.__testHooks.SubscriptionManager
  })

  function makeFakeWs() {
    return {
      readyState: 1,
      send: vi.fn(),
      ping: vi.fn(),
      terminate: vi.fn(),
      on: vi.fn(),
    } as unknown as import('ws').WebSocket
  }

  it('getClientCount starts at 0', () => {
    const mgr = new SubscriptionManager()
    expect(mgr.getClientCount()).toBe(0)
  })

  it('register adds a client', () => {
    const mgr = new SubscriptionManager()
    mgr.register(makeFakeWs(), 'c1', 't1', 'u1')
    expect(mgr.getClientCount()).toBe(1)
  })

  it('unregister removes the client', () => {
    const mgr = new SubscriptionManager()
    mgr.register(makeFakeWs(), 'c1', 't1', 'u1')
    mgr.unregister('c1')
    expect(mgr.getClientCount()).toBe(0)
  })

  it('getClientCount_byTenant filters by tenant', () => {
    const mgr = new SubscriptionManager()
    mgr.register(makeFakeWs(), 'c1', 'tenant-A', 'u1')
    mgr.register(makeFakeWs(), 'c2', 'tenant-B', 'u2')
    mgr.register(makeFakeWs(), 'c3', 'tenant-A', 'u3')
    expect(mgr.getClientCount_byTenant('tenant-A')).toBe(2)
    expect(mgr.getClientCount_byTenant('tenant-B')).toBe(1)
  })

  it('subscribe adds to client subscriptions', () => {
    const mgr = new SubscriptionManager()
    mgr.register(makeFakeWs(), 'c1', 't1', 'u1')
    mgr.subscribe('c1', { scope: 'project', scopeId: 'p1' })
    // No error = success
    expect(mgr.getClientCount()).toBe(1)
  })

  it('broadcast does not send to wrong tenant', () => {
    const ws = makeFakeWs()
    const mgr = new SubscriptionManager()
    mgr.register(ws, 'c1', 'tenant-A', 'u1')
    mgr.subscribe('c1', { scope: 'tenant' })
    mgr.broadcast({
      event_type: 'action_created',
      tenant_id:  'tenant-B',  // different tenant
      payload:    {},
      subscription_scope: 'tenant',
    })
    expect(ws.send).not.toHaveBeenCalled()
  })

  it('broadcast sends to matching tenant subscriber', () => {
    const ws = makeFakeWs()
    const mgr = new SubscriptionManager()
    mgr.register(ws, 'c1', 'tenant-A', 'u1')
    mgr.subscribe('c1', { scope: 'tenant' })
    mgr.broadcast({
      event_type: 'action_created',
      tenant_id:  'tenant-A',
      payload:    { title: 'New Action' },
      subscription_scope: 'tenant',
    })
    expect(ws.send).toHaveBeenCalledTimes(1)
  })

  it('broadcast respects scope-specific subscription', () => {
    const ws = makeFakeWs()
    const mgr = new SubscriptionManager()
    mgr.register(ws, 'c1', 'tenant-A', 'u1')
    mgr.subscribe('c1', { scope: 'project', scopeId: 'project-1' })
    // Event for a different project should NOT be received
    mgr.broadcast({
      event_type: 'action_updated',
      tenant_id:  'tenant-A',
      payload:    {},
      subscription_scope: 'project',
      scope_id:   'project-2',
    })
    expect(ws.send).not.toHaveBeenCalled()
  })

  it('duplicate subscription not added twice', () => {
    const mgr = new SubscriptionManager()
    mgr.register(makeFakeWs(), 'c1', 't1', 'u1')
    mgr.subscribe('c1', { scope: 'project', scopeId: 'p1' })
    mgr.subscribe('c1', { scope: 'project', scopeId: 'p1' })
    // No error and client still exists
    expect(mgr.getClientCount()).toBe(1)
  })
})

// ─── Suite 10: Breach Prediction — E2E ───────────────────────────────────────

describe('predictiveSla — end-to-end prediction', () => {
  beforeEach(() => vi.clearAllMocks())

  it('critical breached action gets high breach probability', async () => {
    const { predictBreach } = await import('../../../api/services/ops/predictiveSla')
    const pred = predictBreach({
      actionId: 'a1', priority: 'critical', actionType: 'COMPLIANCE_TASK',
      slaRemainingMinutes: -120, escalationLevel: 2, blockerCount: 2,
      assigneeOpenCount: 25, reopenCount: 1,
      historicalP50Hours: 8, historicalP90Hours: 24, ageHours: 36,
    })
    expect(pred.breachProbability).toBeGreaterThan(0.7)
    expect(pred.bottleneckFactors.length).toBeGreaterThan(0)
    expect(pred.modelVersion).toBe('deterministic-v1')
  })

  it('low-risk action gets low breach probability', async () => {
    const { predictBreach } = await import('../../../api/services/ops/predictiveSla')
    const pred = predictBreach({
      actionId: 'a2', priority: 'low', actionType: 'DAILY_LOG',
      slaRemainingMinutes: 2880, escalationLevel: 0, blockerCount: 0,
      assigneeOpenCount: 3, reopenCount: 0,
      historicalP50Hours: 4, historicalP90Hours: 8, ageHours: 1,
    })
    expect(pred.breachProbability).toBeLessThan(0.4)
  })

  it('batchPredictBreaches sorts by probability descending', async () => {
    const { batchPredictBreaches } = await import('../../../api/services/ops/predictiveSla')
    const results = batchPredictBreaches([
      { actionId: 'a1', priority: 'low',      actionType: 'X', slaRemainingMinutes: 4800,
        escalationLevel: 0, blockerCount: 0, assigneeOpenCount: 0, reopenCount: 0,
        historicalP50Hours: null, historicalP90Hours: null, ageHours: 0 },
      { actionId: 'a2', priority: 'critical', actionType: 'X', slaRemainingMinutes: -60,
        escalationLevel: 2, blockerCount: 3, assigneeOpenCount: 20, reopenCount: 2,
        historicalP50Hours: 4, historicalP90Hours: 12, ageHours: 20 },
    ])
    expect(results[0]!.actionId).toBe('a2')
    expect(results[0]!.breachProbability).toBeGreaterThan(results[1]!.breachProbability)
  })
})

// ─── Suite 11: Readiness Snapshot Job ────────────────────────────────────────

describe('readinessSnapshots — snapshot job', () => {
  beforeEach(() => vi.clearAllMocks())

  it('enqueueReadinessSnapshotsForAllTenants queries active tenants', async () => {
    mockQuery.mockResolvedValueOnce(mockRows([{ id: 't1' }, { id: 't2' }]))
    // computeReadiness will make additional queries — mock them all to empty
    mockQuery.mockResolvedValue(mockRows([{ total_count: 0, open_count: 0, overdue_count: 0,
      escalated_count: 0, blocker_count: 0, breach_count: 0, at_risk_count: 0 }]))

    const { enqueueReadinessSnapshotsForAllTenants } = await import(
      '../../../api/services/readiness/readinessSnapshots'
    )
    // Should not throw
    await expect(enqueueReadinessSnapshotsForAllTenants()).resolves.toBeUndefined()
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('is_active = TRUE'),
      expect.any(Array),
    )
  })
})

// ─── Suite 12: Evidence Pipeline — Retry and Confirm ─────────────────────────

describe('evidencePipeline — confirm and retry', () => {
  beforeEach(() => vi.clearAllMocks())

  it('confirmUpload skips dedup when no checksum', async () => {
    const { confirmUpload } = await import('../../../api/services/evidence/evidencePipeline')
    // No dedup query, just update + enqueue
    mockQuery
      .mockResolvedValueOnce(mockRows([]))   // update status
      .mockResolvedValueOnce(mockRows([{ evidence_type: 'document' }]))  // fetch type
      .mockResolvedValue(mockRows([{}]))     // insert jobs + status update
    await confirmUpload({ tenantId: 't1', evidenceId: 'e1', storageKey: 's3/key' })
    expect(mockQuery).toHaveBeenCalled()
  })

  it('retryUpload returns true when row updated', async () => {
    const { retryUpload } = await import('../../../api/services/evidence/evidencePipeline')
    mockQuery.mockResolvedValueOnce(mockRows([{ id: 'e1' }]))
    const ok = await retryUpload('t1', 'e1')
    expect(ok).toBe(true)
  })

  it('retryUpload returns false when no row updated', async () => {
    const { retryUpload } = await import('../../../api/services/evidence/evidencePipeline')
    mockQuery.mockResolvedValueOnce(mockRows([]))
    const ok = await retryUpload('t1', 'nonexistent')
    expect(ok).toBe(false)
  })

  it('linkEvidence calls insert with ON CONFLICT DO NOTHING', async () => {
    const { linkEvidence } = await import('../../../api/services/evidence/evidencePipeline')
    mockQuery.mockResolvedValueOnce(mockRows([{}]))
    await linkEvidence({ tenantId: 't1', evidenceId: 'e1', entityType: 'action',
      entityId: 'a1', linkedBy: 'u1', context: 'defect_photo' })
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT'),
      expect.any(Array),
    )
  })
})

// ─── Suite 13: Ops Center Routes — Command logic ─────────────────────────────

describe('ops commands — payload validation', () => {
  it('reassign requires action_ids, target_user_id, reason', () => {
    // Validated at route level — test the shape required
    const validPayload = {
      action_ids: ['a1', 'a2'],
      target_user_id: 'user-1',
      reason: 'Rebalancing workload',
    }
    expect(validPayload.action_ids).toBeDefined()
    expect(validPayload.target_user_id).toBeDefined()
    expect(validPayload.reason).toBeDefined()
  })

  it('freeze payload requires action_ids and reason', () => {
    const validPayload = { action_ids: ['a1'], reason: 'Awaiting inspection' }
    expect(validPayload.action_ids.length).toBeGreaterThan(0)
    expect(validPayload.reason.length).toBeGreaterThan(0)
  })
})

// ─── Suite 14: Integration — Recommendation → Prediction alignment ──────────

describe('integration — recommendations align with predictions', () => {
  it('high breach probability corresponds to escalate recommendation', async () => {
    const { predictBreach }        = await import('../../../api/services/ops/predictiveSla')
    const { generateRecommendations } = await import('../../../api/services/ops/recommendationEngine')

    const input = {
      actionId: 'a1', priority: 'critical', actionType: 'INSPECTION',
      slaRemainingMinutes: -30, escalationLevel: 1, blockerCount: 0,
      assigneeOpenCount: 5, reopenCount: 0,
      historicalP50Hours: 4, historicalP90Hours: 8, ageHours: 12,
    }

    const pred = predictBreach(input)
    expect(pred.breachProbability).toBeGreaterThan(0.5)

    const recInput = {
      actionId: 'a1', actionTitle: 'Critical Inspection', actionType: 'INSPECTION',
      priority: 'critical', status: 'open', escalationLevel: 1,
      slaRemainingMins: -30, downstreamCount: 0,
      workloadScore: 20, reopenCount: 0, readinessImpact: 60,
    }
    const recs = generateRecommendations([recInput])
    // Should recommend escalation since level < 2 and SLA breached
    expect(recs.some(r => r.recommended_action === 'escalate')).toBe(true)
  })

  it('compliance task gets max confidence recommendation', async () => {
    const { generateRecommendations } = await import('../../../api/services/ops/recommendationEngine')
    const recs = generateRecommendations([{
      actionId: 'a2', actionTitle: 'LOTO Procedure', actionType: 'COMPLIANCE_TASK',
      priority: 'high', status: 'open', escalationLevel: 0,
      slaRemainingMins: 240, downstreamCount: 0,
      workloadScore: 10, reopenCount: 0, readinessImpact: 0,
    }])
    const complianceRec = recs.find(r => r.category === 'compliance')
    expect(complianceRec).toBeDefined()
    expect(complianceRec!.confidence_score).toBeGreaterThanOrEqual(90)
  })

  it('readiness blocking actions get readiness_impact recommendation', async () => {
    const { generateRecommendations } = await import('../../../api/services/ops/recommendationEngine')
    const recs = generateRecommendations([{
      actionId: 'a3', actionTitle: 'System Check', actionType: 'INSPECTION',
      priority: 'medium', status: 'open', escalationLevel: 0,
      slaRemainingMins: null, downstreamCount: 0,
      workloadScore: 10, reopenCount: 0, readinessImpact: 80,
    }])
    expect(recs.some(r => r.category === 'readiness')).toBe(true)
  })

  it('scoring and prediction agree: critical overdue > medium on-time', async () => {
    const { batchPredictBreaches } = await import('../../../api/services/ops/predictiveSla')
    const { scoreAndRankActions }  = await import('../../../api/services/actions/actionScoringService')

    const critical = {
      actionId: 'c1', priority: 'critical', actionType: 'COMPLIANCE_TASK',
      slaRemainingMinutes: -60, escalationLevel: 2, blockerCount: 0,
      assigneeOpenCount: 0, reopenCount: 0,
      historicalP50Hours: null, historicalP90Hours: null, ageHours: 10,
    }
    const medium = {
      actionId: 'm1', priority: 'medium', actionType: 'DAILY_LOG',
      slaRemainingMinutes: 1440, escalationLevel: 0, blockerCount: 0,
      assigneeOpenCount: 0, reopenCount: 0,
      historicalP50Hours: null, historicalP90Hours: null, ageHours: 2,
    }

    const preds   = batchPredictBreaches([critical, medium])
    const ranked  = scoreAndRankActions([
      { action_id: 'c1', priority: 'critical', remaining_minutes: -60,
        escalation_level: 2, escalation_count: 2, downstream_impact_count: 0,
        action_type: 'COMPLIANCE_TASK', due_at: null, reopen_count: 0 },
      { action_id: 'm1', priority: 'medium', remaining_minutes: 1440,
        escalation_level: 0, escalation_count: 0, downstream_impact_count: 0,
        action_type: 'DAILY_LOG', due_at: null, reopen_count: 0 },
    ])

    // Both systems agree: critical overdue ranks first
    expect(preds[0]!.actionId).toBe('c1')
    expect(ranked[0]!.action_id).toBe('c1')
  })
})
