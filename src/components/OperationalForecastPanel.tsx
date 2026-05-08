// Denver Engineering — Operational Forecast Panel (v6.0.0)
// Shows readiness and SLA forecast projections with confidence bands.

import React, { useEffect, useState, useCallback } from 'react'

interface TimeSeriesPoint {
  ts: string
  value: number
  lowerBound?: number
  upperBound?: number
}

interface TemporalProjection {
  twinId: string
  horizonDays: number
  projectedReadiness: TimeSeriesPoint[]
  projectedSlaBreachProbability: number
  confidence: number
  explanation: string
  computedAt: string
}

interface OperationalForecast {
  id: string
  forecastType: string
  scopeType: string
  scopeId: string
  horizonDays: number
  projections: Record<string, unknown>
  confidence?: number
  computedAt: string
  validUntil: string
}

function MiniChart({ points, color }: { points: TimeSeriesPoint[]; color: string }) {
  if (points.length === 0) return (
    <div className="h-16 flex items-center justify-center text-xs text-zinc-500">No data</div>
  )
  const values = points.map(p => p.value)
  const min = Math.min(...values, 0)
  const max = Math.max(...values, 100)
  const range = max - min || 1

  const w = 300
  const h = 60
  const pts = points.map((p, i) => ({
    x: (i / Math.max(1, points.length - 1)) * w,
    y: h - ((p.value - min) / range) * h,
  }))

  const pathD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')

  const lowers = points.map((p, i) => ({
    x: (i / Math.max(1, points.length - 1)) * w,
    y: h - (((p.lowerBound ?? p.value) - min) / range) * h,
  }))
  const uppers = points.map((p, i) => ({
    x: (i / Math.max(1, points.length - 1)) * w,
    y: h - (((p.upperBound ?? p.value) - min) / range) * h,
  }))

  const bandD = [
    ...uppers.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`),
    ...lowers.slice().reverse().map((p, i) => `${i === 0 ? 'L' : 'L'} ${p.x} ${p.y}`),
    'Z',
  ].join(' ')

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-16 overflow-visible">
      <path d={bandD} fill={color} fillOpacity="0.15" />
      <path d={pathD} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

export default function OperationalForecastPanel({ twinId, scopeType = 'project', scopeId }: {
  twinId?: string
  scopeType?: string
  scopeId?: string
}) {
  const [projection, setProjection] = useState<TemporalProjection | null>(null)
  const [forecast, setForecast] = useState<OperationalForecast | null>(null)
  const [loading, setLoading] = useState(false)
  const [horizonDays, setHorizonDays] = useState(30)

  const load = useCallback(() => {
    setLoading(true)
    const reqs: Promise<unknown>[] = []

    if (twinId) {
      reqs.push(
        fetch(`/api/v1/scenarios/projection/${twinId}?horizonDays=${horizonDays}`)
          .then(r => r.json())
          .then(setProjection)
          .catch(() => null)
      )
    }

    if (scopeId) {
      reqs.push(
        fetch(`/api/v1/portfolio/forecast?forecastType=readiness&scopeType=${scopeType}&scopeId=${scopeId}&horizonDays=${horizonDays}`)
          .then(r => r.json())
          .then(setForecast)
          .catch(() => null)
      )
    }

    Promise.all(reqs).finally(() => setLoading(false))
  }, [twinId, scopeId, scopeType, horizonDays])

  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <label className="text-xs text-zinc-400">Horizon</label>
        <select
          value={horizonDays}
          onChange={e => setHorizonDays(Number(e.target.value))}
          className="bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1 text-xs text-white"
        >
          {[7, 14, 30, 60, 90].map(d => (
            <option key={d} value={d}>{d}d</option>
          ))}
        </select>
        <button
          onClick={load}
          disabled={loading}
          className="px-3 py-1 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-xs text-white transition-colors"
        >
          {loading ? '…' : 'Refresh'}
        </button>
      </div>

      {projection && (
        <div className="rounded-lg border border-zinc-700 bg-zinc-800/60 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-zinc-300">Readiness Projection ({horizonDays}d)</span>
            <span className="text-xs text-zinc-500">confidence {(projection.confidence * 100).toFixed(0)}%</span>
          </div>
          <MiniChart points={projection.projectedReadiness} color="#8b5cf6" />
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="flex justify-between">
              <span className="text-zinc-400">SLA breach prob</span>
              <span className={projection.projectedSlaBreachProbability > 0.5 ? 'text-red-400' : 'text-emerald-400'}>
                {(projection.projectedSlaBreachProbability * 100).toFixed(0)}%
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">Final readiness</span>
              <span className="text-white font-mono">
                {projection.projectedReadiness[projection.projectedReadiness.length - 1]?.value.toFixed(1) ?? '—'}%
              </span>
            </div>
          </div>
          <p className="text-[10px] text-zinc-500 italic leading-relaxed">{projection.explanation}</p>
        </div>
      )}

      {forecast && (
        <div className="rounded-lg border border-zinc-700 bg-zinc-800/60 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-zinc-300">Forecast Cache</span>
            <span className={`text-xs px-2 py-0.5 rounded ${
              new Date(forecast.validUntil) > new Date()
                ? 'bg-emerald-500/20 text-emerald-400'
                : 'bg-red-500/20 text-red-400'
            }`}>
              {new Date(forecast.validUntil) > new Date() ? 'valid' : 'stale'}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="flex justify-between">
              <span className="text-zinc-400">Type</span>
              <span className="text-zinc-300">{forecast.forecastType}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">Confidence</span>
              <span className="text-zinc-300">{forecast.confidence != null ? `${(forecast.confidence * 100).toFixed(0)}%` : '—'}</span>
            </div>
            <div className="flex justify-between col-span-2">
              <span className="text-zinc-400">Computed</span>
              <span className="text-zinc-300">{new Date(forecast.computedAt).toLocaleString()}</span>
            </div>
          </div>
        </div>
      )}

      {!projection && !forecast && !loading && (
        <div className="text-sm text-zinc-500 text-center py-6">
          Configure a twinId or scopeId to see forecasts
        </div>
      )}
    </div>
  )
}
