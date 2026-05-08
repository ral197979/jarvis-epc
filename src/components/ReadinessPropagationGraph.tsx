// Denver Engineering — Readiness Propagation Graph (v6.0.0)
// Shows how readiness propagates across projects with risk heatmap.

import React, { useEffect, useState } from 'react'

interface PortfolioReadiness {
  tenantId: string
  projectCount: number
  averageReadiness: number
  readinessByProject: Record<string, number>
  atRiskProjects: string[]
  topRisks: string[]
  computedAt: string
}

interface PortfolioConflict {
  conflictType: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  involvedProjectIds: string[]
  description: string
  suggestedResolution: string
}

const SEVERITY_COLOR: Record<string, string> = {
  critical: 'border-red-500 bg-red-500/10 text-red-300',
  high: 'border-orange-500 bg-orange-500/10 text-orange-300',
  medium: 'border-amber-500 bg-amber-500/10 text-amber-300',
  low: 'border-zinc-600 bg-zinc-800/40 text-zinc-400',
}

function ReadinessBar({ score, projectId, atRisk }: { score: number; projectId: string; atRisk: boolean }) {
  const color = score >= 75 ? 'bg-emerald-500' : score >= 50 ? 'bg-amber-400' : 'bg-red-500'
  return (
    <div className="flex items-center gap-3">
      <div className="w-24 text-xs text-zinc-400 truncate" title={projectId}>
        {projectId.slice(0, 8)}…
      </div>
      <div className="flex-1 bg-zinc-700 rounded-full h-2 overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${score}%` }} />
      </div>
      <div className={`text-xs font-mono w-10 text-right ${atRisk ? 'text-red-400' : 'text-zinc-300'}`}>
        {score.toFixed(0)}%
      </div>
      {atRisk && <span className="text-[10px] text-red-400">⚠</span>}
    </div>
  )
}

function ConflictCard({ conflict }: { conflict: PortfolioConflict }) {
  const [expanded, setExpanded] = useState(false)
  const colorClass = SEVERITY_COLOR[conflict.severity] ?? SEVERITY_COLOR.low
  return (
    <div className={`rounded-lg border p-3 ${colorClass}`}>
      <button
        className="w-full flex items-center justify-between text-left"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide">{conflict.severity}</span>
          <span className="text-sm">{conflict.conflictType.replace(/_/g, ' ')}</span>
        </div>
        <span className="text-xs">{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && (
        <div className="mt-2 space-y-1 text-xs">
          <p className="text-zinc-300">{conflict.description}</p>
          <p className="text-zinc-400 italic">{conflict.suggestedResolution}</p>
          <div className="flex flex-wrap gap-1 mt-1">
            {conflict.involvedProjectIds.map(id => (
              <span key={id} className="bg-zinc-800/60 rounded px-1.5 py-0.5 text-zinc-300 font-mono">
                {id.slice(0, 8)}…
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function ReadinessPropagationGraph() {
  const [readiness, setReadiness] = useState<PortfolioReadiness | null>(null)
  const [conflicts, setConflicts] = useState<PortfolioConflict[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'readiness' | 'conflicts'>('readiness')

  useEffect(() => {
    setLoading(true)
    Promise.all([
      fetch('/api/v1/portfolio/readiness').then(r => r.json()),
      fetch('/api/v1/portfolio/conflicts').then(r => r.json()),
    ])
      .then(([r, c]) => {
        setReadiness(r)
        setConflicts(c.conflicts ?? [])
      })
      .finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className="flex items-center justify-center h-48 text-zinc-400 text-sm">
      Loading portfolio readiness…
    </div>
  )

  const byProject = Object.entries(readiness?.readinessByProject ?? {})

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg bg-zinc-800/60 border border-zinc-700 p-3 text-center">
          <div className="text-2xl font-bold text-white">{readiness?.projectCount ?? 0}</div>
          <div className="text-xs text-zinc-400 mt-0.5">Projects</div>
        </div>
        <div className="rounded-lg bg-zinc-800/60 border border-zinc-700 p-3 text-center">
          <div className={`text-2xl font-bold ${
            (readiness?.averageReadiness ?? 0) >= 75 ? 'text-emerald-400' :
            (readiness?.averageReadiness ?? 0) >= 50 ? 'text-amber-400' : 'text-red-400'
          }`}>{(readiness?.averageReadiness ?? 0).toFixed(1)}%</div>
          <div className="text-xs text-zinc-400 mt-0.5">Avg Readiness</div>
        </div>
        <div className="rounded-lg bg-zinc-800/60 border border-zinc-700 p-3 text-center">
          <div className={`text-2xl font-bold ${readiness?.atRiskProjects.length ? 'text-red-400' : 'text-emerald-400'}`}>
            {readiness?.atRiskProjects.length ?? 0}
          </div>
          <div className="text-xs text-zinc-400 mt-0.5">At Risk</div>
        </div>
      </div>

      {/* Tab switcher */}
      <div className="flex rounded-lg bg-zinc-800/40 p-0.5 gap-0.5">
        {(['readiness', 'conflicts'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-colors ${
              tab === t ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'
            }`}
          >
            {t === 'readiness' ? 'Readiness by Project' : `Conflicts (${conflicts.length})`}
          </button>
        ))}
      </div>

      {tab === 'readiness' && (
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {byProject.length === 0 ? (
            <p className="text-sm text-zinc-500 text-center py-4">No project twins registered</p>
          ) : (
            byProject
              .sort((a, b) => a[1] - b[1])
              .map(([id, score]) => (
                <ReadinessBar
                  key={id}
                  projectId={id}
                  score={score}
                  atRisk={readiness?.atRiskProjects.includes(id) ?? false}
                />
              ))
          )}
        </div>
      )}

      {tab === 'conflicts' && (
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {conflicts.length === 0 ? (
            <p className="text-sm text-zinc-500 text-center py-4">No conflicts detected</p>
          ) : (
            conflicts.map((c, i) => <ConflictCard key={i} conflict={c} />)
          )}
        </div>
      )}
    </div>
  )
}
