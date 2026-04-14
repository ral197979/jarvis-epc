/**
 * JARVIS EPC — KtView  ·  Knowledge Base (lessons learned)
 */
import React, { useState } from 'react'
import { useBizStore, selectLessons, selectCloseouts } from '../modules/biz/store'
import { KpiCard }     from './KpiCard'
import type { PolicyConfig } from '../modules/biz/dispatch'

type Tab = 'lessons' | 'closeouts'
export interface KtViewProps { policy?: Partial<PolicyConfig>; biz?: Record<string,unknown> }

export function KtView({ policy: _p, biz: _b }: KtViewProps) {
  const lessons   = useBizStore(selectLessons)
  const closeouts = useBizStore(selectCloseouts)
  const [tab, setTab] = useState<Tab>('lessons')
  const [search, setSearch] = useState('')

  const items = tab === 'lessons' ? lessons : closeouts
  const filtered = items.filter(i => !search || Object.values(i).some(v => String(v ?? '').toLowerCase().includes(search.toLowerCase())))

  return (
    <div role="main" aria-label="Knowledge Base">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 8, marginBottom: 16 }}>
        <KpiCard label="Lessons Learnt" value={lessons.length}   color="var(--jarvis-blue)" />
        <KpiCard label="Closeouts"      value={closeouts.length} color="var(--jarvis-grn)" />
      </div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 14, borderBottom: '1px solid var(--jarvis-bd)' }}>
        {(['lessons','closeouts'] as Tab[]).map(t => <button key={t} onClick={() => setTab(t)} style={{ padding: '8px 16px 10px', background: 'transparent', border: 'none', borderBottom: tab === t ? '2px solid var(--jarvis-ac)' : '2px solid transparent', color: tab === t ? 'var(--jarvis-tx)' : 'var(--jarvis-ts)', fontWeight: tab === t ? 700 : 500, fontSize: 12, cursor: 'pointer', textTransform: 'capitalize' }}>{t}</button>)}
      </div>
      <div style={{ marginBottom: 10 }}>
        <input className="jarvis-input" type="search" placeholder={`Search ${tab}…`} value={search} onChange={e => setSearch(e.target.value)} aria-label={`Search ${tab}`} />
      </div>
      {filtered.length === 0 ? (
        <div className="jarvis-empty"><span className="jarvis-empty-icon">🧠</span><span>{search ? 'No items match' : `No ${tab} recorded yet`}</span></div>
      ) : (
        <div className="jarvis-scroll-y jarvis-max-h-lg">
          {filtered.map((item, i) => (
            <div key={String(item['id'] ?? i)} className="jarvis-card" style={{ padding: '12px 16px', marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span className="jarvis-body" style={{ fontWeight: 600 }}>{String(item['lesson'] ?? item['title'] ?? item['description'] ?? item['id'])}</span>
                <span className="jarvis-muted" style={{ fontSize: 10 }}>{String(item['date'] ?? item['project'] ?? '—')}</span>
              </div>
              {!!item['notes'] && <p className="jarvis-body" style={{ margin: 0, color: 'var(--jarvis-ts)' }}>{String(item['notes'])}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
export default KtView
