// Denver Engineering — Incident Cluster Viewer (Phase 11)
// Browse, filter, and resolve incident clusters with root cause tracking

import React, { useEffect, useState, useCallback } from 'react'

interface IncidentCluster {
  id: string
  clusterType: string
  incidentCount: number
  affectedTenants: number
  firstSeenAt: string
  lastSeenAt: string
  status: 'active' | 'resolved' | 'monitoring'
  rootCause: string | null
}

export function IncidentClusterViewer() {
  const [clusters, setClusters] = useState<IncidentCluster[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [resolving, setResolving] = useState<string | null>(null)
  const [rootCauseInput, setRootCauseInput] = useState('')

  const fetchClusters = useCallback(async () => {
    setLoading(true)
    try {
      const url = statusFilter === 'all'
        ? '/api/phase11/support/clusters'
        : `/api/phase11/support/clusters?status=${statusFilter}`
      const res = await fetch(url)
      const data = await res.json()
      setClusters(data.clusters ?? [])
    } finally {
      setLoading(false)
    }
  }, [statusFilter])

  useEffect(() => { fetchClusters() }, [fetchClusters])

  const resolveCluster = async (clusterId: string) => {
    if (!rootCauseInput.trim()) return
    await fetch(`/api/phase11/support/clusters/${clusterId}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rootCause: rootCauseInput }),
    })
    setResolving(null)
    setRootCauseInput('')
    fetchClusters()
  }

  const markMonitoring = async (clusterId: string) => {
    await fetch(`/api/phase11/support/clusters/${clusterId}/monitor`, {
      method: 'POST',
    })
    fetchClusters()
  }

  const statusColors = { active: '#ef4444', resolved: '#22c55e', monitoring: '#f59e0b' }
  const clusterTypeLabels: Record<string, string> = {
    replay_divergence: 'Replay Divergence', queue_saturation: 'Queue Saturation',
    billing_lag: 'Billing Lag', auth_failure: 'Auth Failure',
    edge_disconnect: 'Edge Disconnect', ai_provider_error: 'AI Provider Error',
    export_failure: 'Export Failure', unknown: 'Unknown',
  }

  const activeCount = clusters.filter(c => c.status === 'active').length

  return (
    <div style={{ background: '#0f172a', color: '#e2e8f0', fontFamily: 'sans-serif', padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Incident Clusters</h2>
          <p style={{ margin: '4px 0 0', color: '#94a3b8', fontSize: 13 }}>
            {activeCount} active · {clusters.length} total
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {['all', 'active', 'monitoring', 'resolved'].map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              style={{
                padding: '6px 12px', borderRadius: 6, border: '1px solid',
                borderColor: statusFilter === s ? '#3b82f6' : '#334155',
                background: statusFilter === s ? '#3b82f620' : 'transparent',
                color: statusFilter === s ? '#3b82f6' : '#94a3b8',
                cursor: 'pointer', fontSize: 12, textTransform: 'capitalize',
              }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ color: '#64748b', textAlign: 'center', padding: 40 }}>Loading…</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {clusters.map(cluster => {
            const sColor = statusColors[cluster.status] ?? '#64748b'
            return (
              <div
                key={cluster.id}
                style={{
                  background: '#1e293b', borderRadius: 8,
                  border: `1px solid ${cluster.status === 'active' && cluster.incidentCount >= 3 ? '#ef444444' : '#334155'}`,
                }}
              >
                <div style={{ padding: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                      <span style={{ fontWeight: 700, fontSize: 15 }}>
                        {clusterTypeLabels[cluster.clusterType] ?? cluster.clusterType}
                      </span>
                      <span style={{
                        background: sColor + '22', color: sColor, border: `1px solid ${sColor}44`,
                        borderRadius: 4, padding: '2px 8px', fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
                      }}>
                        {cluster.status}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: '#64748b' }}>
                      {cluster.incidentCount} incidents · {cluster.affectedTenants} tenants
                    </div>
                    <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>
                      First: {new Date(cluster.firstSeenAt).toLocaleString()} ·
                      Last: {new Date(cluster.lastSeenAt).toLocaleString()}
                    </div>
                    {cluster.rootCause && (
                      <div style={{ fontSize: 12, color: '#22c55e', marginTop: 4 }}>
                        Root cause: {cluster.rootCause}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {cluster.status === 'active' && (
                      <>
                        <button
                          onClick={() => markMonitoring(cluster.id)}
                          style={{
                            padding: '6px 12px', background: '#f59e0b20', color: '#f59e0b',
                            border: '1px solid #f59e0b44', borderRadius: 6, cursor: 'pointer', fontSize: 11,
                          }}
                        >
                          Monitor
                        </button>
                        <button
                          onClick={() => setResolving(cluster.id)}
                          style={{
                            padding: '6px 12px', background: '#22c55e20', color: '#22c55e',
                            border: '1px solid #22c55e44', borderRadius: 6, cursor: 'pointer', fontSize: 11,
                          }}
                        >
                          Resolve
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {resolving === cluster.id && (
                  <div style={{
                    borderTop: '1px solid #334155', padding: 12,
                    display: 'flex', gap: 8, alignItems: 'center',
                  }}>
                    <input
                      value={rootCauseInput}
                      onChange={e => setRootCauseInput(e.target.value)}
                      placeholder="Describe root cause…"
                      style={{
                        flex: 1, padding: '8px 12px', background: '#0f172a',
                        border: '1px solid #334155', borderRadius: 6, color: '#e2e8f0', fontSize: 12,
                      }}
                    />
                    <button
                      onClick={() => resolveCluster(cluster.id)}
                      style={{
                        padding: '8px 14px', background: '#22c55e', color: '#fff',
                        border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12,
                      }}
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setResolving(null)}
                      style={{
                        padding: '8px 12px', background: 'transparent', color: '#94a3b8',
                        border: '1px solid #334155', borderRadius: 6, cursor: 'pointer', fontSize: 12,
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            )
          })}
          {clusters.length === 0 && (
            <div style={{ textAlign: 'center', color: '#64748b', padding: 40 }}>
              No incident clusters found.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
