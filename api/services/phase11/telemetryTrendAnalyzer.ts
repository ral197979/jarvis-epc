// Denver Engineering — Telemetry Trend Analyzer (Phase 11)
// Analyze trends across telemetry aggregates to detect improving/degrading patterns

import { pool } from '../../db/pool'
import {
  TelemetryAggregate,
  TelemetryTrend,
  TelemetryMetricType,
} from './phase11Types'

// ─── Analyze Trend ────────────────────────────────────────────────────────────

export function analyzeTrend(
  current: TelemetryAggregate,
  previous: TelemetryAggregate
): TelemetryTrend {
  const changePercent = previous.avg === 0
    ? 0
    : ((current.avg - previous.avg) / previous.avg) * 100

  // Higher-is-better metrics: feature_adoption, workflow_completion,
  // ai_acceptance, onboarding_completion, tenant_maturity
  const higherIsBetter: TelemetryMetricType[] = [
    'feature_adoption', 'workflow_completion', 'ai_acceptance',
    'onboarding_completion', 'tenant_maturity',
  ]

  const isHigherBetter = higherIsBetter.includes(current.metricType)

  let direction: 'improving' | 'degrading' | 'stable'
  const absChange = Math.abs(changePercent)

  if (absChange < 2) {
    direction = 'stable'
  } else if (isHigherBetter) {
    direction = changePercent > 0 ? 'improving' : 'degrading'
  } else {
    // Lower-is-better: replay_latency, anomaly_frequency,
    // support_incident_frequency, deployment_recovery, sync_lag
    direction = changePercent < 0 ? 'improving' : 'degrading'
  }

  const confidence = computeTrendConfidence(current.sampleCount, previous.sampleCount)

  return {
    metricType: current.metricType,
    direction,
    changePercent,
    currentAvg: current.avg,
    previousAvg: previous.avg,
    confidence,
    analyzedAt: new Date(),
  }
}

// ─── Compute Trend Confidence ─────────────────────────────────────────────────

export function computeTrendConfidence(
  currentSamples: number,
  previousSamples: number
): number {
  const minSamples = Math.min(currentSamples, previousSamples)
  if (minSamples === 0) return 0
  if (minSamples >= 1000) return 1.0
  if (minSamples >= 100) return 0.9
  if (minSamples >= 50) return 0.75
  if (minSamples >= 10) return 0.5
  return 0.25
}

// ─── Store Trend ──────────────────────────────────────────────────────────────

export async function storeTrendAnalysis(
  trend: TelemetryTrend,
  environment: string
): Promise<void> {
  await pool.query(
    `INSERT INTO telemetry_trends
       (metric_type, environment, direction, change_percent,
        current_avg, previous_avg, confidence, analyzed_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
    [
      trend.metricType, environment, trend.direction, trend.changePercent,
      trend.currentAvg, trend.previousAvg, trend.confidence, trend.analyzedAt,
    ]
  )
}

// ─── Get Stored Trends ────────────────────────────────────────────────────────

export async function getLatestTrends(environment: string): Promise<TelemetryTrend[]> {
  const result = await pool.query(
    `SELECT DISTINCT ON (metric_type)
       metric_type, direction, change_percent, current_avg,
       previous_avg, confidence, analyzed_at
     FROM telemetry_trends
     WHERE environment = $1
     ORDER BY metric_type, analyzed_at DESC`,
    [environment]
  )
  return result.rows.map((row: Record<string, unknown>) => ({
    metricType: row.metric_type as TelemetryMetricType,
    direction: row.direction as 'improving' | 'degrading' | 'stable',
    changePercent: Number(row.change_percent),
    currentAvg: Number(row.current_avg),
    previousAvg: Number(row.previous_avg),
    confidence: Number(row.confidence),
    analyzedAt: new Date(row.analyzed_at as string),
  }))
}

// ─── Detect Degrading Metrics ─────────────────────────────────────────────────

export function detectDegradingMetrics(trends: TelemetryTrend[]): TelemetryTrend[] {
  return trends.filter(t => t.direction === 'degrading' && t.confidence >= 0.5)
}

// ─── Run Full Trend Analysis ──────────────────────────────────────────────────

export async function runFullTrendAnalysis(
  environment: string,
  currentPeriodStart: Date,
  previousPeriodStart: Date
): Promise<TelemetryTrend[]> {
  const metricTypes: TelemetryMetricType[] = [
    'feature_adoption', 'workflow_completion', 'replay_latency',
    'ai_acceptance', 'anomaly_frequency', 'onboarding_completion',
    'support_incident_frequency', 'deployment_recovery', 'sync_lag',
    'tenant_maturity',
  ]

  const trends: TelemetryTrend[] = []

  for (const metricType of metricTypes) {
    const [currentResult, previousResult] = await Promise.all([
      pool.query(
        `SELECT * FROM telemetry_aggregates
         WHERE metric_type = $1 AND environment = $2 AND period_start = $3`,
        [metricType, environment, currentPeriodStart]
      ),
      pool.query(
        `SELECT * FROM telemetry_aggregates
         WHERE metric_type = $1 AND environment = $2 AND period_start = $3`,
        [metricType, environment, previousPeriodStart]
      ),
    ])

    if (currentResult.rows.length > 0 && previousResult.rows.length > 0) {
      const current = currentResult.rows[0]
      const previous = previousResult.rows[0]

      const currentAgg: TelemetryAggregate = {
        id: current.id,
        metricType: current.metric_type,
        environment: current.environment,
        periodStart: new Date(current.period_start),
        periodEnd: new Date(current.period_end),
        p50: Number(current.p50),
        p95: Number(current.p95),
        p99: Number(current.p99),
        avg: Number(current.avg),
        min: Number(current.min),
        max: Number(current.max),
        sampleCount: Number(current.sample_count),
        createdAt: new Date(current.created_at),
      }

      const previousAgg: TelemetryAggregate = {
        id: previous.id,
        metricType: previous.metric_type,
        environment: previous.environment,
        periodStart: new Date(previous.period_start),
        periodEnd: new Date(previous.period_end),
        p50: Number(previous.p50),
        p95: Number(previous.p95),
        p99: Number(previous.p99),
        avg: Number(previous.avg),
        min: Number(previous.min),
        max: Number(previous.max),
        sampleCount: Number(previous.sample_count),
        createdAt: new Date(previous.created_at),
      }

      const trend = analyzeTrend(currentAgg, previousAgg)
      await storeTrendAnalysis(trend, environment)
      trends.push(trend)
    }
  }

  return trends
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  analyzeTrend,
  computeTrendConfidence,
  detectDegradingMetrics,
}
