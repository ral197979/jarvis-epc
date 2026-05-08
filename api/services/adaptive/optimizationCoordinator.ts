// Denver Engineering — Optimization Coordinator (v7.0.0)
// Coordinates multi-agent optimization recommendations into a unified action set.

import { tenantQuery } from '../../db/pool'
import { AgentConsensusResult, RankedRecommendation } from './adaptiveTypes'
import { rankRecommendations, RankInput } from './recommendationRankingEngine'

// ─── Multi-agent consensus ────────────────────────────────────────────────────

export interface AgentVote {
  agentType: string
  vote: string
  confidence: number
  rationale: string
}

export async function buildConsensus(
  tenantId: string,
  topic: string,
  votes: AgentVote[],
): Promise<AgentConsensusResult> {
  if (votes.length === 0) {
    return {
      topic,
      tenantId,
      agentVotes: [],
      consensus: null,
      consensusConfidence: 0,
      conflictingAgents: [],
      resolvedAt: new Date(),
    }
  }

  // Group votes
  const voteMap: Record<string, { total: number; confidence: number; agents: string[] }> = {}
  for (const v of votes) {
    if (voteMap[v.vote] == null) {
      voteMap[v.vote] = { total: 0, confidence: 0, agents: [] }
    }
    voteMap[v.vote]!.total++
    voteMap[v.vote]!.confidence += v.confidence
    voteMap[v.vote]!.agents.push(v.agentType)
  }

  // Find majority
  const sorted = Object.entries(voteMap).sort((a, b) => {
    const scoreDiff = b[1].total - a[1].total
    if (scoreDiff !== 0) return scoreDiff
    return b[1].confidence - a[1].confidence
  })

  const winner = sorted[0]
  const consensusConfidence = winner != null
    ? (winner[1].confidence / winner[1].total) * (winner[1].total / votes.length)
    : 0

  const conflictingVotes = sorted.slice(1)
  const conflictingAgents: string[] = []
  for (const [, data] of conflictingVotes) {
    conflictingAgents.push(...data.agents)
  }

  return {
    topic,
    tenantId,
    agentVotes: votes,
    consensus: winner != null ? winner[0] : null,
    consensusConfidence: Math.round(consensusConfidence * 100) / 100,
    conflictingAgents,
    resolvedAt: new Date(),
  }
}

// ─── Coordinate recommendations ───────────────────────────────────────────────

export interface CoordinationInput {
  agentType: string
  recommendations: Array<{
    id: string
    type: string
    entityId?: string
    entityType?: string
    urgency: number
    confidence: number
    rationale: string
  }>
}

export async function coordinateRecommendations(
  tenantId: string,
  inputs: CoordinationInput[],
): Promise<{
  unified: RankedRecommendation[]
  conflicts: Array<{ entityId: string; conflictingAgents: string[] }>
  topPriority: RankedRecommendation[]
}> {
  const allCandidates: RankInput[] = inputs.flatMap(input =>
    input.recommendations.map(r => ({
      recommendationId: r.id,
      recommendationType: r.type,
      agentType: input.agentType,
      entityId: r.entityId,
      entityType: r.entityType,
      urgency: r.urgency,
      confidence: r.confidence,
      rationale: r.rationale,
    })),
  )

  const unified = await rankRecommendations(tenantId, allCandidates)

  // Detect conflicts: same entity targeted by multiple agents with different actions
  const byEntity: Record<string, { agents: string[]; actions: string[] }> = {}
  for (const r of unified) {
    const key = r.entityId ?? 'global'
    if (byEntity[key] == null) byEntity[key] = { agents: [], actions: [] }
    byEntity[key]!.agents.push(r.agentType)
    byEntity[key]!.actions.push(r.recommendationType)
  }

  const conflicts = Object.entries(byEntity)
    .filter(([, v]) => new Set(v.actions).size > 1)
    .map(([entityId, v]) => ({ entityId, conflictingAgents: [...new Set(v.agents)] }))

  return {
    unified,
    conflicts,
    topPriority: unified.slice(0, 5),
  }
}

// ─── Get optimization summary ─────────────────────────────────────────────────

export interface OptimizationSummary {
  tenantId: string
  proposedCount: number
  approvedCount: number
  appliedCount: number
  avgExpectedGain: number
  avgActualGain: number
  gainAccuracy: number     // how close expected vs actual (0–1)
  generatedAt: Date
}

export async function getOptimizationSummary(
  tenantId: string,
): Promise<OptimizationSummary> {
  const res = await tenantQuery(
    tenantId,
    `SELECT
       COUNT(CASE WHEN status = 'proposed' THEN 1 END)::int AS proposed,
       COUNT(CASE WHEN status = 'approved' THEN 1 END)::int AS approved,
       COUNT(CASE WHEN status = 'applied' THEN 1 END)::int AS applied,
       COALESCE(AVG(expected_gain), 0)::float AS avg_expected,
       COALESCE(AVG(actual_gain) FILTER (WHERE actual_gain IS NOT NULL), 0)::float AS avg_actual
     FROM optimization_feedback
     WHERE tenant_id = $1`,
    [tenantId],
  )

  const row = res.rows[0]
  const avgExpected = Number(row?.avg_expected ?? 0)
  const avgActual = Number(row?.avg_actual ?? 0)
  const gainAccuracy = avgExpected > 0
    ? Math.max(0, 1 - Math.abs(avgExpected - avgActual) / avgExpected)
    : 1

  return {
    tenantId,
    proposedCount: Number(row?.proposed ?? 0),
    approvedCount: Number(row?.approved ?? 0),
    appliedCount: Number(row?.applied ?? 0),
    avgExpectedGain: avgExpected,
    avgActualGain: avgActual,
    gainAccuracy: Math.round(gainAccuracy * 100) / 100,
    generatedAt: new Date(),
  }
}

export const __testHooks = { buildConsensus }
