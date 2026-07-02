/**
 * Denver Engineering — Personal Agent Service (ADR-012, Phase 1)
 * ─────────────────────────────────────────────────────────────────────────────
 * A per-USER orchestrator over the shared agent infrastructure. Phase 1 is
 * strictly READ-ONLY / personal-memory only:
 *   - personal memory  (user-scoped facts/preferences)
 *   - briefing         (the user's My Work + their personal memory)
 *   - ask              (knowledge Q&A on the user's behalf, via askJarvis)
 * No autonomous actions, no writes to business data (that is Phase 2+, which
 * needs the autonomy/approval decisions in ADR-012).
 *
 * Identity (tenantId + userId) is ALWAYS supplied by the caller from the auth
 * token — never from a request body. Flag-gated by PERSONAL_AGENT (default off).
 *
 * Personal memory reuses `agent_memory_entries` with scope_type='user',
 * scope_id=<userId>, agent_type='personal_agent' (a non-null sentinel so the
 * upsert/delete key works — NULL agent_type would defeat the unique index).
 */
import { tenantQuery } from '../../db/pool'
import { queryMemory } from './agentMemoryService'
import { buildMyWork, type MyWorkResult } from '../myWork/myWorkService'
import { askJarvis, type AskResult } from '../askBuilder'
import type { MemoryType } from './agentTypes'

const USER_SCOPE = 'user'
const PERSONAL_AGENT = 'personal_agent'   // agent_type sentinel for personal memory

/** Feature flag — dormant until enabled. Default: off. */
export function isPersonalAgentEnabled(): boolean {
  return process.env['PERSONAL_AGENT'] === 'true'
}

/** A single personal-memory item (decoupled from the internal AgentMemoryEntry). */
export interface PersonalMemory {
  key: string
  value: Record<string, unknown>
  memoryType: MemoryType
  confidence: number | null
}

export interface RememberInput {
  tenantId: string
  userId: string
  key: string
  value: Record<string, unknown>
  memoryType?: MemoryType     // default 'preference'
  confidence?: number         // 0–100 (column CHECK); clamped
}

/** Store/update one personal fact or preference for a user. */
export async function rememberForUser(input: RememberInput): Promise<PersonalMemory> {
  const memoryType: MemoryType = input.memoryType ?? 'preference'
  const confidence =
    input.confidence == null ? null : Math.max(0, Math.min(100, input.confidence))

  const res = await tenantQuery(
    input.tenantId,
    `INSERT INTO agent_memory_entries
       (tenant_id, agent_type, scope_type, scope_id, memory_type, key, value, confidence)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (tenant_id, agent_type, scope_type, scope_id, key)
     DO UPDATE SET
       value       = EXCLUDED.value,
       memory_type = EXCLUDED.memory_type,
       confidence  = EXCLUDED.confidence,
       updated_at  = now()
     RETURNING key, value, memory_type, confidence`,
    [input.tenantId, PERSONAL_AGENT, USER_SCOPE, input.userId, memoryType, input.key,
     JSON.stringify(input.value), confidence]
  )
  const row = res.rows[0]
  return {
    key: row.key,
    value: row.value,
    memoryType: row.memory_type,
    confidence: row.confidence == null ? null : Number(row.confidence),
  }
}

/** All personal memory for a user (highest-confidence first via queryMemory). */
export async function listUserMemory(tenantId: string, userId: string): Promise<PersonalMemory[]> {
  const entries = await queryMemory(tenantId, {
    scopeType: USER_SCOPE,
    scopeId: userId,
    limit: 200,
  })
  return entries.map(e => ({
    key: e.key,
    value: e.value,
    memoryType: e.memoryType,
    confidence: e.confidence == null ? null : Number(e.confidence),
  }))
}

/** Forget one personal-memory key. Returns true if a row was removed. */
export async function forgetUserMemory(tenantId: string, userId: string, key: string): Promise<boolean> {
  const res = await tenantQuery(
    tenantId,
    `DELETE FROM agent_memory_entries
     WHERE tenant_id = $1 AND agent_type = $2 AND scope_type = $3 AND scope_id = $4 AND key = $5
     RETURNING id`,
    [tenantId, PERSONAL_AGENT, USER_SCOPE, userId, key]
  )
  return res.rows.length > 0
}

export interface PersonalBriefing {
  userId: string
  work: MyWorkResult
  memory: PersonalMemory[]
  generatedAt: string
}

/** Read-only "what's on your plate": the user's My Work + their personal memory. */
export async function getPersonalBriefing(
  tenantId: string, userId: string, now: Date = new Date(),
): Promise<PersonalBriefing> {
  const [work, memory] = await Promise.all([
    buildMyWork(tenantId, userId, now),
    listUserMemory(tenantId, userId),
  ])
  return { userId, work, memory, generatedAt: now.toISOString() }
}

export interface PersonalAskInput {
  tenantId: string
  userId: string
  question: string
  projectId?: string | null
}

export interface PersonalAskResult {
  answer: AskResult
  personalMemoryUsed: PersonalMemory[]
}

/**
 * Knowledge Q&A on behalf of a user. Phase 1 delegates the LLM call to the
 * existing, tested askJarvis path (scoped to this user) and attaches the user's
 * personal memory. Read-only. Requires ANTHROPIC_API_KEY (askJarvis throws
 * without it — the route surfaces that as a clear error).
 */
export async function askPersonalAgent(input: PersonalAskInput): Promise<PersonalAskResult> {
  const [answer, personalMemoryUsed] = await Promise.all([
    askJarvis({
      tenantId: input.tenantId,
      userId: input.userId,
      question: input.question,
      projectId: input.projectId ?? null,
      agentType: PERSONAL_AGENT,   // cost attribution → 'personal_agent'
    }),
    listUserMemory(input.tenantId, input.userId),
  ])
  return { answer, personalMemoryUsed }
}
