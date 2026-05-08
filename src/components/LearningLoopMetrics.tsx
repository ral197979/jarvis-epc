// Denver Engineering — Learning Loop Metrics (v7.0.0)
// Dashboard panel showing learning health, signal distribution, and memory insights.

import React, { useState, useEffect } from 'react'

interface SignalSummary {
  feedbackType: string
  total: number
  positive: number
  negative: number
  neutral: number
  mixed: number
  positiveRate: number
}

interface LearningHealthReport {
  tenantId: string
  totalFeedback: number
  feedbackLast7Days: number
  overallPositiveRate: number
  byType: Record<string, SignalSummary>
  generatedAt: string
}

interface AnomalyPattern {
  patternId: string
  anomalyType: string
  entityType?: string
  learnedThreshold: number
  falsePositiveRate: number
  truePositiveRate: number
  sampleCount: number
}

function PositiveRateBar({ rate }: { rate: number }) {
  const pct = Math.round(rate * 100)
  const color = pct >= 70 ? 'bg-emerald-500' : pct >= 40 ? 'bg-amber-500' : 'bg-red-500'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-zinc-700 rounded-full h-1.5 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-zinc-400 w-8 text-right">{pct}%</span>
    </div>
  )
}

export function LearningLoopMetrics() {
  const [health, setHealth] = useState<LearningHealthReport | null>(null)
  const [patterns, setPatterns] = useState<AnomalyPattern[]>([])
  const [tab, setTab] = useState<'health' | 'patterns'>('health')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      fetch('/api/v1/adaptive/feedback/health').then(r => r.json()),
      fetch('/api/v1/adaptive/anomaly-patterns').then(r => r.json()),
    ])
      .then(([healthData, patternsData]) => {
        setHealth(healthData)
        setPatterns(Array.isArray(patternsData) ? patternsData : [])
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const overallPct = health != null ? Math.round(health.overallPositiveRate * 100) : 0

  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-zinc-100">Learning Loop Metrics</h2>
        <div className="flex gap-2">
          {(['health', 'patterns'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                tab === t
                  ? 'bg-violet-600 border-violet-500 text-white'
                  : 'border-zinc-600 text-zinc-400 hover:border-zinc-500'
              }`}
            >
              {t === 'health' ? 'Signal Health' : `Anomaly Patterns (${patterns.length})`}
            </button>
          ))}
        </div>
      </div>

      {loading && <p className="text-zinc-500 text-sm">Loading learning metrics...</p>}
      {error && <p className="text-red-400 text-sm border border-red-800 rounded p-3">{error}</p>}

      {!loading && tab === 'health' && health != null && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-zinc-800 rounded-lg p-3 text-center">
              <p className="text-xl font-bold text-zinc-100">{health.totalFeedback}</p>
              <p className="text-xs text-zinc-500">Total Feedback</p>
            </div>
            <div className="bg-zinc-800 rounded-lg p-3 text-center">
              <p className="text-xl font-bold text-zinc-100">{health.feedbackLast7Days}</p>
              <p className="text-xs text-zinc-500">Last 7 Days</p>
            </div>
            <div className="bg-zinc-800 rounded-lg p-3 text-center">
              <p className={`text-xl font-bold ${overallPct >= 60 ? 'text-emerald-400' : 'text-amber-400'}`}>
                {overallPct}%
              </p>
              <p className="text-xs text-zinc-500">Positive Rate</p>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs text-zinc-400 font-medium uppercase tracking-wide">Signal by Type</p>
            {Object.entries(health.byType).map(([type, summary]) => (
              <div key={type} className="bg-zinc-800 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-zinc-200 capitalize">{type}</span>
                  <span className="text-xs text-zinc-500">{summary.total} signals</span>
                </div>
                <PositiveRateBar rate={summary.positiveRate} />
                <div className="flex gap-3 text-xs text-zinc-500">
                  <span className="text-emerald-400">+{summary.positive} pos</span>
                  <span className="text-red-400">−{summary.negative} neg</span>
                  <span>{summary.neutral} neutral</span>
                  {summary.mixed > 0 && <span>{summary.mixed} mixed</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && tab === 'patterns' && (
        <div className="space-y-2">
          {patterns.length === 0 && (
            <p className="text-center text-zinc-500 py-6">No anomaly patterns learned yet</p>
          )}
          {patterns.map(p => (
            <div key={p.patternId} className="bg-zinc-800 rounded-lg p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-zinc-200">{p.anomalyType}</span>
                {p.entityType != null && (
                  <span className="text-xs text-zinc-500">{p.entityType}</span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-3 text-xs">
                <div>
                  <p className="text-zinc-500 mb-0.5">Learned Threshold</p>
                  <p className="text-amber-400 font-mono">{p.learnedThreshold.toFixed(2)}σ</p>
                </div>
                <div>
                  <p className="text-zinc-500 mb-0.5">True Positive Rate</p>
                  <p className="text-emerald-400 font-mono">{(p.truePositiveRate * 100).toFixed(0)}%</p>
                </div>
                <div>
                  <p className="text-zinc-500 mb-0.5">False Positive Rate</p>
                  <p className="text-red-400 font-mono">{(p.falsePositiveRate * 100).toFixed(0)}%</p>
                </div>
              </div>
              <p className="text-xs text-zinc-500">{p.sampleCount} samples</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default LearningLoopMetrics
