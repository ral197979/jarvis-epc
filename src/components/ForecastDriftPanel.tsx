// Denver Engineering — Forecast Drift Panel (v7.0.0)
// Displays live calibration status and allows manual calibration requests.

import React, { useState, useEffect } from 'react'

interface CalibrationResult {
  forecastType: string
  entityId?: string
  horizon: number
  originalPrediction: number
  calibratedPrediction: number
  calibrationFactor: number
  adjustmentExplained: string
}

interface DriftSummary {
  forecastType: string
  horizon: number
  driftSeverity: string
  calibrationFactor: number
  sampleCount: number
  recommendation: string
}

const FORECAST_TYPES = ['readiness', 'risk', 'workload', 'sla', 'maintenance']

const SEVERITY_BAR: Record<string, string> = {
  none: 'bg-emerald-500',
  minor: 'bg-yellow-500',
  moderate: 'bg-amber-500',
  significant: 'bg-orange-500',
  critical: 'bg-red-500',
}

export function ForecastDriftPanel() {
  const [driftData, setDriftData] = useState<Record<string, DriftSummary[]>>({})
  const [calibForm, setCalibForm] = useState({
    forecastType: 'readiness',
    predictedValue: 70,
    horizon: 30,
  })
  const [calibResult, setCalibResult] = useState<CalibrationResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [driftLoading, setDriftLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDriftLoading(true)
    Promise.all(
      FORECAST_TYPES.map(t =>
        fetch(`/api/v1/adaptive/calibrate/drift/${t}`).then(r => r.json()).then(d => [t, d]),
      ),
    )
      .then(pairs => {
        const result: Record<string, DriftSummary[]> = {}
        for (const [t, d] of pairs) {
          result[t as string] = Array.isArray(d) ? d : []
        }
        setDriftData(result)
      })
      .catch(e => setError(e.message))
      .finally(() => setDriftLoading(false))
  }, [])

  const calibrate = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/v1/adaptive/calibrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(calibForm),
      })
      setCalibResult(await res.json())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const worstDrift = Object.values(driftData)
    .flat()
    .sort((a, b) => {
      const order: Record<string, number> = { critical: 4, significant: 3, moderate: 2, minor: 1, none: 0 }
      return (order[b.driftSeverity] ?? 0) - (order[a.driftSeverity] ?? 0)
    })
    .slice(0, 5)

  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 space-y-5">
      <h2 className="text-lg font-semibold text-zinc-100">Forecast Drift & Calibration</h2>

      {error != null && <p className="text-red-400 text-sm border border-red-800 rounded p-3">{error}</p>}

      {/* Drift overview */}
      {driftLoading ? (
        <p className="text-zinc-500 text-sm">Loading drift data...</p>
      ) : worstDrift.length === 0 ? (
        <p className="text-xs text-zinc-500">No drift detected — insufficient history across all types</p>
      ) : (
        <div className="space-y-2">
          <p className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Top Drift Signals</p>
          {worstDrift.map((d, i) => (
            <div key={i} className="bg-zinc-800 rounded-lg p-3 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-sm text-zinc-200 capitalize">{d.forecastType} ({d.horizon}d)</span>
                <span className="text-xs capitalize text-zinc-400">{d.driftSeverity}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-zinc-700 rounded-full h-1 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${SEVERITY_BAR[d.driftSeverity] ?? 'bg-zinc-500'}`}
                    style={{ width: `${d.sampleCount > 0 ? Math.min(100, d.sampleCount * 5) : 0}%` }}
                  />
                </div>
                <span className="text-xs text-zinc-500 w-16 text-right">×{d.calibrationFactor.toFixed(3)}</span>
              </div>
              <p className="text-xs text-zinc-500">{d.recommendation}</p>
            </div>
          ))}
        </div>
      )}

      {/* Manual calibration */}
      <div className="border-t border-zinc-800 pt-4 space-y-3">
        <p className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Test Calibration</p>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="text-xs text-zinc-500">Type</label>
            <select
              value={calibForm.forecastType}
              onChange={e => setCalibForm(p => ({ ...p, forecastType: e.target.value }))}
              className="w-full mt-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200"
            >
              {FORECAST_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-zinc-500">Predicted Value</label>
            <input
              type="number"
              value={calibForm.predictedValue}
              onChange={e => setCalibForm(p => ({ ...p, predictedValue: Number(e.target.value) }))}
              className="w-full mt-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200"
              min={0} max={100}
            />
          </div>
          <div>
            <label className="text-xs text-zinc-500">Horizon (days)</label>
            <select
              value={calibForm.horizon}
              onChange={e => setCalibForm(p => ({ ...p, horizon: Number(e.target.value) }))}
              className="w-full mt-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200"
            >
              {[7, 14, 30, 60, 90].map(h => <option key={h} value={h}>{h}d</option>)}
            </select>
          </div>
        </div>
        <button
          onClick={calibrate}
          disabled={loading}
          className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-xs rounded px-4 py-2 transition-colors"
        >
          {loading ? 'Calibrating...' : 'Run Calibration'}
        </button>

        {calibResult != null && (
          <div className="bg-zinc-800 rounded-lg p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-zinc-400">Original</span>
              <span className="text-lg font-bold text-zinc-200">{calibResult.originalPrediction.toFixed(1)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-zinc-400">Calibrated</span>
              <span className={`text-lg font-bold ${
                calibResult.calibratedPrediction > calibResult.originalPrediction
                  ? 'text-emerald-400' : calibResult.calibratedPrediction < calibResult.originalPrediction
                  ? 'text-amber-400' : 'text-zinc-200'
              }`}>{calibResult.calibratedPrediction.toFixed(1)}</span>
            </div>
            <div className="flex items-center justify-between text-xs text-zinc-500">
              <span>Factor: ×{calibResult.calibrationFactor.toFixed(3)}</span>
            </div>
            <p className="text-xs text-zinc-400 italic">{calibResult.adjustmentExplained}</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default ForecastDriftPanel
