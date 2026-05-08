/**
 * Denver Engineering — CtView  ·  Construction Tracking
 */
import React, { useState } from 'react'
import { useBizStore, selectContracts } from '../modules/biz/store'
import { StatusBadge } from './StatusBadge'
import { KpiCard }     from './KpiCard'
import type { PolicyConfig } from '../modules/biz/dispatch'

export interface CtViewProps { policy?: Partial<PolicyConfig> }

export function CtView({ policy: _p }: CtViewProps) {
  const contracts = useBizStore(selectContracts)
  const [search, setSearch] = useState('')
  const filtered = contracts.filter(c => !search || Object.values(c).some(v => String(v ?? '').toLowerCase().includes(search.toLowerCase())))
  const avgProg  = contracts.length ? Math.round(contracts.reduce((s, c) => s + Number(c['progress'] ?? 0), 0) / contracts.length) : 0

  return (
    <div role="main" aria-label="Construction Tracking">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 8, marginBottom: 16 }}>
        <KpiCard label="Contracts"    value={contracts.length} />
        <KpiCard label="Avg Progress" value={`${avgProg}%`} color={avgProg >= 60 ? 'var(--jarvis-grn)' : 'var(--jarvis-amb)'} />
        <KpiCard label="On Track"     value={contracts.filter(c => Number(c['progress'] ?? 0) >= 50).length} color="var(--jarvis-grn)" />
        <KpiCard label="Behind"       value={contracts.filter(c => Number(c['progress'] ?? 0) < 30 && ['active','in-progress'].includes(String(c['status'] ?? ''))).length} color="var(--jarvis-red)" />
      </div>
      <div style={{ marginBottom: 10 }}>
        <input className="jarvis-input" type="search" placeholder="Search contracts…" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search" />
      </div>
      {filtered.length === 0 ? (
        <div className="jarvis-empty"><span className="jarvis-empty-icon">📊</span><span>No contracts to track</span></div>
      ) : (
        <div className="jarvis-card" style={{ padding: 16 }}>
          {filtered.map(c => {
            const pct = Number(c['progress'] ?? 0)
            const col = pct >= 80 ? 'var(--jarvis-grn)' : pct >= 40 ? 'var(--jarvis-blue)' : 'var(--jarvis-amb)'
            return (
              <div key={String(c['id'])} style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <div>
                    <span className="jarvis-body" style={{ fontWeight: 600 }}>{String(c['project'] ?? c['id'])}</span>
                    <span className="jarvis-small" style={{ display: 'block' }}>{String(c['client'] ?? '—')} · {String(c['type'] ?? '—')}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <span style={{ fontWeight: 700, color: col, fontFamily: 'var(--jarvis-font-mono)', fontSize: 13 }}>{pct}%</span>
                    <StatusBadge status={String(c['status'] ?? 'active')} />
                  </div>
                </div>
                <div style={{ background: 'var(--jarvis-bl)', borderRadius: 6, height: 8, overflow: 'hidden' }}>
                  <div style={{ width: `${Math.min(100,pct)}%`, height: '100%', background: col, borderRadius: 6, transition: 'width 0.4s' }} />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
export default CtView
