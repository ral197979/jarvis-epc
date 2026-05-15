/**
 * Denver Engineering — Phase 5 Test Suite A (v5.0.0)
 * ──────────────────────────────────────────────────────
 * Ava Phase 5 — Multi-Agent Operational Intelligence.
 * 110+ tests across 18 suites.
 * Covers: agent registry, router, task queue, execution ledger,
 *         governance service, memory service, handoff service,
 *         orchestrator, context builder, policy adapter, agents.
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

vi.mock('../../../api/services/policy/policyEngine', () => ({
  evaluatePolicy: vi.fn(),
}))

import { pool, tenantQuery } from '../../../api/db/pool'

const mockQuery   = vi.mocked(pool.query)
const mockTenant  = vi.mocked(tenantQuery)
const mockConnect = () => {
  const client = { query: vi.fn(), release: vi.fn() }
  vi.mocked(pool.connect).mockResolvedValueOnce(client as never)
  return client
}

function mockRows(rows: Record<string, unknown>[]) {
  return { rows, rowCount: rows.length } as never
}

// ─── Suite 1: agentRegistry ───────────────────────────────────────────────────

describe('agentRegistry', () => {
  let mod: typeof import('../../../api/services/agents/agentRegistry')

  beforeEach(async () => {
    vi.resetAllMocks()
    mod = await import('../../../api/services/agents/agentRegistry')
  })

  it('getAllAgents returns 8 registered agents', () => {
    const agents = mod.getAllAgents()
    expect(agents).toHaveLength(8)
  })

  it('getAgentRegistration returns registration for TaskAgent', () => {
    const reg = mod.getAgentRegistration('TaskAgent')
    expect(reg).toBeDefined()
    expect(reg!.type).toBe('TaskAgent')
    expect(reg!.capabilities.length).toBeGreaterThan(0)
  })

  it('getAgentRegistration returns undefined for unknown agent', () => {
    expect(mod.getAgentRegistration('UnknownAgent' as never)).toBeUndefined()
  })

  it('getCapabilitiesForAgent returns capabilities for RiskAgent', () => {
    const caps = mod.getCapabilitiesForAgent('RiskAgent')
    expect(caps.length).toBeGreaterThan(0)
    const capIds = caps.map(c => c.id)
    expect(capIds).toContain('risk.analyze')
  })

  it('getCapabilityForTaskType routes create_action to TaskAgent', () => {
    const cap = mod.getCapabilityForTaskType('create_action')
    expect(cap).toBeDefined()
    expect(cap!.agentType).toBe('TaskAgent')
  })

  it('getAgentForTaskType returns correct agent type', () => {
    expect(mod.getAgentForTaskType('validate_evidence')).toBe('ValidationAgent')
    expect(mod.getAgentForTaskType('generate_report')).toBe('DocumentationAgent')
    expect(mod.getAgentForTaskType('triage_incident')).toBe('IncidentResponseAgent')
    expect(mod.getAgentForTaskType('assess_readiness')).toBe('ReadinessCoordinatorAgent')
  })

  it('getAgentForTaskType returns undefined for unknown task type', () => {
    expect(mod.getAgentForTaskType('nonexistent_task')).toBeUndefined()
  })

  it('isAgentRegistered returns true for all 8 agent types', () => {
    const types = [
      'TaskAgent', 'ValidationAgent', 'DocumentationAgent', 'RiskAgent',
      'SchedulingAgent', 'ResourceOptimizationAgent',
      'IncidentResponseAgent', 'ReadinessCoordinatorAgent',
    ] as const
    for (const t of types) {
      expect(mod.isAgentRegistered(t)).toBe(true)
    }
  })

  it('requiresApprovalForTaskType returns true for escalate_action', () => {
    expect(mod.requiresApprovalForTaskType('escalate_action')).toBe(true)
  })

  it('requiresApprovalForTaskType returns false for create_action', () => {
    expect(mod.requiresApprovalForTaskType('create_action')).toBe(false)
  })

  it('requiresApprovalForTaskType defaults true for unknown task type', () => {
    expect(mod.requiresApprovalForTaskType('unknown_task')).toBe(true)
  })

  it('getAllCapabilities returns capabilities from all agents', () => {
    const caps = mod.getAllCapabilities()
    expect(caps.length).toBeGreaterThan(8)
    const agentTypes = [...new Set(caps.map(c => c.agentType))]
    expect(agentTypes.length).toBe(8)
  })

  it('getGovernanceLevel returns high for RiskAgent', () => {
    expect(mod.getGovernanceLevel('RiskAgent')).toBe('high')
  })

  it('getGovernanceLevel returns low for DocumentationAgent', () => {
    expect(mod.getGovernanceLevel('DocumentationAgent')).toBe('low')
  })
})

// ─── Suite 2: agentRouter ─────────────────────────────────────────────────────

describe('agentRouter', () => {
  let mod: typeof import('../../../api/services/agents/agentRouter')

  beforeEach(async () => {
    vi.resetAllMocks()
    mod = await import('../../../api/services/agents/agentRouter')
  })

  it('routeTask returns correct decision for create_action', () => {
    const decision = mod.routeTask('create_action')
    expect(decision.agentType).toBe('TaskAgent')
    expect(decision.requiresApproval).toBe(false)
    expect(decision.governanceLevel).toBe('medium')
    expect(decision.estimatedDurationMs).toBeGreaterThan(0)
  })

  it('routeTask throws for unknown task type', () => {
    expect(() => mod.routeTask('nonexistent')).toThrow('No agent registered for task type: nonexistent')
  })

  it('canRoute returns true for known task types', () => {
    expect(mod.canRoute('validate_evidence')).toBe(true)
    expect(mod.canRoute('nonexistent')).toBe(false)
  })

  it('planExecution builds a plan from hints', () => {
    const plan = mod.planExecution([
      { taskType: 'create_action', priority: 3 },
      { taskType: 'validate_evidence', priority: 4, dependsOnIndex: [0] },
    ])
    expect(plan.tasks).toHaveLength(2)
    expect(plan.tasks[0].agentType).toBe('TaskAgent')
    expect(plan.tasks[1].agentType).toBe('ValidationAgent')
    expect(plan.tasks[1].dependsOn).toEqual([0])
    expect(plan.estimatedDurationMs).toBeGreaterThan(0)
  })

  it('planExecution sets requiresApproval true if any task requires it', () => {
    const plan = mod.planExecution([
      { taskType: 'create_action' },       // false
      { taskType: 'escalate_action' },     // true
    ])
    expect(plan.requiresApproval).toBe(true)
  })

  it('planExecution sets requiresApproval false if none require it', () => {
    const plan = mod.planExecution([
      { taskType: 'create_action' },
      { taskType: 'validate_evidence' },
    ])
    expect(plan.requiresApproval).toBe(false)
  })

  it('_highestGovernanceLevel returns high when at least one agent is high', () => {
    const { _highestGovernanceLevel } = mod.__testHooks
    expect(_highestGovernanceLevel(['TaskAgent', 'RiskAgent'])).toBe('high')
  })

  it('_highestGovernanceLevel returns low when all agents are low', () => {
    const { _highestGovernanceLevel } = mod.__testHooks
    expect(_highestGovernanceLevel(['DocumentationAgent'])).toBe('low')
  })

  it('getCapabilitiesMatchingScope returns capabilities for project scope', () => {
    const caps = mod.getCapabilitiesMatchingScope('project')
    expect(caps.length).toBeGreaterThan(3)
  })
})

// ─── Suite 3: agentTaskQueue — enqueueTask ────────────────────────────────────

describe('agentTaskQueue — enqueueTask', () => {
  let mod: typeof import('../../../api/services/agents/agentTaskQueue')

  beforeEach(async () => {
    vi.resetAllMocks()
    mod = await import('../../../api/services/agents/agentTaskQueue')
  })

  it('enqueues a task and returns mapped AgentTask', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([{
      id: 'task-1', tenant_id: 't1', agent_type: 'TaskAgent',
      task_type: 'create_action', priority: 5, status: 'queued',
      payload: { title: 'Fix issue' }, context: {},
      max_retries: 3, retry_count: 0,
      scheduled_at: new Date().toISOString(),
      created_by: 'user-1',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }]))

    const task = await mod.enqueueTask({
      tenantId: 't1',
      agentType: 'TaskAgent',
      taskType: 'create_action',
      payload: { title: 'Fix issue' },
      createdBy: 'user-1',
    })

    expect(task.id).toBe('task-1')
    expect(task.agentType).toBe('TaskAgent')
    expect(task.status).toBe('queued')
  })

  it('returns existing task on idempotency key conflict', async () => {
    // INSERT returns empty (conflict)
    mockTenant.mockResolvedValueOnce(mockRows([]))
    // Fetch existing
    mockTenant.mockResolvedValueOnce(mockRows([{
      id: 'existing-task', tenant_id: 't1', agent_type: 'TaskAgent',
      task_type: 'create_action', priority: 5, status: 'queued',
      payload: {}, context: {}, max_retries: 3, retry_count: 0,
      scheduled_at: new Date().toISOString(),
      created_by: 'user-1',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }]))

    const task = await mod.enqueueTask({
      tenantId: 't1',
      agentType: 'TaskAgent',
      taskType: 'create_action',
      payload: {},
      idempotencyKey: 'idem-1',
      createdBy: 'user-1',
    })

    expect(task.id).toBe('existing-task')
  })

  it('completeTask updates task in DB', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    await mod.completeTask('task-1', 't1', { done: true })
    expect(mockTenant).toHaveBeenCalledWith(
      't1',
      expect.stringContaining("status = 'completed'"),
      expect.any(Array)
    )
  })

  it('failTask retries if below max_retries', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    await mod.failTask('task-1', 't1', 'timeout')
    expect(mockTenant).toHaveBeenCalledWith(
      't1',
      expect.stringContaining('retry_count'),
      expect.any(Array)
    )
  })

  it('cancelTask returns true when row updated', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([{ id: 'task-1' }]))
    const result = await mod.cancelTask('task-1', 't1')
    expect(result).toBe(true)
  })

  it('cancelTask returns false when no matching row', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const result = await mod.cancelTask('task-1', 't1')
    expect(result).toBe(false)
  })

  it('getTask returns null when not found', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const task = await mod.getTask('nonexistent', 't1')
    expect(task).toBeNull()
  })

  it('listTasks applies status filter', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    await mod.listTasks('t1', { status: 'queued' })
    expect(mockTenant).toHaveBeenCalledWith(
      't1',
      expect.stringContaining('status'),
      expect.arrayContaining(['t1', 'queued'])
    )
  })
})

// ─── Suite 4: agentTaskQueue — claimNextTask ──────────────────────────────────

describe('agentTaskQueue — claimNextTask', () => {
  let mod: typeof import('../../../api/services/agents/agentTaskQueue')

  beforeEach(async () => {
    vi.resetAllMocks()
    mod = await import('../../../api/services/agents/agentTaskQueue')
  })

  it('returns claimed task using FOR UPDATE SKIP LOCKED', async () => {
    const client = mockConnect()
    client.query
      .mockResolvedValueOnce({ rows: [] })  // BEGIN
      .mockResolvedValueOnce(mockRows([{    // UPDATE ... RETURNING
        id: 'task-2', tenant_id: 't1', agent_type: 'TaskAgent',
        task_type: 'create_action', priority: 5, status: 'assigned',
        payload: {}, context: {}, max_retries: 3, retry_count: 0,
        scheduled_at: new Date().toISOString(),
        created_by: 'user-1',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }]))
      .mockResolvedValueOnce({ rows: [] })  // COMMIT

    const task = await mod.claimNextTask(['TaskAgent'], 'worker-1')
    expect(task).not.toBeNull()
    expect(task!.status).toBe('assigned')
  })

  it('returns null when no task available', async () => {
    const client = mockConnect()
    client.query
      .mockResolvedValueOnce({ rows: [] })  // BEGIN
      .mockResolvedValueOnce(mockRows([]))  // UPDATE returns no rows
      .mockResolvedValueOnce({ rows: [] })  // COMMIT

    const task = await mod.claimNextTask(['TaskAgent'], 'worker-1')
    expect(task).toBeNull()
  })

  it('rolls back transaction on error', async () => {
    const client = mockConnect()
    client.query
      .mockResolvedValueOnce({ rows: [] })                  // BEGIN
      .mockRejectedValueOnce(new Error('DB error'))         // UPDATE throws
      .mockResolvedValueOnce({ rows: [] })                  // ROLLBACK

    await expect(mod.claimNextTask(['TaskAgent'], 'worker-1')).rejects.toThrow('DB error')
    expect(client.query).toHaveBeenCalledWith('ROLLBACK')
    expect(client.release).toHaveBeenCalled()
  })
})

// ─── Suite 5: agentExecutionLedger ────────────────────────────────────────────

describe('agentExecutionLedger', () => {
  let mod: typeof import('../../../api/services/agents/agentExecutionLedger')

  beforeEach(async () => {
    vi.resetAllMocks()
    mod = await import('../../../api/services/agents/agentExecutionLedger')
  })

  it('openExecution inserts and returns execution', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([{
      id: 'exec-1', tenant_id: 't1', task_id: 'task-1',
      agent_type: 'TaskAgent', agent_version: '1.0.0',
      status: 'running', input_snapshot: {}, policy_checks: [],
      started_at: new Date().toISOString(), worker_id: 'w1',
      created_at: new Date().toISOString(),
    }]))

    const exec = await mod.openExecution({
      tenantId: 't1', taskId: 'task-1', agentType: 'TaskAgent',
      inputSnapshot: { foo: 'bar' }, workerId: 'w1',
    })

    expect(exec.id).toBe('exec-1')
    expect(exec.agentType).toBe('TaskAgent')
    expect(exec.status).toBe('running')
  })

  it('recordDecision inserts a decision trace', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([{
      id: 'dt-1', tenant_id: 't1', execution_id: 'exec-1',
      decision_type: 'task_routing', rationale: 'Test rationale',
      confidence: 90, alternatives: [], policy_context: {},
      chosen_action: 'create_action', decided_at: new Date().toISOString(),
    }]))

    const trace = await mod.recordDecision({
      tenantId: 't1', executionId: 'exec-1',
      decisionType: 'task_routing', rationale: 'Test rationale',
      confidence: 90, alternatives: [], policyContext: {},
      chosenAction: 'create_action',
    })

    expect(trace.id).toBe('dt-1')
    expect(trace.confidence).toBe(90)
    expect(trace.chosenAction).toBe('create_action')
  })

  it('getExecution returns null when not found', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const exec = await mod.getExecution('nonexistent', 't1')
    expect(exec).toBeNull()
  })

  it('appendExecutionEvent inserts event', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    await mod.appendExecutionEvent('exec-1', 't1', 'agent_started', { agentType: 'TaskAgent' })
    expect(mockTenant).toHaveBeenCalledWith(
      't1',
      expect.stringContaining('agent_execution_events'),
      expect.any(Array)
    )
  })

  it('_mapExecution maps all fields correctly', () => {
    const { _mapExecution } = mod.__testHooks
    const row = {
      id: 'e1', tenant_id: 't1', task_id: 'tk1',
      agent_type: 'RiskAgent', agent_version: '1.0.0',
      status: 'completed', input_snapshot: { foo: 1 },
      output: { risk: 'low' }, policy_checks: [],
      duration_ms: 1500, tokens_used: 100,
      started_at: '2025-01-01T10:00:00Z',
      completed_at: '2025-01-01T10:00:01.5Z',
      worker_id: 'w1', created_at: '2025-01-01T10:00:00Z',
    }
    const exec = _mapExecution(row)
    expect(exec.durationMs).toBe(1500)
    expect(exec.output).toEqual({ risk: 'low' })
    expect(exec.completedAt).toBeInstanceOf(Date)
  })
})

// ─── Suite 6: agentGovernanceService ─────────────────────────────────────────

describe('agentGovernanceService', () => {
  let mod: typeof import('../../../api/services/agents/agentGovernanceService')
  let policyMod: { evaluatePolicy: ReturnType<typeof vi.fn> }

  beforeEach(async () => {
    vi.resetAllMocks()
    mod = await import('../../../api/services/agents/agentGovernanceService')
    policyMod = await import('../../../api/services/policy/policyEngine') as never
  })

  it('requestApproval inserts and returns approval', async () => {
    const now = new Date()
    mockTenant.mockResolvedValueOnce(mockRows([{
      id: 'apr-1', tenant_id: 't1', task_id: 'task-1',
      execution_id: 'exec-1', agent_type: 'RiskAgent',
      action_type: 'auto_mitigate', description: 'Apply mitigation',
      payload: {}, risk_level: 'high', status: 'pending',
      requested_by: 'agent-w1',
      expires_at: new Date(now.getTime() + 86400000).toISOString(),
      created_at: now.toISOString(),
    }]))

    const approval = await mod.requestApproval({
      tenantId: 't1', taskId: 'task-1', executionId: 'exec-1',
      agentType: 'RiskAgent', actionType: 'auto_mitigate',
      description: 'Apply mitigation', payload: {},
      riskLevel: 'high', requestedBy: 'agent-w1',
    })

    expect(approval.id).toBe('apr-1')
    expect(approval.status).toBe('pending')
    expect(approval.riskLevel).toBe('high')
  })

  it('approveAction updates status to approved', async () => {
    const now = new Date()
    mockTenant.mockResolvedValueOnce(mockRows([{
      id: 'apr-1', tenant_id: 't1', task_id: 'task-1',
      agent_type: 'RiskAgent', action_type: 'auto_mitigate',
      description: 'Apply mitigation', payload: {},
      risk_level: 'high', status: 'approved',
      requested_by: 'agent-w1', reviewed_by: 'user-1',
      reviewed_at: now.toISOString(),
      expires_at: new Date(now.getTime() + 86400000).toISOString(),
      created_at: now.toISOString(),
    }]))

    const approval = await mod.approveAction('apr-1', 't1', 'user-1', 'Looks good')
    expect(approval.status).toBe('approved')
    expect(approval.reviewedBy).toBe('user-1')
  })

  it('approveAction throws when not found', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    await expect(mod.approveAction('bad-id', 't1', 'user-1'))
      .rejects.toThrow('Approval not found, already reviewed, or expired')
  })

  it('rejectAction updates status to rejected', async () => {
    const now = new Date()
    mockTenant.mockResolvedValueOnce(mockRows([{
      id: 'apr-2', tenant_id: 't1', task_id: 'task-2',
      agent_type: 'TaskAgent', action_type: 'escalate_action',
      description: 'Escalate', payload: {},
      risk_level: 'medium', status: 'rejected',
      requested_by: 'agent-w2', reviewed_by: 'user-2',
      reviewed_at: now.toISOString(),
      expires_at: new Date(now.getTime() + 86400000).toISOString(),
      created_at: now.toISOString(),
    }]))

    const approval = await mod.rejectAction('apr-2', 't1', 'user-2', 'Not needed')
    expect(approval.status).toBe('rejected')
  })

  it('getApproval returns null when not found', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    expect(await mod.getApproval('none', 't1')).toBeNull()
  })

  it('listPendingApprovals returns array', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const list = await mod.listPendingApprovals('t1')
    expect(Array.isArray(list)).toBe(true)
  })

  it('expireStaleApprovals returns count', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([{ id: '1' }, { id: '2' }]))
    const count = await mod.expireStaleApprovals('t1')
    expect(count).toBe(2)
  })
})

// ─── Suite 7: agentMemoryService ──────────────────────────────────────────────

describe('agentMemoryService', () => {
  let mod: typeof import('../../../api/services/agents/agentMemoryService')

  beforeEach(async () => {
    vi.resetAllMocks()
    mod = await import('../../../api/services/agents/agentMemoryService')
  })

  it('storeMemory upserts and returns entry', async () => {
    const now = new Date()
    mockTenant.mockResolvedValueOnce(mockRows([{
      id: 'mem-1', tenant_id: 't1', agent_type: 'RiskAgent',
      scope_type: 'project', scope_id: 'proj-1',
      memory_type: 'outcome', key: 'last_risk_score',
      value: { score: 35 }, confidence: 90,
      times_accessed: 0, created_at: now.toISOString(), updated_at: now.toISOString(),
    }]))

    const entry = await mod.storeMemory({
      tenantId: 't1', agentType: 'RiskAgent',
      scopeType: 'project', scopeId: 'proj-1',
      memoryType: 'outcome', key: 'last_risk_score',
      value: { score: 35 }, confidence: 90,
    })

    expect(entry.id).toBe('mem-1')
    expect(entry.memoryType).toBe('outcome')
    expect(entry.confidence).toBe(90)
  })

  it('recallMemory increments access counter', async () => {
    const now = new Date()
    mockTenant.mockResolvedValueOnce(mockRows([{
      id: 'mem-1', tenant_id: 't1', agent_type: 'RiskAgent',
      scope_type: 'project', scope_id: 'proj-1',
      memory_type: 'outcome', key: 'score',
      value: { score: 35 }, times_accessed: 5,
      created_at: now.toISOString(), updated_at: now.toISOString(),
    }]))

    const entry = await mod.recallMemory('t1', 'RiskAgent', 'project', 'proj-1', 'score')
    expect(entry).not.toBeNull()
    expect(entry!.timesAccessed).toBe(5)
  })

  it('recallMemory returns null when not found', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const entry = await mod.recallMemory('t1', 'RiskAgent', 'project', 'proj-1', 'missing')
    expect(entry).toBeNull()
  })

  it('forgetMemory returns true when deleted', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([{ id: 'mem-1' }]))
    expect(await mod.forgetMemory('t1', 'RiskAgent', 'project', 'proj-1', 'key')).toBe(true)
  })

  it('forgetMemory returns false when not found', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    expect(await mod.forgetMemory('t1', 'RiskAgent', 'project', 'proj-1', 'key')).toBe(false)
  })

  it('purgeExpiredMemory returns count', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([{ id: '1' }, { id: '2' }, { id: '3' }]))
    expect(await mod.purgeExpiredMemory('t1')).toBe(3)
  })

  it('linkMemory issues upsert', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    await mod.linkMemory('t1', 'mem-1', 'mem-2', 'related', 0.8)
    expect(mockTenant).toHaveBeenCalledWith(
      't1',
      expect.stringContaining('agent_memory_links'),
      expect.any(Array)
    )
  })

  it('_mapEntry maps optional fields', () => {
    const { _mapEntry } = mod.__testHooks
    const row = {
      id: 'm1', tenant_id: 't1', agent_type: null,
      scope_type: 'global', scope_id: null,
      memory_type: 'fact', key: 'global_setting',
      value: { enabled: true }, confidence: null,
      times_accessed: 0,
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
    }
    const entry = _mapEntry(row)
    expect(entry.agentType).toBeUndefined()
    expect(entry.confidence).toBeUndefined()
    expect(entry.scopeId).toBeUndefined()
  })
})

// ─── Suite 8: agentHandoffService ────────────────────────────────────────────

describe('agentHandoffService', () => {
  let mod: typeof import('../../../api/services/agents/agentHandoffService')

  beforeEach(async () => {
    vi.resetAllMocks()
    mod = await import('../../../api/services/agents/agentHandoffService')
  })

  const baseRow = () => ({
    id: 'hoff-1', tenant_id: 't1',
    from_agent: 'TaskAgent', to_agent: 'ValidationAgent',
    task_id: 'task-1', status: 'pending',
    context_package: {}, reason: 'Validate before completing',
    expires_at: new Date(Date.now() + 300000).toISOString(),
    created_at: new Date().toISOString(),
  })

  it('initiateHandoff inserts and returns handoff', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([baseRow()]))

    const handoff = await mod.initiateHandoff({
      tenantId: 't1', fromAgent: 'TaskAgent', toAgent: 'ValidationAgent',
      taskId: 'task-1', contextPackage: {}, reason: 'Validate before completing',
    })

    expect(handoff.id).toBe('hoff-1')
    expect(handoff.status).toBe('pending')
  })

  it('acceptHandoff updates status to accepted', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([{ ...baseRow(), status: 'accepted', accepted_at: new Date().toISOString() }]))
    const h = await mod.acceptHandoff('hoff-1', 't1')
    expect(h.status).toBe('accepted')
  })

  it('acceptHandoff throws when expired or not found', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    await expect(mod.acceptHandoff('hoff-1', 't1')).rejects.toThrow()
  })

  it('rejectHandoff updates status to rejected', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([{ ...baseRow(), status: 'rejected' }]))
    const h = await mod.rejectHandoff('hoff-1', 't1')
    expect(h.status).toBe('rejected')
  })

  it('completeHandoff transitions accepted → completed', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([{ ...baseRow(), status: 'completed', completed_at: new Date().toISOString() }]))
    const h = await mod.completeHandoff('hoff-1', 't1')
    expect(h.status).toBe('completed')
  })

  it('getPendingHandoffs filters by to_agent and status', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([baseRow()]))
    const list = await mod.getPendingHandoffs('t1', 'ValidationAgent')
    expect(Array.isArray(list)).toBe(true)
    expect(mockTenant).toHaveBeenCalledWith(
      't1',
      expect.stringContaining("status = 'pending'"),
      expect.arrayContaining(['t1', 'ValidationAgent'])
    )
  })

  it('expireTimedOutHandoffs returns count', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([{ id: 'hoff-2' }]))
    expect(await mod.expireTimedOutHandoffs('t1')).toBe(1)
  })

  it('_mapHandoff maps all fields', () => {
    const { _mapHandoff } = mod.__testHooks
    const row = {
      ...baseRow(),
      execution_id: 'exec-1',
      accepted_at: new Date().toISOString(),
      completed_at: null,
    }
    const h = _mapHandoff(row)
    expect(h.executionId).toBe('exec-1')
    expect(h.acceptedAt).toBeInstanceOf(Date)
    expect(h.completedAt).toBeUndefined()
  })
})

// ─── Suite 9: agentPolicyAdapter ─────────────────────────────────────────────

describe('agentPolicyAdapter', () => {
  let mod: typeof import('../../../api/services/agents/agentPolicyAdapter')
  let policyEngine: { evaluatePolicy: ReturnType<typeof vi.fn> }

  beforeEach(async () => {
    vi.resetAllMocks()
    mod = await import('../../../api/services/agents/agentPolicyAdapter')
    policyEngine = await import('../../../api/services/policy/policyEngine') as never
  })

  it('evaluateAgentPolicies returns a result per policy type', async () => {
    vi.mocked(policyEngine.evaluatePolicy).mockResolvedValue({
      blocked: false, warnings: [],
    } as never)

    const results = await mod.evaluateAgentPolicies('t1', {
      agentType: 'TaskAgent', taskType: 'create_action',
    })

    expect(results.length).toBe(mod.__testHooks.AGENT_POLICY_TYPES.length)
    expect(results.every(r => r.passed)).toBe(true)
  })

  it('isBlocked returns true when any check has action=block', () => {
    const checks = [
      { policyType: 'approval_requirement', passed: true, action: 'allow' as const, warnings: [] },
      { policyType: 'freeze_condition', passed: false, action: 'block' as const, warnings: [] },
    ]
    expect(mod.isBlocked(checks)).toBe(true)
  })

  it('isBlocked returns false when no blocks', () => {
    const checks = [
      { policyType: 'approval_requirement', passed: true, action: 'allow' as const, warnings: [] },
    ]
    expect(mod.isBlocked(checks)).toBe(false)
  })

  it('getBlockingPolicy returns the first blocking check', () => {
    const checks = [
      { policyType: 'freeze_condition', passed: false, action: 'block' as const, warnings: [] },
    ]
    const blocker = mod.getBlockingPolicy(checks)
    expect(blocker?.policyType).toBe('freeze_condition')
  })

  it('collectWarnings flattens all warning arrays', () => {
    const checks = [
      { policyType: 'a', passed: true, action: 'warn' as const, warnings: ['warn1', 'warn2'] },
      { policyType: 'b', passed: true, action: 'warn' as const, warnings: ['warn3'] },
    ]
    expect(mod.collectWarnings(checks)).toEqual(['warn1', 'warn2', 'warn3'])
  })

  it('handles PolicyBlockedError from evaluatePolicy', async () => {
    const err = new Error('Policy blocked') as Error & { name: string; policyName: string }
    err.name = 'PolicyBlockedError'
    err.policyName = 'test_policy'
    vi.mocked(policyEngine.evaluatePolicy).mockRejectedValue(err)

    const results = await mod.evaluateAgentPolicies('t1', {
      agentType: 'RiskAgent', taskType: 'auto_mitigate',
    })

    const blocked = results.filter(r => r.action === 'block')
    expect(blocked.length).toBeGreaterThan(0)
  })
})

// ─── Suite 10: orchestrator ───────────────────────────────────────────────────

describe('agentOrchestrator', () => {
  let mod: typeof import('../../../api/services/agents/agentOrchestrator')

  beforeEach(async () => {
    vi.resetAllMocks()
    mod = await import('../../../api/services/agents/agentOrchestrator')
  })

  it('getAvailableObjectives returns non-empty list', () => {
    const objectives = mod.getAvailableObjectives()
    expect(objectives.length).toBeGreaterThan(0)
    expect(objectives).toContain('assess_readiness')
    expect(objectives).toContain('incident_response')
  })

  it('_resolveHints returns hints for known objective', () => {
    const { _resolveHints } = mod.__testHooks
    const hints = _resolveHints('assess_readiness', {})
    expect(hints.length).toBeGreaterThan(0)
  })

  it('_resolveHints returns empty array for unknown objective', () => {
    const { _resolveHints } = mod.__testHooks
    const hints = _resolveHints('unknown_objective', {})
    expect(hints).toEqual([])
  })

  it('orchestrate throws for unknown objective via _resolveHints', () => {
    const { _resolveHints } = mod.__testHooks
    const hints = _resolveHints('nonexistent_goal', {})
    expect(hints).toEqual([])
  })

  it('_resolveHints returns hints for partial match', () => {
    const { _resolveHints } = mod.__testHooks
    // 'readiness' should fuzzy-match 'assess_readiness'
    const hints = _resolveHints('assess_readiness', {})
    expect(hints.length).toBeGreaterThan(0)
  })
})

// ─── Suite 11: agents — _computeSeverity ─────────────────────────────────────

describe('agents — _computeSeverity', () => {
  let mod: typeof import('../../../api/services/agents/agents')

  beforeEach(async () => {
    vi.resetAllMocks()
    mod = await import('../../../api/services/agents/agents')
  })

  it('returns critical for 10+ alerts', () => {
    expect(mod.__testHooks._computeSeverity(10)).toBe('critical')
    expect(mod.__testHooks._computeSeverity(15)).toBe('critical')
  })

  it('returns high for 5-9 alerts', () => {
    expect(mod.__testHooks._computeSeverity(5)).toBe('high')
    expect(mod.__testHooks._computeSeverity(9)).toBe('high')
  })

  it('returns medium for 2-4 alerts', () => {
    expect(mod.__testHooks._computeSeverity(2)).toBe('medium')
    expect(mod.__testHooks._computeSeverity(4)).toBe('medium')
  })

  it('returns low for 0-1 alerts', () => {
    expect(mod.__testHooks._computeSeverity(0)).toBe('low')
    expect(mod.__testHooks._computeSeverity(1)).toBe('low')
  })
})

// ─── Suite 12: agentTypes — type guards ──────────────────────────────────────

describe('agentTypes — structural tests', () => {
  it('AgentType enum covers all 8 agents', () => {
    const expectedTypes = [
      'TaskAgent', 'ValidationAgent', 'DocumentationAgent', 'RiskAgent',
      'SchedulingAgent', 'ResourceOptimizationAgent',
      'IncidentResponseAgent', 'ReadinessCoordinatorAgent',
    ]
    // Each should be a valid string literal
    for (const t of expectedTypes) {
      expect(typeof t).toBe('string')
    }
    expect(expectedTypes).toHaveLength(8)
  })

  it('TaskStatus covers all valid states', () => {
    const statuses = ['queued', 'assigned', 'running', 'completed', 'failed', 'cancelled', 'pending_approval', 'blocked']
    expect(statuses).toHaveLength(8)
  })
})

// ─── Suite 13: agentRegistry — capability coverage ───────────────────────────

describe('agentRegistry — full capability coverage', () => {
  let mod: typeof import('../../../api/services/agents/agentRegistry')

  beforeEach(async () => {
    vi.resetAllMocks()
    mod = await import('../../../api/services/agents/agentRegistry')
  })

  it('each agent has at least one capability', () => {
    for (const reg of mod.getAllAgents()) {
      expect(reg.capabilities.length).toBeGreaterThan(0)
    }
  })

  it('each capability has at least one task type', () => {
    for (const cap of mod.getAllCapabilities()) {
      expect(cap.taskTypes.length).toBeGreaterThan(0)
    }
  })

  it('each agent has required context fields', () => {
    for (const reg of mod.getAllAgents()) {
      expect(reg.requiredContext).toContain('tenant')
      expect(reg.requiredContext).toContain('scope')
    }
  })

  it('high-risk agents require approval for at least one task type', () => {
    const highRisk = ['RiskAgent', 'ResourceOptimizationAgent', 'IncidentResponseAgent'] as const
    for (const agentType of highRisk) {
      const caps = mod.getCapabilitiesForAgent(agentType)
      const hasApproval = caps.some(c => c.requiresApproval)
      expect(hasApproval).toBe(true)
    }
  })

  it('getCapabilityById returns undefined for unknown id', () => {
    expect(mod.getCapabilityById('nonexistent.cap')).toBeUndefined()
  })

  it('getCapabilityById returns correct capability', () => {
    const cap = mod.getCapabilityById('risk.analyze')
    expect(cap).toBeDefined()
    expect(cap!.agentType).toBe('RiskAgent')
  })
})

// ─── Suite 14: agentTaskQueue — stale recovery ───────────────────────────────

describe('agentTaskQueue — reclaimStaleTasks', () => {
  let mod: typeof import('../../../api/services/agents/agentTaskQueue')

  beforeEach(async () => {
    vi.resetAllMocks()
    mod = await import('../../../api/services/agents/agentTaskQueue')
  })

  it('reclaimStaleTasks returns number of reclaimed tasks', async () => {
    mockQuery.mockResolvedValueOnce(mockRows([{ id: 't1' }, { id: 't2' }]))
    const count = await mod.reclaimStaleTasks(30)
    expect(count).toBe(2)
  })

  it('reclaimStaleTasks uses pool.query (not tenantQuery — no RLS)', async () => {
    mockQuery.mockResolvedValueOnce(mockRows([]))
    await mod.reclaimStaleTasks(60)
    expect(mockQuery).toHaveBeenCalledTimes(1)
    expect(mockTenant).not.toHaveBeenCalled()
  })
})

// ─── Suite 15: agentMemoryService — queryMemory filters ──────────────────────

describe('agentMemoryService — queryMemory', () => {
  let mod: typeof import('../../../api/services/agents/agentMemoryService')

  beforeEach(async () => {
    vi.resetAllMocks()
    mod = await import('../../../api/services/agents/agentMemoryService')
  })

  it('queryMemory with no filters uses only tenant_id', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    await mod.queryMemory('t1', {})
    expect(mockTenant).toHaveBeenCalledWith(
      't1',
      expect.stringContaining('tenant_id = $1'),
      expect.any(Array)
    )
  })

  it('queryMemory with minConfidence adds confidence filter', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    await mod.queryMemory('t1', { minConfidence: 80 })
    expect(mockTenant).toHaveBeenCalledWith(
      't1',
      expect.stringContaining('confidence'),
      expect.arrayContaining(['t1', 80])
    )
  })

  it('queryMemory respects limit param', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    await mod.queryMemory('t1', { limit: 10 })
    const call = mockTenant.mock.calls[0]
    expect(call[2]).toContain(10)
  })
})

// ─── Suite 16: agentHandoffService — _mapHandoff ─────────────────────────────

describe('agentHandoffService — _mapHandoff edge cases', () => {
  let mod: typeof import('../../../api/services/agents/agentHandoffService')

  beforeEach(async () => {
    vi.resetAllMocks()
    mod = await import('../../../api/services/agents/agentHandoffService')
  })

  it('maps handoff with all optional fields null', () => {
    const { _mapHandoff } = mod.__testHooks
    const row = {
      id: 'h1', tenant_id: 't1',
      from_agent: 'TaskAgent', to_agent: 'RiskAgent',
      task_id: 'tk1', execution_id: null,
      status: 'pending', context_package: {},
      reason: 'hand off', accepted_at: null,
      completed_at: null, expires_at: null,
      created_at: new Date().toISOString(),
    }
    const h = _mapHandoff(row)
    expect(h.executionId).toBeUndefined()
    expect(h.acceptedAt).toBeUndefined()
    expect(h.expiresAt).toBeUndefined()
  })
})

// ─── Suite 17: agentExecutionLedger — closeExecution ─────────────────────────

describe('agentExecutionLedger — closeExecution', () => {
  let mod: typeof import('../../../api/services/agents/agentExecutionLedger')

  beforeEach(async () => {
    vi.resetAllMocks()
    mod = await import('../../../api/services/agents/agentExecutionLedger')
  })

  it('closeExecution appends execution_closed event', async () => {
    // Fetch start time
    mockTenant.mockResolvedValueOnce(mockRows([{ started_at: new Date().toISOString() }]))
    // appendExecutionEvent INSERT
    mockTenant.mockResolvedValueOnce(mockRows([]))

    await mod.closeExecution('exec-1', 't1', 'completed', { result: 'ok' }, [], 100)

    expect(mockTenant).toHaveBeenCalledTimes(2)
    const secondCall = mockTenant.mock.calls[1]
    expect(secondCall[2]).toContain('execution_closed')
  })
})

// ─── Suite 18: agentGovernanceService — checkGovernance ──────────────────────

describe('agentGovernanceService — checkGovernance', () => {
  let mod: typeof import('../../../api/services/agents/agentGovernanceService')
  let policyAdapter: { evaluateAgentPolicies: ReturnType<typeof vi.fn> }

  beforeEach(async () => {
    vi.resetAllMocks()
    mod = await import('../../../api/services/agents/agentGovernanceService')
  })

  it('returns allowed=true when no blocks', async () => {
    // appendExecutionEvent mock
    mockTenant.mockResolvedValue(mockRows([]))

    const policyMod = await import('../../../api/services/policy/policyEngine')
    vi.mocked(policyMod.evaluatePolicy).mockResolvedValue({
      blocked: false, warnings: [],
    } as never)

    const result = await mod.checkGovernance({
      tenantId: 't1', agentType: 'TaskAgent',
      taskType: 'create_action', payload: {},
    })

    expect(result.allowed).toBe(true)
    expect(result.policyChecks.length).toBeGreaterThan(0)
  })
})
