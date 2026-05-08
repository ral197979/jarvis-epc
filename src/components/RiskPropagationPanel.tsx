// Denver Engineering — Risk Propagation Panel (v6.0.0)
// Displays risk propagation results with path visualization and critical nodes.

import React, { useState, useCallback } from 'react'

interface PropagationResult {
  rootTwinId: string
  propagatedRisk: Record<string, number>
  propagationPath: string[]
  totalImpactScore: number
  criticalNodes: string[]
}

function RiskNodeRow({ twinId, risk, isCritical }: { twinId: string; risk: number; isCritical: boolean }) {
  const barColor = risk >= 75 ? 'bg-red-500' : risk >= 50 ? 'bg-amber-400' : 'bg-emerald-500'
  return (
    <div className="flex items-center gap-3">
      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isCritical ? 'bg-red-400' : 'bg-zinc-500'}`} />
      <div className="w-28 text-xs text-zinc-400 truncate font-mono" title={twinId}>
        {twinId.slice(0, 8)}…
      </div>
      <div className="flex-1 bg-zinc-700 rounded-full h-1.5 overflow-hidden">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${risk}%` }} />
      </div>
      <div className={`text-xs font-mono w-10 text-right ${isCritical ? 'text-red-400' : 'text-zinc-300'}`}>
        {risk.toFixed(0)}%
      </div>
      {isCritical && <span className="text-[10px] text-red-400 font-medium">CRITICAL</span>}
    </div>
  )
}

export default function RiskPropagationPanel() {
  const [twinId, setTwinId] = useState('')
  const [result, setResult] = useState<PropagationResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(() => {
    if (!twinId.trim()) return
    setLoading(true)
    setError(null)
    fetch(`/api/v1/twins/${twinId.trim()}/risk-propagation`)
      .then(r => r.ok ? r.json() : r.json().then(e => { throw new Error(e.error) }))
      .then(setResult)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [twinId])

  const sortedNodes = result
    ? Object.entries(result.propagatedRisk).sort((a, b) => b[1] - a[1])
    : []

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input
          type="text"
          value={twinId}
          onChange={e => setTwinId(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && run()}
          placeholder="Twin ID (UUID)"
          className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-violet-500"
        />
        <button
          onClick={run}
          disabled={!twinId.trim() || loading}
          className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-sm text-white font-medium transition-colors"
        >
          {loading ? '…' : 'Propagate'}
        </button>
      </div>

      {error && (
        <div className="text-sm text-red-400 bg-red-900/20 border border-red-700/30 rounded-lg p-3">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-3">
          {/* Summary */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: 'Affected Nodes', value: sortedNodes.length },
              { label: 'Total Impact', value: `${result.totalImpactScore.toFixed(1)}%` },
              { label: 'Critical Nodes', value: result.criticalNodes.length },
            ].map(s => (
              <div key={s.label} className="rounded-lg bg-zinc-800/60 border border-zinc-700 p-2.5 text-center">
                <div className={`text-xl font-bold ${s.label === 'Critical Nodes' && result.criticalNodes.length > 0 ? 'text-red-400' : 'text-white'}`}>
                  {s.value}
                </div>
                <div className="text-[10px] text-zinc-400 mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>

          {/* Propagation path */}
          {result.propagationPath.length > 0 && (
            <div className="rounded-lg border border-zinc-700 bg-zinc-800/40 p-3">
              <div className="text-xs font-medium text-zinc-300 mb-2">Propagation Path</div>
              <div className="flex flex-wrap gap-1 items-center">
                {result.propagationPath.slice(0, 8).map((id, i) => (
                  <React.Fragment key={id}>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                      result.criticalNodes.includes(id)
                        ? 'bg-red-500/20 text-red-300'
                        : 'bg-zinc-700 text-zinc-300'
                    }`}>{id.slice(0, 8)}…</span>
                    {i < Math.min(result.propagationPath.length, 8) - 1 && (
                      <span className="text-zinc-600 text-xs">→</span>
                    )}
                  </React.Fragment>
                ))}
                {result.propagationPath.length > 8 && (
                  <span className="text-xs text-zinc-500">+{result.propagationPath.length - 8} more</span>
                )}
              </div>
            </div>
          )}

          {/* Node risk list */}
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {sortedNodes.slice(0, 20).map(([id, risk]) => (
              <RiskNodeRow
                key={id}
                twinId={id}
                risk={risk}
                isCritical={result.criticalNodes.includes(id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
