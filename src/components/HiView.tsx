/**
 * JARVIS EPC — HiView  ·  HSE Items (incidents, near-misses, observations)
 */
import React, { useState } from 'react'
import { useBizStore, selectIncidents } from '../modules/biz/store'
import { StatusBadge } from './StatusBadge'
import { KpiCard }     from './KpiCard'
import type { PolicyConfig } from '../modules/biz/dispatch'

type FilterType = 'all' | 'incident' | 'near-miss' | 'observation'
export interface HiViewProps { policy?: Partial<PolicyConfig> }

export function HiView({ policy: _p }: HiViewProps) {
  const incidents = useBizStore(selectIncidents) as Record<string,unknown>[]
  const [filter, setFilter] = useState<FilterType>('all')
  const [search, setSearch] = useState('')

  const filtered = incidents.filter(i => {
    if (filter !== 'all' && (i['type'] ?? 'incident') !== filter) return false
    return !search || Object.values(i).some(v => String(v ?? '').toLowerCase().includes(search.toLowerCase()))
  })

  const types: Record<FilterType, number> = {
    all:         incidents.length,
    'incident':  incidents.filter(i => i['type'] === 'incident' || !i['type']).length,
    'near-miss': incidents.filter(i => i['type'] === 'near-miss').length,
    'observation': incidents.filter(i => i['type'] === 'observation').length,
  }

  const open       = incidents.filter(i => i['status'] !== 'closed').length
  const recordable = incidents.filter(i => i['recordable']).length

  return (
    <div role="main" aria-label="HSE Items">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 8, marginBottom: 16 }}>
        <KpiCard label="Total HSE Items" value={incidents.length} />
        <KpiCard label="Open"            value={open}       color={open > 0 ? 'var(--jarvis-red)' : 'var(--jarvis-grn)'} />
        <KpiCard label="Recordable"      value={recordable} color={recordable > 0 ? 'var(--jarvis-red)' : 'var(--jarvis-grn)'} />
        <KpiCard label="Near Misses"     value={types['near-miss']} color="var(--jarvis-amb)" />
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {(['all','incident','near-miss','observation'] as FilterType[]).map(f => (
          <button key={f} onClick={() => setFilter(f)} className={`jarvis-btn ${filter === f ? 'jarvis-btn-primary' : 'jarvis-btn-ghost'}`} style={{ fontSize: 11, padding: '4px 10px', textTransform: 'capitalize' }}>{f} ({types[f]})</button>
        ))}
      </div>
      <div style={{ marginBottom: 10 }}>
        <input className="jarvis-input" type="search" placeholder="Search HSE items…" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search HSE items" />
      </div>
      {filtered.length === 0 ? (
        <div className="jarvis-empty"><span className="jarvis-empty-icon">🦺</span><span>{search ? 'No items match' : 'No HSE items'}</span></div>
      ) : (
        <div className="jarvis-scroll-y jarvis-max-h-lg">
          <table className="jarvis-table" aria-label="HSE items">
            <thead><tr><th>ID</th><th>Description</th><th>Type</th><th>Date</th><th>Location</th><th>Severity</th><th>Status</th></tr></thead>
            <tbody>{filtered.map((i, idx) => (
              <tr key={String(i['id'] ?? idx)}>
                <td style={{ fontFamily: 'var(--jarvis-font-mono)', fontSize: 11 }}>{String(i['id'] ?? '—')}</td>
                <td style={{ fontWeight: 600 }}>{String(i['title'] ?? i['description'] ?? '—')}</td>
                <td style={{ textTransform: 'capitalize' }}>{String(i['type'] ?? 'incident')}</td>
                <td>{String(i['date'] ?? '—')}</td>
                <td>{String(i['location'] ?? '—')}</td>
                <td><span style={{ fontWeight: 700, color: i['severity'] === 'high' ? 'var(--jarvis-red)' : i['severity'] === 'medium' ? 'var(--jarvis-amb)' : 'var(--jarvis-grn)', fontSize: 11 }}>{String(i['severity'] ?? '—')}</span></td>
                <td><StatusBadge status={String(i['status'] ?? 'reported')} /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}
export default HiView
