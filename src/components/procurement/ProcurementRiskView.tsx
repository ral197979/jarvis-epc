/**
 * Denver Engineering — Procurement Risk (v4.52.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * Predicts late equipment and supply-chain risk over the project's purchase
 * orders: ranked at-risk POs + a vendor rollup. Deterministic.
 *
 * Data: GET /api/v1/projects/:projectId/procurement-risk
 */
import React, { useEffect, useState, useCallback } from 'react'

interface Project { id: string; name: string }
type RiskType = 'overdue' | 'arriving_late' | 'not_issued' | 'need_approaching' | 'partial'
interface RiskItem { poId: string; poNumber: string; title: string; vendor: string | null; riskType: RiskType; severity: 'critical' | 'high' | 'medium' | 'low'; score: number; daysToNeed: number | null; amountAtRisk: number; reason: string; recommendedAction: string }
interface VendorRisk { vendor: string; atRiskPOs: number; amountAtRisk: number; worstSeverity: 'critical' | 'high' | 'medium' | 'low' }
interface ProcurementRisk {
  headline: string
  summary: { openPOs: number; atRisk: number; critical: number; high: number; amountAtRisk: number }
  items: RiskItem[]
  vendorRisk: VendorRisk[]
}

const SEV_COLOR: Record<RiskItem['severity'], string> = { critical: '#ef4444', high: '#f59e0b', medium: '#3b82f6', low: '#6b7280' }
const TYPE_LABEL: Record<RiskType, string> = { overdue: 'Overdue', arriving_late: 'Arriving late', not_issued: 'Not issued', need_approaching: 'Need approaching', partial: 'Partial' }
const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`

export default function ProcurementRiskView(_props: { onNavigate?: (tab: string) => void }) {
  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState('')
  const [data, setData] = useState<ProcurementRisk | null>(null)
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
      const res = await fetch(`/api/v1/projects/${pid}/procurement-risk`, { credentials: 'include' })
      const json = await res.json()
      setData(res.ok ? json.data : null)
    } catch { setData(null) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load(projectId) }, [projectId, load])

  const card: React.CSSProperties = { background: 'var(--jarvis-bg2)', border: '1px solid var(--jarvis-bd)', borderRadius: 10, padding: 16, marginBottom: 16 }

  return (
    <div style={{ padding: 24, maxWidth: 980, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--jarvis-tx)', margin: 0 }}>🚚 Procurement Risk</h1>
          <p style={{ fontSize: 13, color: 'var(--jarvis-ts)', margin: '4px 0 0' }}>Predicts late equipment and supply-chain exposure across purchase orders.</p>
        </div>
        <select value={projectId} onChange={e => { setProjectId(e.target.value); localStorage.setItem('jarvis-active-project', e.target.value) }}
          style={{ padding: '7px 10px', borderRadius: 6, border: '1px solid var(--jarvis-bd)', background: 'var(--jarvis-bg2)', color: 'var(--jarvis-tx)', fontSize: 13 }}>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {loading && !data && <div style={{ ...card, color: 'var(--jarvis-ts)', fontSize: 13 }}>Assessing purchase orders…</div>}

      {data && (
        <>
          <div style={{ ...card, fontSize: 14, color: 'var(--jarvis-tx)', lineHeight: 1.5 }}>{data.headline}</div>

          {/* Vendor rollup */}
          {data.vendorRisk.length > 0 && (
            <div style={card}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--jarvis-tx)', marginBottom: 10 }}>Supply-chain exposure by vendor</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {data.vendorRisk.map(v => (
                  <div key={v.vendor} style={{ border: '1px solid var(--jarvis-bd)', borderLeft: `3px solid ${SEV_COLOR[v.worstSeverity]}`, borderRadius: 8, padding: '8px 12px' }}>
                    <div style={{ fontSize: 13, color: 'var(--jarvis-tx)', fontWeight: 600 }}>{v.vendor}</div>
                    <div style={{ fontSize: 11, color: 'var(--jarvis-ts)' }}>{v.atRiskPOs} PO{v.atRiskPOs === 1 ? '' : 's'} · {money(v.amountAtRisk)} at risk</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* At-risk POs */}
          <div style={card}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--jarvis-tx)', marginBottom: 10 }}>At-risk purchase orders ({data.items.length})</div>
            {data.items.length === 0 && <div style={{ fontSize: 13, color: 'var(--jarvis-ts)' }}>No purchase orders are at risk.</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {data.items.map(it => (
                <div key={it.poId} style={{ border: '1px solid var(--jarvis-bd)', borderLeft: `3px solid ${SEV_COLOR[it.severity]}`, borderRadius: 8, padding: '12px 14px' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: '#0a0b0f', background: SEV_COLOR[it.severity], padding: '2px 7px', borderRadius: 99 }}>{it.severity}</span>
                    <span style={{ fontSize: 11, color: 'var(--jarvis-ts)' }}>{TYPE_LABEL[it.riskType]} · {it.poNumber}{it.vendor ? ` · ${it.vendor}` : ''}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: 'var(--jarvis-tx)', fontFamily: 'var(--jarvis-font-mono)' }}>{money(it.amountAtRisk)}</span>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--jarvis-tx)' }}>{it.title} <span style={{ color: 'var(--jarvis-ts)' }}>— {it.reason}</span></div>
                  <div style={{ fontSize: 12, color: 'var(--jarvis-ts)', marginTop: 6 }}><span aria-hidden>→</span> <strong style={{ color: 'var(--jarvis-tx)' }}>Do:</strong> {it.recommendedAction}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
