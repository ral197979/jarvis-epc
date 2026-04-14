/**
 * JARVIS EPC — LeView  ·  Leads Pipeline (kanban-style stage view)
 */
import React, { useMemo } from 'react'
import { useBizStore, selectLeads } from '../modules/biz/store'
import { StatusBadge } from './StatusBadge'
import { KpiCard } from './KpiCard'
import type { PolicyConfig } from '../modules/biz/dispatch'

export interface LeViewProps { policy?: Partial<PolicyConfig> }
const STAGES = ['prospect','qualified','proposal','negotiation','won','lost']
const STAGE_COLOR: Record<string, string> = { prospect: 'var(--jarvis-td)', qualified: 'var(--jarvis-blue)', proposal: 'var(--jarvis-pur)', negotiation: 'var(--jarvis-amb)', won: 'var(--jarvis-grn)', lost: 'var(--jarvis-red)' }
function fmt(n: number) { if (n >= 1_000_000) return `$${(n/1_000_000).toFixed(1)}M`; if (n >= 1_000) return `$${(n/1_000).toFixed(0)}K`; return `$${n.toFixed(0)}` }

export function LeView({ policy: _p }: LeViewProps) {
  const leads = useBizStore(selectLeads)
  const stages = useMemo(() => STAGES.map(stage => ({ stage, leads: leads.filter(l => (l['status'] ?? 'prospect') === stage) })), [leads])
  const totalValue = leads.reduce((s, l) => s + Number(l['value'] ?? 0), 0)

  return (
    <div role="main" aria-label="Leads Pipeline">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 8, marginBottom: 20 }}>
        <KpiCard label="Total Leads"    value={leads.length} />
        <KpiCard label="Pipeline Value" value={fmt(totalValue)} color="var(--jarvis-blue)" />
        <KpiCard label="Won"            value={leads.filter(l => l['status'] === 'won').length}  color="var(--jarvis-grn)" />
        <KpiCard label="Active"         value={leads.filter(l => !['won','lost'].includes(String(l['status']))).length} color="var(--jarvis-amb)" />
      </div>
      {leads.length === 0 ? (
        <div className="jarvis-empty"><span className="jarvis-empty-icon">🎯</span><span>No leads in pipeline</span></div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8, overflowX: 'auto' }}>
          {stages.map(({ stage, leads: stageLeads }) => (
            <div key={stage} style={{ minWidth: 160 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, padding: '6px 8px', background: `color-mix(in srgb, ${STAGE_COLOR[stage]} 12%, transparent)`, borderRadius: 6, borderTop: `3px solid ${STAGE_COLOR[stage]}` }}>
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: STAGE_COLOR[stage] }}>{stage}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--jarvis-ts)' }}>{stageLeads.length}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {stageLeads.map(l => (
                  <div key={String(l.id)} className="jarvis-card" style={{ padding: '10px 12px' }}>
                    <div className="jarvis-body" style={{ fontWeight: 600, fontSize: 12, marginBottom: 2 }}>{String(l['name'] ?? l.id)}</div>
                    <div className="jarvis-muted" style={{ fontSize: 10 }}>{String(l['company'] ?? '—')}</div>
                    {Number(l['value'] ?? 0) > 0 && <div style={{ fontFamily: 'var(--jarvis-font-mono)', fontSize: 11, color: 'var(--jarvis-blue)', marginTop: 4, fontWeight: 700 }}>{fmt(Number(l['value']))}</div>}
                  </div>
                ))}
                {stageLeads.length === 0 && <div style={{ padding: '12px 8px', textAlign: 'center', color: 'var(--jarvis-td)', fontSize: 11, fontStyle: 'italic' }}>Empty</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
export default LeView
