/**
 * Denver Engineering — LoView  ·  Logistics Overview
 */
import React from 'react'
import { useBizStore } from '../modules/biz/store'
import { StatusBadge } from './StatusBadge'
import { KpiCard }     from './KpiCard'
import type { PolicyConfig } from '../modules/biz/dispatch'

export interface LoViewProps { policy?: Partial<PolicyConfig> }
function fmt(n: number) { if (n >= 1_000_000) return `$${(n/1_000_000).toFixed(1)}M`; if (n >= 1_000) return `$${(n/1_000).toFixed(0)}K`; return `$${n.toFixed(0)}` }

export function LoView({ policy: _p }: LoViewProps) {
  const pos      = useBizStore(s => s.biz.purchase_orders ?? [])
  const rfqs     = useBizStore(s => s.biz.rfqs            ?? [])
  const submittals = useBizStore(s => s.biz.submittals    ?? [])

  const inTransit = pos.filter(p => p['status'] === 'dispatched' || p['status'] === 'in-transit')
  const delivered = pos.filter(p => p['status'] === 'delivered'  || p['status'] === 'received')
  const pending   = pos.filter(p => p['status'] === 'pending'    || p['status'] === 'open')
  const totalPOValue = pos.reduce((s, p) => s + Number(p['value'] ?? p['amount'] ?? 0), 0)

  return (
    <div role="main" aria-label="Logistics Overview">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8, marginBottom: 20 }}>
        <KpiCard label="Total POs"    value={pos.length}         sub={fmt(totalPOValue)} />
        <KpiCard label="In Transit"   value={inTransit.length}   color="var(--jarvis-blue)" />
        <KpiCard label="Delivered"    value={delivered.length}   color="var(--jarvis-grn)" />
        <KpiCard label="Pending"      value={pending.length}     color="var(--jarvis-amb)" />
        <KpiCard label="RFQs Open"    value={rfqs.filter(r => r['status'] === 'open').length} color="var(--jarvis-pur)" />
        <KpiCard label="Submittals"   value={submittals.length}  color="var(--jarvis-td)" />
      </div>
      {pos.length === 0 ? (
        <div className="jarvis-empty"><span className="jarvis-empty-icon">🚚</span><span>No purchase orders to track</span></div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="jarvis-card" style={{ padding: 16 }}>
            <h4 className="jarvis-label" style={{ marginBottom: 10 }}>In Transit / Dispatched</h4>
            {inTransit.length === 0 ? <p className="jarvis-muted" style={{ fontStyle: 'italic' }}>None in transit</p> :
              inTransit.slice(0, 5).map(p => (
                <div key={String(p['id'])} className="jarvis-row">
                  <div className="jarvis-flex-1"><span className="jarvis-body" style={{ fontWeight: 600 }}>{String(p['description'] ?? p['id'])}</span><span className="jarvis-small" style={{ display: 'block' }}>{String(p['vendor'] ?? p['supplier'] ?? '—')}</span></div>
                  <StatusBadge status={String(p['status'] ?? 'open')} />
                </div>
              ))}
          </div>
          <div className="jarvis-card" style={{ padding: 16 }}>
            <h4 className="jarvis-label" style={{ marginBottom: 10 }}>Pending Orders</h4>
            {pending.length === 0 ? <p className="jarvis-muted" style={{ fontStyle: 'italic' }}>No pending orders</p> :
              pending.slice(0, 5).map(p => (
                <div key={String(p['id'])} className="jarvis-row">
                  <div className="jarvis-flex-1"><span className="jarvis-body" style={{ fontWeight: 600 }}>{String(p['description'] ?? p['id'])}</span><span className="jarvis-small" style={{ display: 'block' }}>{String(p['vendor'] ?? p['supplier'] ?? '—')}</span></div>
                  <span style={{ fontFamily: 'var(--jarvis-font-mono)', fontSize: 11, color: 'var(--jarvis-amb)' }}>{Number(p['value'] ?? p['amount'] ?? 0) > 0 ? fmt(Number(p['value'] ?? p['amount'])) : '—'}</span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  )
}
export default LoView
