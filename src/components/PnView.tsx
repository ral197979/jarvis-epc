/**
 * JARVIS EPC — PnView  ·  Procurement Notes
 */
import React, { useState, useMemo } from 'react'
import { useBizStore } from '../modules/biz/store'
import { createDispatch, type PolicyConfig } from '../modules/biz/dispatch'
import { JARVIS_ACTIONS } from '../modules/biz/reducer'

export interface PnViewProps { policy?: Partial<PolicyConfig>; onToast?: (msg: string, type: string) => void }
const DEF: PolicyConfig = { writesEnabled: false, chatEnabled: false, exportsEnabled: false, activeRole: 'viewer' }

export function PnView({ policy: pProp, onToast }: PnViewProps) {
  const policy = { ...DEF, ...pProp }
  const rfqs   = useBizStore(s => s.biz.rfqs ?? [])
  const pos    = useBizStore(s => s.biz.purchase_orders ?? [])
  const canWrite = policy.writesEnabled && policy.activeRole !== 'viewer'
  const [search, setSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState<Record<string,string>>({})
  const { dispatch } = useMemo(() => createDispatch({ policy, toast: onToast ? (m,t) => onToast(m,t) : undefined }), [policy])

  const notes = [...rfqs.filter(r => r['notes'] || r['description']), ...pos.filter(p => p['notes'] || p['description'])]
  const filtered = notes.filter(n => !search || String(n['notes'] ?? n['description'] ?? '').toLowerCase().includes(search.toLowerCase()))

  function submit() {
    if (!form.description) return
    dispatch({ type: JARVIS_ACTIONS.ADD_RFQ, data: { id: `PN-${Date.now()}`, ...form, type: 'procurement-note', status: 'draft', date: new Date().toISOString().slice(0,10) } })
    setForm({}); setShowAdd(false); onToast?.('Procurement note added', 'success')
  }

  return (
    <div role="main" aria-label="Procurement Notes">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 className="jarvis-heading" style={{ margin: 0 }}>Procurement Notes</h3>
        {canWrite && <button className="jarvis-btn jarvis-btn-primary" onClick={() => setShowAdd(v => !v)}>+ Add Note</button>}
      </div>
      {showAdd && (
        <div className="jarvis-card" style={{ padding: 16, marginBottom: 16 }}>
          <h4 className="jarvis-label" style={{ marginBottom: 8 }}>New Procurement Note</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10, marginBottom: 12 }}>
            <div><label className="jarvis-small" htmlFor="pn-desc">Description</label><input id="pn-desc" className="jarvis-input" value={form['description'] ?? ''} onChange={e => setForm(f => ({...f,description:e.target.value}))} /></div>
            <div><label className="jarvis-small" htmlFor="pn-ref">Reference (PO/RFQ)</label><input id="pn-ref" className="jarvis-input" value={form['ref'] ?? ''} onChange={e => setForm(f => ({...f,ref:e.target.value}))} /></div>
          </div>
          <textarea className="jarvis-input" rows={3} placeholder="Note details…" style={{ width: '100%', resize: 'vertical', marginBottom: 10 }} value={form['notes'] ?? ''} onChange={e => setForm(f => ({...f,notes:e.target.value}))} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="jarvis-btn jarvis-btn-primary" onClick={submit}>Save</button>
            <button className="jarvis-btn jarvis-btn-ghost" onClick={() => setShowAdd(false)}>Cancel</button>
          </div>
        </div>
      )}
      <div style={{ marginBottom: 10 }}>
        <input className="jarvis-input" type="search" placeholder="Search procurement notes…" value={search} onChange={e => setSearch(e.target.value)} />
      </div>
      {filtered.length === 0 ? (
        <div className="jarvis-empty"><span className="jarvis-empty-icon">📋</span><span>{search ? 'No notes match' : 'No procurement notes yet'}</span></div>
      ) : (
        <div className="jarvis-scroll-y jarvis-max-h-lg">
          {filtered.map((n, idx) => (
            <div key={String(n['id'] ?? idx)} className="jarvis-card" style={{ padding: '12px 16px', marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span className="jarvis-body" style={{ fontWeight: 600 }}>{String(n['description'] ?? n['subject'] ?? n['id'])}</span>
                <span className="jarvis-muted" style={{ fontSize: 10 }}>{String(n['date'] ?? '—')}</span>
              </div>
              {!!n['notes'] && <p className="jarvis-body" style={{ margin: 0, color: 'var(--jarvis-ts)' }}>{String(n['notes'])}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
export default PnView
