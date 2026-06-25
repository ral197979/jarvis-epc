/**
 * Denver Engineering — Turnover & Commissioning Handoff (v4.38.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * Workflow Redesign W7 (see WORKFLOW_REDESIGN.md §17). Manage turnover packages and
 * the handoff to the external commissioning workspace.
 *
 * Data: GET/POST /api/v1/projects/:id/turnover-packages, PATCH /turnover-packages/:id
 */
import React, { useEffect, useState, useCallback } from 'react'

interface Project { id: string; name: string }
interface Completeness { done: number; total: number; pct: number }
interface Pkg {
  id: string; projectId: string; name: string; area: string | null; status: string
  deliverables: Record<string, boolean>; commissioningUrl: string | null; commissioningStatus: string | null
  ownerId: string | null; notes: string | null; completeness: Completeness; nextStatus: string | null; canAdvance: boolean
}

const DELIVERABLES: { key: string; label: string }[] = [
  { key: 'as_built', label: 'As-built drawings' },
  { key: 'om_manuals', label: 'O&M manuals' },
  { key: 'warranties', label: 'Warranties' },
  { key: 'test_records', label: 'Test & inspection records' },
  { key: 'punch_signoff', label: 'Punch list sign-off' },
]
const STATUS_LABEL: Record<string, string> = {
  open: 'Open', ready_for_commissioning: 'Ready for commissioning', in_commissioning: 'In commissioning',
  ready_for_turnover: 'Ready for turnover', accepted: 'Accepted',
}
const STATUS_COLOR: Record<string, string> = {
  open: 'var(--jarvis-ts)', ready_for_commissioning: '#3b82f6', in_commissioning: '#f59e0b',
  ready_for_turnover: '#a855f7', accepted: '#22c55e',
}

export default function TurnoverView(_props: { onNavigate?: (tab: string) => void }) {
  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState('')
  const [pkgs, setPkgs] = useState<Pkg[]>([])
  const [newName, setNewName] = useState('')
  const [newArea, setNewArea] = useState('')
  const [busy, setBusy] = useState(false)

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
      const res = await fetch(`/api/v1/projects/${pid}/turnover-packages`, { credentials: 'include' })
      setPkgs(res.ok ? (await res.json()).data : [])
    } catch { setPkgs([]) }
  }, [])
  useEffect(() => { load(projectId) }, [projectId, load])

  const patch = async (id: string, body: Record<string, unknown>) => {
    setBusy(true)
    try {
      const res = await fetch(`/api/v1/turnover-packages/${id}`, {
        method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      if (res.ok) { const upd = (await res.json()).data as Pkg; setPkgs(ps => ps.map(p => p.id === id ? upd : p)) }
    } finally { setBusy(false) }
  }

  const create = async () => {
    if (!newName.trim() || !projectId) return
    setBusy(true)
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/turnover-packages`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), area: newArea.trim() || undefined }),
      })
      if (res.ok) { const created = (await res.json()).data as Pkg; setPkgs(ps => [created, ...ps]); setNewName(''); setNewArea('') }
    } finally { setBusy(false) }
  }

  const toggle = (p: Pkg, key: string) =>
    patch(p.id, { deliverables: { ...p.deliverables, [key]: !p.deliverables[key] } })

  const card: React.CSSProperties = { background: 'var(--jarvis-bg2)', border: '1px solid var(--jarvis-bd)', borderRadius: 10, padding: 16, marginBottom: 12 }
  const input: React.CSSProperties = { padding: '7px 10px', borderRadius: 6, border: '1px solid var(--jarvis-bd)', background: 'var(--jarvis-bg)', color: 'var(--jarvis-tx)', fontSize: 13 }

  return (
    <div style={{ padding: 24, maxWidth: 880, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--jarvis-tx)', margin: 0 }}>📦 Turnover & Commissioning</h1>
          <p style={{ fontSize: 13, color: 'var(--jarvis-ts)', margin: '4px 0 0' }}>Deliverable packages and the handoff to the external commissioning workspace.</p>
        </div>
        <select value={projectId} onChange={e => { setProjectId(e.target.value); localStorage.setItem('jarvis-active-project', e.target.value) }} style={input}>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {/* Create */}
      <div style={{ ...card, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input placeholder="New package name" value={newName} onChange={e => setNewName(e.target.value)} style={{ ...input, flex: '1 1 200px' }} />
        <input placeholder="Area / system (optional)" value={newArea} onChange={e => setNewArea(e.target.value)} style={{ ...input, flex: '1 1 160px' }} />
        <button onClick={create} disabled={busy || !newName.trim()} style={{ padding: '7px 14px', borderRadius: 6, fontSize: 13, fontWeight: 700, border: 'none', background: 'var(--jarvis-ac)', color: '#0a0b0f', cursor: 'pointer', opacity: busy || !newName.trim() ? 0.5 : 1 }}>+ Add package</button>
      </div>

      {pkgs.length === 0 && <div style={{ ...card, color: 'var(--jarvis-ts)', fontSize: 13, textAlign: 'center' }}>No turnover packages yet.</div>}

      {pkgs.map(p => (
        <div key={p.id} style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <div>
              <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--jarvis-tx)' }}>{p.name}</span>
              {p.area && <span style={{ fontSize: 12, color: 'var(--jarvis-ts)', marginLeft: 8 }}>{p.area}</span>}
            </div>
            <span style={{ fontSize: 12, fontWeight: 700, color: STATUS_COLOR[p.status] ?? 'var(--jarvis-ts)' }}>{STATUS_LABEL[p.status] ?? p.status}</span>
          </div>

          {/* Completeness bar */}
          <div style={{ margin: '10px 0' }}>
            <div style={{ height: 6, borderRadius: 3, background: 'var(--jarvis-bd)', overflow: 'hidden' }}>
              <div style={{ width: `${p.completeness.pct}%`, height: '100%', background: p.completeness.pct === 100 ? '#22c55e' : 'var(--jarvis-ac)' }} />
            </div>
            <div style={{ fontSize: 11, color: 'var(--jarvis-ts)', marginTop: 4 }}>{p.completeness.done}/{p.completeness.total} deliverables · {p.completeness.pct}%</div>
          </div>

          {/* Deliverables */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            {DELIVERABLES.map(d => (
              <label key={d.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--jarvis-tx)', cursor: 'pointer' }}>
                <input type="checkbox" checked={!!p.deliverables[d.key]} onChange={() => toggle(p, d.key)} disabled={busy} />
                {d.label}
              </label>
            ))}
          </div>

          {/* Commissioning handoff boundary */}
          <div style={{ borderTop: '1px solid var(--jarvis-bd)', paddingTop: 10, fontSize: 12 }}>
            <div style={{ color: 'var(--jarvis-ts)', marginBottom: 6 }}>Commissioning runs in the external workspace — launch it and record its status here.</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {p.commissioningUrl
                ? <a href={p.commissioningUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--jarvis-ac)', fontSize: 12 }}>↗ Open commissioning workspace</a>
                : <span style={{ color: 'var(--jarvis-td)' }}>No commissioning link set</span>}
              <input placeholder="Commissioning workspace URL" defaultValue={p.commissioningUrl ?? ''}
                onBlur={e => { if (e.target.value !== (p.commissioningUrl ?? '')) patch(p.id, { commissioning_url: e.target.value }) }}
                style={{ ...input, flex: '1 1 220px' }} />
              <input placeholder="Recorded commissioning status" defaultValue={p.commissioningStatus ?? ''}
                onBlur={e => { if (e.target.value !== (p.commissioningStatus ?? '')) patch(p.id, { commissioning_status: e.target.value }) }}
                style={{ ...input, flex: '1 1 200px' }} />
            </div>
          </div>

          {/* Advance */}
          {p.nextStatus && (
            <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={() => patch(p.id, { status: p.nextStatus })} disabled={busy || !p.canAdvance}
                title={!p.canAdvance ? 'Complete all deliverables first' : undefined}
                style={{ padding: '7px 14px', borderRadius: 6, fontSize: 13, fontWeight: 700, border: 'none', background: '#22c55e', color: '#0a0b0f', cursor: 'pointer', opacity: busy || !p.canAdvance ? 0.5 : 1 }}>
                Advance → {STATUS_LABEL[p.nextStatus] ?? p.nextStatus}
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
