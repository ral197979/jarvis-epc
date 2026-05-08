// Denver Engineering — Adaptive Observability Dashboard (v7.0.0)
// Master Phase 7 dashboard aggregating learning health, drift, and optimization status.

import React, { useState, useEffect } from 'react'

interface LearningHealth {
  totalFeedback: number
  feedbackLast7Days: number
  overallPositiveRate: number
}

interface OptimizationSummary {
  proposedCount: number
  approvedCount: number
  appliedCount: number
  gainAccuracy: number
}

interface ScenarioStats {
  totalSimulations: number
  measuredSimulations: number
  accuracyRate: number
  meanPredictionError: number
}

interface StatusTile {
  label: string
  value: string | number
  sub?: string
  status: 'good' | 'warn' | 'critical' | 'neutral'
}

const STATUS_STYLES: Record<string, string> = {
  good: 'border-emerald-700 bg-emerald-900/20',
  warn: 'border-amber-700 bg-amber-900/20',
  critical: 'border-red-700 bg-red-900/20',
  neutral: 'border-zinc-700 bg-zinc-800',
}

const STATUS_TEXT: Record<string, string> = {
  good: 'text-emerald-400',
  warn: 'text-amber-400',
  critical: 'text-red-400',
  neutral: 'text-zinc-200',
}

function StatusTile({ label, value, sub, status }: StatusTile) {
  return (
    <div className={`rounded-xl border p-4 space-y-1 ${STATUS_STYLES[status]}`}>
      <p className="text-xs text-zinc-400">{label}</p>
      <p className={`text-2xl font-bold ${STATUS_TEXT[status]}`}>{value}</p>
      {sub != null && <p className="text-xs text-zinc-500">{sub}</p>}
    </div>
  )
}

export function AdaptiveObservabilityDashboard() {
  const [learning, setLearning] = useState<LearningHealth | null>(null)
  const [optimization, setOptimization] = useState<OptimizationSummary | null>(null)
  const [scenario, setScenario] = useState<ScenarioStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  const load = () => {
    setLoading(true)
    setError(null)
    Promise.all([
      fetch('/api/v1/adaptive/feedback/health').then(r => r.json()),
      fetch('/api/v1/optimization/proposals/summary').then(r => r.json()),
      fetch('/api/v1/adaptive/simulation-outcomes/stats').then(r => r.json()),
    ])
      .then(([l, o, s]) => {
        setLearning(l)
        setOptimization(o)
        setScenario(s)
        setLastRefresh(new Date())
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const learningStatus = (learning?.overallPositiveRate ?? 0) >= 0.6 ? 'good'
    : (learning?.overallPositiveRate ?? 0) >= 0.4 ? 'warn' : 'critical'

  const optimizationStatus = (optimization?.gainAccuracy ?? 0) >= 0.75 ? 'good'
    : (optimization?.gainAccuracy ?? 0) >= 0.5 ? 'warn' : 'neutral'

  const scenarioStatus = (scenario?.accuracyRate ?? 0) >= 0.7 ? 'good'
    : (scenario?.accuracyRate ?? 0) >= 0.4 ? 'warn' : 'neutral'

  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">Adaptive Observability</h2>
          <p className="text-xs text-zinc-500 mt-0.5">Phase 7 — Learning, Calibration & Optimization Health</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="text-xs text-zinc-400 hover:text-zinc-200 border border-zinc-600 rounded px-3 py-1 disabled:opacity-50"
        >
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {error != null && <p className="text-red-400 text-sm border border-red-800 rounded p-3">{error}</p>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatusTile
          label="Learning Signal Quality"
          value={learning != null ? `${Math.round((learning.overallPositiveRate) * 100)}%` : '—'}
          sub={learning != null ? `${learning.totalFeedback} total signals` : 'loading'}
          status={learning != null ? learningStatus : 'neutral'}
        />
        <StatusTile
          label="7-Day Feedback Volume"
          value={learning?.feedbackLast7Days ?? '—'}
          sub="recent learning events"
          status={((learning?.feedbackLast7Days ?? 0) > 5) ? 'good' : 'warn'}
        />
        <StatusTile
          label="Optimization Proposals"
          value={optimization?.proposedCount ?? '—'}
          sub={optimization != null ? `${optimization.appliedCount} applied` : 'loading'}
          status={optimization != null ? optimizationStatus : 'neutral'}
        />
        <StatusTile
          label="Gain Accuracy"
          value={optimization != null ? `${Math.round((optimization.gainAccuracy) * 100)}%` : '—'}
          sub="expected vs actual gain"
          status={optimization != null ? optimizationStatus : 'neutral'}
        />
        <StatusTile
          label="Simulation Accuracy"
          value={scenario != null ? `${Math.round((scenario.accuracyRate) * 100)}%` : '—'}
          sub={scenario != null ? `±${scenario.meanPredictionError.toFixed(1)} avg error` : 'loading'}
          status={scenario != null ? scenarioStatus : 'neutral'}
        />
        <StatusTile
          label="Simulations Measured"
          value={scenario != null ? `${scenario.measuredSimulations}/${scenario.totalSimulations}` : '—'}
          sub="outcome measurement rate"
          status={scenario != null && scenario.totalSimulations > 0
            ? scenario.measuredSimulations / scenario.totalSimulations >= 0.5 ? 'good' : 'warn'
            : 'neutral'}
        />
      </div>

      {!loading && (
        <div className="border-t border-zinc-800 pt-4 space-y-2">
          <p className="text-xs font-medium text-zinc-400 uppercase tracking-wide">System Status</p>
          <div className="grid grid-cols-1 gap-1">
            <StatusRow
              label="Learning loop"
              status={learning != null && learning.totalFeedback > 0 ? 'active' : 'no data'}
              ok={learning != null && learning.totalFeedback > 0}
            />
            <StatusRow
              label="Forecast calibration"
              status="active — check drift panel for per-type status"
              ok
            />
            <StatusRow
              label="Recommendation ranking"
              status={optimization != null && optimization.appliedCount > 0 ? 'learning from outcomes' : 'cold start'}
              ok={optimization != null && optimization.appliedCount > 0}
            />
            <StatusRow
              label="Scenario learning"
              status={scenario != null && scenario.totalSimulations > 0 ? 'tracking predictions' : 'no simulations yet'}
              ok={scenario != null && scenario.totalSimulations > 0}
            />
          </div>
        </div>
      )}

      {lastRefresh != null && (
        <p className="text-xs text-zinc-600">Last refreshed: {lastRefresh.toLocaleTimeString()}</p>
      )}
    </div>
  )
}

function StatusRow({ label, status, ok }: { label: string; status: string; ok: boolean }) {
  return (
    <div className="flex items-center gap-3 text-xs">
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${ok ? 'bg-emerald-400' : 'bg-amber-400'}`} />
      <span className="text-zinc-400 w-40">{label}</span>
      <span className="text-zinc-500">{status}</span>
    </div>
  )
}

export default AdaptiveObservabilityDashboard
