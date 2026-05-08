/**
 * JARVIS EPC — WtView  ·  Work Tracking (Installation & Manpower)
 */
import React, { useState } from 'react'
import { useBizStore } from '../modules/biz/store'
import { StatusBadge } from './StatusBadge'
import { KpiCard }     from './KpiCard'
import type { PolicyConfig } from '../modules/biz/dispatch'

type Tab = 'installation' | 'manpower'
export interface WtViewProps { policy?: Partial<PolicyConfig> }

export function WtView({ policy: _p }: WtViewProps) {
  const installation = useBizStore(s => s.biz.installation ?? [])
  const manpower     = useBizStore(s => s.biz.manpower     ?? [])
  const [tab, setTab]     = useState<Tab>('installation')
  const [search, setSearch] = useState('')

  const instFilt = installation.filter(i => !search || Object.values(i).some(v => String(v ?? '').toLowerCase().includes(search.toLowerCase())))
  const manFilt  = manpower.filter(m => !search || Object.values(m).some(v => String(v ?? '').toLowerCase().includes(search.toLowerCase())))

  const instDone = installation.filter(i => ['complete','installed'].includes(String(i['status'] ?? ''))).length
  const totalMH  = manpower.reduce((s, m) => s + Number(m['hours'] ?? m['man_hours'] ?? 0), 0)

  return (
    <div role="main" aria-label="Work Tracking">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8, marginBottom: 16 }}>
        <KpiCard label="Installation"  value={installation.length} sub={`${instDone} complete`} />
        <KpiCard label="Manpower Recs" value={manpower.length}     color="var(--jarvis-blue)" />
        <KpiCard label="Total Man-Hrs" value={totalMH.toLocaleString()} color="var(--jarvis-pur)" />
      </div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 14, borderBottom: '1px solid var(--jarvis-bd)' }}>
        {(['installation','manpower'] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: '6px 14px 10px', background: 'transparent', border: 'none', borderBottom: tab === t ? '2px solid var(--jarvis-ac)' : '2px solid transparent', color: tab === t ? 'var(--jarvis-tx)' : 'var(--jarvis-ts)', fontWeight: tab === t ? 700 : 500, fontSize: 12, cursor: 'pointer', textTransform: 'capitalize' }}>{t}</button>
        ))}
      </div>
      <div style={{ marginBottom: 10 }}>
        <input className="jarvis-input" type="search" placeholder={`Search ${tab}…`} value={search} onChange={e => setSearch(e.target.value)} aria-label={`Search ${tab}`} />
      </div>
      {tab === 'installation' && (
        instFilt.length === 0 ? <div className="jarvis-empty"><span className="jarvis-empty-icon">🔩</span><span>No installation records</span></div> :
        <div className="jarvis-scroll-y jarvis-max-h-lg">
          <table className="jarvis-table" aria-label="Installation records">
            <thead><tr><th>ID</th><th>Description</th><th>Location</th><th>Qty</th><th>Date</th><th>Status</th></tr></thead>
            <tbody>{instFilt.map((r, i) => (
              <tr key={String(r['id'] ?? i)}>
                <td style={{ fontFamily: 'var(--jarvis-font-mono)', fontSize: 11 }}>{String(r['id'] ?? '—')}</td>
                <td style={{ fontWeight: 600 }}>{String(r['description'] ?? r['equipment'] ?? '—')}</td>
                <td>{String(r['location'] ?? r['area'] ?? '—')}</td>
                <td style={{ fontFamily: 'var(--jarvis-font-mono)' }}>{String(r['qty'] ?? r['quantity'] ?? '—')}</td>
                <td>{String(r['date'] ?? '—')}</td>
                <td><StatusBadge status={String(r['status'] ?? 'pending')} /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {tab === 'manpower' && (
        manFilt.length === 0 ? <div className="jarvis-empty"><span className="jarvis-empty-icon">👷</span><span>No manpower records</span></div> :
        <div className="jarvis-scroll-y jarvis-max-h-lg">
          <table className="jarvis-table" aria-label="Manpower records">
            <thead><tr><th>ID</th><th>Role / Trade</th><th>Project</th><th>Workers</th><th>Man-Hrs</th><th>Date</th></tr></thead>
            <tbody>{manFilt.map((r, i) => (
              <tr key={String(r['id'] ?? i)}>
                <td style={{ fontFamily: 'var(--jarvis-font-mono)', fontSize: 11 }}>{String(r['id'] ?? '—')}</td>
                <td style={{ fontWeight: 600 }}>{String(r['role'] ?? r['trade'] ?? r['title'] ?? '—')}</td>
                <td>{String(r['project'] ?? '—')}</td>
                <td style={{ fontFamily: 'var(--jarvis-font-mono)' }}>{String(r['count'] ?? r['headcount'] ?? '—')}</td>
                <td style={{ fontFamily: 'var(--jarvis-font-mono)' }}>{String(r['hours'] ?? r['man_hours'] ?? '—')}</td>
                <td>{String(r['date'] ?? '—')}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}
export default WtView
