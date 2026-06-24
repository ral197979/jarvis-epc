/**
 * Denver Engineering — Schedule Forecast (v4.50.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * Monte Carlo completion forecast, criticality, critical path, and a recovery
 * plan — computed over the real CPM dependency network.
 *
 * Data: GET /api/v1/schedule/:projectId/forecast?iterations=&target=
 */
import React, { useEffect, useState, useCallback } from 'react'

interface Project { id: string; name: string }
interface Crit { taskId: string; name: string; index: number }
interface PathStep { taskId: string; name: string; durationDays: number; totalFloat: number }
interface Recovery { taskId: string; name: string; durationDays: number; criticalityIndex: number; daysSaved: number; action: string }
interface Forecast {
  iterations: number; deterministicFinish: number
  p10: number; p50: number; p80: number; p90: number; mean: number
  targetDays: number | null; probabilityOnTarget: number | null
  criticality: Crit[]; criticalPath: PathStep[]; recovery: Recovery[]
}

export default function ScheduleForecastView(_props: { onNavigate?: (tab: string) => void }) {
  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState('')
  const [target, setTarget] = useState('')
  const [data, setData] = useState<Forecast | null>(null)
  const [error, setError] = useState('')
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

  const run = useCallback(async (pid: string, tgt: string) => {
    if (!pid) return
    setBusy(true); setError(''); setData(null)
    try {
      const q = `iterations=2000${tgt ? `&target=${encodeURIComponent(tgt)}` : ''}`
      const res = await fetch(`/api/v1/schedule/${pid}/forecast?${q}`, { credentials: 'include' })
      const json = await res.json()
      if (!res.ok) { setError(json.error || 'Forecast failed'); return }
      setData(json.data)
    } catch { setError('Forecast failed') } finally { setBusy(false) }
  }, [])
  useEffect(() => { run(projectId, '') }, [projectId, run])

  const card: React.CSSProperties = { background: 'var(--jarvis-bg2)', border: '1px solid var(--jarvis-bd)', borderRadius: 10, padding: 16, marginBottom: 16 }
  const onTargetColor = data?.probabilityOnTarget == null ? '#6b7280' : data.probabilityOnTarget >= 0.8 ? '#22c55e' : data.probabilityOnTarget >= 0.5 ? '#f59e0b' : '#ef4444'

  return (
    <div style={{ padding: 24, maxWidth: 920, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--jarvis-tx)', margin: 0 }}>🎲 Schedule Forecast</h1>
          <p style={{ fontSize: 13, color: 'var(--jarvis-ts)', margin: '4px 0 0' }}>Monte Carlo completion, criticality, and a recovery plan over the CPM network.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={projectId} onChange={e => { setProjectId(e.target.value); localStorage.setItem('jarvis-active-project', e.target.value) }}
            style={{ padding: '7px 10px', borderRadius: 6, border: '1px solid var(--jarvis-bd)', background: 'var(--jarvis-bg2)', color: 'var(--jarvis-tx)', fontSize: 13 }}>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input placeholder="Target days" value={target} onChange={e => setTarget(e.target.value)} style={{ width: 90, padding: '7px 8px', borderRadius: 6, border: '1px solid var(--jarvis-bd)', background: 'var(--jarvis-bg)', color: 'var(--jarvis-tx)', fontSize: 13 }} />
          <button onClick={() => run(projectId, target)} disabled={busy} style={{ padding: '7px 14px', borderRadius: 6, fontSize: 13, border: 'none', background: 'var(--jarvis-ac)', color: '#0a0b0f', fontWeight: 700, cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>{busy ? 'Running…' : 'Run'}</button>
        </div>
      </div>

      {error && <div style={{ ...card, color: 'var(--jarvis-ts)', fontSize: 13 }}>{error}</div>}

      {data && (
        <>
          {/* Completion percentiles */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
            {([['Planned (CPM)', data.deterministicFinish], ['P50', data.p50], ['P80', data.p80], ['P90', data.p90]] as [string, number][]).map(([label, val]) => (
              <div key={label} style={{ ...card, flex: '1 1 120px', minWidth: 120, marginBottom: 0, textAlign: 'center' }}>
                <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--jarvis-tx)', fontFamily: 'var(--jarvis-font-mono)' }}>{val}</div>
                <div style={{ fontSize: 11, color: 'var(--jarvis-ts)' }}>{label} days</div>
              </div>
            ))}
            {data.probabilityOnTarget != null && (
              <div style={{ ...card, flex: '1 1 150px', minWidth: 150, marginBottom: 0, textAlign: 'center', borderColor: onTargetColor }}>
                <div style={{ fontSize: 24, fontWeight: 800, color: onTargetColor, fontFamily: 'var(--jarvis-font-mono)' }}>{Math.round(data.probabilityOnTarget * 100)}%</div>
                <div style={{ fontSize: 11, color: 'var(--jarvis-ts)' }}>on target ({data.targetDays}d)</div>
              </div>
            )}
          </div>
          <div style={{ fontSize: 11, color: 'var(--jarvis-ts)', marginTop: -8, marginBottom: 16 }}>{data.iterations.toLocaleString()} iterations · P10 {data.p10}d · mean {data.mean}d</div>

          {/* Recovery plan */}
          <div style={card}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--jarvis-tx)', marginBottom: 10 }}>🛠️ Recovery plan</div>
            {data.recovery.length === 0 ? <div style={{ fontSize: 13, color: 'var(--jarvis-ts)' }}>No single-task crash meaningfully pulls in the finish — recovery needs re-sequencing or scope change.</div>
              : data.recovery.map(r => (
                <div key={r.taskId} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '6px 0', borderTop: '1px solid var(--jarvis-bd)' }}>
                  <span style={{ fontWeight: 700, color: '#22c55e', fontFamily: 'var(--jarvis-font-mono)', width: 70 }}>−{r.daysSaved}d</span>
                  <span style={{ flex: 1, fontSize: 13, color: 'var(--jarvis-tx)' }}>{r.action}</span>
                </div>
              ))}
          </div>

          {/* Criticality */}
          <div style={card}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--jarvis-tx)', marginBottom: 10 }}>Criticality index (how often each task drives the finish)</div>
            {data.criticality.slice(0, 12).map(c => (
              <div key={c.taskId} style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 5 }}>
                <span style={{ width: 180, fontSize: 12, color: 'var(--jarvis-tx)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                <div style={{ flex: 1, height: 8, background: 'var(--jarvis-bg)', borderRadius: 99, overflow: 'hidden' }}>
                  <div style={{ width: `${Math.round(c.index * 100)}%`, height: '100%', background: c.index >= 0.6 ? '#ef4444' : c.index >= 0.3 ? '#f59e0b' : '#3b82f6' }} />
                </div>
                <span style={{ width: 44, textAlign: 'right', fontSize: 11, color: 'var(--jarvis-ts)', fontFamily: 'var(--jarvis-font-mono)' }}>{Math.round(c.index * 100)}%</span>
              </div>
            ))}
          </div>

          {/* Critical path */}
          <div style={card}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--jarvis-tx)', marginBottom: 8 }}>Critical path (zero float — any delay slips the finish)</div>
            <div style={{ fontSize: 12, color: 'var(--jarvis-tx)', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              {data.criticalPath.map((s, i) => (
                <React.Fragment key={s.taskId}>
                  <span style={{ background: 'var(--jarvis-bg)', border: '1px solid var(--jarvis-bd)', borderRadius: 6, padding: '3px 8px' }}>{s.name} <span style={{ color: 'var(--jarvis-ts)' }}>({s.durationDays}d)</span></span>
                  {i < data.criticalPath.length - 1 && <span style={{ color: 'var(--jarvis-ts)' }}>→</span>}
                </React.Fragment>
              ))}
              {data.criticalPath.length === 0 && <span style={{ color: 'var(--jarvis-ts)' }}>No critical path computed.</span>}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
