// Denver Engineering — AI Efficiency Optimizer (Phase 11)
// Optimize AI provider routing and cost efficiency across tenants

import { pool } from '../../db/pool'

// ─── AI Usage Record ──────────────────────────────────────────────────────────

export interface AiUsageRecord {
  id: string
  tenantId: string | null
  modelId: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  costUsd: number
  latencyMs: number
  accepted: boolean
  featureTag: string | null
  recordedAt: Date
  createdAt: Date
}

export interface AiRoutingRecommendation {
  featureTag: string
  currentModelId: string
  recommendedModelId: string
  estimatedCostSavingPct: number
  estimatedLatencyChangePct: number
  acceptanceRatePct: number
  rationale: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _mapAiUsageRecord(row: Record<string, unknown>): AiUsageRecord {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string | null,
    modelId: row.model_id as string,
    promptTokens: Number(row.prompt_tokens),
    completionTokens: Number(row.completion_tokens),
    totalTokens: Number(row.total_tokens),
    costUsd: Number(row.cost_usd),
    latencyMs: Number(row.latency_ms),
    accepted: Boolean(row.accepted),
    featureTag: row.feature_tag as string | null,
    recordedAt: new Date(row.recorded_at as string),
    createdAt: new Date(row.created_at as string),
  }
}

// ─── Record AI Usage ──────────────────────────────────────────────────────────

export async function recordAiUsage(
  tenantId: string | null,
  modelId: string,
  promptTokens: number,
  completionTokens: number,
  costUsd: number,
  latencyMs: number,
  accepted: boolean,
  featureTag: string | null = null
): Promise<AiUsageRecord> {
  const totalTokens = promptTokens + completionTokens
  const result = await pool.query(
    `INSERT INTO ai_usage_records
       (tenant_id, model_id, prompt_tokens, completion_tokens, total_tokens,
        cost_usd, latency_ms, accepted, feature_tag, recorded_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
     RETURNING *`,
    [tenantId, modelId, promptTokens, completionTokens, totalTokens, costUsd, latencyMs, accepted, featureTag]
  )
  return _mapAiUsageRecord(result.rows[0])
}

// ─── Get AI Usage Stats ───────────────────────────────────────────────────────

export async function getAiUsageStats(
  modelId: string,
  featureTag: string | null,
  since: Date
): Promise<{
  totalCostUsd: number
  avgLatencyMs: number
  acceptanceRate: number
  totalTokens: number
  callCount: number
}> {
  const result = await pool.query(
    `SELECT
       COALESCE(SUM(cost_usd), 0) as total_cost_usd,
       COALESCE(AVG(latency_ms), 0) as avg_latency_ms,
       COALESCE(AVG(accepted::int), 0) as acceptance_rate,
       COALESCE(SUM(total_tokens), 0) as total_tokens,
       COUNT(*) as call_count
     FROM ai_usage_records
     WHERE model_id = $1
       AND ($2::text IS NULL OR feature_tag = $2)
       AND recorded_at >= $3`,
    [modelId, featureTag, since]
  )
  const row = result.rows[0] ?? {}
  return {
    totalCostUsd: Number(row.total_cost_usd ?? 0),
    avgLatencyMs: Number(row.avg_latency_ms ?? 0),
    acceptanceRate: Number(row.acceptance_rate ?? 0),
    totalTokens: Number(row.total_tokens ?? 0),
    callCount: Number(row.call_count ?? 0),
  }
}

// ─── Compute Cost Per Token ───────────────────────────────────────────────────

export function computeCostPerThousandTokens(totalCostUsd: number, totalTokens: number): number {
  if (totalTokens === 0) return 0
  return (totalCostUsd / totalTokens) * 1000
}

// ─── Analyze Routing Efficiency ───────────────────────────────────────────────

export function analyzeRoutingEfficiency(
  currentModelId: string,
  currentCostPer1k: number,
  currentAcceptanceRate: number,
  featureTag: string
): AiRoutingRecommendation | null {
  // Suggest downgrade if acceptance rate is low (model may be over-powered)
  // Suggest upgrade if acceptance rate is very high (potential under-serving)

  if (currentAcceptanceRate >= 0.85 && currentCostPer1k > 0.01) {
    return {
      featureTag,
      currentModelId,
      recommendedModelId: 'gpt-4o-mini',
      estimatedCostSavingPct: 80,
      estimatedLatencyChangePct: -50,
      acceptanceRatePct: currentAcceptanceRate * 100,
      rationale: `High acceptance rate (${(currentAcceptanceRate * 100).toFixed(0)}%) suggests a smaller model may suffice at lower cost.`,
    }
  }

  if (currentAcceptanceRate < 0.5) {
    return {
      featureTag,
      currentModelId,
      recommendedModelId: 'gpt-4o',
      estimatedCostSavingPct: -40,
      estimatedLatencyChangePct: 30,
      acceptanceRatePct: currentAcceptanceRate * 100,
      rationale: `Low acceptance rate (${(currentAcceptanceRate * 100).toFixed(0)}%) suggests upgrading to a more capable model.`,
    }
  }

  return null
}

// ─── Get Model Cost Comparison ────────────────────────────────────────────────

export async function getModelCostComparison(
  since: Date
): Promise<Array<{ modelId: string; totalCostUsd: number; avgLatencyMs: number; callCount: number }>> {
  const result = await pool.query(
    `SELECT model_id, SUM(cost_usd) as total_cost_usd,
            AVG(latency_ms) as avg_latency_ms, COUNT(*) as call_count
     FROM ai_usage_records WHERE recorded_at >= $1
     GROUP BY model_id ORDER BY total_cost_usd DESC`,
    [since]
  )
  return result.rows.map((row: Record<string, unknown>) => ({
    modelId: row.model_id as string,
    totalCostUsd: Number(row.total_cost_usd),
    avgLatencyMs: Number(row.avg_latency_ms),
    callCount: Number(row.call_count),
  }))
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  _mapAiUsageRecord,
  computeCostPerThousandTokens,
  analyzeRoutingEfficiency,
}
