/**
 * Denver Engineering — RFI Copilot (v4.46.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * AI RFI assistant (vision Phase 3). For a given RFI it answers, deterministically
 * and grounded in real data:
 *   • "Has this been asked before?" — similar prior RFIs by text overlap (precedent)
 *   • "Who should answer?"          — responders ranked by discipline answer history
 *   • Impact analysis               — schedule pressure + how many downstream actions
 *                                     this RFI is blocking
 *
 * The similarity + impact logic is PURE and unit-tested. No LLM in the ranking;
 * an LLM "summarize the precedent" step can wrap this later.
 */
import { tenantQuery } from '../../db/pool'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RfiLite { id: string; rfi_number?: string; title?: string; description?: string; status?: string; response?: string | null }
export interface SimilarRfi { id: string; rfiNumber: string; title: string; status: string; similarity: number; hasResponse: boolean }
export interface SuggestedResponder { userId: string; answered: number }
export interface RfiImpact { scheduleRisk: 'high' | 'medium' | 'low'; blockingCount: number; daysOverdue: number | null; reasons: string[] }

export interface RfiCopilotResult {
  rfi: { id: string; rfiNumber: string; title: string; discipline: string | null; status: string }
  similar: SimilarRfi[]
  suggestedResponders: SuggestedResponder[]
  impact: RfiImpact
}

// ─── Text similarity (pure) ───────────────────────────────────────────────────

const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'with', 'this', 'that', 'from', 'has', 'have', 'will', 'shall',
  'please', 'confirm', 'provide', 'regarding', 'about', 'into', 'per', 'any', 'all', 'can',
  'rfi', 'request', 'information', 'question', 'need', 'should', 'would', 'what', 'which', 'when',
])

export function tokenize(text: string | null | undefined): Set<string> {
  if (!text) return new Set()
  const words = text.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !STOPWORDS.has(w))
  return new Set(words)
}

/** Jaccard overlap of two token sets, 0–1. */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  const union = a.size + b.size - inter
  return union === 0 ? 0 : inter / union
}

/** Rank candidate RFIs by text similarity to the target (precedent search). */
export function findSimilarRfis(target: RfiLite, candidates: RfiLite[], limit = 5, minScore = 0.12): SimilarRfi[] {
  const targetTokens = tokenize(`${target.title ?? ''} ${target.description ?? ''}`)
  return candidates
    .filter(c => c.id !== target.id)
    .map(c => ({
      id: c.id,
      rfiNumber: c.rfi_number ?? c.id.slice(0, 8),
      title: c.title ?? '',
      status: c.status ?? 'open',
      similarity: Math.round(jaccard(targetTokens, tokenize(`${c.title ?? ''} ${c.description ?? ''}`)) * 100) / 100,
      hasResponse: !!(c.response && String(c.response).trim()),
    }))
    .filter(s => s.similarity >= minScore)
    .sort((a, b) => b.similarity - a.similarity || (b.hasResponse ? 1 : 0) - (a.hasResponse ? 1 : 0))
    .slice(0, limit)
}

// ─── Impact (pure) ────────────────────────────────────────────────────────────

export function assessImpact(
  rfi: { priority?: string; status?: string; due_date?: string | Date | null }, blockingCount: number, now: Date,
): RfiImpact {
  const due = rfi.due_date ? new Date(rfi.due_date) : null
  const daysOverdue = due && !isNaN(due.getTime()) ? Math.floor((now.getTime() - due.getTime()) / 86_400_000) : null
  const reasons: string[] = []
  let weight = 0
  if (rfi.priority === 'critical') { weight += 2; reasons.push('critical priority') }
  else if (rfi.priority === 'high') { weight += 1; reasons.push('high priority') }
  if (daysOverdue != null && daysOverdue > 0) { weight += daysOverdue >= 7 ? 2 : 1; reasons.push(`${daysOverdue} days overdue`) }
  if (blockingCount > 0) { weight += 2; reasons.push(`blocking ${blockingCount} downstream item${blockingCount === 1 ? '' : 's'}`) }
  const scheduleRisk: RfiImpact['scheduleRisk'] = weight >= 4 ? 'high' : weight >= 2 ? 'medium' : 'low'
  if (reasons.length === 0) reasons.push('no schedule pressure detected')
  return { scheduleRisk, blockingCount, daysOverdue, reasons }
}

// ─── DB-backed builder ────────────────────────────────────────────────────────

export async function buildRfiCopilot(tenantId: string, rfiId: string, now: Date = new Date()): Promise<RfiCopilotResult | null> {
  const rfiRes = await tenantQuery(tenantId,
    `SELECT id, project_id, rfi_number, title, description, discipline, priority, status, due_date
       FROM rfis WHERE tenant_id=$1 AND id=$2`, [tenantId, rfiId])
  const rfi = rfiRes.rows[0] as (RfiLite & { project_id: string; discipline?: string | null; priority?: string; due_date?: string | Date | null }) | undefined
  if (!rfi) return null

  const [candidates, responders, blocking] = await Promise.all([
    tenantQuery(tenantId,
      `SELECT id, rfi_number, title, description, status, response
         FROM rfis WHERE tenant_id=$1 AND project_id=$2 AND id<>$3 LIMIT 500`, [tenantId, rfi.project_id, rfiId]),
    tenantQuery(tenantId,
      `SELECT response_by AS user_id, COUNT(*)::int AS answered
         FROM rfis
        WHERE tenant_id=$1 AND project_id=$2 AND response_by IS NOT NULL
          AND status IN ('answered','closed')
          ${rfi.discipline ? 'AND discipline=$3' : ''}
        GROUP BY response_by ORDER BY answered DESC LIMIT 5`,
      rfi.discipline ? [tenantId, rfi.project_id, rfi.discipline] : [tenantId, rfi.project_id]),
    tenantQuery(tenantId,
      `SELECT COUNT(*)::int AS blocking
         FROM action_relations ar
         JOIN actions a ON a.id = ar.source_action_id AND a.tenant_id = ar.tenant_id
        WHERE ar.tenant_id=$1 AND ar.relation_type='blocks' AND ar.deleted_at IS NULL
          AND a.source_module='rfis' AND a.source_id=$2`, [tenantId, rfiId]),
  ])

  const blockingCount = Number((blocking.rows[0] as { blocking?: number })?.blocking ?? 0)

  return {
    rfi: {
      id: rfi.id, rfiNumber: rfi.rfi_number ?? rfi.id.slice(0, 8), title: rfi.title ?? '',
      discipline: rfi.discipline ?? null, status: rfi.status ?? 'open',
    },
    similar: findSimilarRfis(rfi, candidates.rows as RfiLite[]),
    suggestedResponders: (responders.rows as { user_id: string; answered: number }[]).map(r => ({ userId: r.user_id, answered: Number(r.answered) })),
    impact: assessImpact(rfi, blockingCount, now),
  }
}
