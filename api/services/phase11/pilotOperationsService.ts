// Denver Engineering — Pilot Operations Service (Phase 11)
// Manage pilot tenant lifecycle, health scoring, and churn risk tracking

import { pool, tenantQuery } from '../../db/pool'
import {
  PilotTenant,
  PilotStatus,
  PILOT_HEALTH_SCORE_THRESHOLD,
  CHURN_RISK_THRESHOLD,
} from './phase11Types'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _mapPilotTenant(row: Record<string, unknown>): PilotTenant {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    tenantName: row.tenant_name as string,
    status: row.status as PilotStatus,
    healthScore: Number(row.health_score),
    onboardingCompletePct: Number(row.onboarding_complete_pct),
    trainingCompletePct: Number(row.training_complete_pct),
    adoptionScore: Number(row.adoption_score),
    openIncidents: Number(row.open_incidents),
    activatedAt: row.activated_at ? new Date(row.activated_at as string) : null,
    convertedAt: row.converted_at ? new Date(row.converted_at as string) : null,
    churnRisk: row.churn_risk as 'low' | 'medium' | 'high',
    csm: row.csm as string | null,
    createdAt: new Date(row.created_at as string),
  }
}

// ─── Create Pilot Tenant ──────────────────────────────────────────────────────

export async function createPilotTenant(
  tenantId: string,
  tenantName: string,
  csm: string | null = null
): Promise<PilotTenant> {
  const result = await pool.query(
    `INSERT INTO pilot_tenants
       (tenant_id, tenant_name, status, health_score, onboarding_complete_pct,
        training_complete_pct, adoption_score, open_incidents,
        activated_at, converted_at, churn_risk, csm, created_at)
     VALUES ($1, $2, 'invited', 0, 0, 0, 0, 0, NULL, NULL, 'low', $3, NOW())
     RETURNING *`,
    [tenantId, tenantName, csm]
  )
  return _mapPilotTenant(result.rows[0])
}

// ─── Get Pilot Tenant ─────────────────────────────────────────────────────────

export async function getPilotTenant(pilotId: string): Promise<PilotTenant | null> {
  const result = await pool.query(
    `SELECT * FROM pilot_tenants WHERE id = $1`,
    [pilotId]
  )
  return result.rows.length > 0 ? _mapPilotTenant(result.rows[0]) : null
}

export async function getPilotTenantByTenantId(tenantId: string): Promise<PilotTenant | null> {
  const result = await pool.query(
    `SELECT * FROM pilot_tenants WHERE tenant_id = $1`,
    [tenantId]
  )
  return result.rows.length > 0 ? _mapPilotTenant(result.rows[0]) : null
}

// ─── Update Pilot Status ──────────────────────────────────────────────────────

export async function updatePilotStatus(
  pilotId: string,
  status: PilotStatus
): Promise<PilotTenant> {
  const extraFields: string[] = []
  const params: unknown[] = [status, pilotId]

  if (status === 'active') {
    extraFields.push('activated_at = NOW()')
  }
  if (status === 'converted') {
    extraFields.push('converted_at = NOW()')
  }

  const setClause = ['status = $1', ...extraFields].join(', ')
  const result = await pool.query(
    `UPDATE pilot_tenants SET ${setClause} WHERE id = $2 RETURNING *`,
    params
  )
  return _mapPilotTenant(result.rows[0])
}

// ─── Update Pilot Health Score ────────────────────────────────────────────────

export async function updatePilotHealthScore(
  pilotId: string,
  onboardingCompletePct: number,
  trainingCompletePct: number,
  adoptionScore: number,
  openIncidents: number
): Promise<PilotTenant> {
  const healthScore = computeHealthScore(
    onboardingCompletePct, trainingCompletePct, adoptionScore, openIncidents
  )
  const churnRisk = computeChurnRisk(adoptionScore, healthScore)

  const result = await pool.query(
    `UPDATE pilot_tenants
     SET health_score = $1, onboarding_complete_pct = $2, training_complete_pct = $3,
         adoption_score = $4, open_incidents = $5, churn_risk = $6
     WHERE id = $7
     RETURNING *`,
    [healthScore, onboardingCompletePct, trainingCompletePct, adoptionScore, openIncidents, churnRisk, pilotId]
  )
  return _mapPilotTenant(result.rows[0])
}

// ─── Compute Health Score ─────────────────────────────────────────────────────

export function computeHealthScore(
  onboardingCompletePct: number,
  trainingCompletePct: number,
  adoptionScore: number,
  openIncidents: number
): number {
  // Weights: onboarding=30%, training=20%, adoption=40%, incident penalty=10%
  const onboardingScore = (onboardingCompletePct / 100) * 30
  const trainingScore = (trainingCompletePct / 100) * 20
  const adoptionComponent = (adoptionScore / 100) * 40
  const incidentPenalty = Math.min(openIncidents * 2, 10)

  return Math.max(0, Math.round(onboardingScore + trainingScore + adoptionComponent - incidentPenalty))
}

// ─── Compute Churn Risk ───────────────────────────────────────────────────────

export function computeChurnRisk(
  adoptionScore: number,
  healthScore: number
): 'low' | 'medium' | 'high' {
  if (adoptionScore < CHURN_RISK_THRESHOLD * 100 || healthScore < PILOT_HEALTH_SCORE_THRESHOLD) {
    if (healthScore < 40 || adoptionScore < 20) return 'high'
    return 'medium'
  }
  return 'low'
}

// ─── Is At Risk ───────────────────────────────────────────────────────────────

export function isPilotAtRisk(pilot: PilotTenant): boolean {
  return pilot.healthScore < PILOT_HEALTH_SCORE_THRESHOLD || pilot.churnRisk === 'high'
}

// ─── List Pilot Tenants ───────────────────────────────────────────────────────

export async function listPilotTenants(status?: PilotStatus): Promise<PilotTenant[]> {
  if (status) {
    const result = await pool.query(
      `SELECT * FROM pilot_tenants WHERE status = $1 ORDER BY created_at ASC`,
      [status]
    )
    return result.rows.map(_mapPilotTenant)
  }

  const result = await pool.query(
    `SELECT * FROM pilot_tenants ORDER BY created_at ASC`
  )
  return result.rows.map(_mapPilotTenant)
}

// ─── List At-Risk Pilots ──────────────────────────────────────────────────────

export async function listAtRiskPilots(): Promise<PilotTenant[]> {
  const result = await pool.query(
    `SELECT * FROM pilot_tenants
     WHERE health_score < $1 OR churn_risk = 'high'
     ORDER BY health_score ASC`,
    [PILOT_HEALTH_SCORE_THRESHOLD]
  )
  return result.rows.map(_mapPilotTenant)
}

// ─── Get Pilot Telemetry ──────────────────────────────────────────────────────

export async function getPilotAdoptionMetrics(tenantId: string): Promise<{
  featureAdoption: number
  workflowCompletion: number
  aiAcceptance: number
}> {
  const rows = await tenantQuery(
    tenantId,
    `SELECT metric_type, AVG(value) as avg_value
     FROM telemetry_events
     WHERE metric_type IN ('feature_adoption', 'workflow_completion', 'ai_acceptance')
       AND recorded_at >= NOW() - INTERVAL '7 days'
     GROUP BY metric_type`,
    []
  )

  const metrics: Record<string, number> = {}
  for (const row of rows as Record<string, unknown>[]) {
    metrics[row.metric_type as string] = Number(row.avg_value)
  }

  return {
    featureAdoption: metrics['feature_adoption'] ?? 0,
    workflowCompletion: metrics['workflow_completion'] ?? 0,
    aiAcceptance: metrics['ai_acceptance'] ?? 0,
  }
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  _mapPilotTenant,
  computeHealthScore,
  computeChurnRisk,
  isPilotAtRisk,
}
