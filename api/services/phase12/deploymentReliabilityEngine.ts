// Denver Engineering — Deployment Reliability Engine (Phase 12)
// Computes deployment confidence scores and manages deployment reliability

import { pool } from '../../db/pool'
import { DeploymentConfidenceScore, DEPLOYMENT_CONFIDENCE_THRESHOLD } from './phase12Types'

// ─── Mapper ──────────────────────────────────────────────────────────────────

function _mapConfidenceScore(row: Record<string, unknown>): DeploymentConfidenceScore {
  return {
    id: row.id as string,
    deploymentId: row.deployment_id as string,
    canaryHealthScore: Number(row.canary_health_score),
    migrationSafetyScore: Number(row.migration_safety_score),
    rollbackReadinessScore: Number(row.rollback_readiness_score),
    replayVerificationScore: Number(row.replay_verification_score),
    overallConfidence: Number(row.overall_confidence),
    recommendation: row.recommendation as DeploymentConfidenceScore['recommendation'],
    computedAt: new Date(row.computed_at as string),
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function computeDeploymentConfidence(
  canaryHealth: number,
  migrationSafety: number,
  rollbackReadiness: number,
  replayVerification: number,
): number {
  return Math.round(
    canaryHealth * 0.30 +
    migrationSafety * 0.25 +
    rollbackReadiness * 0.20 +
    replayVerification * 0.25,
  )
}

export function recommendDeploymentAction(
  overallConfidence: number,
  rollbackReadiness: number,
  replayVerification: number,
): DeploymentConfidenceScore['recommendation'] {
  if (replayVerification < 70 || rollbackReadiness < 50) return 'abort'
  if (overallConfidence >= DEPLOYMENT_CONFIDENCE_THRESHOLD) return 'proceed'
  return 'pause'
}

export function isDeploymentSafe(score: DeploymentConfidenceScore): boolean {
  return score.recommendation === 'proceed' && score.replayVerificationScore >= 80
}

// ─── Service ─────────────────────────────────────────────────────────────────

export async function computeAndStoreConfidence(
  deploymentId: string,
  canaryHealthScore: number,
  migrationSafetyScore: number,
  rollbackReadinessScore: number,
  replayVerificationScore: number,
): Promise<DeploymentConfidenceScore> {
  const overallConfidence = computeDeploymentConfidence(
    canaryHealthScore, migrationSafetyScore, rollbackReadinessScore, replayVerificationScore,
  )
  const recommendation = recommendDeploymentAction(overallConfidence, rollbackReadinessScore, replayVerificationScore)

  const result = await pool.query(
    `INSERT INTO p12_deployment_confidence
       (deployment_id, canary_health_score, migration_safety_score, rollback_readiness_score,
        replay_verification_score, overall_confidence, recommendation, computed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
     RETURNING *`,
    [deploymentId, canaryHealthScore, migrationSafetyScore, rollbackReadinessScore, replayVerificationScore, overallConfidence, recommendation],
  )
  return _mapConfidenceScore(result.rows[0])
}

export async function getDeploymentConfidence(deploymentId: string): Promise<DeploymentConfidenceScore | null> {
  const result = await pool.query(
    `SELECT * FROM p12_deployment_confidence
     WHERE deployment_id = $1
     ORDER BY computed_at DESC
     LIMIT 1`,
    [deploymentId],
  )
  return result.rows[0] ? _mapConfidenceScore(result.rows[0]) : null
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  computeDeploymentConfidence,
  recommendDeploymentAction,
  isDeploymentSafe,
  _mapConfidenceScore,
}
