/* eslint-disable @typescript-eslint/no-unused-vars */
// Denver Engineering — Timeline Projection Service (v6.0.0)
// Projects future state trajectories from historical trends.

import { tenantQuery } from '../../db/pool'
import { TimeSeriesPoint, TemporalProjection } from './twinTypes'
import { getScoreTrend } from './temporalStateEngine'

// ─── Project twin timeline ────────────────────────────────────────────────────

export async function projectTwinTimeline(
  twinId: string,
  tenantId: string,
  horizonDays = 30
): Promise<TemporalProjection> {
  const [readinessTrend, riskHistory, workloadRes] = await Promise.all([
    getScoreTrend(twinId, tenantId, 'readinessScore', 30),
    getScoreTrend(twinId, tenantId, 'riskScore', 30),
    tenantQuery(
      tenantId,
      `SELECT DATE_TRUNC('day', created_at) as day, COUNT(*) as cnt
       FROM actions WHERE project_id = (
         SELECT entity_id FROM operational_twins WHERE id = $1 AND tenant_id = $2
       ) AND created_at >= now() - interval '30 days'
       GROUP BY day ORDER BY day ASC`,
      [twinId, tenantId]
    ).catch(() => ({ rows: [] as Record<string, unknown>[] })),
  ])

  const projectedReadiness = _linearProjection(readinessTrend, horizonDays, 0, 100)
  const projectedWorkload = _workloadProjection(workloadRes.rows, horizonDays)
  const projectedResourceConflicts = _conflictProjection(projectedWorkload)

  // SLA breach probability: higher when readiness projected to drop below 70
  const finalReadiness = projectedReadiness[projectedReadiness.length - 1]?.value ?? 70
  const projectedSlaBreachProbability = Math.min(1, Math.max(0, (70 - finalReadiness) / 70))

  const confidence = _computeProjectionConfidence(readinessTrend.length)

  const explanation = _buildExplanation(
    readinessTrend,
    finalReadiness,
    projectedSlaBreachProbability,
    confidence
  )

  return {
    twinId,
    horizonDays,
    projectedReadiness,
    projectedSlaBreachProbability,
    projectedWorkload,
    projectedResourceConflicts,
    confidence,
    explanation,
    computedAt: new Date(),
  }
}

// ─── Linear projection ────────────────────────────────────────────────────────

export function _linearProjection(
  history: Array<{ ts: Date; value: number }>,
  horizonDays: number,
  min = 0,
  max = 100
): TimeSeriesPoint[] {
  if (history.length === 0) return _flatProjection(50, horizonDays)
  if (history.length === 1) return _flatProjection(history[0].value, horizonDays)

  // Simple linear regression
  const n = history.length
  const xBase = history[0].ts.getTime()
  const xs = history.map(p => (p.ts.getTime() - xBase) / (24 * 60 * 60 * 1000))
  const ys = history.map(p => p.value)

  const sumX = xs.reduce((a, b) => a + b, 0)
  const sumY = ys.reduce((a, b) => a + b, 0)
  const sumXY = xs.reduce((s, x, i) => s + x * ys[i], 0)
  const sumX2 = xs.reduce((s, x) => s + x * x, 0)

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX || 1)
  const intercept = (sumY - slope * sumX) / n

  const lastDay = xs[xs.length - 1]
  const stdDev = _stdDev(ys)
  const points: TimeSeriesPoint[] = []

  for (let d = 1; d <= horizonDays; d++) {
    const x = lastDay + d
    const value = Math.min(max, Math.max(min, slope * x + intercept))
    const uncertainty = stdDev * Math.sqrt(1 + (1 / n) + Math.pow(x - sumX / n, 2) / sumX2)
    points.push({
      ts: new Date(history[0].ts.getTime() + x * 24 * 60 * 60 * 1000),
      value: Math.round(value * 10) / 10,
      lowerBound: Math.max(min, Math.round((value - uncertainty) * 10) / 10),
      upperBound: Math.min(max, Math.round((value + uncertainty) * 10) / 10),
    })
  }
  return points
}

function _flatProjection(value: number, horizonDays: number): TimeSeriesPoint[] {
  const now = Date.now()
  return Array.from({ length: horizonDays }, (_, i) => ({
    ts: new Date(now + (i + 1) * 24 * 60 * 60 * 1000),
    value,
    lowerBound: value,
    upperBound: value,
  }))
}

function _workloadProjection(
  rows: Record<string, unknown>[],
  horizonDays: number
): TimeSeriesPoint[] {
  const history = rows.map(r => ({
    ts: new Date(r.day as string),
    value: Number(r.cnt),
  }))
  if (history.length === 0) return _flatProjection(0, horizonDays)
  return _linearProjection(history, horizonDays, 0, 1000)
}

function _conflictProjection(workload: TimeSeriesPoint[]): TimeSeriesPoint[] {
  // Conflicts scale with workload variance
  return workload.map(p => ({
    ts: p.ts,
    value: Math.round(p.value * 0.1),
    lowerBound: 0,
    upperBound: Math.round((p.upperBound ?? p.value) * 0.15),
  }))
}

function _computeProjectionConfidence(historyPoints: number): number {
  if (historyPoints >= 20) return 0.85
  if (historyPoints >= 10) return 0.7
  if (historyPoints >= 5) return 0.55
  return 0.4
}

function _stdDev(values: number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const variance = values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length
  return Math.sqrt(variance)
}

function _buildExplanation(
  history: Array<{ ts: Date; value: number }>,
  projected: number,
  slaBreachProb: number,
  confidence: number
): string {
  const direction = history.length >= 2
    ? (history[history.length - 1].value > history[0].value ? 'improving' : 'declining')
    : 'stable'

  const slaRisk = slaBreachProb > 0.5 ? 'high SLA breach risk' : 'low SLA breach risk'
  return `Readiness trend is ${direction} (projected: ${projected.toFixed(1)}%). ${slaRisk} at ${(slaBreachProb * 100).toFixed(0)}%. Confidence: ${(confidence * 100).toFixed(0)}% based on ${history.length} historical data points.`
}

export const __testHooks = { _linearProjection, _computeProjectionConfidence, _stdDev }
