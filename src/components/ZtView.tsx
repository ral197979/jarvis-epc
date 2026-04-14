/**
 * JARVIS EPC — ZtView  ·  Zone Tracking (Commissioning)
 */
import React, { useState } from 'react'
import { useBizStore } from '../modules/biz/store'
import { StatusBadge } from './StatusBadge'
import { KpiCard }     from './KpiCard'
import type { PolicyConfig } from '../modules/biz/dispatch'

export interface ZtViewProps { policy?: Partial<PolicyConfig>; biz?: Record<string,unknown> }
export function ZtView({ policy: _p, biz: _b }: ZtViewProps) {
  const cxPhases  = useBizStore(s => s.biz.cx_phases  ?? [])
  const cxIssues  = useBizStore(s => s.biz.cx_issues  ?? [])
  const ciAssets  = useBizStore(s => s.biz.ci_assets  ?? [])
  const [search, setSearch] = useState('')

  const zones = [...new Set([...cxPhases.map(p => String(p['zone'] ?? p['area'] ?? '')), ...ciAssets.map(a => String(a['zone'] ?? a['area'] ?? ''))].filter(Boolean))]
  const filtered = zones.filter(z => !search || z.toLowerCase().includes(search.toLowerCase()))

  return (
    <div role="main" aria-label="Zone Tracking">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 8, marginBottom: 16 }}>
        <KpiCard label="CX Phases" value={cxPhases.length}  color="var(--jarvis-blue)" />
        <KpiCard label="CX Issues" value={cxIssues.length}  color="var(--jarvis-red)" />
        <KpiCard label="CI Assets" value={ciAssets.length}  color="var(--jarvis-pur)" />
        <KpiCard label="Zones"     value={zones.length}     color="var(--jarvis-grn)" />
      </div>
      <div style={{ marginBottom: 10 }}>
        <input className="jarvis-input" type="search" placeholder="Filter zones…" value={search} onChange={e => setSearch(e.target.value)} aria-label="Filter zones" />
      </div>
      {filtered.length > 0 ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10, marginBottom: 16 }}>
          {filtered.map(zone => {
            const phases = cxPhases.filter(p => (p['zone'] ?? p['area']) === zone)
            const assets = ciAssets.filter(a => (a['zone'] ?? a['area']) === zone)
            return (
              <div key={zone} className="jarvis-card" style={{ padding: 14 }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>{zone}</div>
                <div className="jarvis-small">{phases.length} CX phases · {assets.length} assets</div>
              </div>
            )
          })}
        </div>
      ) : null}
      {cxPhases.length > 0 && (
        <div className="jarvis-card" style={{ padding: 16 }}>
          <h4 className="jarvis-label" style={{ marginBottom: 10 }}>Commissioning Phases</h4>
          {cxPhases.slice(0, 8).map((p, i) => (
            <div key={String(p['id'] ?? i)} className="jarvis-row">
              <div className="jarvis-flex-1"><span className="jarvis-body" style={{ fontWeight: 600 }}>{String(p['phase'] ?? p['title'] ?? p['id'])}</span><span className="jarvis-small" style={{ display: 'block' }}>{String(p['zone'] ?? p['area'] ?? '—')}</span></div>
              <StatusBadge status={String(p['status'] ?? 'pending')} />
            </div>
          ))}
        </div>
      )}
      {cxPhases.length === 0 && zones.length === 0 && (
        <div className="jarvis-empty"><span className="jarvis-empty-icon">📍</span><span>No zone tracking data — add commissioning phases or assets with zone fields</span></div>
      )}
    </div>
  )
}
export default ZtView
