// Denver Engineering — Edge Node Health Panel (Phase 9)
// Shows edge node fleet status with per-node revoke capability.

import React, { useState, useEffect } from 'react'

type NodeStatus = 'active' | 'degraded' | 'offline' | 'decommissioned'

interface EdgeNode {
  id: string
  name: string
  status: NodeStatus
  lastSeenAt: string
  version: string
}

interface Props {
  tenantId: string
}

const STATUS_BADGE: Record<NodeStatus, string> = {
  active: 'bg-emerald-700 text-emerald-100',
  degraded: 'bg-amber-700 text-amber-100',
  offline: 'bg-red-700 text-red-100',
  decommissioned: 'bg-zinc-700 text-zinc-400',
}

const STATUS_BORDER: Record<NodeStatus, string> = {
  active: 'border-zinc-700',
  degraded: 'border-amber-800',
  offline: 'border-red-900',
  decommissioned: 'border-zinc-800',
}

export function EdgeNodeHealthPanel({ tenantId }: Props) {
  const [nodes, setNodes] = useState<EdgeNode[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [revoking, setRevoking] = useState<string | null>(null)
  const [revokeError, setRevokeError] = useState<string | null>(null)
  const [revokeSuccess, setRevokeSuccess] = useState<string | null>(null)
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null)

  function load() {
    setLoading(true)
    setError(null)
    fetch('/api/v1/ecosystem/edge-nodes')
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((data: EdgeNode[]) => setNodes(data))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [tenantId])

  function handleRevoke(nodeId: string) {
    setRevoking(nodeId)
    setRevokeError(null)
    setRevokeSuccess(null)
    setConfirmRevoke(null)
    fetch(`/api/v1/ecosystem/edge-nodes/${nodeId}/revoke`, { method: 'POST' })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(() => {
        setRevokeSuccess(nodeId)
        load()
      })
      .catch(e => setRevokeError(e.message))
      .finally(() => setRevoking(null))
  }

  const activeCount = nodes.filter(n => n.status === 'active').length
  const degradedCount = nodes.filter(n => n.status === 'degraded').length
  const offlineCount = nodes.filter(n => n.status === 'offline').length

  if (loading) {
    return (
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 space-y-3 animate-pulse">
        <div className="h-5 bg-zinc-700 rounded w-48" />
        <div className="grid grid-cols-4 gap-3">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-16 bg-zinc-800 rounded" />)}
        </div>
        {[1, 2, 3].map(i => <div key={i} className="h-14 bg-zinc-800 rounded" />)}
      </div>
    )
  }

  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">Edge Node Health</h2>
          <p className="text-xs text-zinc-500 mt-0.5">Phase 9 — Fleet Status</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="text-xs text-zinc-400 hover:text-zinc-200 border border-zinc-600 rounded px-3 py-1 disabled:opacity-50"
        >
          Refresh
        </button>
      </div>

      {error != null && (
        <p className="text-red-400 text-sm border border-red-800 rounded p-3">{error}</p>
      )}

      {revokeError != null && (
        <p className="text-red-400 text-sm border border-red-800 rounded p-3">{revokeError}</p>
      )}

      {revokeSuccess != null && (
        <p className="text-emerald-400 text-sm border border-emerald-800 rounded p-3">
          Node revoked successfully.
        </p>
      )}

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="border border-zinc-700 rounded-lg p-3 bg-zinc-800/40 text-center">
          <p className="text-2xl font-bold text-zinc-100">{nodes.length}</p>
          <p className="text-xs text-zinc-400 mt-0.5">Total Nodes</p>
        </div>
        <div className="border border-emerald-800 rounded-lg p-3 bg-emerald-900/10 text-center">
          <p className="text-2xl font-bold text-emerald-400">{activeCount}</p>
          <p className="text-xs text-zinc-400 mt-0.5">Active</p>
        </div>
        <div className="border border-amber-800 rounded-lg p-3 bg-amber-900/10 text-center">
          <p className="text-2xl font-bold text-amber-400">{degradedCount}</p>
          <p className="text-xs text-zinc-400 mt-0.5">Degraded</p>
        </div>
        <div className="border border-red-900 rounded-lg p-3 bg-red-900/10 text-center">
          <p className="text-2xl font-bold text-red-400">{offlineCount}</p>
          <p className="text-xs text-zinc-400 mt-0.5">Offline</p>
        </div>
      </div>

      {/* Node list */}
      {nodes.length === 0 ? (
        <p className="text-zinc-500 text-sm">No edge nodes found.</p>
      ) : (
        <div className="space-y-2">
          {nodes.map(node => (
            <div key={node.id}>
              <div className={`border rounded-lg p-3 flex items-center justify-between gap-4 ${STATUS_BORDER[node.status]} bg-zinc-800/30`}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-zinc-100 truncate">{node.name}</p>
                    <span className={`text-xs font-medium rounded-full px-2 py-0.5 ${STATUS_BADGE[node.status]}`}>
                      {node.status}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    v{node.version} · Last seen: {new Date(node.lastSeenAt).toLocaleString()}
                  </p>
                </div>

                {node.status !== 'decommissioned' && (
                  <button
                    onClick={() => setConfirmRevoke(node.id)}
                    disabled={revoking === node.id}
                    className="shrink-0 text-xs border border-red-800 text-red-400 hover:border-red-600 hover:text-red-200 rounded px-3 py-1.5 disabled:opacity-40 transition-colors"
                  >
                    {revoking === node.id ? 'Revoking...' : 'Revoke'}
                  </button>
                )}
              </div>

              {/* Inline confirmation */}
              {confirmRevoke === node.id && (
                <div className="mt-1 border border-red-800 bg-red-900/10 rounded-lg p-3 flex items-center justify-between gap-4">
                  <p className="text-sm text-red-300">
                    Revoke <span className="font-semibold">{node.name}</span>? This will disconnect it immediately.
                  </p>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => handleRevoke(node.id)}
                      className="text-xs bg-red-700 hover:bg-red-600 text-white rounded px-3 py-1.5 transition-colors"
                    >
                      Confirm Revoke
                    </button>
                    <button
                      onClick={() => setConfirmRevoke(null)}
                      className="text-xs border border-zinc-600 text-zinc-400 hover:text-zinc-200 rounded px-3 py-1.5 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
