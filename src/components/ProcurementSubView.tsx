/**
 * Denver Engineering — ProcurementSubView  ·  Procurement Sub-Panel (compact)
 */
import React from 'react'
import { useBizStore } from '../modules/biz/store'
import { StatusBadge } from './StatusBadge'
import type { PolicyConfig } from '../modules/biz/dispatch'

export interface ProcurementSubViewProps { policy?: Partial<PolicyConfig>; maxItems?: number }
function fmt(n: number) { return n >= 1000 ? `$${(n/1000).toFixed(0)}K` : `$${n.toFixed(0)}` }

export function ProcurementSubView({ policy: _p, maxItems = 6 }: ProcurementSubViewProps) {
  const pos = useBizStore(s => s.biz.purchase_orders ?? [])
  const open = pos.filter(p => p['status'] !== 'closed' && p['status'] !== 'cancelled').slice(0, maxItems)

  return (
    <div aria-label="Procurement Sub-Panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span className="jarvis-label">Open Purchase Orders</span>
        <span className="jarvis-badge jarvis-badge-blue">{open.length}</span>
      </div>
      {open.length === 0 ? (
        <p className="jarvis-muted" style={{ fontStyle: 'italic', fontSize: 12 }}>No open orders</p>
      ) : (
        open.map((p, i) => (
          <div key={String(p['id'] ?? i)} className="jarvis-row" style={{ padding: '8px 0' }}>
            <div className="jarvis-flex-1">
              <div className="jarvis-body" style={{ fontWeight: 600, fontSize: 12 }}>{String(p['description'] ?? p['id'])}</div>
              <div className="jarvis-muted" style={{ fontSize: 10 }}>{String(p['vendor'] ?? p['supplier'] ?? '—')}</div>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
              {Number(p['value'] ?? p['amount'] ?? 0) > 0 && <span style={{ fontFamily: 'var(--jarvis-font-mono)', fontSize: 10, color: 'var(--jarvis-amb)' }}>{fmt(Number(p['value'] ?? p['amount']))}</span>}
              <StatusBadge status={String(p['status'] ?? 'open')} />
            </div>
          </div>
        ))
      )}
    </div>
  )
}
export default ProcurementSubView
