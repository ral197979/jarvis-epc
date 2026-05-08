// Denver Engineering — Twin Operations Map (v6.0.0)
// Visualizes the operational digital twin graph with status overlays.

import React, { useEffect, useState, useCallback } from 'react'

interface TwinNode {
  twinId: string
  entityType: string
  entityId: string
  name: string
  status: string
  readinessScore?: number
  riskScore?: number
  depth: number
  metadata: Record<string, unknown>
}

interface TwinEdge {
  fromTwinId: string
  toTwinId: string
  relType: string
  weight: number
}

interface GraphOverview {
  nodeCount: number
  edgeCount: number
  degradedCount: number
  degradedNodes: TwinNode[]
  builtAt: string
}

interface TraversalResult {
  nodes: TwinNode[]
  edges: TwinEdge[]
  criticalityScore: number
  dependencyDepth: number
  impactedEntities: string[]
  hasCycles: boolean
}

const STATUS_COLOR: Record<string, string> = {
  active: 'bg-emerald-500',
  degraded: 'bg-amber-400',
  failed: 'bg-red-500',
  maintenance: 'bg-blue-400',
  inactive: 'bg-zinc-400',
  decommissioned: 'bg-zinc-600',
}

const STATUS_DOT: Record<string, string> = {
  active: 'bg-emerald-400',
  degraded: 'bg-amber-300',
  failed: 'bg-red-400',
  maintenance: 'bg-blue-300',
  inactive: 'bg-zinc-300',
  decommissioned: 'bg-zinc-500',
}

function RiskBadge({ score }: { score?: number }) {
  if (score == null) return null
  const color = score >= 75 ? 'text-red-400' : score >= 50 ? 'text-amber-400' : 'text-emerald-400'
  return <span className={`text-xs font-mono ${color}`}>{score.toFixed(0)}%</span>
}

function NodeCard({ node, selected, onClick }: {
  node: TwinNode
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-lg border p-3 transition-colors ${
        selected
          ? 'border-violet-500 bg-violet-500/10'
          : 'border-zinc-700 bg-zinc-800/60 hover:bg-zinc-700/60'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`h-2 w-2 rounded-full flex-shrink-0 ${STATUS_DOT[node.status] ?? 'bg-zinc-400'}`} />
          <span className="text-sm font-medium text-white truncate">{node.name}</span>
        </div>
        <RiskBadge score={node.riskScore} />
      </div>
      <div className="mt-1 flex items-center gap-2 text-xs text-zinc-400">
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium text-white ${STATUS_COLOR[node.status] ?? 'bg-zinc-500'}`}>
          {node.status}
        </span>
        <span>{node.entityType}</span>
        {node.readinessScore != null && (
          <span>ready {node.readinessScore.toFixed(0)}%</span>
        )}
      </div>
    </button>
  )
}

export default function TwinOperationsMap({ tenantId }: { tenantId?: string }) {
  const [overview, setOverview] = useState<GraphOverview | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [traversal, setTraversal] = useState<TraversalResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [traversalLoading, setTraversalLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    fetch('/api/v1/twins/graph/overview')
      .then(r => r.json())
      .then(data => { setOverview(data); setError(null) })
      .catch(() => setError('Failed to load graph'))
      .finally(() => setLoading(false))
  }, [tenantId])

  const selectNode = useCallback((twinId: string) => {
    setSelected(twinId)
    setTraversalLoading(true)
    fetch(`/api/v1/twins/${twinId}/traverse?maxDepth=5`)
      .then(r => r.json())
      .then(setTraversal)
      .catch(() => setTraversal(null))
      .finally(() => setTraversalLoading(false))
  }, [])

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-zinc-400 text-sm">
      Loading twin graph…
    </div>
  )

  if (error) return (
    <div className="flex items-center justify-center h-64 text-red-400 text-sm">{error}</div>
  )

  const degraded = overview?.degradedNodes ?? []

  return (
    <div className="space-y-4">
      {/* Header stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Total Twins', value: overview?.nodeCount ?? 0, color: 'text-white' },
          { label: 'Relationships', value: overview?.edgeCount ?? 0, color: 'text-violet-400' },
          { label: 'Degraded', value: overview?.degradedCount ?? 0, color: overview?.degradedCount ? 'text-amber-400' : 'text-emerald-400' },
        ].map(s => (
          <div key={s.label} className="rounded-lg bg-zinc-800/60 border border-zinc-700 p-3 text-center">
            <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-xs text-zinc-400 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Degraded nodes list */}
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-zinc-300">
            {degraded.length > 0 ? `Degraded / Failed (${degraded.length})` : 'All Systems Nominal'}
          </h3>
          {degraded.length === 0 ? (
            <div className="rounded-lg border border-emerald-700/40 bg-emerald-900/20 p-3 text-sm text-emerald-400">
              ✓ No degraded or failed twins
            </div>
          ) : (
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {degraded.map(node => (
                <NodeCard
                  key={node.twinId}
                  node={node}
                  selected={selected === node.twinId}
                  onClick={() => selectNode(node.twinId)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Traversal panel */}
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-zinc-300">
            {selected ? 'Dependency Traversal' : 'Select a node to traverse'}
          </h3>
          {!selected && (
            <div className="rounded-lg border border-zinc-700 bg-zinc-800/40 p-4 text-sm text-zinc-500 text-center">
              Click a node to see its dependency graph
            </div>
          )}
          {traversalLoading && (
            <div className="text-sm text-zinc-400 p-3">Loading traversal…</div>
          )}
          {traversal && !traversalLoading && (
            <div className="rounded-lg border border-zinc-700 bg-zinc-800/60 p-3 space-y-3">
              <div className="grid grid-cols-2 gap-2 text-xs">
                {[
                  { label: 'Nodes', value: traversal.nodes.length },
                  { label: 'Edges', value: traversal.edges.length },
                  { label: 'Max Depth', value: traversal.dependencyDepth },
                  { label: 'Criticality', value: `${traversal.criticalityScore.toFixed(0)}%` },
                ].map(s => (
                  <div key={s.label} className="flex justify-between">
                    <span className="text-zinc-400">{s.label}</span>
                    <span className="text-white font-mono">{s.value}</span>
                  </div>
                ))}
              </div>
              {traversal.hasCycles && (
                <div className="text-xs text-amber-400 bg-amber-400/10 rounded px-2 py-1">
                  ⚠ Dependency cycle detected
                </div>
              )}
              {traversal.impactedEntities.length > 0 && (
                <div>
                  <div className="text-xs text-zinc-400 mb-1">Impacted by failure ({traversal.impactedEntities.length})</div>
                  <div className="flex flex-wrap gap-1">
                    {traversal.impactedEntities.slice(0, 6).map(id => (
                      <span key={id} className="text-[10px] bg-red-500/20 text-red-300 px-1.5 py-0.5 rounded">
                        {id.slice(0, 8)}…
                      </span>
                    ))}
                    {traversal.impactedEntities.length > 6 && (
                      <span className="text-[10px] text-zinc-500">+{traversal.impactedEntities.length - 6} more</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
