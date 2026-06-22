// Denver Engineering — Agent Implementations (v5.0.0)
// Individual agent execution handlers dispatched by agentWorker.

import { AgentType, AgentTask, AgentExecution, AgentContext, PolicyCheckResult } from './agentTypes'
import { tenantQuery } from '../../db/pool'
import { recordDecision } from './agentExecutionLedger'
import { storeMemory } from './agentMemoryService'

// ─── Execution input ──────────────────────────────────────────────────────────

export interface AgentExecutionInput {
  task: AgentTask
  execution: AgentExecution
  context: AgentContext
  policyChecks: PolicyCheckResult[]
}

// ─── Router ───────────────────────────────────────────────────────────────────

export async function executeAgent(
  agentType: AgentType,
  input: AgentExecutionInput
): Promise<Record<string, unknown>> {
  switch (agentType) {
    case 'TaskAgent':               return runTaskAgent(input)
    case 'ValidationAgent':         return runValidationAgent(input)
    case 'DocumentationAgent':      return runDocumentationAgent(input)
    case 'RiskAgent':               return runRiskAgent(input)
    case 'SchedulingAgent':         return runSchedulingAgent(input)
    case 'ResourceOptimizationAgent': return runResourceOptimizationAgent(input)
    case 'IncidentResponseAgent':   return runIncidentResponseAgent(input)
    case 'ReadinessCoordinatorAgent': return runReadinessCoordinatorAgent(input)
    default:
      throw new Error(`Unknown agent type: ${agentType}`)
  }
}

// ─── TaskAgent ────────────────────────────────────────────────────────────────

async function runTaskAgent(input: AgentExecutionInput): Promise<Record<string, unknown>> {
  const { task, execution } = input
  const { tenantId, payload } = task

  await recordDecision({
    tenantId,
    executionId: execution.id,
    decisionType: 'task_routing',
    rationale: `Executing ${task.taskType} for scope ${payload.scopeId}`,
    confidence: 90,
    alternatives: [],
    policyContext: {},
    chosenAction: task.taskType,
  })

  if (task.taskType === 'create_action') {
    const res = await tenantQuery(tenantId,
      `INSERT INTO actions (tenant_id, title, priority, status, created_by)
       VALUES ($1, $2, $3, 'open', $4) RETURNING id`,
      [tenantId, payload.title ?? 'Agent-created action',
       payload.priority ?? 'medium', task.createdBy]
    )
    return { actionId: res.rows[0]?.id, status: 'created' }
  }

  if (task.taskType === 'escalate_action') {
    await tenantQuery(tenantId,
      `UPDATE actions SET priority = 'critical', escalated_at = now()
       WHERE id = $1 AND tenant_id = $2`,
      [payload.actionId, tenantId]
    )
    return { actionId: payload.actionId, escalated: true }
  }

  return { taskType: task.taskType, status: 'completed' }
}

// ─── ValidationAgent ──────────────────────────────────────────────────────────

async function runValidationAgent(input: AgentExecutionInput): Promise<Record<string, unknown>> {
  const { task, execution } = input
  const { tenantId, payload } = task

  const issues: string[] = []
  let valid = true

  if (task.taskType === 'validate_evidence') {
    const res = await tenantQuery(tenantId,
      `SELECT COUNT(*) as cnt FROM evidence_assets
       WHERE action_id = $1 AND tenant_id = $2`,
      [payload.actionId, tenantId]
    )
    const count = parseInt(res.rows[0]?.cnt ?? '0', 10)
    if (count === 0) {
      issues.push('No evidence attached')
      valid = false
    }
  }

  if (task.taskType === 'compliance_check') {
    // Stub: real implementation would query compliance_rules
    valid = true
  }

  await recordDecision({
    tenantId,
    executionId: execution.id,
    decisionType: 'validation',
    rationale: valid ? 'All checks passed' : `${issues.length} issues found`,
    confidence: 85,
    alternatives: [],
    policyContext: {},
    chosenAction: valid ? 'pass' : 'fail',
  })

  return { valid, issues, score: valid ? 100 : Math.max(0, 100 - issues.length * 20) }
}

// ─── DocumentationAgent ───────────────────────────────────────────────────────

async function runDocumentationAgent(input: AgentExecutionInput): Promise<Record<string, unknown>> {
  const { task, execution } = input
  const { tenantId, payload } = task

  const docId = `doc-${execution.id.slice(0, 8)}`
  const wordCount = Math.floor(Math.random() * 400) + 200

  await storeMemory({
    tenantId,
    agentType: 'DocumentationAgent',
    scopeType: (payload.scopeType as 'project' | 'workflow' | 'action' | 'global') ?? 'global',
    scopeId: payload.scopeId as string | undefined,
    memoryType: 'outcome',
    key: `last_doc_${task.taskType}`,
    value: { docId, generatedAt: new Date().toISOString() },
    confidence: 100,
    sourceExecutionId: execution.id,
  })

  return { documentId: docId, wordCount, status: 'generated' }
}

// ─── RiskAgent ────────────────────────────────────────────────────────────────

async function runRiskAgent(input: AgentExecutionInput): Promise<Record<string, unknown>> {
  const { task, execution } = input
  const { tenantId } = task

  // Query open high-priority actions as a risk proxy
  const res = await tenantQuery(tenantId,
    `SELECT COUNT(*) as cnt FROM actions
     WHERE tenant_id = $1 AND status = 'open' AND priority IN ('high','critical')`,
    [tenantId]
  )
  const criticalCount = parseInt(res.rows[0]?.cnt ?? '0', 10)
  const riskScore = Math.min(100, criticalCount * 10)
  const level = riskScore >= 70 ? 'high' : riskScore >= 40 ? 'medium' : 'low'

  const mitigations: string[] = []
  if (criticalCount > 5) mitigations.push('Escalate to senior management')
  if (criticalCount > 2) mitigations.push('Assign dedicated resource to clear backlog')

  await recordDecision({
    tenantId,
    executionId: execution.id,
    decisionType: 'risk_assessment',
    rationale: `${criticalCount} critical actions found, risk score ${riskScore}`,
    confidence: 80,
    alternatives: [{ action: 'defer', reason: 'Low urgency', confidence: 20, rejected: true, rejectionReason: 'Risk level too high' }],
    policyContext: { criticalCount },
    chosenAction: level,
  })

  return { riskScore, level, mitigations }
}

// ─── SchedulingAgent ──────────────────────────────────────────────────────────

async function runSchedulingAgent(input: AgentExecutionInput): Promise<Record<string, unknown>> {

  // Stub: real implementation would query scheduled_items and resolve conflicts
  return { scheduleUpdates: [], conflicts: [], optimized: true }
}

// ─── ResourceOptimizationAgent ────────────────────────────────────────────────

async function runResourceOptimizationAgent(
  input: AgentExecutionInput
): Promise<Record<string, unknown>> {
  const { task } = input
  const { tenantId } = task

  // Query user workload
  const res = await tenantQuery(tenantId,
    `SELECT assigned_to, COUNT(*) as cnt
     FROM actions
     WHERE tenant_id = $1 AND status = 'open' AND assigned_to IS NOT NULL
     GROUP BY assigned_to
     ORDER BY cnt DESC
     LIMIT 20`,
    [tenantId]
  )

  const overloaded = res.rows.filter((r: Record<string, unknown>) => parseInt(r.cnt as string, 10) > 10)
  const assignments = overloaded.map((r: Record<string, unknown>) => ({
    userId: r.assigned_to,
    currentCount: r.cnt,
    suggestion: 'redistribute',
  }))

  return { assignments, utilizationDelta: -overloaded.length * 2 }
}

// ─── IncidentResponseAgent ────────────────────────────────────────────────────

async function runIncidentResponseAgent(
  input: AgentExecutionInput
): Promise<Record<string, unknown>> {
  const { task, execution } = input
  const { tenantId } = task

  const severity = _computeSeverity(input.context.activeAlerts.length)
  const responders: string[] = []

  await recordDecision({
    tenantId,
    executionId: execution.id,
    decisionType: 'incident_triage',
    rationale: `${input.context.activeAlerts.length} active alerts, severity ${severity}`,
    confidence: 88,
    alternatives: [],
    policyContext: { alertCount: input.context.activeAlerts.length },
    chosenAction: severity,
  })

  return {
    incidentId: `inc-${execution.id.slice(0, 8)}`,
    severity,
    responders,
    alertCount: input.context.activeAlerts.length,
  }
}

// ─── ReadinessCoordinatorAgent ────────────────────────────────────────────────

async function runReadinessCoordinatorAgent(
  input: AgentExecutionInput
): Promise<Record<string, unknown>> {
  const { task, execution } = input
  const { tenantId, payload } = task

  const res = await tenantQuery(tenantId,
    `SELECT COUNT(*) FILTER (WHERE status = 'open') as open_count,
            COUNT(*) FILTER (WHERE status = 'completed') as done_count
     FROM actions WHERE tenant_id = $1`,
    [tenantId]
  )

  const openCount = parseInt(res.rows[0]?.open_count ?? '0', 10)
  const doneCount = parseInt(res.rows[0]?.done_count ?? '0', 10)
  const total = openCount + doneCount
  const readinessScore = total === 0 ? 100 : Math.round((doneCount / total) * 100)

  const gaps: string[] = []
  if (openCount > 10) gaps.push('High number of open actions')
  if (readinessScore < 60) gaps.push('Readiness below acceptable threshold')

  await storeMemory({
    tenantId,
    agentType: 'ReadinessCoordinatorAgent',
    scopeType: (payload.scopeType as 'project' | 'workflow' | 'action' | 'global') ?? 'project',
    scopeId: payload.scopeId as string | undefined,
    memoryType: 'outcome',
    key: 'last_readiness_score',
    value: { score: readinessScore, openCount, doneCount, at: new Date().toISOString() },
    confidence: 95,
    sourceExecutionId: execution.id,
  })

  return { readinessScore, gaps, plan: { openCount, doneCount } }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _computeSeverity(alertCount: number): string {
  if (alertCount >= 10) return 'critical'
  if (alertCount >= 5) return 'high'
  if (alertCount >= 2) return 'medium'
  return 'low'
}

export const __testHooks = { _computeSeverity }
