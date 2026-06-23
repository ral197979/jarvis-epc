/**
 * Denver Engineering — AI Field Assistant (v4.48.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * Answers the field's daily questions: what inspections are due today, what's
 * behind schedule, and what's open in a given area. Deterministic, grounded in
 * inspections + punch + schedule.
 *
 * Data: GET /api/v1/projects/:id/field-assistant.
 */
import React, { useEffect, useState, useCallback } from 'react'

type Severity = 'high' | 'medium' | 'low'
interface FieldItem { type: string; ref: string; title: string; location: string | null; status: string; note: string; dueDate: string | null; daysOverdue: number | null; severity: Severity }
interface FieldBriefing {
  generatedAt: string
  areas: string[]
  summary: { inspectionsDue: number; behindSchedule: number; openItems: number }
  inspectionsDue: FieldItem[]
  behindSchedule: FieldItem[]
  openItems: FieldItem[]
}
interface Project { id: string; name: string }

const SEV: Record<Severity, string> = { high: '#ef4444', medium: '#f59e0b', low: '#6b7280' }

function ItemRow({ it }: { it: FieldItem }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 0', borderTop: '1px solid var(--jarvis-bd)' }}>
      <span style={{ width: 8, height: 8, borderRadius: 99, background: SEV[it.severity], flexShrink: 0 }} />
      <span style={{ fontSize: 11, color: 'var(--jarvis-ts)', width: 90, flexShrink: 0 }}>{it.ref}</span>
      <span style={{ flex: 1, fontSize: 13, color: 'var(--jarvis-tx)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.title}</span>
      {it.location && <span style={{ fontSize: 11, color: 'var(--jarvis-ts)' }}>📍 {it.location}</span>}
      <span style={{ fontSize: 11, color: it.severity === 'high' ? SEV.high : 'var(--jarvis-ts)', width: 150, textAlign: 'right' }}>{it.note}</span>
    </div>
  )
}

function Section({ title, emoji, items, empty }: { title: string; emoji: string; items: FieldItem[]; empty: string }) {
  return (
    <div style={{ background: 'var(--jarvis-bg2)', border: '1px solid var(--jarvis-bd)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--jarvis-tx)', marginBottom: 4 }}>{emoji} {title} ({items.length})</div>
      {items.length === 0 ? <div style={{ fontSize: 13, color: 'var(--jarvis-ts)', paddingTop: 8 }}>{empty}</div>
        : <div>{items.map((it, i) => <ItemRow key={`${it.ref}-${i}`} it={it} />)}</div>}
    </div>
  )
}

export default function FieldAssistantView(_props: { onNavigate?: (tab: string) => void }) {
  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState('')
  const [data, setData] = useState<FieldBriefing | null>(null)
  const [area, setArea] = useState<string>('all')
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
      const res = await fetch(`/api/v1/projects/${pid}/field-assistant`, { credentials: 'include' })
      const json = await res.json()
      setData(json.data)
      setArea('all')
    } catch { setData(null) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load(projectId) }, [projectId, load])

  const byArea = (items: FieldItem[]) => area === 'all' ? items : items.filter(i => i.location === area)

  return (
    <div style={{ padding: 24, maxWidth: 860, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--jarvis-tx)', margin: 0 }}>🦺 Field Assistant</h1>
          <p style={{ fontSize: 13, color: 'var(--jarvis-ts)', margin: '4px 0 0' }}>Due today, behind schedule, and what&apos;s open by area.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={projectId} onChange={e => { setProjectId(e.target.value); localStorage.setItem('jarvis-active-project', e.target.value) }}
            style={{ padding: '7px 10px', borderRadius: 6, border: '1px solid var(--jarvis-bd)', background: 'var(--jarvis-bg2)', color: 'var(--jarvis-tx)', fontSize: 13 }}>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button onClick={() => load(projectId)} disabled={loading} style={{ padding: '7px 12px', borderRadius: 6, fontSize: 13, border: '1px solid var(--jarvis-bd)', background: 'var(--jarvis-bg2)', color: 'var(--jarvis-tx)', cursor: 'pointer' }}>{loading ? '…' : '↻'}</button>
        </div>
      </div>

      {data && (
        <>
          {/* Area filter */}
          {data.areas.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--jarvis-ts)' }}>Area:</span>
              {['all', ...data.areas].map(a => (
                <button key={a} onClick={() => setArea(a)} style={{
                  padding: '4px 12px', borderRadius: 99, fontSize: 12, cursor: 'pointer',
                  border: `1px solid ${area === a ? 'var(--jarvis-ac)' : 'var(--jarvis-bd)'}`,
                  background: area === a ? 'var(--jarvis-ac)' : 'transparent', color: area === a ? '#0a0b0f' : 'var(--jarvis-tx)', fontWeight: area === a ? 700 : 400,
                }}>{a === 'all' ? 'All areas' : a}</button>
              ))}
            </div>
          )}

          <Section title="Inspections due" emoji="🔍" items={byArea(data.inspectionsDue)} empty="No inspections due today." />
          <Section title="Behind schedule" emoji="⏱️" items={data.behindSchedule} empty="Nothing flagged behind schedule." />
          <Section title={area === 'all' ? 'Open items' : `Open in ${area}`} emoji="📌" items={byArea(data.openItems)} empty="No open items here." />
        </>
      )}
      {!data && loading && <div style={{ padding: 24, textAlign: 'center', color: 'var(--jarvis-ts)', fontSize: 13 }}>Checking the field…</div>}
    </div>
  )
}
