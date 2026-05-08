/**
 * Denver Engineering — EtView  ·  Equipment Tracking
 */
import React, { useState } from 'react'
import { useBizStore } from '../modules/biz/store'
import { StatusBadge } from './StatusBadge'
import { KpiCard }     from './KpiCard'
import type { PolicyConfig } from '../modules/biz/dispatch'

export interface EtViewProps { policy?: Partial<PolicyConfig> }

export function EtView({ policy: _p }: EtViewProps) {
  const installation = useBizStore(s => s.biz.installation ?? [])
  const [search, setSearch] = useState('')
  const equipment = installation.filter(i => i['type'] === 'equipment' || i['category'] === 'equipment' || i['equipment'])
  const allItems  = equipment.length > 0 ? equipment : installation
  const filtered  = allItems.filter(i => !search || Object.values(i).some(v => String(v ?? '').toLowerCase().includes(search.toLowerCase())))
  const installed = allItems.filter(i => ['installed','complete'].includes(String(i['status'] ?? ''))).length

  return (
    <div role="main" aria-label="Equipment Tracking">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 8, marginBottom: 16 }}>
        <KpiCard label="Total Items"  value={allItems.length} />
        <KpiCard label="Installed"    value={installed} color="var(--jarvis-grn)" />
        <KpiCard label="Pending"      value={allItems.length - installed} color="var(--jarvis-amb)" />
      </div>
      <div style={{ marginBottom: 10 }}>
        <input className="jarvis-input" type="search" placeholder="Search equipment…" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search equipment" />
      </div>
      {filtered.length === 0 ? (
        <div className="jarvis-empty"><span className="jarvis-empty-icon">🏗️</span><span>No equipment records</span></div>
      ) : (
        <div className="jarvis-scroll-y jarvis-max-h-lg">
          <table className="jarvis-table" aria-label="Equipment tracking">
            <thead><tr><th>Tag / ID</th><th>Equipment / Description</th><th>Location</th><th>Type</th><th>Install Date</th><th>Status</th></tr></thead>
            <tbody>{filtered.map((r, i) => (
              <tr key={String(r['id'] ?? i)}>
                <td style={{ fontFamily: 'var(--jarvis-font-mono)', fontSize: 11 }}>{String(r['id'] ?? '—')}</td>
                <td style={{ fontWeight: 600 }}>{String(r['equipment'] ?? r['description'] ?? r['title'] ?? '—')}</td>
                <td>{String(r['location'] ?? r['area'] ?? '—')}</td>
                <td>{String(r['type'] ?? r['category'] ?? '—')}</td>
                <td>{String(r['date'] ?? r['install_date'] ?? '—')}</td>
                <td><StatusBadge status={String(r['status'] ?? 'pending')} /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}
export default EtView
