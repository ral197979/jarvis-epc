// Denver Engineering — Agent Governance Service (v5.0.0)
// Enforces policy constraints, approval gates, and audit trails for agent actions.

import { tenantQuery } from '../../db/pool'
import {
  AgentType,
  RequestApprovalInput,
  AgentApproval,
  ApprovalStatus,
  RiskLevel,
  PolicyCheckResult,
} from './agentTypes'
import { evaluateAgentPolicies, isBlocked, getBlockingPolicy } from './agentPolicyAdapter'
import { appendExecutionEvent } from './agentExecutionLedger'

// ─── Pre-execution governance check ──────────────────────────────────────────

export interface GovernanceCheckInput {
  tenantId: string
  agentType: AgentType
  taskType: string
  executionId?: string
  payload: Record<string, unknown>
}

export interface GovernanceCheckResult {
  allowed: boolean
  requiresApproval: boolean
  policyChecks: PolicyCheckResult[]
  blockingReason?: string
  warnings: string[]
}

export async function checkGovernance(
  input: GovernanceCheckInput
): Promise<GovernanceCheckResult> {
  const { tenantId, agentType, taskType, executionId, payload } = input

  const policyChecks = await evaluateAgentPolicies(tenantId, {
    agentType,
    taskType,
    ...payload,
  })

  const blocked = isBlocked(policyChecks)
  const blocker = getBlockingPolicy(policyChecks)
  const warnings = policyChecks.flatMap(c => c.warnings)

  const approvalCheck = policyChecks.find(c => c.policyType === 'approval_requirement')
  const requiresApproval = approvalCheck ? !approvalCheck.passed : false

  if (executionId) {
    await appendExecutionEvent(executionId, tenantId, 'governance_checked', {
      blocked,
      requiresApproval,
      policyChecksCount: policyChecks.length,
      warningsCount: warnings.length,
    })
  }

  return {
    allowed: !blocked,
    requiresApproval,
    policyChecks,
    blockingReason: blocker?.policyName,
    warnings,
  }
}

// ─── Approval requests ────────────────────────────────────────────────────────

export async function requestApproval(
  input: RequestApprovalInput
): Promise<AgentApproval> {
  const {
    tenantId, taskId, executionId, agentType, actionType,
    description, payload, riskLevel = 'medium',
    requestedBy, ttlHours = 24,
  } = input

  const res = await tenantQuery(
    tenantId,
    `INSERT INTO agent_approvals
       (tenant_id, task_id, execution_id, agent_type, action_type,
        description, payload, risk_level, requested_by,
        expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,
             now() + ($10 || ' hours')::interval)
     RETURNING *`,
    [
      tenantId, taskId, executionId ?? null, agentType, actionType,
      description, JSON.stringify(payload), riskLevel, requestedBy, ttlHours,
    ]
  )
  return _mapApproval(res.rows[0])
}

export async function approveAction(
  approvalId: string,
  tenantId: string,
  reviewedBy: string,
  notes?: string
): Promise<AgentApproval> {
  const res = await tenantQuery(
    tenantId,
    `UPDATE agent_approvals
     SET status = 'approved', reviewed_by = $3, review_notes = $4,
         reviewed_at = now()
     WHERE id = $1 AND tenant_id = $2 AND status = 'pending'
       AND expires_at > now()
     RETURNING *`,
    [approvalId, tenantId, reviewedBy, notes ?? null]
  )
  if (res.rows.length === 0) {
    throw new Error('Approval not found, already reviewed, or expired')
  }
  return _mapApproval(res.rows[0])
}

export async function rejectAction(
  approvalId: string,
  tenantId: string,
  reviewedBy: string,
  notes?: string
): Promise<AgentApproval> {
  const res = await tenantQuery(
    tenantId,
    `UPDATE agent_approvals
     SET status = 'rejected', reviewed_by = $3, review_notes = $4,
         reviewed_at = now()
     WHERE id = $1 AND tenant_id = $2 AND status = 'pending'
     RETURNING *`,
    [approvalId, tenantId, reviewedBy, notes ?? null]
  )
  if (res.rows.length === 0) {
    throw new Error('Approval not found or already reviewed')
  }
  return _mapApproval(res.rows[0])
}

export async function getApproval(
  approvalId: string,
  tenantId: string
): Promise<AgentApproval | null> {
  const res = await tenantQuery(
    tenantId,
    'SELECT * FROM agent_approvals WHERE id = $1 AND tenant_id = $2',
    [approvalId, tenantId]
  )
  return res.rows.length > 0 ? _mapApproval(res.rows[0]) : null
}

export async function listPendingApprovals(
  tenantId: string,
  agentType?: AgentType
): Promise<AgentApproval[]> {
  const params: unknown[] = [tenantId]
  const extraFilter = agentType ? 'AND agent_type = $2' : ''
  if (agentType) params.push(agentType)

  const res = await tenantQuery(
    tenantId,
    `SELECT * FROM agent_approvals
     WHERE tenant_id = $1
       AND status = 'pending'
       AND expires_at > now()
       ${extraFilter}
     ORDER BY created_at ASC`,
    params
  )
  return res.rows.map(_mapApproval)
}

// ─── Expire stale approvals ───────────────────────────────────────────────────

export async function expireStaleApprovals(tenantId: string): Promise<number> {
  const res = await tenantQuery(
    tenantId,
    `UPDATE agent_approvals
     SET status = 'expired'
     WHERE tenant_id = $1 AND status = 'pending' AND expires_at <= now()
     RETURNING id`,
    [tenantId]
  )
  return res.rows.length
}

// ─── Row mapper ───────────────────────────────────────────────────────────────

function _mapApproval(row: Record<string, unknown>): AgentApproval {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    taskId: row.task_id as string,
    executionId: row.execution_id != null ? row.execution_id as string : undefined,
    agentType: row.agent_type as AgentType,
    actionType: row.action_type as string,
    description: row.description as string,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    riskLevel: row.risk_level as RiskLevel,
    status: row.status as ApprovalStatus,
    requestedBy: row.requested_by as string,
    reviewedBy: row.reviewed_by != null ? row.reviewed_by as string : undefined,
    reviewNotes: row.review_notes != null ? row.review_notes as string : undefined,
    reviewedAt: row.reviewed_at != null ? new Date(row.reviewed_at as string) : undefined,
    expiresAt: new Date(row.expires_at as string),
    createdAt: new Date(row.created_at as string),
  }
}

export const __testHooks = { _mapApproval }
