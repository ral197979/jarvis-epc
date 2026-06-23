/**
 * Denver Engineering — EVM Dashboard (v10.3.0)
 * ──────────────────────────────────────────────
 * Earned Value Management: key indices + S-curve chart + actuals entry.
 * No external chart dependencies — SVG-based S-curve rendered in-component.
 */
import React, { useState, useEffect, useCallback } from 'react'
import { useBizStore, selectProjects } from '../../modules/biz/store'

// ─── Types ────────────────────────────────────────────────────────────────────

interface EvmMetrics {
  bac: number; bcws: number; bcwp: number; acwp: number
  cpi: number | null; spi: number | null
  cv: number; sv: number
  eac: number | null; etc: number | null; vac: number | null; tcpi: number | null
  statusDate: string; health: 'green' | 'yellow' | 'red'
}

interface ScurvePoint {
  snapshotDate: string; bac: number; bcws: number; bcwp: number; acwp: number
}

interface Actual {
  id: string; periodDate: string; amount: number; description: string | null; reference: string | null
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

const fmt$ = (n: number | null | undefined) =>
  n == null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)

const fmtIdx = (n: number | null | undefined) => n == null ? '—' : n.toFixed(3)

const _fmtPct = (n: number | null | undefined) => n == null ? '—' : `${(n * 100).toFixed(1)}%`

// ─── S-curve SVG ─────────────────────────────────────────────────────────────

function SCurve({ data }: { data: ScurvePoint[] }) {
  if (data.length < 2) return (
    <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666', fontSize: 12 }}>
      Take at least 2 snapshots to render the S-curve.
    </div>
  )

  const W = 680, H = 200, PAD = { t: 16, r: 16, b: 32, l: 64 }
  const plotW = W - PAD.l - PAD.r
  const plotH = H - PAD.t - PAD.b

  const maxVal = Math.max(...data.flatMap(d => [d.bac, d.bcws, d.bcwp, d.acwp]))
  const minDate = new Date(data[0].snapshotDate).getTime()
  const maxDate = new Date(data[data.length - 1].snapshotDate).getTime()
  const dateRange = maxDate - minDate || 1

  const xOf = (d: ScurvePoint) =>
    PAD.l + ((new Date(d.snapshotDate).getTime() - minDate) / dateRange) * plotW
  const yOf = (v: number) =>
    PAD.t + plotH - (v / (maxVal || 1)) * plotH

  const line = (key: keyof ScurvePoint, color: string, dash?: string) => {
    const pts = data.map(d => `${xOf(d).toFixed(1)},${yOf(Number(d[key])).toFixed(1)}`).join(' ')
    return <polyline key={key} points={pts} fill="none" stroke={color} strokeWidth={2} strokeDasharray={dash} />
  }

  // Y-axis ticks
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => ({
    v: maxVal * f,
    y: yOf(maxVal * f),
  }))

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: W, height: 'auto', display: 'block' }}>
      {/* grid */}
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={PAD.l} y1={t.y} x2={W - PAD.r} y2={t.y} stroke="#2a2a2a" strokeWidth={1} />
          <text x={PAD.l - 6} y={t.y + 4} textAnchor="end" fontSize={9} fill="#666">
            {fmt$(t.v)}
          </text>
        </g>
      ))}
      {/* x-axis labels */}
      {data.filter((_, i) => i === 0 || i === data.length - 1 || i % Math.max(1, Math.floor(data.length / 4)) === 0).map((d, i) => (
        <text key={i} x={xOf(d)} y={H - 4} textAnchor="middle" fontSize={9} fill="#666">
          {d.snapshotDate.slice(5)}
        </text>
      ))}
      {/* curves */}
      {line('bac',  '#444',   '4 2')}
      {line('bcws', '#4a9eff')}
      {line('bcwp', '#2ecc71')}
      {line('acwp', '#e74c3c')}
      {/* legend */}
      {[['BAC', '#444'], ['BCWS (PV)', '#4a9eff'], ['BCWP (EV)', '#2ecc71'], ['ACWP (AC)', '#e74c3c']].map(([label, color], i) => (
        <g key={i} transform={`translate(${PAD.l + i * 140}, ${H - 10})`}>
          <line x1={0} y1={-4} x2={16} y2={-4} stroke={color as string} strokeWidth={2} />
          <text x={20} y={0} fontSize={9} fill="#aaa">{label}</text>
        </g>
      ))}
    </svg>
  )
}

// ─── Metric card ─────────────────────────────────────────────────────────────

function Metric({ label, value, sub, color, onClick }: {
  label: string; value: string; sub?: string; color?: string; onClick?: () => void
}) {
  return (
    <div onClick={onClick} style={{
      background: 'var(--jarvis-bg2)', border: '1px solid var(--jarvis-bd)',
      borderRadius: 6, padding: '10px 14px', minWidth: 110,
      cursor: onClick ? 'pointer' : 'default',
    }}
    onMouseEnter={onClick ? e => (e.currentTarget.style.opacity = '.75') : undefined}
    onMouseLeave={onClick ? e => (e.currentTarget.style.opacity = '1') : undefined}
    >
      <div style={{ fontSize: 10, color: 'var(--jarvis-ts)', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: color ?? 'var(--jarvis-fg)' }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: 'var(--jarvis-ts)' }}>{sub}</div>}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function EVMDashboard({ onNavigate }: { onNavigate?: (tab: string) => void } = {}) {
  const projects = useBizStore(selectProjects)
  const [projectId, setProjectId] = useState('')
  const [metrics, setMetrics]     = useState<EvmMetrics | null>(null)
  const [scurve, setScurve]       = useState<ScurvePoint[]>([])
  const [actuals, setActuals]     = useState<Actual[]>([])
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')

  // Actual entry form
  const [showActualForm, setShowActualForm] = useState(false)
  const [actualDraft, setActualDraft]       = useState({ periodDate: '', amount: '', description: '', reference: '' })
  const [saving, setSaving]                 = useState(false)

  useEffect(() => {
    if (projects?.length && !projectId) setProjectId(projects[0].id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects])

  const load = useCallback(async () => {
    if (!projectId) return
    setLoading(true); setError('')
    try {
      const [mRes, sRes, aRes] = await Promise.all([
        fetch(`/api/v1/projects/${projectId}/evm/metrics`),
        fetch(`/api/v1/projects/${projectId}/evm/scurve`),
        fetch(`/api/v1/projects/${projectId}/evm/actuals`),
      ])
      if (mRes.ok) setMetrics((await mRes.json()).metrics)
      else if (mRes.status === 404) setMetrics(null)
      else setError('Failed to load EVM metrics')

      if (sRes.ok) setScurve((await sRes.json()).scurve ?? [])
      if (aRes.ok) setActuals((await aRes.json()).actuals ?? [])
    } catch {
      setError('Network error loading EVM data')
    }
    setLoading(false)
  }, [projectId])

  useEffect(() => { load() }, [load])

  const takeSnapshot = async () => {
    try {
      await fetch(`/api/v1/projects/${projectId}/evm/snapshot`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
      load()
    } catch { setError('Failed to take snapshot') }
  }

  const submitActual = async () => {
    if (!actualDraft.periodDate || !actualDraft.amount) return
    setSaving(true)
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/evm/actuals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...actualDraft, amount: parseFloat(actualDraft.amount) }),
      })
      if (!res.ok) throw new Error(await res.text())
      setActualDraft({ periodDate: '', amount: '', description: '', reference: '' })
      setShowActualForm(false)
      load()
    } catch { setError('Failed to save actual cost') } finally { setSaving(false) }
  }

  const healthColor = { green: '#2ecc71', yellow: '#f39c12', red: '#e74c3c' }[metrics?.health ?? 'green']

  const indexColor = (v: number | null) =>
    v == null ? undefined : v >= 0.95 ? '#2ecc71' : v >= 0.85 ? '#f39c12' : '#e74c3c'

  return (
    <div style={{ padding: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>📊 Earned Value Management</h2>
        <select value={projectId} onChange={e => setProjectId(e.target.value)} style={{ padding: 6 }}>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          {projects?.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={takeSnapshot} style={{ padding: '6px 12px', border: '1px solid var(--jarvis-bd)', borderRadius: 4, background: 'var(--jarvis-bg2)', cursor: 'pointer' }}>
            📸 Snapshot
          </button>
          <button onClick={() => setShowActualForm(true)} style={{ padding: '6px 12px', background: 'var(--jarvis-ac)', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
            + Record Actual
          </button>
        </div>
      </div>

      {loading && <div style={{ color: 'var(--jarvis-ts)', padding: 20 }}>Loading…</div>}
      {error   && <div style={{ color: '#e74c3c', padding: 8, marginBottom: 12 }}>{error}</div>}

      {/* No baseline state */}
      {!loading && !metrics && !error && (
        <div style={{ background: 'var(--jarvis-bg2)', border: '1px solid var(--jarvis-bd)', borderRadius: 6, padding: 32, textAlign: 'center', color: 'var(--jarvis-ts)' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>No EVM baseline configured</div>
          <div style={{ fontSize: 12 }}>
            POST /api/v1/projects/{'{projectId}'}/evm/baselines with bac, startDate, finishDate to set up EVM.
          </div>
        </div>
      )}

      {metrics && (
        <>
          {/* Health banner */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, padding: '8px 14px', background: 'var(--jarvis-bg2)', border: `1px solid ${healthColor}`, borderRadius: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: healthColor, display: 'inline-block' }} />
            <span style={{ fontWeight: 600, color: healthColor }}>{metrics.health.toUpperCase()}</span>
            <span style={{ color: 'var(--jarvis-ts)', fontSize: 12 }}>
              Status date: {metrics.statusDate} · BAC {fmt$(metrics.bac)}
            </span>
          </div>

          {/* Key indices */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
            <Metric label="CPI (cost)"     value={fmtIdx(metrics.cpi)}  sub={metrics.cpi != null ? (metrics.cpi >= 1 ? 'Under budget' : 'Over budget') : undefined} color={indexColor(metrics.cpi)} onClick={() => onNavigate?.('costcontrol')} />
            <Metric label="SPI (schedule)" value={fmtIdx(metrics.spi)}  sub={metrics.spi != null ? (metrics.spi >= 1 ? 'Ahead'         : 'Behind')       : undefined} color={indexColor(metrics.spi)} />
            <Metric label="BCWP (EV)"  value={fmt$(metrics.bcwp)} />
            <Metric label="BCWS (PV)"  value={fmt$(metrics.bcws)} />
            <Metric label="ACWP (AC)"  value={fmt$(metrics.acwp)} onClick={() => onNavigate?.('costentry')} />
            <Metric label="CV"  value={fmt$(metrics.cv)}  color={metrics.cv >= 0 ? '#2ecc71' : '#e74c3c'} />
            <Metric label="SV"  value={fmt$(metrics.sv)}  color={metrics.sv >= 0 ? '#2ecc71' : '#e74c3c'} />
            <Metric label="EAC" value={fmt$(metrics.eac)} sub="Estimate at completion" onClick={() => onNavigate?.('costcontrol')} />
            <Metric label="ETC" value={fmt$(metrics.etc)} sub="Estimate to complete" />
            <Metric label="VAC" value={fmt$(metrics.vac)} color={metrics.vac != null && metrics.vac >= 0 ? '#2ecc71' : '#e74c3c'} onClick={() => onNavigate?.('costcontrol')} />
            <Metric label="TCPI" value={fmtIdx(metrics.tcpi)} sub="To-complete perf. index" />
          </div>

          {/* S-curve */}
          <div style={{ background: 'var(--jarvis-bg2)', border: '1px solid var(--jarvis-bd)', borderRadius: 6, padding: 16, marginBottom: 20 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>S-Curve</div>
            <SCurve data={scurve} />
          </div>
        </>
      )}

      {/* Actual cost entry form */}
      {showActualForm && (
        <div style={{ border: '1px solid var(--jarvis-bd)', borderRadius: 6, padding: 14, marginBottom: 16, background: 'var(--jarvis-bg2)' }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Record Actual Cost (ACWP)</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 8 }}>
            <input type="date" value={actualDraft.periodDate} onChange={e => setActualDraft({ ...actualDraft, periodDate: e.target.value })} placeholder="Period date" />
            <input type="number" value={actualDraft.amount} onChange={e => setActualDraft({ ...actualDraft, amount: e.target.value })} placeholder="Amount ($)" min="0" step="0.01" />
            <input value={actualDraft.description} onChange={e => setActualDraft({ ...actualDraft, description: e.target.value })} placeholder="Description" />
            <input value={actualDraft.reference} onChange={e => setActualDraft({ ...actualDraft, reference: e.target.value })} placeholder="PO / Invoice ref" />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={submitActual} disabled={saving} style={{ background: 'var(--jarvis-ac)', color: '#fff', border: 'none', padding: '6px 14px', borderRadius: 4, cursor: 'pointer' }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button onClick={() => setShowActualForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Actuals table */}
      {actuals.length > 0 && (
        <div>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Actual Cost Entries</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'var(--jarvis-bg2)', textAlign: 'left' }}>
                {['Date', 'Amount', 'Description', 'Reference'].map(h => (
                  <th key={h} style={{ padding: '6px 8px', borderBottom: '1px solid var(--jarvis-bd)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {actuals.map(a => (
                <tr key={a.id} style={{ borderBottom: '1px solid var(--jarvis-bd)' }}>
                  <td style={{ padding: '6px 8px' }}>{a.periodDate}</td>
                  <td style={{ padding: '6px 8px', fontFamily: 'monospace' }}>{fmt$(a.amount)}</td>
                  <td style={{ padding: '6px 8px', color: 'var(--jarvis-ts)' }}>{a.description ?? '—'}</td>
                  <td style={{ padding: '6px 8px', color: 'var(--jarvis-ts)' }}>{a.reference ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default EVMDashboard
