/**
 * Denver Engineering — Vendor Scorecard (v4.59.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * Per-vendor standing synthesized from subcontracts (commitments + billing) and
 * purchase orders (on-time delivery + at-risk). Deterministic.
 *
 * Data: GET /api/v1/projects/:projectId/vendor-scorecard
 */
import React, { useEffect, useState, useCallback } from 'react'

interface Project { id: string; name: string }
interface VendorScore { vendorId: string; vendor: string | null; standing: 'strong' | 'fair' | 'weak'; score: number; subcontracts: number; committedValue: number; billedValue: number; pctBilled: number; pos: number; poOnTimeRatePct: number | null; atRiskOpenPos: number }
interface Scorecard { headline: string; summary: { vendors: number; weak: number }; vendors: VendorScore[] }

const STANDING_COLOR: Record<string, string> = { strong: '#22c55e', fair: '#f59e0b', weak: '#ef4444' }
const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`

export default function VendorScorecardView(_props: { onNavigate?: (tab: string) => void }) {
  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState('')
  const [data, setData] = useState<Scorecard | null>(null)
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
      const res = await fetch(`/api/v1/projects/${pid}/vendor-scorecard`, { credentials: 'include' })
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
          <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--jarvis-tx)', margin: 0 }}>🏅 Vendor Scorecard</h1>
          <p style={{ fontSize: 13, color: 'var(--jarvis-ts)', margin: '4px 0 0' }}>Per-vendor standing — commitments, billing, on-time delivery, and at-risk POs.</p>
        </div>
        <select value={projectId} onChange={e => { setProjectId(e.target.value); localStorage.setItem('jarvis-active-project', e.target.value) }}
          style={{ padding: '7px 10px', borderRadius: 6, border: '1px solid var(--jarvis-bd)', background: 'var(--jarvis-bg2)', color: 'var(--jarvis-tx)', fontSize: 13 }}>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {loading && !data && <div style={{ ...card, color: 'var(--jarvis-ts)', fontSize: 13 }}>Scoring vendors…</div>}

      {data && (
        <>
          <div style={{ ...card, fontSize: 14, color: 'var(--jarvis-tx)' }}>{data.headline}</div>
          {data.vendors.length === 0 && <div style={{ ...card, color: 'var(--jarvis-ts)', fontSize: 13 }}>No vendors with subcontracts or purchase orders.</div>}
          {data.vendors.map(v => (
            <div key={v.vendorId} style={{ ...card, borderLeft: `3px solid ${STANDING_COLOR[v.standing]}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 22, fontWeight: 800, color: STANDING_COLOR[v.standing], fontFamily: 'var(--jarvis-font-mono)', width: 44 }}>{v.score}</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--jarvis-tx)' }}>{v.vendor ?? v.vendorId.slice(0, 8)}</span>
                <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: '#0a0b0f', background: STANDING_COLOR[v.standing], padding: '2px 7px', borderRadius: 99 }}>{v.standing}</span>
                {v.atRiskOpenPos > 0 && <span style={{ fontSize: 11, color: '#ef4444' }}>⛔ {v.atRiskOpenPos} at-risk PO{v.atRiskOpenPos === 1 ? '' : 's'}</span>}
              </div>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12, color: 'var(--jarvis-ts)' }}>
                <span>{v.subcontracts} subcontract{v.subcontracts === 1 ? '' : 's'}</span>
                <span>Committed <strong style={{ color: 'var(--jarvis-tx)', fontFamily: 'var(--jarvis-font-mono)' }}>{money(v.committedValue)}</strong></span>
                <span>Billed <strong style={{ color: 'var(--jarvis-tx)', fontFamily: 'var(--jarvis-font-mono)' }}>{money(v.billedValue)}</strong> ({v.pctBilled}%)</span>
                <span>{v.pos} PO{v.pos === 1 ? '' : 's'}</span>
                <span>On-time <strong style={{ color: v.poOnTimeRatePct == null ? 'var(--jarvis-ts)' : v.poOnTimeRatePct >= 90 ? '#22c55e' : v.poOnTimeRatePct >= 70 ? '#f59e0b' : '#ef4444' }}>{v.poOnTimeRatePct == null ? '—' : `${v.poOnTimeRatePct}%`}</strong></span>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  )
}
