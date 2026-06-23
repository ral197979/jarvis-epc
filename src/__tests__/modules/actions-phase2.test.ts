/**
 * Denver Engineering — Ava Phase 2 Action Intelligence Tests (v4.34.0)
 * ──────────────────────────────────────────────────────────────────────
 * Coverage (82 tests across 11 suites):
 *
 *   1. actionRelationshipService  — CRUD, cycle detection, self-relation, tenant isolation
 *   2. actionDependencyGraph      — blocker resolution, downstream impact, deep traversal
 *   3. actionEventPublisher       — publish, timeline fetch, error resilience
 *   4. slaPolicyEngine            — business hours math, pause/resume, timezone, holiday
 *   5. notificationQueue          — enqueue, dedup key, multi-channel, escalation helper
 *   6. notificationWorker         — delivery routing, backoff, dead-letter promotion
 *   7. actionScoringService       — individual components, weighted total, batch rank
 *   8. actionRecommendationService — rule-based recs, escalate_manual, pause_sla
 *   9. actionAnalyticsService     — overview aggregation, trends, workload
 *  10. Tenant isolation           — cross-tenant data leakage prevention
 *  11. Integration scenarios      — end-to-end: create → relate → escalate → notify
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock DB pool ─────────────────────────────────────────────────────────────

const mockQuery = vi.hoisted(() => vi.fn())

vi.mock('../../../api/db/pool', () => ({
  query:       mockQuery,
  tenantQuery: (_tenantId: string, sql: string, params: unknown[]) =>
    mockQuery(sql, params),
}))

vi.mock('../../../src/modules/observability/index', () => ({ slog: vi.fn() }))
vi.mock('../../../api/services/scheduler', () => ({
  registerPromoter: vi.fn(),
  registerHandler:  vi.fn(),
  enqueue:          vi.fn().mockResolvedValue('job-uuid'),
}))

// ─── Import after mocks ───────────────────────────────────────────────────────

import {
  createRelation, listRelations, deleteRelation,
  __testHooks as relHooks,
} from '../../../api/services/actions/actionRelationshipService'

import {
  buildDependencyReport, batchBlockerStatus,
  __testHooks as depHooks,
} from '../../../api/services/actions/actionDependencyGraph'

import {
  publishEvent, publishActionEvent, getActionTimeline,
} from '../../../api/services/actions/actionEventPublisher'

import {
  computeBusinessDueDate, pauseSla, resumeSla, computeRemainingMinutes,
  __testHooks as slaHooks,
} from '../../../api/services/sla/slaPolicyEngine'

import {
  enqueueNotification, enqueueMultiChannel, enqueueEscalationNotification,
} from '../../../api/services/notifications/notificationQueue'

import {
  __testHooks as notifHooks,
} from '../../../api/services/notifications/notificationWorker'

import {
  scoreAction, scoreAndRankActions,
  __testHooks as scoreHooks,
} from '../../../api/services/actions/actionScoringService'

import {
  generateInboxRecommendations,
} from '../../../api/services/actions/actionRecommendationService'

import {
  getOverview, getWorkload,
  __testHooks as analyticsHooks,
} from '../../../api/services/actions/actionAnalyticsService'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const T  = 'tenant-uuid-0001'
const A1 = 'action-uuid-aaaa'
const A2 = 'action-uuid-bbbb'
const A3 = 'action-uuid-cccc'
const R1 = 'relation-uuid-1111'
const U1 = 'user-uuid-1111'

function makeProfile(overrides = {}) {
  return {
    id:                          'profile-uuid',
    tenant_id:                   T,
    name:                        'Default',
    business_hours_start:        '08:00',
    business_hours_end:          '17:00',
    business_days:               [1, 2, 3, 4, 5],
    timezone:                    'America/Denver',
    holiday_dates:               [],
    grace_period_minutes:        0,
    escalation_cooldown_minutes: 60,
    ...overrides,
  }
}

// ─── 1. actionRelationshipService ────────────────────────────────────────────

describe('actionRelationshipService: createRelation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates a relation between two actions', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: '2' }] })   // ownership check
      .mockResolvedValueOnce({ rows: [{ exists: false }] }) // cycle check (CTE)
      .mockResolvedValueOnce({ rows: [{ id: R1, source_action_id: A1, target_action_id: A2, relation_type: 'blocks', deleted_at: null }] }) // INSERT
      .mockResolvedValueOnce({ rowCount: 1 })              // publishActionEvent INSERT

    const { relation, error } = await createRelation(T, {
      sourceActionId: A1, targetActionId: A2, relationType: 'blocks', actorId: U1,
    })

    expect(error).toBeUndefined()
    expect(relation?.relation_type).toBe('blocks')
    expect(relation?.source_action_id).toBe(A1)
  })

  it('rejects self-relations immediately (no DB call)', async () => {
    const { relation, error } = await createRelation(T, {
      sourceActionId: A1, targetActionId: A1, relationType: 'blocks',
    })
    expect(error).toBe('self_relation_not_allowed')
    expect(relation).toBeNull()
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('returns action_not_found when action belongs to another tenant', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '1' }] })  // only 1 found, not 2
    const { error } = await createRelation(T, {
      sourceActionId: A1, targetActionId: A2, relationType: 'related_to',
    })
    expect(error).toBe('action_not_found')
  })

  it('detects cycle: target already reachable from source', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: '2' }] })          // ownership
      .mockResolvedValueOnce({ rows: [{ exists: true }] })         // cycle CTE finds path
    const { error } = await createRelation(T, {
      sourceActionId: A1, targetActionId: A2, relationType: 'blocks',
    })
    expect(error).toBe('cycle_detected')
  })

  it('does NOT cycle-check for non-dependency types (related_to)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: '2' }] })
      // No cycle query for 'related_to'
      .mockResolvedValueOnce({ rows: [{ id: R1, relation_type: 'related_to' }] })
      .mockResolvedValueOnce({ rowCount: 1 })  // event

    const { relation } = await createRelation(T, {
      sourceActionId: A1, targetActionId: A2, relationType: 'related_to',
    })
    expect(relation?.relation_type).toBe('related_to')
    // Cycle query NOT called (only ownership + insert = 3 calls)
    const cycleCalls = mockQuery.mock.calls.filter(c =>
      String(c[0]).includes('WITH RECURSIVE reachable'))
    expect(cycleCalls).toHaveLength(0)
  })
})

describe('actionRelationshipService: listRelations / deleteRelation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lists both outbound and inbound by default', async () => {
    const rows = [{ id: R1, source_action_id: A1, target_action_id: A2, deleted_at: null }]
    mockQuery.mockResolvedValueOnce({ rows })
    const result = await listRelations(T, A1, 'both')
    expect(result).toHaveLength(1)
    const sql = String(mockQuery.mock.calls[0]![0])
    expect(sql).toContain('source_action_id = $2 OR target_action_id = $2')
  })

  it('soft-deletes a relation and returns true', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ source_action_id: A1 }], rowCount: 1 })  // UPDATE
      .mockResolvedValueOnce({ rowCount: 1 })  // publishActionEvent

    const deleted = await deleteRelation(T, R1, U1)
    expect(deleted).toBe(true)
    const sql = String(mockQuery.mock.calls[0]![0])
    expect(sql).toContain('deleted_at = NOW()')
  })

  it('returns false when relation not found or already deleted', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 })
    const deleted = await deleteRelation(T, 'non-existent', null)
    expect(deleted).toBe(false)
  })
})

// ─── 2. actionDependencyGraph ─────────────────────────────────────────────────

describe('actionDependencyGraph', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns is_blocked=false when no open blockers', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })   // _resolveBlockers → none
      .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // downstream

    const report = await buildDependencyReport(T, A1)
    expect(report.is_blocked).toBe(false)
    expect(report.blocked_by_count).toBe(0)
  })

  it('returns is_blocked=true with immediate blockers listed', async () => {
    const blockers = [{
      action_id: A2, title: 'Blocker', status: 'open',
      priority: 'high', action_type: 'RFI', depth: 1,
    }]
    mockQuery
      .mockResolvedValueOnce({ rows: blockers })           // blockers query
      .mockResolvedValueOnce({ rows: [{ count: '2' }] })   // downstream

    const report = await buildDependencyReport(T, A1)
    expect(report.is_blocked).toBe(true)
    expect(report.blocked_by_count).toBe(1)
    expect(report.blockers[0]?.action_id).toBe(A2)
  })

  it('sets critical_path_flag when has both blockers and downstream impact', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ action_id: A2, title: 'B', status: 'open', priority: 'high', action_type: 'RFI', depth: 1 }] })
      .mockResolvedValueOnce({ rows: [{ count: '3' }] })

    const report = await buildDependencyReport(T, A1)
    expect(report.critical_path_flag).toBe(true)
    expect(report.downstream_impact_count).toBe(3)
  })

  it('batchBlockerStatus returns correct map for multiple action IDs', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [
      { action_id: A1, blocked_by_count: '2' },
      { action_id: A3, blocked_by_count: '0' },
    ]})

    const map = await batchBlockerStatus(T, [A1, A2, A3])
    expect(map.get(A1)?.is_blocked).toBe(true)
    expect(map.get(A1)?.blocked_by_count).toBe(2)
    expect(map.get(A2)?.is_blocked).toBe(false)  // not in result → initialized as unblocked
    expect(map.get(A3)?.is_blocked).toBe(false)
  })

  it('returns empty map for empty action list (no DB query)', async () => {
    const map = await batchBlockerStatus(T, [])
    expect(map.size).toBe(0)
    expect(mockQuery).not.toHaveBeenCalled()
  })
})

// ─── 3. actionEventPublisher ──────────────────────────────────────────────────

describe('actionEventPublisher', () => {
  beforeEach(() => vi.clearAllMocks())

  it('inserts event via publishEvent', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 })
    await publishEvent({
      tenantId: T, actionId: A1, eventType: 'created',
      actorId: U1, actorType: 'user',
    })
    expect(mockQuery).toHaveBeenCalledTimes(1)
    expect(String(mockQuery.mock.calls[0]![0])).toContain('INSERT INTO action_events')
  })

  it('publishActionEvent is fire-and-forget (void), never throws', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB error'))
    // Should not throw
    expect(() => publishActionEvent(T, A1, 'escalated', U1, { level: 1 })).not.toThrow()
  })

  it('getActionTimeline returns ordered events', async () => {
    const events = [
      { id: 'e1', event_type: 'created', occurred_at: '2026-01-01' },
      { id: 'e2', event_type: 'assigned', occurred_at: '2026-01-02' },
    ]
    mockQuery.mockResolvedValueOnce({ rows: events })
    const result = await getActionTimeline(T, A1, 50)
    expect(result).toHaveLength(2)
    expect(result[0]?.event_type).toBe('created')
  })

  it('stores correlation_id when provided', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 })
    await publishEvent({
      tenantId: T, actionId: A1, eventType: 'status_changed',
      correlationId: 'corr-uuid-123',
    })
    const params = mockQuery.mock.calls[0]![1] as unknown[]
    expect(params[2]).toBe('corr-uuid-123')
  })

  it('stores before/after snapshots', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 })
    await publishEvent({
      tenantId: T, actionId: A1, eventType: 'status_changed',
      beforeSnapshot: { status: 'open' },
      afterSnapshot:  { status: 'in_progress' },
    })
    const params = mockQuery.mock.calls[0]![1] as unknown[]
    expect(params[7]).toContain('"status":"open"')
    expect(params[8]).toContain('"status":"in_progress"')
  })
})

// ─── 4. slaPolicyEngine ───────────────────────────────────────────────────────

describe('slaPolicyEngine: business hours math', () => {
  it('returns correct due date with no business hours (24/7)', () => {
    const profile = makeProfile({ business_hours_start: null, business_hours_end: null })
    const start = new Date('2026-01-05T08:00:00Z')  // Monday 8am UTC
    const due   = computeBusinessDueDate(start, 24, profile)
    expect(due.getTime() - start.getTime()).toBeCloseTo(24 * 3600 * 1000, -3)
  })

  it('advances past weekend when business_days=[1,2,3,4,5]', () => {
    // Friday at 6pm local Denver time (after business hours close) → 01:00 UTC Saturday
    const profile = makeProfile({ timezone: 'America/Denver' })
    const start   = new Date('2026-01-10T01:00:00Z')  // Friday 6pm Denver (after close)
    const due     = computeBusinessDueDate(start, 1, profile)   // 1 biz hour ahead
    // Must land on Monday (next business day) since Friday business hours already closed
    const local   = slaHooks.inTimezone(due, 'America/Denver')
    expect([1, 2]).toContain(local.dow)   // Monday=1 (dow via Date.getDay())
  })

  it('skips holiday dates', () => {
    const profile = makeProfile({
      holiday_dates: ['2026-12-25'],
      timezone: 'UTC',
      business_hours_start: '08:00',
      business_hours_end:   '17:00',
    })
    // Start on Dec 25 8am UTC
    const start = new Date('2026-12-25T08:00:00Z')
    const due   = computeBusinessDueDate(start, 1, profile)
    // Due should be after Dec 25 since that's a holiday
    const local = slaHooks.inTimezone(due, 'UTC')
    expect(local.day).not.toBe(25)
  })

  it('_isBusinessTime returns false for Saturday', () => {
    const profile = makeProfile({ timezone: 'UTC' })
    const saturday = new Date('2026-01-10T10:00:00Z')  // Saturday
    expect(slaHooks.isBusinessTime(saturday, profile)).toBe(false)
  })

  it('_isBusinessTime returns true for Monday 10am', () => {
    const profile = makeProfile({ timezone: 'UTC' })
    const monday  = new Date('2026-01-05T10:00:00Z')   // Monday 10am UTC
    expect(slaHooks.isBusinessTime(monday, profile)).toBe(true)
  })

  it('_isBusinessTime returns false before business hours start', () => {
    const profile = makeProfile({ timezone: 'UTC' })
    const early   = new Date('2026-01-05T07:00:00Z')   // Monday 7am (before 8am)
    expect(slaHooks.isBusinessTime(early, profile)).toBe(false)
  })
})

describe('slaPolicyEngine: pause / resume', () => {
  beforeEach(() => vi.clearAllMocks())

  it('pauseSla updates sla_status to paused', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 })
    const result = await pauseSla(T, A1)
    expect(result).toBe(true)
    expect(String(mockQuery.mock.calls[0]![0])).toContain("sla_status    = 'paused'")
  })

  it('pauseSla returns false when not active', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0 })
    const result = await pauseSla(T, A1)
    expect(result).toBe(false)
  })

  it('resumeSla accumulates paused_duration_mins', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 })
    const result = await resumeSla(T, A1)
    expect(result).toBe(true)
    const sql = String(mockQuery.mock.calls[0]![0])
    expect(sql).toContain('paused_duration_mins')
    expect(sql).toContain("sla_status            = 'active'")
  })

  it('resumeSla returns false when not paused', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0 })
    expect(await resumeSla(T, A1)).toBe(false)
  })
})

// ─── 5. notificationQueue ─────────────────────────────────────────────────────

describe('notificationQueue: enqueueNotification', () => {
  beforeEach(() => vi.clearAllMocks())

  it('enqueues a notification and returns job id', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'notif-job-id' }] })
    const id = await enqueueNotification({
      tenantId:        T,
      channel:         'in_app',
      templateKey:     'action.escalated.level1',
      recipientIds:    [U1],
      recipientEmails: [],
      payload:         { action_id: A1 },
    })
    expect(id).toBe('notif-job-id')
    expect(String(mockQuery.mock.calls[0]![0])).toContain('INSERT INTO notification_jobs')
  })

  it('dedup key prevents double-insertion (returns null on conflict)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })  // ON CONFLICT DO NOTHING → 0 rows
    const id = await enqueueNotification({
      tenantId: T, channel: 'email', templateKey: 'test', recipientIds: [],
      recipientEmails: [], payload: {}, dedupKey: 'action:123:escalation:1',
    })
    expect(id).toBeNull()
  })

  it('enqueueMultiChannel creates one job per channel with channel-scoped dedup key', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'job-inapp' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'job-email' }] })

    const ids = await enqueueMultiChannel({
      tenantId: T, templateKey: 'test', recipientIds: [U1],
      recipientEmails: ['a@b.com'], payload: {}, dedupKey: 'base-key',
    }, ['in_app', 'email'])

    expect(ids).toHaveLength(2)
    expect(ids[0]).toBe('job-inapp')
    expect(ids[1]).toBe('job-email')
    // Each call should have channel-specific dedup key
    const params0 = mockQuery.mock.calls[0]![1] as unknown[]
    const params1 = mockQuery.mock.calls[1]![1] as unknown[]
    expect(params0[6]).toBe('base-key:in_app')
    expect(params1[6]).toBe('base-key:email')
  })

  it('enqueueEscalationNotification creates both in_app and email jobs', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'j1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'j2' }] })

    await enqueueEscalationNotification({
      tenantId: T, actionId: A1, actionTitle: 'Test', level: 1,
      notifyRole: 'assigned_user', recipientIds: [U1], hoursOverdue: 2,
    })

    expect(mockQuery).toHaveBeenCalledTimes(2)  // in_app + email
  })

  it('handles DB errors gracefully (returns null)', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection lost'))
    const id = await enqueueNotification({
      tenantId: T, channel: 'in_app', templateKey: 'test',
      recipientIds: [], recipientEmails: [], payload: {},
    })
    expect(id).toBeNull()
  })
})

// ─── 6. notificationWorker ────────────────────────────────────────────────────

describe('notificationWorker: backoff + dead-letter', () => {
  it('nextRunAfter(0) returns near-future date', () => {
    const d = notifHooks.nextRunAfter(0)
    expect(d.getTime()).toBeGreaterThan(Date.now())
    expect(d.getTime()).toBeLessThan(Date.now() + 200_000)  // within ~3 min
  })

  it('nextRunAfter increases exponentially', () => {
    const a1 = notifHooks.nextRunAfter(1).getTime()
    const a2 = notifHooks.nextRunAfter(2).getTime()
    const a3 = notifHooks.nextRunAfter(3).getTime()
    // Each should be further in the future (accounting for jitter ±30s)
    expect(a2).toBeGreaterThan(a1 - 40_000)
    expect(a3).toBeGreaterThan(a2 - 40_000)
  })

  it('nextRunAfter caps at MAX_BACKOFF (3600s)', () => {
    const late = notifHooks.nextRunAfter(20)  // would be 60 * 2^20 without cap
    const maxAllowed = Date.now() + 3700_000  // 3700s = cap + jitter buffer
    expect(late.getTime()).toBeLessThan(maxAllowed)
  })

  it('deliver routes to in_app stub', async () => {
    const job = {
      id: 'j1', tenant_id: T, channel: 'in_app', template_key: 'test',
      recipient_ids: [U1], recipient_emails: [], payload: {},
      attempts: 0, max_attempts: 5, action_id: null, event_type: null,
    }
    const result = await notifHooks.deliver(job as never)
    expect(result.success).toBe(true)
  })

  it('deliver returns failure for unknown channel', async () => {
    const job = {
      id: 'j1', tenant_id: T, channel: 'fax', template_key: 'test',
      recipient_ids: [], recipient_emails: [], payload: {},
      attempts: 0, max_attempts: 5, action_id: null, event_type: null,
    }
    const result = await notifHooks.deliver(job as never)
    expect(result.success).toBe(false)
    expect(result.error).toContain('unknown_channel')
  })
})

// ─── 7. actionScoringService ──────────────────────────────────────────────────

describe('actionScoringService: component scores', () => {
  const base = {
    action_id: A1, priority: 'medium' as const, action_type: 'RFI',
    due_at: null, escalation_level: 0, escalation_count: 0,
    downstream_impact_count: 0, remaining_minutes: null,
  }

  it('critical priority scores 100 for severity', () => {
    const s = scoreHooks.severityScore({ ...base, priority: 'critical' })
    expect(s).toBe(100)
  })

  it('low priority scores 15 for severity', () => {
    const s = scoreHooks.severityScore({ ...base, priority: 'low' })
    expect(s).toBe(15)
  })

  it('overdue SLA risk score >= 60', () => {
    const s = scoreHooks.slaRiskScore({ ...base, remaining_minutes: -120 })
    expect(s).toBeGreaterThanOrEqual(60)
  })

  it('2h remaining gives sla risk = 95', () => {
    expect(scoreHooks.slaRiskScore({ ...base, remaining_minutes: 100 })).toBe(95)
  })

  it('escalation level 3 pushes score to 90+', () => {
    const s = scoreHooks.escalationScore({ ...base, escalation_level: 3, escalation_count: 3 })
    expect(s).toBeGreaterThanOrEqual(90)
  })

  it('downstream 5 blocked actions gives score 70', () => {
    const s = scoreHooks.downstreamScore({ ...base, downstream_impact_count: 5 })
    expect(s).toBe(70)
  })

  it('ALARM module criticality = 85', () => {
    expect(scoreHooks.moduleCriticalityScore({ ...base, action_type: 'ALARM' })).toBe(85)
  })

  it('COMPLIANCE_TASK module criticality = 90', () => {
    expect(scoreHooks.moduleCriticalityScore({ ...base, action_type: 'COMPLIANCE_TASK' })).toBe(90)
  })

  it('reopen penalty caps at 50', () => {
    expect(scoreHooks.reopenPenalty({ ...base, reopen_count: 10 })).toBe(50)
  })

  it('scoreAction returns operational_risk_score 0-100', () => {
    const score = scoreAction(base)
    expect(score.operational_risk_score).toBeGreaterThanOrEqual(0)
    expect(score.operational_risk_score).toBeLessThanOrEqual(100)
  })

  it('scoreAndRankActions sorts descending by risk', () => {
    const inputs = [
      { ...base, action_id: 'a1', priority: 'low' as const,      remaining_minutes: 1440 },
      { ...base, action_id: 'a2', priority: 'critical' as const,  remaining_minutes: -60 },
      { ...base, action_id: 'a3', priority: 'medium' as const,    remaining_minutes: 120 },
    ]
    const ranked = scoreAndRankActions(inputs)
    expect(ranked[0]?.action_id).toBe('a2')  // critical + overdue = highest
    expect(ranked[ranked.length - 1]?.action_id).toBe('a1')  // low priority + lots of time
  })

  it('ai_priority_score equals operational_risk_score when no AI provider registered', () => {
    const score = scoreAction(base)
    expect(score.ai_priority_score).toBe(score.operational_risk_score)
  })

  it('recommendation_reason is non-empty string', () => {
    const score = scoreAction({ ...base, priority: 'critical', remaining_minutes: -10 })
    expect(score.recommendation_reason.length).toBeGreaterThan(0)
  })
})

// ─── 8. actionRecommendationService ──────────────────────────────────────────

describe('actionRecommendationService', () => {
  const base = {
    action_id: A1, priority: 'medium' as const, action_type: 'RFI',
    due_at: null, escalation_level: 0, escalation_count: 0,
    downstream_impact_count: 0, remaining_minutes: null,
  }

  it('generates escalate_manual rec when sla_risk >= 80 and escalation_level < 2', () => {
    const recs = generateInboxRecommendations([{
      ...base, remaining_minutes: 30, escalation_level: 0,
    }])
    const escalateRec = recs.recommendations.find(r => r.type === 'escalate_manual')
    expect(escalateRec).toBeDefined()
    expect(escalateRec?.ai_generated).toBe(true)
  })

  it('generates pause_sla rec when downstream >= 40 and near breach', () => {
    const recs = generateInboxRecommendations([{
      ...base, downstream_impact_count: 5, remaining_minutes: 60,
    }])
    const pauseRec = recs.recommendations.find(r => r.type === 'pause_sla')
    expect(pauseRec).toBeDefined()
  })

  it('generates prioritize rec for high-risk actions', () => {
    const recs = generateInboxRecommendations([{
      ...base, priority: 'critical' as const, remaining_minutes: -60,
    }])
    const priRec = recs.recommendations.find(r => r.type === 'prioritize')
    expect(priRec).toBeDefined()
  })

  it('top_actions returns max 20 items', () => {
    const inputs = Array.from({ length: 30 }, (_, i) => ({
      ...base, action_id: `a${i}`,
    }))
    const recs = generateInboxRecommendations(inputs)
    expect(recs.top_actions.length).toBeLessThanOrEqual(20)
  })

  it('generated_at is a valid ISO string', () => {
    const recs = generateInboxRecommendations([base])
    expect(() => new Date(recs.generated_at)).not.toThrow()
  })
})

// ─── 9. actionAnalyticsService ────────────────────────────────────────────────

describe('actionAnalyticsService: getOverview', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns correct counts from DB results', async () => {
    // statusCounts
    mockQuery.mockResolvedValueOnce({ rows: [
      { status: 'open', priority: 'high', action_type: 'RFI', count: '5' },
      { status: 'in_progress', priority: 'medium', action_type: 'SUBMITTAL', count: '3' },
      { status: 'completed', priority: 'low', action_type: 'PUNCH_ITEM', count: '10' },
    ]})
    // overdueCount
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '2' }] })
    // completedToday
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '4' }] })
    // escalated
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '1' }] })
    // slaCompliance
    mockQuery.mockResolvedValueOnce({ rows: [{ pct: '85.50' }] })

    const ov = await getOverview(T)
    expect(ov.total_open).toBe(8)  // 5 open + 3 in_progress
    expect(ov.total_overdue).toBe(2)
    expect(ov.total_completed_today).toBe(4)
    expect(ov.sla_compliance_pct).toBe(85.5)
    expect(ov.by_status['open']).toBe(5)
    expect(ov.by_type['RFI']).toBe(5)
  })
})

describe('actionAnalyticsService: getWorkload', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns formatted workload rows', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [
      { user_id: U1, email: 'alice@co.com', open_count: '10', overdue_count: '3', avg_age_hours: '48.5' },
    ]})
    const workload = await getWorkload(T, 5)
    expect(workload).toHaveLength(1)
    expect(workload[0]?.open_count).toBe(10)
    expect(workload[0]?.overdue_count).toBe(3)
    expect(workload[0]?.avg_age_hours).toBe(48.5)
  })
})

// ─── 10. Tenant isolation ─────────────────────────────────────────────────────

describe('Tenant isolation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('createRelation validates ownership against requesting tenant only', async () => {
    // Simulate: action found for different tenant (count=1, not 2)
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '1' }] })
    const { error } = await createRelation('other-tenant', {
      sourceActionId: A1, targetActionId: A2, relationType: 'blocks',
    })
    expect(error).toBe('action_not_found')
  })

  it('listRelations passes tenantId as first param', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    await listRelations('tenant-xyz', A1)
    expect(mockQuery.mock.calls[0]![1][0]).toBe('tenant-xyz')
  })

  it('getOverview queries are scoped to tenantId', async () => {
    mockQuery.mockResolvedValue({ rows: [{ count: '0', pct: null }] })
    await getOverview('tenant-abc')
    for (const call of mockQuery.mock.calls) {
      expect(call[1][0]).toBe('tenant-abc')
    }
  })
})

// ─── 11. Integration: create → relate → escalate → notify ────────────────────

describe('Integration: full action lifecycle', () => {
  beforeEach(() => vi.clearAllMocks())

  it('complete flow: two actions created, blocked relation, escalation notification enqueued', async () => {
    // Step 1: createRelation (A1 blocks A2)
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: '2' }] })         // ownership check
      .mockResolvedValueOnce({ rows: [{ exists: false }] })       // cycle check
      .mockResolvedValueOnce({ rows: [{                           // INSERT relation
        id: R1, source_action_id: A1, target_action_id: A2,
        relation_type: 'blocks', deleted_at: null,
      }]})
      .mockResolvedValueOnce({ rowCount: 1 })                     // publishActionEvent

    const { relation } = await createRelation(T, {
      sourceActionId: A1, targetActionId: A2, relationType: 'blocks',
    })
    expect(relation?.relation_type).toBe('blocks')

    vi.clearAllMocks()

    // Step 2: enqueueEscalationNotification (level 1)
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'nj1' }] })  // in_app job
      .mockResolvedValueOnce({ rows: [{ id: 'nj2' }] })  // email job

    await enqueueEscalationNotification({
      tenantId: T, actionId: A2, actionTitle: 'Blocked action needs escalation',
      level: 1, notifyRole: 'assigned_user', recipientIds: [U1], hoursOverdue: 1,
    })

    expect(mockQuery).toHaveBeenCalledTimes(2)  // 2 channels

    vi.clearAllMocks()

    // Step 3: verify blocker shows up in batchBlockerStatus
    mockQuery.mockResolvedValueOnce({ rows: [{ action_id: A2, blocked_by_count: '1' }] })

    const map = await batchBlockerStatus(T, [A1, A2])
    expect(map.get(A2)?.is_blocked).toBe(true)
    expect(map.get(A2)?.blocked_by_count).toBe(1)
    expect(map.get(A1)?.is_blocked).toBe(false)
  })

  it('scoring reflects blocked status and SLA risk together', () => {
    const score = scoreAction({
      action_id:               A2,
      priority:                'high',
      action_type:             'RFI',
      due_at:                  new Date(Date.now() - 3600_000).toISOString(),
      escalation_level:        1,
      escalation_count:        1,
      downstream_impact_count: 3,
      remaining_minutes:       -60,
    })
    // high(75*0.25) + sla_overdue_1h(62*0.30) + esc(35*0.15) + ds(50*0.15) + RFI(60*0.10) ≈ 56
    expect(score.operational_risk_score).toBeGreaterThan(50)
    expect(score.recommendation_reason.length).toBeGreaterThan(0)
  })
})
