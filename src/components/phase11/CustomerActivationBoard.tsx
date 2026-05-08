// Denver Engineering — Customer Activation Board (Phase 11)
// Kanban-style board showing pilot tenants moving through activation stages

import React, { useEffect, useState, useCallback } from 'react'

interface PilotTenant {
  id: string
  tenantId: string
  tenantName: string
  status: string
  healthScore: number
  churnRisk: 'low' | 'medium' | 'high'
  onboardingCompletePct: number
  csm: string | null
}

const COLUMNS = [
  { key: 'invited', label: 'Invited', color: '#64748b' },
  { key: 'provisioned', label: 'Provisioned', color: '#8b5cf6' },
  { key: 'onboarding', label: 'Onboarding', color: '#3b82f6' },
  { key: 'active', label: 'Active', color: '#22c55e' },
  { key: 'converted', label: 'Converted', color: '#06b6d4' },
]

function PilotCard({ pilot, onMove }: { pilot: PilotTenant; onMove?: (id: string, status: string) => void }) {
  const churnColors = { low: '#22c55e', medium: '#f59e0b', high: '#ef4444' }
  const healthColor = pilot.healthScore >= 70 ? '#22c55e' : pilot.healthScore >= 40 ? '#f59e0b' : '#ef4444'

  return (
    <div style={{
      background: '#0f172a', borderRadius: 8, padding: 12, marginBottom: 8,
      border: `1px solid ${pilot.churnRisk === 'high' ? '#ef444433' : '#1e293b'}`,
    }}>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{pilot.tenantName}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 11, color: '#64748b' }}>CSM: {pilot.csm ?? '—'}</span>
        <span style={{ fontWeight: 700, fontSize: 14, color: healthColor }}>{pilot.healthScore}</span>
      </div>
      <div style={{ background: '#1e293b', borderRadius: 3, height: 4 }}>
        <div style={{
          background: healthColor, borderRadius: 3, height: '100%',
          width: `${pilot.onboardingCompletePct}%`,
        }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 11 }}>
        <span style={{ color: '#64748b' }}>Onboarding: {pilot.onboardingCompletePct}%</span>
        <span style={{ color: churnColors[pilot.churnRisk] }}>
          {pilot.churnRisk} risk
        </span>
      </div>
      {onMove && pilot.status !== 'converted' && (
        <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
          {COLUMNS.map(col => {
            if (col.key === pilot.status) return null
            const colIdx = COLUMNS.findIndex(c => c.key === col.key)
            const curIdx = COLUMNS.findIndex(c => c.key === pilot.status)
            if (colIdx !== curIdx + 1) return null
            return (
              <button
                key={col.key}
                onClick={() => onMove(pilot.id, col.key)}
                style={{
                  padding: '3px 8px', background: col.color + '20', color: col.color,
                  border: `1px solid ${col.color}44`, borderRadius: 4, cursor: 'pointer', fontSize: 10,
                }}
              >
                → {col.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function CustomerActivationBoard() {
  const [pilots, setPilots] = useState<PilotTenant[]>([])
  const [loading, setLoading] = useState(true)

  const fetchPilots = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/phase11/pilots')
      const data = await res.json()
      setPilots(data.pilots ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchPilots() }, [fetchPilots])

  const movePilot = async (pilotId: string, newStatus: string) => {
    // Optimistic update
    setPilots(prev => prev.map(p => p.id === pilotId ? { ...p, status: newStatus } : p))
    await fetch(`/api/phase11/pilots/${pilotId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    })
    fetchPilots()
  }

  const pilotsByStatus = new Map(COLUMNS.map(c => [c.key, pilots.filter(p => p.status === c.key)]))
  const totalActive = pilots.filter(p => p.status === 'active' || p.status === 'converted').length

  return (
    <div style={{ background: '#0f172a', color: '#e2e8f0', fontFamily: 'sans-serif', padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Customer Activation Board</h2>
          <p style={{ margin: '4px 0 0', color: '#94a3b8', fontSize: 13 }}>
            {pilots.length} pilots · {totalActive} activated
          </p>
        </div>
      </div>

      {loading ? (
        <div style={{ color: '#64748b', textAlign: 'center', padding: 40 }}>Loading…</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${COLUMNS.length}, 1fr)`, gap: 12 }}>
          {COLUMNS.map(col => {
            const colPilots = pilotsByStatus.get(col.key) ?? []
            return (
              <div key={col.key}>
                <div style={{
                  padding: '8px 12px', background: col.color + '15',
                  border: `1px solid ${col.color}33`, borderRadius: 8, marginBottom: 10,
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <span style={{ fontWeight: 700, fontSize: 13, color: col.color }}>
                    {col.label}
                  </span>
                  <span style={{
                    background: col.color + '22', color: col.color, borderRadius: '50%',
                    width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 700,
                  }}>
                    {colPilots.length}
                  </span>
                </div>

                <div style={{ minHeight: 60 }}>
                  {colPilots.map(pilot => (
                    <PilotCard key={pilot.id} pilot={pilot} onMove={movePilot} />
                  ))}
                  {colPilots.length === 0 && (
                    <div style={{
                      padding: 12, border: '1px dashed #334155', borderRadius: 8,
                      textAlign: 'center', color: '#475569', fontSize: 12,
                    }}>
                      Empty
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
