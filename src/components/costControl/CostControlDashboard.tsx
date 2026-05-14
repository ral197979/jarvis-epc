/**
 * Denver Engineering — Cost Control Dashboard (v10.10.0)
 *
 * KPI strip · Waterfall chart · Monthly trend · CO table · Top subs table
 * All charts are custom SVG — no external chart dependencies.
 */
import React, { useEffect, useState, useCallback } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface MonthlyTrend {
  month:  string
  acwp:   number
  eac:    number
  bcwp:   number
  bcws:   number
}

interface TopSubcontractor {
  subcontractId: string
  vendorName:    string
  scNumber:      string
  contractValue: number
  invoicedTotal: number
  approvedTotal: number
  percentBilled: number
  status:        string
}

interface ChangeOrderSummary {
  id:          string
  coNumber:    number
  title:       string
  costImpact:  number
  status:      string
  submittedAt: string | null
}

interface Snapshot {
  projectId:      string
  originalBac:    number
  approvedCo:     number
  pendingCo:      number
  revisedBudget:  number
  committedSubs:  number
  invoicedToDate: number
  approvedInv:    number
  acwp:           number
  eac:            number | null
  cpi:            number | null
  spi:            number | null
  bcwp:           number | null
  bcws:           number | null
  vac:            number | null
  pctSpent:       number
  trend:          MonthlyTrend[]
  topSubs:        TopSubcontractor[]
  recentCOs:      ChangeOrderSummary[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number | null | undefined, decimals = 0) => {
  if (n === null || n === undefined) return '—'
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${n < 0 ? '-' : ''}$${(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000)     return `${n < 0 ? '-' : ''}$${(abs / 1_000).toFixed(decimals === 0 ? 0 : 1)}K`
  return `$${n.toLocaleString()}`
}

const fmtN = (n: number | null | undefined, dp = 2) =>
  n === null || n === undefined ? '—' : n.toFixed(dp)

const coStatusColor: Record<string, string> = {
  draft:     'var(--jarvis-ts)',
  submitted: '#f59e0b',
  approved:  '#22c55e',
  rejected:  '#ef4444',
  void:      'var(--jarvis-ts)',
}

const subStatusColor: Record<string, string> = {
  draft:    'var(--jarvis-ts)',
  active:   '#22c55e',
  complete: '#3b82f6',
  disputed: '#f59e0b',
  void:     '#ef4444',
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({
  label, value, sub, accent = 'var(--jarvis-a)', onClick,
}: { label: string; value: string; sub?: string; accent?: string; onClick?: () => void }) {
  return (
    <div onClick={onClick} style={{
      background: 'var(--jarvis-s2)', border: '1px solid var(--jarvis-b)',
      borderRadius: 10, padding: '14px 18px', flex: '1 1 140px', minWidth: 120,
      cursor: onClick ? 'pointer' : 'default',
      transition: onClick ? 'opacity .15s' : undefined,
    }}
    onMouseEnter={onClick ? e => (e.currentTarget.style.opacity = '.8') : undefined}
    onMouseLeave={onClick ? e => (e.currentTarget.style.opacity = '1') : undefined}
    >
      <div style={{ fontSize: 11, color: 'var(--jarvis-ts)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: accent }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--jarvis-ts)', marginTop: 3 }}>{sub}</div>}
    </div>
  )
}

// ─── Waterfall Chart ─────────────────────────────────────────────────────────

interface WaterfallBar { label: string; value: number; color: string; cumulative: number }

function WaterfallChart({ snap }: { snap: Snapshot }) {
  const bars: WaterfallBar[] = [
    { label: 'Original BAC',   value: snap.originalBac,   color: '#3b82f6', cumulative: 0 },
    { label: 'Approved COs',   value: snap.approvedCo,    color: '#22c55e', cumulative: snap.originalBac },
    { label: 'Revised Budget', value: snap.revisedBudget,  color: '#6366f1', cumulative: 0 },
    { label: 'Committed Subs', value: snap.committedSubs,  color: '#f59e0b', cumulative: 0 },
    { label: 'Invoiced',       value: snap.invoicedToDate, color: '#fb923c', cumulative: 0 },
    { label: 'ACWP',           value: snap.acwp,           color: '#ef4444', cumulative: 0 },
    ...(snap.eac !== null
      ? [{ label: 'EAC', value: snap.eac, color: snap.eac > snap.revisedBudget ? '#dc2626' : '#22c55e', cumulative: 0 }]
      : []),
  ]

  const W = 560, H = 180, PAD = { t: 16, r: 16, b: 44, l: 56 }
  const chartW = W - PAD.l - PAD.r
  const chartH = H - PAD.t - PAD.b
  const maxVal = Math.max(...bars.map(b => b.value)) * 1.15
  const barW   = Math.floor(chartW / bars.length) - 4
  const scaleY = (v: number) => chartH - (v / maxVal) * chartH

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(f => Math.round(f * maxVal))

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: W }}>
      {/* Y-axis ticks */}
      {yTicks.map(t => {
        const y = PAD.t + scaleY(t)
        return (
          <g key={t}>
            <line x1={PAD.l} y1={y} x2={W - PAD.r} y2={y} stroke="var(--jarvis-b)" strokeWidth={1} strokeDasharray="3 3" />
            <text x={PAD.l - 6} y={y + 4} textAnchor="end" fontSize={9} fill="var(--jarvis-ts)">{fmt(t)}</text>
          </g>
        )
      })}
      {/* Bars */}
      {bars.map((b, i) => {
        const x = PAD.l + i * (chartW / bars.length) + 2
        const barH = (b.value / maxVal) * chartH
        const y = PAD.t + scaleY(b.value)
        return (
          <g key={b.label}>
            <rect x={x} y={y} width={barW} height={barH} rx={3} fill={b.color} opacity={0.85} />
            <text x={x + barW / 2} y={H - PAD.b + 14} textAnchor="middle" fontSize={8.5} fill="var(--jarvis-ts)">{b.label}</text>
            <text x={x + barW / 2} y={y - 3} textAnchor="middle" fontSize={8} fill={b.color} fontWeight={600}>{fmt(b.value)}</text>
          </g>
        )
      })}
      {/* Axes */}
      <line x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={H - PAD.b} stroke="var(--jarvis-b)" strokeWidth={1} />
      <line x1={PAD.l} y1={H - PAD.b} x2={W - PAD.r} y2={H - PAD.b} stroke="var(--jarvis-b)" strokeWidth={1} />
    </svg>
  )
}

// ─── Trend Chart ──────────────────────────────────────────────────────────────

function TrendChart({ data }: { data: MonthlyTrend[] }) {
  if (data.length < 2) {
    return (
      <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--jarvis-ts)', fontSize: 12 }}>
        Not enough snapshot data for trend
      </div>
    )
  }

  const W = 560, H = 160, PAD = { t: 12, r: 16, b: 40, l: 56 }
  const chartW = W - PAD.l - PAD.r
  const chartH = H - PAD.t - PAD.b
  const maxVal = Math.max(...data.flatMap(d => [d.acwp, d.eac, d.bcwp, d.bcws])) * 1.1 || 1

  const xOf = (i: number) => PAD.l + (i / (data.length - 1)) * chartW
  const yOf = (v: number) => PAD.t + chartH - (v / maxVal) * chartH

  const series = [
    { key: 'acwp' as const, color: '#ef4444', label: 'ACWP' },
    { key: 'eac'  as const, color: '#f59e0b', label: 'EAC' },
    { key: 'bcwp' as const, color: '#22c55e', label: 'BCWP' },
    { key: 'bcws' as const, color: '#3b82f6', label: 'BCWS' },
  ]

  const pathOf = (key: keyof MonthlyTrend) =>
    data.map((d, i) => `${i === 0 ? 'M' : 'L'}${xOf(i)},${yOf(d[key] as number)}`).join(' ')

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: W }}>
      {series.map(s => (
        <path key={s.key} d={pathOf(s.key)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" />
      ))}
      {/* X labels */}
      {data.map((d, i) => (
        <text key={d.month} x={xOf(i)} y={H - PAD.b + 14} textAnchor="middle" fontSize={8} fill="var(--jarvis-ts)">
          {d.month.slice(5)}
        </text>
      ))}
      {/* Legend */}
      {series.map((s, i) => (
        <g key={s.label} transform={`translate(${PAD.l + i * 72}, ${H - 8})`}>
          <rect x={0} y={-6} width={10} height={4} rx={1} fill={s.color} />
          <text x={13} y={0} fontSize={8} fill="var(--jarvis-ts)">{s.label}</text>
        </g>
      ))}
      {/* Axes */}
      <line x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={H - PAD.b} stroke="var(--jarvis-b)" strokeWidth={1} />
      <line x1={PAD.l} y1={H - PAD.b} x2={W - PAD.r} y2={H - PAD.b} stroke="var(--jarvis-b)" strokeWidth={1} />
    </svg>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface Props {
  policy?:     Record<string, unknown>
  biz?:        Record<string, unknown>
  onNavigate?: (tab: string) => void
}

const DEMO_PROJECT = 'demo'

export default function CostControlDashboard({ biz, onNavigate }: Props) {
  const [projectId, setProjectId] = useState<string>(DEMO_PROJECT)
  const [snap,      setSnap]      = useState<Snapshot | null>(null)
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState<string | null>(null)

  const load = useCallback(async (pid: string) => {
    setLoading(true)
    setError(null)
    try {
      const res  = await fetch(`/api/v1/projects/${pid}/cost-control`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as { snapshot: Snapshot }
      setSnap(data.snapshot)
    } catch (e) {
      setError('Failed to load cost control data')
    } finally {
      setLoading(false)
    }
  }, [])

  // derive project list from biz if available
  const projects = (() => {
    if (!biz?.projects) return []
    try { return biz.projects as { id: string; name: string }[] }
    catch { return [] }
  })()

  useEffect(() => {
    load(projectId)
  }, [load, projectId])

  return (
    <div style={{ padding: '24px', maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--jarvis-t)' }}>Cost Control Dashboard</h2>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--jarvis-ts)' }}>Budget · Change Orders · Subcontracts · EVM</p>
        </div>
        {projects.length > 0 && (
          <select
            value={projectId}
            onChange={e => setProjectId(e.target.value)}
            style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--jarvis-b)', background: 'var(--jarvis-s2)', color: 'var(--jarvis-t)', fontSize: 13 }}
          >
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        )}
        <button
          onClick={() => load(projectId)}
          disabled={loading}
          style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid var(--jarvis-b)', background: 'var(--jarvis-s2)', color: 'var(--jarvis-t)', cursor: 'pointer', fontSize: 13 }}
        >
          {loading ? '↻ Loading…' : '↻ Refresh'}
        </button>
      </div>

      {error && (
        <div style={{ padding: '12px 16px', borderRadius: 8, background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', fontSize: 13 }}>
          {error}
        </div>
      )}

      {snap && (
        <>
          {/* ── KPI Strip ────────────────────────────────────────────────── */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <KpiCard label="Original BAC"    value={fmt(snap.originalBac)}   />
            <KpiCard label="Approved COs"    value={fmt(snap.approvedCo)}    accent="#22c55e" onClick={() => onNavigate?.('changeorders')} />
            <KpiCard label="Revised Budget"  value={fmt(snap.revisedBudget)} accent="#6366f1" />
            <KpiCard label="ACWP"            value={fmt(snap.acwp)}          accent="#ef4444" sub={`${snap.pctSpent}% of revised budget`} onClick={() => onNavigate?.('costentry')} />
            <KpiCard label="EAC"             value={fmt(snap.eac)}           accent={snap.eac && snap.eac > snap.revisedBudget ? '#ef4444' : '#22c55e'} onClick={() => onNavigate?.('evm')} />
            <KpiCard label="VAC"             value={fmt(snap.vac)}           accent={snap.vac !== null && snap.vac < 0 ? '#ef4444' : '#22c55e'} onClick={() => onNavigate?.('evm')} />
            <KpiCard label="CPI"             value={fmtN(snap.cpi)}          accent={snap.cpi !== null && snap.cpi < 1 ? '#ef4444' : '#22c55e'} sub={snap.cpi !== null && snap.cpi < 1 ? 'Over budget' : 'On budget'} onClick={() => onNavigate?.('evm')} />
            <KpiCard label="Pending COs"     value={fmt(snap.pendingCo)}     accent="#f59e0b" onClick={() => onNavigate?.('changeorders')} />
          </div>

          {/* ── Waterfall + Trend (side by side) ─────────────────────────── */}
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 300px', background: 'var(--jarvis-s2)', border: '1px solid var(--jarvis-b)', borderRadius: 10, padding: 16 }}>
              <h3 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 600, color: 'var(--jarvis-t)' }}>Budget Waterfall</h3>
              <WaterfallChart snap={snap} />
            </div>
            <div style={{ flex: '1 1 300px', background: 'var(--jarvis-s2)', border: '1px solid var(--jarvis-b)', borderRadius: 10, padding: 16 }}>
              <h3 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 600, color: 'var(--jarvis-t)' }}>Monthly EVM Trend</h3>
              <TrendChart data={snap.trend} />
            </div>
          </div>

          {/* ── Change Orders Table ───────────────────────────────────────── */}
          <div style={{ background: 'var(--jarvis-s2)', border: '1px solid var(--jarvis-b)', borderRadius: 10, padding: 16 }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 600, color: 'var(--jarvis-t)' }}>Recent Change Orders</h3>
            {snap.recentCOs.length === 0 ? (
              <p style={{ color: 'var(--jarvis-ts)', fontSize: 13, margin: 0 }}>No change orders yet.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--jarvis-b)' }}>
                      {['#', 'Title', 'Cost Impact', 'Status', 'Submitted'].map(h => (
                        <th key={h} style={{ padding: '6px 10px', textAlign: 'left', color: 'var(--jarvis-ts)', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {snap.recentCOs.map(co => (
                      <tr key={co.id} style={{ borderBottom: '1px solid var(--jarvis-b)' }}>
                        <td style={{ padding: '7px 10px', color: 'var(--jarvis-ts)' }}>CO-{String(co.coNumber).padStart(3, '0')}</td>
                        <td style={{ padding: '7px 10px', color: 'var(--jarvis-t)', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{co.title}</td>
                        <td style={{ padding: '7px 10px', fontWeight: 600, color: co.costImpact < 0 ? '#22c55e' : co.costImpact > 0 ? '#ef4444' : 'var(--jarvis-ts)' }}>
                          {co.costImpact > 0 ? '+' : ''}{fmt(co.costImpact)}
                        </td>
                        <td style={{ padding: '7px 10px' }}>
                          <span style={{ padding: '2px 8px', borderRadius: 99, fontSize: 11, fontWeight: 600, color: '#fff', background: coStatusColor[co.status] ?? '#666' }}>
                            {co.status}
                          </span>
                        </td>
                        <td style={{ padding: '7px 10px', color: 'var(--jarvis-ts)' }}>
                          {co.submittedAt ? new Date(co.submittedAt).toLocaleDateString() : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── Top Subcontractors ────────────────────────────────────────── */}
          <div style={{ background: 'var(--jarvis-s2)', border: '1px solid var(--jarvis-b)', borderRadius: 10, padding: 16 }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 600, color: 'var(--jarvis-t)' }}>
              Top Subcontractors
              <span style={{ fontWeight: 400, color: 'var(--jarvis-ts)', marginLeft: 8 }}>
                Committed {fmt(snap.committedSubs)} · Invoiced {fmt(snap.invoicedToDate)} · Approved {fmt(snap.approvedInv)}
              </span>
            </h3>
            {snap.topSubs.length === 0 ? (
              <p style={{ color: 'var(--jarvis-ts)', fontSize: 13, margin: 0 }}>No subcontracts yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {snap.topSubs.map(sub => (
                  <div key={sub.subcontractId} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                        <span style={{ fontSize: 11, color: 'var(--jarvis-ts)', whiteSpace: 'nowrap' }}>SC-{sub.scNumber}</span>
                        <span style={{ fontSize: 12, color: 'var(--jarvis-t)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub.vendorName}</span>
                        <span style={{ padding: '1px 6px', borderRadius: 99, fontSize: 10, fontWeight: 600, color: '#fff', background: subStatusColor[sub.status] ?? '#666' }}>
                          {sub.status}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: 16, whiteSpace: 'nowrap', fontSize: 12, flexShrink: 0 }}>
                        <span style={{ color: 'var(--jarvis-ts)' }}>Contract: <b style={{ color: 'var(--jarvis-t)' }}>{fmt(sub.contractValue)}</b></span>
                        <span style={{ color: 'var(--jarvis-ts)' }}>Invoiced: <b style={{ color: '#fb923c' }}>{fmt(sub.invoicedTotal)}</b></span>
                        <span style={{ color: 'var(--jarvis-ts)' }}>Approved: <b style={{ color: '#22c55e' }}>{fmt(sub.approvedTotal)}</b></span>
                        <span style={{ color: 'var(--jarvis-ts)' }}><b style={{ color: 'var(--jarvis-t)' }}>{sub.percentBilled}%</b> billed</span>
                      </div>
                    </div>
                    {/* Progress bar */}
                    <div style={{ height: 6, borderRadius: 3, background: 'var(--jarvis-b)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${Math.min(sub.percentBilled, 100)}%`, background: sub.percentBilled > 100 ? '#ef4444' : '#fb923c', borderRadius: 3, transition: 'width .4s' }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {!snap && !loading && !error && (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--jarvis-ts)', fontSize: 13 }}>
          Select a project to view cost control data.
        </div>
      )}
    </div>
  )
}
