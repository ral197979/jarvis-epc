/**
 * Denver Engineering — CRMView  ·  CRM Overview (pipeline summary + quick stats)
 */
import React, { useState, useEffect } from 'react'
import { useBizStore, selectLeads, selectCustomers, selectProposals } from '../modules/biz/store'
import { KpiCard } from './KpiCard'
import { StatusBadge } from './StatusBadge'
import { CRMLeads } from './CRMLeads'
import type { PolicyConfig } from '../modules/biz/dispatch'

export interface CRMViewProps { policy?: Partial<PolicyConfig>; onAudit?: (e: unknown) => void; onToast?: (msg: string, type: string) => void; onNavigate?: (tab: string) => void }

const STAGES = ['prospect','qualified','proposal','negotiation','won','lost']
function fmt(n: number) { if (n >= 1_000_000) return `$${(n/1_000_000).toFixed(1)}M`; if (n >= 1_000) return `$${(n/1_000).toFixed(0)}K`; return `$${n.toFixed(0)}` }

// ─── What this screen's three domains actually have behind them ──────────────
//
// The three collections it reads are not the same kind of thing, and the
// repairs differ accordingly:
//
//   proposals   REAL API — GET /api/v1/proposals (crm.view), migration 062,
//               full lifecycle (submit/won/lost). Wired below: store wins when
//               it holds rows, otherwise the API answers.
//   leads       TABLE WITHOUT AN API — migration 002 creates crm_leads with RLS
//               and triggers, but no route anywhere reads it. Nothing to fetch;
//               the screen says so instead of asserting an empty pipeline.
//   customers   NOTHING — no table in any migration, no route. Same conclusion
//               the Directory reached; the KPI shows an em dash, not a zero.
//
// LEADS_API / CUSTOMERS_API are the recorded facts, not switches to flip: turn
// one on only when the backend it names exists.
const LEADS_API     = false  // crm_leads exists (002_epc_core.sql:408) — no route reads it
const CUSTOMERS_API = false  // no customers table, no route (verified 2026-08-23)

/** Rows as GET /api/v1/proposals returns them — note the envelope is `{ proposals }`. */
interface ProposalApiRow {
  id: string
  title?: string; client_name?: string
  status?: string                       // draft | submitted | won | lost | no_bid
  estimated_value?: string | number | null
  [key: string]: unknown
}

/** A proposal still in play: not yet decided. */
const OPEN_PROPOSAL_STATUSES = new Set(['draft', 'submitted'])

interface ProposalsData {
  rows:  ProposalApiRow[]
  state: 'loading' | 'ready' | 'forbidden' | 'error'
}

function useProposals(enabled: boolean): ProposalsData {
  const [data, setData] = useState<ProposalsData>({ rows: [], state: enabled ? 'loading' : 'ready' })
  useEffect(() => {
    if (!enabled) return
    let live = true
    void (async () => {
      try {
        const res = await fetch('/api/v1/proposals?limit=200')
        if (!live) return
        if (res.status === 401 || res.status === 403) { setData({ rows: [], state: 'forbidden' }); return }
        if (!res.ok) { setData({ rows: [], state: 'error' }); return }
        const body = await res.json() as { proposals?: ProposalApiRow[] }
        if (!live) return
        setData({ rows: body.proposals ?? [], state: 'ready' })
      } catch {
        if (!live) return
        setData({ rows: [], state: 'error' })
      }
    })()
    return () => { live = false }
  }, [enabled])
  return data
}

export function CRMView({ policy, onAudit, onToast, onNavigate: _onNavigate }: CRMViewProps) {
  const leads          = useBizStore(selectLeads)
  const customers      = useBizStore(selectCustomers)
  const storeProposals = useBizStore(selectProposals)
  const [tab, setTab]  = useState<'overview'|'leads'>('overview')

  // Store wins when it holds rows — same precedence as the other repaired
  // registers. Only the routed, nothing-dispatched case reads the API.
  const proposalsLive = storeProposals.length === 0
  const fetched       = useProposals(proposalsLive)

  const openLeads  = leads.filter(l => l['status'] !== 'won' && l['status'] !== 'lost')
  const wonLeads   = leads.filter(l => l['status'] === 'won')
  const totalValue = leads.reduce((s, l) => s + Number(l['value'] ?? 0), 0)
  const wonValue   = wonLeads.reduce((s, l) => s + Number(l['value'] ?? 0), 0)
  const winRate    = leads.length > 0 ? ((wonLeads.length / leads.length) * 100).toFixed(0) : '0'

  const pipeline = STAGES.map(stage => ({
    stage,
    count: leads.filter(l => (l['status'] ?? 'prospect') === stage).length,
    value: leads.filter(l => (l['status'] ?? 'prospect') === stage).reduce((s, l) => s + Number(l['value'] ?? 0), 0),
  }))

  return (
    <div role="main" aria-label="CRM">
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid var(--jarvis-bd)' }}>
        {(['overview','leads'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: '8px 16px', background: 'transparent', border: 'none', borderBottom: tab === t ? '2px solid var(--jarvis-ac)' : '2px solid transparent', color: tab === t ? 'var(--jarvis-tx)' : 'var(--jarvis-ts)', fontWeight: tab === t ? 700 : 500, fontSize: 12, cursor: 'pointer', paddingBottom: 10, textTransform: 'capitalize' }}>{t}</button>
        ))}
      </div>

      {tab === 'overview' && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginBottom: 20 }}>
            <KpiCard label="Total Leads"     value={leads.length}       sub={`${openLeads.length} open`} />
            <KpiCard label="Pipeline Value"  value={fmt(totalValue)}     color="var(--jarvis-blue)" />
            <KpiCard label="Won Value"        value={fmt(wonValue)}       color="var(--jarvis-grn)" sub={`${wonLeads.length} won`} />
            <KpiCard label="Win Rate"         value={`${winRate}%`}       color={Number(winRate) >= 30 ? 'var(--jarvis-grn)' : 'var(--jarvis-amb)'} />
            {/* No customers backend exists, so an empty store means UNSTORED,
                not zero. Same rule as the Directory's Active Customers card. */}
            <KpiCard label="Customers"
              value={!CUSTOMERS_API && customers.length === 0 ? '—' : customers.length}
              color="var(--jarvis-pur)" />
            {proposalsLive ? (
              <KpiCard label="Proposals"
                value={fetched.state === 'ready' ? fetched.rows.length : '—'}
                color="var(--jarvis-amb)"
                sub={
                  fetched.state === 'ready'     ? `${fetched.rows.filter(r => OPEN_PROPOSAL_STATUSES.has(String(r.status))).length} open` :
                  fetched.state === 'loading'   ? 'loading…' :
                  fetched.state === 'forbidden' ? 'requires crm.view' :
                  'load failed'
                } />
            ) : (
              <KpiCard label="Proposals" value={storeProposals.length} color="var(--jarvis-amb)"
                sub={`${storeProposals.filter(p => p['status'] === 'open').length} open`} />
            )}
          </div>

          <h4 className="jarvis-label" style={{ marginBottom: 12 }}>Sales Pipeline</h4>
          {/* Six zero columns would claim an empty pipeline. The crm_leads
              table exists (migration 002) but no route serves it, so with an
              empty store this screen cannot know the pipeline — and says so. */}
          {!LEADS_API && leads.length === 0 && (
            <p className="jarvis-small" role="note" style={{ color: 'var(--jarvis-ts)', marginBottom: 10 }}>
              Lead data is not available — the crm_leads table has no API yet, so
              this pipeline reflects only leads entered in this session.
            </p>
          )}
          <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
            {pipeline.map(({ stage, count, value }) => (
              <div key={stage} className="jarvis-card" style={{ flex: 1, padding: '12px 10px', textAlign: 'center' }}>
                <div className="jarvis-muted" style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>{stage}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: count > 0 ? 'var(--jarvis-tx)' : 'var(--jarvis-td)' }}>{count}</div>
                {value > 0 && <div style={{ fontFamily: 'var(--jarvis-font-mono)', fontSize: 10, color: 'var(--jarvis-blue)', marginTop: 2 }}>{fmt(value)}</div>}
              </div>
            ))}
          </div>

          {leads.length > 0 && (
            <div className="jarvis-card" style={{ padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <h4 className="jarvis-label">Recent Leads</h4>
                <button className="jarvis-btn jarvis-btn-ghost jarvis-btn-sm" onClick={() => setTab('leads')}>View all →</button>
              </div>
              {leads.slice(0, 5).map(l => (
                <div key={String(l.id)} className="jarvis-row">
                  <div className="jarvis-flex-1"><span className="jarvis-body" style={{ fontWeight: 600 }}>{String(l['name'] ?? l.id)}</span><span className="jarvis-small" style={{ display: 'block' }}>{String(l['company'] ?? '—')} · {String(l['source'] ?? '—')}</span></div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {Number(l['value'] ?? 0) > 0 && <span style={{ fontFamily: 'var(--jarvis-font-mono)', fontSize: 11, color: 'var(--jarvis-blue)' }}>{fmt(Number(l['value']))}</span>}
                    <StatusBadge status={String(l['status'] ?? 'prospect')} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'leads' && (
        <CRMLeads policy={{ writesEnabled: false, chatEnabled: false, exportsEnabled: false, activeRole: 'viewer', ...policy }} onAudit={onAudit} onToast={onToast} />
      )}
    </div>
  )
}
export default CRMView
