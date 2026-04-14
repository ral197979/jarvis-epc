/**
 * JARVIS EPC — DtView  ·  Document Tracking (CDE state pipeline)
 */
import React, { useState } from 'react'
import { useBizStore, selectDocuments } from '../modules/biz/store'
import { KpiCard }     from './KpiCard'
import { StatusBadge } from './StatusBadge'
import type { PolicyConfig } from '../modules/biz/dispatch'

const CDE_STAGES = ['draft','in-review','approved','issued','superseded']
export interface DtViewProps { policy?: Partial<PolicyConfig> }

export function DtView({ policy: _p }: DtViewProps) {
  const docs = useBizStore(selectDocuments)
  const [search, setSearch] = useState('')
  const [stageFilter, setStageFilter] = useState<string>('all')

  const filtered = docs.filter(d => {
    const stage = String(d['cde'] ?? d['status'] ?? 'draft')
    if (stageFilter !== 'all' && stage !== stageFilter) return false
    return !search || Object.values(d).some(v => String(v ?? '').toLowerCase().includes(search.toLowerCase()))
  })

  const stageCounts = CDE_STAGES.reduce((acc, s) => { acc[s] = docs.filter(d => (d['cde'] ?? d['status'] ?? 'draft') === s).length; return acc }, {} as Record<string,number>)

  return (
    <div role="main" aria-label="Document Tracking">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 8, marginBottom: 16 }}>
        {CDE_STAGES.map(s => (
          <KpiCard key={s} label={s.charAt(0).toUpperCase()+s.slice(1)} value={stageCounts[s] ?? 0}
            color={s === 'issued' ? 'var(--jarvis-grn)' : s === 'approved' ? 'var(--jarvis-blue)' : s === 'draft' ? 'var(--jarvis-td)' : 'var(--jarvis-amb)'} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {(['all', ...CDE_STAGES]).map(s => (
          <button key={s} onClick={() => setStageFilter(s)} className={`jarvis-btn ${stageFilter === s ? 'jarvis-btn-primary' : 'jarvis-btn-ghost'}`} style={{ fontSize: 11, padding: '4px 10px', textTransform: 'capitalize' }}>{s}</button>
        ))}
      </div>
      <div style={{ marginBottom: 10 }}>
        <input className="jarvis-input" type="search" placeholder="Search documents…" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search" />
      </div>
      {filtered.length === 0 ? (
        <div className="jarvis-empty"><span className="jarvis-empty-icon">📄</span><span>{search ? 'No documents match' : 'No documents in this stage'}</span></div>
      ) : (
        <div className="jarvis-scroll-y jarvis-max-h-lg">
          <table className="jarvis-table" aria-label="Document tracking">
            <thead><tr><th>Doc Number</th><th>Title</th><th>Discipline</th><th>Rev</th><th>Author</th><th>CDE State</th></tr></thead>
            <tbody>{filtered.map((d, i) => (
              <tr key={String(d['id'] ?? i)}>
                <td style={{ fontFamily: 'var(--jarvis-font-mono)', fontSize: 11 }}>{String(d['id'] ?? '—')}</td>
                <td style={{ fontWeight: 600 }}>{String(d['title'] ?? '—')}</td>
                <td>{String(d['disc'] ?? d['discipline'] ?? '—')}</td>
                <td style={{ fontFamily: 'var(--jarvis-font-mono)' }}>{String(d['rev'] ?? d['revision'] ?? '0')}</td>
                <td>{String(d['author'] ?? '—')}</td>
                <td><StatusBadge status={String(d['cde'] ?? d['status'] ?? 'draft')} /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}
export default DtView
