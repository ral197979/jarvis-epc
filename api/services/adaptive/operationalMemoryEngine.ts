// Denver Engineering — Operational Memory Engine (v7.0.0)
// Persists and retrieves cross-session operational insights with confidence decay.

import { tenantQuery } from '../../db/pool'
import { MemoryInsight } from './adaptiveTypes'

// ─── Store / upsert insight ───────────────────────────────────────────────────

export interface StoreMemoryInput {
  scopeType: string     // 'project' | 'equipment' | 'portfolio' | 'global'
  scopeId?: string
  agentType: string
  key: string
  value: unknown
  confidence: number
  decayRate?: number    // per day; 0 = never decays
  ttlDays?: number
}

export async function storeMemory(
  tenantId: string,
  input: StoreMemoryInput,
): Promise<void> {
  const {
    scopeType, scopeId, agentType, key, value,
    confidence, decayRate = 0.01, ttlDays,
  } = input

  const expiresAt = ttlDays != null
    ? new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000)
    : null

  // Use agent_memory table from Phase 5 if available
  try {
    await tenantQuery(
      tenantId,
      `INSERT INTO agent_memory
        (tenant_id, agent_type, scope_type, scope_id, key, value, confidence, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (tenant_id, agent_type, scope_type, scope_id, key)
       DO UPDATE SET
         value = EXCLUDED.value,
         confidence = EXCLUDED.confidence,
         metadata = agent_memory.metadata || EXCLUDED.metadata,
         updated_at = now()`,
      [
        tenantId, agentType, scopeType, scopeId ?? 'global',
        key, JSON.stringify(value), confidence,
        JSON.stringify({ decayRate, expiresAt }),
      ],
    )
  } catch {
    // Phase 5 table may not be present in test environments; silently ignore
  }
}

// ─── Retrieve insight ─────────────────────────────────────────────────────────

export async function recallMemory(
  tenantId: string,
  opts: {
    agentType: string
    scopeType: string
    scopeId?: string
    key: string
  },
): Promise<MemoryInsight | null> {
  const { agentType, scopeType, scopeId, key } = opts

  try {
    const res = await tenantQuery(
      tenantId,
      `SELECT *
       FROM agent_memory
       WHERE tenant_id = $1
         AND agent_type = $2
         AND scope_type = $3
         AND scope_id = $4
         AND key = $5`,
      [tenantId, agentType, scopeType, scopeId ?? 'global', key],
    )

    if (res.rows.length === 0) return null
    return _mapMemory(res.rows[0])
  } catch {
    return null
  }
}

// ─── List insights by scope ───────────────────────────────────────────────────

export async function listMemories(
  tenantId: string,
  opts: {
    agentType?: string
    scopeType?: string
    scopeId?: string
    minConfidence?: number
    limit?: number
  } = {},
): Promise<MemoryInsight[]> {
  const { agentType, scopeType, scopeId, minConfidence = 0, limit = 50 } = opts
  const params: unknown[] = [tenantId, minConfidence]
  const clauses = ['tenant_id = $1', 'confidence >= $2']

  if (agentType != null)  { params.push(agentType);  clauses.push(`agent_type = $${params.length}`) }
  if (scopeType != null)  { params.push(scopeType);  clauses.push(`scope_type = $${params.length}`) }
  if (scopeId != null)    { params.push(scopeId);    clauses.push(`scope_id = $${params.length}`) }

  params.push(limit)

  try {
    const res = await tenantQuery(
      tenantId,
      `SELECT * FROM agent_memory
       WHERE ${clauses.join(' AND ')}
       ORDER BY confidence DESC, updated_at DESC
       LIMIT $${params.length}`,
      params,
    )
    return res.rows.map(_mapMemory)
  } catch {
    return []
  }
}

// ─── Apply decay ──────────────────────────────────────────────────────────────

export async function applyMemoryDecay(
  tenantId: string,
  agentType: string,
  scopeType: string,
  scopeId?: string,
): Promise<number> {
  // Returns number of records decayed
  const MIN_CONFIDENCE = 0.1

  try {
    const res = await tenantQuery(
      tenantId,
      `UPDATE agent_memory
       SET
         confidence = GREATEST($3, confidence - (
           EXTRACT(EPOCH FROM (now() - updated_at)) / 86400.0
           * COALESCE((metadata->>'decayRate')::float, 0.01)
         )),
         updated_at = now()
       WHERE tenant_id = $1
         AND agent_type = $2
         AND scope_type = $4
         AND scope_id = COALESCE($5, scope_id)
       RETURNING id`,
      [tenantId, agentType, MIN_CONFIDENCE, scopeType, scopeId ?? null],
    )
    return res.rows.length
  } catch {
    return 0
  }
}

// ─── Reinforce memory ─────────────────────────────────────────────────────────

export async function reinforceMemory(
  tenantId: string,
  agentType: string,
  scopeType: string,
  scopeId: string | undefined,
  key: string,
  confidenceBoost: number,
): Promise<void> {
  try {
    await tenantQuery(
      tenantId,
      `UPDATE agent_memory
       SET
         confidence = LEAST(1.0, confidence + $2),
         updated_at = now()
       WHERE tenant_id = $1
         AND agent_type = $3
         AND scope_type = $4
         AND scope_id = $5
         AND key = $6`,
      [tenantId, confidenceBoost, agentType, scopeType, scopeId ?? 'global', key],
    )
  } catch {
    // silently ignore if table not present
  }
}

// ─── Mapper ───────────────────────────────────────────────────────────────────

function _mapMemory(row: Record<string, unknown>): MemoryInsight {
  const metadata = (row.metadata ?? {}) as Record<string, unknown>
  return {
    key: row.key as string,
    value: row.value,
    confidence: Number(row.confidence),
    decayRate: metadata.decayRate != null ? Number(metadata.decayRate) : 0.01,
    learnedAt: new Date(row.created_at as string),
    lastReinforced: new Date(row.updated_at as string),
    expiresAt: metadata.expiresAt != null ? new Date(metadata.expiresAt as string) : undefined,
  }
}

export const __testHooks = { _mapMemory }
