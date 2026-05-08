// Denver Engineering — Operational Usage Profiler (Phase 12)
// Builds per-tenant usage profiles from behavior events

import { pool } from '../../db/pool'
import { tenantQuery } from '../../db/pool'
import { UsageProfile } from './phase12Types'

// ─── Mapper ──────────────────────────────────────────────────────────────────

function _mapUsageProfile(row: Record<string, unknown>): UsageProfile {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    periodStart: new Date(row.period_start as string),
    periodEnd: new Date(row.period_end as string),
    workflowCompletionRate: Number(row.workflow_completion_rate),
    abandonmentRate: Number(row.abandonment_rate),
    recommendationOverrideRate: Number(row.recommendation_override_rate),
    aiAcceptanceRate: Number(row.ai_acceptance_rate),
    pluginAdoptionCount: Number(row.plugin_adoption_count),
    replayFrequency: Number(row.replay_frequency),
    supportEscalationRate: Number(row.support_escalation_rate),
    onboardingFrictionScore: Number(row.onboarding_friction_score),
    edgeSyncReliability: Number(row.edge_sync_reliability),
    computedAt: new Date(row.computed_at as string),
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function computeOnboardingFrictionScore(frictionEvents: number, totalSteps: number): number {
  if (totalSteps === 0) return 0
  return Math.min(frictionEvents / totalSteps, 1.0)
}

export function computeEdgeSyncReliability(successCount: number, failureCount: number): number {
  const total = successCount + failureCount
  if (total === 0) return 1.0
  return successCount / total
}

export function isProfileHealthy(profile: UsageProfile): boolean {
  return (
    profile.workflowCompletionRate >= 0.7 &&
    profile.abandonmentRate <= 0.3 &&
    profile.edgeSyncReliability >= 0.95
  )
}

export function computeProfileHealthScore(profile: UsageProfile): number {
  const completionScore = profile.workflowCompletionRate * 30
  const aiScore = profile.aiAcceptanceRate * 25
  const reliabilityScore = profile.edgeSyncReliability * 25
  const escalationScore = (1 - profile.supportEscalationRate) * 20
  return Math.round(completionScore + aiScore + reliabilityScore + escalationScore)
}

// ─── Service ─────────────────────────────────────────────────────────────────

export async function buildUsageProfile(
  tenantId: string,
  periodStart: Date,
  periodEnd: Date,
  metrics: Omit<UsageProfile, 'id' | 'tenantId' | 'periodStart' | 'periodEnd' | 'computedAt'>,
): Promise<UsageProfile> {
  const result = await pool.query(
    `INSERT INTO p12_usage_profiles
       (tenant_id, period_start, period_end, workflow_completion_rate, abandonment_rate,
        recommendation_override_rate, ai_acceptance_rate, plugin_adoption_count,
        replay_frequency, support_escalation_rate, onboarding_friction_score,
        edge_sync_reliability, computed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
     RETURNING *`,
    [
      tenantId, periodStart, periodEnd,
      metrics.workflowCompletionRate, metrics.abandonmentRate,
      metrics.recommendationOverrideRate, metrics.aiAcceptanceRate,
      metrics.pluginAdoptionCount, metrics.replayFrequency,
      metrics.supportEscalationRate, metrics.onboardingFrictionScore,
      metrics.edgeSyncReliability,
    ],
  )
  return _mapUsageProfile(result.rows[0])
}

export async function getUsageProfiles(tenantId: string, limit = 10): Promise<UsageProfile[]> {
  const result = await tenantQuery(
    tenantId,
    `SELECT * FROM p12_usage_profiles
     WHERE tenant_id = $1
     ORDER BY period_end DESC
     LIMIT $2`,
    [tenantId, limit],
  )
  return result.rows.map(_mapUsageProfile)
}

export async function getLatestUsageProfile(tenantId: string): Promise<UsageProfile | null> {
  const result = await tenantQuery(
    tenantId,
    `SELECT * FROM p12_usage_profiles
     WHERE tenant_id = $1
     ORDER BY period_end DESC
     LIMIT 1`,
    [tenantId],
  )
  return result.rows[0] ? _mapUsageProfile(result.rows[0]) : null
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  computeOnboardingFrictionScore,
  computeEdgeSyncReliability,
  isProfileHealthy,
  computeProfileHealthScore,
  _mapUsageProfile,
}
