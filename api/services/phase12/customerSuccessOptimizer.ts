// Denver Engineering — Customer Success Optimizer (Phase 12)
// Computes composite customer success scores and churn risk indicators

import { pool } from '../../db/pool'
import { tenantQuery } from '../../db/pool'
import { CustomerSuccessScore, MaturityLevel, CHURN_RISK_SCORE_THRESHOLD } from './phase12Types'

// ─── Mapper ──────────────────────────────────────────────────────────────────

function _mapSuccessScore(row: Record<string, unknown>): CustomerSuccessScore {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    onboardingScore: Number(row.onboarding_score),
    adoptionScore: Number(row.adoption_score),
    maturityScore: Number(row.maturity_score),
    supportHealthScore: Number(row.support_health_score),
    aiUsageScore: Number(row.ai_usage_score),
    overallScore: Number(row.overall_score),
    churnRiskScore: Number(row.churn_risk_score),
    maturityLevel: row.maturity_level as MaturityLevel,
    computedAt: new Date(row.computed_at as string),
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function computeOverallSuccessScore(
  onboarding: number,
  adoption: number,
  maturity: number,
  supportHealth: number,
  aiUsage: number,
): number {
  return Math.round(
    onboarding * 0.20 +
    adoption * 0.30 +
    maturity * 0.25 +
    supportHealth * 0.15 +
    aiUsage * 0.10,
  )
}

export function computeChurnRiskScore(
  overallScore: number,
  adoptionScore: number,
  supportHealthScore: number,
): number {
  const baseRisk = 1 - (overallScore / 100)
  const adoptionRisk = adoptionScore < 40 ? 0.2 : 0
  const supportRisk = supportHealthScore < 50 ? 0.15 : 0
  return Math.min(1.0, baseRisk + adoptionRisk + supportRisk)
}

export function classifyMaturityLevel(maturityScore: number): MaturityLevel {
  if (maturityScore >= 90) return 'optimized'
  if (maturityScore >= 75) return 'advanced'
  if (maturityScore >= 60) return 'proficient'
  if (maturityScore >= 40) return 'developing'
  return 'starter'
}

export function isAtChurnRisk(churnRiskScore: number): boolean {
  return churnRiskScore >= CHURN_RISK_SCORE_THRESHOLD
}

// ─── Service ─────────────────────────────────────────────────────────────────

export async function computeAndStoreSuccessScore(
  tenantId: string,
  onboardingScore: number,
  adoptionScore: number,
  maturityScore: number,
  supportHealthScore: number,
  aiUsageScore: number,
): Promise<CustomerSuccessScore> {
  const overallScore = computeOverallSuccessScore(onboardingScore, adoptionScore, maturityScore, supportHealthScore, aiUsageScore)
  const churnRiskScore = computeChurnRiskScore(overallScore, adoptionScore, supportHealthScore)
  const maturityLevel = classifyMaturityLevel(maturityScore)

  const result = await pool.query(
    `INSERT INTO p12_customer_success_scores
       (tenant_id, onboarding_score, adoption_score, maturity_score, support_health_score,
        ai_usage_score, overall_score, churn_risk_score, maturity_level, computed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
     RETURNING *`,
    [tenantId, onboardingScore, adoptionScore, maturityScore, supportHealthScore, aiUsageScore, overallScore, churnRiskScore, maturityLevel],
  )
  return _mapSuccessScore(result.rows[0])
}

export async function getLatestSuccessScore(tenantId: string): Promise<CustomerSuccessScore | null> {
  const result = await tenantQuery(
    tenantId,
    `SELECT * FROM p12_customer_success_scores
     WHERE tenant_id = $1
     ORDER BY computed_at DESC
     LIMIT 1`,
    [tenantId],
  )
  return result.rows[0] ? _mapSuccessScore(result.rows[0]) : null
}

export async function getTenantsAtChurnRisk(): Promise<CustomerSuccessScore[]> {
  const result = await pool.query(
    `SELECT DISTINCT ON (tenant_id) *
     FROM p12_customer_success_scores
     WHERE churn_risk_score >= $1
     ORDER BY tenant_id, computed_at DESC`,
    [CHURN_RISK_SCORE_THRESHOLD],
  )
  return result.rows.map(_mapSuccessScore)
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  computeOverallSuccessScore,
  computeChurnRiskScore,
  classifyMaturityLevel,
  isAtChurnRisk,
  _mapSuccessScore,
}
