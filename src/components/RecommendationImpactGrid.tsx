// Denver Engineering — Recommendation Impact Grid (v7.0.0)
// Grid view of ranked recommendations with effectiveness scores and outcomes.

import React, { useState, useEffect } from 'react'

interface RankedRecommendation {
  recommendationId: string
  recommendationType: string
  agentType: string
  score: number
  urgency: number
  confidence: number
  historicalEffectiveness: number
  entityId?: string
  entityType?: string
  rationale: string
}

interface AgentReport {
  agentType: string
  totalOutcomes: number
  measuredOutcomes: number
  avgEffectiveness: number
  acceptanceRate: number
  rejectionRate: number
}

function ScoreBar({ value, color = 'bg-violet-500' }: { value: number; color?: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-zinc-700 rounded-full h-1.5 overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
      <span className="text-xs text-zinc-400 w-8 text-right">{value.toFixed(0)}</span>
    </div>
  )
}

function agentColor(agentType: string): string {
  const colors: Record<string, string> = {
    RiskAgent: 'bg-red-900/50 text-red-300 border-red-700',
    ReadinessCoordinatorAgent: 'bg-emerald-900/50 text-emerald-300 border-emerald-700',
    SchedulingAgent: 'bg-blue-900/50 text-blue-300 border-blue-700',
    ValidationAgent: 'bg-violet-900/50 text-violet-300 border-violet-700',
  }
  return colors[agentType] ?? 'bg-zinc-800 text-zinc-300 border-zinc-600'
}

export function RecommendationImpactGrid() {
  const [ranked, setRanked] = useState<RankedRecommendation[]>([])
  const [agentReports, setAgentReports] = useState<AgentReport[]>([])
  const [tab, setTab] = useState<'ranked' | 'effectiveness'>('ranked')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      fetch('/api/v1/adaptive/rank/top?limit=20').then(r => r.json()),
      fetch('/api/v1/adaptive/outcomes/effectiveness').then(r => r.json()),
    ])
      .then(([rankData, effectData]) => {
        setRanked(Array.isArray(rankData) ? rankData : [])
        setAgentReports(Array.isArray(effectData) ? effectData : [])
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-zinc-100">Recommendation Intelligence</h2>
        <div className="flex gap-2">
          {(['ranked', 'effectiveness'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                tab === t
                  ? 'bg-violet-600 border-violet-500 text-white'
                  : 'border-zinc-600 text-zinc-400 hover:border-zinc-500'
              }`}
            >
              {t === 'ranked' ? 'Top Ranked' : 'Agent Effectiveness'}
            </button>
          ))}
        </div>
      </div>

      {loading && <p className="text-zinc-500 text-sm">Loading...</p>}
      {error && <p className="text-red-400 text-sm border border-red-800 rounded p-3">{error}</p>}

      {!loading && tab === 'ranked' && (
        <div className="space-y-2">
          {ranked.length === 0 && (
            <p className="text-center text-zinc-500 py-6">No ranked recommendations available</p>
          )}
          {ranked.map((r, i) => (
            <div key={r.recommendationId} className="bg-zinc-800 rounded-lg p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-zinc-500 text-xs font-mono w-5">#{i + 1}</span>
                  <span className={`text-xs px-2 py-0.5 rounded border ${agentColor(r.agentType)}`}>
                    {r.agentType}
                  </span>
                  <span className="text-sm text-zinc-200">{r.recommendationType}</span>
                </div>
                <span className="text-sm font-bold text-violet-400">{r.score.toFixed(1)}</span>
              </div>
              <div className="grid grid-cols-3 gap-x-4 gap-y-1">
                <div>
                  <p className="text-xs text-zinc-500 mb-0.5">Urgency</p>
                  <ScoreBar value={r.urgency} color="bg-amber-500" />
                </div>
                <div>
                  <p className="text-xs text-zinc-500 mb-0.5">Confidence</p>
                  <ScoreBar value={r.confidence * 100} color="bg-emerald-500" />
                </div>
                <div>
                  <p className="text-xs text-zinc-500 mb-0.5">Historical Eff.</p>
                  <ScoreBar value={r.historicalEffectiveness} color="bg-blue-500" />
                </div>
              </div>
              {r.rationale.length > 0 && (
                <p className="text-xs text-zinc-400">{r.rationale}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {!loading && tab === 'effectiveness' && (
        <div className="space-y-3">
          {agentReports.length === 0 && (
            <p className="text-center text-zinc-500 py-6">No effectiveness data yet</p>
          )}
          {agentReports.map(r => (
            <div key={r.agentType} className="bg-zinc-800 rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className={`text-xs px-2 py-0.5 rounded border ${agentColor(r.agentType)}`}>
                  {r.agentType}
                </span>
                <span className="text-xs text-zinc-500">{r.totalOutcomes} total outcomes</span>
              </div>
              <div className="grid grid-cols-3 gap-x-4">
                <div>
                  <p className="text-xs text-zinc-500 mb-0.5">Avg Effectiveness</p>
                  <ScoreBar value={r.avgEffectiveness} color="bg-violet-500" />
                </div>
                <div>
                  <p className="text-xs text-zinc-500 mb-0.5">Acceptance Rate</p>
                  <ScoreBar value={r.acceptanceRate * 100} color="bg-emerald-500" />
                </div>
                <div>
                  <p className="text-xs text-zinc-500 mb-0.5">Rejection Rate</p>
                  <ScoreBar value={r.rejectionRate * 100} color="bg-red-500" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default RecommendationImpactGrid
