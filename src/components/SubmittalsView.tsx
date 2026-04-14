/**
 * JARVIS EPC — SubmittalsView  ·  Submittals Register
 */
import React, { useState } from 'react'
import { useBizStore } from '../modules/biz/store'
import { StatusBadge } from './StatusBadge'
import { KpiCard }     from './KpiCard'
import type { PolicyConfig } from '../modules/biz/dispatch'

export interface SubmittalsViewProps { policy?: Partial<PolicyConfig>; biz?: Record<string,unknown> }

export function SubmittalsView({ policy: _p, biz: _b }: SubmittalsViewProps) {
  const submittals = useBizStore(s => s.biz.submittals ?? [])
  const [search, setSearch] = useState('')
  const filtered = submittals.filter(s => !search || Object.values(s).some(v => String(v ?? '').toLowerCase().includes(search.toLowerCase())))
  const approved = submittals.filter(s => s['status'] === 'approved').length
  const pending  = submittals.filter(s => s['status'] === 'pending' || s['status'] === 'submitted').length

  return (
    <div role="main" aria-label="Submittals">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 8, marginBottom: 16 }}>
        <KpiCard label="Total"    value={submittals.length} />
        <KpiCard label="Approved" value={approved} color="var(--jarvis-grn)" />
        <KpiCard label="Pending"  value={pending}  color="var(--jarvis-amb)" />
        <KpiCard label="Rejected" value={submittals.filter(s => s['status'] === 'rejected').length} color="var(--jarvis-red)" />
      </div>
      <div style={{ marginBottom: 10 }}>
        <input className="jarvis-input" type="search" placeholder="Search submittals…" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search submittals" />
      </div>
      {filtered.length === 0 ? (
        <div className="jarvis-empty"><span className="jarvis-empty-icon">📨</span><span>{search ? 'No submittals match' : 'No submittals recorded'}</span></div>
      ) : (
        <div className="jarvis-scroll-y jarvis-max-h-lg">
          <table className="jarvis-table" aria-label="Submittals">
            <thead><tr><th>ID</th><th>Description</th><th>Vendor</th><th>Type</th><th>Date</th><th>Status</th></tr></thead>
            <tbody>{filtered.map((s, i) => (
              <tr key={String(s['id'] ?? i)}>
                <td style={{ fontFamily: 'var(--jarvis-font-mono)', fontSize: 11 }}>{String(s['id'] ?? '—')}</td>
                <td style={{ fontWeight: 600 }}>{String(s['description'] ?? s['title'] ?? '—')}</td>
                <td>{String(s['vendor'] ?? s['supplier'] ?? '—')}</td>
                <td>{String(s['type'] ?? s['category'] ?? '—')}</td>
                <td>{String(s['date'] ?? '—')}</td>
                <td><StatusBadge status={String(s['status'] ?? 'pending')} /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}
export default SubmittalsView
