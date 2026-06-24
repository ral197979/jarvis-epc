/**
 * Denver Engineering — Safety (v4.53.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 10. Log safety observations + incidents and view the predictive engine:
 * risk index, leading indicators, high-risk areas, and recurring hazards.
 *
 * API: /api/v1/projects/:id/safety/{observations,incidents,intelligence}
 */
import React, { useEffect, useState, useCallback } from 'react'

interface Project { id: string; name: string }
interface Obs { id: string; type: string; severity: string; status: string; location: string | null; description: string; observed_at: string }
interface Inc { id: string; type: string; severity: string; status: string; location: string | null; description: string; incident_date: string }
interface Intel {
  headline: string
  leadingIndicators: { observations: number; incidents: number; nearMisses: number; recordables: number; openHighSeverity: number; observationToIncidentRatio: number | null; reportingCulture: string; riskIndex: number; riskLevel: 'low' | 'medium' | 'high' | 'critical' }
  highRiskAreas: { location: string; observations: number; incidents: number; riskScore: number }[]
  recurringHazards: { hazard: string; count: number; examples: string[] }[]
}

const SEV_COLOR: Record<string, string> = { low: '#22c55e', medium: '#3b82f6', high: '#f59e0b', critical: '#ef4444' }
const riskColor = (l: string) => (l === 'low' ? '#22c55e' : l === 'medium' ? '#3b82f6' : l === 'high' ? '#f59e0b' : '#ef4444')

export default function SafetyView(_props: { onNavigate?: (tab: string) => void }) {
  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState('')
  const [obs, setObs] = useState<Obs[]>([])
  const [inc, setInc] = useState<Inc[]>([])
  const [intel, setIntel] = useState<Intel | null>(null)
  const [busy, setBusy] = useState(false)
  const [obsForm, setObsForm] = useState({ type: 'unsafe_condition', severity: 'low', location: '', description: '' })
  const [incForm, setIncForm] = useState({ type: 'near_miss', severity: 'medium', location: '', description: '' })

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
      const [o, i, n] = await Promise.all([
        fetch(`/api/v1/projects/${pid}/safety/observations`, { credentials: 'include' }).then(r => r.json()),
        fetch(`/api/v1/projects/${pid}/safety/incidents`, { credentials: 'include' }).then(r => r.json()),
        fetch(`/api/v1/projects/${pid}/safety/intelligence`, { credentials: 'include' }).then(r => r.json()),
      ])
      setObs(o.data || []); setInc(i.data || []); setIntel(n.data || null)
    } catch { /* ignore */ }
  }, [])
  useEffect(() => { load(projectId) }, [projectId, load])

  const addObs = async () => {
    if (!obsForm.description.trim()) return
    setBusy(true)
    try {
      await fetch(`/api/v1/projects/${projectId}/safety/observations`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obsForm) })
      setObsForm({ ...obsForm, location: '', description: '' }); await load(projectId)
    } finally { setBusy(false) }
  }
  const addInc = async () => {
    if (!incForm.description.trim()) return
    setBusy(true)
    try {
      await fetch(`/api/v1/projects/${projectId}/safety/incidents`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(incForm) })
      setIncForm({ ...incForm, location: '', description: '' }); await load(projectId)
    } finally { setBusy(false) }
  }

  const card: React.CSSProperties = { background: 'var(--jarvis-bg2)', border: '1px solid var(--jarvis-bd)', borderRadius: 10, padding: 16, marginBottom: 16 }
  const inp: React.CSSProperties = { padding: '5px 8px', borderRadius: 6, border: '1px solid var(--jarvis-bd)', background: 'var(--jarvis-bg)', color: 'var(--jarvis-tx)', fontSize: 12 }
  const sel: React.CSSProperties = { ...inp }
  const li = intel?.leadingIndicators

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--jarvis-tx)', margin: 0 }}>🦺 Safety</h1>
          <p style={{ fontSize: 13, color: 'var(--jarvis-ts)', margin: '4px 0 0' }}>Observations, incidents, and the predictive safety engine.</p>
        </div>
        <select value={projectId} onChange={e => { setProjectId(e.target.value); localStorage.setItem('jarvis-active-project', e.target.value) }} style={{ ...sel, padding: '7px 10px', fontSize: 13 }}>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {/* Predictive engine */}
      {intel && li && (
        <div style={card}>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ textAlign: 'center', minWidth: 90 }}>
              <div style={{ fontSize: 34, fontWeight: 800, color: riskColor(li.riskLevel), lineHeight: 1 }}>{li.riskIndex}</div>
              <div style={{ fontSize: 11, color: 'var(--jarvis-ts)' }}>risk index · {li.riskLevel}</div>
            </div>
            <div style={{ flex: 1, minWidth: 220, fontSize: 14, color: 'var(--jarvis-tx)', lineHeight: 1.5 }}>{intel.headline}</div>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {([['Observations', li.observations], ['Incidents', li.incidents], ['Near misses', li.nearMisses], ['Recordables', li.recordables], ['Open high-sev', li.openHighSeverity], ['Obs:Incident', li.observationToIncidentRatio ?? '—']] as [string, number | string][]).map(([k, v]) => (
              <div key={k} style={{ flex: '1 1 110px', minWidth: 110, border: '1px solid var(--jarvis-bd)', borderRadius: 8, padding: 10 }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--jarvis-tx)' }}>{v}</div>
                <div style={{ fontSize: 11, color: 'var(--jarvis-ts)' }}>{k}</div>
              </div>
            ))}
          </div>
          {(intel.highRiskAreas.length > 0 || intel.recurringHazards.length > 0) && (
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 12 }}>
              {intel.highRiskAreas.length > 0 && (
                <div style={{ flex: '1 1 280px' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--jarvis-tx)', marginBottom: 6 }}>High-risk areas</div>
                  {intel.highRiskAreas.map(a => (
                    <div key={a.location} style={{ fontSize: 12, color: 'var(--jarvis-tx)', display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                      <span>📍 {a.location}</span><span style={{ color: 'var(--jarvis-ts)' }}>{a.incidents} inc · {a.observations} obs · <strong style={{ color: '#ef4444' }}>{a.riskScore}</strong></span>
                    </div>
                  ))}
                </div>
              )}
              {intel.recurringHazards.length > 0 && (
                <div style={{ flex: '1 1 280px' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--jarvis-tx)', marginBottom: 6 }}>Recurring hazards</div>
                  {intel.recurringHazards.map(h => (
                    <div key={h.hazard} style={{ fontSize: 12, color: 'var(--jarvis-tx)', marginBottom: 3 }}><strong>{h.count}×</strong> {h.hazard} <span style={{ color: 'var(--jarvis-ts)' }}>— {h.examples[0]}</span></div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Logging + lists */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {/* Observations */}
        <div style={{ ...card, flex: '1 1 480px', minWidth: 320 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--jarvis-tx)', marginBottom: 8 }}>Observations ({obs.length})</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            <select value={obsForm.type} onChange={e => setObsForm({ ...obsForm, type: e.target.value })} style={sel}>
              <option value="unsafe_condition">Unsafe condition</option><option value="unsafe_act">Unsafe act</option><option value="hazard">Hazard</option><option value="positive">Positive</option>
            </select>
            <select value={obsForm.severity} onChange={e => setObsForm({ ...obsForm, severity: e.target.value })} style={sel}>
              <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option>
            </select>
            <input placeholder="Location" value={obsForm.location} onChange={e => setObsForm({ ...obsForm, location: e.target.value })} style={{ ...inp, width: 110 }} />
            <input placeholder="Description" value={obsForm.description} onChange={e => setObsForm({ ...obsForm, description: e.target.value })} style={{ ...inp, flex: 1, minWidth: 140 }} />
            <button onClick={addObs} disabled={busy} style={{ ...inp, cursor: 'pointer', fontWeight: 600 }}>+ Log</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 320, overflow: 'auto' }}>
            {obs.map(o => (
              <div key={o.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: 'var(--jarvis-tx)', padding: '4px 0', borderTop: '1px solid var(--jarvis-bd)' }}>
                <span style={{ width: 8, height: 8, borderRadius: 99, background: SEV_COLOR[o.severity] ?? '#6b7280', flexShrink: 0 }} />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.description}</span>
                <span style={{ color: 'var(--jarvis-ts)' }}>{o.location ?? ''} · {o.status}</span>
              </div>
            ))}
            {obs.length === 0 && <div style={{ fontSize: 12, color: 'var(--jarvis-ts)', padding: 8 }}>No observations logged.</div>}
          </div>
        </div>

        {/* Incidents */}
        <div style={{ ...card, flex: '1 1 480px', minWidth: 320 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--jarvis-tx)', marginBottom: 8 }}>Incidents ({inc.length})</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            <select value={incForm.type} onChange={e => setIncForm({ ...incForm, type: e.target.value })} style={sel}>
              <option value="near_miss">Near miss</option><option value="first_aid">First aid</option><option value="injury">Injury</option><option value="property_damage">Property</option><option value="environmental">Environmental</option>
            </select>
            <select value={incForm.severity} onChange={e => setIncForm({ ...incForm, severity: e.target.value })} style={sel}>
              <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option>
            </select>
            <input placeholder="Location" value={incForm.location} onChange={e => setIncForm({ ...incForm, location: e.target.value })} style={{ ...inp, width: 110 }} />
            <input placeholder="Description" value={incForm.description} onChange={e => setIncForm({ ...incForm, description: e.target.value })} style={{ ...inp, flex: 1, minWidth: 140 }} />
            <button onClick={addInc} disabled={busy} style={{ ...inp, cursor: 'pointer', fontWeight: 600 }}>+ Log</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 320, overflow: 'auto' }}>
            {inc.map(i => (
              <div key={i.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: 'var(--jarvis-tx)', padding: '4px 0', borderTop: '1px solid var(--jarvis-bd)' }}>
                <span style={{ width: 8, height: 8, borderRadius: 99, background: SEV_COLOR[i.severity] ?? '#6b7280', flexShrink: 0 }} />
                <span style={{ color: 'var(--jarvis-ts)', width: 78 }}>{i.type.replace('_', ' ')}</span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.description}</span>
                <span style={{ color: 'var(--jarvis-ts)' }}>{i.status}</span>
              </div>
            ))}
            {inc.length === 0 && <div style={{ fontSize: 12, color: 'var(--jarvis-ts)', padding: 8 }}>No incidents logged.</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
