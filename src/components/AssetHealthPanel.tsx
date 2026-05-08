// Denver Engineering — Asset Health Panel (v6.0.0)
// Asset health scoring and predictive maintenance recommendations.

import React, { useEffect, useState, useCallback } from 'react'

interface AssetHealthScore {
  twinId: string
  overallScore: number
  components: {
    inspectionScore: number
    deficiencyScore: number
    incidentScore: number
    ageScore: number
    utilizationScore: number
  }
  trend: 'improving' | 'stable' | 'degrading'
  lastAssessedAt: string
}

interface MaintenanceRec {
  twinId: string
  entityType: string
  entityId: string
  priority: 'immediate' | 'high' | 'medium' | 'low'
  predictedFailureRisk: number
  recommendedWindowStart?: string
  recommendedWindowEnd?: string
  maintenanceType: string
  rationale: string
  estimatedDuration: string
}

const PRIORITY_COLOR: Record<string, string> = {
  immediate: 'bg-red-500/20 border-red-700/50 text-red-300',
  high: 'bg-orange-500/20 border-orange-700/50 text-orange-300',
  medium: 'bg-amber-500/20 border-amber-700/50 text-amber-300',
  low: 'bg-zinc-700/40 border-zinc-700 text-zinc-400',
}

const TREND_ICON: Record<string, string> = {
  improving: '↑',
  stable: '→',
  degrading: '↓',
}

const TREND_COLOR: Record<string, string> = {
  improving: 'text-emerald-400',
  stable: 'text-zinc-400',
  degrading: 'text-red-400',
}

function ScoreGauge({ score, label }: { score: number; label: string }) {
  const color = score >= 75 ? 'text-emerald-400' : score >= 50 ? 'text-amber-400' : 'text-red-400'
  const trackColor = score >= 75 ? 'stroke-emerald-400' : score >= 50 ? 'stroke-amber-400' : 'stroke-red-500'
  const r = 18
  const circ = 2 * Math.PI * r
  const dash = (score / 100) * circ

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width="48" height="48" className="rotate-[-90deg]">
        <circle cx="24" cy="24" r={r} fill="none" stroke="#3f3f46" strokeWidth="3.5" />
        <circle
          cx="24" cy="24" r={r} fill="none" className={trackColor}
          strokeWidth="3.5" strokeDasharray={`${dash} ${circ - dash}`} strokeLinecap="round"
        />
      </svg>
      <span className={`text-xs font-mono font-bold -mt-1 ${color}`}>{score}</span>
      <span className="text-[10px] text-zinc-500 text-center leading-tight">{label}</span>
    </div>
  )
}

function RecCard({ rec }: { rec: MaintenanceRec }) {
  return (
    <div className={`rounded-lg border p-3 space-y-1.5 ${PRIORITY_COLOR[rec.priority]}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wide">{rec.priority}</span>
        <span className="text-xs font-mono">risk {rec.predictedFailureRisk}%</span>
      </div>
      <div className="text-sm text-white font-medium">{rec.entityId.slice(0, 12)}… ({rec.entityType})</div>
      <div className="text-xs opacity-80">
        {rec.maintenanceType} • {rec.estimatedDuration}
      </div>
      <p className="text-[11px] opacity-70 leading-relaxed">{rec.rationale}</p>
      {rec.recommendedWindowStart && (
        <div className="text-[10px] opacity-60">
          Window: {new Date(rec.recommendedWindowStart).toLocaleDateString()} – {rec.recommendedWindowEnd ? new Date(rec.recommendedWindowEnd).toLocaleDateString() : '?'}
        </div>
      )}
    </div>
  )
}

export default function AssetHealthPanel({ twinId }: { twinId?: string }) {
  const [health, setHealth] = useState<AssetHealthScore | null>(null)
  const [recs, setRecs] = useState<MaintenanceRec[]>([])
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState<'health' | 'recs'>('health')

  const loadHealth = useCallback(() => {
    if (!twinId) return
    setLoading(true)
    fetch(`/api/v1/portfolio/maintenance/health/${twinId}`)
      .then(r => r.json())
      .then(setHealth)
      .finally(() => setLoading(false))
  }, [twinId])

  const loadRecs = useCallback(() => {
    setLoading(true)
    fetch('/api/v1/portfolio/maintenance/recommendations')
      .then(r => r.json())
      .then(data => setRecs(data.recommendations ?? []))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (tab === 'health') loadHealth()
    else loadRecs()
  }, [tab, loadHealth, loadRecs])

  return (
    <div className="space-y-4">
      <div className="flex rounded-lg bg-zinc-800/40 p-0.5 gap-0.5">
        {(['health', 'recs'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-colors ${
              tab === t ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'
            }`}
          >
            {t === 'health' ? 'Health Score' : `Maintenance (${recs.length})`}
          </button>
        ))}
      </div>

      {loading && (
        <div className="text-sm text-zinc-400 text-center py-6">Loading…</div>
      )}

      {tab === 'health' && !loading && (
        <>
          {!twinId ? (
            <p className="text-sm text-zinc-500 text-center py-4">Pass a twinId to view health</p>
          ) : !health ? (
            <p className="text-sm text-zinc-500 text-center py-4">No health data available</p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className={`text-3xl font-bold ${
                    health.overallScore >= 75 ? 'text-emerald-400' :
                    health.overallScore >= 50 ? 'text-amber-400' : 'text-red-400'
                  }`}>{health.overallScore}</div>
                  <div className="text-xs text-zinc-400">Overall Health Score</div>
                </div>
                <div className={`text-2xl ${TREND_COLOR[health.trend]}`}>
                  {TREND_ICON[health.trend]}
                  <span className="text-xs ml-1">{health.trend}</span>
                </div>
              </div>

              <div className="flex justify-between gap-2 overflow-x-auto pb-1">
                {Object.entries(health.components).map(([key, val]) => (
                  <ScoreGauge
                    key={key}
                    score={val}
                    label={key.replace('Score', '').replace(/([A-Z])/g, ' $1').trim()}
                  />
                ))}
              </div>

              <div className="text-[10px] text-zinc-600">
                Assessed {new Date(health.lastAssessedAt).toLocaleString()}
              </div>
            </div>
          )}
        </>
      )}

      {tab === 'recs' && !loading && (
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {recs.length === 0 ? (
            <p className="text-sm text-zinc-500 text-center py-4">No maintenance recommendations</p>
          ) : (
            recs.map(r => <RecCard key={r.twinId} rec={r} />)
          )}
        </div>
      )}
    </div>
  )
}
