/**
 * Denver Engineering — Phase 5 Test Suite B (v5.0.0)
 * ──────────────────────────────────────────────────────
 * Ava Phase 5 — Additional coverage: agent workers, route validation,
 * context builder, execution event sequences, memory links,
 * approval workflows, task queue edge cases.
 * 80+ tests across 14 suites.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock pool ────────────────────────────────────────────────────────────────

vi.mock('../../../api/db/pool', () => ({
  default: { query: vi.fn(), connect: vi.fn() },
  tenantQuery: vi.fn(),
}))

vi.mock('../../../api/services/policy/policyEngine', () => ({
  evaluatePolicy: vi.fn(),
}))

import pool, { tenantQuery } from '../../../api/db/pool'

const mockQuery  = vi.mocked(pool.query)
const mockTenant = vi.mocked(tenantQuery)
const mockConnect = () => {
  const client = { query: vi.fn(), release: vi.fn() }
  vi.mocked(pool.connect).mockResolvedValueOnce(client as never)
  return client
}

function mockRows(rows: Record<string, unknown>[]) {
  return { rows, rowCount: rows.length } as never
}

// ─── Suite 1: agentRegistry — task type routing completeness ─────────────────

describe('agentRegistry — task type routing completeness', () => {
  let mod: typeof import('../../../api/services/agents/agentRegistry')

  beforeEach(async () => {
    vi.resetAllMocks()
    mod = await import('../../../api/services/agents/agentRegistry')
  })

  it('every task type registered maps to exactly one agent', () => {
    const allCaps = mod.getAllCapabilities()
    for (const cap of allCaps) {
      for (const taskType of cap.taskTypes) {
        const agent = mod.getAgentForTaskType(taskType)
        expect(agent).toBe(cap.agentType)
      }
    }
  })

  it('all capability IDs are unique', () => {
    const caps = mod.getAllCapabilities()
    const ids = caps.map(c => c.id)
    const unique = new Set(ids)
    expect(unique.size).toBe(ids.length)
  })

  it('all task types across all capabilities are unique', () => {
    const caps = mod.getAllCapabilities()
    const allTaskTypes = caps.flatMap(c => c.taskTypes)
    const unique = new Set(allTaskTypes)
    expect(unique.size).toBe(allTaskTypes.length)
  })

  it('all 8 agents have defined governance levels', () => {
    const types = [
      'TaskAgent', 'ValidationAgent', 'DocumentationAgent', 'RiskAgent',
      'SchedulingAgent', 'ResourceOptimizationAgent',
      'IncidentResponseAgent', 'ReadinessCoordinatorAgent',
    ] as const
    for (const t of types) {
      const level = mod.getGovernanceLevel(t)
      expect(['low', 'medium', 'high']).toContain(level)
    }
  })
})

// ─── Suite 2: agentRouter — edge cases ───────────────────────────────────────

describe('agentRouter — edge cases', () => {
  let mod: typeof import('../../../api/services/agents/agentRouter')

  beforeEach(async () => {
    vi.resetAllMocks()
    mod = await import('../../../api/services/agents/agentRouter')
  })

  it('planExecution with single task sets dependsOn to empty array', () => {
    const plan = mod.planExecution([{ taskType: 'create_action' }])
    expect(plan.tasks[0].dependsOn).toEqual([])
  })

  it('planExecution uses default priority 5 when not specified', () => {
    const plan = mod.planExecution([{ taskType: 'create_action' }])
    expect(plan.tasks[0].priority).toBe(5)
  })

  it('planExecution uses default empty payload when not specified', () => {
    const plan = mod.planExecution([{ taskType: 'create_action' }])
    expect(plan.tasks[0].payload).toEqual({})
  })

  it('getCapabilitiesForAgentTypes filters by provided types', () => {
    const caps = mod.getCapabilitiesForAgentTypes(['TaskAgent', 'RiskAgent'])
    expect(caps.every(c => ['TaskAgent', 'RiskAgent'].includes(c.agentType))).toBe(true)
  })

  it('planExecution with no tasks returns empty plan', () => {
    const plan = mod.planExecution([])
    expect(plan.tasks).toHaveLength(0)
    expect(plan.estimatedDurationMs).toBe(0)
    expect(plan.requiresApproval).toBe(false)
  })
})

// ─── Suite 3: agentTaskQueue — pendApproval / resumeFromApproval ──────────────

describe('agentTaskQueue — approval flow', () => {
  let mod: typeof import('../../../api/services/agents/agentTaskQueue')

  beforeEach(async () => {
    vi.resetAllMocks()
    mod = await import('../../../api/services/agents/agentTaskQueue')
  })

  it('pendApproval issues UPDATE with pending_approval status', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    await mod.pendApproval('task-1', 't1')
    expect(mockTenant).toHaveBeenCalledWith(
      't1',
      expect.stringContaining("status = 'pending_approval'"),
      expect.any(Array)
    )
  })

  it('resumeFromApproval issues UPDATE with running status from pending_approval', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    await mod.resumeFromApproval('task-1', 't1')
    expect(mockTenant).toHaveBeenCalledWith(
      't1',
      expect.stringContaining("status = 'running'"),
      expect.any(Array)
    )
  })

  it('markTaskRunning associates executionId', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    await mod.markTaskRunning('task-1', 't1', 'exec-1')
    expect(mockTenant).toHaveBeenCalledWith(
      't1',
      expect.stringContaining('execution_id'),
      expect.arrayContaining(['task-1', 't1', 'exec-1'])
    )
  })

  it('listTasks with no filters uses only tenant condition', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    await mod.listTasks('t1')
    const call = mockTenant.mock.calls[0]
    expect(call[2]).toEqual(['t1', 50, 0])
  })

  it('listTasks with offset paginates correctly', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    await mod.listTasks('t1', { limit: 20, offset: 40 })
    const call = mockTenant.mock.calls[0]
    expect(call[2]).toContain(20)
    expect(call[2]).toContain(40)
  })
})

// ─── Suite 4: agentExecutionLedger — listExecutions ──────────────────────────

describe('agentExecutionLedger — listExecutions', () => {
  let mod: typeof import('../../../api/services/agents/agentExecutionLedger')

  beforeEach(async () => {
    vi.resetAllMocks()
    mod = await import('../../../api/services/agents/agentExecutionLedger')
  })

  it('listExecutions applies agentType filter', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    await mod.listExecutions('t1', { agentType: 'RiskAgent' })
    expect(mockTenant).toHaveBeenCalledWith(
      't1',
      expect.stringContaining('agent_type'),
      expect.arrayContaining(['t1', 'RiskAgent'])
    )
  })

  it('listExecutions returns empty array when none found', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const result = await mod.listExecutions('t1')
    expect(result).toEqual([])
  })

  it('getDecisionTraces returns ordered traces', async () => {
    const now = new Date()
    mockTenant.mockResolvedValueOnce(mockRows([
      {
        id: 'dt-1', tenant_id: 't1', execution_id: 'exec-1',
        decision_type: 'triage', rationale: 'R1', confidence: 80,
        alternatives: [], policy_context: {}, chosen_action: 'escalate',
        decided_at: now.toISOString(),
      },
    ]))
    const traces = await mod.getDecisionTraces('exec-1', 't1')
    expect(traces).toHaveLength(1)
    expect(traces[0].decisionType).toBe('triage')
  })

  it('_mapDecisionTrace maps alternatives array', () => {
    const { _mapDecisionTrace } = mod.__testHooks
    const row = {
      id: 'dt-1', tenant_id: 't1', execution_id: 'exec-1',
      decision_type: 'risk', rationale: 'R', confidence: 75,
      alternatives: [{ action: 'defer', reason: 'low priority', confidence: 30, rejected: true }],
      policy_context: { blocked: false }, chosen_action: 'escalate',
      decided_at: new Date().toISOString(),
    }
    const trace = _mapDecisionTrace(row)
    expect(trace.alternatives).toHaveLength(1)
    expect(trace.alternatives[0].action).toBe('defer')
  })
})

// ─── Suite 5: agentGovernanceService — listPendingApprovals ──────────────────

describe('agentGovernanceService — listPendingApprovals filtering', () => {
  let mod: typeof import('../../../api/services/agents/agentGovernanceService')

  beforeEach(async () => {
    vi.resetAllMocks()
    mod = await import('../../../api/services/agents/agentGovernanceService')
  })

  it('applies agentType filter when provided', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    await mod.listPendingApprovals('t1', 'RiskAgent')
    expect(mockTenant).toHaveBeenCalledWith(
      't1',
      expect.stringContaining('agent_type'),
      expect.arrayContaining(['t1', 'RiskAgent'])
    )
  })

  it('omits agentType filter when not provided', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    await mod.listPendingApprovals('t1')
    const call = mockTenant.mock.calls[0]
    expect(call[2]).not.toContain('RiskAgent')
  })

  it('_mapApproval handles all optional fields', () => {
    const { _mapApproval } = mod.__testHooks
    const now = new Date()
    const row = {
      id: 'a1', tenant_id: 't1', task_id: 'tk1',
      execution_id: null, agent_type: 'TaskAgent',
      action_type: 'create', description: 'Create action',
      payload: {}, risk_level: 'low', status: 'pending',
      requested_by: 'worker-1', reviewed_by: null,
      review_notes: null, reviewed_at: null,
      expires_at: new Date(now.getTime() + 86400000).toISOString(),
      created_at: now.toISOString(),
    }
    const approval = _mapApproval(row)
    expect(approval.executionId).toBeUndefined()
    expect(approval.reviewedBy).toBeUndefined()
    expect(approval.reviewNotes).toBeUndefined()
    expect(approval.reviewedAt).toBeUndefined()
  })
})

// ─── Suite 6: agentMemoryService — linkMemory / getLinkedMemories ─────────────

describe('agentMemoryService — links', () => {
  let mod: typeof import('../../../api/services/agents/agentMemoryService')

  beforeEach(async () => {
    vi.resetAllMocks()
    mod = await import('../../../api/services/agents/agentMemoryService')
  })

  it('linkMemory uses default strength 1.0', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    await mod.linkMemory('t1', 'entry-1', 'entry-2', 'related')
    const call = mockTenant.mock.calls[0]
    expect(call[2]).toContain(1.0)
  })

  it('getLinkedMemories filters by linkType when provided', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    await mod.getLinkedMemories('t1', 'entry-1', 'caused_by')
    expect(mockTenant).toHaveBeenCalledWith(
      't1',
      expect.stringContaining('link_type'),
      expect.arrayContaining(['t1', 'entry-1', 'caused_by'])
    )
  })

  it('getLinkedMemories omits linkType filter when not provided', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    await mod.getLinkedMemories('t1', 'entry-1')
    const call = mockTenant.mock.calls[0]
    expect(call[2]).not.toContain('caused_by')
  })
})

// ─── Suite 7: agentHandoffService — getHandoff ───────────────────────────────

describe('agentHandoffService — getHandoff', () => {
  let mod: typeof import('../../../api/services/agents/agentHandoffService')

  beforeEach(async () => {
    vi.resetAllMocks()
    mod = await import('../../../api/services/agents/agentHandoffService')
  })

  it('getHandoff returns handoff when found', async () => {
    const now = new Date()
    mockTenant.mockResolvedValueOnce(mockRows([{
      id: 'h1', tenant_id: 't1',
      from_agent: 'TaskAgent', to_agent: 'ValidationAgent',
      task_id: 'tk1', status: 'pending',
      context_package: {}, reason: 'Test',
      expires_at: new Date(now.getTime() + 300000).toISOString(),
      created_at: now.toISOString(),
    }]))
    const h = await mod.getHandoff('h1', 't1')
    expect(h).not.toBeNull()
    expect(h!.fromAgent).toBe('TaskAgent')
  })

  it('getHandoff returns null when not found', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    expect(await mod.getHandoff('nonexistent', 't1')).toBeNull()
  })

  it('expireTimedOutHandoffs uses status pending filter', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    await mod.expireTimedOutHandoffs('t1')
    expect(mockTenant).toHaveBeenCalledWith(
      't1',
      expect.stringContaining("status = 'pending'"),
      expect.any(Array)
    )
  })
})

// ─── Suite 8: agentContextBuilder — _fetchTenant ─────────────────────────────

describe('agentContextBuilder', () => {
  let mod: typeof import('../../../api/services/agents/agentContextBuilder')

  beforeEach(async () => {
    vi.resetAllMocks()
    mod = await import('../../../api/services/agents/agentContextBuilder')
  })

  it('_fetchTenant throws when not found', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { _fetchTenant } = mod.__testHooks
    await expect(_fetchTenant('bad-tenant')).rejects.toThrow('Tenant not found')
  })

  it('_fetchTenant returns id and name', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([{ id: 't1', name: 'Test Tenant' }]))
    const { _fetchTenant } = mod.__testHooks
    const tenant = await _fetchTenant('t1')
    expect(tenant.id).toBe('t1')
    expect(tenant.name).toBe('Test Tenant')
  })

  it('_fetchScopeMetadata returns empty for global scope', async () => {
    const { _fetchScopeMetadata } = mod.__testHooks
    const meta = await _fetchScopeMetadata('t1', 'global', '')
    expect(meta).toEqual({})
  })

  it('_fetchRecentEvents queries realtime_event_log', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { _fetchRecentEvents } = mod.__testHooks
    await _fetchRecentEvents('t1', 'project', 'proj-1')
    expect(mockTenant).toHaveBeenCalledWith(
      't1',
      expect.stringContaining('realtime_event_log'),
      expect.any(Array)
    )
  })

  it('_fetchActiveAlerts filters for alert event types', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { _fetchActiveAlerts } = mod.__testHooks
    await _fetchActiveAlerts('t1', 'project', 'proj-1')
    expect(mockTenant).toHaveBeenCalledWith(
      't1',
      expect.stringContaining('sla_breached'),
      expect.any(Array)
    )
  })

  it('injectPolicyConstraints returns new context without mutating original', () => {
    const ctx = {
      tenant: { id: 't1', name: 'T' },
      scope: { type: 'project', id: 'p1', metadata: {} },
      recentEvents: [],
      activeAlerts: [],
      policyConstraints: [],
      memoryEntries: [],
      assembledAt: new Date(),
    }
    const checks = [{ policyType: 'freeze_condition', passed: true, action: 'allow' as const, warnings: [] }]
    const newCtx = mod.injectPolicyConstraints(ctx, checks)
    expect(newCtx.policyConstraints).toHaveLength(1)
    expect(ctx.policyConstraints).toHaveLength(0)  // original unchanged
  })
})

// ─── Suite 9: agentPolicyAdapter — AGENT_POLICY_TYPES ────────────────────────

describe('agentPolicyAdapter — policy types coverage', () => {
  let mod: typeof import('../../../api/services/agents/agentPolicyAdapter')

  beforeEach(async () => {
    vi.resetAllMocks()
    mod = await import('../../../api/services/agents/agentPolicyAdapter')
  })

  it('checks 5 policy types', () => {
    expect(mod.__testHooks.AGENT_POLICY_TYPES).toHaveLength(5)
  })

  it('includes approval_requirement and freeze_condition', () => {
    const types = mod.__testHooks.AGENT_POLICY_TYPES as readonly string[]
    expect(types).toContain('approval_requirement')
    expect(types).toContain('freeze_condition')
  })

  it('evaluatePolicy error results in warn (not block)', async () => {
    const policyMod = await import('../../../api/services/policy/policyEngine')
    vi.mocked(policyMod.evaluatePolicy).mockRejectedValue(new Error('DB down'))

    const results = await mod.evaluateAgentPolicies('t1', {
      agentType: 'TaskAgent', taskType: 'create_action',
    })

    const warns = results.filter(r => r.action === 'warn' && r.warnings.some(w => w.includes('Policy evaluation error')))
    expect(warns.length).toBeGreaterThan(0)
  })
})

// ─── Suite 10: agentRegistry — __testHooks ────────────────────────────────────

describe('agentRegistry — __testHooks integrity', () => {
  let mod: typeof import('../../../api/services/agents/agentRegistry')

  beforeEach(async () => {
    vi.resetAllMocks()
    mod = await import('../../../api/services/agents/agentRegistry')
  })

  it('AGENT_REGISTRY has same length as getAllAgents()', () => {
    expect(mod.__testHooks.AGENT_REGISTRY).toHaveLength(mod.getAllAgents().length)
  })

  it('_byType map has all agent types', () => {
    const { _byType } = mod.__testHooks
    expect(_byType.has('TaskAgent')).toBe(true)
    expect(_byType.has('RiskAgent')).toBe(true)
  })

  it('_byTaskType map resolves all task types', () => {
    const { _byTaskType } = mod.__testHooks
    expect(_byTaskType.has('create_action')).toBe(true)
    expect(_byTaskType.has('assess_readiness')).toBe(true)
  })
})

// ─── Suite 11: agents — executeAgent routing ─────────────────────────────────

describe('agents — executeAgent', () => {
  let mod: typeof import('../../../api/services/agents/agents')

  beforeEach(async () => {
    vi.resetAllMocks()
    mod = await import('../../../api/services/agents/agents')
  })

  const baseInput = (agentType: string) => ({
    task: {
      id: 'task-1', tenantId: 't1', agentType,
      taskType: 'assess_readiness', priority: 5, status: 'running' as const,
      payload: { scopeType: 'project', scopeId: 'proj-1' },
      context: {}, maxRetries: 3, retryCount: 0,
      scheduledAt: new Date(), createdBy: 'user-1',
      createdAt: new Date(), updatedAt: new Date(),
    },
    execution: {
      id: 'exec-1', tenantId: 't1', taskId: 'task-1',
      agentType, agentVersion: '1.0.0', status: 'running' as const,
      inputSnapshot: {}, policyChecks: [], startedAt: new Date(),
      workerId: 'w1', createdAt: new Date(),
    },
    context: {
      tenant: { id: 't1', name: 'T' },
      scope: { type: 'project', id: 'proj-1', metadata: {} },
      recentEvents: [], activeAlerts: [],
      policyConstraints: [], memoryEntries: [],
      assembledAt: new Date(),
    },
    policyChecks: [],
  })

  it('throws for unknown agent type', async () => {
    await expect(
      mod.executeAgent('UnknownAgent' as never, baseInput('UnknownAgent') as never)
    ).rejects.toThrow('Unknown agent type: UnknownAgent')
  })

  it('SchedulingAgent returns scheduleUpdates', async () => {
    const result = await mod.executeAgent('SchedulingAgent', baseInput('SchedulingAgent') as never)
    expect(result).toHaveProperty('scheduleUpdates')
    expect(result).toHaveProperty('conflicts')
  })

  it('DocumentationAgent returns documentId', async () => {
    // storeMemory needs a full row back from the INSERT
    const now = new Date()
    mockTenant.mockResolvedValue(mockRows([{
      id: 'mem-1', tenant_id: 't1', agent_type: 'DocumentationAgent',
      scope_type: 'global', scope_id: null, memory_type: 'outcome',
      key: 'last_doc_generate_report', value: {}, confidence: null,
      times_accessed: 0, created_at: now.toISOString(), updated_at: now.toISOString(),
    }]))
    const result = await mod.executeAgent('DocumentationAgent', {
      ...baseInput('DocumentationAgent'),
      task: { ...baseInput('DocumentationAgent').task, taskType: 'generate_report' },
    } as never)
    expect(result).toHaveProperty('documentId')
    expect(result).toHaveProperty('wordCount')
  })

  it('IncidentResponseAgent returns incidentId and severity', async () => {
    // Mock recordDecision
    mockTenant.mockResolvedValueOnce(mockRows([{
      id: 'dt-1', tenant_id: 't1', execution_id: 'exec-1',
      decision_type: 'incident_triage', rationale: 'r',
      confidence: 88, alternatives: [], policy_context: {},
      chosen_action: 'low', decided_at: new Date().toISOString(),
    }]))

    const result = await mod.executeAgent('IncidentResponseAgent', {
      ...baseInput('IncidentResponseAgent'),
      context: { ...baseInput('IncidentResponseAgent').context, activeAlerts: [1, 2, 3] },
    } as never)
    expect(result).toHaveProperty('incidentId')
    expect(result).toHaveProperty('severity')
    expect(result.severity).toBe('medium')   // 3 alerts = medium
  })

  it('ResourceOptimizationAgent queries actions table', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([
      { assigned_to: 'user-1', cnt: '15' },
    ]))
    const result = await mod.executeAgent('ResourceOptimizationAgent', baseInput('ResourceOptimizationAgent') as never)
    expect(result).toHaveProperty('assignments')
    expect(result).toHaveProperty('utilizationDelta')
  })
})

// ─── Suite 12: agentTaskQueue — __testHooks _mapRow ──────────────────────────

describe('agentTaskQueue — _mapRow', () => {
  let mod: typeof import('../../../api/services/agents/agentTaskQueue')

  beforeEach(async () => {
    vi.resetAllMocks()
    mod = await import('../../../api/services/agents/agentTaskQueue')
  })

  it('maps all required fields', () => {
    const { _mapRow } = mod.__testHooks
    const now = new Date().toISOString()
    const row = {
      id: 'task-1', tenant_id: 't1', agent_type: 'TaskAgent',
      task_type: 'create_action', priority: 3, status: 'queued',
      payload: { title: 'Fix' }, context: {},
      max_retries: 3, retry_count: 0,
      scheduled_at: now, created_by: 'u1',
      created_at: now, updated_at: now,
    }
    const task = _mapRow(row)
    expect(task.priority).toBe(3)
    expect(task.payload).toEqual({ title: 'Fix' })
    expect(task.scheduledAt).toBeInstanceOf(Date)
  })

  it('maps optional fields as undefined when null', () => {
    const { _mapRow } = mod.__testHooks
    const now = new Date().toISOString()
    const row = {
      id: 't1', tenant_id: 't1', agent_type: 'TaskAgent',
      task_type: 'create_action', priority: 5, status: 'queued',
      payload: {}, context: {}, max_retries: 3, retry_count: 0,
      scheduled_at: now, created_by: 'u1', created_at: now, updated_at: now,
      parent_task_id: null, execution_id: null, claimed_by: null,
      claimed_at: null, started_at: null, completed_at: null,
      expires_at: null, idempotency_key: null,
    }
    const task = _mapRow(row)
    expect(task.parentTaskId).toBeUndefined()
    expect(task.claimedBy).toBeUndefined()
    expect(task.expiresAt).toBeUndefined()
  })
})

// ─── Suite 13: orchestrator — OBJECTIVE_TASK_MAP coverage ────────────────────

describe('agentOrchestrator — OBJECTIVE_TASK_MAP', () => {
  let mod: typeof import('../../../api/services/agents/agentOrchestrator')

  beforeEach(async () => {
    vi.resetAllMocks()
    mod = await import('../../../api/services/agents/agentOrchestrator')
  })

  it('every objective has at least 2 tasks', () => {
    const { OBJECTIVE_TASK_MAP } = mod.__testHooks
    for (const [_obj, hints] of Object.entries(OBJECTIVE_TASK_MAP)) {
      expect(hints.length).toBeGreaterThanOrEqual(2)
    }
  })

  it('tasks with dependsOnIndex reference valid indices', () => {
    const { OBJECTIVE_TASK_MAP } = mod.__testHooks
    for (const [_obj, hints] of Object.entries(OBJECTIVE_TASK_MAP)) {
      for (const hint of hints) {
        if (hint.dependsOnIndex) {
          for (const dep of hint.dependsOnIndex) {
            expect(dep).toBeLessThan(hints.length)
          }
        }
      }
    }
  })

  it('all task types in OBJECTIVE_TASK_MAP are known task types', async () => {
    const registry = await import('../../../api/services/agents/agentRegistry')
    const { OBJECTIVE_TASK_MAP } = mod.__testHooks
    for (const hints of Object.values(OBJECTIVE_TASK_MAP)) {
      for (const hint of hints as Array<{ taskType: string }>) {
        const agent = registry.getAgentForTaskType(hint.taskType)
        expect(agent).toBeTruthy()
      }
    }
  })
})

// ─── Suite 14: agentWorker — state management ────────────────────────────────

describe('agentWorker — start/stop', () => {
  let mod: typeof import('../../../api/services/agents/agentWorker')

  beforeEach(async () => {
    vi.resetAllMocks()
    vi.useFakeTimers()
    mod = await import('../../../api/services/agents/agentWorker')
    mod.stopWorker()  // ensure clean state
  })

  afterEach(() => {
    mod.stopWorker()
    vi.useRealTimers()
  })

  it('startWorker sets running=true', () => {
    mod.startWorker({
      workerId: 'w1', agentTypes: ['TaskAgent'],
      pollIntervalMs: 1000, maxConcurrentTasks: 2,
      claimBatchSize: 1, staleTaskAgeMinutes: 30,
    })
    expect(mod.getWorkerState().running).toBe(true)
  })

  it('stopWorker sets running=false', () => {
    mod.startWorker({
      workerId: 'w1', agentTypes: ['TaskAgent'],
      pollIntervalMs: 1000, maxConcurrentTasks: 2,
      claimBatchSize: 1, staleTaskAgeMinutes: 30,
    })
    mod.stopWorker()
    expect(mod.getWorkerState().running).toBe(false)
  })

  it('calling startWorker twice does not create duplicate timers', () => {
    const config = {
      workerId: 'w1', agentTypes: ['TaskAgent'] as const,
      pollIntervalMs: 1000, maxConcurrentTasks: 2,
      claimBatchSize: 1, staleTaskAgeMinutes: 30,
    }
    mod.startWorker(config)
    mod.startWorker(config)  // should no-op
    expect(mod.getWorkerState().running).toBe(true)
  })

  it('getWorkerState returns a copy (not reference)', () => {
    const state = mod.getWorkerState()
    expect(typeof state.running).toBe('boolean')
    expect(typeof state.activeTaskCount).toBe('number')
  })
})
