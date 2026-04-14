/**
 * JARVIS EPC — ZeView  ·  Zone Engineering
 */
import React, { useState } from 'react'
import { useBizStore, selectContracts } from '../modules/biz/store'
import { StatusBadge } from './StatusBadge'
import { KpiCard }     from './KpiCard'
import type { PolicyConfig } from '../modules/biz/dispatch'

export interface ZeViewProps { policy?: Partial<PolicyConfig> }

export function ZeView({ policy: _p }: ZeViewProps) {
  const contracts    = useBizStore(selectContracts)
  const engineering  = useBizStore(s => s.biz.engineering_deliverables ?? [])
  const [search, setSearch] = useState('')

  const zones = [...new Set([...contracts.map(c => String(c['zone'] ?? c['area'] ?? '')), ...engineering.map(e => String(e['zone'] ?? e['area'] ?? ''))].filter(Boolean))]
  const filtered = zones.filter(z => !search || z.toLowerCase().includes(search.toLowerCase()))

  return (
    <div role="main" aria-label="Zone Engineering">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 8, marginBottom: 16 }}>
        <KpiCard label="Zones Identified" value={zones.length} color="var(--jarvis-blue)" />
        <KpiCard label="Eng Deliverables" value={engineering.length} color="var(--jarvis-pur)" />
        <KpiCard label="Contracts"        value={contracts.length} />
      </div>
      <div style={{ marginBottom: 10 }}>
        <input className="jarvis-input" type="search" placeholder="Search zones…" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search zones" />
      </div>
      {filtered.length === 0 ? (
        <div className="jarvis-empty"><span className="jarvis-empty-icon">🗺️</span><span>{search ? 'No zones match' : 'No zone data available — tag contracts and deliverables with zone/area fields'}</span></div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
          {filtered.map(zone => {
            const zoneContracts = contracts.filter(c => String(c['zone'] ?? c['area'] ?? '') === zone)
            const zoneEng = engineering.filter(e => String(e['zone'] ?? e['area'] ?? '') === zone)
            return (
              <div key={zone} className="jarvis-card" style={{ padding: 16 }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>{zone}</div>
                <div className="jarvis-small" style={{ color: 'var(--jarvis-ts)' }}>{zoneContracts.length} contracts · {zoneEng.length} deliverables</div>
                {zoneContracts.slice(0, 2).map(c => (
                  <div key={String(c['id'])} style={{ marginTop: 8, fontSize: 11 }}>
                    <div style={{ fontWeight: 600 }}>{String(c['project'] ?? c['id'])}</div>
                    <StatusBadge status={String(c['status'] ?? 'active')} />
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
export default ZeView
