// Denver Engineering — Optimization Command Center (v7.0.0)
// Master view for resource optimization: proposals, balance plan, and consensus.

import React, { useState, useEffect } from 'react'

interface OptimizationProposal {
  id: string
  optimizationType: string
  proposedBy: string
  status: string
  proposal: Record<string, unknown>
  rationale?: string
  expectedGain?: number
  actualGain?: number
  createdAt: string
}

interface OptimizationSummary {
  proposedCount: number
  approvedCount: number
  appliedCount: number
  avgExpectedGain: number
  avgActualGain: number
  gainAccuracy: number
}

interface ResourceAllocation {
  entityId: string
  entityType: string
  currentLoad: number
  predictedPeak: number
  suggestedAction: string
  actionRationale: string
  confidenceScore: number
}

const STATUS_COLOR: Record<string, string> = {
  proposed: 'text-amber-400 bg-amber-900/30 border-amber-700',
  approved: 'text-blue-400 bg-blue-900/30 border-blue-700',
  applied: 'text-emerald-400 bg-emerald-900/30 border-emerald-700',
  rejected: 'text-red-400 bg-red-900/30 border-red-700',
  expired: 'text-zinc-400 bg-zinc-800 border-zinc-600',
}

const ACTION_COLOR: Record<string, string> = {
  scale_up: 'text-red-400',
  scale_down: 'text-blue-400',
  rebalance: 'text-amber-400',
  defer: 'text-orange-400',
  ok: 'text-emerald-400',
}

export function OptimizationCommandCenter() {
  const [summary, setSummary] = useState<OptimizationSummary | null>(null)
  const [proposals, setProposals] = useState<OptimizationProposal[]>([])
  const [resources, setResources] = useState<ResourceAllocation[]>([])
  const [tab, setTab] = useState<'proposals' | 'resources'>('proposals')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = () => {
    setLoading(true)
    Promise.all([
      fetch('/api/v1/optimization/proposals/summary').then(r => r.json()),
      fetch('/api/v1/optimization/proposals?status=proposed').then(r => r.json()),
      fetch('/api/v1/optimization/resources').then(r => r.json()),
    ])
      .then(([summaryData, proposalsData, resourceData]) => {
        setSummary(summaryData)
        setProposals(Array.isArray(proposalsData) ? proposalsData : [])
        setResources(Array.isArray(resourceData) ? resourceData : [])
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const handleApprove = async (id: string) => {
    try {
      await fetch(`/api/v1/optimization/proposals/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approvedBy: 'user' }),
      })
      load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-zinc-100">Optimization Command Center</h2>
        <button onClick={load} className="text-xs text-zinc-400 hover:text-zinc-200 border border-zinc-600 rounded px-3 py-1">
          Refresh
        </button>
      </div>

      {loading && <p className="text-zinc-500 text-sm">Loading optimization data...</p>}
      {error && <p className="text-red-400 text-sm border border-red-800 rounded p-3">{error}</p>}

      {!loading && summary != null && (
        <div className="grid grid-cols-3 gap-3">
          <SummaryChip label="Proposed" value={summary.proposedCount} color="text-amber-400" />
          <SummaryChip label="Approved" value={summary.approvedCount} color="text-blue-400" />
          <SummaryChip label="Applied" value={summary.appliedCount} color="text-emerald-400" />
          <SummaryChip label="Avg Expected Gain" value={`${summary.avgExpectedGain.toFixed(1)}%`} />
          <SummaryChip label="Avg Actual Gain" value={`${summary.avgActualGain.toFixed(1)}%`} />
          <SummaryChip
            label="Gain Accuracy"
            value={`${(summary.gainAccuracy * 100).toFixed(0)}%`}
            color={summary.gainAccuracy >= 0.8 ? 'text-emerald-400' : 'text-amber-400'}
          />
        </div>
      )}

      {!loading && (
        <div className="flex gap-2">
          {(['proposals', 'resources'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                tab === t
                  ? 'bg-violet-600 border-violet-500 text-white'
                  : 'border-zinc-600 text-zinc-400 hover:border-zinc-500'
              }`}
            >
              {t === 'proposals' ? `Proposals (${proposals.length})` : 'Resource Allocations'}
            </button>
          ))}
        </div>
      )}

      {!loading && tab === 'proposals' && (
        <div className="space-y-2">
          {proposals.length === 0 && (
            <p className="text-center text-zinc-500 py-6">No pending proposals</p>
          )}
          {proposals.map(p => (
            <div key={p.id} className="bg-zinc-800 rounded-lg p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded border ${STATUS_COLOR[p.status] ?? STATUS_COLOR.expired}`}>
                    {p.status}
                  </span>
                  <span className="text-sm text-zinc-200 capitalize">{p.optimizationType.replace('_', ' ')}</span>
                  <span className="text-xs text-zinc-500">by {p.proposedBy}</span>
                </div>
                {p.status === 'proposed' && (
                  <button
                    onClick={() => handleApprove(p.id)}
                    className="text-xs bg-violet-600 hover:bg-violet-500 text-white px-3 py-1 rounded transition-colors"
                  >
                    Approve
                  </button>
                )}
              </div>
              {p.rationale != null && <p className="text-xs text-zinc-400">{p.rationale}</p>}
              {p.expectedGain != null && (
                <p className="text-xs text-zinc-500">
                  Expected gain: <span className="text-emerald-400 font-semibold">{p.expectedGain.toFixed(1)}%</span>
                  {p.actualGain != null && (
                    <> → Actual: <span className="text-blue-400 font-semibold">{p.actualGain.toFixed(1)}%</span></>
                  )}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {!loading && tab === 'resources' && (
        <div className="space-y-2">
          {resources.length === 0 && (
            <p className="text-center text-zinc-500 py-6">No resource data available</p>
          )}
          {resources.map(r => (
            <div key={r.entityId} className="bg-zinc-800 rounded-lg p-3 flex items-center justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs text-zinc-400 capitalize">{r.entityType}</span>
                  <span className={`text-xs font-semibold capitalize ${ACTION_COLOR[r.suggestedAction] ?? 'text-zinc-300'}`}>
                    → {r.suggestedAction.replace('_', ' ')}
                  </span>
                </div>
                <p className="text-xs text-zinc-500 truncate">{r.actionRationale}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-bold text-zinc-100">{r.currentLoad}%</p>
                <p className="text-xs text-zinc-500">peak {r.predictedPeak.toFixed(0)}%</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function SummaryChip({
  label, value, color = 'text-zinc-100',
}: { label: string; value: string | number; color?: string }) {
  return (
    <div className="bg-zinc-800 rounded-lg p-3 text-center">
      <p className={`text-lg font-bold ${color}`}>{value}</p>
      <p className="text-xs text-zinc-500 mt-0.5">{label}</p>
    </div>
  )
}

export default OptimizationCommandCenter
