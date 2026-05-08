/**
 * Denver Engineering — BiView  ·  Bid Items
 */
import React, { useState, useMemo } from 'react'
import { useBizStore } from '../modules/biz/store'
import { createDispatch, type PolicyConfig } from '../modules/biz/dispatch'
import { JARVIS_ACTIONS } from '../modules/biz/reducer'
import { StatusBadge } from './StatusBadge'
import { KpiCard }     from './KpiCard'

export interface BiViewProps { policy?: Partial<PolicyConfig>; onToast?: (msg: string, type: string) => void; onAudit?: (e: unknown) => void }
const DEF: PolicyConfig = { writesEnabled: false, chatEnabled: false, exportsEnabled: false, activeRole: 'viewer' }
function fmt(n: number) { if (n >= 1_000_000) return `$${(n/1_000_000).toFixed(1)}M`; if (n >= 1_000) return `$${(n/1_000).toFixed(0)}K`; return `$${n.toFixed(0)}` }

export function BiView({ policy: pProp, onToast, onAudit }: BiViewProps) {
  const policy   = { ...DEF, ...pProp }
  const rfqs     = useBizStore(s => s.biz.rfqs ?? [])
  const pos      = useBizStore(s => s.biz.purchase_orders ?? [])
  const canWrite = policy.writesEnabled && policy.activeRole !== 'viewer'
  const [search, setSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState<Record<string,string>>({})
  const { dispatch } = useMemo(() => createDispatch({ policy, audit: onAudit ? e => onAudit(e) : undefined, toast: onToast ? (m,t) => onToast(m,t) : undefined }), [policy])

  const bids     = rfqs
  const filtered = bids.filter(b => !search || Object.values(b).some(v => String(v ?? '').toLowerCase().includes(search.toLowerCase())))
  const received = bids.filter(b => b['status'] === 'received' || b['status'] === 'evaluated').length
  const awarded  = bids.filter(b => b['status'] === 'awarded' || b['status'] === 'accepted').length
  const totalValue = bids.reduce((s, b) => s + Number(b['value'] ?? b['amount'] ?? 0), 0)

  function submit() {
    if (!form.description) return
    dispatch({ type: JARVIS_ACTIONS.ADD_RFQ, data: { id: `BID-${Date.now()}`, ...form, status: 'open', date: new Date().toISOString().slice(0,10) } })
    setForm({}); setShowAdd(false); onToast?.('Bid item added', 'success')
  }

  return (
    <div role="main" aria-label="Bid Items">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 8, marginBottom: 16 }}>
        <KpiCard label="Total Bids"   value={bids.length} />
        <KpiCard label="Received"     value={received}    color="var(--jarvis-blue)" />
        <KpiCard label="Awarded"      value={awarded}     color="var(--jarvis-grn)" />
        <KpiCard label="Total Value"  value={fmt(totalValue)} color="var(--jarvis-amb)" />
        <KpiCard label="Active POs"   value={pos.filter(p => p['status'] === 'active' || p['status'] === 'open').length} color="var(--jarvis-pur)" />
      </div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 12, alignItems: 'center' }}>
        <input className="jarvis-input" style={{ flex: 1 }} type="search" placeholder="Search bid items…" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search bids" />
        {canWrite && <button className="jarvis-btn jarvis-btn-primary" onClick={() => setShowAdd(v => !v)}>+ New Bid</button>}
      </div>
      {showAdd && (
        <div className="jarvis-card" style={{ padding: 16, marginBottom: 16 }}>
          <h4 className="jarvis-label" style={{ marginBottom: 10 }}>New Bid Item</h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 12 }}>
            {[['description','Description'],['vendor','Vendor'],['value','Bid Value ($)']].map(([k,l]) => (
              <div key={k}><label className="jarvis-small" htmlFor={`bi-${k}`}>{l}</label>
                <input id={`bi-${k}`} className="jarvis-input" value={form[k] ?? ''} onChange={e => setForm(f => ({...f,[k]:e.target.value}))} /></div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="jarvis-btn jarvis-btn-primary" onClick={submit}>Save</button>
            <button className="jarvis-btn jarvis-btn-ghost" onClick={() => setShowAdd(false)}>Cancel</button>
          </div>
        </div>
      )}
      {filtered.length === 0 ? (
        <div className="jarvis-empty"><span className="jarvis-empty-icon">📋</span><span>{search ? 'No bids match' : 'No bid items recorded'}</span></div>
      ) : (
        <div className="jarvis-scroll-y jarvis-max-h-lg">
          <table className="jarvis-table" aria-label="Bid items">
            <thead><tr><th>ID</th><th>Description</th><th>Vendor</th><th>Value</th><th>Due Date</th><th>Status</th></tr></thead>
            <tbody>{filtered.map((b, i) => (
              <tr key={String(b['id'] ?? i)}>
                <td style={{ fontFamily: 'var(--jarvis-font-mono)', fontSize: 11 }}>{String(b['id'] ?? '—')}</td>
                <td style={{ fontWeight: 600 }}>{String(b['description'] ?? b['title'] ?? b['subject'] ?? '—')}</td>
                <td>{String(b['vendor'] ?? b['supplier'] ?? '—')}</td>
                <td style={{ fontFamily: 'var(--jarvis-font-mono)' }}>{Number(b['value'] ?? b['amount'] ?? 0) > 0 ? fmt(Number(b['value'] ?? b['amount'])) : '—'}</td>
                <td>{String(b['due'] ?? b['date'] ?? '—')}</td>
                <td><StatusBadge status={String(b['status'] ?? 'open')} /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}
export default BiView
