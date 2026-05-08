// Denver Engineering — Adoption Acceleration Engine (Phase 12)
// Generates personalized adoption plans for tenants based on usage gaps

import { pool } from '../../db/pool'
import { AdoptionAccelerationPlan, AdoptionRecommendation } from './phase12Types'

// ─── Mapper ──────────────────────────────────────────────────────────────────

function _mapAdoptionPlan(row: Record<string, unknown>): AdoptionAccelerationPlan {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    currentAdoptionPct: Number(row.current_adoption_pct),
    targetAdoptionPct: Number(row.target_adoption_pct),
    recommendations: row.recommendations as AdoptionRecommendation[],
    estimatedDaysToTarget: Number(row.estimated_days_to_target),
    createdAt: new Date(row.created_at as string),
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function computeAdoptionGap(current: number, target: number): number {
  return Math.max(0, target - current)
}

export function estimateDaysToTarget(
  currentPct: number,
  targetPct: number,
  dailyGrowthRate: number,
): number {
  const gap = computeAdoptionGap(currentPct, targetPct)
  if (gap <= 0) return 0
  if (dailyGrowthRate <= 0) return 999
  return Math.ceil(gap / dailyGrowthRate)
}

export function generateAdoptionRecommendations(
  currentPct: number,
  aiAcceptanceRate: number,
  workflowCompletionRate: number,
  onboardingFriction: number,
): AdoptionRecommendation[] {
  const recs: AdoptionRecommendation[] = []

  if (onboardingFriction > 0.4) {
    recs.push({
      action: 'Reduce onboarding friction — simplify first-run experience',
      impact: 'high',
      effort: 'medium',
      rationale: `Onboarding friction score ${(onboardingFriction * 100).toFixed(0)}% exceeds 40% threshold`,
    })
  }

  if (aiAcceptanceRate < 0.5) {
    recs.push({
      action: 'Run AI suggestion training session with primary users',
      impact: 'high',
      effort: 'low',
      rationale: `AI acceptance rate ${(aiAcceptanceRate * 100).toFixed(0)}% below 50%`,
    })
  }

  if (workflowCompletionRate < 0.7) {
    recs.push({
      action: 'Identify and resolve workflow abandonment blockers',
      impact: 'high',
      effort: 'medium',
      rationale: `Workflow completion rate ${(workflowCompletionRate * 100).toFixed(0)}% below 70%`,
    })
  }

  if (currentPct < 30) {
    recs.push({
      action: 'Assign adoption champion contact at tenant',
      impact: 'medium',
      effort: 'low',
      rationale: 'Overall adoption below 30% — champion-driven adoption improves velocity 2×',
    })
  }

  return recs
}

// ─── Service ─────────────────────────────────────────────────────────────────

export async function createAdoptionPlan(
  tenantId: string,
  currentAdoptionPct: number,
  targetAdoptionPct: number,
  recommendations: AdoptionRecommendation[],
  estimatedDaysToTarget: number,
): Promise<AdoptionAccelerationPlan> {
  const result = await pool.query(
    `INSERT INTO p12_adoption_plans
       (tenant_id, current_adoption_pct, target_adoption_pct, recommendations, estimated_days_to_target)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING *`,
    [tenantId, currentAdoptionPct, targetAdoptionPct, JSON.stringify(recommendations), estimatedDaysToTarget],
  )
  return _mapAdoptionPlan(result.rows[0])
}

export async function getLatestAdoptionPlan(tenantId: string): Promise<AdoptionAccelerationPlan | null> {
  const result = await pool.query(
    `SELECT * FROM p12_adoption_plans
     WHERE tenant_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [tenantId],
  )
  return result.rows[0] ? _mapAdoptionPlan(result.rows[0]) : null
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  computeAdoptionGap,
  estimateDaysToTarget,
  generateAdoptionRecommendations,
  _mapAdoptionPlan,
}
