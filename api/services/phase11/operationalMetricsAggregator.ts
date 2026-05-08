// Denver Engineering — Operational Metrics Aggregator (Phase 11)
// Aggregate telemetry events into periodic summaries

import { pool } from '../../db/pool'
import {
  TelemetryAggregate,
  TelemetryMetricType,
} from './phase11Types'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _mapAggregate(row: Record<string, unknown>): TelemetryAggregate {
  return {
    id: row.id as string,
    metricType: row.metric_type as TelemetryMetricType,
    environment: row.environment as string,
    periodStart: new Date(row.period_start as string),
    periodEnd: new Date(row.period_end as string),
    p50: Number(row.p50),
    p95: Number(row.p95),
    p99: Number(row.p99),
    avg: Number(row.avg),
    min: Number(row.min),
    max: Number(row.max),
    sampleCount: Number(row.sample_count),
    createdAt: new Date(row.created_at as string),
  }
}

// ─── Create Aggregate ────────────────────────────────────────────────────────

export async function createTelemetryAggregate(
  metricType: TelemetryMetricType,
  environment: string,
  periodStart: Date,
  periodEnd: Date
): Promise<TelemetryAggregate> {
  // Compute aggregates from raw events in the period
  const statsResult = await pool.query(
    `SELECT
       COUNT(*) as sample_count,
       AVG(value) as avg,
       MIN(value) as min,
       MAX(value) as max,
       PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY value) as p50,
       PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY value) as p95,
       PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY value) as p99
     FROM telemetry_events
     WHERE metric_type = $1 AND environment = $2
       AND recorded_at >= $3 AND recorded_at < $4`,
    [metricType, environment, periodStart, periodEnd]
  )

  const stats = statsResult.rows[0] ?? {}
  const sampleCount = Number(stats.sample_count ?? 0)

  const insertResult = await pool.query(
    `INSERT INTO telemetry_aggregates
       (metric_type, environment, period_start, period_end,
        p50, p95, p99, avg, min, max, sample_count, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
     RETURNING *`,
    [
      metricType, environment, periodStart, periodEnd,
      Number(stats.p50 ?? 0),
      Number(stats.p95 ?? 0),
      Number(stats.p99 ?? 0),
      Number(stats.avg ?? 0),
      Number(stats.min ?? 0),
      Number(stats.max ?? 0),
      sampleCount,
    ]
  )
  return _mapAggregate(insertResult.rows[0])
}

// ─── Get Aggregate ────────────────────────────────────────────────────────────

export async function getTelemetryAggregate(
  metricType: TelemetryMetricType,
  environment: string,
  periodStart: Date
): Promise<TelemetryAggregate | null> {
  const result = await pool.query(
    `SELECT * FROM telemetry_aggregates
     WHERE metric_type = $1 AND environment = $2 AND period_start = $3`,
    [metricType, environment, periodStart]
  )
  return result.rows.length > 0 ? _mapAggregate(result.rows[0]) : null
}

// ─── List Aggregates ──────────────────────────────────────────────────────────

export async function listTelemetryAggregates(
  metricType: TelemetryMetricType,
  environment: string,
  since: Date
): Promise<TelemetryAggregate[]> {
  const result = await pool.query(
    `SELECT * FROM telemetry_aggregates
     WHERE metric_type = $1 AND environment = $2 AND period_start >= $3
     ORDER BY period_start DESC`,
    [metricType, environment, since]
  )
  return result.rows.map(_mapAggregate)
}

// ─── Run Aggregation Job ─────────────────────────────────────────────────────

export async function runAggregationJob(
  environment: string,
  periodStart: Date,
  periodEnd: Date
): Promise<TelemetryAggregate[]> {
  const metricTypes: TelemetryMetricType[] = [
    'feature_adoption', 'workflow_completion', 'replay_latency',
    'ai_acceptance', 'anomaly_frequency', 'onboarding_completion',
    'support_incident_frequency', 'deployment_recovery', 'sync_lag',
    'tenant_maturity',
  ]

  const results: TelemetryAggregate[] = []
  for (const metricType of metricTypes) {
    const agg = await createTelemetryAggregate(metricType, environment, periodStart, periodEnd)
    results.push(agg)
  }
  return results
}

// ─── Compute Delta ────────────────────────────────────────────────────────────

export function computeAggregrateDelta(
  current: TelemetryAggregate,
  previous: TelemetryAggregate
): { avgDeltaPct: number; p95DeltaPct: number } {
  const avgDeltaPct = previous.avg === 0
    ? 0
    : ((current.avg - previous.avg) / previous.avg) * 100

  const p95DeltaPct = previous.p95 === 0
    ? 0
    : ((current.p95 - previous.p95) / previous.p95) * 100

  return { avgDeltaPct, p95DeltaPct }
}

// ─── Get Latest Aggregate ────────────────────────────────────────────────────

export async function getLatestAggregate(
  metricType: TelemetryMetricType,
  environment: string
): Promise<TelemetryAggregate | null> {
  const result = await pool.query(
    `SELECT * FROM telemetry_aggregates
     WHERE metric_type = $1 AND environment = $2
     ORDER BY period_start DESC
     LIMIT 1`,
    [metricType, environment]
  )
  return result.rows.length > 0 ? _mapAggregate(result.rows[0]) : null
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  _mapAggregate,
  computeAggregrateDelta,
}
