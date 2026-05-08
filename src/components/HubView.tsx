/**
 * Denver Engineering — HubView  ·  Project Hub (unified cross-domain summary)
 */
import React from 'react'
import { useBizStore, selectContracts, selectLeads, selectDocuments, selectIncidents, selectActionItems, selectPunchItems } from '../modules/biz/store'
import { KpiCard }     from './KpiCard'
import { StatusBadge } from './StatusBadge'
import type { PolicyConfig } from '../modules/biz/dispatch'

export interface HubViewProps { policy?: Partial<PolicyConfig>; onNavigate?: (tab: string) => void }
function fmt(n: number) { if (n >= 1_000_000) return `$${(n/1_000_000).toFixed(1)}M`; if (n >= 1_000) return `$${(n/1_000).toFixed(0)}K`; return `$${n.toFixed(0)}` }

export function HubView({ policy: _p, onNavigate }: HubViewProps) {
  const contracts  = useBizStore(selectContracts)
  const leads      = useBizStore(selectLeads)
  const docs       = useBizStore(selectDocuments)
  const incidents  = useBizStore(selectIncidents) as Record<string,unknown>[]
  const actions    = useBizStore(selectActionItems)
  const punch      = useBizStore(selectPunchItems)
  const pos        = useBizStore(s => s.biz.purchase_orders ?? [])
  const rfqs       = useBizStore(s => s.biz.rfqs ?? [])
  const invoices   = useBizStore(s => s.biz.invoices ?? [])
  const evmPjs     = useBizStore(s => s.biz.evm_projects ?? [])

  const activeContracts  = contracts.filter(c => ['active','in-progress'].includes(String(c['status'] ?? '')))
  const openIncidents    = incidents.filter(i => i['status'] !== 'closed')
  const openActions      = actions.filter(a => a['status'] !== 'closed' && a['status'] !== 'complete')
  const portfolioValue   = contracts.reduce((s, c) => s + Number(c['value'] ?? 0), 0)
  const outstanding      = invoices.filter(i => i['status'] !== 'paid')
  const outstandingValue = outstanding.reduce((s, i) => s + Number(i['amount'] ?? 0), 0)
  const avgCPI           = evmPjs.length ? evmPjs.reduce((s, e) => s + e.cpi, 0) / evmPjs.length : null

  const domains = [
    { icon: '🏗️', label: 'Projects',  stat: `${activeContracts.length} active`,    value: fmt(portfolioValue),   tab: 'projects',    alert: false },
    { icon: '🎯', label: 'CRM',       stat: `${leads.filter(l => l['status'] !== 'won' && l['status'] !== 'lost').length} leads`, value: `${leads.length} total`, tab: 'crm', alert: false },
    { icon: '📄', label: 'Documents', stat: `${docs.length} docs`,                 value: `${docs.filter(d => d['cde'] === 'issued').length} issued`, tab: 'documents', alert: false },
    { icon: '🛒', label: 'Procurement', stat: `${pos.length} POs`,                 value: `${rfqs.filter(r => r['status'] === 'open').length} open RFQs`, tab: 'procurement', alert: false },
    { icon: '🦺', label: 'Safety',    stat: `${openIncidents.length} open`,        value: 'incidents',           tab: 'safety',      alert: openIncidents.length > 0 },
    { icon: '💰', label: 'Finance',   stat: fmt(outstandingValue),                 value: 'outstanding',          tab: 'finance',     alert: outstanding.length > 0 },
    { icon: '✅', label: 'Actions',   stat: `${openActions.length} open`,          value: `${punch.length} punch`, tab: 'actions',   alert: openActions.length > 5 },
    { icon: '📊', label: 'EVM',       stat: avgCPI != null ? `CPI ${avgCPI.toFixed(2)}` : 'No data', value: `${evmPjs.length} projects`, tab: 'projects', alert: avgCPI != null && avgCPI < 0.9 },
  ]

  return (
    <div role="main" aria-label="Project Hub">
      <h3 className="jarvis-heading" style={{ marginBottom: 4 }}>Project Hub</h3>
      <p className="jarvis-muted" style={{ marginBottom: 20, fontSize: 12 }}>Cross-domain project status at a glance</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, marginBottom: 24 }}>
        {domains.map(d => (
          <div key={d.label} className="jarvis-card" onClick={() => onNavigate?.(d.tab)} style={{ padding: 16, cursor: 'pointer', borderLeft: d.alert ? '3px solid var(--jarvis-red)' : '3px solid var(--jarvis-bd)', transition: 'border-color 0.15s' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <span style={{ fontSize: 20 }}>{d.icon}</span>
              {d.alert && <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--jarvis-red)', marginTop: 4 }} />}
            </div>
            <div className="jarvis-body" style={{ fontWeight: 700, fontSize: 14 }}>{d.label}</div>
            <div style={{ fontWeight: 700, color: 'var(--jarvis-ac)', fontSize: 16, marginTop: 2 }}>{d.stat}</div>
            <div className="jarvis-muted" style={{ fontSize: 11, marginTop: 2 }}>{d.value}</div>
          </div>
        ))}
      </div>

      {/* Recent activity snapshot */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="jarvis-card" style={{ padding: 16 }}>
          <h4 className="jarvis-label" style={{ marginBottom: 10 }}>Open Actions</h4>
          {openActions.length === 0 ? <p className="jarvis-muted" style={{ fontStyle: 'italic' }}>All clear ✅</p> :
            openActions.slice(0, 4).map(a => (
              <div key={String(a['id'])} className="jarvis-row">
                <span className="jarvis-flex-1 jarvis-body" style={{ fontSize: 12, fontWeight: 600 }}>{String(a['subject'] ?? a['description'] ?? a['id'])}</span>
                <StatusBadge status={String(a['status'] ?? 'open')} />
              </div>
            ))}
        </div>
        <div className="jarvis-card" style={{ padding: 16 }}>
          <h4 className="jarvis-label" style={{ marginBottom: 10 }}>Active Contracts</h4>
          {activeContracts.length === 0 ? <p className="jarvis-muted" style={{ fontStyle: 'italic' }}>No active contracts</p> :
            activeContracts.slice(0, 4).map(c => (
              <div key={String(c['id'])} className="jarvis-row">
                <div className="jarvis-flex-1">
                  <span className="jarvis-body" style={{ fontSize: 12, fontWeight: 600 }}>{String(c['project'] ?? c['id'])}</span>
                  <span className="jarvis-small" style={{ display: 'block' }}>{Number(c['progress'] ?? 0)}% complete</span>
                </div>
                <StatusBadge status={String(c['status'] ?? 'active')} />
              </div>
            ))}
        </div>
      </div>
    </div>
  )
}
export default HubView
