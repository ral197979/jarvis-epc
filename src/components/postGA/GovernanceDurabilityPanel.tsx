// Denver Engineering — Governance Durability Panel (Post-GA)
// Displays governance pass rates, replay drift alerts, and durability trends over time

import React, { useState, useEffect } from 'react'

interface GovernanceRecord {
  id: string
  dimension: string
  passRate: number
  previousPassRate: number
  trend: 'improving' | 'stable' | 'degrading'
  auditCount: number
  flaggedCount: number
  measuredAt: string
}

interface ReplayDriftRecord {
  id: string
  tenantId: string
  metric: string
  baselineValue: number
  currentValue: number
  driftPct: number
  isAlert: boolean
  resolvedAt: string | null
  detectedAt: string
}

interface DurabilityData {
  governanceRecords: GovernanceRecord[]
  replayDrifts: ReplayDriftRecord[]
  overallPassRate: number
  isDurable: boolean
  openAlerts: number
}

const TREND_ICONS = { improving: '↑', stable: '→', degrading: '↓' }
const TREND_COLORS = { improving: '#22c55e', stable: '#94a3b8', degrading: '#ef4444' }

function PassRateBar({ rate }: { rate: number }) {
  const pct = Math.round(rate * 100)
  const color = rate >= 0.98 ? '#22c55e' : rate >= 0.95 ? '#eab308' : '#ef4444'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 6, background: '#1e293b', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3 }} />
      </div>
      <div style={{ fontSize: 12, color, fontWeight: 600, minWidth: 44, textAlign: 'right' }}>
        {pct}%
      </div>
    </div>
  )
}

function GovernanceRow({ record }: { record: GovernanceRecord }) {
  const trend = record.trend
  return (
    <div style={{
      background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8,
      padding: 14, marginBottom: 8,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', textTransform: 'capitalize' }}>
          {record.dimension.replace(/_/g, ' ')}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: TREND_COLORS[trend] }}>
            {TREND_ICONS[trend]} {trend}
          </span>
          {record.flaggedCount > 0 && (
            <span style={{ fontSize: 11, background: '#1c0000', color: '#f87171', padding: '2px 6px', borderRadius: 4 }}>
              {record.flaggedCount} flagged
            </span>
          )}
        </div>
      </div>
      <PassRateBar rate={record.passRate} />
      <div style={{ fontSize: 11, color: '#475569', marginTop: 6 }}>
        {record.auditCount} audits · prev: {(record.previousPassRate * 100).toFixed(1)}%
      </div>
    </div>
  )
}

function DriftAlert({ drift }: { drift: ReplayDriftRecord }) {
  const driftPct = (drift.driftPct * 100).toFixed(2)
  return (
    <div style={{
      background: '#1c0000', border: '1px solid #ef444460', borderRadius: 8,
      padding: 12, marginBottom: 8,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#f87171' }}>{drift.metric}</div>
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
            Tenant: {drift.tenantId} · Drift: {driftPct}%
          </div>
        </div>
        <div style={{ fontSize: 11, color: '#64748b' }}>
          {new Date(drift.detectedAt).toLocaleString()}
        </div>
      </div>
      <div style={{ fontSize: 11, color: '#475569', marginTop: 6 }}>
        Baseline: {drift.baselineValue.toFixed(4)} → Current: {drift.currentValue.toFixed(4)}
      </div>
    </div>
  )
}

export function GovernanceDurabilityPanel() {
  const [data, setData] = useState<DurabilityData | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'governance' | 'replay'>('governance')

  const load = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/postGA/governance/durability')
      setData(await res.json())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const tabStyle = (active: boolean) => ({
    padding: '6px 16px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
    border: active ? '1px solid #38bdf8' : '1px solid #1e293b',
    background: active ? '#0f2241' : 'transparent', color: active ? '#7dd3fc' : '#64748b',
  })

  return (
    <div style={{ background: '#060d1a', minHeight: '100vh', fontFamily: 'sans-serif', padding: 24, color: '#e2e8f0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 700 }}>🏛 Governance Durability Panel</div>
          <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>
            Post-GA governance pass rates and replay drift monitoring
          </div>
        </div>
        <button
          onClick={load}
          disabled={loading}
          style={{
            padding: '7px 14px', borderRadius: 6, border: '1px solid #1e3a5f',
            background: '#0f2241', color: '#7dd3fc', cursor: 'pointer', fontSize: 12,
          }}
        >
          {loading ? '…' : '↻'}
        </button>
      </div>

      {data && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
          <div style={{
            background: data.isDurable ? '#052e16' : '#1c0000',
            border: `1px solid ${data.isDurable ? '#22c55e40' : '#ef444440'}`,
            borderRadius: 8, padding: 14,
          }}>
            <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', marginBottom: 4 }}>Durability</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: data.isDurable ? '#22c55e' : '#ef4444' }}>
              {data.isDurable ? 'DURABLE' : 'AT RISK'}
            </div>
          </div>
          <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: 14 }}>
            <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', marginBottom: 4 }}>Overall Pass Rate</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: data.overallPassRate >= 0.98 ? '#22c55e' : '#eab308' }}>
              {(data.overallPassRate * 100).toFixed(1)}%
            </div>
          </div>
          <div style={{
            background: data.openAlerts === 0 ? '#052e16' : '#1c0000',
            border: `1px solid ${data.openAlerts === 0 ? '#22c55e40' : '#ef444440'}`,
            borderRadius: 8, padding: 14,
          }}>
            <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', marginBottom: 4 }}>Open Drift Alerts</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: data.openAlerts === 0 ? '#22c55e' : '#ef4444' }}>
              {data.openAlerts}
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button style={tabStyle(tab === 'governance')} onClick={() => setTab('governance')}>Governance Dimensions</button>
        <button style={tabStyle(tab === 'replay')} onClick={() => setTab('replay')}>
          Replay Drift
          {data && data.openAlerts > 0 && (
            <span style={{ marginLeft: 6, background: '#ef4444', color: '#fff', borderRadius: 10, padding: '1px 6px', fontSize: 10 }}>
              {data.openAlerts}
            </span>
          )}
        </button>
      </div>

      {loading && !data ? (
        <div style={{ color: '#475569', textAlign: 'center', padding: 80 }}>Loading…</div>
      ) : data ? (
        tab === 'governance' ? (
          data.governanceRecords.length === 0
            ? <div style={{ color: '#475569', textAlign: 'center', padding: 40 }}>No governance records.</div>
            : data.governanceRecords.map(r => <GovernanceRow key={r.id} record={r} />)
        ) : (
          data.replayDrifts.length === 0
            ? <div style={{ color: '#22c55e', textAlign: 'center', padding: 40 }}>✓ No replay drift alerts.</div>
            : data.replayDrifts.filter(d => d.isAlert).map(d => <DriftAlert key={d.id} drift={d} />)
        )
      ) : null}
    </div>
  )
}
