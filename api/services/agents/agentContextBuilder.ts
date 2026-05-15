// Denver Engineering — Agent Context Builder (v5.0.0)
// Assembles the runtime context package delivered to agents before execution.

import { tenantQuery } from '../../db/pool'
import { AgentType, AgentContext, AgentMemoryEntry, MemoryScopeType, PolicyCheckResult } from './agentTypes'

// ─── Context assembly ─────────────────────────────────────────────────────────

export interface ContextBuildInput {
  tenantId: string
  agentType: AgentType
  scopeType: MemoryScopeType
  scopeId: string
  includeMemory?: boolean
  memoryLimit?: number
}

export async function buildAgentContext(input: ContextBuildInput): Promise<AgentContext> {
  const {
    tenantId,
    agentType,
    scopeType,
    scopeId,
    includeMemory = true,
    memoryLimit = 20,
  } = input

  const [tenant, scopeMeta, recentEvents, activeAlerts, memoryEntries] = await Promise.all([
    _fetchTenant(tenantId),
    _fetchScopeMetadata(tenantId, scopeType, scopeId),
    _fetchRecentEvents(tenantId, scopeType, scopeId),
    _fetchActiveAlerts(tenantId, scopeType, scopeId),
    includeMemory
      ? _fetchMemoryEntries(tenantId, agentType, scopeType, scopeId, memoryLimit)
      : Promise.resolve<AgentMemoryEntry[]>([]),
  ])

  return {
    tenant,
    scope: { type: scopeType, id: scopeId, metadata: scopeMeta },
    recentEvents,
    activeAlerts,
    policyConstraints: [],   // populated by governance service before execution
    memoryEntries,
    assembledAt: new Date(),
  }
}

// ─── Scope metadata resolvers ─────────────────────────────────────────────────

async function _fetchTenant(tenantId: string): Promise<{ id: string; name: string }> {
  const res = await tenantQuery(
    tenantId,
    'SELECT id, name FROM tenants WHERE id = $1',
    [tenantId]
  )
  if (res.rows.length === 0) throw new Error(`Tenant not found: ${tenantId}`)
  return { id: res.rows[0].id, name: res.rows[0].name }
}

async function _fetchScopeMetadata(
  tenantId: string,
  scopeType: MemoryScopeType,
  scopeId: string
): Promise<Record<string, unknown>> {
  if (scopeType === 'global' || !scopeId) return {}

  const tableMap: Partial<Record<MemoryScopeType, string>> = {
    project: 'projects',
    workflow: 'workflows',
    action: 'actions',
  }
  const table = tableMap[scopeType]
  if (!table) return {}

  const res = await tenantQuery(
    tenantId,
    `SELECT * FROM ${table} WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
    [scopeId, tenantId]
  )
  return res.rows[0] ?? {}
}

async function _fetchRecentEvents(
  tenantId: string,
  scopeType: MemoryScopeType,
  scopeId: string
): Promise<unknown[]> {
  const res = await tenantQuery(
    tenantId,
    `SELECT event_type, payload, occurred_at
     FROM realtime_event_log
     WHERE tenant_id = $1
       AND ($2::text IS NULL OR payload->>'scope_type' = $2)
       AND ($3::text IS NULL OR payload->>'scope_id' = $3)
     ORDER BY occurred_at DESC
     LIMIT 50`,
    [tenantId, scopeType === 'global' ? null : scopeType, scopeId || null]
  )
  return res.rows
}

async function _fetchActiveAlerts(
  tenantId: string,
  scopeType: MemoryScopeType,
  scopeId: string
): Promise<unknown[]> {
  const res = await tenantQuery(
    tenantId,
    `SELECT id, event_type, payload, occurred_at
     FROM realtime_event_log
     WHERE tenant_id = $1
       AND event_type IN ('sla_breached', 'action_escalated', 'blocker_added')
       AND ($2::text IS NULL OR payload->>'scope_id' = $2)
       AND occurred_at > now() - interval '24 hours'
     ORDER BY occurred_at DESC
     LIMIT 20`,
    [tenantId, scopeId || null]
  )
  return res.rows
}

async function _fetchMemoryEntries(
  tenantId: string,
  agentType: AgentType,
  scopeType: MemoryScopeType,
  scopeId: string,
  limit: number
): Promise<AgentMemoryEntry[]> {
  const res = await tenantQuery(
    tenantId,
    `SELECT id, agent_type, scope_type, scope_id, memory_type, key, value, confidence
     FROM agent_memory_entries
     WHERE tenant_id = $1
       AND (agent_type = $2 OR agent_type IS NULL)
       AND (scope_type = $3 OR scope_type = 'global')
       AND (scope_id = $4 OR scope_id IS NULL)
       AND (expires_at IS NULL OR expires_at > now())
     ORDER BY confidence DESC NULLS LAST, last_accessed DESC NULLS LAST
     LIMIT $5`,
    [tenantId, agentType, scopeType, scopeId || null, limit]
  )
  return res.rows as AgentMemoryEntry[]
}

// ─── Policy constraint injection ─────────────────────────────────────────────

export function injectPolicyConstraints(
  ctx: AgentContext,
  checks: PolicyCheckResult[]
): AgentContext {
  return { ...ctx, policyConstraints: checks }
}

export const __testHooks = {
  _fetchTenant,
  _fetchScopeMetadata,
  _fetchRecentEvents,
  _fetchActiveAlerts,
  _fetchMemoryEntries,
}
