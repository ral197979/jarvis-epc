// Denver Engineering — Forecast Accuracy Tracker (v7.0.0)
// Records predicted vs actual values to enable continuous forecast calibration.

import { tenantQuery } from '../../db/pool'
import {
  ForecastAccuracyRecord, RecordForecastInput,
  ForecastAccuracyStats, ForecastType, DriftSeverity,
} from './adaptiveTypes'

// ─── Record prediction ────────────────────────────────────────────────────────

export async function recordPrediction(
  tenantId: string,
  input: RecordForecastInput,
): Promise<ForecastAccuracyRecord> {
  const {
    forecastType, entityId, entityType, forecastHorizon,
    predictedValue, predictedAt, confidence, metadata = {},
  } = input

  const res = await tenantQuery(
    tenantId,
    `INSERT INTO forecast_accuracy_history
      (tenant_id, forecast_type, entity_id, entity_type,
       forecast_horizon, predicted_value, predicted_at, confidence, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [
      tenantId, forecastType,
      entityId ?? null, entityType ?? null,
      forecastHorizon, predictedValue,
      predictedAt ?? new Date(),
      confidence ?? null,
      JSON.stringify(metadata),
    ],
  )
  return _mapRecord(res.rows[0])
}

// ─── Record actual (measure accuracy) ────────────────────────────────────────

export async function recordActual(
  tenantId: string,
  forecastId: string,
  actualValue: number,
): Promise<ForecastAccuracyRecord> {
  // fetch predicted value to compute errors
  const existing = await tenantQuery(
    tenantId,
    `SELECT * FROM forecast_accuracy_history WHERE tenant_id = $1 AND id = $2`,
    [tenantId, forecastId],
  )
  if (existing.rows.length === 0) throw new Error(`Forecast ${forecastId} not found`)

  const predicted = Number(existing.rows[0].predicted_value)
  const absErr = Math.abs(predicted - actualValue)
  const sqErr = Math.pow(predicted - actualValue, 2)
  const drift = _classifyDrift(absErr, predicted)

  const res = await tenantQuery(
    tenantId,
    `UPDATE forecast_accuracy_history
     SET actual_value = $2,
         measured_at = now(),
         absolute_error = $3,
         squared_error = $4,
         drift_severity = $5
     WHERE tenant_id = $1 AND id = $6
     RETURNING *`,
    [tenantId, actualValue, absErr, sqErr, drift, forecastId],
  )
  return _mapRecord(res.rows[0])
}

// ─── Get accuracy stats ───────────────────────────────────────────────────────

export async function getAccuracyStats(
  tenantId: string,
  forecastType: ForecastType,
  horizon?: number,
  windowDays = 90,
): Promise<ForecastAccuracyStats> {
  const params: unknown[] = [tenantId, forecastType, windowDays]
  let horizonClause = ''
  if (horizon != null) { params.push(horizon); horizonClause = `AND forecast_horizon = $${params.length}` }

  const res = await tenantQuery(
    tenantId,
    `SELECT
       forecast_horizon,
       COUNT(*)::int AS sample_count,
       COALESCE(AVG(absolute_error), 0)::float AS mae,
       COALESCE(SQRT(AVG(squared_error)), 0)::float AS rmse,
       COALESCE(AVG(predicted_value - actual_value), 0)::float AS mean_bias,
       COALESCE(AVG(confidence), 0.5)::float AS avg_confidence,
       MAX(measured_at) AS last_measured
     FROM forecast_accuracy_history
     WHERE tenant_id = $1
       AND forecast_type = $2
       AND measured_at IS NOT NULL
       AND created_at >= now() - ($3 || ' days')::interval
       ${horizonClause}
     GROUP BY forecast_horizon
     ORDER BY forecast_horizon`,
    params,
  )

  // Aggregate across all horizons if no specific horizon requested
  const rows = res.rows
  if (rows.length === 0) {
    return _defaultStats(forecastType, horizon ?? 30)
  }

  const sampleCount = rows.reduce((s, r) => s + Number(r.sample_count), 0)
  const mae = rows.reduce((s, r) => s + Number(r.mae) * Number(r.sample_count), 0) / sampleCount
  const rmse = rows.reduce((s, r) => s + Number(r.rmse) * Number(r.sample_count), 0) / sampleCount
  const meanBias = rows.reduce((s, r) => s + Number(r.mean_bias) * Number(r.sample_count), 0) / sampleCount
  const driftSeverity = _classifyDrift(mae, 50)
  const calibrationFactor = Math.abs(meanBias) < 1 ? 1.0 : _computeCalibrationFactor(meanBias)

  return {
    forecastType,
    horizon: horizon ?? (rows[0] != null ? Number(rows[0].forecast_horizon) : 30),
    sampleCount,
    meanAbsoluteError: mae,
    rootMeanSquaredError: rmse,
    meanBias,
    driftSeverity,
    calibrationFactor,
    lastUpdated: new Date(rows[rows.length - 1]!.last_measured ?? new Date()),
  }
}

// ─── List records ─────────────────────────────────────────────────────────────

export async function listAccuracyRecords(
  tenantId: string,
  opts: {
    forecastType?: ForecastType
    entityId?: string
    windowDays?: number
    limit?: number
    unmeasuredOnly?: boolean
  } = {},
): Promise<ForecastAccuracyRecord[]> {
  const { forecastType, entityId, windowDays = 90, limit = 100, unmeasuredOnly = false } = opts
  const params: unknown[] = [tenantId, windowDays]
  const clauses = [
    'tenant_id = $1',
    `created_at >= now() - ($2 || ' days')::interval`,
  ]

  if (forecastType != null) { params.push(forecastType); clauses.push(`forecast_type = $${params.length}`) }
  if (entityId != null)     { params.push(entityId);     clauses.push(`entity_id = $${params.length}`) }
  if (unmeasuredOnly)       { clauses.push('actual_value IS NULL') }

  params.push(limit)
  const res = await tenantQuery(
    tenantId,
    `SELECT * FROM forecast_accuracy_history
     WHERE ${clauses.join(' AND ')}
     ORDER BY predicted_at DESC
     LIMIT $${params.length}`,
    params,
  )
  return res.rows.map(_mapRecord)
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function _classifyDrift(absError: number, baseline: number): DriftSeverity {
  const pct = baseline > 0 ? absError / baseline : 0
  if (pct < 0.05) return 'none'
  if (pct < 0.15) return 'minor'
  if (pct < 0.30) return 'moderate'
  if (pct < 0.45) return 'significant'
  return 'critical'
}

function _computeCalibrationFactor(meanBias: number): number {
  // If systematically over-predicting (positive bias), reduce future predictions
  // Factor stays within [0.7, 1.3]
  const adjustment = meanBias / 100
  return Math.max(0.7, Math.min(1.3, 1 - adjustment * 0.5))
}

function _defaultStats(forecastType: ForecastType, horizon: number): ForecastAccuracyStats {
  return {
    forecastType,
    horizon,
    sampleCount: 0,
    meanAbsoluteError: 0,
    rootMeanSquaredError: 0,
    meanBias: 0,
    driftSeverity: 'none',
    calibrationFactor: 1.0,
    lastUpdated: new Date(),
  }
}

// ─── Mapper ───────────────────────────────────────────────────────────────────

function _mapRecord(row: Record<string, unknown>): ForecastAccuracyRecord {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    forecastType: row.forecast_type as ForecastType,
    entityId: row.entity_id != null ? String(row.entity_id) : undefined,
    entityType: row.entity_type != null ? String(row.entity_type) : undefined,
    forecastHorizon: Number(row.forecast_horizon),
    predictedValue: Number(row.predicted_value),
    actualValue: row.actual_value != null ? Number(row.actual_value) : undefined,
    predictedAt: new Date(row.predicted_at as string),
    measuredAt: row.measured_at != null ? new Date(row.measured_at as string) : undefined,
    absoluteError: row.absolute_error != null ? Number(row.absolute_error) : undefined,
    squaredError: row.squared_error != null ? Number(row.squared_error) : undefined,
    confidence: row.confidence != null ? Number(row.confidence) : undefined,
    driftSeverity: row.drift_severity as DriftSeverity,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: new Date(row.created_at as string),
  }
}

export const __testHooks = { _mapRecord, _classifyDrift, _computeCalibrationFactor }
