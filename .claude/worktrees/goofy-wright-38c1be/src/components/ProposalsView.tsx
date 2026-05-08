/**
 * JARVIS EPC — ProposalsView  ·  Bid/No-Bid + Proposal Management  (P4)
 */
import React, { useState } from 'react'
import { useBizStore } from '../modules/biz/store'
import { StatusBadge } from './StatusBadge'
import { KpiCard } from './KpiCard'
import type { PolicyConfig } from '../modules/biz/dispatch'

interface Proposal {
  id: string
  title: string
  client: string
  value: number
  currency?: string
  status: 'draft' | 'review' | 'submitted' | 'awarded' | 'lost' | 'no_bid'
  bid_decision?: 'bid' | 'no_bid' | 'pending'
  due_date?: string
  pm?: string
  win_probability?: number
  notes?: string
}

export interface ProposalsViewProps { policy?: Partial<PolicyConfig>; biz?: Record<string, unknown> }

const STATUS_COLOR: Record<string, string> = {
  draft: 'var(--jarvis-ts)', review: 'var(--jarvis-amb,#f39c12)', submitted: 'var(--jarvis-blue,#3498db)',
  awarded: 'var(--jarvis-grn,#27ae60)', lost: 'var(--jarvis-red,#e74c3c)', no_bid: '#666',
}

export function ProposalsView({ policy }: ProposalsViewProps) {
  const raw = useBizStore(s => s.biz.proposals ?? []) as unknown as Proposal[]
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [showAdd, setShowAdd] = useState(false)
  const [draft, setDraft] = useState({ title: '', client: '', value: '', status: 'draft' as Proposal['status'], bid_decision: 'pending' as Proposal['bid_decision'], due_date: '', win_probability: '' })
  const dispatch = useBizStore(s => s.dispatch)
  const canWrite = policy?.writesEnabled !== false

  const demo: Proposal[] = raw.length === 0 ? [
    { id: 'P001', title: 'Substation Upgrade — Phase 2',   client: 'Gulf Energy Ltd',       value: 4200000, status: 'submitted', bid_decision: 'bid',    due_date: '2026-05-10', pm: 'A. Reyes', win_probability: 65 },
    { id: 'P002', title: 'Pipeline Integrity Assessment',  client: 'PetroNorth Inc',         value: 890000,  status: 'review',    bid_decision: 'bid',    due_date: '2026-05-20', pm: 'J. Kim',   win_probability: 40 },
    { id: 'P003', title: 'HVAC Retrofit — Facility B',     client: 'Metro Facilities Corp',  value: 320000,  status: 'awarded',   bid_decision: 'bid',    due_date: '2026-04-30', pm: 'A. Reyes', win_probability: 100 },
    { id: 'P004', title: 'DCS Migration Project',          client: 'ChemWorks SA',           value: 1750000, status: 'draft',     bid_decision: 'pending',due_date: '2026-06-15', pm: 'S. Torres',win_probability: 50 },
    { id: 'P005', title: 'Marine Jetty Inspection',        client: 'Port Authority',         value: 210000,  status: 'no_bid',    bid_decision: 'no_bid', due_date: '2026-04-28', pm: 'D. Patel',  win_probability: 0  },
  ] : raw

  const displayed = statusFilter === 'all' ? demo : demo.filter(p => p.status === statusFilter)

  const totalValue = demo.filter(p => p.bid_decision === 'bid' && p.status !== 'lost' && p.status !== 'no_bid').reduce((s, p) => s + p.value, 0)
  const awarded = demo.filter(p => p.status === 'awarded').reduce((s, p) => s + p.value, 0)
  const hitRate = demo.filter(p => p.status !== 'draft' && p.status !== 'review').length > 0
    ? Math.round(demo.filter(p => p.status === 'awarded').length / demo.filter(p => p.bid_decision === 'bid' && p.status !== 'draft' && p.status !== 'review').length * 100) || 0
    : 0

  const addProposal = () => {
    if (!draft.title) return
    dispatch({ type: 'proposals/add', payload: { id: `P-${Date.now()}`, ...draft, value: Number(draft.value) || 0, win_probability: Number(draft.win_probability) || 0 } })
    setDraft({ title: '', client: '', value: '', status: 'draft', bid_decision: 'pending', due_date: '', win_probability: '' })
    setShowAdd(false)
  }

  const statusOptions = ['all', 'draft', 'review', 'submitted', 'awarded', 'lost', 'no_bid']

  return (
    <div role="main" aria-label="Proposals">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 8, marginBottom: 16 }}>
        <KpiCard label="Active Bids"  value={demo.filter(p => p.bid_decision === 'bid' && !['awarded','lost','no_bid'].includes(p.status)).length} />
        <KpiCard label="Pipeline ($)" value={`$${(totalValue / 1e6).toFixed(1)}M`}  color="var(--jarvis-blue,#3498db)" />
        <KpiCard label="Awarded ($)"  value={`$${(awarded / 1e6).toFixed(1)}M`}     color="var(--jarvis-grn,#27ae60)" />
        <KpiCard label="Hit Rate"     value={`${hitRate}%`}                          color={hitRate >= 50 ? 'var(--jarvis-grn,#27ae60)' : 'var(--jarvis-amb,#f39c12)'} />
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        {statusOptions.map(s => (
          <button key={s} onClick={() => setStatusFilter(s)} style={{ padding: '4px 10px', fontSize: 11, background: statusFilter === s ? (STATUS_COLOR[s] ?? 'var(--jarvis-ac)') : 'var(--jarvis-bg2)', color: statusFilter === s ? '#fff' : 'var(--jarvis-ts)', border: '1px solid var(--jarvis-bd)', borderRadius: 12, cursor: 'pointer' }}>
            {s === 'all' ? 'All' : s.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())}
          </button>
        ))}
        {canWrite && <button onClick={() => setShowAdd(v => !v)} style={{ marginLeft: 'auto', padding: '5px 12px', background: 'var(--jarvis-ac)', color: '#fff', border: 'none', borderRadius: 4, fontSize: 11, cursor: 'pointer' }}>+ New Proposal</button>}
      </div>

      {showAdd && (
        <div style={{ border: '1px solid var(--jarvis-bd)', padding: 12, borderRadius: 6, marginBottom: 12, background: 'var(--jarvis-bg2)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 8 }}>
            <input placeholder="Proposal title *" value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} style={{ padding: '6px 8px', background: 'var(--jarvis-bg)', border: '1px solid var(--jarvis-bd)', borderRadius: 4, color: 'var(--jarvis-tx)', fontSize: 12 }} />
            <input placeholder="Client name" value={draft.client} onChange={e => setDraft({ ...draft, client: e.target.value })} style={{ padding: '6px 8px', background: 'var(--jarvis-bg)', border: '1px solid var(--jarvis-bd)', borderRadius: 4, color: 'var(--jarvis-tx)', fontSize: 12 }} />
            <input placeholder="Estimated value ($)" type="number" value={draft.value} onChange={e => setDraft({ ...draft, value: e.target.value })} style={{ padding: '6px 8px', background: 'var(--jarvis-bg)', border: '1px solid var(--jarvis-bd)', borderRadius: 4, color: 'var(--jarvis-tx)', fontSize: 12 }} />
            <input placeholder="Due date" type="date" value={draft.due_date} onChange={e => setDraft({ ...draft, due_date: e.target.value })} style={{ padding: '6px 8px', background: 'var(--jarvis-bg)', border: '1px solid var(--jarvis-bd)', borderRadius: 4, color: 'var(--jarvis-tx)', fontSize: 12 }} />
            <select value={draft.bid_decision} onChange={e => setDraft({ ...draft, bid_decision: e.target.value as Proposal['bid_decision'] })} style={{ padding: '6px 8px', background: 'var(--jarvis-bg)', border: '1px solid var(--jarvis-bd)', borderRadius: 4, color: 'var(--jarvis-tx)', fontSize: 12 }}>
              <option value="pending">Bid Decision: Pending</option>
              <option value="bid">Bid</option>
              <option value="no_bid">No Bid</option>
            </select>
            <input placeholder="Win probability (%)" type="number" min={0} max={100} value={draft.win_probability} onChange={e => setDraft({ ...draft, win_probability: e.target.value })} style={{ padding: '6px 8px', background: 'var(--jarvis-bg)', border: '1px solid var(--jarvis-bd)', borderRadius: 4, color: 'var(--jarvis-tx)', fontSize: 12 }} />
          </div>
          <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
            <button onClick={addProposal} style={{ padding: '6px 14px', background: 'var(--jarvis-ac)', color: '#fff', border: 'none', borderRadius: 4, fontSize: 12, cursor: 'pointer' }}>Save</button>
            <button onClick={() => setShowAdd(false)} style={{ padding: '6px 10px', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ background: 'var(--jarvis-bg2)', textAlign: 'left' }}>
            {['ID','Title','Client','Value','Status','Bid Decision','Win %','Due Date','PM'].map(h => (
              <th key={h} style={{ padding: '6px 8px', fontWeight: 600, fontSize: 11 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {displayed.map(p => (
            <tr key={p.id} style={{ borderBottom: '1px solid var(--jarvis-bd)' }}>
              <td style={{ padding: '6px 8px', color: 'var(--jarvis-ts)', fontSize: 10 }}>{p.id}</td>
              <td style={{ padding: '6px 8px', fontWeight: 600, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</td>
              <td style={{ padding: '6px 8px', color: 'var(--jarvis-ts)' }}>{p.client}</td>
              <td style={{ padding: '6px 8px', fontWeight: 600 }}>${(p.value / 1000).toFixed(0)}K</td>
              <td style={{ padding: '6px 8px' }}><StatusBadge status={p.status} /></td>
              <td style={{ padding: '6px 8px' }}>
                <span style={{ padding: '2px 8px', background: p.bid_decision === 'bid' ? 'var(--jarvis-grn,#27ae60)' : p.bid_decision === 'no_bid' ? '#555' : 'var(--jarvis-amb,#f39c12)', color: '#fff', borderRadius: 10, fontSize: 10 }}>
                  {p.bid_decision === 'no_bid' ? 'No Bid' : p.bid_decision === 'bid' ? 'Bid' : 'Pending'}
                </span>
              </td>
              <td style={{ padding: '6px 8px' }}>
                {p.win_probability !== undefined && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <div style={{ width: 40, height: 4, background: 'var(--jarvis-bd)', borderRadius: 2 }}>
                      <div style={{ width: `${p.win_probability}%`, height: '100%', background: p.win_probability >= 60 ? 'var(--jarvis-grn,#27ae60)' : 'var(--jarvis-amb,#f39c12)', borderRadius: 2 }} />
                    </div>
                    <span style={{ fontSize: 10 }}>{p.win_probability}%</span>
                  </div>
                )}
              </td>
              <td style={{ padding: '6px 8px', color: 'var(--jarvis-ts)', fontSize: 11 }}>{p.due_date}</td>
              <td style={{ padding: '6px 8px', color: 'var(--jarvis-ts)' }}>{p.pm}</td>
            </tr>
          ))}
          {displayed.length === 0 && <tr><td colSpan={9} style={{ padding: 30, textAlign: 'center', color: 'var(--jarvis-ts)' }}>No proposals found.</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

export default ProposalsView
