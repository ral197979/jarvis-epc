// Denver Engineering — Drift Analysis Panel (v7.0.0)
// Visualizes forecast prediction drift over time for each forecast type.

import React, { useState, useEffect } from 'react'

interface AccuracyRecord {
  id: string
  forecastType: string
  forecastHorizon: number
  predictedValue: number
  actualValue?: number
  absoluteError?: number
  driftSeverity: string
  predictedAt: string
  measuredAt?: string
}

const FORECAST_TYPES = ['readiness', 'risk', 'workload', 'sla', 'maintenance'] as const

const SEVERITY_DOT: Record<string, string> = {
  none: 'bg-emerald-400',
  minor: 'bg-yellow-400',
  moderate: 'bg-amber-400',
  significant: 'bg-orange-400',
  critical: 'bg-red-400',
}

function MiniDriftChart({ records }: { records: AccuracyRecord[] }) {
  const measured = records.filter(r => r.absoluteError != null)
  if (measured.length < 2) {
    return <p className="text-xs text-zinc-500">Insufficient data to plot drift</p>
  }

  const errors = measured.map(r => r.absoluteError!)
  const maxErr = Math.max(...errors, 1)
  const W = 320
  const H = 60
  const pts = measured.map((r, i) => {
    const x = (i / (measured.length - 1)) * W
    const y = H - (r.absoluteError! / maxErr) * H
    return `${x},${y}`
  })

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 60 }}>
      <polyline
        points={pts.join(' ')}
        fill="none"
        stroke="#a78bfa"
        strokeWidth="1.5"
      />
      {measured.map((r, i) => {
        const x = (i / (measured.length - 1)) * W
        const y = H - (r.absoluteError! / maxErr) * H
        return (
          <circle
            key={i}
            cx={x} cy={y} r={3}
            className={`${SEVERITY_DOT[r.driftSeverity] ?? 'fill-zinc-400'} stroke-zinc-900 stroke-1`}
          />
        )
      })}
    </svg>
  )
}

export function DriftAnalysisPanel() {
  const [selectedType, setSelectedType] = useState<string>('readiness')
  const [records, setRecords] = useState<AccuracyRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showUnmeasured, setShowUnmeasured] = useState(false)

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({
      forecastType: selectedType,
      windowDays: '90',
      limit: '50',
      ...(showUnmeasured ? { unmeasuredOnly: 'true' } : {}),
    })
    fetch(`/api/v1/adaptive/forecast-accuracy?${params}`)
      .then(r => r.json())
      .then(data => setRecords(Array.isArray(data) ? data : []))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [selectedType, showUnmeasured])

  const measured = records.filter(r => r.absoluteError != null)
  const unmeasured = records.filter(r => r.absoluteError == null)

  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-zinc-100">Drift Analysis</h2>
        <label className="flex items-center gap-2 text-xs text-zinc-400">
          <input
            type="checkbox"
            checked={showUnmeasured}
            onChange={e => setShowUnmeasured(e.target.checked)}
            className="accent-violet-600"
          />
          Show unmeasured only
        </label>
      </div>

      <div className="flex gap-2 flex-wrap">
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

      {loading && <p className="text-zinc-500 text-sm">Loading drift data...</p>}
      {error && <p className="text-red-400 text-sm border border-red-800 rounded p-3">{error}</p>}

      {!loading && measured.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-zinc-400 font-medium uppercase tracking-wide">Error over time</p>
          <MiniDriftChart records={records} />
          <div className="flex gap-3 text-xs text-zinc-500">
            {Object.entries(SEVERITY_DOT).map(([k, cls]) => (
              <span key={k} className="flex items-center gap-1">
                <span className={`inline-block w-2 h-2 rounded-full ${cls}`} />
                {k}
              </span>
            ))}
          </div>
        </div>
      )}

      {!loading && (
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {records.length === 0 && (
            <p className="text-center text-zinc-500 py-6">No forecast accuracy records found</p>
          )}
          {records.slice(0, 20).map(r => (
            <div key={r.id} className="bg-zinc-800 rounded-lg p-3 flex items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 mb-0.5">
                  <span className={`w-2 h-2 rounded-full ${SEVERITY_DOT[r.driftSeverity] ?? 'bg-zinc-500'}`} />
                  <span className="text-xs text-zinc-300">{r.forecastHorizon}d horizon</span>
                </div>
                <p className="text-xs text-zinc-500">
                  {new Date(r.predictedAt).toLocaleDateString()}
                  {r.measuredAt != null && ` → measured ${new Date(r.measuredAt).toLocaleDateString()}`}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm font-mono text-zinc-200">
                  {r.predictedValue.toFixed(1)}
                  {r.actualValue != null && <span className="text-zinc-500"> → {r.actualValue.toFixed(1)}</span>}
                </p>
                {r.absoluteError != null && (
                  <p className="text-xs text-amber-400">±{r.absoluteError.toFixed(1)}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && (
        <div className="flex gap-4 text-xs text-zinc-500">
          <span>{measured.length} measured</span>
          <span>{unmeasured.length} pending measurement</span>
        </div>
      )}
    </div>
  )
}

export default DriftAnalysisPanel
