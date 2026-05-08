/**
 * Denver Engineering — RiskView  ·  Risk Register
 */
import React, { useState, useMemo } from 'react'
import { useBizStore } from '../modules/biz/store'
import { createDispatch, type PolicyConfig } from '../modules/biz/dispatch'
import { JARVIS_ACTIONS } from '../modules/biz/reducer'
import { KpiCard }     from './KpiCard'
import { StatusBadge } from './StatusBadge'

export interface RiskViewProps { policy?: Partial<PolicyConfig>; onToast?: (m: string, t: string) => void; onAudit?: (e: unknown) => void }
const DEF: PolicyConfig = { writesEnabled: false, chatEnabled: false, exportsEnabled: false, activeRole: 'viewer' }
type RiskLevel = 'critical' | 'high' | 'medium' | 'low'
const RISK_COLOR: Record<RiskLevel, string> = { critical: 'var(--jarvis-red)', high: 'var(--jarvis-red)', medium: 'var(--jarvis-amb)', low: 'var(--jarvis-grn)' }

export function RiskView({ policy: pProp, onToast, onAudit }: RiskViewProps) {
  const policy    = { ...DEF, ...pProp }
  const incidents = useBizStore(s => s.biz.incidents ?? []) as Record<string,unknown>[]
  const actions   = useBizStore(s => s.biz.action_items ?? []) as Record<string,unknown>[]
  const canWrite  = policy.writesEnabled && policy.activeRole !== 'viewer'
  const [search, setSearch]   = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm]       = useState<Record<string,string>>({})
  const { dispatch } = useMemo(() => createDispatch({ policy, audit: onAudit ? e => onAudit(e) : undefined, toast: onToast ? (m,t) => onToast(m,t) : undefined }), [policy])

  // Derive risks from incidents + high-priority action items
  const risks = useMemo(() => [
    ...incidents.filter(i => i['status'] !== 'closed').map(i => ({
      id: String(i['id']), title: String(i['title'] ?? i['description'] ?? i['id']), level: 'high' as RiskLevel,
      category: 'Safety', status: String(i['status'] ?? 'open'), mitigation: String(i['corrective_action'] ?? 'Under review'), date: String(i['date'] ?? '—'),
    })),
    ...actions.filter(a => a['priority'] === 'high' && a['status'] !== 'closed').map(a => ({
      id: String(a['id']), title: String(a['subject'] ?? a['id']), level: 'medium' as RiskLevel,
      category: 'Operational', status: String(a['status'] ?? 'open'), mitigation: String(a['description'] ?? 'Action in progress'), date: String(a['due'] ?? '—'),
    })),
  ], [incidents, actions])

  const filtered = risks.filter(r => !search || r.title.toLowerCase().includes(search.toLowerCase()) || r.category.toLowerCase().includes(search.toLowerCase()))
  const critical = risks.filter(r => r.level === 'critical' || r.level === 'high').length

  function submit() {
    if (!form.title) return
    dispatch({ type: JARVIS_ACTIONS.ADD_INCIDENT, data: { id: `RSK-${Date.now()}`, title: form.title, type: 'risk', severity: form.level ?? 'medium', description: form.mitigation, status: 'reported', date: new Date().toISOString().slice(0,10) } })
    setForm({}); setShowAdd(false); onToast?.('Risk added to register', 'success')
  }

  return (
    <div role="main" aria-label="Risk Register">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 8, marginBottom: 16 }}>
        <KpiCard label="Total Risks"   value={risks.length} />
        <KpiCard label="Critical/High" value={critical} color={critical > 0 ? 'var(--jarvis-red)' : 'var(--jarvis-grn)'} />
        <KpiCard label="Medium"        value={risks.filter(r => r.level === 'medium').length} color="var(--jarvis-amb)" />
        <KpiCard label="Low"           value={risks.filter(r => r.level === 'low').length}    color="var(--jarvis-grn)" />
      </div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 12, alignItems: 'center' }}>
        <input className="jarvis-input" style={{ flex: 1 }} type="search" placeholder="Search risk register…" value={search} onChange={e => setSearch(e.target.value)} />
        {canWrite && <button className="jarvis-btn jarvis-btn-primary" onClick={() => setShowAdd(v => !v)}>+ Add Risk</button>}
      </div>
      {showAdd && (
        <div className="jarvis-card" style={{ padding: 16, marginBottom: 16 }}>
          <h4 className="jarvis-label" style={{ marginBottom: 10 }}>Register New Risk</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10, marginBottom: 10 }}>
            <div><label className="jarvis-small" htmlFor="rsk-title">Risk Description</label><input id="rsk-title" className="jarvis-input" value={form['title'] ?? ''} onChange={e => setForm(f => ({...f,title:e.target.value}))} /></div>
            <div><label className="jarvis-small" htmlFor="rsk-level">Risk Level</label>
              <select id="rsk-level" className="jarvis-input" value={form['level'] ?? 'medium'} onChange={e => setForm(f => ({...f,level:e.target.value}))}>
                <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option>
              </select></div>
          </div>
          <div style={{ marginBottom: 10 }}>
            <label className="jarvis-small" htmlFor="rsk-mit">Mitigation</label>
            <input id="rsk-mit" className="jarvis-input" value={form['mitigation'] ?? ''} onChange={e => setForm(f => ({...f,mitigation:e.target.value}))} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="jarvis-btn jarvis-btn-primary" onClick={submit}>Save</button>
            <button className="jarvis-btn jarvis-btn-ghost" onClick={() => setShowAdd(false)}>Cancel</button>
          </div>
        </div>
      )}
      {filtered.length === 0 ? (
        <div className="jarvis-empty"><span className="jarvis-empty-icon">✅</span><span>{search ? 'No risks match' : 'No active risks — well done'}</span></div>
      ) : (
        <div className="jarvis-scroll-y jarvis-max-h-lg">
          <table className="jarvis-table" aria-label="Risk register">
            <thead><tr><th>ID</th><th>Risk</th><th>Category</th><th>Level</th><th>Mitigation</th><th>Date</th><th>Status</th></tr></thead>
            <tbody>{filtered.map(r => (
              <tr key={r.id}>
                <td style={{ fontFamily: 'var(--jarvis-font-mono)', fontSize: 11 }}>{r.id}</td>
                <td style={{ fontWeight: 600 }}>{r.title}</td>
                <td>{r.category}</td>
                <td><span style={{ fontWeight: 700, fontSize: 11, color: RISK_COLOR[r.level] }}>{r.level.toUpperCase()}</span></td>
                <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.mitigation}</td>
                <td>{r.date}</td>
                <td><StatusBadge status={r.status} /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}
export default RiskView
