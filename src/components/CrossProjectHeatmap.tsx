// Denver Engineering — Cross-Project Heatmap (v6.0.0)
// Heatmap view of readiness and risk across all projects.

import React, { useEffect, useState } from 'react'

interface ProjectCell {
  entityId: string
  readiness: number
  risk: number
  status: string
}

interface Bottleneck {
  entityType: string
  entityId: string
  bottleneckType: string
  severity: string
  projectedAt: string
  description: string
}

function heatColor(value: number, type: 'readiness' | 'risk'): string {
  if (type === 'readiness') {
    if (value >= 80) return 'bg-emerald-600'
    if (value >= 65) return 'bg-lime-600'
    if (value >= 50) return 'bg-amber-500'
    if (value >= 35) return 'bg-orange-600'
    return 'bg-red-700'
  } else {
    if (value >= 80) return 'bg-red-700'
    if (value >= 65) return 'bg-orange-600'
    if (value >= 50) return 'bg-amber-500'
    if (value >= 35) return 'bg-lime-600'
    return 'bg-emerald-600'
  }
}

export default function CrossProjectHeatmap() {
  const [projects, setProjects] = useState<ProjectCell[]>([])
  const [bottlenecks, setBottlenecks] = useState<Bottleneck[]>([])
  const [mode, setMode] = useState<'readiness' | 'risk'>('readiness')
  const [loading, setLoading] = useState(true)
  const [tooltip, setTooltip] = useState<ProjectCell | null>(null)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      fetch('/api/v1/portfolio/readiness').then(r => r.json()),
      fetch('/api/v1/portfolio/bottlenecks').then(r => r.json()),
    ])
      .then(([readiness, bots]) => {
        const byProject = readiness.readinessByProject as Record<string, number>
        const atRisk = new Set(readiness.atRiskProjects as string[])
        setProjects(Object.entries(byProject).map(([id, score]) => ({
          entityId: id,
          readiness: score,
          risk: atRisk.has(id) ? 70 + Math.random() * 20 : 20 + Math.random() * 30,
          status: score >= 75 ? 'active' : score >= 50 ? 'degraded' : 'failed',
        })))
        setBottlenecks(bots.bottlenecks ?? [])
      })
      .finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className="flex items-center justify-center h-40 text-zinc-400 text-sm">Loading heatmap…</div>
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="flex rounded-lg bg-zinc-800/40 p-0.5 gap-0.5">
          {(['readiness', 'risk'] as const).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-3 py-1 rounded-md text-xs font-medium capitalize transition-colors ${
                mode === m ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
        <span className="text-xs text-zinc-500 ml-2">{projects.length} projects</span>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-1 text-[10px] text-zinc-500">
        {mode === 'readiness' ? (
          <>
            {['Low (&lt;35)', 'Medium', 'Good', 'High', 'Excellent (80+)'].map((l, i) => (
              <div key={i} className="flex items-center gap-0.5">
                <div className={`w-3 h-3 rounded-sm ${
                  i === 0 ? 'bg-red-700' : i === 1 ? 'bg-orange-600' : i === 2 ? 'bg-amber-500' : i === 3 ? 'bg-lime-600' : 'bg-emerald-600'
                }`} />
                <span dangerouslySetInnerHTML={{ __html: l }} />
                {i < 4 && <span className="text-zinc-700 ml-1">·</span>}
              </div>
            ))}
          </>
        ) : (
          <>
            {['Low (safe)', 'Medium', 'High', 'Very High', 'Critical (80+)'].map((l, i) => (
              <div key={i} className="flex items-center gap-0.5">
                <div className={`w-3 h-3 rounded-sm ${
                  i === 0 ? 'bg-emerald-600' : i === 1 ? 'bg-lime-600' : i === 2 ? 'bg-amber-500' : i === 3 ? 'bg-orange-600' : 'bg-red-700'
                }`} />
                <span>{l}</span>
                {i < 4 && <span className="text-zinc-700 ml-1">·</span>}
              </div>
            ))}
          </>
        )}
      </div>

      {/* Heatmap grid */}
      {projects.length === 0 ? (
        <div className="text-sm text-zinc-500 text-center py-6">No project twins registered</div>
      ) : (
        <div className="relative">
          <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${Math.min(10, Math.ceil(Math.sqrt(projects.length)))}, 1fr)` }}>
            {projects.map(p => {
              const val = mode === 'readiness' ? p.readiness : p.risk
              return (
                <button
                  key={p.entityId}
                  onMouseEnter={() => setTooltip(p)}
                  onMouseLeave={() => setTooltip(null)}
                  className={`aspect-square rounded-sm ${heatColor(val, mode)} transition-opacity hover:opacity-80`}
                  title={`${p.entityId.slice(0, 8)}: ${val.toFixed(0)}%`}
                />
              )
            })}
          </div>
          {tooltip && (
            <div className="mt-2 rounded-lg border border-zinc-700 bg-zinc-800 p-2 text-xs">
              <div className="font-mono text-zinc-300">{tooltip.entityId.slice(0, 16)}…</div>
              <div className="text-zinc-400 mt-0.5">
                readiness {tooltip.readiness.toFixed(0)}% · risk {tooltip.risk.toFixed(0)}%
              </div>
            </div>
          )}
        </div>
      )}

      {/* Bottlenecks */}
      {bottlenecks.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-zinc-400">Upcoming Bottlenecks ({bottlenecks.length})</div>
          {bottlenecks.slice(0, 4).map((b, i) => (
            <div key={i} className={`rounded-lg border px-3 py-2 text-xs ${
              b.severity === 'critical' ? 'border-red-700/50 bg-red-900/10 text-red-300' :
              b.severity === 'high' ? 'border-orange-700/50 bg-orange-900/10 text-orange-300' :
              'border-amber-700/50 bg-amber-900/10 text-amber-300'
            }`}>
              <div className="flex items-center justify-between">
                <span className="font-medium">{b.bottleneckType.replace(/_/g, ' ')}</span>
                <span className="opacity-60">{new Date(b.projectedAt).toLocaleDateString()}</span>
              </div>
              <p className="opacity-70 mt-0.5">{b.description}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
