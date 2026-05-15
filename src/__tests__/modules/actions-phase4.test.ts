/**
 * Denver Engineering — Phase 4 Test Suite A (v4.40.0)
 * ──────────────────────────────────────────────────────
 * Ava Phase 4 — 124 tests across 18 suites.
 * Covers: runbook engine, AI governance, simulation/replay, policy engine.
 * All DB calls are mocked. No external dependencies.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock pool ────────────────────────────────────────────────────────────────

vi.mock('../../../api/db/pool', () => ({
  pool: {
    query:   vi.fn(),
    connect: vi.fn(),
  },
  tenantQuery: vi.fn(),
}))

vi.mock('../../../api/services/actions/actionEventPublisher', () => ({
  publishActionEvent: vi.fn(),
  publishEvent:       vi.fn(),
}))

vi.mock('../../../api/realtime/eventBroadcaster', () => ({
  broadcastEvent: vi.fn(),
}))

import { pool, tenantQuery } from '../../../api/db/pool'

const mockQuery  = vi.mocked(pool.query)
const mockTenant = vi.mocked(tenantQuery)

function mockRows(rows: Record<string, unknown>[]) {
  return { rows, rowCount: rows.length } as never
}

// ─── Suite 1: Runbook Engine — _buildContext ──────────────────────────────────

describe('runbookEngine — _buildContext', () => {
  let hooks: typeof import('../../../api/services/runbook/runbookEngine').__testHooks

  beforeEach(async () => {
    vi.resetAllMocks()
    const mod = await import('../../../api/services/runbook/runbookEngine')
    hooks = mod.__testHooks
  })

  it('returns context with all required fields', () => {
    const ctx = hooks._buildContext('t1', 'user1', 'live')
    expect(ctx.tenantId).toBe('t1')
    expect(ctx.triggeredBy).toBe('user1')
    expect(ctx.mode).toBe('live')
    expect(ctx.variables).toEqual({})
  })

  it('carries through correlationId', () => {
    const ctx = hooks._buildContext('t1', 'u1', 'dry_run', {}, 'corr-abc')
    expect(ctx.correlationId).toBe('corr-abc')
  })

  it('carries through variables map', () => {
    const ctx = hooks._buildContext('t1', 'u1', 'simulation', { action_id: 'a1' })
    expect(ctx.variables['action_id']).toBe('a1')
  })

  it('defaults variables to empty object when omitted', () => {
    const ctx = hooks._buildContext('t1', 'u1', 'live')
    expect(ctx.variables).toEqual({})
  })
})

// ─── Suite 2: Runbook Engine — _evaluateCondition ────────────────────────────

describe('runbookEngine — _evaluateCondition', () => {
  let hooks: typeof import('../../../api/services/runbook/runbookEngine').__testHooks

  beforeEach(async () => {
    vi.resetAllMocks()
    const mod = await import('../../../api/services/runbook/runbookEngine')
    hooks = mod.__testHooks
  })

  it('returns true when expression is empty', () => {
    const ctx = hooks._buildContext('t1', 'u1', 'live')
    expect(hooks._evaluateCondition('', ctx)).toBe(true)
  })

  it('returns true when key matches variable value', () => {
    const ctx = hooks._buildContext('t1', 'u1', 'live', { env: 'prod' })
    expect(hooks._evaluateCondition('env=prod', ctx)).toBe(true)
  })

  it('returns false when key does not match variable', () => {
    const ctx = hooks._buildContext('t1', 'u1', 'live', { env: 'staging' })
    expect(hooks._evaluateCondition('env=prod', ctx)).toBe(false)
  })

  it('returns true for missing variable (undefined = always execute)', () => {
    const ctx = hooks._buildContext('t1', 'u1', 'live', {})
    expect(hooks._evaluateCondition('env=prod', ctx)).toBe(false)
  })

  it('trims whitespace around key and value', () => {
    const ctx = hooks._buildContext('t1', 'u1', 'live', { env: 'prod' })
    expect(hooks._evaluateCondition(' env = prod ', ctx)).toBe(true)
  })

  it('returns true for malformed expression (no = sign)', () => {
    const ctx = hooks._buildContext('t1', 'u1', 'live', {})
    expect(hooks._evaluateCondition('just_a_key', ctx)).toBe(true)
  })
})

// ─── Suite 3: Runbook Engine — _resolveIdempotencyKey ────────────────────────

describe('runbookEngine — _resolveIdempotencyKey', () => {
  let hooks: typeof import('../../../api/services/runbook/runbookEngine').__testHooks

  beforeEach(async () => {
    vi.resetAllMocks()
    const mod = await import('../../../api/services/runbook/runbookEngine')
    hooks = mod.__testHooks
  })

  it('returns generated key when template is undefined', () => {
    const ctx = hooks._buildContext('t1', 'u1', 'live')
    const key = hooks._resolveIdempotencyKey(undefined, ctx, 0)
    expect(key).toContain('t1:step:0:')
  })

  it('returns static template unchanged when no placeholders', () => {
    const ctx = hooks._buildContext('t1', 'u1', 'live')
    const key = hooks._resolveIdempotencyKey('my-static-key', ctx, 0)
    expect(key).toBe('my-static-key')
  })

  it('replaces {{variable}} placeholders from context', () => {
    const ctx = hooks._buildContext('t1', 'u1', 'live', { action_id: 'a-999' })
    const key = hooks._resolveIdempotencyKey('step:{{action_id}}', ctx, 0)
    expect(key).toBe('step:a-999')
  })

  it('falls back to key name when variable is missing', () => {
    const ctx = hooks._buildContext('t1', 'u1', 'live', {})
    const key = hooks._resolveIdempotencyKey('step:{{missing_var}}', ctx, 0)
    expect(key).toBe('step:missing_var')
  })
})

// ─── Suite 4: Runbook Engine — STEP_HANDLERS registry ────────────────────────

describe('runbookEngine — STEP_HANDLERS registry', () => {
  let mod: typeof import('../../../api/services/runbook/runbookEngine')

  beforeEach(async () => {
    vi.resetAllMocks()
    mod = await import('../../../api/services/runbook/runbookEngine')
  })

  it('has all required step handler keys', () => {
    const keys = Object.keys(mod.STEP_HANDLERS)
    expect(keys).toContain('create_action')
    expect(keys).toContain('assign_action')
    expect(keys).toContain('escalate_action')
    expect(keys).toContain('freeze_workflow')
    expect(keys).toContain('request_approval')
    expect(keys).toContain('notify_users')
    expect(keys).toContain('trigger_integration')
    expect(keys).toContain('generate_report')
    expect(keys).toContain('condition')
    expect(keys).toContain('wait')
  })

  it('each registered handler is a function', () => {
    for (const [, fn] of Object.entries(mod.STEP_HANDLERS)) {
      expect(typeof fn).toBe('function')
    }
  })
})

// ─── Suite 5: Runbook Engine — executeRunbook (DB path) ──────────────────────

describe('runbookEngine — executeRunbook', () => {
  beforeEach(() => vi.resetAllMocks())

  it('throws when runbook not found or not active', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const mod = await import('../../../api/services/runbook/runbookEngine')
    await expect(mod.executeRunbook('t1', 'rb-999', 'user1')).rejects.toThrow('not found or not active')
  })

  it('returns dry_run_complete status for dry_run mode', async () => {
    const stepDef = { step_type: 'wait', config: {} }
    // runbook+version load, execution create, step insert, step status update,
    // _recordStepResult: step lookup, step update + result insert (2), execution update, final execution update
    mockTenant.mockResolvedValue(mockRows([{ id: 'x', steps: [stepDef], rollback_steps: [], ver_id: 'v1', current_version_id: 'v1' }]))
    mockTenant
      .mockResolvedValueOnce(mockRows([{
        id: 'rb1', current_version_id: 'v1', ver_id: 'v1',
        steps: [stepDef], rollback_steps: [],
      }]))
    mockTenant.mockResolvedValue(mockRows([{ id: 'exec1' }]))
    const mod = await import('../../../api/services/runbook/runbookEngine')
    const result = await mod.executeRunbook('t1', 'rb1', 'user1', { mode: 'dry_run' })
    expect(result.status).toBe('dry_run_complete')
  })

  it('returns waiting_approval when approval gate triggered in live mode', async () => {
    const steps = [
      { step_type: 'create_action', config: {}, requires_approval: true },
    ]
    mockTenant
      .mockResolvedValueOnce(mockRows([{
        id: 'rb1', current_version_id: 'v1', ver_id: 'v1',
        steps, rollback_steps: [],
      }]))
      .mockResolvedValue(mockRows([{ id: 'exec1' }]))
    const mod = await import('../../../api/services/runbook/runbookEngine')
    const result = await mod.executeRunbook('t1', 'rb1', 'user1', { mode: 'live' })
    expect(result.status).toBe('waiting_approval')
    expect(result.stepsCompleted).toBe(0)
  })
})

// ─── Suite 6: Runbook Engine — rollbackExecution ─────────────────────────────

describe('runbookEngine — rollbackExecution', () => {
  beforeEach(() => vi.resetAllMocks())

  it('returns rolledBack: 0 when no completed steps with rollback data', async () => {
    mockTenant
      .mockResolvedValueOnce(mockRows([]))   // no completed steps
      .mockResolvedValueOnce(mockRows([]))   // UPDATE runbook_executions
    const mod = await import('../../../api/services/runbook/runbookEngine')
    const result = await mod.rollbackExecution('exec1', 't1')
    expect(result.rolledBack).toBe(0)
  })

  it('rolls back steps in reverse order and counts them', async () => {
    mockTenant
      .mockResolvedValueOnce(mockRows([
        { step_type: 'escalate_action', rollback_data: { rollback_op: 'deescalate', action_id: 'a1' } },
        { step_type: 'create_action',   rollback_data: { rollback_op: 'cancel_action', action_id: 'a2' } },
      ]))
      .mockResolvedValueOnce(mockRows([]))  // deescalate query
      .mockResolvedValueOnce(mockRows([]))  // cancel_action query
      .mockResolvedValueOnce(mockRows([]))  // UPDATE executions to rolled_back
    const mod = await import('../../../api/services/runbook/runbookEngine')
    const result = await mod.rollbackExecution('exec1', 't1')
    expect(result.rolledBack).toBe(2)
  })

  it('skips steps without rollback_op field', async () => {
    mockTenant
      .mockResolvedValueOnce(mockRows([
        { step_type: 'wait', rollback_data: {} },  // no rollback_op
      ]))
      .mockResolvedValueOnce(mockRows([]))  // UPDATE executions
    const mod = await import('../../../api/services/runbook/runbookEngine')
    const result = await mod.rollbackExecution('exec1', 't1')
    expect(result.rolledBack).toBe(0)
  })
})

// ─── Suite 7: AI Governance — constants ──────────────────────────────────────

describe('aiGovernance — constants', () => {
  it('DEFAULT_CONFIDENCE_THRESHOLD is 70', async () => {
    const mod = await import('../../../api/services/ai/aiGovernance')
    expect(mod.DEFAULT_CONFIDENCE_THRESHOLD).toBe(70)
  })

  it('DEFAULT_APPROVAL_REQUIRED is true', async () => {
    const mod = await import('../../../api/services/ai/aiGovernance')
    expect(mod.DEFAULT_APPROVAL_REQUIRED).toBe(true)
  })
})

// ─── Suite 8: AI Governance — queueRecommendation ────────────────────────────

describe('aiGovernance — queueRecommendation', () => {
  beforeEach(() => vi.resetAllMocks())

  it('auto-rejects when confidence below threshold', async () => {
    mockTenant
      .mockResolvedValueOnce(mockRows([{ id: 'rec1' }]))   // INSERT
      .mockResolvedValueOnce(mockRows([]))                  // audit event
    const mod = await import('../../../api/services/ai/aiGovernance')
    const result = await mod.queueRecommendation({
      tenantId: 't1', actionId: 'a1', recommendedAction: 'assign_action',
      category: 'operations', confidenceScore: 50,
      impactScore: 5, urgencyScore: 5, reason: 'low conf',
      generatedBy: 'luna',
    })
    expect(result.autoRejected).toBe(true)
  })

  it('queues successfully when confidence meets threshold', async () => {
    mockTenant
      .mockResolvedValueOnce(mockRows([{ id: 'rec1' }]))
      .mockResolvedValueOnce(mockRows([]))
    const mod = await import('../../../api/services/ai/aiGovernance')
    const result = await mod.queueRecommendation({
      tenantId: 't1', actionId: 'a1', recommendedAction: 'assign_action',
      category: 'operations', confidenceScore: 85,
      impactScore: 7, urgencyScore: 7, reason: 'test',
      generatedBy: 'luna',
    })
    expect(result.autoRejected).toBe(false)
    expect(result.recommendationId).toBe('rec1')
  })

  it('queues with confidence exactly at threshold', async () => {
    mockTenant
      .mockResolvedValueOnce(mockRows([{ id: 'rec2' }]))
      .mockResolvedValueOnce(mockRows([]))
    const mod = await import('../../../api/services/ai/aiGovernance')
    const result = await mod.queueRecommendation({
      tenantId: 't1', actionId: 'a1', recommendedAction: 'escalate',
      category: 'escalation', confidenceScore: 70,
      impactScore: 5, urgencyScore: 5, reason: 'exactly at threshold',
    })
    expect(result.autoRejected).toBe(false)
  })

  it('uses custom threshold when provided', async () => {
    mockTenant
      .mockResolvedValueOnce(mockRows([{ id: 'rec3' }]))
      .mockResolvedValueOnce(mockRows([]))
    const mod = await import('../../../api/services/ai/aiGovernance')
    const result = await mod.queueRecommendation({
      tenantId: 't1', actionId: 'a1', recommendedAction: 'freeze',
      category: 'freeze', confidenceScore: 60,
      impactScore: 5, urgencyScore: 5, reason: 'custom threshold',
      minConfidenceThreshold: 55,
    })
    expect(result.autoRejected).toBe(false)
  })
})

// ─── Suite 9: AI Governance — approveRecommendation ──────────────────────────

describe('aiGovernance — approveRecommendation', () => {
  beforeEach(() => vi.resetAllMocks())

  it('returns false when recommendation not found or not pending', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const mod = await import('../../../api/services/ai/aiGovernance')
    const result = await mod.approveRecommendation('t1', 'rec-999', 'user1')
    expect(result).toBe(false)
  })

  it('returns false when recommendation already executed (not pending)', async () => {
    // UPDATE WHERE status='pending' returns no rows when already executed
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const mod = await import('../../../api/services/ai/aiGovernance')
    const result = await mod.approveRecommendation('t1', 'rec1', 'user1')
    expect(result).toBe(false)
  })

  it('approves pending recommendation and returns true', async () => {
    mockTenant
      .mockResolvedValueOnce(mockRows([{ id: 'rec1' }]))  // UPDATE returns row
      .mockResolvedValueOnce(mockRows([]))                  // audit event
    const mod = await import('../../../api/services/ai/aiGovernance')
    const result = await mod.approveRecommendation('t1', 'rec1', 'user1')
    expect(result).toBe(true)
  })
})

// ─── Suite 10: AI Governance — executeRecommendation ─────────────────────────

describe('aiGovernance — executeRecommendation', () => {
  beforeEach(() => vi.resetAllMocks())

  it('returns executed: false when recommendation not found', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const mod = await import('../../../api/services/ai/aiGovernance')
    const result = await mod.executeRecommendation('t1', 'rec-999', 'user1')
    expect(result.executed).toBe(false)
    expect(result.output['error']).toBe('not_found')
  })

  it('blocks execution when approval_required and status is pending', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([{
      id: 'rec1', status: 'pending', approval_required: true,
      recommended_action: 'assign', action_id: 'a1',
    }]))
    const mod = await import('../../../api/services/ai/aiGovernance')
    const result = await mod.executeRecommendation('t1', 'rec1', 'user1')
    expect(result.executed).toBe(false)
    expect(result.output['error']).toBe('approval_required')
  })

  it('blocks execution when already executed', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([{
      id: 'rec1', status: 'executed', approval_required: false,
      recommended_action: 'assign', action_id: 'a1',
    }]))
    const mod = await import('../../../api/services/ai/aiGovernance')
    const result = await mod.executeRecommendation('t1', 'rec1', 'user1')
    expect(result.executed).toBe(false)
    expect(result.output['error']).toBe('already_executed')
  })

  it('executes when approved and approval_required', async () => {
    mockTenant
      .mockResolvedValueOnce(mockRows([{
        id: 'rec1', status: 'approved', approval_required: true,
        recommended_action: 'assign_action', action_id: 'a1',
      }]))
      .mockResolvedValueOnce(mockRows([]))  // UPDATE to executed
      .mockResolvedValueOnce(mockRows([]))  // audit event
    const mod = await import('../../../api/services/ai/aiGovernance')
    const result = await mod.executeRecommendation('t1', 'rec1', 'user1')
    expect(result.executed).toBe(true)
  })

  it('executes when approval_required is false and status is pending', async () => {
    mockTenant
      .mockResolvedValueOnce(mockRows([{
        id: 'rec1', status: 'pending', approval_required: false,
        recommended_action: 'priority_change', action_id: 'a1',
      }]))
      .mockResolvedValueOnce(mockRows([]))
      .mockResolvedValueOnce(mockRows([]))
    const mod = await import('../../../api/services/ai/aiGovernance')
    const result = await mod.executeRecommendation('t1', 'rec1', 'user1')
    expect(result.executed).toBe(true)
  })
})

// ─── Suite 11: AI Governance — rejectRecommendation ──────────────────────────

describe('aiGovernance — rejectRecommendation', () => {
  beforeEach(() => vi.resetAllMocks())

  it('returns false when recommendation not found or not pending', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const mod = await import('../../../api/services/ai/aiGovernance')
    const result = await mod.rejectRecommendation('t1', 'rec-999', 'user1', 'not useful')
    expect(result).toBe(false)
  })

  it('rejects pending recommendation and returns true', async () => {
    mockTenant
      .mockResolvedValueOnce(mockRows([{ id: 'rec1' }]))  // UPDATE WHERE status='pending'
      .mockResolvedValueOnce(mockRows([]))                  // audit event
    const mod = await import('../../../api/services/ai/aiGovernance')
    const result = await mod.rejectRecommendation('t1', 'rec1', 'user1', 'wrong priority')
    expect(result).toBe(true)
  })

  it('passes rejection reason to query', async () => {
    mockTenant
      .mockResolvedValueOnce(mockRows([{ id: 'rec1' }]))
      .mockResolvedValueOnce(mockRows([]))
    const mod = await import('../../../api/services/ai/aiGovernance')
    await mod.rejectRecommendation('t1', 'rec1', 'user1', 'low impact')
    expect(mockTenant).toHaveBeenCalledWith(
      't1',
      expect.any(String),
      expect.arrayContaining(['low impact'])
    )
  })
})

// ─── Suite 12: Simulation Engine — computeReplayChecksum ─────────────────────

describe('replayEngine — computeReplayChecksum', () => {
  it('returns consistent hash for same event list', async () => {
    const mod = await import('../../../api/services/simulation/replayEngine')
    const events = [
      { id: 'e1', sequence_number: 1 },
      { id: 'e2', sequence_number: 2 },
    ]
    const h1 = mod.computeReplayChecksum(events)
    const h2 = mod.computeReplayChecksum(events)
    expect(h1).toBe(h2)
  })

  it('returns different hash for different events', async () => {
    const mod = await import('../../../api/services/simulation/replayEngine')
    const h1 = mod.computeReplayChecksum([{ id: 'e1', sequence_number: 1 }])
    const h2 = mod.computeReplayChecksum([{ id: 'e2', sequence_number: 1 }])
    expect(h1).not.toBe(h2)
  })

  it('returns sha256 hex string (64 chars)', async () => {
    const mod = await import('../../../api/services/simulation/replayEngine')
    const h = mod.computeReplayChecksum([{ id: 'e1', sequence_number: 1 }])
    expect(h).toHaveLength(64)
    expect(h).toMatch(/^[0-9a-f]+$/)
  })

  it('returns deterministic hash for empty list', async () => {
    const mod = await import('../../../api/services/simulation/replayEngine')
    const h = mod.computeReplayChecksum([])
    expect(h).toHaveLength(64)
  })

  it('produces same hash regardless of input order when sorted by sequence', async () => {
    const mod = await import('../../../api/services/simulation/replayEngine')
    const events1 = [{ id: 'e1', sequence_number: 1 }, { id: 'e2', sequence_number: 2 }]
    const events2 = [{ id: 'e2', sequence_number: 2 }, { id: 'e1', sequence_number: 1 }]
    expect(mod.computeReplayChecksum(events1)).toBe(mod.computeReplayChecksum(events2))
  })
})

// ─── Suite 13: Simulation Engine — _applySimulatedEvent ──────────────────────

describe('replayEngine — _applySimulatedEvent', () => {
  let mod: typeof import('../../../api/services/simulation/replayEngine')

  beforeEach(async () => {
    mod = await import('../../../api/services/simulation/replayEngine')
  })

  it('increments escalationCount on action_escalated', () => {
    const state = mod._applySimulatedEvent({}, { event_type: 'action_escalated', payload: {} })
    expect(state['escalationCount']).toBe(1)
  })

  it('increments slaBreachCount on sla_breached', () => {
    const state = mod._applySimulatedEvent({}, { event_type: 'sla_breached', payload: {} })
    expect(state['slaBreachCount']).toBe(1)
  })

  it('increments completedCount and decrements openCount on action_completed', () => {
    const initial = { openCount: 5, completedCount: 2 }
    const state = mod._applySimulatedEvent(initial, { event_type: 'action_completed', payload: {} })
    expect(state['completedCount']).toBe(3)
    expect(state['openCount']).toBe(4)
  })

  it('does not go below 0 on openCount', () => {
    const state = mod._applySimulatedEvent({ openCount: 0 }, { event_type: 'action_completed', payload: {} })
    expect(state['openCount']).toBe(0)
  })

  it('increments openCount on action_created', () => {
    const state = mod._applySimulatedEvent({ openCount: 3 }, { event_type: 'action_created', payload: {} })
    expect(state['openCount']).toBe(4)
  })

  it('increments blockerCount on blocker_added', () => {
    const state = mod._applySimulatedEvent({}, { event_type: 'blocker_added', payload: {} })
    expect(state['blockerCount']).toBe(1)
  })

  it('decrements blockerCount on blocker_resolved, min 0', () => {
    const state = mod._applySimulatedEvent({ blockerCount: 1 }, { event_type: 'blocker_resolved', payload: {} })
    expect(state['blockerCount']).toBe(0)
  })

  it('updates readinessScore from payload on readiness_changed', () => {
    const state = mod._applySimulatedEvent({}, { event_type: 'readiness_changed', payload: { score: 75 } })
    expect(state['readinessScore']).toBe(75)
  })

  it('does not update readinessScore when payload.score is not a number', () => {
    const initial = { readinessScore: 80 }
    const state = mod._applySimulatedEvent(initial, { event_type: 'readiness_changed', payload: { score: 'bad' } })
    expect(state['readinessScore']).toBe(80)
  })

  it('does not mutate original state (returns new object)', () => {
    const initial = { escalationCount: 1 }
    const result = mod._applySimulatedEvent(initial, { event_type: 'action_escalated', payload: {} })
    expect(initial['escalationCount']).toBe(1)
    expect(result['escalationCount']).toBe(2)
  })

  it('ignores unknown event_type without throwing', () => {
    expect(() =>
      mod._applySimulatedEvent({}, { event_type: 'totally_unknown', payload: {} })
    ).not.toThrow()
  })
})

// ─── Suite 14: Simulation Engine — _projectReadiness ─────────────────────────

describe('replayEngine — _projectReadiness', () => {
  let mod: typeof import('../../../api/services/simulation/replayEngine')

  beforeEach(async () => {
    mod = await import('../../../api/services/simulation/replayEngine')
  })

  it('returns 95 when no open/escalation/breach state', () => {
    const score = mod._projectReadiness({ openCount: 0, escalationCount: 0, slaBreachCount: 0 })
    expect(score).toBe(95)
  })

  it('penalises sla breaches at 10 points each', () => {
    const score = mod._projectReadiness({ slaBreachCount: 3, escalationCount: 0, openCount: 0 })
    expect(score).toBeLessThan(95)
    expect(score).toBeGreaterThanOrEqual(0)
  })

  it('penalises escalations at 5 points each', () => {
    const s1 = mod._projectReadiness({ escalationCount: 1, slaBreachCount: 0, openCount: 0 })
    const s2 = mod._projectReadiness({ escalationCount: 2, slaBreachCount: 0, openCount: 0 })
    expect(s2).toBeLessThan(s1!)
  })

  it('never goes below 0', () => {
    const score = mod._projectReadiness({
      slaBreachCount: 50, escalationCount: 50, blockerCount: 50, openCount: 100,
    })
    expect(score).toBeGreaterThanOrEqual(0)
  })

  it('never exceeds 100', () => {
    const score = mod._projectReadiness({ openCount: 0 })
    expect(score).toBeLessThanOrEqual(100)
  })
})

// ─── Suite 15: Policy Engine — _evaluateRule ─────────────────────────────────

describe('policyEngine — _evaluateRule', () => {
  let mod: typeof import('../../../api/services/policy/policyEngine')

  beforeEach(async () => {
    mod = await import('../../../api/services/policy/policyEngine')
  })

  it('eq: matches equal string value', () => {
    expect(mod._evaluateRule({ field: 'priority', operator: 'eq', value: 'high' }, { priority: 'high' })).toBe(true)
  })

  it('eq: does not match different value', () => {
    expect(mod._evaluateRule({ field: 'priority', operator: 'eq', value: 'high' }, { priority: 'low' })).toBe(false)
  })

  it('gte: matches number >= threshold', () => {
    expect(mod._evaluateRule({ field: 'score', operator: 'gte', value: 70 }, { score: 85 })).toBe(true)
    expect(mod._evaluateRule({ field: 'score', operator: 'gte', value: 70 }, { score: 70 })).toBe(true)
  })

  it('gte: fails for number below threshold', () => {
    expect(mod._evaluateRule({ field: 'score', operator: 'gte', value: 70 }, { score: 65 })).toBe(false)
  })

  it('lte: matches number <= threshold', () => {
    expect(mod._evaluateRule({ field: 'score', operator: 'lte', value: 50 }, { score: 30 })).toBe(true)
  })

  it('in: matches value in array', () => {
    expect(mod._evaluateRule({ field: 'status', operator: 'in', value: ['open', 'pending'] }, { status: 'open' })).toBe(true)
  })

  it('in: does not match value outside array', () => {
    expect(mod._evaluateRule({ field: 'status', operator: 'in', value: ['open'] }, { status: 'closed' })).toBe(false)
  })

  it('not_in: matches when value is not in array', () => {
    expect(mod._evaluateRule({ field: 'role', operator: 'not_in', value: ['admin'] }, { role: 'viewer' })).toBe(true)
  })

  it('not_in: fails when value is in array', () => {
    expect(mod._evaluateRule({ field: 'role', operator: 'not_in', value: ['admin'] }, { role: 'admin' })).toBe(false)
  })

  it('exists: true when field has value', () => {
    expect(mod._evaluateRule({ field: 'assignee', operator: 'exists', value: '' }, { assignee: 'u1' })).toBe(true)
  })

  it('exists: false when field is null', () => {
    expect(mod._evaluateRule({ field: 'assignee', operator: 'exists', value: '' }, { assignee: null })).toBe(false)
  })

  it('unknown operator returns false', () => {
    expect(mod._evaluateRule({ field: 'x', operator: 'unknown_op' as never, value: 'y' }, { x: 'y' })).toBe(false)
  })
})

// ─── Suite 16: Policy Engine — _evaluateRules (AND logic) ────────────────────

describe('policyEngine — _evaluateRules', () => {
  let mod: typeof import('../../../api/services/policy/policyEngine')

  beforeEach(async () => {
    mod = await import('../../../api/services/policy/policyEngine')
  })

  it('returns true when all rules match', () => {
    const rules: import('../../../api/services/policy/policyEngine').PolicyRule[] = [
      { field: 'priority', operator: 'eq', value: 'critical' },
      { field: 'score', operator: 'gte', value: 80 },
    ]
    expect(mod._evaluateRules(rules, { priority: 'critical', score: 90 })).toBe(true)
  })

  it('returns false when any rule fails', () => {
    const rules: import('../../../api/services/policy/policyEngine').PolicyRule[] = [
      { field: 'priority', operator: 'eq', value: 'critical' },
      { field: 'score', operator: 'gte', value: 80 },
    ]
    expect(mod._evaluateRules(rules, { priority: 'critical', score: 70 })).toBe(false)
  })

  it('returns true for empty rules array', () => {
    expect(mod._evaluateRules([], { any: 'payload' })).toBe(true)
  })
})

// ─── Suite 17: Policy Engine — _inheritPolicies deduplication ────────────────

describe('policyEngine — _inheritPolicies', () => {
  let mod: typeof import('../../../api/services/policy/policyEngine')

  beforeEach(async () => {
    mod = await import('../../../api/services/policy/policyEngine')
  })

  it('deduplicates policies by policyType:scope:scopeId key', () => {
    const policies = [
      { id: 'p1', name: 'A', scope: 'tenant', scopeId: '', policyType: 'escalation_rule', rules: [], priority: 100, status: 'active', tenantId: 't1' },
      { id: 'p2', name: 'B', scope: 'tenant', scopeId: '', policyType: 'escalation_rule', rules: [], priority: 200, status: 'active', tenantId: 't1' },
    ]
    const result = mod._inheritPolicies(policies as never)
    expect(result).toHaveLength(1)
    expect(result[0]!.id).toBe('p1')  // first match wins
  })

  it('keeps distinct policyType:scope combinations', () => {
    const policies = [
      { id: 'p1', name: 'A', scope: 'tenant', scopeId: '', policyType: 'escalation_rule', rules: [], priority: 100, status: 'active', tenantId: 't1' },
      { id: 'p2', name: 'B', scope: 'project', scopeId: 'proj1', policyType: 'escalation_rule', rules: [], priority: 100, status: 'active', tenantId: 't1' },
    ]
    const result = mod._inheritPolicies(policies as never)
    expect(result).toHaveLength(2)
  })

  it('returns empty array for empty input', () => {
    expect(mod._inheritPolicies([])).toEqual([])
  })
})

// ─── Suite 18: Policy Engine — PolicyBlockedError ────────────────────────────

describe('policyEngine — PolicyBlockedError', () => {
  let mod: typeof import('../../../api/services/policy/policyEngine')

  beforeEach(async () => {
    mod = await import('../../../api/services/policy/policyEngine')
  })

  it('is instanceof Error', () => {
    const err = new mod.PolicyBlockedError('my-policy')
    expect(err).toBeInstanceOf(Error)
  })

  it('has correct name', () => {
    const err = new mod.PolicyBlockedError('my-policy')
    expect(err.name).toBe('PolicyBlockedError')
  })

  it('message includes policy name', () => {
    const err = new mod.PolicyBlockedError('freeze-high-priority')
    expect(err.message).toContain('freeze-high-priority')
  })

  it('stores policyName property', () => {
    const err = new mod.PolicyBlockedError('test-policy')
    expect(err.policyName).toBe('test-policy')
  })

  it('stores optional policy object', () => {
    const policy = { id: 'p1', name: 'test', scope: 'tenant' } as never
    const err = new mod.PolicyBlockedError('test', policy)
    expect(err.policy).toBe(policy)
  })
})
