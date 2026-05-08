// Denver Engineering — Governance Impact Estimator (Phase 12)
// Estimates governance risk of proposed architectural changes

import { pool } from '../../db/pool'
import { GovernanceImpactEstimate } from './phase12Types'

// ─── Mapper ──────────────────────────────────────────────────────────────────

function _mapImpactEstimate(row: Record<string, unknown>): GovernanceImpactEstimate {
  return {
    id: row.id as string,
    changeDescription: row.change_description as string,
    replayImpact: row.replay_impact as GovernanceImpactEstimate['replayImpact'],
    governanceRisk: row.governance_risk as GovernanceImpactEstimate['governanceRisk'],
    tenantImpact: row.tenant_impact as GovernanceImpactEstimate['tenantImpact'],
    overallRisk: row.overall_risk as GovernanceImpactEstimate['overallRisk'],
    approved: row.approved as boolean,
    estimatedAt: new Date(row.estimated_at as string),
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

type RiskLevel = 'none' | 'low' | 'medium' | 'high'
const RISK_RANK: Record<RiskLevel, number> = { none: 0, low: 1, medium: 2, high: 3 }

export function computeOverallRisk(
  replayImpact: RiskLevel,
  governanceRisk: RiskLevel,
  tenantImpact: RiskLevel,
): RiskLevel {
  const max = Math.max(RISK_RANK[replayImpact], RISK_RANK[governanceRisk], RISK_RANK[tenantImpact])
  return (Object.entries(RISK_RANK).find(([, v]) => v === max)?.[0] ?? 'none') as RiskLevel
}

export function requiresApproval(overallRisk: RiskLevel): boolean {
  return overallRisk === 'medium' || overallRisk === 'high'
}

export function isChangeBlocked(estimate: GovernanceImpactEstimate): boolean {
  return estimate.overallRisk === 'high' && !estimate.approved
}

// ─── Service ─────────────────────────────────────────────────────────────────

export async function estimateGovernanceImpact(
  changeDescription: string,
  replayImpact: RiskLevel,
  governanceRisk: RiskLevel,
  tenantImpact: RiskLevel,
): Promise<GovernanceImpactEstimate> {
  const overallRisk = computeOverallRisk(replayImpact, governanceRisk, tenantImpact)
  const approved = !requiresApproval(overallRisk)

  const result = await pool.query(
    `INSERT INTO p12_governance_impact_estimates
       (change_description, replay_impact, governance_risk, tenant_impact, overall_risk, approved, estimated_at)
     VALUES ($1,$2,$3,$4,$5,$6,NOW())
     RETURNING *`,
    [changeDescription, replayImpact, governanceRisk, tenantImpact, overallRisk, approved],
  )
  return _mapImpactEstimate(result.rows[0])
}

export async function approveImpactEstimate(estimateId: string): Promise<GovernanceImpactEstimate> {
  const result = await pool.query(
    `UPDATE p12_governance_impact_estimates
     SET approved = TRUE
     WHERE id = $1
     RETURNING *`,
    [estimateId],
  )
  if (!result.rows[0]) throw new Error(`GovernanceImpactEstimate ${estimateId} not found`)
  return _mapImpactEstimate(result.rows[0])
}

export async function getBlockedChanges(): Promise<GovernanceImpactEstimate[]> {
  const result = await pool.query(
    `SELECT * FROM p12_governance_impact_estimates
     WHERE overall_risk = 'high' AND approved = FALSE
     ORDER BY estimated_at DESC`,
  )
  return result.rows.map(_mapImpactEstimate)
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  computeOverallRisk,
  requiresApproval,
  isChangeBlocked,
  _mapImpactEstimate,
}
