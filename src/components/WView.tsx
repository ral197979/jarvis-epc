/**
 * JARVIS EPC — WView  ·  Construction Work Overview
 */
import React from 'react'
import { useBizStore, selectContracts, selectEVMProjects } from '../modules/biz/store'
import { KpiCard }     from './KpiCard'
import { StatusBadge } from './StatusBadge'
import type { PolicyConfig } from '../modules/biz/dispatch'

export interface WViewProps { policy?: Partial<PolicyConfig>; onNavigate?: (tab: string) => void }
function fmt(n: number) { if (n >= 1_000_000) return `$${(n/1_000_000).toFixed(1)}M`; if (n >= 1_000) return `$${(n/1_000).toFixed(0)}K`; return `$${n.toFixed(0)}` }
function pbar(pct: number) {
  const c = pct >= 80 ? 'var(--jarvis-grn)' : pct >= 40 ? 'var(--jarvis-blue)' : 'var(--jarvis-amb)'
  return <div style={{ background: 'var(--jarvis-bl)', borderRadius: 4, height: 6, overflow: 'hidden' }}>
    <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: c, borderRadius: 4, transition: 'width 0.4s' }} />
  </div>
}

export function WView({ policy: _p, onNavigate }: WViewProps) {
  const contracts = useBizStore(selectContracts)
  const evmPjs    = useBizStore(selectEVMProjects)
  const install   = useBizStore(s => s.biz.installation ?? [])
  const manpower  = useBizStore(s => s.biz.manpower     ?? [])
  const evmMap    = new Map(evmPjs.map(e => [e.project, e]))

  const active   = contracts.filter(c => ['active','in-progress'].includes(String(c['status'] ?? '')))
  const total    = contracts.reduce((s, c) => s + Number(c['value'] ?? 0), 0)
  const avgProg  = contracts.length ? Math.round(contracts.reduce((s, c) => s + Number(c['progress'] ?? 0), 0) / contracts.length) : 0

  return (
    <div role="main" aria-label="Construction Work Overview">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8, marginBottom: 20 }}>
        <KpiCard label="Total Contracts" value={contracts.length} sub={`${active.length} active`} />
        <KpiCard label="Portfolio Value" value={fmt(total)} color="var(--jarvis-blue)" />
        <KpiCard label="Avg Progress"    value={`${avgProg}%`} color={avgProg >= 60 ? 'var(--jarvis-grn)' : 'var(--jarvis-amb)'} />
        <KpiCard label="Install Records" value={install.length} color="var(--jarvis-pur)" />
        <KpiCard label="Manpower Recs"   value={manpower.length} color="var(--jarvis-amb)" />
      </div>

      {contracts.length === 0 ? (
        <div className="jarvis-empty"><span className="jarvis-empty-icon">🏗️</span><span>No construction contracts</span></div>
      ) : (
        <div className="jarvis-card" style={{ padding: 16 }}>
          <h4 className="jarvis-label" style={{ marginBottom: 12 }}>Active Work Packages</h4>
          {active.slice(0, 8).map(c => {
            const pct  = Number(c['progress'] ?? 0)
            const evm  = evmMap.get(String(c['project'] ?? ''))
            return (
              <div key={String(c['id'])} style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span className="jarvis-body" style={{ fontWeight: 600 }}>{String(c['project'] ?? c['id'])}</span>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {evm && <span style={{ fontFamily: 'var(--jarvis-font-mono)', fontSize: 10, color: evm.cpi >= 1 ? 'var(--jarvis-grn)' : 'var(--jarvis-red)' }}>CPI {evm.cpi.toFixed(2)}</span>}
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--jarvis-ts)' }}>{pct}%</span>
                    <StatusBadge status={String(c['status'] ?? 'active')} />
                  </div>
                </div>
                {pbar(pct)}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
export default WView
