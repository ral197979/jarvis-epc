// Denver Engineering — Replay Integrity Dashboard (Post-GA)
// Monitors replay determinism, drift alerts, and governance gate status in production

import React, { useState, useEffect } from 'react'

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

interface LaunchGate {
  gateName: string
  category: 'replay' | 'governance' | 'performance' | 'compliance'
  status: 'pass' | 'warn' | 'fail'
  currentValue: number
  requiredValue: number
  detail: string
}

interface ReplayIntegrityData {
  driftRecords: ReplayDriftRecord[]
  launchGates: LaunchGate[]
  openAlertCount: number
  replayGatesPassing: boolean
  governanceGatesPassing: boolean
  overallPassRate: number
  isValidationPassing: boolean
  determinismRate: number
}

const GATE_STATUS_COLORS = { pass: '#22c55e', warn: '#eab308', fail: '#ef4444' }
const GATE_STATUS_ICONS = { pass: '✓', warn: '⚠', fail: '✗' }

function DeterminismGauge({ rate }: { rate: number }) {
  const pct = rate * 100
  const color = rate === 1.0 ? '#22c55e' : rate >= 0.99 ? '#eab308' : '#ef4444'
  const circumference = 2 * Math.PI * 40
  const dash = (pct / 100) * circumference
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <svg width={100} height={100} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={50} cy={50} r={40} fill="none" stroke="#1e293b" strokeWidth={8} />
        <circle
          cx={50} cy={50} r={40} fill="none"
          stroke={color} strokeWidth={8}
          strokeDasharray={`${dash} ${circumference}`}
          strokeLinecap="round"
        />
      </svg>
      <div style={{ marginTop: -60, textAlign: 'center', zIndex: 1 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color }}>{pct.toFixed(2)}%</div>
        <div style={{ fontSize: 10, color: '#475569' }}>determinism</div>
      </div>
      <div style={{ marginTop: 50 }} />
    </div>
  )
}

function GateRow({ gate }: { gate: LaunchGate }) {
  const color = GATE_STATUS_COLORS[gate.status]
  const icon = GATE_STATUS_ICONS[gate.status]
  const valuePct = gate.requiredValue > 0
    ? Math.min(100, Math.round((gate.currentValue / gate.requiredValue) * 100))
    : 100
  return (
    <div style={{
      background: '#0f172a',
      border: `1px solid ${color}30`,
      borderRadius: 8, padding: 12, marginBottom: 8,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color, fontSize: 14, fontWeight: 700 }}>{icon}</span>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0' }}>{gate.gateName}</div>
            <div style={{ fontSize: 10, color: '#475569', textTransform: 'capitalize' }}>{gate.category}</div>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color }}>
            {gate.currentValue.toFixed(3)} / {gate.requiredValue.toFixed(3)}
          </div>
          <span style={{
            fontSize: 10, padding: '1px 6px', borderRadius: 4,
            background: `${color}20`, color, textTransform: 'uppercase',
          }}>
            {gate.status}
          </span>
        </div>
      </div>
      <div style={{ height: 4, background: '#1e293b', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${valuePct}%`, height: '100%', background: color, borderRadius: 2 }} />
      </div>
      {gate.detail && (
        <div style={{ fontSize: 11, color: '#475569', marginTop: 5 }}>{gate.detail}</div>
      )}
    </div>
  )
}

function DriftRow({ record }: { record: ReplayDriftRecord }) {
  const driftPct = (record.driftPct * 100).toFixed(3)
  const isOpen = record.isAlert && !record.resolvedAt
  return (
    <div style={{
      background: isOpen ? '#1c0000' : '#0f172a',
      border: `1px solid ${isOpen ? '#ef444460' : '#1e293b'}`,
      borderRadius: 8, padding: 12, marginBottom: 8,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: isOpen ? '#f87171' : '#94a3b8' }}>
              {record.metric}
            </span>
            {isOpen && (
              <span style={{ fontSize: 10, background: '#ef4444', color: '#fff', padding: '1px 6px', borderRadius: 4 }}>
                ALERT
              </span>
            )}
            {record.resolvedAt && (
              <span style={{ fontSize: 10, background: '#052e16', color: '#22c55e', padding: '1px 6px', borderRadius: 4 }}>
                resolved
              </span>
            )}
          </div>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
            Tenant: {record.tenantId}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: isOpen ? '#f87171' : '#94a3b8' }}>
            {driftPct}%
          </div>
          <div style={{ fontSize: 10, color: '#475569' }}>drift</div>
        </div>
      </div>
      <div style={{ fontSize: 11, color: '#475569', marginTop: 6 }}>
        Baseline: {record.baselineValue.toFixed(4)} → Current: {record.currentValue.toFixed(4)}
        {' · '}Detected: {new Date(record.detectedAt).toLocaleString()}
      </div>
    </div>
  )
}

export function ReplayIntegrityDashboard() {
  const [data, setData] = useState<ReplayIntegrityData | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'gates' | 'drift'>('gates')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')

  const load = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/postGA/replay/integrity')
      setData(await res.json())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const filteredGates = (data?.launchGates ?? []).filter(
    g => categoryFilter === 'all' || g.category === categoryFilter
  )

  const tabStyle = (active: boolean) => ({
    padding: '6px 14px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
    border: active ? '1px solid #38bdf8' : '1px solid #1e293b',
    background: active ? '#0f2241' : 'transparent', color: active ? '#7dd3fc' : '#64748b',
  })

  return (
    <div style={{ background: '#060d1a', minHeight: '100vh', fontFamily: 'sans-serif', padding: 24, color: '#e2e8f0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 700 }}>🔁 Replay Integrity Dashboard</div>
          <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>
            Determinism monitoring, drift alerts, and launch gate validation
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
        <div style={{ display: 'flex', gap: 16, marginBottom: 24, alignItems: 'flex-start' }}>
          <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: 20, textAlign: 'center' }}>
            <DeterminismGauge rate={data.determinismRate} />
          </div>
          <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
            {[
              {
                label: 'Validation', value: data.isValidationPassing ? 'PASSING' : 'FAILING',
                color: data.isValidationPassing ? '#22c55e' : '#ef4444',
                bg: data.isValidationPassing ? '#052e16' : '#1c0000',
              },
              {
                label: 'Pass Rate', value: `${(data.overallPassRate * 100).toFixed(0)}%`,
                color: data.overallPassRate >= 0.95 ? '#22c55e' : '#eab308',
                bg: '#0f172a',
              },
              {
                label: 'Replay Gates', value: data.replayGatesPassing ? '✓ Pass' : '✗ Fail',
                color: data.replayGatesPassing ? '#22c55e' : '#ef4444',
                bg: data.replayGatesPassing ? '#052e16' : '#1c0000',
              },
              {
                label: 'Gov Gates', value: data.governanceGatesPassing ? '✓ Pass' : '✗ Fail',
                color: data.governanceGatesPassing ? '#22c55e' : '#ef4444',
                bg: data.governanceGatesPassing ? '#052e16' : '#1c0000',
              },
              {
                label: 'Open Drift Alerts', value: data.openAlertCount,
                color: data.openAlertCount === 0 ? '#22c55e' : '#ef4444',
                bg: data.openAlertCount === 0 ? '#052e16' : '#1c0000',
              },
            ].map(stat => (
              <div key={stat.label} style={{ background: stat.bg, border: `1px solid ${stat.color}30`, borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', marginBottom: 3 }}>{stat.label}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: stat.color }}>{stat.value}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={tabStyle(tab === 'gates')} onClick={() => setTab('gates')}>Launch Gates</button>
          <button style={tabStyle(tab === 'drift')} onClick={() => setTab('drift')}>
            Drift Records
            {data && data.openAlertCount > 0 && (
              <span style={{ marginLeft: 6, background: '#ef4444', color: '#fff', borderRadius: 10, padding: '1px 6px', fontSize: 10 }}>
                {data.openAlertCount}
              </span>
            )}
          </button>
        </div>
        {tab === 'gates' && (
          <select
            value={categoryFilter}
            onChange={e => setCategoryFilter(e.target.value)}
            style={{
              background: '#0f172a', border: '1px solid #1e293b', borderRadius: 6,
              color: '#94a3b8', padding: '5px 10px', fontSize: 12,
            }}
          >
            <option value="all">All Categories</option>
            <option value="replay">Replay</option>
            <option value="governance">Governance</option>
            <option value="performance">Performance</option>
            <option value="compliance">Compliance</option>
          </select>
        )}
      </div>

      {loading && !data ? (
        <div style={{ color: '#475569', textAlign: 'center', padding: 80 }}>Loading…</div>
      ) : data ? (
        tab === 'gates' ? (
          filteredGates.length === 0
            ? <div style={{ color: '#475569', textAlign: 'center', padding: 40 }}>No gates found.</div>
            : filteredGates.map(g => <GateRow key={g.gateName} gate={g} />)
        ) : (
          data.driftRecords.length === 0
            ? <div style={{ color: '#22c55e', textAlign: 'center', padding: 40 }}>✓ No drift records.</div>
            : data.driftRecords.map(r => <DriftRow key={r.id} record={r} />)
        )
      ) : null}
    </div>
  )
}
