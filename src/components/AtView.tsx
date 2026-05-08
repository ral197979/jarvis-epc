/**
 * Denver Engineering — AtView  ·  Approvals & Transmittals
 */
import React, { useState } from 'react'
import { useBizStore } from '../modules/biz/store'
import { StatusBadge } from './StatusBadge'
import { KpiCard }     from './KpiCard'
import type { PolicyConfig } from '../modules/biz/dispatch'

export interface AtViewProps { policy?: Partial<PolicyConfig> }

export function AtView({ policy: _p }: AtViewProps) {
  const items = useBizStore(s => (s.biz as Record<string,unknown>)['transmittals'] as Record<string,unknown>[] ?? [])
  const [search, setSearch] = useState('')
  const filtered = items.filter(i => !search || Object.values(i).some(v => String(v ?? '').toLowerCase().includes(search.toLowerCase())))
  const done    = items.filter(i => ['complete','approved','closed'].includes(String(i['status'] ?? ''))).length
  const inprog  = items.filter(i => ['in-progress','active'].includes(String(i['status'] ?? ''))).length

  return (
    <div role="main" aria-label="Approvals & Transmittals">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 8, marginBottom: 16 }}>
        <KpiCard label="Total"       value={items.length} />
        <KpiCard label="In Progress" value={inprog} color="var(--jarvis-blue)" />
        <KpiCard label="Complete"    value={done}   color="var(--jarvis-grn)" />
        <KpiCard label="Pending"     value={items.length - done - inprog} color="var(--jarvis-amb)" />
      </div>
      <div style={{ marginBottom: 10 }}>
        <input className="jarvis-input" type="search" placeholder="Search approvals & transmittals…"
          value={search} onChange={e => setSearch(e.target.value)} aria-label="Search Approvals & Transmittals" />
      </div>
      {filtered.length === 0 ? (
        <div className="jarvis-empty" role="status">
          <span className="jarvis-empty-icon">📨</span>
          <span>{search ? 'No items match' : 'No transmittals recorded'}</span>
        </div>
      ) : (
        <div className="jarvis-scroll-y jarvis-max-h-lg">
          <table className="jarvis-table" aria-label="Approvals & Transmittals">
            <thead><tr><th>ID</th><th>Title / Deliverable</th><th>Discipline</th><th>Rev</th><th>Date</th><th>Status</th></tr></thead>
            <tbody>
              {filtered.map((item, idx) => (
                <tr key={String(item['id'] ?? idx)}>
                  <td style={{ fontFamily: 'var(--jarvis-font-mono)', fontSize: 11 }}>{String(item['id'] ?? '—')}</td>
                  <td style={{ fontWeight: 600 }}>{String(item['title'] ?? item['description'] ?? item['deliverable'] ?? '—')}</td>
                  <td>{String(item['discipline'] ?? item['category'] ?? item['type'] ?? '—')}</td>
                  <td style={{ fontFamily: 'var(--jarvis-font-mono)' }}>{String(item['rev'] ?? item['revision'] ?? '—')}</td>
                  <td>{String(item['date'] ?? item['due'] ?? '—')}</td>
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
export default AtView
