/**
 * JARVIS EPC — SnView  ·  Safety Notes
 */
import React, { useState, useMemo } from 'react'
import { useBizStore } from '../modules/biz/store'
import { createDispatch, type PolicyConfig } from '../modules/biz/dispatch'
import { JARVIS_ACTIONS } from '../modules/biz/reducer'

export interface SnViewProps { policy?: Partial<PolicyConfig>; onToast?: (msg: string, type: string) => void }
const DEF: PolicyConfig = { writesEnabled: false, chatEnabled: false, exportsEnabled: false, activeRole: 'viewer' }

export function SnView({ policy: pProp, onToast }: SnViewProps) {
  const policy = { ...DEF, ...pProp }
  const talks  = useBizStore(s => s.biz.toolbox_talks ?? []) as Record<string,unknown>[]
  const canWrite = policy.writesEnabled && policy.activeRole !== 'viewer'
  const [search, setSearch]   = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm]       = useState<Record<string,string>>({})
  const { dispatch } = useMemo(() => createDispatch({ policy, toast: onToast ? (m,t) => onToast(m,t) : undefined }), [policy])

  const filtered = talks.filter(t => !search || String(t['topic'] ?? t['description'] ?? '').toLowerCase().includes(search.toLowerCase()))

  function submit() {
    if (!form.topic) return
    dispatch({ type: JARVIS_ACTIONS.ADD_TOOLBOX, data: { id: `TBT-${Date.now()}`, ...form, attendees: Number(form.attendees ?? 0), date: new Date().toISOString().slice(0,10) } })
    setForm({}); setShowAdd(false); onToast?.('Safety note added', 'success')
  }

  return (
    <div role="main" aria-label="Safety Notes">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 className="jarvis-heading" style={{ margin: 0 }}>Safety Notes & Toolbox Talks</h3>
        {canWrite && <button className="jarvis-btn jarvis-btn-primary" onClick={() => setShowAdd(v => !v)}>+ Add Note</button>}
      </div>
      {showAdd && (
        <div className="jarvis-card" style={{ padding: 16, marginBottom: 16 }}>
          <h4 className="jarvis-label" style={{ marginBottom: 10 }}>New Safety Note</h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 12 }}>
            {[['topic','Topic'],['presenter','Presenter'],['attendees','Attendees']].map(([k,l]) => (
              <div key={k}><label className="jarvis-small" htmlFor={`sn-${k}`}>{l}</label>
                <input id={`sn-${k}`} className="jarvis-input" value={form[k] ?? ''} onChange={e => setForm(f => ({...f,[k]:e.target.value}))} /></div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="jarvis-btn jarvis-btn-primary" onClick={submit}>Save</button>
            <button className="jarvis-btn jarvis-btn-ghost" onClick={() => setShowAdd(false)}>Cancel</button>
          </div>
        </div>
      )}
      <div style={{ marginBottom: 10 }}>
        <input className="jarvis-input" type="search" placeholder="Search safety notes…" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search safety notes" />
      </div>
      {filtered.length === 0 ? (
        <div className="jarvis-empty"><span className="jarvis-empty-icon">🦺</span><span>{search ? 'No notes match' : 'No safety notes recorded'}</span></div>
      ) : (
        <div className="jarvis-scroll-y jarvis-max-h-lg">
          {filtered.map((t, idx) => (
            <div key={String(t['id'] ?? idx)} className="jarvis-card" style={{ padding: '12px 16px', marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span className="jarvis-body" style={{ fontWeight: 600 }}>{String(t['topic'] ?? t['id'])}</span>
                <span className="jarvis-muted" style={{ fontSize: 10 }}>{String(t['date'] ?? '—')}</span>
              </div>
              <div className="jarvis-small" style={{ color: 'var(--jarvis-ts)' }}>Presenter: {String(t['presenter'] ?? '—')} · Attendees: {String(t['attendees'] ?? '—')}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
export default SnView
