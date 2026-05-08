// Denver Engineering — Agent Memory Service (v5.0.0)
// Persistent agent memory with associative graph links.

import { tenantQuery } from '../../db/pool'
import {
  AgentMemoryEntry,
  StoreMemoryInput,
  AgentType,
  MemoryType,
  MemoryScopeType,
  LinkType,
} from './agentTypes'

// ─── Store memory ─────────────────────────────────────────────────────────────

export async function storeMemory(input: StoreMemoryInput): Promise<AgentMemoryEntry> {
  const {
    tenantId, agentType, scopeType, scopeId, memoryType,
    key, value, confidence, sourceExecutionId, expiresAt,
  } = input

  const res = await tenantQuery(
    tenantId,
    `INSERT INTO agent_memory_entries
       (tenant_id, agent_type, scope_type, scope_id, memory_type, key, value,
        confidence, source_execution_id, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (tenant_id, agent_type, scope_type, scope_id, key)
     DO UPDATE SET
       value = EXCLUDED.value,
       confidence = EXCLUDED.confidence,
       source_execution_id = EXCLUDED.source_execution_id,
       expires_at = EXCLUDED.expires_at,
       updated_at = now()
     RETURNING *`,
    [
      tenantId, agentType ?? null, scopeType, scopeId ?? null,
      memoryType, key, JSON.stringify(value),
      confidence ?? null, sourceExecutionId ?? null,
      expiresAt?.toISOString() ?? null,
    ]
  )
  return _mapEntry(res.rows[0])
}

// ─── Recall memory ────────────────────────────────────────────────────────────

export async function recallMemory(
  tenantId: string,
  agentType: AgentType,
  scopeType: MemoryScopeType,
  scopeId: string,
  key: string
): Promise<AgentMemoryEntry | null> {
  const res = await tenantQuery(
    tenantId,
    `UPDATE agent_memory_entries
     SET times_accessed = times_accessed + 1, last_accessed = now()
     WHERE tenant_id = $1
       AND (agent_type = $2 OR agent_type IS NULL)
       AND scope_type = $3
       AND (scope_id = $4 OR scope_id IS NULL)
       AND key = $5
       AND (expires_at IS NULL OR expires_at > now())
     RETURNING *`,
    [tenantId, agentType, scopeType, scopeId || null, key]
  )
  return res.rows.length > 0 ? _mapEntry(res.rows[0]) : null
}

export async function queryMemory(
  tenantId: string,
  filters: {
    agentType?: AgentType
    scopeType?: MemoryScopeType
    scopeId?: string
    memoryType?: MemoryType
    minConfidence?: number
    limit?: number
  } = {}
): Promise<AgentMemoryEntry[]> {
  const conditions: string[] = [
    'tenant_id = $1',
    '(expires_at IS NULL OR expires_at > now())',
  ]
  const params: unknown[] = [tenantId]
  let idx = 2

  if (filters.agentType) {
    conditions.push(`(agent_type = $${idx++} OR agent_type IS NULL)`)
    params.push(filters.agentType)
  }
  if (filters.scopeType) {
    conditions.push(`scope_type = $${idx++}`)
    params.push(filters.scopeType)
  }
  if (filters.scopeId !== undefined) {
    conditions.push(`(scope_id = $${idx++} OR scope_id IS NULL)`)
    params.push(filters.scopeId)
  }
  if (filters.memoryType) {
    conditions.push(`memory_type = $${idx++}`)
    params.push(filters.memoryType)
  }
  if (filters.minConfidence !== undefined) {
    conditions.push(`confidence >= $${idx++}`)
    params.push(filters.minConfidence)
  }

  params.push(filters.limit ?? 50)

  const res = await tenantQuery(
    tenantId,
    `SELECT * FROM agent_memory_entries
     WHERE ${conditions.join(' AND ')}
     ORDER BY confidence DESC NULLS LAST, last_accessed DESC NULLS LAST
     LIMIT $${idx}`,
    params
  )
  return res.rows.map(_mapEntry)
}

// ─── Forget (expire) memory ───────────────────────────────────────────────────

export async function forgetMemory(
  tenantId: string,
  agentType: AgentType,
  scopeType: MemoryScopeType,
  scopeId: string,
  key: string
): Promise<boolean> {
  const res = await tenantQuery(
    tenantId,
    `DELETE FROM agent_memory_entries
     WHERE tenant_id = $1 AND agent_type = $2
       AND scope_type = $3 AND scope_id = $4 AND key = $5
     RETURNING id`,
    [tenantId, agentType, scopeType, scopeId || null, key]
  )
  return res.rows.length > 0
}

// ─── Memory links ─────────────────────────────────────────────────────────────

export async function linkMemory(
  tenantId: string,
  fromEntryId: string,
  toEntryId: string,
  linkType: LinkType,
  strength = 1.0
): Promise<void> {
  await tenantQuery(
    tenantId,
    `INSERT INTO agent_memory_links (tenant_id, from_entry, to_entry, link_type, strength)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (from_entry, to_entry, link_type) DO UPDATE SET strength = EXCLUDED.strength`,
    [tenantId, fromEntryId, toEntryId, linkType, strength]
  )
}

export async function getLinkedMemories(
  tenantId: string,
  entryId: string,
  linkType?: LinkType
): Promise<AgentMemoryEntry[]> {
  const filter = linkType ? 'AND l.link_type = $3' : ''
  const params: unknown[] = [tenantId, entryId]
  if (linkType) params.push(linkType)

  const res = await tenantQuery(
    tenantId,
    `SELECT e.*
     FROM agent_memory_entries e
     JOIN agent_memory_links l ON l.to_entry = e.id
     WHERE l.from_entry = $2
       AND e.tenant_id = $1
       AND (e.expires_at IS NULL OR e.expires_at > now())
       ${filter}
     ORDER BY l.strength DESC`,
    params
  )
  return res.rows.map(_mapEntry)
}

// ─── Purge expired ────────────────────────────────────────────────────────────

export async function purgeExpiredMemory(tenantId: string): Promise<number> {
  const res = await tenantQuery(
    tenantId,
    `DELETE FROM agent_memory_entries
     WHERE tenant_id = $1 AND expires_at < now()
     RETURNING id`,
    [tenantId]
  )
  return res.rows.length
}

// ─── Row mapper ───────────────────────────────────────────────────────────────

function _mapEntry(row: Record<string, unknown>): AgentMemoryEntry {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    agentType: row.agent_type != null ? row.agent_type as AgentType : undefined,
    scopeType: row.scope_type as MemoryScopeType,
    scopeId: row.scope_id != null ? row.scope_id as string : undefined,
    memoryType: row.memory_type as MemoryType,
    key: row.key as string,
    value: (row.value ?? {}) as Record<string, unknown>,
    confidence: row.confidence != null ? row.confidence as number : undefined,
    sourceExecutionId: row.source_execution_id != null ? row.source_execution_id as string : undefined,
    timesAccessed: row.times_accessed as number,
    lastAccessed: row.last_accessed != null ? new Date(row.last_accessed as string) : undefined,
    expiresAt: row.expires_at != null ? new Date(row.expires_at as string) : undefined,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  }
}

export const __testHooks = { _mapEntry }
