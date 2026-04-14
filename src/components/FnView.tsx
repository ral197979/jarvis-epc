/**
 * JARVIS EPC — FnView  ·  Finance Notes (journal entries list with add)
 */
import React, { useState } from 'react'
import { useBizStore } from '../modules/biz/store'
import { createDispatch, type PolicyConfig } from '../modules/biz/dispatch'
import { JARVIS_ACTIONS } from '../modules/biz/reducer'

export interface FnViewProps { policy?: Partial<PolicyConfig>; onAudit?: (e: unknown) => void; onToast?: (msg: string, type: string) => void }
const DEF: PolicyConfig = { writesEnabled: false, chatEnabled: false, exportsEnabled: false, activeRole: 'viewer' }
function fmt(n: number) { return n >= 1000 ? `$${(n/1000).toFixed(0)}K` : `$${n.toFixed(0)}` }

export function FnView({ policy: pProp, onAudit, onToast }: FnViewProps) {
  const policy = { ...DEF, ...pProp }
  const journal = useBizStore(s => s.biz.journal ?? [])
  const canWrite = policy.writesEnabled && policy.activeRole !== 'viewer'
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState<Record<string,string>>({})
  const { dispatch } = React.useMemo(() => createDispatch({ policy, audit: onAudit ? e => onAudit(e) : undefined, toast: onToast ? (m,t) => onToast(m,t) : undefined }), [policy, onAudit, onToast])

  function submit() {
    if (!form.description) return
    dispatch({ type: JARVIS_ACTIONS.ADD_JOURNAL, data: { id: `JRN-${Date.now()}`, ...form, debit: Number(form.debit ?? 0), credit: Number(form.credit ?? 0), date: new Date().toISOString().slice(0, 10) } })
    setForm({}); setShowAdd(false); onToast?.('Note added', 'success')
  }

  return (
    <div role="main" aria-label="Finance Notes">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 className="jarvis-heading" style={{ margin: 0 }}>Finance Notes & Journal</h3>
        {canWrite && <button className="jarvis-btn jarvis-btn-primary" onClick={() => setShowAdd(v => !v)}>+ Add Note</button>}
      </div>

      {showAdd && (
        <div className="jarvis-card" style={{ padding: 16, marginBottom: 16 }}>
          <h4 className="jarvis-label" style={{ marginBottom: 10 }}>New Journal Note</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 10, marginBottom: 12 }}>
            {[['description','Note / Description'],['account','Account Code'],['debit','Debit ($)'],['credit','Credit ($)']].map(([k,l]) => (
              <div key={k}><label className="jarvis-small" htmlFor={`fn-${k}`}>{l}</label>
                <input id={`fn-${k}`} className="jarvis-input" value={form[k] ?? ''} onChange={e => setForm(f => ({...f,[k]:e.target.value}))} /></div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="jarvis-btn jarvis-btn-primary" onClick={submit}>Save</button>
            <button className="jarvis-btn jarvis-btn-ghost" onClick={() => setShowAdd(false)}>Cancel</button>
          </div>
        </div>
      )}

      {journal.length === 0 ? (
        <div className="jarvis-empty"><span className="jarvis-empty-icon">📒</span><span>No journal entries yet</span></div>
      ) : (
        <div className="jarvis-scroll-y jarvis-max-h-lg">
          {journal.map(j => (
            <div key={String(j.id)} className="jarvis-card" style={{ padding: 14, marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <span className="jarvis-body" style={{ fontWeight: 600 }}>{String(j['description'] ?? j.id)}</span>
                  <span className="jarvis-small" style={{ display: 'block', marginTop: 2 }}>{String(j['account'] ?? '—')} · {String(j['date'] ?? '—')}</span>
                </div>
                <div style={{ textAlign: 'right', fontFamily: 'var(--jarvis-font-mono)', fontSize: 12 }}>
                  {Number(j['debit'] ?? 0) > 0  && <div style={{ color: 'var(--jarvis-red)' }}>Dr {fmt(Number(j['debit']))}</div>}
                  {Number(j['credit'] ?? 0) > 0 && <div style={{ color: 'var(--jarvis-grn)' }}>Cr {fmt(Number(j['credit']))}</div>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
export default FnView
