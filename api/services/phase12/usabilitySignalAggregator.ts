// Denver Engineering — Usability Signal Aggregator (Phase 12)
// Aggregates usability signals from feature interaction tracking

import { pool } from '../../db/pool'
import { tenantQuery } from '../../db/pool'
import { UsabilitySignal } from './phase12Types'

// ─── Mapper ──────────────────────────────────────────────────────────────────

function _mapUsabilitySignal(row: Record<string, unknown>): UsabilitySignal {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    feature: row.feature as string,
    frictionScore: Number(row.friction_score),
    completionRate: Number(row.completion_rate),
    averageTimeMs: Number(row.average_time_ms),
    abandonCount: Number(row.abandon_count),
    measuredAt: new Date(row.measured_at as string),
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function computeFrictionScore(
  completionRate: number,
  averageTimeMs: number,
  expectedTimeMs: number,
  abandonCount: number,
): number {
  const completionFriction = (1 - completionRate) * 50
  const timeFriction = averageTimeMs > expectedTimeMs ? Math.min((averageTimeMs / expectedTimeMs - 1) * 20, 30) : 0
  const abandonFriction = Math.min(abandonCount * 5, 20)
  return Math.min(100, Math.round(completionFriction + timeFriction + abandonFriction))
}

export function isHighFriction(signal: UsabilitySignal): boolean {
  return signal.frictionScore >= 50
}

export function getRankedFrictionFeatures(signals: UsabilitySignal[]): UsabilitySignal[] {
  return [...signals].sort((a, b) => b.frictionScore - a.frictionScore)
}

export function computeAverageCompletionRate(signals: UsabilitySignal[]): number {
  if (signals.length === 0) return 1.0
  return signals.reduce((sum, s) => sum + s.completionRate, 0) / signals.length
}

// ─── Service ─────────────────────────────────────────────────────────────────

export async function recordUsabilitySignal(
  tenantId: string,
  feature: string,
  frictionScore: number,
  completionRate: number,
  averageTimeMs: number,
  abandonCount: number,
): Promise<UsabilitySignal> {
  const result = await pool.query(
    `INSERT INTO p12_usability_signals
       (tenant_id, feature, friction_score, completion_rate, average_time_ms, abandon_count, measured_at)
     VALUES ($1,$2,$3,$4,$5,$6,NOW())
     RETURNING *`,
    [tenantId, feature, frictionScore, completionRate, averageTimeMs, abandonCount],
  )
  return _mapUsabilitySignal(result.rows[0])
}

export async function getSignalsForFeature(feature: string, limit = 20): Promise<UsabilitySignal[]> {
  const result = await pool.query(
    `SELECT * FROM p12_usability_signals
     WHERE feature = $1
     ORDER BY measured_at DESC
     LIMIT $2`,
    [feature, limit],
  )
  return result.rows.map(_mapUsabilitySignal)
}

export async function getHighFrictionFeatures(frictionThreshold = 50): Promise<UsabilitySignal[]> {
  const result = await pool.query(
    `SELECT DISTINCT ON (feature) *
     FROM p12_usability_signals
     WHERE friction_score >= $1
     ORDER BY feature, measured_at DESC`,
    [frictionThreshold],
  )
  return result.rows.map(_mapUsabilitySignal)
}

export async function getTenantSignals(tenantId: string): Promise<UsabilitySignal[]> {
  const result = await tenantQuery(
    tenantId,
    `SELECT * FROM p12_usability_signals
     WHERE tenant_id = $1
     ORDER BY measured_at DESC`,
    [tenantId],
  )
  return result.rows.map(_mapUsabilitySignal)
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  computeFrictionScore,
  isHighFriction,
  getRankedFrictionFeatures,
  computeAverageCompletionRate,
  _mapUsabilitySignal,
}
