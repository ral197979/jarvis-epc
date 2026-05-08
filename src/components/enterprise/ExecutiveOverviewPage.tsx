/**
 * Denver Engineering — Executive Overview Page (v4.40.0)
 * ────────────────────────────────────────────────────────
 * Ava Phase 4 — Top-level executive dashboard. Aggregates global
 * readiness, portfolio risk, escalation hotspots, AI acceptance rate,
 * and operational throughput in a responsive grid.
 */
import React, { useEffect, useState } from 'react'
import { PortfolioHeatmap } from './PortfolioHeatmap'
import { EscalationRadar  } from './EscalationRadar'
import { ContractorPerformanceGrid } from './ContractorPerformanceGrid'

interface OverviewData {
  actions: {
    open_count:       number
    in_progress_count: number
    completed_count:  number
    breached_count:   number
    escalated_count:  number
  }
  readiness: Array<{ state: string; count: number }>
  incidents: Array<{ severity: string; count: number }>
  ai_recommendations: { pending_approvals: number; executed_today: number }
}

function KpiCard({ label, value, sub, color = '#111827' }: {
  label: string; value: string | number; sub?: string; color?: string
}) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8,
      padding: '14px 16px', minWidth: 120 }}>
      <div style={{ fontSize: 24, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 11, color: '#374151', marginTop: 2 }}>{label}</div>
      {sub && <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

export function ExecutiveOverviewPage() {
  const [data, setData]     = useState<OverviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'portfolio' | 'escalations' | 'contractors'>('portfolio')

  useEffect(() => {
    setLoading(true)
    fetch('/api/v1/executive/overview')
      .then(r => r.json())
      .then(j => setData(j.data ?? null))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div style={{ padding: 24, color: '#9ca3af', fontSize: 13 }}>Loading executive overview…</div>
  if (!data)   return <div style={{ padding: 24, color: '#dc2626', fontSize: 13 }}>Failed to load overview.</div>

  const readyCount = data.readiness.find(r => r.state === 'ready')?.count ?? 0
  const totalRS    = data.readiness.reduce((s, r) => s + Number(r.count), 0)
  const readyPct   = totalRS > 0 ? Math.round((readyCount / totalRS) * 100) : 0

  const TABS = [
    { key: 'portfolio', label: 'Portfolio' },
    { key: 'escalations', label: 'Escalations' },
    { key: 'contractors', label: 'Contractors' },
  ] as const

  return (
    <div style={{ padding: 0 }}>
      {/* KPI strip */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <KpiCard label="Open Actions"    value={data.actions.open_count} color="#2563eb" />
        <KpiCard label="SLA Breached"    value={data.actions.breached_count}   color="#dc2626" sub="needs attention" />
        <KpiCard label="Escalated"       value={data.actions.escalated_count}  color="#f97316" />
        <KpiCard label="Readiness Ready" value={`${readyPct}%`} color="#10b981" sub={`${readyCount}/${totalRS} entities`} />
        <KpiCard label="AI Pending"      value={data.ai_recommendations.pending_approvals} color="#7c3aed" sub="approvals" />
        <KpiCard label="Active Incidents" value={data.incidents.reduce((s, i) => s + Number(i.count), 0)}
          color={data.incidents.length > 0 ? '#dc2626' : '#10b981'} />
      </div>

      {/* Readiness state summary */}
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '12px 14px', marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 8 }}>Readiness by State</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {[
            { key: 'ready',               color: '#10b981', label: 'Ready' },
            { key: 'conditionally_ready', color: '#d97706', label: 'Conditional' },
            { key: 'at_risk',             color: '#f97316', label: 'At Risk' },
            { key: 'not_ready',           color: '#dc2626', label: 'Not Ready' },
          ].map(({ key, color, label }) => {
            const count = data.readiness.find(r => r.state === key)?.count ?? 0
            const pct   = totalRS > 0 ? Math.round((Number(count) / totalRS) * 100) : 0
            return (
              <div key={key} style={{ textAlign: 'center', minWidth: 80 }}>
                <div style={{ fontSize: 18, fontWeight: 700, color }}>{count}</div>
                <div style={{ fontSize: 9, color: '#6b7280' }}>{label}</div>
                <div style={{ height: 3, background: '#f3f4f6', borderRadius: 2, marginTop: 4 }}>
                  <div style={{ height: 3, width: `${pct}%`, background: color, borderRadius: 2 }} />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Tab panels */}
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ display: 'flex', borderBottom: '1px solid #e5e7eb' }}>
          {TABS.map(t => (
            <button key={t.key} onClick={() => setActiveTab(t.key)}
              style={{ flex: 1, padding: '8px 0', fontSize: 12, fontWeight: activeTab === t.key ? 600 : 400,
                color: activeTab === t.key ? '#2563eb' : '#6b7280',
                background: 'none', border: 'none', cursor: 'pointer',
                borderBottom: activeTab === t.key ? '2px solid #2563eb' : '2px solid transparent' }}>
              {t.label}
            </button>
          ))}
        </div>
        <div>
          {activeTab === 'portfolio'   && <PortfolioHeatmap />}
          {activeTab === 'escalations' && <EscalationRadar />}
          {activeTab === 'contractors' && <ContractorPerformanceGrid />}
        </div>
      </div>
    </div>
  )
}
