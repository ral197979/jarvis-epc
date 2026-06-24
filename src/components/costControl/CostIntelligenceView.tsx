/**
 * Denver Engineering — Cost Intelligence (v4.54.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * Explains budget drift with cited drivers: budget → revised → forecast →
 * variance, the change orders and forecast moves behind it, overrun risk, and
 * recommendations. Deterministic.
 *
 * Data: GET /api/v1/projects/:projectId/cost-intelligence
 */
import React, { useEffect, useState, useCallback } from 'react'

interface Project { id: string; name: string }
interface CostDriver { label: string; amount: number; detail: string; tone: 'increase' | 'decrease' | 'neutral' }
interface CostIntel {
  headline: string
  position: { budget: number; approvedCoTotal: number; revisedBudget: number; committed: number; actual: number; forecast: number; variance: number; variancePct: number; pendingCoTotal: number; contingency: number }
  drivers: CostDriver[]
  topChangeOrders: { coNumber: number | null; title: string; costImpact: number; status: string }[]
  overrunRisk: 'low' | 'medium' | 'high'
  recommendations: string[]
}

const money = (n: number) => `${n < 0 ? '-' : ''}$${Math.round(Math.abs(n)).toLocaleString('en-US')}`
const riskColor = (r: string) => (r === 'low' ? '#22c55e' : r === 'medium' ? '#f59e0b' : '#ef4444')
const toneColor = (t: string) => (t === 'increase' ? '#ef4444' : t === 'decrease' ? '#22c55e' : 'var(--jarvis-ts)')

export default function CostIntelligenceView(_props: { onNavigate?: (tab: string) => void }) {
  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState('')
  const [data, setData] = useState<CostIntel | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/v1/projects', { credentials: 'include' })
        const json = await res.json()
        const list: Project[] = json.data || json.projects || []
        setProjects(list)
        const saved = localStorage.getItem('jarvis-active-project')
        if (saved && list.some(p => p.id === saved)) setProjectId(saved)
        else if (list.length) { setProjectId(list[0].id); localStorage.setItem('jarvis-active-project', list[0].id) }
      } catch { /* ignore */ }
    })()
  }, [])

  const load = useCallback(async (pid: string) => {
    if (!pid) return
    setLoading(true)
    try {
      const res = await fetch(`/api/v1/projects/${pid}/cost-intelligence`, { credentials: 'include' })
      const json = await res.json()
      setData(res.ok ? json.data : null)
    } catch { setData(null) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load(projectId) }, [projectId, load])

  const card: React.CSSProperties = { background: 'var(--jarvis-bg2)', border: '1px solid var(--jarvis-bd)', borderRadius: 10, padding: 16, marginBottom: 16 }
  const p = data?.position

  return (
    <div style={{ padding: 24, maxWidth: 980, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--jarvis-tx)', margin: 0 }}>💸 Cost Intelligence</h1>
          <p style={{ fontSize: 13, color: 'var(--jarvis-ts)', margin: '4px 0 0' }}>Why the budget is moving — cited drivers, overrun risk, and what to do.</p>
        </div>
        <select value={projectId} onChange={e => { setProjectId(e.target.value); localStorage.setItem('jarvis-active-project', e.target.value) }}
          style={{ padding: '7px 10px', borderRadius: 6, border: '1px solid var(--jarvis-bd)', background: 'var(--jarvis-bg2)', color: 'var(--jarvis-tx)', fontSize: 13 }}>
          {projects.map(pr => <option key={pr.id} value={pr.id}>{pr.name}</option>)}
        </select>
      </div>

      {loading && !data && <div style={{ ...card, color: 'var(--jarvis-ts)', fontSize: 13 }}>Analysing cost position…</div>}

      {data && p && (
        <>
          <div style={{ ...card, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: '#0a0b0f', background: riskColor(data.overrunRisk), padding: '3px 9px', borderRadius: 99 }}>{data.overrunRisk} overrun risk</span>
            <span style={{ flex: 1, minWidth: 220, fontSize: 14, color: 'var(--jarvis-tx)', lineHeight: 1.5 }}>{data.headline}</span>
          </div>

          {/* Position waterfall */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
            {([['Original budget', p.budget, 'neutral'], ['Approved COs', p.approvedCoTotal, p.approvedCoTotal >= 0 ? 'increase' : 'decrease'], ['Revised budget', p.revisedBudget, 'neutral'], ['Forecast', p.forecast, 'neutral'], ['Variance', p.variance, p.variance > 0 ? 'increase' : 'decrease']] as [string, number, string][]).map(([label, val, tone]) => (
              <div key={label} style={{ ...card, flex: '1 1 130px', minWidth: 130, marginBottom: 0, textAlign: 'center' }}>
                <div style={{ fontSize: 17, fontWeight: 800, color: label === 'Variance' || label === 'Approved COs' ? toneColor(tone) : 'var(--jarvis-tx)', fontFamily: 'var(--jarvis-font-mono)' }}>{money(val)}</div>
                <div style={{ fontSize: 11, color: 'var(--jarvis-ts)' }}>{label}{label === 'Variance' ? ` (${p.variancePct}%)` : ''}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11, color: 'var(--jarvis-ts)', marginTop: -8, marginBottom: 16 }}>Committed {money(p.committed)} · Actual {money(p.actual)} · Pending COs {money(p.pendingCoTotal)} · Contingency {money(p.contingency)}</div>

          {/* Drivers */}
          <div style={card}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--jarvis-tx)', marginBottom: 10 }}>What's driving the cost</div>
            {data.drivers.length === 0 && <div style={{ fontSize: 13, color: 'var(--jarvis-ts)' }}>No material drift drivers.</div>}
            {data.drivers.map(d => (
              <div key={d.label} style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '6px 0', borderTop: '1px solid var(--jarvis-bd)' }}>
                <span style={{ width: 110, fontWeight: 700, color: toneColor(d.tone), fontFamily: 'var(--jarvis-font-mono)', textAlign: 'right' }}>{money(d.amount)}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, color: 'var(--jarvis-tx)' }}>{d.label}</div>
                  <div style={{ fontSize: 12, color: 'var(--jarvis-ts)' }}>{d.detail}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Top change orders + recommendations */}
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {data.topChangeOrders.length > 0 && (
              <div style={{ ...card, flex: '1 1 320px', minWidth: 280 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--jarvis-tx)', marginBottom: 8 }}>Largest change orders</div>
                {data.topChangeOrders.map(co => (
                  <div key={`${co.coNumber}-${co.title}`} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--jarvis-tx)', padding: '3px 0' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>CO-{co.coNumber ?? '?'} {co.title} <span style={{ color: 'var(--jarvis-ts)' }}>· {co.status}</span></span>
                    <span style={{ color: toneColor(co.costImpact >= 0 ? 'increase' : 'decrease'), fontFamily: 'var(--jarvis-font-mono)', flexShrink: 0, marginLeft: 8 }}>{money(co.costImpact)}</span>
                  </div>
                ))}
              </div>
            )}
            <div style={{ ...card, flex: '1 1 320px', minWidth: 280 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--jarvis-tx)', marginBottom: 8 }}>Recommendations</div>
              {data.recommendations.map((rec, i) => (
                <div key={i} style={{ fontSize: 13, color: 'var(--jarvis-tx)', display: 'flex', gap: 6, marginBottom: 5 }}><span aria-hidden>→</span><span>{rec}</span></div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
