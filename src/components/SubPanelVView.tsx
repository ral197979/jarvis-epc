/**
 * JARVIS EPC — SubPanelVView  ·  Vendor Sub-Panel
 */
import React from 'react'
import { useBizStore, selectVendors } from '../modules/biz/store'
import { StatusBadge } from './StatusBadge'
import type { PolicyConfig } from '../modules/biz/dispatch'
export interface SubPanelVViewProps { policy?: Partial<PolicyConfig>; biz?: Record<string,unknown>; maxItems?: number }
export function SubPanelVView({ policy: _p, maxItems = 6 }: SubPanelVViewProps) {
  const vendors = useBizStore(selectVendors).slice(0, maxItems)
  return (
    <div aria-label="Vendor Sub-Panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span className="jarvis-label">Vendor Directory</span>
        <span className="jarvis-badge jarvis-badge-blue">{vendors.length}</span>
      </div>
      {vendors.length === 0 ? <p className="jarvis-muted" style={{ fontStyle: 'italic', fontSize: 12 }}>No vendors</p> :
        vendors.map((v, i) => (
          <div key={String(v['id'] ?? i)} className="jarvis-row" style={{ padding: '6px 0' }}>
            <div className="jarvis-flex-1">
              <div className="jarvis-body" style={{ fontWeight: 600, fontSize: 12 }}>{String(v['name'] ?? v['company'] ?? v['id'])}</div>
              <div className="jarvis-muted" style={{ fontSize: 10 }}>{String(v['category'] ?? v['type'] ?? '—')}</div>
            </div>
            {!!v['status'] && <StatusBadge status={String(v['status'])} />}
          </div>
        ))}
    </div>
  )
}
export default SubPanelVView
