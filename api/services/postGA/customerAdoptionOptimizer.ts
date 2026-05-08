// Denver Engineering — Customer Adoption Optimizer (Post-GA)
// Tracks and improves real-world customer adoption and churn signals

import { pool } from '../../db/pool'
import { tenantQuery } from '../../db/pool'
import {
  CustomerAdoptionRecord,
  AdoptionTier,
  InterventionType,
  ADOPTION_TARGET_MATURITY,
} from './postGATypes'

// ─── Mapper ──────────────────────────────────────────────────────────────────

function _mapAdoptionRecord(row: Record<string, unknown>): CustomerAdoptionRecord {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    adoptionScore: Number(row.adoption_score),
    adoptionTier: row.adoption_tier as AdoptionTier,
    churnRisk: Number(row.churn_risk),
    dailyActiveRate: Number(row.daily_active_rate),
    workflowCompletionRate: Number(row.workflow_completion_rate),
    aiAcceptanceRate: Number(row.ai_acceptance_rate),
    recommendedInterventions: row.recommended_interventions as InterventionType[],
    maturityLevel: row.maturity_level as string,
    assessedAt: new Date(row.assessed_at as string),
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function computeAdoptionScore(
  dailyActiveRate: number,
  workflowCompletionRate: number,
  aiAcceptanceRate: number,
): number {
  return Math.round(
    dailyActiveRate * 100 * 0.40 +
    workflowCompletionRate * 100 * 0.35 +
    aiAcceptanceRate * 100 * 0.25,
  )
}

export function classifyAdoptionTier(adoptionScore: number): AdoptionTier {
  if (adoptionScore >= 85) return 'champion'
  if (adoptionScore >= 70) return 'power'
  if (adoptionScore >= 50) return 'active'
  if (adoptionScore >= 25) return 'activating'
  return 'new'
}

export function computeChurnRisk(
  adoptionScore: number,
  dailyActiveRate: number,
  workflowCompletionRate: number,
): number {
  let risk = (1 - adoptionScore / 100) * 0.60
  if (dailyActiveRate < 0.30) risk += 0.20
  if (workflowCompletionRate < 0.50) risk += 0.20
  return Math.min(1.0, risk)
}

export function generateInterventions(
  adoptionScore: number,
  dailyActiveRate: number,
  workflowCompletionRate: number,
  aiAcceptanceRate: number,
  churnRisk: number,
): InterventionType[] {
  const interventions: InterventionType[] = []
  if (churnRisk >= 0.35) interventions.push('churn_recovery')
  if (adoptionScore < 25) interventions.push('onboarding_assist')
  if (aiAcceptanceRate < 0.50) interventions.push('feature_enablement')
  if (workflowCompletionRate < 0.60) interventions.push('adoption_coaching')
  return interventions
}

export function isAdoptionHealthy(record: CustomerAdoptionRecord): boolean {
  return record.adoptionScore >= ADOPTION_TARGET_MATURITY && record.churnRisk < 0.35
}

// ─── Service ─────────────────────────────────────────────────────────────────

export async function assessTenantAdoption(
  tenantId: string,
  dailyActiveRate: number,
  workflowCompletionRate: number,
  aiAcceptanceRate: number,
  maturityLevel: string,
): Promise<CustomerAdoptionRecord> {
  const adoptionScore = computeAdoptionScore(dailyActiveRate, workflowCompletionRate, aiAcceptanceRate)
  const adoptionTier = classifyAdoptionTier(adoptionScore)
  const churnRisk = computeChurnRisk(adoptionScore, dailyActiveRate, workflowCompletionRate)
  const recommendedInterventions = generateInterventions(
    adoptionScore, dailyActiveRate, workflowCompletionRate, aiAcceptanceRate, churnRisk,
  )

  const result = await pool.query(
    `INSERT INTO pga_customer_adoption
       (tenant_id, adoption_score, adoption_tier, churn_risk, daily_active_rate,
        workflow_completion_rate, ai_acceptance_rate, recommended_interventions, maturity_level, assessed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
     RETURNING *`,
    [tenantId, adoptionScore, adoptionTier, churnRisk, dailyActiveRate,
     workflowCompletionRate, aiAcceptanceRate, JSON.stringify(recommendedInterventions), maturityLevel],
  )
  return _mapAdoptionRecord(result.rows[0])
}

export async function getTenantAdoption(tenantId: string): Promise<CustomerAdoptionRecord | null> {
  const result = await tenantQuery(
    tenantId,
    `SELECT * FROM pga_customer_adoption WHERE tenant_id=$1 ORDER BY assessed_at DESC LIMIT 1`,
    [tenantId],
  )
  return result.rows[0] ? _mapAdoptionRecord(result.rows[0]) : null
}

export async function getAtRiskTenants(churnThreshold = 0.35): Promise<CustomerAdoptionRecord[]> {
  const result = await pool.query(
    `SELECT DISTINCT ON (tenant_id) *
     FROM pga_customer_adoption
     WHERE churn_risk >= $1
     ORDER BY tenant_id, assessed_at DESC`,
    [churnThreshold],
  )
  return result.rows.map(_mapAdoptionRecord)
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  computeAdoptionScore,
  classifyAdoptionTier,
  computeChurnRisk,
  generateInterventions,
  isAdoptionHealthy,
  _mapAdoptionRecord,
}
