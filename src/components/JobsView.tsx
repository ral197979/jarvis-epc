/**
 * Denver Engineering — JobsView  ·  Jobs Register
 */
import React, { useState, useMemo } from 'react'
import { useBizStore } from '../modules/biz/store'
import { createDispatch, type PolicyConfig } from '../modules/biz/dispatch'
import { JARVIS_ACTIONS } from '../modules/biz/reducer'
import { StatusBadge } from './StatusBadge'
import { KpiCard }     from './KpiCard'

export interface JobsViewProps { policy?: Partial<PolicyConfig>; onToast?: (msg: string, type: string) => void; onAudit?: (e: unknown) => void }
const DEF: PolicyConfig = { writesEnabled: false, chatEnabled: false, exportsEnabled: false, activeRole: 'viewer' }

export function JobsView({ policy: pProp, onToast, onAudit }: JobsViewProps) {
  const policy     = { ...DEF, ...pProp }
  const contracts  = useBizStore(s => s.biz.contracts ?? [])
  const manpower   = useBizStore(s => s.biz.manpower  ?? [])
  const install    = useBizStore(s => s.biz.installation ?? [])
  const canWrite   = policy.writesEnabled && policy.activeRole !== 'viewer'
  const [search, setSearch]   = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm]       = useState<Record<string,string>>({})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const { dispatch } = useMemo(() => createDispatch({ policy, audit: onAudit ? e => onAudit(e) : undefined, toast: onToast ? (m,t) => onToast(m,t) : undefined }), [policy])

  const jobs = contracts
  const active  = jobs.filter(j => ['active','in-progress'].includes(String(j['status'] ?? '')))
  const complete = jobs.filter(j => ['complete','closed'].includes(String(j['status'] ?? '')))
  const filtered = jobs.filter(j => !search || Object.values(j).some(v => String(v ?? '').toLowerCase().includes(search.toLowerCase())))

  function submit() {
    if (!form.project) return
    dispatch({ type: JARVIS_ACTIONS.ADD_CONTRACT, data: { id: `JOB-${Date.now()}`, ...form, status: 'active', date: new Date().toISOString().slice(0,10) } })
    setForm({}); setShowAdd(false); onToast?.('Job created', 'success')
  }

  return (
    <div role="main" aria-label="Jobs">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 8, marginBottom: 16 }}>
        <KpiCard label="Total Jobs"  value={jobs.length}    />
        <KpiCard label="Active"      value={active.length}  color="var(--jarvis-blue)" />
        <KpiCard label="Complete"    value={complete.length} color="var(--jarvis-grn)" />
        <KpiCard label="Manpower"    value={manpower.length} color="var(--jarvis-pur)" />
        <KpiCard label="Install"     value={install.length}  color="var(--jarvis-amb)" />
      </div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 12, alignItems: 'center' }}>
        <input className="jarvis-input" style={{ flex: 1 }} type="search" placeholder="Search jobs…"
          value={search} onChange={e => setSearch(e.target.value)} aria-label="Search jobs" />
        {canWrite && <button className="jarvis-btn jarvis-btn-primary" onClick={() => setShowAdd(v => !v)}>+ New Job</button>}
      </div>
      {showAdd && (
        <div className="jarvis-card" style={{ padding: 16, marginBottom: 16 }}>
          <h4 className="jarvis-label" style={{ marginBottom: 10 }}>New Job</h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 12 }}>
            {[['project','Job Name'],['client','Client'],['type','Type']].map(([k,l]) => (
              <div key={k}><label className="jarvis-small" htmlFor={`job-${k}`}>{l}</label>
                <input id={`job-${k}`} className="jarvis-input" value={form[k] ?? ''} onChange={e => setForm(f => ({...f,[k]:e.target.value}))} /></div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="jarvis-btn jarvis-btn-primary" onClick={submit}>Save</button>
            <button className="jarvis-btn jarvis-btn-ghost" onClick={() => setShowAdd(false)}>Cancel</button>
          </div>
        </div>
      )}
      {filtered.length === 0 ? (
        <div className="jarvis-empty"><span className="jarvis-empty-icon">🏗️</span><span>{search ? 'No jobs match' : 'No jobs yet'}</span></div>
      ) : (
        <div className="jarvis-scroll-y jarvis-max-h-lg">
          <table className="jarvis-table" aria-label="Jobs register">
            <thead><tr><th>Job ID</th><th>Job Name</th><th>Client</th><th>Type</th><th>Start</th><th>End</th><th>Status</th></tr></thead>
            <tbody>
              {filtered.map(j => (
                <tr key={String(j['id'])}>
                  <td style={{ fontFamily: 'var(--jarvis-font-mono)', fontSize: 11 }}>{String(j['id'])}</td>
                  <td style={{ fontWeight: 600 }}>{String(j['project'] ?? '—')}</td>
                  <td>{String(j['client'] ?? '—')}</td>
                  <td>{String(j['type'] ?? '—')}</td>
                  <td>{String(j['start'] ?? '—')}</td>
                  <td>{String(j['end'] ?? '—')}</td>
                  <td><StatusBadge status={String(j['status'] ?? 'active')} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
export default JobsView
