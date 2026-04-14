/**
 * JARVIS EPC — LiView  ·  Labour Items
 */
import React, { useState, useMemo } from 'react'
import { useBizStore } from '../modules/biz/store'
import { createDispatch, type PolicyConfig } from '../modules/biz/dispatch'
import { JARVIS_ACTIONS } from '../modules/biz/reducer'
import { KpiCard } from './KpiCard'

export interface LiViewProps { policy?: Partial<PolicyConfig>; onToast?: (msg: string, type: string) => void }
const DEF: PolicyConfig = { writesEnabled: false, chatEnabled: false, exportsEnabled: false, activeRole: 'viewer' }

export function LiView({ policy: pProp, onToast }: LiViewProps) {
  const policy   = { ...DEF, ...pProp }
  const manpower = useBizStore(s => s.biz.manpower ?? [])
  const canWrite = policy.writesEnabled && policy.activeRole !== 'viewer'
  const [search, setSearch]   = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm]       = useState<Record<string,string>>({})
  const { dispatch } = useMemo(() => createDispatch({ policy, toast: onToast ? (m,t) => onToast(m,t) : undefined }), [policy])

  const filtered = manpower.filter(m => !search || Object.values(m).some(v => String(v ?? '').toLowerCase().includes(search.toLowerCase())))
  const totalMH  = manpower.reduce((s, m) => s + Number(m['hours'] ?? m['man_hours'] ?? 0), 0)
  const totalWorkers = manpower.reduce((s, m) => s + Number(m['count'] ?? m['headcount'] ?? 1), 0)

  function submit() {
    if (!form.role) return
    dispatch({ type: JARVIS_ACTIONS.ADD_MANPOWER, data: { id: `LAB-${Date.now()}`, ...form, hours: Number(form.hours ?? 0), count: Number(form.count ?? 1), date: new Date().toISOString().slice(0,10) } })
    setForm({}); setShowAdd(false); onToast?.('Labour record added', 'success')
  }

  return (
    <div role="main" aria-label="Labour Items">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 8, marginBottom: 16 }}>
        <KpiCard label="Labour Records" value={manpower.length} />
        <KpiCard label="Total Workers"  value={totalWorkers} color="var(--jarvis-blue)" />
        <KpiCard label="Total Man-Hrs"  value={totalMH.toLocaleString()} color="var(--jarvis-pur)" />
      </div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 12, alignItems: 'center' }}>
        <input className="jarvis-input" style={{ flex: 1 }} type="search" placeholder="Search labour…" value={search} onChange={e => setSearch(e.target.value)} />
        {canWrite && <button className="jarvis-btn jarvis-btn-primary" onClick={() => setShowAdd(v => !v)}>+ Add Labour</button>}
      </div>
      {showAdd && (
        <div className="jarvis-card" style={{ padding: 16, marginBottom: 16 }}>
          <h4 className="jarvis-label" style={{ marginBottom: 10 }}>Add Labour Record</h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 12 }}>
            {[['role','Role / Trade'],['project','Project'],['count','Head Count'],['hours','Man-Hours']].map(([k,l]) => (
              <div key={k}><label className="jarvis-small" htmlFor={`li-${k}`}>{l}</label>
                <input id={`li-${k}`} className="jarvis-input" value={form[k] ?? ''} onChange={e => setForm(f => ({...f,[k]:e.target.value}))} /></div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="jarvis-btn jarvis-btn-primary" onClick={submit}>Save</button>
            <button className="jarvis-btn jarvis-btn-ghost" onClick={() => setShowAdd(false)}>Cancel</button>
          </div>
        </div>
      )}
      {filtered.length === 0 ? (
        <div className="jarvis-empty"><span className="jarvis-empty-icon">👷</span><span>{search ? 'No records match' : 'No labour records'}</span></div>
      ) : (
        <div className="jarvis-scroll-y jarvis-max-h-lg">
          <table className="jarvis-table" aria-label="Labour items">
            <thead><tr><th>ID</th><th>Role / Trade</th><th>Project</th><th>Workers</th><th>Man-Hrs</th><th>Date</th></tr></thead>
            <tbody>{filtered.map((m, i) => (
              <tr key={String(m['id'] ?? i)}>
                <td style={{ fontFamily: 'var(--jarvis-font-mono)', fontSize: 11 }}>{String(m['id'] ?? '—')}</td>
                <td style={{ fontWeight: 600 }}>{String(m['role'] ?? m['trade'] ?? m['title'] ?? '—')}</td>
                <td>{String(m['project'] ?? '—')}</td>
                <td style={{ fontFamily: 'var(--jarvis-font-mono)' }}>{String(m['count'] ?? m['headcount'] ?? '—')}</td>
                <td style={{ fontFamily: 'var(--jarvis-font-mono)' }}>{String(m['hours'] ?? m['man_hours'] ?? '—')}</td>
                <td>{String(m['date'] ?? '—')}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}
export default LiView
