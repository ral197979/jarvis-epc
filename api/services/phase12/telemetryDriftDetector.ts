// Denver Engineering — Telemetry Drift Detector (Phase 12)
// Detects statistical drift in production telemetry metrics

import { pool } from '../../db/pool'
import { TelemetryDrift, TELEMETRY_DRIFT_ALERT_THRESHOLD } from './phase12Types'

// ─── Mapper ──────────────────────────────────────────────────────────────────

function _mapTelemetryDrift(row: Record<string, unknown>): TelemetryDrift {
  return {
    id: row.id as string,
    metricName: row.metric_name as string,
    baselineValue: Number(row.baseline_value),
    currentValue: Number(row.current_value),
    driftPct: Number(row.drift_pct),
    direction: row.direction as 'increasing' | 'decreasing',
    isAlert: row.is_alert as boolean,
    detectedAt: new Date(row.detected_at as string),
    resolvedAt: row.resolved_at ? new Date(row.resolved_at as string) : null,
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function computeDriftPct(baseline: number, current: number): number {
  if (baseline === 0) return current === 0 ? 0 : 1.0
  return Math.abs(current - baseline) / baseline
}

export function computeDriftDirection(baseline: number, current: number): 'increasing' | 'decreasing' {
  return current >= baseline ? 'increasing' : 'decreasing'
}

export function isDriftAlert(driftPct: number): boolean {
  return driftPct > TELEMETRY_DRIFT_ALERT_THRESHOLD
}

export function classifyDriftSeverity(driftPct: number): 'none' | 'minor' | 'moderate' | 'severe' {
  if (driftPct <= 0.05) return 'none'
  if (driftPct <= 0.15) return 'minor'
  if (driftPct <= 0.35) return 'moderate'
  return 'severe'
}

// ─── Service ─────────────────────────────────────────────────────────────────

export async function recordTelemetryDrift(
  metricName: string,
  baselineValue: number,
  currentValue: number,
): Promise<TelemetryDrift> {
  const driftPct = computeDriftPct(baselineValue, currentValue)
  const direction = computeDriftDirection(baselineValue, currentValue)
  const isAlert = isDriftAlert(driftPct)

  const result = await pool.query(
    `INSERT INTO p12_telemetry_drift
       (metric_name, baseline_value, current_value, drift_pct, direction, is_alert, detected_at)
     VALUES ($1,$2,$3,$4,$5,$6,NOW())
     RETURNING *`,
    [metricName, baselineValue, currentValue, driftPct, direction, isAlert],
  )
  return _mapTelemetryDrift(result.rows[0])
}

export async function getActiveDrifts(): Promise<TelemetryDrift[]> {
  const result = await pool.query(
    `SELECT * FROM p12_telemetry_drift
     WHERE resolved_at IS NULL
     ORDER BY drift_pct DESC`,
  )
  return result.rows.map(_mapTelemetryDrift)
}

export async function getAlertingDrifts(): Promise<TelemetryDrift[]> {
  const result = await pool.query(
    `SELECT * FROM p12_telemetry_drift
     WHERE is_alert = TRUE AND resolved_at IS NULL
     ORDER BY drift_pct DESC`,
  )
  return result.rows.map(_mapTelemetryDrift)
}

export async function resolveDrift(driftId: string): Promise<TelemetryDrift> {
  const result = await pool.query(
    `UPDATE p12_telemetry_drift
     SET resolved_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [driftId],
  )
  if (!result.rows[0]) throw new Error(`TelemetryDrift ${driftId} not found`)
  return _mapTelemetryDrift(result.rows[0])
}

export async function getDriftHistory(metricName: string, limit = 30): Promise<TelemetryDrift[]> {
  const result = await pool.query(
    `SELECT * FROM p12_telemetry_drift
     WHERE metric_name = $1
     ORDER BY detected_at DESC
     LIMIT $2`,
    [metricName, limit],
  )
  return result.rows.map(_mapTelemetryDrift)
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  computeDriftPct,
  computeDriftDirection,
  isDriftAlert,
  classifyDriftSeverity,
  _mapTelemetryDrift,
}
