/**
 * Denver Engineering — Quality Intelligence (v4.51.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * Recurring issues, discipline performance (quality score), and location
 * hotspots from inspections + punch items. Deterministic.
 *
 * Data: GET /api/v1/projects/:projectId/quality-intelligence
 */
import React, { useEffect, useState, useCallback } from 'react'

interface Project { id: string; name: string }
interface RecurringIssue { category: string; discipline: string; count: number; examples: string[] }
interface DisciplinePerf { discipline: string; inspections: number; inspectionsFailed: number; failRatePct: number; punchTotal: number; punchOpen: number; avgDaysToClose: number | null; qualityScore: number }
interface Hotspot { location: string; openIssues: number }
interface QualityIntel {
  headline: string
  summary: { inspections: number; failedInspections: number; punchTotal: number; punchOpen: number; recurringIssues: number }
  recurringIssues: RecurringIssue[]
  disciplinePerformance: DisciplinePerf[]
  hotspots: Hotspot[]
}

const scoreColor = (n: number) => (n >= 80 ? '#22c55e' : n >= 60 ? '#3b82f6' : n >= 40 ? '#f59e0b' : '#ef4444')

export default function QualityIntelligenceView(_props: { onNavigate?: (tab: string) => void }) {
  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState('')
  const [data, setData] = useState<QualityIntel | null>(null)
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
      const res = await fetch(`/api/v1/projects/${pid}/quality-intelligence`, { credentials: 'include' })
      const json = await res.json()
      setData(res.ok ? json.data : null)
    } catch { setData(null) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load(projectId) }, [projectId, load])

  const card: React.CSSProperties = { background: 'var(--jarvis-bg2)', border: '1px solid var(--jarvis-bd)', borderRadius: 10, padding: 16, marginBottom: 16 }
  const h: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: 'var(--jarvis-tx)', marginBottom: 10 }

  return (
    <div style={{ padding: 24, maxWidth: 980, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--jarvis-tx)', margin: 0 }}>🔬 Quality Intelligence</h1>
          <p style={{ fontSize: 13, color: 'var(--jarvis-ts)', margin: '4px 0 0' }}>Recurring issues, discipline performance, and hotspots from inspections + punch.</p>
        </div>
        <select value={projectId} onChange={e => { setProjectId(e.target.value); localStorage.setItem('jarvis-active-project', e.target.value) }}
          style={{ padding: '7px 10px', borderRadius: 6, border: '1px solid var(--jarvis-bd)', background: 'var(--jarvis-bg2)', color: 'var(--jarvis-tx)', fontSize: 13 }}>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {loading && !data && <div style={{ ...card, color: 'var(--jarvis-ts)', fontSize: 13 }}>Analysing quality records…</div>}

      {data && (
        <>
          <div style={{ ...card, fontSize: 14, color: 'var(--jarvis-tx)', lineHeight: 1.5 }}>{data.headline}</div>

          {/* Recurring issues */}
          <div style={card}>
            <div style={h}>Recurring issues ({data.recurringIssues.length})</div>
            {data.recurringIssues.length === 0 && <div style={{ fontSize: 13, color: 'var(--jarvis-ts)' }}>No repeated failure patterns detected.</div>}
            {data.recurringIssues.map(r => (
              <div key={`${r.discipline}-${r.category}`} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '6px 0', borderTop: '1px solid var(--jarvis-bd)' }}>
                <span style={{ width: 36, fontWeight: 700, color: '#ef4444', fontFamily: 'var(--jarvis-font-mono)' }}>{r.count}×</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: 'var(--jarvis-tx)' }}><strong>{r.discipline}</strong> · {r.category}</div>
                  <div style={{ fontSize: 11, color: 'var(--jarvis-ts)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.examples.join(' · ')}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Discipline performance */}
          <div style={card}>
            <div style={h}>Discipline performance (worst first)</div>
            {data.disciplinePerformance.map(d => (
              <div key={d.discipline} style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 7 }}>
                <span style={{ width: 130, fontSize: 12, color: 'var(--jarvis-tx)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.discipline}</span>
                <div style={{ flex: 1, height: 8, background: 'var(--jarvis-bg)', borderRadius: 99, overflow: 'hidden' }}>
                  <div style={{ width: `${d.qualityScore}%`, height: '100%', background: scoreColor(d.qualityScore) }} />
                </div>
                <span style={{ width: 36, textAlign: 'right', fontSize: 12, fontWeight: 700, color: scoreColor(d.qualityScore), fontFamily: 'var(--jarvis-font-mono)' }}>{d.qualityScore}</span>
                <span style={{ width: 220, textAlign: 'right', fontSize: 11, color: 'var(--jarvis-ts)' }}>
                  {d.failRatePct}% fail · {d.punchOpen} open{d.avgDaysToClose != null ? ` · ${d.avgDaysToClose}d close` : ''}
                </span>
              </div>
            ))}
          </div>

          {/* Hotspots */}
          {data.hotspots.length > 0 && (
            <div style={card}>
              <div style={h}>Location hotspots</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {data.hotspots.map(hs => (
                  <span key={hs.location} style={{ fontSize: 12, color: 'var(--jarvis-tx)', background: 'var(--jarvis-bg)', border: '1px solid var(--jarvis-bd)', padding: '4px 10px', borderRadius: 99 }}>
                    📍 {hs.location} <strong style={{ color: '#ef4444' }}>{hs.openIssues}</strong>
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
