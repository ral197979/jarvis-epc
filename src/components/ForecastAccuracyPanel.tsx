// Denver Engineering — Forecast Accuracy Panel (v7.0.0)
// Displays forecast accuracy metrics and drift status per forecast type.

import React, { useState, useEffect } from 'react'

interface AccuracyStats {
  forecastType: string
  horizon: number
  sampleCount: number
  meanAbsoluteError: number
  rootMeanSquaredError: number
  meanBias: number
  driftSeverity: string
  calibrationFactor: number
  lastUpdated: string
}

interface DriftSummary {
  forecastType: string
  horizon: number
  driftSeverity: string
  calibrationFactor: number
  sampleCount: number
  recommendation: string
}

const FORECAST_TYPES = ['readiness', 'risk', 'workload', 'sla', 'maintenance'] as const
type ForecastType = typeof FORECAST_TYPES[number]

const DRIFT_COLOR: Record<string, string> = {
  none: 'text-emerald-400',
  minor: 'text-yellow-400',
  moderate: 'text-amber-400',
  significant: 'text-orange-400',
  critical: 'text-red-400',
}

const DRIFT_BG: Record<string, string> = {
  none: 'bg-emerald-900/30 border-emerald-700',
  minor: 'bg-yellow-900/30 border-yellow-700',
  moderate: 'bg-amber-900/30 border-amber-700',
  significant: 'bg-orange-900/30 border-orange-700',
  critical: 'bg-red-900/30 border-red-700',
}

export function ForecastAccuracyPanel() {
  const [selectedType, setSelectedType] = useState<ForecastType>('readiness')
  const [stats, setStats] = useState<AccuracyStats | null>(null)
  const [driftSummary, setDriftSummary] = useState<DriftSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)

    Promise.all([
      fetch(`/api/v1/adaptive/forecast-accuracy/stats/${selectedType}`).then(r => r.json()),
      fetch(`/api/v1/adaptive/calibrate/drift/${selectedType}`).then(r => r.json()),
    ])
      .then(([statsData, driftData]) => {
        setStats(statsData)
        setDriftSummary(Array.isArray(driftData) ? driftData : [])
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [selectedType])

  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-zinc-100">Forecast Accuracy</h2>
        <div className="flex gap-2">
          {FORECAST_TYPES.map(t => (
            <button
              key={t}
              onClick={() => setSelectedType(t)}
              className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                selectedType === t
                  ? 'bg-violet-600 border-violet-500 text-white'
                  : 'border-zinc-600 text-zinc-400 hover:border-zinc-500'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {loading && <p className="text-zinc-500 text-sm">Loading accuracy data...</p>}
      {error && <p className="text-red-400 text-sm border border-red-800 rounded p-3">{error}</p>}

      {!loading && stats != null && (
        <div className="grid grid-cols-3 gap-4">
          <MetricCard label="Mean Absolute Error" value={stats.meanAbsoluteError.toFixed(2)} unit="pts" />
          <MetricCard label="RMSE" value={stats.rootMeanSquaredError.toFixed(2)} unit="pts" />
          <MetricCard
            label="Bias"
            value={(stats.meanBias > 0 ? '+' : '') + stats.meanBias.toFixed(2)}
            unit="pts"
            note={stats.meanBias > 2 ? 'over-predicting' : stats.meanBias < -2 ? 'under-predicting' : 'neutral'}
          />
          <MetricCard label="Samples" value={String(stats.sampleCount)} />
          <MetricCard
            label="Calibration Factor"
            value={stats.calibrationFactor.toFixed(3)}
            note={stats.calibrationFactor === 1.0 ? 'no adjustment' : 'applied'}
          />
          <div className={`rounded-lg border p-3 ${DRIFT_BG[stats.driftSeverity] ?? DRIFT_BG.none}`}>
            <p className="text-xs text-zinc-400 mb-1">Drift Severity</p>
            <p className={`text-lg font-bold capitalize ${DRIFT_COLOR[stats.driftSeverity] ?? 'text-zinc-300'}`}>
              {stats.driftSeverity}
            </p>
          </div>
        </div>
      )}

      {!loading && driftSummary.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Drift by Horizon</p>
          {driftSummary.map((d, i) => (
            <div key={i} className="flex items-start justify-between bg-zinc-800 rounded-lg p-3 gap-3">
              <div>
                <span className="text-xs text-zinc-400">{d.horizon}d horizon</span>
                <p className="text-xs text-zinc-300 mt-0.5">{d.recommendation}</p>
              </div>
              <span className={`text-xs font-semibold capitalize shrink-0 ${DRIFT_COLOR[d.driftSeverity] ?? 'text-zinc-400'}`}>
                {d.driftSeverity}
              </span>
            </div>
          ))}
        </div>
      )}

      {!loading && stats != null && (
        <p className="text-xs text-zinc-500">
          Last updated: {new Date(stats.lastUpdated).toLocaleString()}
        </p>
      )}
    </div>
  )
}

function MetricCard({
  label, value, unit, note,
}: { label: string; value: string; unit?: string; note?: string }) {
  return (
    <div className="bg-zinc-800 rounded-lg p-3">
      <p className="text-xs text-zinc-400 mb-1">{label}</p>
      <p className="text-xl font-bold text-zinc-100">
        {value}
        {unit != null && <span className="text-sm font-normal text-zinc-400 ml-1">{unit}</span>}
      </p>
      {note != null && <p className="text-xs text-zinc-500 mt-0.5">{note}</p>}
    </div>
  )
}

export default ForecastAccuracyPanel
