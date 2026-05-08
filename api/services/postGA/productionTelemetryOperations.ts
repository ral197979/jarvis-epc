// Denver Engineering — Production Telemetry Operations (Post-GA)
// Ingests, classifies, and tracks operational telemetry drift in production

import { pool } from '../../db/pool'
import { tenantQuery } from '../../db/pool'
import {
  TelemetryOperationsRecord,
  OperationalDriftSummary,
  TelemetryMetric,
  DriftSeverity,
  TELEMETRY_HEALTH_MIN_SCORE,
} from './postGATypes'

// ─── Mapper ──────────────────────────────────────────────────────────────────

function _mapTelemetryRecord(row: Record<string, unknown>): TelemetryOperationsRecord {
  return {
    id: row.id as string,
    metric: row.metric as TelemetryMetric,
    tenantId: row.tenant_id as string | null,
    value: Number(row.value),
    baselineValue: Number(row.baseline_value),
    driftPct: Number(row.drift_pct),
    driftSeverity: row.drift_severity as DriftSeverity,
    recordedAt: new Date(row.recorded_at as string),
  }
}

function _mapDriftSummary(row: Record<string, unknown>): OperationalDriftSummary {
  return {
    id: row.id as string,
    environment: row.environment as string,
    alertCount: Number(row.alert_count),
    severeMetrics: row.severe_metrics as TelemetryMetric[],
    overallDriftScore: Number(row.overall_drift_score),
    isHealthy: row.is_healthy as boolean,
    computedAt: new Date(row.computed_at as string),
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function computeTelemetryDriftPct(baselineValue: number, currentValue: number): number {
  if (baselineValue === 0) return currentValue !== 0 ? 1.0 : 0
  return Math.abs(currentValue - baselineValue) / baselineValue
}

export function classifyTelemetryDrift(driftPct: number): DriftSeverity {
  if (driftPct <= 0.05) return 'none'
  if (driftPct <= 0.15) return 'minor'
  if (driftPct <= 0.35) return 'moderate'
  return 'severe'
}

export function computeOverallDriftScore(records: TelemetryOperationsRecord[]): number {
  if (records.length === 0) return 100
  const alertRecords = records.filter(r => r.driftSeverity !== 'none')
  const severeRecords = records.filter(r => r.driftSeverity === 'severe')
  const penalty = (alertRecords.length * 5) + (severeRecords.length * 15)
  return Math.max(0, 100 - penalty)
}

export function isTelemetryHealthy(overallDriftScore: number): boolean {
  return overallDriftScore >= TELEMETRY_HEALTH_MIN_SCORE
}

export function getSevereMetrics(records: TelemetryOperationsRecord[]): TelemetryMetric[] {
  return records
    .filter(r => r.driftSeverity === 'severe')
    .map(r => r.metric)
}

// ─── Service ─────────────────────────────────────────────────────────────────

export async function recordTelemetry(
  metric: TelemetryMetric,
  value: number,
  baselineValue: number,
  tenantId?: string,
): Promise<TelemetryOperationsRecord> {
  const driftPct = computeTelemetryDriftPct(baselineValue, value)
  const driftSeverity = classifyTelemetryDrift(driftPct)

  const result = await pool.query(
    `INSERT INTO pga_telemetry_records
       (metric, tenant_id, value, baseline_value, drift_pct, drift_severity, recorded_at)
     VALUES ($1,$2,$3,$4,$5,$6,NOW())
     RETURNING *`,
    [metric, tenantId ?? null, value, baselineValue, driftPct, driftSeverity],
  )
  return _mapTelemetryRecord(result.rows[0])
}

export async function getTenantTelemetry(tenantId: string, limit = 50): Promise<TelemetryOperationsRecord[]> {
  const result = await tenantQuery(
    tenantId,
    `SELECT * FROM pga_telemetry_records WHERE tenant_id=$1 ORDER BY recorded_at DESC LIMIT $2`,
    [tenantId, limit],
  )
  return result.rows.map(_mapTelemetryRecord)
}

export async function getRecentAlerts(since: Date): Promise<TelemetryOperationsRecord[]> {
  const result = await pool.query(
    `SELECT * FROM pga_telemetry_records
     WHERE drift_severity IN ('moderate','severe') AND recorded_at >= $1
     ORDER BY recorded_at DESC`,
    [since],
  )
  return result.rows.map(_mapTelemetryRecord)
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  computeTelemetryDriftPct,
  classifyTelemetryDrift,
  computeOverallDriftScore,
  isTelemetryHealthy,
  getSevereMetrics,
  _mapTelemetryRecord,
  _mapDriftSummary,
}
