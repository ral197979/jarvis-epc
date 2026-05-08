// Denver Engineering — Reliability Scoring Engine (v10.0.0)
// Computes composite SLO scores from uptime, latency, and error-rate signals.

import { default as pool } from '../../db/pool'
import {
  ReliabilityScore, SLOViolation, SLOPeriod,
  RELIABILITY_SLO_DEFAULT,
} from './phase10Types'

// ─── Score lifecycle ──────────────────────────────────────────────────────────

export async function recordReliabilityScore(
  environment: string,
  period: SLOPeriod,
  uptimePercent: number,
  errorRate: number,
  p50Ms: number,
  p95Ms: number,
  p99Ms: number,
): Promise<ReliabilityScore> {
  const score = computeCompositeScore(uptimePercent, errorRate, p95Ms)
  const sloMet = uptimePercent / 100 >= RELIABILITY_SLO_DEFAULT

  const res = await pool.query(
    `INSERT INTO reliability_scores
      (environment, period, uptime_percent, error_rate,
       p50_ms, p95_ms, p99_ms, composite_score, slo_met, scored_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
     RETURNING *`,
    [environment, period, uptimePercent, errorRate, p50Ms, p95Ms, p99Ms, score, sloMet],
  )
  return _mapScore(res.rows[0])
}

export async function getReliabilityScore(
  scoreId: string,
): Promise<ReliabilityScore | null> {
  const res = await pool.query(
    `SELECT * FROM reliability_scores WHERE id = $1`,
    [scoreId],
  )
  return res.rows.length > 0 ? _mapScore(res.rows[0]) : null
}

export async function listReliabilityScores(
  environment?: string,
  period?: SLOPeriod,
  limit = 30,
): Promise<ReliabilityScore[]> {
  const res = await pool.query(
    `SELECT * FROM reliability_scores
     WHERE ($1::text IS NULL OR environment = $1)
       AND ($2::text IS NULL OR period = $2)
     ORDER BY scored_at DESC LIMIT $3`,
    [environment ?? null, period ?? null, limit],
  )
  return res.rows.map(_mapScore)
}

export async function getCurrentSLOStatus(
  environment: string,
): Promise<{ sloMet: boolean; currentUptime: number; target: number }> {
  const res = await pool.query(
    `SELECT uptime_percent, slo_met
     FROM reliability_scores
     WHERE environment = $1
     ORDER BY scored_at DESC LIMIT 1`,
    [environment],
  )
  if (res.rows.length === 0) {
    return { sloMet: true, currentUptime: 100, target: RELIABILITY_SLO_DEFAULT * 100 }
  }
  const row = res.rows[0]
  return {
    sloMet: Boolean(row['slo_met']),
    currentUptime: Number(row['uptime_percent']),
    target: RELIABILITY_SLO_DEFAULT * 100,
  }
}

// ─── SLO Violations ───────────────────────────────────────────────────────────

export async function recordSLOViolation(
  environment: string,
  violationType: string,
  description: string,
  durationMs: number,
  impactedTenants: number,
): Promise<SLOViolation> {
  const res = await pool.query(
    `INSERT INTO slo_violations
      (environment, violation_type, description, duration_ms, impacted_tenants, occurred_at)
     VALUES ($1,$2,$3,$4,$5,now())
     RETURNING *`,
    [environment, violationType, description, durationMs, impactedTenants],
  )
  return _mapViolation(res.rows[0])
}

export async function resolveViolation(
  violationId: string,
  rootCause: string,
): Promise<SLOViolation> {
  const res = await pool.query(
    `UPDATE slo_violations
     SET resolved_at = now(), root_cause = $2
     WHERE id = $1
     RETURNING *`,
    [violationId, rootCause],
  )
  if (res.rows.length === 0) throw new Error(`SLO violation ${violationId} not found`)
  return _mapViolation(res.rows[0])
}

export async function listViolations(
  environment?: string,
  limit = 20,
): Promise<SLOViolation[]> {
  const res = await pool.query(
    `SELECT * FROM slo_violations
     WHERE ($1::text IS NULL OR environment = $1)
     ORDER BY occurred_at DESC LIMIT $2`,
    [environment ?? null, limit],
  )
  return res.rows.map(_mapViolation)
}

// ─── Score computation ────────────────────────────────────────────────────────

export function computeCompositeScore(
  uptimePercent: number,
  errorRate: number,
  p95Ms: number,
): number {
  // Uptime component: 0–50 points
  const uptimeScore = Math.min(50, (uptimePercent / 100) * 50)
  // Error rate component: 0–30 points (0% errors = 30pts)
  const errorScore = Math.max(0, 30 - errorRate * 300)
  // Latency component: 0–20 points (<500ms full score, degrades to 2000ms)
  const latencyScore = Math.max(0, 20 - Math.max(0, p95Ms - 500) / 75)

  return Math.round(uptimeScore + errorScore + latencyScore)
}

export function isSLOMet(uptimePercent: number, sloTarget = RELIABILITY_SLO_DEFAULT): boolean {
  return uptimePercent / 100 >= sloTarget
}

export function computeErrorBudgetRemaining(
  uptimePercent: number,
  sloTarget = RELIABILITY_SLO_DEFAULT,
): number {
  const allowedDowntime = (1 - sloTarget) * 100
  const actualDowntime = 100 - uptimePercent
  return Math.max(0, allowedDowntime - actualDowntime)
}

// ─── Test hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  _mapScore,
  _mapViolation,
  computeCompositeScore,
  isSLOMet,
  computeErrorBudgetRemaining,
  RELIABILITY_SLO_DEFAULT,
}

// ─── Mappers ──────────────────────────────────────────────────────────────────

function _mapScore(row: Record<string, unknown>): ReliabilityScore {
  return {
    id: row['id'] as string,
    environment: row['environment'] as string,
    period: row['period'] as SLOPeriod,
    uptimePercent: Number(row['uptime_percent']),
    errorRate: Number(row['error_rate']),
    p50Ms: Number(row['p50_ms']),
    p95Ms: Number(row['p95_ms']),
    p99Ms: Number(row['p99_ms']),
    compositeScore: Number(row['composite_score']),
    sloMet: Boolean(row['slo_met']),
    scoredAt: new Date(row['scored_at'] as string),
    createdAt: new Date(row['created_at'] as string),
  }
}

function _mapViolation(row: Record<string, unknown>): SLOViolation {
  return {
    id: row['id'] as string,
    environment: row['environment'] as string,
    violationType: row['violation_type'] as string,
    description: row['description'] as string,
    durationMs: Number(row['duration_ms']),
    impactedTenants: Number(row['impacted_tenants']),
    rootCause: (row['root_cause'] as string) ?? null,
    occurredAt: new Date(row['occurred_at'] as string),
    resolvedAt: row['resolved_at'] != null ? new Date(row['resolved_at'] as string) : null,
    createdAt: new Date(row['created_at'] as string),
  }
}
