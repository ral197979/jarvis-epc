// Denver Engineering — Uptime Monitor (v10.0.0)
// Tracks API latency, websocket uptime, queue lag, replay failures, and more.

import { default as pool } from '../../db/pool'
import { UptimeRecord, UptimeMetricType, UptimeSummary } from './phase10Types'

// ─── Record uptime checks ─────────────────────────────────────────────────────

export interface RecordUptimeInput {
  metricType: UptimeMetricType
  valueMs: number
  healthy: boolean
  environment?: string
  metadata?: Record<string, unknown>
}

export async function recordUptimeCheck(
  input: RecordUptimeInput,
): Promise<UptimeRecord> {
  const res = await pool.query(
    `INSERT INTO uptime_records
      (metric_type, value_ms, healthy, environment, metadata, checked_at)
     VALUES ($1,$2,$3,$4,$5,now())
     RETURNING *`,
    [
      input.metricType,
      input.valueMs,
      input.healthy,
      input.environment ?? 'production',
      JSON.stringify(input.metadata ?? {}),
    ],
  )
  return _mapRecord(res.rows[0])
}

export async function getUptimeHistory(
  metricType: UptimeMetricType,
  environment = 'production',
  limit = 100,
): Promise<UptimeRecord[]> {
  const res = await pool.query(
    `SELECT * FROM uptime_records
     WHERE metric_type = $1 AND environment = $2
     ORDER BY checked_at DESC LIMIT $3`,
    [metricType, environment, limit],
  )
  return res.rows.map(_mapRecord)
}

export async function getUptimeSummary(
  environment = 'production',
  windowHours = 24,
): Promise<UptimeSummary[]> {
  const res = await pool.query(
    `SELECT
       metric_type,
       COUNT(*) AS total_checks,
       SUM(CASE WHEN healthy THEN 1 ELSE 0 END)::int AS healthy_checks,
       AVG(value_ms) AS avg_value_ms,
       MAX(value_ms) AS max_value_ms,
       MIN(value_ms) AS min_value_ms
     FROM uptime_records
     WHERE environment = $1
       AND checked_at >= now() - ($2 || ' hours')::interval
     GROUP BY metric_type`,
    [environment, windowHours],
  )
  return res.rows.map(row => ({
    metricType: row['metric_type'] as UptimeMetricType,
    totalChecks: Number(row['total_checks']),
    healthyChecks: Number(row['healthy_checks']),
    uptimePercent: computeUptimePercent(
      Number(row['healthy_checks']),
      Number(row['total_checks']),
    ),
    avgValueMs: Math.round(Number(row['avg_value_ms'] ?? 0)),
    maxValueMs: Math.round(Number(row['max_value_ms'] ?? 0)),
    minValueMs: Math.round(Number(row['min_value_ms'] ?? 0)),
  }))
}

export async function getLatestCheck(
  metricType: UptimeMetricType,
  environment = 'production',
): Promise<UptimeRecord | null> {
  const res = await pool.query(
    `SELECT * FROM uptime_records
     WHERE metric_type = $1 AND environment = $2
     ORDER BY checked_at DESC LIMIT 1`,
    [metricType, environment],
  )
  return res.rows.length > 0 ? _mapRecord(res.rows[0]) : null
}

// ─── Thresholds ───────────────────────────────────────────────────────────────

export const UPTIME_THRESHOLDS: Record<UptimeMetricType, number> = {
  api_latency: 500,
  websocket_uptime: 1,       // boolean: 1=up
  queue_latency: 2000,
  replay_failure_rate: 0,    // zero failures expected
  sync_lag: 5000,
  worker_churn: 10,          // pct
  deployment_recovery: 30000,
  ai_provider_latency: 3000,
  billing_reconciliation_lag: 3600000, // 1 hour
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function computeUptimePercent(healthy: number, total: number): number {
  if (total === 0) return 100
  return Math.round((healthy / total) * 10000) / 100
}

export function isMetricHealthy(
  metricType: UptimeMetricType,
  valueMs: number,
): boolean {
  const threshold = UPTIME_THRESHOLDS[metricType]
  return valueMs <= threshold
}

export function classifyLatency(valueMs: number): 'fast' | 'acceptable' | 'slow' | 'critical' {
  if (valueMs < 100) return 'fast'
  if (valueMs < 500) return 'acceptable'
  if (valueMs < 2000) return 'slow'
  return 'critical'
}

// ─── Test hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  _mapRecord,
  computeUptimePercent,
  isMetricHealthy,
  classifyLatency,
  UPTIME_THRESHOLDS,
}

// ─── Mapper ───────────────────────────────────────────────────────────────────

function _mapRecord(row: Record<string, unknown>): UptimeRecord {
  return {
    id: row['id'] as string,
    metricType: row['metric_type'] as UptimeMetricType,
    valueMs: Number(row['value_ms']),
    healthy: Boolean(row['healthy']),
    environment: row['environment'] as string,
    metadata: (typeof row['metadata'] === 'string'
      ? JSON.parse(row['metadata'] as string)
      : row['metadata']) as Record<string, unknown>,
    checkedAt: new Date(row['checked_at'] as string),
    createdAt: new Date(row['created_at'] as string),
  }
}
