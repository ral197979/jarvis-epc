// Denver Engineering — Recommendation Quality Panel (v7.0.0)
// Shows top-performing and recently declined recommendations with quality signals.

import React, { useState, useEffect } from 'react'

interface RecommendationOutcome {
  id: string
  recommendationId: string
  recommendationType: string
  agentType: string
  entityId?: string
  entityType?: string
  outcome: string
  effectivenessScore?: number
  notes?: string
  createdAt: string
}

const OUTCOME_STYLE: Record<string, string> = {
  accepted: 'text-emerald-400 bg-emerald-900/30 border-emerald-700',
  rejected: 'text-red-400 bg-red-900/30 border-red-700',
  partially_accepted: 'text-amber-400 bg-amber-900/30 border-amber-700',
  deferred: 'text-blue-400 bg-blue-900/30 border-blue-700',
  superseded: 'text-zinc-400 bg-zinc-800 border-zinc-600',
  unknown: 'text-zinc-500 bg-zinc-800 border-zinc-700',
}

function EffectivenessGauge({ score }: { score: number }) {
  const color = score >= 70 ? 'text-emerald-400' : score >= 40 ? 'text-amber-400' : 'text-red-400'
  const r = 18
  const circ = 2 * Math.PI * r
  const dash = (score / 100) * circ
  return (
    <div className="flex items-center gap-2">
      <svg width={42} height={42} viewBox="0 0 42 42">
        <circle cx={21} cy={21} r={r} fill="none" stroke="#3f3f46" strokeWidth={4} />
        <circle
          cx={21} cy={21} r={r} fill="none"
          stroke={score >= 70 ? '#34d399' : score >= 40 ? '#f59e0b' : '#f87171'}
          strokeWidth={4}
          strokeDasharray={`${dash} ${circ - dash}`}
          strokeLinecap="round"
          transform="rotate(-90 21 21)"
        />
        <text x={21} y={25} textAnchor="middle" className="fill-zinc-200" fontSize={9} fontWeight="bold">
          {score.toFixed(0)}
        </text>
      </svg>
      <span className={`text-xs font-semibold ${color}`}>
        {score >= 70 ? 'Effective' : score >= 40 ? 'Moderate' : 'Low'}
      </span>
    </div>
  )
}

export function RecommendationQualityPanel() {
  const [topOutcomes, setTopOutcomes] = useState<RecommendationOutcome[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<string>('all')

  useEffect(() => {
    setLoading(true)
    fetch('/api/v1/adaptive/outcomes/top?limit=20')
      .then(r => r.json())
      .then(data => setTopOutcomes(Array.isArray(data) ? data : []))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const outcomes = ['all', 'accepted', 'rejected', 'partially_accepted', 'deferred']
  const filtered = filter === 'all' ? topOutcomes : topOutcomes.filter(o => o.outcome === filter)

  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-zinc-100">Recommendation Quality</h2>
        <span className="text-xs text-zinc-500">{topOutcomes.length} outcomes tracked</span>
      </div>

      <div className="flex gap-2 flex-wrap">
        {outcomes.map(o => (
          <button
            key={o}
            onClick={() => setFilter(o)}
            className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
              filter === o
                ? 'bg-violet-600 border-violet-500 text-white'
                : 'border-zinc-600 text-zinc-400 hover:border-zinc-500'
            }`}
          >
            {o === 'all' ? `All (${topOutcomes.length})` : o.replace('_', ' ')}
          </button>
        ))}
      </div>

      {loading && <p className="text-zinc-500 text-sm">Loading recommendation outcomes...</p>}
      {error && <p className="text-red-400 text-sm border border-red-800 rounded p-3">{error}</p>}

      {!loading && (
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {filtered.length === 0 && (
            <p className="text-center text-zinc-500 py-6">No outcomes match this filter</p>
          )}
          {filtered.map(o => (
            <div key={o.id} className="bg-zinc-800 rounded-lg p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded border ${OUTCOME_STYLE[o.outcome] ?? OUTCOME_STYLE.unknown}`}>
                    {o.outcome.replace('_', ' ')}
                  </span>
                  <span className="text-sm text-zinc-200">{o.recommendationType}</span>
                </div>
                <span className="text-xs text-zinc-500">{o.agentType}</span>
              </div>

              {o.effectivenessScore != null && (
                <EffectivenessGauge score={o.effectivenessScore} />
              )}

              <div className="flex items-center gap-3 text-xs text-zinc-500">
                {o.entityType != null && <span className="capitalize">{o.entityType}</span>}
                <span>{new Date(o.createdAt).toLocaleDateString()}</span>
              </div>

              {o.notes != null && (
                <p className="text-xs text-zinc-400 italic">{o.notes}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default RecommendationQualityPanel
