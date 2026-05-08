// Denver Engineering — Agent Execution Ledger (v5.0.0)
// Immutable record of all agent executions with decision traces and event log.

import { tenantQuery } from '../../db/pool'
import {
  AgentExecution,
  AgentDecisionTrace,
  DecisionAlternative,
  PolicyCheckResult,
  AgentType,
  ExecutionStatus,
} from './agentTypes'

// ─── Open execution ───────────────────────────────────────────────────────────

export interface OpenExecutionInput {
  tenantId: string
  taskId: string
  agentType: AgentType
  agentVersion?: string
  inputSnapshot: Record<string, unknown>
  workerId: string
}

export async function openExecution(input: OpenExecutionInput): Promise<AgentExecution> {
  const {
    tenantId, taskId, agentType, agentVersion = '1.0.0',
    inputSnapshot, workerId,
  } = input

  const res = await tenantQuery(
    tenantId,
    `INSERT INTO agent_executions
       (tenant_id, task_id, agent_type, agent_version, input_snapshot, worker_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [tenantId, taskId, agentType, agentVersion, JSON.stringify(inputSnapshot), workerId]
  )
  return _mapExecution(res.rows[0])
}

// ─── Close execution ──────────────────────────────────────────────────────────

export async function closeExecution(
  executionId: string,
  tenantId: string,
  status: ExecutionStatus,
  output?: Record<string, unknown>,
  policyChecks?: PolicyCheckResult[],
  tokensUsed?: number
): Promise<void> {
  const completedAt = new Date()
  // Fetch start time to compute duration
  const start = await tenantQuery(
    tenantId,
    'SELECT started_at FROM agent_executions WHERE id = $1 AND tenant_id = $2',
    [executionId, tenantId]
  )
  const startedAt = start.rows[0]?.started_at
    ? new Date(start.rows[0].started_at)
    : completedAt
  const durationMs = completedAt.getTime() - startedAt.getTime()

  // Direct pool query bypasses immutable rule on UPDATE — we use a separate
  // "finalize" row instead: insert a completion event rather than updating.
  // The execution row itself is immutable after INSERT.
  await appendExecutionEvent(executionId, tenantId, 'execution_closed', {
    status,
    output: output ?? {},
    policyChecks: policyChecks ?? [],
    tokensUsed: tokensUsed ?? 0,
    durationMs,
    completedAt: completedAt.toISOString(),
  })
}

// ─── Execution events ─────────────────────────────────────────────────────────

export async function appendExecutionEvent(
  executionId: string,
  tenantId: string,
  eventType: string,
  payload: Record<string, unknown>
): Promise<void> {
  await tenantQuery(
    tenantId,
    `INSERT INTO agent_execution_events
       (tenant_id, execution_id, event_type, sequence_num, payload)
     VALUES ($1, $2, $3,
       (SELECT COALESCE(MAX(sequence_num), 0) + 1
        FROM agent_execution_events
        WHERE execution_id = $2),
       $4)`,
    [tenantId, executionId, eventType, JSON.stringify(payload)]
  )
}

// ─── Decision traces ──────────────────────────────────────────────────────────

export interface RecordDecisionInput {
  tenantId: string
  executionId: string
  decisionType: string
  rationale: string
  confidence: number
  alternatives: DecisionAlternative[]
  policyContext: Record<string, unknown>
  chosenAction: string
}

export async function recordDecision(input: RecordDecisionInput): Promise<AgentDecisionTrace> {
  const res = await tenantQuery(
    input.tenantId,
    `INSERT INTO agent_decision_traces
       (tenant_id, execution_id, decision_type, rationale, confidence,
        alternatives, policy_context, chosen_action)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      input.tenantId, input.executionId, input.decisionType, input.rationale,
      input.confidence, JSON.stringify(input.alternatives),
      JSON.stringify(input.policyContext), input.chosenAction,
    ]
  )
  return _mapDecisionTrace(res.rows[0])
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export async function getExecution(
  executionId: string,
  tenantId: string
): Promise<AgentExecution | null> {
  const res = await tenantQuery(
    tenantId,
    'SELECT * FROM agent_executions WHERE id = $1 AND tenant_id = $2',
    [executionId, tenantId]
  )
  return res.rows.length > 0 ? _mapExecution(res.rows[0]) : null
}

export async function getExecutionEvents(
  executionId: string,
  tenantId: string
): Promise<unknown[]> {
  const res = await tenantQuery(
    tenantId,
    `SELECT * FROM agent_execution_events
     WHERE execution_id = $1 AND tenant_id = $2
     ORDER BY sequence_num ASC`,
    [executionId, tenantId]
  )
  return res.rows
}

export async function getDecisionTraces(
  executionId: string,
  tenantId: string
): Promise<AgentDecisionTrace[]> {
  const res = await tenantQuery(
    tenantId,
    `SELECT * FROM agent_decision_traces
     WHERE execution_id = $1 AND tenant_id = $2
     ORDER BY decided_at ASC`,
    [executionId, tenantId]
  )
  return res.rows.map(_mapDecisionTrace)
}

export async function listExecutions(
  tenantId: string,
  filters: { agentType?: AgentType; limit?: number; offset?: number } = {}
): Promise<AgentExecution[]> {
  const conditions: string[] = ['tenant_id = $1']
  const params: unknown[] = [tenantId]
  let idx = 2

  if (filters.agentType) {
    conditions.push(`agent_type = $${idx++}`)
    params.push(filters.agentType)
  }

  params.push(filters.limit ?? 50)
  params.push(filters.offset ?? 0)

  const res = await tenantQuery(
    tenantId,
    `SELECT * FROM agent_executions
     WHERE ${conditions.join(' AND ')}
     ORDER BY started_at DESC
     LIMIT $${idx} OFFSET $${idx + 1}`,
    params
  )
  return res.rows.map(_mapExecution)
}

// ─── Row mappers ──────────────────────────────────────────────────────────────

function _mapExecution(row: Record<string, unknown>): AgentExecution {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    taskId: row.task_id as string,
    agentType: row.agent_type as AgentType,
    agentVersion: row.agent_version as string,
    status: row.status as ExecutionStatus,
    inputSnapshot: (row.input_snapshot ?? {}) as Record<string, unknown>,
    output: row.output as Record<string, unknown> | undefined,
    policyChecks: (row.policy_checks ?? []) as PolicyCheckResult[],
    durationMs: row.duration_ms as number | undefined,
    tokensUsed: row.tokens_used as number | undefined,
    startedAt: new Date(row.started_at as string),
    completedAt: row.completed_at ? new Date(row.completed_at as string) : undefined,
    workerId: row.worker_id as string,
    createdAt: new Date(row.created_at as string),
  }
}

function _mapDecisionTrace(row: Record<string, unknown>): AgentDecisionTrace {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    executionId: row.execution_id as string,
    decisionType: row.decision_type as string,
    rationale: row.rationale as string,
    confidence: row.confidence as number,
    alternatives: (row.alternatives ?? []) as DecisionAlternative[],
    policyContext: (row.policy_context ?? {}) as Record<string, unknown>,
    chosenAction: row.chosen_action as string,
    decidedAt: new Date(row.decided_at as string),
  }
}

export const __testHooks = { _mapExecution, _mapDecisionTrace }
