// Denver Engineering — Resilience Optimization Engine (Phase 12)
// Scores and tracks operational resilience across platform components

import { pool } from '../../db/pool'
import { ResilienceScore, RESILIENCE_SCORE_THRESHOLD } from './phase12Types'

// ─── Mapper ──────────────────────────────────────────────────────────────────

function _mapResilienceScore(row: Record<string, unknown>): ResilienceScore {
  return {
    id: row.id as string,
    environment: row.environment as string,
    workerRecoveryScore: Number(row.worker_recovery_score),
    replayRecoveryScore: Number(row.replay_recovery_score),
    websocketResilienceScore: Number(row.websocket_resilience_score),
    queueBalanceScore: Number(row.queue_balance_score),
    cacheRecoveryScore: Number(row.cache_recovery_score),
    failoverSuccessRate: Number(row.failover_success_rate),
    overallScore: Number(row.overall_score),
    scoredAt: new Date(row.scored_at as string),
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function computeOverallResilienceScore(
  workerRecovery: number,
  replayRecovery: number,
  websocketResilience: number,
  queueBalance: number,
  cacheRecovery: number,
  failoverSuccessRate: number,
): number {
  return Math.round(
    workerRecovery * 0.20 +
    replayRecovery * 0.25 +
    websocketResilience * 0.15 +
    queueBalance * 0.15 +
    cacheRecovery * 0.10 +
    failoverSuccessRate * 100 * 0.15,
  )
}

export function isResilienceHealthy(score: ResilienceScore): boolean {
  return score.overallScore >= RESILIENCE_SCORE_THRESHOLD && score.replayRecoveryScore >= 80
}

export function identifyResilienceWeakness(score: ResilienceScore): string | null {
  if (score.replayRecoveryScore < 70) return 'replay_recovery'
  if (score.workerRecoveryScore < 70) return 'worker_recovery'
  if (score.queueBalanceScore < 70) return 'queue_balance'
  if (score.websocketResilienceScore < 70) return 'websocket'
  if (score.cacheRecoveryScore < 70) return 'cache_recovery'
  return null
}

// ─── Service ─────────────────────────────────────────────────────────────────

export async function recordResilienceScore(
  environment: string,
  workerRecoveryScore: number,
  replayRecoveryScore: number,
  websocketResilienceScore: number,
  queueBalanceScore: number,
  cacheRecoveryScore: number,
  failoverSuccessRate: number,
): Promise<ResilienceScore> {
  const overallScore = computeOverallResilienceScore(
    workerRecoveryScore, replayRecoveryScore, websocketResilienceScore,
    queueBalanceScore, cacheRecoveryScore, failoverSuccessRate,
  )
  const result = await pool.query(
    `INSERT INTO p12_resilience_scores
       (environment, worker_recovery_score, replay_recovery_score, websocket_resilience_score,
        queue_balance_score, cache_recovery_score, failover_success_rate, overall_score, scored_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
     RETURNING *`,
    [environment, workerRecoveryScore, replayRecoveryScore, websocketResilienceScore, queueBalanceScore, cacheRecoveryScore, failoverSuccessRate, overallScore],
  )
  return _mapResilienceScore(result.rows[0])
}

export async function getLatestResilienceScore(environment: string): Promise<ResilienceScore | null> {
  const result = await pool.query(
    `SELECT * FROM p12_resilience_scores
     WHERE environment = $1
     ORDER BY scored_at DESC
     LIMIT 1`,
    [environment],
  )
  return result.rows[0] ? _mapResilienceScore(result.rows[0]) : null
}

export async function getResilienceTrend(environment: string, limit = 14): Promise<ResilienceScore[]> {
  const result = await pool.query(
    `SELECT * FROM p12_resilience_scores
     WHERE environment = $1
     ORDER BY scored_at DESC
     LIMIT $2`,
    [environment, limit],
  )
  return result.rows.map(_mapResilienceScore)
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  computeOverallResilienceScore,
  isResilienceHealthy,
  identifyResilienceWeakness,
  _mapResilienceScore,
}
