/**
 * JARVIS EPC — QiView  ·  QA Items (punch list / quality checks)
 */
import React, { useState, useMemo } from 'react'
import { useBizStore, selectPunchItems } from '../modules/biz/store'
import { createDispatch, type PolicyConfig } from '../modules/biz/dispatch'
import { JARVIS_ACTIONS } from '../modules/biz/reducer'
import { StatusBadge } from './StatusBadge'
import { KpiCard }     from './KpiCard'

export interface QiViewProps { policy?: Partial<PolicyConfig>; onToast?: (m: string, t: string) => void; onAudit?: (e: unknown) => void }
const DEF: PolicyConfig = { writesEnabled: false, chatEnabled: false, exportsEnabled: false, activeRole: 'viewer' }

export function QiView({ policy: pProp, onToast, onAudit }: QiViewProps) {
  const policy = { ...DEF, ...pProp }
  const punchItems = useBizStore(selectPunchItems)
  const submittals = useBizStore(s => s.biz.submittals ?? [])
  const canWrite = policy.writesEnabled && policy.activeRole !== 'viewer'
  const [search, setSearch]   = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm]       = useState<Record<string,string>>({})
  const { dispatch } = useMemo(() => createDispatch({ policy, audit: onAudit ? e => onAudit(e) : undefined, toast: onToast ? (m,t) => onToast(m,t) : undefined }), [policy])

  const filtered = punchItems.filter(p => !search || Object.values(p).some(v => String(v ?? '').toLowerCase().includes(search.toLowerCase())))
  const open     = punchItems.filter(p => p['status'] !== 'closed' && p['status'] !== 'complete').length
  const critical = punchItems.filter(p => p['priority'] === 'high' || p['priority'] === 'critical').length

  function submit() {
    if (!form.description) return
    dispatch({ type: JARVIS_ACTIONS.ADD_PUNCH, data: { id: `QA-${Date.now()}`, ...form, status: 'open', priority: form.priority ?? 'med', date: new Date().toISOString().slice(0,10) } })
    setForm({}); setShowAdd(false); onToast?.('QA item added', 'success')
  }

  return (
    <div role="main" aria-label="QA Items">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 8, marginBottom: 16 }}>
        <KpiCard label="Total QA Items"  value={punchItems.length} />
        <KpiCard label="Open"            value={open}     color={open > 0 ? 'var(--jarvis-red)' : 'var(--jarvis-grn)'} />
        <KpiCard label="Critical"        value={critical} color={critical > 0 ? 'var(--jarvis-red)' : 'var(--jarvis-grn)'} />
        <KpiCard label="Submittals"      value={submittals.length} color="var(--jarvis-pur)" />
        <KpiCard label="Closed"          value={punchItems.length - open} color="var(--jarvis-grn)" />
      </div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 12, alignItems: 'center' }}>
        <input className="jarvis-input" style={{ flex: 1 }} type="search" placeholder="Search QA items…" value={search} onChange={e => setSearch(e.target.value)} />
        {canWrite && <button className="jarvis-btn jarvis-btn-primary" onClick={() => setShowAdd(v => !v)}>+ Add QA Item</button>}
      </div>
      {showAdd && (
        <div className="jarvis-card" style={{ padding: 16, marginBottom: 16 }}>
          <h4 className="jarvis-label" style={{ marginBottom: 10 }}>New QA Item</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10, marginBottom: 12 }}>
            {[['description','Description'],['location','Location'],['priority','Priority (high/med/low)']].map(([k,l]) => (
              <div key={k}><label className="jarvis-small" htmlFor={`qi-${k}`}>{l}</label>
                <input id={`qi-${k}`} className="jarvis-input" value={form[k] ?? ''} onChange={e => setForm(f => ({...f,[k]:e.target.value}))} /></div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="jarvis-btn jarvis-btn-primary" onClick={submit}>Save</button>
            <button className="jarvis-btn jarvis-btn-ghost" onClick={() => setShowAdd(false)}>Cancel</button>
          </div>
        </div>
      )}
      {filtered.length === 0 ? (
        <div className="jarvis-empty"><span className="jarvis-empty-icon">✅</span><span>{search ? 'No items match' : 'No QA items recorded'}</span></div>
      ) : (
        <div className="jarvis-scroll-y jarvis-max-h-lg">
          <table className="jarvis-table" aria-label="QA items">
            <thead><tr><th>ID</th><th>Description</th><th>Location</th><th>Priority</th><th>Assigned</th><th>Due</th><th>Status</th></tr></thead>
            <tbody>{filtered.map((p, i) => (
              <tr key={String(p['id'] ?? i)}>
                <td style={{ fontFamily: 'var(--jarvis-font-mono)', fontSize: 11 }}>{String(p['id'] ?? '—')}</td>
                <td style={{ fontWeight: 600 }}>{String(p['description'] ?? p['subject'] ?? '—')}</td>
                <td>{String(p['location'] ?? p['area'] ?? '—')}</td>
                <td><span style={{ fontWeight: 700, fontSize: 11, color: p['priority'] === 'high' ? 'var(--jarvis-red)' : p['priority'] === 'med' ? 'var(--jarvis-amb)' : 'var(--jarvis-grn)' }}>{String(p['priority'] ?? '—')}</span></td>
                <td>{String(p['assigned'] ?? '—')}</td>
                <td>{String(p['due'] ?? '—')}</td>
                <td><StatusBadge status={String(p['status'] ?? 'open')} /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}
export default QiView
