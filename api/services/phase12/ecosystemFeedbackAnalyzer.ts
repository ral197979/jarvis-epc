// Denver Engineering — Ecosystem Feedback Analyzer (Phase 12)
// Analyzes and summarizes feedback from across the ecosystem

import { pool } from '../../db/pool'
import { EcosystemFeedbackSummary } from './phase12Types'

// ─── Mapper ──────────────────────────────────────────────────────────────────

function _mapFeedbackSummary(row: Record<string, unknown>): EcosystemFeedbackSummary {
  return {
    id: row.id as string,
    periodStart: new Date(row.period_start as string),
    periodEnd: new Date(row.period_end as string),
    totalFeedback: Number(row.total_feedback),
    positiveCount: Number(row.positive_count),
    neutralCount: Number(row.neutral_count),
    negativeCount: Number(row.negative_count),
    topFrictionAreas: row.top_friction_areas as string[],
    topImprovementOpportunities: row.top_improvement_opportunities as string[],
    trustSignalScore: Number(row.trust_signal_score),
    generatedAt: new Date(row.generated_at as string),
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function computeTrustSignalScore(
  positiveCount: number,
  neutralCount: number,
  negativeCount: number,
): number {
  const total = positiveCount + neutralCount + negativeCount
  if (total === 0) return 0.5
  const positiveWeight = positiveCount * 1.0
  const neutralWeight = neutralCount * 0.5
  return Math.min(1.0, (positiveWeight + neutralWeight) / total)
}

export function computeNPS(positive: number, negative: number, total: number): number {
  if (total === 0) return 0
  return Math.round(((positive - negative) / total) * 100)
}

export function identifyTopFrictionAreas(
  categoryFrequency: Record<string, number>,
  topN = 3,
): string[] {
  return Object.entries(categoryFrequency)
    .sort(([, a], [, b]) => b - a)
    .slice(0, topN)
    .map(([category]) => category)
}

export function isFeedbackHealthy(summary: EcosystemFeedbackSummary): boolean {
  return summary.trustSignalScore >= 0.65
}

// ─── Service ─────────────────────────────────────────────────────────────────

export async function generateFeedbackSummary(
  periodStart: Date,
  periodEnd: Date,
  positiveCount: number,
  neutralCount: number,
  negativeCount: number,
  topFrictionAreas: string[],
  topImprovementOpportunities: string[],
): Promise<EcosystemFeedbackSummary> {
  const totalFeedback = positiveCount + neutralCount + negativeCount
  const trustSignalScore = computeTrustSignalScore(positiveCount, neutralCount, negativeCount)

  const result = await pool.query(
    `INSERT INTO p12_ecosystem_feedback_summaries
       (period_start, period_end, total_feedback, positive_count, neutral_count, negative_count,
        top_friction_areas, top_improvement_opportunities, trust_signal_score, generated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
     RETURNING *`,
    [periodStart, periodEnd, totalFeedback, positiveCount, neutralCount, negativeCount,
     JSON.stringify(topFrictionAreas), JSON.stringify(topImprovementOpportunities), trustSignalScore],
  )
  return _mapFeedbackSummary(result.rows[0])
}

export async function getLatestFeedbackSummary(): Promise<EcosystemFeedbackSummary | null> {
  const result = await pool.query(
    `SELECT * FROM p12_ecosystem_feedback_summaries
     ORDER BY generated_at DESC
     LIMIT 1`,
  )
  return result.rows[0] ? _mapFeedbackSummary(result.rows[0]) : null
}

export async function getFeedbackSummaryHistory(limit = 12): Promise<EcosystemFeedbackSummary[]> {
  const result = await pool.query(
    `SELECT * FROM p12_ecosystem_feedback_summaries
     ORDER BY generated_at DESC
     LIMIT $1`,
    [limit],
  )
  return result.rows.map(_mapFeedbackSummary)
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  computeTrustSignalScore,
  computeNPS,
  identifyTopFrictionAreas,
  isFeedbackHealthy,
  _mapFeedbackSummary,
}
