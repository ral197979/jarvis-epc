// Denver Engineering — Agent Handoff Service (v5.0.0)
// Manages inter-agent context handoffs with TTL and acceptance protocol.

import { tenantQuery } from '../../db/pool'
import {
  AgentHandoff,
  HandoffRequest,
  HandoffStatus,
  AgentType,
} from './agentTypes'

const DEFAULT_HANDOFF_TTL_SECONDS = 300   // 5 minutes

// ─── Initiate handoff ─────────────────────────────────────────────────────────

export async function initiateHandoff(request: HandoffRequest): Promise<AgentHandoff> {
  const {
    tenantId, fromAgent, toAgent, taskId, executionId,
    contextPackage, reason, ttlSeconds = DEFAULT_HANDOFF_TTL_SECONDS,
  } = request

  const res = await tenantQuery(
    tenantId,
    `INSERT INTO agent_handoffs
       (tenant_id, from_agent, to_agent, task_id, execution_id,
        context_package, reason, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7, now() + ($8 || ' seconds')::interval)
     RETURNING *`,
    [
      tenantId, fromAgent, toAgent, taskId, executionId ?? null,
      JSON.stringify(contextPackage), reason, ttlSeconds,
    ]
  )
  return _mapHandoff(res.rows[0])
}

// ─── Accept / reject handoff ──────────────────────────────────────────────────

export async function acceptHandoff(
  handoffId: string,
  tenantId: string
): Promise<AgentHandoff> {
  const res = await tenantQuery(
    tenantId,
    `UPDATE agent_handoffs
     SET status = 'accepted', accepted_at = now()
     WHERE id = $1 AND tenant_id = $2
       AND status = 'pending' AND expires_at > now()
     RETURNING *`,
    [handoffId, tenantId]
  )
  if (res.rows.length === 0) {
    throw new Error('Handoff not found, already processed, or expired')
  }
  return _mapHandoff(res.rows[0])
}

export async function rejectHandoff(
  handoffId: string,
  tenantId: string
): Promise<AgentHandoff> {
  const res = await tenantQuery(
    tenantId,
    `UPDATE agent_handoffs
     SET status = 'rejected'
     WHERE id = $1 AND tenant_id = $2 AND status = 'pending'
     RETURNING *`,
    [handoffId, tenantId]
  )
  if (res.rows.length === 0) {
    throw new Error('Handoff not found or already processed')
  }
  return _mapHandoff(res.rows[0])
}

export async function completeHandoff(
  handoffId: string,
  tenantId: string
): Promise<AgentHandoff> {
  const res = await tenantQuery(
    tenantId,
    `UPDATE agent_handoffs
     SET status = 'completed', completed_at = now()
     WHERE id = $1 AND tenant_id = $2 AND status = 'accepted'
     RETURNING *`,
    [handoffId, tenantId]
  )
  if (res.rows.length === 0) {
    throw new Error('Handoff not found or not in accepted state')
  }
  return _mapHandoff(res.rows[0])
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export async function getPendingHandoffs(
  tenantId: string,
  toAgent: AgentType
): Promise<AgentHandoff[]> {
  const res = await tenantQuery(
    tenantId,
    `SELECT * FROM agent_handoffs
     WHERE tenant_id = $1 AND to_agent = $2
       AND status = 'pending' AND expires_at > now()
     ORDER BY created_at ASC`,
    [tenantId, toAgent]
  )
  return res.rows.map(_mapHandoff)
}

export async function getHandoff(
  handoffId: string,
  tenantId: string
): Promise<AgentHandoff | null> {
  const res = await tenantQuery(
    tenantId,
    'SELECT * FROM agent_handoffs WHERE id = $1 AND tenant_id = $2',
    [handoffId, tenantId]
  )
  return res.rows.length > 0 ? _mapHandoff(res.rows[0]) : null
}

// ─── Expire timed-out handoffs ────────────────────────────────────────────────

export async function expireTimedOutHandoffs(tenantId: string): Promise<number> {
  const res = await tenantQuery(
    tenantId,
    `UPDATE agent_handoffs
     SET status = 'timed_out'
     WHERE tenant_id = $1 AND status = 'pending' AND expires_at <= now()
     RETURNING id`,
    [tenantId]
  )
  return res.rows.length
}

// ─── Row mapper ───────────────────────────────────────────────────────────────

function _mapHandoff(row: Record<string, unknown>): AgentHandoff {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    fromAgent: row.from_agent as AgentType,
    toAgent: row.to_agent as AgentType,
    taskId: row.task_id as string,
    executionId: row.execution_id != null ? row.execution_id as string : undefined,
    status: row.status as HandoffStatus,
    contextPackage: (row.context_package ?? {}) as Record<string, unknown>,
    reason: row.reason as string,
    acceptedAt: row.accepted_at != null ? new Date(row.accepted_at as string) : undefined,
    completedAt: row.completed_at != null ? new Date(row.completed_at as string) : undefined,
    expiresAt: row.expires_at != null ? new Date(row.expires_at as string) : undefined,
    createdAt: new Date(row.created_at as string),
  }
}

export const __testHooks = { _mapHandoff }
