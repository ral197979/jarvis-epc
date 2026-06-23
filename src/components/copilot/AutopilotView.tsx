/**
 * Denver Engineering — Autonomous Coordination (v4.49.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * The execute-with-approval loop. Scan a project to generate coordination
 * recommendations, then approve (→ creates a tracked action) or dismiss each.
 * Nothing is executed without a human click.
 *
 * API: POST /projects/:id/coordination/scan · GET …/recommendations ·
 *      POST /coordination/recommendations/:id/(approve|dismiss)
 */
import React, { useEffect, useState, useCallback } from 'react'

interface Project { id: string; name: string }
interface Recommendation {
  id: string; category: string; source: string; source_ref: string | null
  title: string; recommended_action: string; rationale: string | null
  suggested_owner: string | null; priority: string; severity: string | null
  status: 'proposed' | 'approved' | 'dismissed' | 'executed'; executed_action_id: string | null
}

const SEV_COLOR: Record<string, string> = { critical: '#ef4444', high: '#f59e0b', medium: '#3b82f6', low: '#6b7280' }
const STATUS_COLOR: Record<string, string> = { proposed: '#3b82f6', executed: '#22c55e', dismissed: '#6b7280', approved: '#22c55e' }
const FILTERS = ['proposed', 'executed', 'dismissed', 'all'] as const

export default function AutopilotView(_props: { onNavigate?: (tab: string) => void }) {
  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState('')
  const [recs, setRecs] = useState<Recommendation[]>([])
  const [filter, setFilter] = useState<typeof FILTERS[number]>('proposed')
  const [busy, setBusy] = useState(false)
  const [scanMsg, setScanMsg] = useState('')

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

  const loadRecs = useCallback(async (pid: string, f: typeof FILTERS[number]) => {
    if (!pid) return
    try {
      const q = f === 'all' ? '' : `?status=${f}`
      const res = await fetch(`/api/v1/projects/${pid}/coordination/recommendations${q}`, { credentials: 'include' })
      const json = await res.json()
      setRecs(json.data || [])
    } catch { setRecs([]) }
  }, [])
  useEffect(() => { loadRecs(projectId, filter) }, [projectId, filter, loadRecs])

  const scan = async () => {
    if (!projectId) return
    setBusy(true); setScanMsg('')
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/coordination/scan`, { method: 'POST', credentials: 'include' })
      const json = await res.json()
      setScanMsg(`Generated ${json.data?.generated ?? 0} recommendation(s).`)
      setFilter('proposed')
      await loadRecs(projectId, 'proposed')
    } finally { setBusy(false) }
  }

  const decide = async (id: string, action: 'approve' | 'dismiss') => {
    setBusy(true)
    try {
      await fetch(`/api/v1/coordination/recommendations/${id}/${action}`, { method: 'POST', credentials: 'include' })
      await loadRecs(projectId, filter)
    } finally { setBusy(false) }
  }

  return (
    <div style={{ padding: 24, maxWidth: 920, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--jarvis-tx)', margin: 0 }}>🤖 Autopilot</h1>
          <p style={{ fontSize: 13, color: 'var(--jarvis-ts)', margin: '4px 0 0' }}>AI detects coordination issues and recommends actions — you approve, it executes.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select value={projectId} onChange={e => { setProjectId(e.target.value); localStorage.setItem('jarvis-active-project', e.target.value) }}
            style={{ padding: '7px 10px', borderRadius: 6, border: '1px solid var(--jarvis-bd)', background: 'var(--jarvis-bg2)', color: 'var(--jarvis-tx)', fontSize: 13 }}>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button onClick={scan} disabled={busy} style={{ padding: '7px 14px', borderRadius: 6, fontSize: 13, border: 'none', background: 'var(--jarvis-ac)', color: '#0a0b0f', fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>{busy ? 'Scanning…' : '⚡ Scan'}</button>
        </div>
      </div>

      {scanMsg && <div style={{ fontSize: 12, color: 'var(--jarvis-ts)', marginBottom: 12 }}>{scanMsg}</div>}

      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {FILTERS.map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: '4px 12px', borderRadius: 99, fontSize: 12, cursor: 'pointer', textTransform: 'capitalize',
            border: `1px solid ${filter === f ? 'var(--jarvis-ac)' : 'var(--jarvis-bd)'}`,
            background: filter === f ? 'var(--jarvis-ac)' : 'transparent', color: filter === f ? '#0a0b0f' : 'var(--jarvis-tx)', fontWeight: filter === f ? 700 : 400,
          }}>{f}</button>
        ))}
      </div>

      {recs.length === 0 && <div style={{ padding: 32, textAlign: 'center', color: 'var(--jarvis-ts)', fontSize: 13 }}>No {filter === 'all' ? '' : filter} recommendations. Click Scan to detect coordination issues.</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {recs.map(r => {
          const color = SEV_COLOR[r.severity ?? 'medium'] ?? '#6b7280'
          return (
            <div key={r.id} style={{ background: 'var(--jarvis-bg2)', border: '1px solid var(--jarvis-bd)', borderLeft: `3px solid ${color}`, borderRadius: 10, padding: '14px 16px' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
                {r.severity && <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: '#0a0b0f', background: color, padding: '2px 7px', borderRadius: 99 }}>{r.severity}</span>}
                <span style={{ fontSize: 12, color: 'var(--jarvis-ts)' }}>{r.category.replace(/_/g, ' ')} · {r.source_ref}</span>
                <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: STATUS_COLOR[r.status] }}>{r.status}{r.executed_action_id ? ' →action' : ''}</span>
              </div>
              <div style={{ fontSize: 13, color: 'var(--jarvis-tx)', marginBottom: 4 }}>{r.title}</div>
              <div style={{ fontSize: 12, color: 'var(--jarvis-ts)' }}><strong style={{ color: 'var(--jarvis-tx)' }}>Recommend:</strong> {r.recommended_action}</div>
              {r.rationale && <div style={{ fontSize: 11, color: 'var(--jarvis-ts)', marginTop: 4 }}>{r.rationale}</div>}
              {r.status === 'proposed' && (
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button onClick={() => decide(r.id, 'approve')} disabled={busy} style={{ padding: '5px 14px', borderRadius: 6, fontSize: 12, border: 'none', background: '#22c55e', color: '#0a0b0f', fontWeight: 700, cursor: 'pointer' }}>✓ Approve &amp; create action</button>
                  <button onClick={() => decide(r.id, 'dismiss')} disabled={busy} style={{ padding: '5px 14px', borderRadius: 6, fontSize: 12, border: '1px solid var(--jarvis-bd)', background: 'var(--jarvis-bg)', color: 'var(--jarvis-tx)', cursor: 'pointer' }}>Dismiss</button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
