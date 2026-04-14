/**
 * JARVIS EPC — SubPanelQView  ·  Quality Sub-Panel
 */
import React from 'react'
import { useBizStore, selectPunchItems } from '../modules/biz/store'
import { StatusBadge } from './StatusBadge'
import type { PolicyConfig } from '../modules/biz/dispatch'
export interface SubPanelQViewProps { policy?: Partial<PolicyConfig>; biz?: Record<string,unknown>; maxItems?: number }
export function SubPanelQView({ policy: _p, maxItems = 6 }: SubPanelQViewProps) {
  const punch = useBizStore(selectPunchItems)
  const open  = punch.filter(p => p['status'] !== 'closed' && p['status'] !== 'complete').slice(0, maxItems)
  return (
    <div aria-label="Quality Sub-Panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span className="jarvis-label">Open Punch Items</span>
        <span className="jarvis-badge jarvis-badge-blue">{open.length}</span>
      </div>
      {open.length === 0 ? <p className="jarvis-muted" style={{ fontStyle: 'italic', fontSize: 12 }}>No open punch items ✅</p> :
        open.map((p, i) => (
          <div key={String(p['id'] ?? i)} className="jarvis-row" style={{ padding: '6px 0' }}>
            <div className="jarvis-flex-1">
              <div className="jarvis-body" style={{ fontWeight: 600, fontSize: 12 }}>{String(p['description'] ?? p['subject'] ?? p['id'])}</div>
              <div className="jarvis-muted" style={{ fontSize: 10 }}>{String(p['location'] ?? '—')} · {String(p['priority'] ?? '—')}</div>
            </div>
            <StatusBadge status={String(p['status'] ?? 'open')} />
          </div>
        ))}
    </div>
  )
}
export default SubPanelQView
