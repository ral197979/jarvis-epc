// Denver Engineering — Production Telemetry Engine (Phase 11)
// Track and store real-world telemetry events for GA operations

import { pool, tenantQuery } from '../../db/pool'
import {
  TelemetryEvent,
  TelemetryMetricType,
} from './phase11Types'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _mapTelemetryEvent(row: Record<string, unknown>): TelemetryEvent {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    metricType: row.metric_type as TelemetryMetricType,
    value: Number(row.value),
    dimensions: (row.dimensions as Record<string, string>) ?? {},
    environment: row.environment as string,
    recordedAt: new Date(row.recorded_at as string),
    createdAt: new Date(row.created_at as string),
  }
}

// ─── Record Telemetry Event ───────────────────────────────────────────────────

export async function recordTelemetryEvent(
  tenantId: string,
  metricType: TelemetryMetricType,
  value: number,
  dimensions: Record<string, string> = {},
  environment: string = 'production'
): Promise<TelemetryEvent> {
  const result = await pool.query(
    `INSERT INTO telemetry_events
       (tenant_id, metric_type, value, dimensions, environment, recorded_at, created_at)
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
     RETURNING *`,
    [tenantId, metricType, value, JSON.stringify(dimensions), environment]
  )
  return _mapTelemetryEvent(result.rows[0])
}

// ─── Get Telemetry Events ─────────────────────────────────────────────────────

export async function getTelemetryEvents(
  tenantId: string,
  metricType: TelemetryMetricType,
  since: Date
): Promise<TelemetryEvent[]> {
  const rows = await tenantQuery(
    tenantId,
    `SELECT * FROM telemetry_events
     WHERE metric_type = $1 AND recorded_at >= $2
     ORDER BY recorded_at DESC`,
    [metricType, since]
  )
  return rows.rows.map(_mapTelemetryEvent)
}

// ─── Get Latest Telemetry ─────────────────────────────────────────────────────

export async function getLatestTelemetryEvent(
  tenantId: string,
  metricType: TelemetryMetricType
): Promise<TelemetryEvent | null> {
  const rows = await tenantQuery(
    tenantId,
    `SELECT * FROM telemetry_events
     WHERE metric_type = $1
     ORDER BY recorded_at DESC
     LIMIT 1`,
    [metricType]
  )
  return rows.rows.length > 0 ? _mapTelemetryEvent(rows.rows[0]) : null
}

// ─── Compute Metric Average ───────────────────────────────────────────────────

export function computeMetricAverage(events: TelemetryEvent[]): number {
  if (events.length === 0) return 0
  const sum = events.reduce((acc, e) => acc + e.value, 0)
  return sum / events.length
}

// ─── Compute Metric Percentile ────────────────────────────────────────────────

export function computeMetricPercentile(events: TelemetryEvent[], pct: number): number {
  if (events.length === 0) return 0
  const sorted = [...events].sort((a, b) => a.value - b.value)
  const idx = Math.ceil((pct / 100) * sorted.length) - 1
  return sorted[Math.max(0, idx)].value
}

// ─── Get Tenant Metric Summary ────────────────────────────────────────────────

export async function getTenantMetricSummary(
  tenantId: string,
  metricType: TelemetryMetricType,
  since: Date
): Promise<{ avg: number; min: number; max: number; count: number }> {
  const rows = await tenantQuery(
    tenantId,
    `SELECT AVG(value) as avg, MIN(value) as min, MAX(value) as max, COUNT(*) as count
     FROM telemetry_events
     WHERE metric_type = $1 AND recorded_at >= $2`,
    [metricType, since]
  )
  const row = rows.rows[0] ?? {}
  return {
    avg: Number(row.avg ?? 0),
    min: Number(row.min ?? 0),
    max: Number(row.max ?? 0),
    count: Number(row.count ?? 0),
  }
}

// ─── Purge Old Telemetry ──────────────────────────────────────────────────────

export async function purgeOldTelemetryEvents(retentionDays: number): Promise<number> {
  const result = await pool.query(
    `DELETE FROM telemetry_events
     WHERE recorded_at < NOW() - INTERVAL '1 day' * $1`,
    [retentionDays]
  )
  return result.rowCount ?? 0
}

// ─── Cross-Tenant Metric Aggregate (admin only) ───────────────────────────────

export async function getGlobalMetricStats(
  metricType: TelemetryMetricType,
  environment: string,
  since: Date
): Promise<{ avg: number; p95: number; p99: number; sampleCount: number }> {
  const result = await pool.query(
    `SELECT
       AVG(value) as avg,
       PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY value) as p95,
       PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY value) as p99,
       COUNT(*) as sample_count
     FROM telemetry_events
     WHERE metric_type = $1 AND environment = $2 AND recorded_at >= $3`,
    [metricType, environment, since]
  )
  const row = result.rows[0] ?? {}
  return {
    avg: Number(row.avg ?? 0),
    p95: Number(row.p95 ?? 0),
    p99: Number(row.p99 ?? 0),
    sampleCount: Number(row.sample_count ?? 0),
  }
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  _mapTelemetryEvent,
  computeMetricAverage,
  computeMetricPercentile,
}
