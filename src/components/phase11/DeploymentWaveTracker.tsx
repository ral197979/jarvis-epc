// Denver Engineering — Deployment Wave Tracker (Phase 11)
// Track and manage GA deployment waves with customer assignments and status

import React, { useEffect, useState, useCallback } from 'react'

interface DeploymentWave {
  id: string
  waveName: string
  waveNumber: number
  targetCustomers: string[]
  status: 'planned' | 'active' | 'complete' | 'paused'
  startDate: string | null
  endDate: string | null
  successCriteria: string[]
}

export function DeploymentWaveTracker() {
  const [waves, setWaves] = useState<DeploymentWave[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedWave, setExpandedWave] = useState<string | null>(null)
  const [advancing, setAdvancing] = useState<string | null>(null)

  const fetchWaves = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/phase11/deployment-waves')
      const data = await res.json()
      setWaves((data.waves ?? []).sort((a: DeploymentWave, b: DeploymentWave) => a.waveNumber - b.waveNumber))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchWaves() }, [fetchWaves])

  const advanceWave = async (waveId: string, status: string) => {
    setAdvancing(waveId)
    try {
      await fetch(`/api/phase11/deployment-waves/${waveId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      fetchWaves()
    } finally {
      setAdvancing(null)
    }
  }

  const statusColors: Record<string, string> = {
    planned: '#64748b', active: '#3b82f6', complete: '#22c55e', paused: '#f59e0b',
  }
  const statusIcons: Record<string, string> = {
    planned: '○', active: '◉', complete: '✓', paused: '⏸',
  }

  const activeWave = waves.find(w => w.status === 'active')
  const completedWaves = waves.filter(w => w.status === 'complete').length

  return (
    <div style={{ background: '#0f172a', color: '#e2e8f0', fontFamily: 'sans-serif', padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Deployment Wave Tracker</h2>
          <p style={{ margin: '4px 0 0', color: '#94a3b8', fontSize: 13 }}>
            {completedWaves}/{waves.length} waves complete
            {activeWave ? ` · Wave ${activeWave.waveNumber} active` : ''}
          </p>
        </div>
      </div>

      {/* Wave Progress Bar */}
      {waves.length > 0 && (
        <div style={{ background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 20 }}>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            {waves.map((wave, idx) => {
              const color = statusColors[wave.status]
              const isLast = idx === waves.length - 1
              return (
                <React.Fragment key={wave.id}>
                  <div style={{
                    flex: 1, height: 32, borderRadius: 6, background: color + '20',
                    border: `1px solid ${color}44`, display: 'flex', alignItems: 'center',
                    justifyContent: 'center', gap: 6, fontSize: 12, color,
                  }}>
                    <span style={{ fontWeight: 700 }}>{statusIcons[wave.status]}</span>
                    W{wave.waveNumber}
                  </div>
                  {!isLast && <div style={{ color: '#334155', fontSize: 16 }}>→</div>}
                </React.Fragment>
              )
            })}
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ color: '#64748b', textAlign: 'center', padding: 40 }}>Loading waves…</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {waves.map(wave => {
            const color = statusColors[wave.status]
            const isExpanded = expandedWave === wave.id
            return (
              <div
                key={wave.id}
                style={{
                  background: '#1e293b', borderRadius: 8,
                  border: `1px solid ${wave.status === 'active' ? '#3b82f644' : '#334155'}`,
                }}
              >
                <div
                  onClick={() => setExpandedWave(isExpanded ? null : wave.id)}
                  style={{ padding: 14, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                >
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontWeight: 700, fontSize: 15 }}>
                        Wave {wave.waveNumber}: {wave.waveName}
                      </span>
                      <span style={{
                        background: color + '22', color, border: `1px solid ${color}44`,
                        borderRadius: 4, padding: '2px 8px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                      }}>
                        {wave.status}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                      {wave.targetCustomers.length} customers
                      {wave.startDate ? ` · Started ${new Date(wave.startDate).toLocaleDateString()}` : ''}
                      {wave.endDate ? ` · Ends ${new Date(wave.endDate).toLocaleDateString()}` : ''}
                    </div>
                  </div>
                  <span style={{ color: '#64748b', fontSize: 14 }}>{isExpanded ? '▲' : '▼'}</span>
                </div>

                {isExpanded && (
                  <div style={{ borderTop: '1px solid #334155', padding: 14 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>
                          Target Customers ({wave.targetCustomers.length})
                        </div>
                        {wave.targetCustomers.map(c => (
                          <div key={c} style={{ fontSize: 12, color: '#cbd5e1', padding: '3px 0', borderBottom: '1px solid #1e293b' }}>
                            {c}
                          </div>
                        ))}
                        {wave.targetCustomers.length === 0 && (
                          <div style={{ fontSize: 12, color: '#475569' }}>No customers assigned</div>
                        )}
                      </div>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>
                          Success Criteria
                        </div>
                        {wave.successCriteria.map((c, i) => (
                          <div key={i} style={{ fontSize: 12, color: '#cbd5e1', padding: '3px 0', borderBottom: '1px solid #1e293b' }}>
                            · {c}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                      {wave.status === 'planned' && (
                        <button
                          disabled={advancing === wave.id}
                          onClick={() => advanceWave(wave.id, 'active')}
                          style={{
                            padding: '7px 14px', background: '#3b82f6', color: '#fff',
                            border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12,
                          }}
                        >
                          Start Wave
                        </button>
                      )}
                      {wave.status === 'active' && (
                        <>
                          <button
                            disabled={advancing === wave.id}
                            onClick={() => advanceWave(wave.id, 'complete')}
                            style={{
                              padding: '7px 14px', background: '#22c55e', color: '#fff',
                              border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12,
                            }}
                          >
                            Complete Wave
                          </button>
                          <button
                            disabled={advancing === wave.id}
                            onClick={() => advanceWave(wave.id, 'paused')}
                            style={{
                              padding: '7px 14px', background: '#f59e0b20', color: '#f59e0b',
                              border: '1px solid #f59e0b44', borderRadius: 6, cursor: 'pointer', fontSize: 12,
                            }}
                          >
                            Pause
                          </button>
                        </>
                      )}
                      {wave.status === 'paused' && (
                        <button
                          onClick={() => advanceWave(wave.id, 'active')}
                          style={{
                            padding: '7px 14px', background: '#3b82f620', color: '#3b82f6',
                            border: '1px solid #3b82f644', borderRadius: 6, cursor: 'pointer', fontSize: 12,
                          }}
                        >
                          Resume
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
          {waves.length === 0 && (
            <div style={{ textAlign: 'center', color: '#64748b', padding: 40 }}>
              No deployment waves configured.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
