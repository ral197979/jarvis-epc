/**
 * Denver Engineering — DailyLogsView · Procore-parity Daily Log  (v4.31.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * Field daily log: weather, manpower, equipment, work performed, delays,
 * safety notes, incidents, photos. Draft → submitted → approved lifecycle.
 */
import React, { useState, useEffect, useCallback } from 'react'
import { useBizStore, selectProjects } from '../modules/biz/store'
import type { PolicyConfig } from '../modules/biz/dispatch'
import { downloadCsv } from '../utils/csv'

interface ManpowerRow { trade: string; count: number; hours: number; contractor?: string }
interface DailyLog {
  id: string; log_date: string; weather?: string; temp_f?: number; wind_mph?: number; humidity_pct?: number
  manpower: ManpowerRow[]; equipment: any[]; visitors: any[]; deliveries: any[]
  work_performed?: string; delays?: string; safety_notes?: string; incidents: any[]
  quality_notes?: string; photos: any[]; status: 'draft'|'submitted'|'approved'
  created_at: string; submitted_at?: string; approved_at?: string
}

export interface DailyLogsViewProps { policy?: Partial<PolicyConfig>; onToast?: (m: string, t?: string) => void; onAudit?: (e: unknown) => void }

const EMPTY_LOG: Omit<DailyLog,'id'|'created_at'|'status'> & { status: string } = {
  log_date: new Date().toISOString().slice(0,10),
  weather: 'sunny', manpower: [], equipment: [], visitors: [], deliveries: [],
  work_performed: '', delays: '', safety_notes: '', incidents: [], quality_notes: '',
  photos: [], status: 'draft',
}

export function DailyLogsView({ policy, onToast, onAudit }: DailyLogsViewProps) {
  const projects = useBizStore(selectProjects)
  const [projectId, setProjectId] = useState<string>('')
  const [logs, setLogs] = useState<DailyLog[]>([])
  const [selected, setSelected] = useState<DailyLog | null>(null)
  const [draft, setDraft] = useState<any>(EMPTY_LOG)
  const [creating, setCreating] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => { if (projects?.length && !projectId) setProjectId(projects[0].id) }, [projects])

  const reload = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/daily-logs?limit=60`)
      const j = await res.json(); setLogs(j.logs ?? [])
    } finally { setLoading(false) }
  }, [projectId])

  useEffect(() => { reload() }, [reload])

  const create = async () => {
    const res = await fetch(`/api/v1/projects/${projectId}/daily-logs`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    })
    if (res.ok) { setCreating(false); onToast?.('Daily log saved', 'success'); onAudit?.({ type: 'daily.log.created' }); setDraft(EMPTY_LOG); reload() }
  }

  const transition = async (id: string, action: 'submit'|'approve') => {
    await fetch(`/api/v1/daily-logs/${id}/${action}`, { method: 'POST' }); reload()
  }

  const canWrite = policy?.writesEnabled !== false
  const badge = (s: string) => ({
    draft: 'var(--jarvis-ts)', submitted: 'var(--jarvis-blue)', approved: 'var(--jarvis-grn)'
  } as Record<string,string>)[s] ?? 'var(--jarvis-ts)'

  return (
    <div role="main" aria-label="Daily Logs" style={{ padding: 16 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>🗓️ Daily Logs</h2>
        <select value={projectId} onChange={e => setProjectId(e.target.value)} style={{ padding: 6 }}>
          {projects?.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {canWrite && (<>
          <button onClick={() => setCreating(true)} style={{ marginLeft: 'auto', padding: '6px 14px', background: 'var(--jarvis-ac)', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>+ New Log</button>
          <button
            disabled={!logs.length}
            onClick={() => downloadCsv(`daily-logs-${new Date().toISOString().slice(0,10)}.csv`, logs.map((l: any) => ({
              id: l.id, project_id: l.project_id, log_date: l.log_date, status: l.status,
              weather: (l.weather && (l.weather.summary ?? JSON.stringify(l.weather))) ?? '',
              manpower_total: Array.isArray(l.manpower) ? l.manpower.reduce((a:number,b:any)=>a+(b.count||0),0) : '',
              hours_total: Array.isArray(l.manpower) ? l.manpower.reduce((a:number,b:any)=>a+((b.count||0)*(b.hours||0)),0) : '',
              notes: l.notes ?? '', created_at: l.created_at
            })))}
            style={{ marginLeft: 8, padding: '6px 14px', border: '1px solid var(--jarvis-ac)', background: 'transparent', color: 'var(--jarvis-ac)', borderRadius: 4, cursor: logs.length ? 'pointer' : 'not-allowed', opacity: logs.length ? 1 : 0.5 }}
            title="Export logs to CSV"
          >⬇ CSV</button>
        </>)}
      </div>

      {creating && (
        <div style={{ border: '1px solid var(--jarvis-bd)', padding: 16, borderRadius: 6, marginBottom: 16, background: 'var(--jarvis-bg2)' }}>
          <h3 style={{ marginTop: 0 }}>New Daily Log</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            <label>Date <input type="date" value={draft.log_date} onChange={e => setDraft({ ...draft, log_date: e.target.value })} /></label>
            <label>Weather <select value={draft.weather} onChange={e => setDraft({ ...draft, weather: e.target.value })}>
              {['sunny','overcast','rain','storm','snow','fog','wind'].map(w => <option key={w}>{w}</option>)}
            </select></label>
            <label>Temp (°F) <input type="number" value={draft.temp_f ?? ''} onChange={e => setDraft({ ...draft, temp_f: Number(e.target.value) })} /></label>
            <label>Wind (mph) <input type="number" value={draft.wind_mph ?? ''} onChange={e => setDraft({ ...draft, wind_mph: Number(e.target.value) })} /></label>
          </div>
          <div style={{ marginTop: 12 }}>
            <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 4 }}>Manpower (trade | count | hours | contractor)</div>
            {(draft.manpower as ManpowerRow[]).map((m, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
                <input placeholder="trade" value={m.trade} onChange={e => { const mp = [...draft.manpower]; mp[i] = { ...mp[i], trade: e.target.value }; setDraft({ ...draft, manpower: mp }) }} />
                <input type="number" placeholder="count" value={m.count} onChange={e => { const mp = [...draft.manpower]; mp[i] = { ...mp[i], count: +e.target.value }; setDraft({ ...draft, manpower: mp }) }} />
                <input type="number" placeholder="hrs" value={m.hours} onChange={e => { const mp = [...draft.manpower]; mp[i] = { ...mp[i], hours: +e.target.value }; setDraft({ ...draft, manpower: mp }) }} />
                <input placeholder="contractor" value={m.contractor ?? ''} onChange={e => { const mp = [...draft.manpower]; mp[i] = { ...mp[i], contractor: e.target.value }; setDraft({ ...draft, manpower: mp }) }} />
                <button onClick={() => setDraft({ ...draft, manpower: draft.manpower.filter((_: any, j: number) => j !== i) })}>×</button>
              </div>
            ))}
            <button onClick={() => setDraft({ ...draft, manpower: [...draft.manpower, { trade: '', count: 0, hours: 0 }] })}>+ Add Trade</button>
          </div>
          <textarea placeholder="Work performed" value={draft.work_performed} onChange={e => setDraft({ ...draft, work_performed: e.target.value })} style={{ width: '100%', marginTop: 12, minHeight: 70 }} />
          <textarea placeholder="Delays" value={draft.delays} onChange={e => setDraft({ ...draft, delays: e.target.value })} style={{ width: '100%', marginTop: 8, minHeight: 50 }} />
          <textarea placeholder="Safety notes" value={draft.safety_notes} onChange={e => setDraft({ ...draft, safety_notes: e.target.value })} style={{ width: '100%', marginTop: 8, minHeight: 50 }} />
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <button onClick={create} style={{ background: 'var(--jarvis-ac)', color: '#fff', padding: '6px 16px', border: 'none', borderRadius: 4 }}>Save</button>
            <button onClick={() => setCreating(false)}>Cancel</button>
          </div>
        </div>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: 'var(--jarvis-bg2)', textAlign: 'left' }}>
            <th style={{ padding: 8 }}>Date</th><th>Weather</th><th>Manpower</th>
            <th>Work Performed</th><th>Delays</th><th>Status</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {loading && <tr><td colSpan={7} style={{ padding: 20, textAlign: 'center' }}>Loading…</td></tr>}
          {!loading && !logs.length && <tr><td colSpan={7} style={{ padding: 20, textAlign: 'center', color: 'var(--jarvis-ts)' }}>No logs yet</td></tr>}
          {logs.map(l => {
            const mpSum = (l.manpower ?? []).reduce((s, m: any) => s + (+m.count || 0), 0)
            return (
              <tr key={l.id} style={{ borderBottom: '1px solid var(--jarvis-bd)', cursor: 'pointer' }} onClick={() => setSelected(l)}>
                <td style={{ padding: 8 }}>{l.log_date}</td>
                <td>{l.weather} {l.temp_f ? `· ${l.temp_f}°F` : ''}</td>
                <td>{mpSum} workers</td>
                <td style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.work_performed}</td>
                <td style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.delays}</td>
                <td><span style={{ padding: '2px 8px', background: badge(l.status), color: '#fff', borderRadius: 10, fontSize: 11 }}>{l.status}</span></td>
                <td onClick={e => e.stopPropagation()}>
                  {canWrite && l.status === 'draft' && <button onClick={() => transition(l.id, 'submit')}>Submit</button>}
                  {canWrite && l.status === 'submitted' && <button onClick={() => transition(l.id, 'approve')}>Approve</button>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {selected && (
        <div onClick={() => setSelected(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--jarvis-bg)', padding: 20, borderRadius: 8, maxWidth: 700, width: '90%', maxHeight: '80vh', overflow: 'auto' }}>
            <h3 style={{ marginTop: 0 }}>Log · {selected.log_date}</h3>
            <div><b>Weather:</b> {selected.weather} {selected.temp_f && `${selected.temp_f}°F`}</div>
            <div style={{ marginTop: 8 }}><b>Work performed:</b><br />{selected.work_performed}</div>
            <div style={{ marginTop: 8 }}><b>Delays:</b> {selected.delays || '—'}</div>
            <div style={{ marginTop: 8 }}><b>Safety:</b> {selected.safety_notes || '—'}</div>
            <pre style={{ fontSize: 11, background: 'var(--jarvis-bg2)', padding: 8, marginTop: 10, maxHeight: 200, overflow: 'auto' }}>{JSON.stringify({ manpower: selected.manpower, equipment: selected.equipment, incidents: selected.incidents }, null, 2)}</pre>
            <button onClick={() => setSelected(null)} style={{ marginTop: 10 }}>Close</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default DailyLogsView
