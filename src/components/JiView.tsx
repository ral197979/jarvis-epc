/**
 * Denver Engineering — JiView  ·  Job Items
 */
import React, { useState } from 'react'
import { useBizStore } from '../modules/biz/store'
import { StatusBadge } from './StatusBadge'
import { KpiCard }     from './KpiCard'
import type { PolicyConfig } from '../modules/biz/dispatch'

export interface JiViewProps { policy?: Partial<PolicyConfig> }

export function JiView({ policy: _p }: JiViewProps) {
  const installation = useBizStore(s => s.biz.installation ?? [])
  const [search, setSearch] = useState('')
  const filtered = installation.filter(i => !search || Object.values(i).some(v => String(v ?? '').toLowerCase().includes(search.toLowerCase())))
  const done   = installation.filter(i => ['complete','installed'].includes(String(i['status'] ?? ''))).length
  const active = installation.filter(i => ['active','in-progress'].includes(String(i['status'] ?? ''))).length

  return (
    <div role="main" aria-label="Job Items">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 8, marginBottom: 16 }}>
        <KpiCard label="Total Items"  value={installation.length} />
        <KpiCard label="In Progress"  value={active} color="var(--jarvis-blue)" />
        <KpiCard label="Installed"    value={done}   color="var(--jarvis-grn)" />
        <KpiCard label="Pending"      value={installation.length - done - active} color="var(--jarvis-amb)" />
      </div>
      <div style={{ marginBottom: 10 }}>
        <input className="jarvis-input" type="search" placeholder="Search job items…" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search job items" />
      </div>
      {filtered.length === 0 ? (
        <div className="jarvis-empty"><span className="jarvis-empty-icon">🔩</span><span>{search ? 'No items match' : 'No job items recorded'}</span></div>
      ) : (
        <div className="jarvis-scroll-y jarvis-max-h-lg">
          <table className="jarvis-table" aria-label="Job items">
            <thead><tr><th>ID</th><th>Description</th><th>Location</th><th>Qty</th><th>Unit</th><th>Date</th><th>Status</th></tr></thead>
            <tbody>
              {filtered.map((item, idx) => (
                <tr key={String(item['id'] ?? idx)}>
                  <td style={{ fontFamily: 'var(--jarvis-font-mono)', fontSize: 11 }}>{String(item['id'] ?? '—')}</td>
                  <td style={{ fontWeight: 600 }}>{String(item['description'] ?? item['title'] ?? item['equipment'] ?? '—')}</td>
                  <td>{String(item['location'] ?? item['area'] ?? '—')}</td>
                  <td style={{ fontFamily: 'var(--jarvis-font-mono)' }}>{String(item['qty'] ?? item['quantity'] ?? '—')}</td>
                  <td>{String(item['unit'] ?? '—')}</td>
                  <td>{String(item['date'] ?? '—')}</td>
                  <td><StatusBadge status={String(item['status'] ?? 'pending')} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
export default JiView
