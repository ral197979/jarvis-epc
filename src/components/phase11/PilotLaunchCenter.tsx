// Denver Engineering — Pilot Launch Center (Phase 11)
// Manage pilot tenant lifecycle: health, status, churn risk, and go-live readiness

import React, { useEffect, useState, useCallback } from 'react'

interface PilotTenant {
  id: string
  tenantId: string
  tenantName: string
  status: string
  healthScore: number
  onboardingCompletePct: number
  trainingCompletePct: number
  adoptionScore: number
  openIncidents: number
  churnRisk: 'low' | 'medium' | 'high'
  csm: string | null
  activatedAt: string | null
  convertedAt: string | null
}

interface PilotLaunchCenterProps {
  onEscalateToCSM?: (pilotId: string, tenantName: string) => void
}

function HealthBar({ value }: { value: number }) {
  const color = value >= 70 ? '#22c55e' : value >= 40 ? '#f59e0b' : '#ef4444'
  return (
    <div style={{ background: '#1e293b', borderRadius: 4, height: 8, width: '100%' }}>
      <div
        style={{
          background: color, borderRadius: 4, height: '100%',
          width: `${Math.min(100, value)}%`, transition: 'width 0.3s',
        }}
      />
    </div>
  )
}

function ChurnRiskBadge({ risk }: { risk: 'low' | 'medium' | 'high' }) {
  const colors = { low: '#22c55e', medium: '#f59e0b', high: '#ef4444' }
  return (
    <span
      style={{
        background: colors[risk] + '22', color: colors[risk],
        border: `1px solid ${colors[risk]}44`, borderRadius: 4,
        padding: '2px 8px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
      }}
    >
      {risk}
    </span>
  )
}

export function PilotLaunchCenter({ onEscalateToCSM }: PilotLaunchCenterProps) {
  const [pilots, setPilots] = useState<PilotTenant[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<string>('all')
  const [selectedPilotId, setSelectedPilotId] = useState<string | null>(null)

  const fetchPilots = useCallback(async () => {
    try {
      const url = filter === 'all'
        ? '/api/phase11/pilots'
        : `/api/phase11/pilots?status=${filter}`
      const res = await fetch(url)
      if (!res.ok) throw new Error('Failed to fetch pilots')
      const data = await res.json()
      setPilots(data.pilots ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => { fetchPilots() }, [fetchPilots])

  const handleActivate = async (pilotId: string) => {
    await fetch(`/api/phase11/pilots/${pilotId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'active' }),
    })
    fetchPilots()
  }

  const statusOptions = ['all', 'invited', 'provisioned', 'onboarding', 'active', 'at_risk']
  const atRiskCount = pilots.filter(p => p.churnRisk === 'high' || p.healthScore < 70).length

  return (
    <div style={{ background: '#0f172a', color: '#e2e8f0', fontFamily: 'sans-serif', padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Pilot Launch Center</h2>
          <p style={{ margin: '4px 0 0', color: '#94a3b8', fontSize: 13 }}>
            {pilots.length} pilots · {atRiskCount} at risk
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {statusOptions.map(s => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              style={{
                padding: '6px 12px', borderRadius: 6, border: '1px solid',
                borderColor: filter === s ? '#3b82f6' : '#334155',
                background: filter === s ? '#3b82f620' : 'transparent',
                color: filter === s ? '#3b82f6' : '#94a3b8',
                cursor: 'pointer', fontSize: 12, textTransform: 'capitalize',
              }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {loading && <div style={{ color: '#64748b', textAlign: 'center', padding: 40 }}>Loading pilots…</div>}
      {error && <div style={{ color: '#ef4444', padding: 12, background: '#ef444420', borderRadius: 6 }}>{error}</div>}

      {!loading && !error && (
        <div style={{ display: 'grid', gap: 12 }}>
          {pilots.map(pilot => (
            <div
              key={pilot.id}
              onClick={() => setSelectedPilotId(selectedPilotId === pilot.id ? null : pilot.id)}
              style={{
                background: '#1e293b', borderRadius: 8, padding: 16, cursor: 'pointer',
                border: `1px solid ${selectedPilotId === pilot.id ? '#3b82f6' : '#334155'}`,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{pilot.tenantName}</div>
                  <div style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>
                    {pilot.status.replace('_', ' ')} · CSM: {pilot.csm ?? '—'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <ChurnRiskBadge risk={pilot.churnRisk} />
                  <span style={{ fontWeight: 700, fontSize: 18, color: pilot.healthScore >= 70 ? '#22c55e' : '#ef4444' }}>
                    {pilot.healthScore}
                  </span>
                </div>
              </div>

              <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                {[
                  { label: 'Onboarding', value: pilot.onboardingCompletePct },
                  { label: 'Training', value: pilot.trainingCompletePct },
                  { label: 'Adoption', value: pilot.adoptionScore },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 11, color: '#94a3b8' }}>{label}</span>
                      <span style={{ fontSize: 11, fontWeight: 600 }}>{value}%</span>
                    </div>
                    <HealthBar value={value} />
                  </div>
                ))}
              </div>

              {selectedPilotId === pilot.id && (
                <div style={{ marginTop: 12, display: 'flex', gap: 8, borderTop: '1px solid #334155', paddingTop: 12 }}>
                  {pilot.status === 'provisioned' && (
                    <button
                      onClick={e => { e.stopPropagation(); handleActivate(pilot.id) }}
                      style={{
                        padding: '6px 14px', background: '#22c55e', color: '#fff',
                        border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12,
                      }}
                    >
                      Activate
                    </button>
                  )}
                  {onEscalateToCSM && (pilot.churnRisk === 'high' || pilot.healthScore < 50) && (
                    <button
                      onClick={e => { e.stopPropagation(); onEscalateToCSM(pilot.id, pilot.tenantName) }}
                      style={{
                        padding: '6px 14px', background: '#ef4444', color: '#fff',
                        border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12,
                      }}
                    >
                      Escalate to CSM
                    </button>
                  )}
                  <span style={{ color: '#64748b', fontSize: 12, padding: '6px 0' }}>
                    {pilot.openIncidents} open incident(s)
                  </span>
                </div>
              )}
            </div>
          ))}
          {pilots.length === 0 && (
            <div style={{ textAlign: 'center', color: '#64748b', padding: 40 }}>
              No pilots found for this filter.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
