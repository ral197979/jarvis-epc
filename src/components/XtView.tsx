/**
 * JARVIS EPC — XtView  ·  External Tracking (feed studies, external references)
 */
import React, { useState } from 'react'
import { useBizStore } from '../modules/biz/store'
import { StatusBadge } from './StatusBadge'
import { KpiCard }     from './KpiCard'
import type { PolicyConfig } from '../modules/biz/dispatch'

export interface XtViewProps { policy?: Partial<PolicyConfig>; biz?: Record<string,unknown> }
export function XtView({ policy: _p, biz: _b }: XtViewProps) {
  const feedStudies = useBizStore(s => s.biz.feed_studies ?? [])
  const rfis        = useBizStore(s => s.biz.rfis         ?? [])
  const [tab, setTab] = useState<'feed'|'rfi'>('feed')
  const [search, setSearch] = useState('')

  const items    = tab === 'feed' ? feedStudies : rfis
  const filtered = items.filter(i => !search || Object.values(i).some(v => String(v ?? '').toLowerCase().includes(search.toLowerCase())))

  return (
    <div role="main" aria-label="External Tracking">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 8, marginBottom: 16 }}>
        <KpiCard label="FEED Studies" value={feedStudies.length} color="var(--jarvis-blue)" />
        <KpiCard label="RFIs"         value={rfis.length}        color="var(--jarvis-pur)" />
        <KpiCard label="Open RFIs"    value={rfis.filter(r => r['status'] !== 'closed').length} color="var(--jarvis-amb)" />
      </div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 12, borderBottom: '1px solid var(--jarvis-bd)' }}>
        {(['feed','rfi'] as const).map(t => <button key={t} onClick={() => setTab(t)} style={{ padding: '6px 16px 10px', background: 'transparent', border: 'none', borderBottom: tab === t ? '2px solid var(--jarvis-ac)' : '2px solid transparent', color: tab === t ? 'var(--jarvis-tx)' : 'var(--jarvis-ts)', fontWeight: tab === t ? 700 : 500, fontSize: 12, cursor: 'pointer' }}>{t.toUpperCase()}</button>)}
      </div>
      <div style={{ marginBottom: 10 }}>
        <input className="jarvis-input" type="search" placeholder={`Search ${tab === 'feed' ? 'FEED studies' : 'RFIs'}…`} value={search} onChange={e => setSearch(e.target.value)} />
      </div>
      {filtered.length === 0 ? (
        <div className="jarvis-empty"><span className="jarvis-empty-icon">🔗</span><span>{search ? 'No items match' : `No ${tab === 'feed' ? 'FEED studies' : 'RFIs'} recorded`}</span></div>
      ) : (
        <div className="jarvis-scroll-y jarvis-max-h-lg">
          <table className="jarvis-table" aria-label={tab === 'feed' ? 'FEED Studies' : 'RFIs'}>
            <thead><tr><th>ID</th><th>Description</th><th>Date</th><th>Status</th></tr></thead>
            <tbody>{filtered.map((r, i) => (
              <tr key={String(r['id'] ?? i)}>
                <td style={{ fontFamily: 'var(--jarvis-font-mono)', fontSize: 11 }}>{String(r['id'] ?? '—')}</td>
                <td style={{ fontWeight: 600 }}>{String(r['description'] ?? r['title'] ?? r['subject'] ?? '—')}</td>
                <td>{String(r['date'] ?? '—')}</td>
                <td><StatusBadge status={String(r['status'] ?? 'open')} /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}
export default XtView
