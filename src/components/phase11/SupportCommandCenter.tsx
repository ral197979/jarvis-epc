// Denver Engineering — Support Command Center (Phase 11)
// Unified support operations: triage records, incident clusters, health alerts

import React, { useEffect, useState, useCallback } from 'react'

interface TriageRecord {
  id: string
  ticketId: string
  tenantId: string
  suggestedPriority: string
  clusterType: string
  confidence: number
  diagnosticSummary: string
  suggestedActions: string[]
  escalateToEngineering: boolean
  triagedAt: string
}

interface IncidentCluster {
  id: string
  clusterType: string
  incidentCount: number
  affectedTenants: number
  status: string
  lastSeenAt: string
}

interface SupportCommandCenterProps {
  onEscalate?: (ticketId: string) => void
}

const PRIORITY_COLORS: Record<string, string> = {
  critical: '#ef4444',
  high: '#f59e0b',
  medium: '#3b82f6',
  low: '#22c55e',
}

const CLUSTER_LABELS: Record<string, string> = {
  replay_divergence: 'Replay Divergence',
  queue_saturation: 'Queue Saturation',
  billing_lag: 'Billing Lag',
  auth_failure: 'Auth Failure',
  edge_disconnect: 'Edge Disconnect',
  ai_provider_error: 'AI Provider Error',
  export_failure: 'Export Failure',
  unknown: 'Unknown',
}

export function SupportCommandCenter({ onEscalate }: SupportCommandCenterProps) {
  const [triageRecords, setTriageRecords] = useState<TriageRecord[]>([])
  const [clusters, setClusters] = useState<IncidentCluster[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'triage' | 'clusters'>('triage')
  const [selectedRecord, setSelectedRecord] = useState<TriageRecord | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [triageRes, clusterRes] = await Promise.all([
        fetch('/api/phase11/support/triage?priority=critical'),
        fetch('/api/phase11/support/clusters?status=active'),
      ])
      const [triageData, clusterData] = await Promise.all([triageRes.json(), clusterRes.json()])
      setTriageRecords(triageData.records ?? [])
      setClusters(clusterData.clusters ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const criticalCount = triageRecords.filter(r => r.suggestedPriority === 'critical').length
  const escalateCount = triageRecords.filter(r => r.escalateToEngineering).length

  return (
    <div style={{ background: '#0f172a', color: '#e2e8f0', fontFamily: 'sans-serif', padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Support Command Center</h2>
          <p style={{ margin: '4px 0 0', color: '#94a3b8', fontSize: 13 }}>
            {criticalCount} critical · {escalateCount} escalations · {clusters.filter(c => c.status === 'active').length} active clusters
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['triage', 'clusters'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: '6px 14px', borderRadius: 6, border: '1px solid',
                borderColor: activeTab === tab ? '#3b82f6' : '#334155',
                background: activeTab === tab ? '#3b82f620' : 'transparent',
                color: activeTab === tab ? '#3b82f6' : '#94a3b8',
                cursor: 'pointer', fontSize: 12, textTransform: 'capitalize',
              }}
            >
              {tab === 'triage' ? 'Triage Queue' : 'Incident Clusters'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ color: '#64748b', textAlign: 'center', padding: 40 }}>Loading…</div>
      ) : activeTab === 'triage' ? (
        <div style={{ display: 'grid', gridTemplateColumns: selectedRecord ? '1fr 1fr' : '1fr', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {triageRecords.map(record => {
              const pColor = PRIORITY_COLORS[record.suggestedPriority] ?? '#64748b'
              return (
                <div
                  key={record.id}
                  onClick={() => setSelectedRecord(selectedRecord?.id === record.id ? null : record)}
                  style={{
                    background: '#1e293b', borderRadius: 8, padding: 14, cursor: 'pointer',
                    border: `1px solid ${selectedRecord?.id === record.id ? '#3b82f6' : '#334155'}`,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <span style={{
                          background: pColor + '22', color: pColor, border: `1px solid ${pColor}44`,
                          borderRadius: 4, padding: '2px 8px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                        }}>
                          {record.suggestedPriority}
                        </span>
                        <span style={{ fontSize: 12, color: '#94a3b8' }}>
                          {CLUSTER_LABELS[record.clusterType] ?? record.clusterType}
                        </span>
                        {record.escalateToEngineering && (
                          <span style={{
                            background: '#ef444420', color: '#ef4444', border: '1px solid #ef444444',
                            borderRadius: 4, padding: '2px 8px', fontSize: 10,
                          }}>
                            ESCALATE
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                        Ticket: {record.ticketId} · {Math.round(record.confidence * 100)}% confidence
                      </div>
                    </div>
                    {onEscalate && record.escalateToEngineering && (
                      <button
                        onClick={e => { e.stopPropagation(); onEscalate(record.ticketId) }}
                        style={{
                          padding: '4px 10px', background: '#ef444420', color: '#ef4444',
                          border: '1px solid #ef444444', borderRadius: 4, cursor: 'pointer', fontSize: 11,
                        }}
                      >
                        Escalate
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
            {triageRecords.length === 0 && (
              <div style={{ color: '#64748b', textAlign: 'center', padding: 32 }}>No critical triage records.</div>
            )}
          </div>

          {selectedRecord && (
            <div style={{ background: '#1e293b', borderRadius: 8, padding: 16 }}>
              <h4 style={{ margin: '0 0 12px', fontSize: 14, color: '#94a3b8' }}>Diagnostic Summary</h4>
              <p style={{ fontSize: 13, lineHeight: 1.5, color: '#cbd5e1', margin: '0 0 12px' }}>
                {selectedRecord.diagnosticSummary}
              </p>
              <h4 style={{ margin: '0 0 8px', fontSize: 14, color: '#94a3b8' }}>Suggested Actions</h4>
              <ul style={{ margin: 0, padding: '0 0 0 16px' }}>
                {selectedRecord.suggestedActions.map((action, i) => (
                  <li key={i} style={{ fontSize: 12, color: '#cbd5e1', marginBottom: 4 }}>{action}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {clusters.map(cluster => (
            <div
              key={cluster.id}
              style={{
                background: '#1e293b', borderRadius: 8, padding: 14,
                border: `1px solid ${cluster.incidentCount >= 10 ? '#ef444444' : '#334155'}`,
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}
            >
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>
                  {CLUSTER_LABELS[cluster.clusterType] ?? cluster.clusterType}
                </div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                  Last seen: {new Date(cluster.lastSeenAt).toLocaleString()}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: cluster.incidentCount >= 10 ? '#ef4444' : '#f59e0b' }}>
                  {cluster.incidentCount}
                </div>
                <div style={{ fontSize: 11, color: '#64748b' }}>{cluster.affectedTenants} tenants</div>
              </div>
            </div>
          ))}
          {clusters.length === 0 && (
            <div style={{ color: '#64748b', textAlign: 'center', padding: 32 }}>No active incident clusters.</div>
          )}
        </div>
      )}
    </div>
  )
}
