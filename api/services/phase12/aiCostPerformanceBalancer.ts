// Denver Engineering — AI Cost Performance Balancer (Phase 12)
// Analyzes AI model usage and recommends routing for cost/quality balance

import { pool } from '../../db/pool'
import { AiCostBalance } from './phase12Types'

// ─── Mapper ──────────────────────────────────────────────────────────────────

function _mapAiCostBalance(row: Record<string, unknown>): AiCostBalance {
  return {
    id: row.id as string,
    modelId: row.model_id as string,
    costPer1kTokens: Number(row.cost_per_1k_tokens),
    acceptanceRate: Number(row.acceptance_rate),
    qualityScore: Number(row.quality_score),
    efficiencyScore: Number(row.efficiency_score),
    recommendedAction: row.recommended_action as AiCostBalance['recommendedAction'],
    computedAt: new Date(row.computed_at as string),
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function computeAiEfficiencyScore(
  acceptanceRate: number,
  qualityScore: number,
  costPer1kTokens: number,
): number {
  const qualityWeight = (acceptanceRate * 40) + (qualityScore * 0.40)
  const costPenalty = Math.min(costPer1kTokens * 1000, 40)
  return Math.max(0, Math.round(qualityWeight - costPenalty))
}

export function recommendAiRouting(
  acceptanceRate: number,
  qualityScore: number,
  costPer1kTokens: number,
): AiCostBalance['recommendedAction'] {
  if (acceptanceRate >= 0.85 && costPer1kTokens > 0.01) return 'downgrade'
  if (acceptanceRate < 0.40) return 'upgrade'
  if (acceptanceRate >= 0.70 && acceptanceRate < 0.85 && costPer1kTokens > 0.008) return 'route_split'
  return 'keep'
}

export function isModelCostEfficient(balance: AiCostBalance): boolean {
  return balance.efficiencyScore >= 60 && balance.recommendedAction === 'keep'
}

// ─── Service ─────────────────────────────────────────────────────────────────

export async function analyzeAiModelBalance(
  modelId: string,
  costPer1kTokens: number,
  acceptanceRate: number,
  qualityScore: number,
): Promise<AiCostBalance> {
  const efficiencyScore = computeAiEfficiencyScore(acceptanceRate, qualityScore, costPer1kTokens)
  const recommendedAction = recommendAiRouting(acceptanceRate, qualityScore, costPer1kTokens)

  const result = await pool.query(
    `INSERT INTO p12_ai_cost_balance
       (model_id, cost_per_1k_tokens, acceptance_rate, quality_score, efficiency_score, recommended_action, computed_at)
     VALUES ($1,$2,$3,$4,$5,$6,NOW())
     RETURNING *`,
    [modelId, costPer1kTokens, acceptanceRate, qualityScore, efficiencyScore, recommendedAction],
  )
  return _mapAiCostBalance(result.rows[0])
}

export async function getLatestAiBalance(modelId: string): Promise<AiCostBalance | null> {
  const result = await pool.query(
    `SELECT * FROM p12_ai_cost_balance
     WHERE model_id = $1
     ORDER BY computed_at DESC
     LIMIT 1`,
    [modelId],
  )
  return result.rows[0] ? _mapAiCostBalance(result.rows[0]) : null
}

export async function getModelsNeedingAction(): Promise<AiCostBalance[]> {
  const result = await pool.query(
    `SELECT DISTINCT ON (model_id) *
     FROM p12_ai_cost_balance
     WHERE recommended_action != 'keep'
     ORDER BY model_id, computed_at DESC`,
  )
  return result.rows.map(_mapAiCostBalance)
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  computeAiEfficiencyScore,
  recommendAiRouting,
  isModelCostEfficient,
  _mapAiCostBalance,
}
