// Denver Engineering — Forecast Calibration Engine (v7.0.0)
// Applies learned accuracy corrections to raw forecast predictions.

import { getAccuracyStats } from './forecastAccuracyTracker'
import { CalibrationResult, ForecastType } from './adaptiveTypes'

// ─── Calibrate a single prediction ───────────────────────────────────────────

export async function calibratePrediction(
  tenantId: string,
  forecastType: ForecastType,
  predictedValue: number,
  horizon: number,
  entityId?: string,
): Promise<CalibrationResult> {
  // Try entity-specific stats first, fall back to type-level
  let stats = entityId != null
    ? await getAccuracyStats(tenantId, forecastType, horizon, 90)
    : await getAccuracyStats(tenantId, forecastType, horizon, 90)

  // Only calibrate when we have enough data
  if (stats.sampleCount < 5) {
    return {
      forecastType,
      entityId,
      horizon,
      originalPrediction: predictedValue,
      calibratedPrediction: predictedValue,
      calibrationFactor: 1.0,
      adjustmentExplained: 'Insufficient history — no calibration applied',
    }
  }

  const calibrated = Math.max(0, Math.min(100, predictedValue * stats.calibrationFactor))
  const adjustmentPct = Math.round((stats.calibrationFactor - 1) * 100)
  const direction = adjustmentPct > 0 ? 'upward' : 'downward'

  return {
    forecastType,
    entityId,
    horizon,
    originalPrediction: predictedValue,
    calibratedPrediction: Math.round(calibrated * 10) / 10,
    calibrationFactor: stats.calibrationFactor,
    adjustmentExplained:
      stats.calibrationFactor === 1.0
        ? 'No systematic bias detected — prediction unchanged'
        : `${Math.abs(adjustmentPct)}% ${direction} adjustment based on ${stats.sampleCount} historical observations (MAE: ${stats.meanAbsoluteError.toFixed(1)})`,
  }
}

// ─── Batch calibrate multiple forecasts ──────────────────────────────────────

export async function calibrateBatch(
  tenantId: string,
  forecasts: Array<{
    forecastType: ForecastType
    predictedValue: number
    horizon: number
    entityId?: string
  }>,
): Promise<CalibrationResult[]> {
  return Promise.all(
    forecasts.map(f =>
      calibratePrediction(tenantId, f.forecastType, f.predictedValue, f.horizon, f.entityId),
    ),
  )
}

// ─── Drift summary ────────────────────────────────────────────────────────────

export interface DriftSummary {
  forecastType: ForecastType
  horizon: number
  driftSeverity: string
  calibrationFactor: number
  sampleCount: number
  recommendation: string
}

export async function getDriftSummary(
  tenantId: string,
  forecastType: ForecastType,
): Promise<DriftSummary[]> {
  const horizons = [7, 14, 30, 60, 90]
  const results = await Promise.all(
    horizons.map(h => getAccuracyStats(tenantId, forecastType, h, 90)),
  )

  return results
    .filter(s => s.sampleCount > 0)
    .map(s => ({
      forecastType: s.forecastType,
      horizon: s.horizon,
      driftSeverity: s.driftSeverity,
      calibrationFactor: s.calibrationFactor,
      sampleCount: s.sampleCount,
      recommendation: _driftRecommendation(s.driftSeverity, s.meanBias),
    }))
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function _driftRecommendation(severity: string, bias: number): string {
  if (severity === 'none')        return 'Forecast model performing well — no action needed'
  if (severity === 'minor')       return 'Minor drift detected — monitor for trend'
  if (bias > 0)                   return `Systematic over-prediction by ${bias.toFixed(1)} points — reduce confidence weights`
  if (bias < 0)                   return `Systematic under-prediction by ${Math.abs(bias).toFixed(1)} points — increase baseline estimates`
  if (severity === 'significant') return 'Significant drift — consider retraining forecast model'
  return 'Critical drift — forecast accuracy severely degraded, manual review required'
}

export const __testHooks = { _driftRecommendation }
