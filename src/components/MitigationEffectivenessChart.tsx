// Denver Engineering — Mitigation Effectiveness Chart (v7.0.0)
// Shows simulation mitigation predictions vs actuals and their effectiveness.

import React, { useState, useEffect } from 'react'

interface SimulationOutcome {
  scenarioId: string
  predictedDelta: number
  actualDelta?: number
  predictionError?: number
  mitigationsApplied: string[]
  effectivenessScore?: number
  recordedAt: string
}

interface ScenarioStats {
  totalSimulations: number
  measuredSimulations: number
  meanPredictionError: number
  accurateCount: number
  inaccurateCount: number
  accuracyRate: number
}

function DeltaBar({ predicted, actual }: { predicted: number; actual?: number }) {
  const absMax = 50
  const predPct = Math.max(0, Math.min(100, ((predicted + absMax) / (2 * absMax)) * 100))
  const actualPct = actual != null ? Math.max(0, Math.min(100, ((actual + absMax) / (2 * absMax)) * 100)) : null

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-xs text-zinc-500">
        <span className="w-16">Predicted</span>
        <div className="flex-1 bg-zinc-700 rounded-full h-1.5 overflow-hidden">
          <div className="h-full bg-violet-500 rounded-full" style={{ width: `${predPct}%` }} />
        </div>
        <span className={`w-12 text-right font-mono ${predicted < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
          {predicted > 0 ? '+' : ''}{predicted.toFixed(1)}
        </span>
      </div>
      {actualPct != null && actual != null && (
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <span className="w-16">Actual</span>
          <div className="flex-1 bg-zinc-700 rounded-full h-1.5 overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full" style={{ width: `${actualPct}%` }} />
          </div>
          <span className={`w-12 text-right font-mono ${actual < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
            {actual > 0 ? '+' : ''}{actual.toFixed(1)}
          </span>
        </div>
      )}
    </div>
  )
}

export function MitigationEffectivenessChart() {
  const [outcomes, setOutcomes] = useState<SimulationOutcome[]>([])
  const [stats, setStats] = useState<ScenarioStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      fetch('/api/v1/adaptive/simulation-outcomes').then(r => r.json()),
      fetch('/api/v1/adaptive/simulation-outcomes/stats').then(r => r.json()),
    ])
      .then(([outcomeData, statsData]) => {
        setOutcomes(Array.isArray(outcomeData) ? outcomeData : [])
        setStats(statsData)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const selected = outcomes.find(o => o.scenarioId === selectedId)

  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 space-y-5">
      <h2 className="text-lg font-semibold text-zinc-100">Mitigation Effectiveness</h2>

      {loading && <p className="text-zinc-500 text-sm">Loading simulation outcomes...</p>}
      {error && <p className="text-red-400 text-sm border border-red-800 rounded p-3">{error}</p>}

      {!loading && stats != null && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-zinc-800 rounded-lg p-3 text-center">
            <p className="text-xl font-bold text-zinc-100">{stats.totalSimulations}</p>
            <p className="text-xs text-zinc-500">Total Simulations</p>
          </div>
          <div className="bg-zinc-800 rounded-lg p-3 text-center">
            <p className={`text-xl font-bold ${stats.accuracyRate >= 0.7 ? 'text-emerald-400' : 'text-amber-400'}`}>
              {Math.round(stats.accuracyRate * 100)}%
            </p>
            <p className="text-xs text-zinc-500">Accuracy Rate</p>
          </div>
          <div className="bg-zinc-800 rounded-lg p-3 text-center">
            <p className="text-xl font-bold text-zinc-100">
              ±{stats.meanPredictionError.toFixed(1)}
            </p>
            <p className="text-xs text-zinc-500">Avg Prediction Error</p>
          </div>
        </div>
      )}

      {!loading && (
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {outcomes.length === 0 && (
            <p className="text-center text-zinc-500 py-6">No simulation outcomes recorded yet</p>
          )}
          {outcomes.map(o => (
            <div
              key={o.scenarioId}
              onClick={() => setSelectedId(prev => prev === o.scenarioId ? null : o.scenarioId)}
              className={`bg-zinc-800 rounded-lg p-3 cursor-pointer transition-colors ${
                selectedId === o.scenarioId ? 'border border-violet-600' : 'border border-transparent hover:border-zinc-600'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-mono text-zinc-400">{o.scenarioId.slice(0, 8)}…</span>
                <span className="text-xs text-zinc-500">{new Date(o.recordedAt).toLocaleDateString()}</span>
              </div>
              <DeltaBar predicted={o.predictedDelta} actual={o.actualDelta} />
              {o.predictionError != null && (
                <p className="text-xs text-zinc-500 mt-1">
                  Error: <span className={o.predictionError <= 10 ? 'text-emerald-400' : 'text-amber-400'}>
                    {o.predictionError.toFixed(1)} pts
                  </span>
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {selected != null && (
        <div className="border-t border-zinc-700 pt-4 space-y-3">
          <p className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Mitigations Applied</p>
          {selected.mitigationsApplied.length === 0 ? (
            <p className="text-xs text-zinc-500">No mitigations recorded</p>
          ) : (
            <ul className="space-y-1">
              {selected.mitigationsApplied.map((m, i) => (
                <li key={i} className="text-xs text-zinc-300 flex items-start gap-2">
                  <span className="text-emerald-500 mt-0.5">✓</span>
                  {m}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

export default MitigationEffectivenessChart
