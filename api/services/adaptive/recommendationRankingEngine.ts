// Denver Engineering — Recommendation Ranking Engine (v7.0.0)
// Ranks recommendations by effectiveness, urgency, and historical success rates.

import { tenantQuery } from '../../db/pool'
import { RankedRecommendation } from './adaptiveTypes'
import { getAgentEffectiveness } from './recommendationFeedbackTracker'

// ─── Rank recommendations ─────────────────────────────────────────────────────

export interface RankInput {
  recommendationId: string
  recommendationType: string
  agentType: string
  entityId?: string
  entityType?: string
  urgency: number       // 0–100 — caller-provided urgency
  confidence: number    // 0–1 — model confidence
  rationale: string
}

export async function rankRecommendations(
  tenantId: string,
  candidates: RankInput[],
): Promise<RankedRecommendation[]> {
  if (candidates.length === 0) return []

  // Load historical effectiveness per agent type
  const effectivenessReports = await getAgentEffectiveness(tenantId, 60)
  const effectByAgent: Record<string, number> = {}
  for (const r of effectivenessReports) {
    effectByAgent[r.agentType] = r.avgEffectiveness
  }

  const ranked = candidates.map(c => {
    const historicalEffectiveness = effectByAgent[c.agentType] ?? 50
    const score = _computeScore(c.urgency, c.confidence, historicalEffectiveness)
    return {
      recommendationId: c.recommendationId,
      recommendationType: c.recommendationType,
      agentType: c.agentType,
      entityId: c.entityId,
      entityType: c.entityType,
      score,
      urgency: c.urgency,
      confidence: c.confidence,
      historicalEffectiveness,
      rationale: c.rationale,
    } satisfies RankedRecommendation
  })

  return ranked.sort((a, b) => b.score - a.score)
}

// ─── Score = weighted composite ───────────────────────────────────────────────

const URGENCY_WEIGHT           = 0.40
const CONFIDENCE_WEIGHT        = 0.30
const EFFECTIVENESS_WEIGHT     = 0.30

export function _computeScore(
  urgency: number,
  confidence: number,
  historicalEffectiveness: number,
): number {
  const score =
    urgency * URGENCY_WEIGHT +
    confidence * 100 * CONFIDENCE_WEIGHT +
    historicalEffectiveness * EFFECTIVENESS_WEIGHT

  return Math.round(Math.min(100, Math.max(0, score)) * 10) / 10
}

// ─── Get top N ranked recommendations from DB ─────────────────────────────────

export async function getTopRankedRecommendations(
  tenantId: string,
  limit = 10,
  agentType?: string,
): Promise<RankedRecommendation[]> {
  const params: unknown[] = [tenantId]
  const clauses = ['ro.tenant_id = $1', 'ro.outcome IN (\'accepted\',\'partially_accepted\')']

  if (agentType != null) {
    params.push(agentType)
    clauses.push(`ro.agent_type = $${params.length}`)
  }

  params.push(limit)
  const res = await tenantQuery(
    tenantId,
    `SELECT
       ro.recommendation_id,
       ro.recommendation_type,
       ro.agent_type,
       ro.entity_id,
       ro.entity_type,
       COALESCE(AVG(ro.effectiveness_score), 50)::float AS avg_effectiveness,
       COUNT(*)::int AS sample_count
     FROM recommendation_outcomes ro
     WHERE ${clauses.join(' AND ')}
     GROUP BY ro.recommendation_id, ro.recommendation_type,
              ro.agent_type, ro.entity_id, ro.entity_type
     ORDER BY avg_effectiveness DESC
     LIMIT $${params.length}`,
    params,
  )

  return res.rows.map(row => ({
    recommendationId: row.recommendation_id as string,
    recommendationType: row.recommendation_type as string,
    agentType: row.agent_type as string,
    entityId: row.entity_id != null ? String(row.entity_id) : undefined,
    entityType: row.entity_type != null ? String(row.entity_type) : undefined,
    score: Number(row.avg_effectiveness),
    urgency: 50,
    confidence: 0.7,
    historicalEffectiveness: Number(row.avg_effectiveness),
    rationale: `Top performer: ${Number(row.sample_count)} accepted outcomes`,
  }))
}

// ─── Compare two recommendations ─────────────────────────────────────────────

export function compareRecommendations(
  a: RankedRecommendation,
  b: RankedRecommendation,
): { winner: RankedRecommendation; margin: number; explanation: string } {
  const margin = Math.abs(a.score - b.score)
  const winner = a.score >= b.score ? a : b
  const explanation = margin < 5
    ? `Near tie (margin: ${margin.toFixed(1)}); prefer ${winner.agentType} by urgency`
    : `Clear winner by ${margin.toFixed(1)} points`
  return { winner, margin, explanation }
}

export const __testHooks = { _computeScore }
