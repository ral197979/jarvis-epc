/**
 * Denver Engineering — NCR / CAPA (v4.55.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * Non-conformance register with corrective/preventive action tracking and a
 * deterministic quality summary (open by severity, overdue CAPAs, recurring
 * root causes, aging).
 *
 * API: /api/v1/projects/:id/ncrs · /ncrs/:id/capas · /projects/:id/ncr-summary
 */
import React, { useEffect, useState, useCallback } from 'react'

interface Project { id: string; name: string }
interface Ncr { id: string; ncr_number: number; title: string; severity: string; status: string; disposition: string; discipline?: string | null; location?: string | null; root_cause?: string | null; capa_count?: number; open_capas?: number }
interface Capa { id: string; type: string; description: string; status: string; due_date: string | null }
interface Summary {
  headline: string
  totals: { ncrs: number; open: number; closed: number; openCritical: number; openMajor: number }
  overdueCapas: number
  capaVerificationRatePct: number | null
  recurringRootCauses: { cause: string; count: number }[]
  aging: { avgOpenAgeDays: number | null; avgDaysToClose: number | null }
}

const SEV_COLOR: Record<string, string> = { minor: '#3b82f6', major: '#f59e0b', critical: '#ef4444' }
const NCR_STATUS = ['open', 'investigating', 'corrective_action', 'verification', 'closed']
const DISPOSITIONS = ['pending', 'use_as_is', 'rework', 'repair', 'reject', 'return']
const CAPA_STATUS = ['open', 'in_progress', 'completed', 'verified']

export default function NcrView(_props: { onNavigate?: (tab: string) => void }) {
  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState('')
  const [ncrs, setNcrs] = useState<Ncr[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [selected, setSelected] = useState<Ncr | null>(null)
  const [capas, setCapas] = useState<Capa[]>([])
  const [busy, setBusy] = useState(false)
  const [ncrForm, setNcrForm] = useState({ title: '', severity: 'minor', discipline: '', location: '', source: 'inspection' })
  const [capaDesc, setCapaDesc] = useState('')
  const [autoMsg, setAutoMsg] = useState('')

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
    try {
      const [n, s] = await Promise.all([
        fetch(`/api/v1/projects/${pid}/ncrs`, { credentials: 'include' }).then(r => r.json()),
        fetch(`/api/v1/projects/${pid}/ncr-summary`, { credentials: 'include' }).then(r => r.json()),
      ])
      setNcrs(n.data || []); setSummary(s.data || null)
    } catch { /* ignore */ }
  }, [])
  useEffect(() => { load(projectId); setSelected(null) }, [projectId, load])

  const loadCapas = useCallback(async (ncrId: string) => {
    try { const r = await fetch(`/api/v1/ncrs/${ncrId}/capas`, { credentials: 'include' }).then(x => x.json()); setCapas(r.data || []) } catch { setCapas([]) }
  }, [])
  useEffect(() => { if (selected) loadCapas(selected.id); else setCapas([]) }, [selected, loadCapas])

  const addNcr = async () => {
    if (!ncrForm.title.trim()) return
    setBusy(true)
    try {
      await fetch(`/api/v1/projects/${projectId}/ncrs`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ncrForm) })
      setNcrForm({ ...ncrForm, title: '', location: '' }); await load(projectId)
    } finally { setBusy(false) }
  }
  const patchNcr = async (id: string, body: Record<string, string>) => {
    setBusy(true)
    try {
      const r = await fetch(`/api/v1/ncrs/${id}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(x => x.json())
      if (r.data) setSelected(s => s ? { ...s, ...r.data } : s)
      await load(projectId)
    } finally { setBusy(false) }
  }
  const addCapa = async () => {
    if (!selected || !capaDesc.trim()) return
    setBusy(true)
    try {
      await fetch(`/api/v1/ncrs/${selected.id}/capas`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ description: capaDesc }) })
      setCapaDesc(''); await loadCapas(selected.id); await load(projectId)
    } finally { setBusy(false) }
  }
  const patchCapa = async (id: string, status: string) => {
    setBusy(true)
    try { await fetch(`/api/v1/capas/${id}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) }); if (selected) await loadCapas(selected.id) }
    finally { setBusy(false) }
  }
  const autoRaise = async () => {
    setBusy(true)
    try {
      const r = await fetch(`/api/v1/projects/${projectId}/ncrs/auto-raise`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(x => x.json())
      setAutoMsg(r.data?.count ? `Raised ${r.data.count} NCR${r.data.count === 1 ? '' : 's'} from failed inspections.` : 'No new failed inspections to raise.')
      await load(projectId)
    } finally { setBusy(false) }
  }

  const card: React.CSSProperties = { background: 'var(--jarvis-bg2)', border: '1px solid var(--jarvis-bd)', borderRadius: 10, padding: 16, marginBottom: 16 }
  const inp: React.CSSProperties = { padding: '5px 8px', borderRadius: 6, border: '1px solid var(--jarvis-bd)', background: 'var(--jarvis-bg)', color: 'var(--jarvis-tx)', fontSize: 12 }
  const t = summary?.totals

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--jarvis-tx)', margin: 0 }}>🚫 NCR / CAPA</h1>
          <p style={{ fontSize: 13, color: 'var(--jarvis-ts)', margin: '4px 0 0' }}>Non-conformance reports with corrective-action tracking and root-cause trends.</p>
        </div>
        <select value={projectId} onChange={e => { setProjectId(e.target.value); localStorage.setItem('jarvis-active-project', e.target.value) }} style={{ ...inp, padding: '7px 10px', fontSize: 13 }}>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {/* Summary */}
      {summary && t && (
        <div style={card}>
          <div style={{ fontSize: 14, color: 'var(--jarvis-tx)', marginBottom: 10 }}>{summary.headline}</div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {([['Open', t.open], ['Critical', t.openCritical], ['Major', t.openMajor], ['Overdue CAPAs', summary.overdueCapas], ['CAPA verified', summary.capaVerificationRatePct != null ? `${summary.capaVerificationRatePct}%` : '—'], ['Avg close', summary.aging.avgDaysToClose != null ? `${summary.aging.avgDaysToClose}d` : '—']] as [string, number | string][]).map(([k, v]) => (
              <div key={k} style={{ flex: '1 1 110px', minWidth: 110, border: '1px solid var(--jarvis-bd)', borderRadius: 8, padding: 10 }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--jarvis-tx)' }}>{v}</div>
                <div style={{ fontSize: 11, color: 'var(--jarvis-ts)' }}>{k}</div>
              </div>
            ))}
          </div>
          {summary.recurringRootCauses.length > 0 && (
            <div style={{ marginTop: 10, fontSize: 12, color: 'var(--jarvis-ts)' }}>
              Recurring root-cause themes: {summary.recurringRootCauses.map(r => `${r.cause} (${r.count})`).join(' · ')}
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {/* Register */}
        <div style={{ ...card, flex: '1 1 460px', minWidth: 320 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--jarvis-tx)' }}>NCR register ({ncrs.length})</span>
            <button onClick={autoRaise} disabled={busy} title="Create NCRs for failed inspections that don't have one yet"
              style={{ ...inp, cursor: busy ? 'default' : 'pointer', fontWeight: 600 }}>⚙ Auto-raise from failures</button>
          </div>
          {autoMsg && <div style={{ fontSize: 11, color: 'var(--jarvis-ts)', marginBottom: 8 }}>{autoMsg}</div>}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            <select value={ncrForm.severity} onChange={e => setNcrForm({ ...ncrForm, severity: e.target.value })} style={inp}><option value="minor">Minor</option><option value="major">Major</option><option value="critical">Critical</option></select>
            <select value={ncrForm.source} onChange={e => setNcrForm({ ...ncrForm, source: e.target.value })} style={inp}><option value="inspection">Inspection</option><option value="punch">Punch</option><option value="observation">Observation</option><option value="audit">Audit</option><option value="other">Other</option></select>
            <input placeholder="Title" value={ncrForm.title} onChange={e => setNcrForm({ ...ncrForm, title: e.target.value })} style={{ ...inp, flex: 1, minWidth: 140 }} />
            <button onClick={addNcr} disabled={busy} style={{ ...inp, cursor: 'pointer', fontWeight: 600 }}>+ Raise</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 360, overflow: 'auto' }}>
            {ncrs.map(n => (
              <div key={n.id} onClick={() => setSelected(n)} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: 'var(--jarvis-tx)', padding: '5px 6px', borderRadius: 6, cursor: 'pointer', background: selected?.id === n.id ? 'var(--jarvis-bg)' : 'transparent', borderTop: '1px solid var(--jarvis-bd)' }}>
                <span style={{ width: 8, height: 8, borderRadius: 99, background: SEV_COLOR[n.severity] ?? '#6b7280', flexShrink: 0 }} />
                <span style={{ color: 'var(--jarvis-ts)', width: 48 }}>NCR-{n.ncr_number}</span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.title}</span>
                <span style={{ color: 'var(--jarvis-ts)' }}>{n.status}{n.open_capas ? ` · ${n.open_capas} CAPA` : ''}</span>
              </div>
            ))}
            {ncrs.length === 0 && <div style={{ fontSize: 12, color: 'var(--jarvis-ts)', padding: 8 }}>No NCRs raised.</div>}
          </div>
        </div>

        {/* Detail + CAPAs */}
        <div style={{ ...card, flex: '1 1 460px', minWidth: 320 }}>
          {!selected && <div style={{ fontSize: 13, color: 'var(--jarvis-ts)' }}>Select an NCR to manage its disposition, root cause, and corrective actions.</div>}
          {selected && (
            <>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--jarvis-tx)', marginBottom: 8 }}>NCR-{selected.ncr_number} · {selected.title}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                <label style={{ fontSize: 11, color: 'var(--jarvis-ts)' }}>Status
                  <select value={selected.status} onChange={e => patchNcr(selected.id, { status: e.target.value })} style={{ ...inp, marginLeft: 4 }}>{NCR_STATUS.map(s => <option key={s} value={s}>{s}</option>)}</select>
                </label>
                <label style={{ fontSize: 11, color: 'var(--jarvis-ts)' }}>Disposition
                  <select value={selected.disposition} onChange={e => patchNcr(selected.id, { disposition: e.target.value })} style={{ ...inp, marginLeft: 4 }}>{DISPOSITIONS.map(s => <option key={s} value={s}>{s}</option>)}</select>
                </label>
              </div>
              <input placeholder="Root cause" defaultValue={selected.root_cause ?? ''} onBlur={e => { if (e.target.value !== (selected.root_cause ?? '')) patchNcr(selected.id, { root_cause: e.target.value }) }} style={{ ...inp, width: '100%', marginBottom: 12 }} />

              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--jarvis-tx)', marginBottom: 6 }}>Corrective actions ({capas.length})</div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                <input placeholder="New corrective action…" value={capaDesc} onChange={e => setCapaDesc(e.target.value)} style={{ ...inp, flex: 1 }} />
                <button onClick={addCapa} disabled={busy} style={{ ...inp, cursor: 'pointer', fontWeight: 600 }}>+ Add</button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {capas.map(c => (
                  <div key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: 'var(--jarvis-tx)' }}>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.description}</span>
                    <select value={c.status} onChange={e => patchCapa(c.id, e.target.value)} style={{ ...inp, padding: '2px 4px' }}>{CAPA_STATUS.map(s => <option key={s} value={s}>{s}</option>)}</select>
                  </div>
                ))}
                {capas.length === 0 && <div style={{ fontSize: 12, color: 'var(--jarvis-ts)' }}>No corrective actions yet.</div>}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
