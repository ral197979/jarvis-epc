/**
 * Denver Engineering — CRMLeads Component
 * ─────────────────────────────────
 * Phase 8: Second full view extracted from JarvisCore.jsx (function `ln`).
 *
 * Provides the full CRM leads experience:
 *   - Pipeline overview KPIs (pipeline value, weighted value, win rate)
 *   - Pipeline stage funnel visualization (bar chart)
 *   - Searchable, sortable leads table
 *   - Lead detail panel with stage tracker, KPIs, linked contract
 *   - Inline status transition via typed dispatch
 *
 * Zero dependency on JarvisCore globals.
 * All state from Zustand selectors, all mutations through createDispatch.
 */

import React, { useState, useMemo, useCallback } from 'react'
import { useBizStore, selectLeads, selectContracts } from '../modules/biz/store'
import { createDispatch, actions, type PolicyConfig } from '../modules/biz/dispatch'
import { StatusBadge } from './StatusBadge'
import { KpiCard }     from './KpiCard'

// ─── Types ────────────────────────────────────────────────────────────────────
interface Lead {
  id:              string
  name:            string
  status:          'new' | 'qualified' | 'proposal' | 'negotiation' | 'won' | 'lost' | string
  estimated_value: number
  probability:     number
  contact?:        string
  source?:         string
  service?:        string
  notes?:          string
  [key: string]:   unknown
}

interface Contract {
  id:      string
  project: string
  status:  string
  [key: string]: unknown
}

export interface CRMLeadsProps {
  policy:      PolicyConfig
  onNavigate?: (tab: string) => void
  onAudit?:    (entry: unknown) => void
  onToast?:    (msg: string, type: string) => void
}

// ─── Constants ────────────────────────────────────────────────────────────────
const STAGES = ['new', 'qualified', 'proposal', 'negotiation', 'won'] as const
type Stage = typeof STAGES[number]

const STAGE_LABELS: Record<Stage | string, string> = {
  new:         'New',
  qualified:   'Qualified',
  proposal:    'Proposal',
  negotiation: 'Negotiation',
  won:         'Won',
  lost:        'Lost',
}

const STAGE_COLORS: Record<Stage | string, string> = {
  new:         'var(--jarvis-blue)',
  qualified:   'var(--jarvis-blue)',
  proposal:    'var(--jarvis-amb)',
  negotiation: 'var(--jarvis-pur)',
  won:         'var(--jarvis-grn)',
  lost:        'var(--jarvis-red)',
}

// ─── Formatters ───────────────────────────────────────────────────────────────
function fmtCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}

function pct(n: number): string {
  return `${Math.round(n)}%`
}

// ─── Stage tracker ────────────────────────────────────────────────────────────
function StagePipeline({ current, onStageClick, canWrite }: {
  current:       string
  onStageClick?: (stage: string) => void
  canWrite:      boolean
}) {
  const activeIdx = STAGES.indexOf(current as Stage)
  return (
    <div style={{ display: 'flex', gap: 0, marginBottom: 16 }}>
      {STAGES.map((stage, idx) => {
        const isActive  = stage === current
        const isPast    = idx < activeIdx
        const color     = isActive ? STAGE_COLORS[stage] : isPast ? 'var(--jarvis-grn)' : 'var(--jarvis-bd)'
        const textColor = isActive || isPast ? '#fff' : 'var(--jarvis-td)'
        return (
          <button
            key={stage}
            onClick={canWrite ? () => onStageClick?.(stage) : undefined}
            disabled={!canWrite}
            aria-pressed={isActive}
            aria-label={`Set stage to ${STAGE_LABELS[stage]}`}
            style={{
              flex:         1,
              padding:      '8px 4px',
              background:   color,
              color:        textColor,
              border:       'none',
              borderRight:  idx < STAGES.length - 1 ? '1px solid rgba(0,0,0,0.15)' : 'none',
              borderRadius: idx === 0 ? '6px 0 0 6px' : idx === STAGES.length - 1 ? '0 6px 6px 0' : '0',
              fontSize:     10,
              fontWeight:   isActive ? 700 : 500,
              cursor:       canWrite ? 'pointer' : 'default',
              textAlign:    'center',
              transition:   'background 0.15s ease',
            }}
          >
            {STAGE_LABELS[stage]}
          </button>
        )
      })}
    </div>
  )
}

// ─── Pipeline bar chart ───────────────────────────────────────────────────────
function PipelineFunnel({ leads }: { leads: Lead[] }) {
  const data = STAGES.map(stage => ({
    stage,
    label: STAGE_LABELS[stage],
    count: leads.filter(l => l.status === stage).length,
    value: leads.filter(l => l.status === stage).reduce((s, l) => s + (l.estimated_value ?? 0), 0),
    color: STAGE_COLORS[stage],
  })).filter(d => d.count > 0 && d.value > 0)

  if (data.length === 0) return null

  const maxValue = Math.max(...data.map(d => d.value), 1)

  return (
    <div className="jarvis-card" style={{ marginBottom: 16, padding: '12px 16px' }}>
      <h4 className="jarvis-label" style={{ marginBottom: 12 }}>Pipeline Funnel</h4>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {data.map(d => (
          <div key={d.stage} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 72, fontSize: 10, color: 'var(--jarvis-ts)', flexShrink: 0 }}>
              {d.label}
            </span>
            <div style={{ flex: 1, background: 'var(--jarvis-bl)', borderRadius: 3, height: 16, overflow: 'hidden' }}>
              <div style={{
                width:        `${(d.value / maxValue) * 100}%`,
                height:       '100%',
                background:   d.color,
                borderRadius: 3,
                minWidth:     4,
                transition:   'width 0.3s ease',
              }} />
            </div>
            <span style={{ width: 56, fontSize: 10, fontFamily: 'var(--jarvis-font-mono)', color: d.color, textAlign: 'right', flexShrink: 0 }}>
              {fmtCurrency(d.value)}
            </span>
            <span style={{ width: 24, fontSize: 10, color: 'var(--jarvis-td)', textAlign: 'right', flexShrink: 0 }}>
              {d.count}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Lead detail panel ────────────────────────────────────────────────────────
function LeadDetail({ lead, contract, canWrite, onBack, onStageChange }: {
  lead:          Lead
  contract?:     Contract | null
  canWrite:      boolean
  onBack:        () => void
  onStageChange: (stage: string) => void
}) {
  const weighted = (lead.estimated_value ?? 0) * (lead.probability ?? 0) / 100

  return (
    <div>
      {/* Back nav */}
      <div className="jarvis-header" style={{ marginBottom: 16, padding: '10px 0' }}>
        <button className="jarvis-btn jarvis-btn-ghost jarvis-btn-sm" onClick={onBack}>
          ← All Leads
        </button>
        <StatusBadge status={lead.status} />
      </div>

      <h2 className="jarvis-heading" style={{ marginBottom: 4 }}>{lead.name}</h2>
      <p className="jarvis-small" style={{ marginBottom: 16 }}>{lead.id}</p>

      {/* Stage pipeline */}
      <StagePipeline current={lead.status} onStageClick={onStageChange} canWrite={canWrite} />

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 16 }}>
        <KpiCard label="Est. Value"   value={fmtCurrency(lead.estimated_value ?? 0)} color="var(--jarvis-blue)" />
        <KpiCard label="Probability"  value={pct(lead.probability ?? 0)}
          color={(lead.probability ?? 0) >= 70 ? 'var(--jarvis-grn)' : (lead.probability ?? 0) >= 40 ? 'var(--jarvis-amb)' : 'var(--jarvis-red)'} />
        <KpiCard label="Weighted"     value={fmtCurrency(weighted)} color="var(--jarvis-pur)" />
        <KpiCard label="Status"       value={lead.status}
          color={lead.status === 'won' ? 'var(--jarvis-grn)' : lead.status === 'lost' ? 'var(--jarvis-red)' : 'var(--jarvis-amb)'} />
      </div>

      {/* Detail grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        {/* Lead details */}
        <div className="jarvis-card" style={{ padding: 16 }}>
          <h4 className="jarvis-label" style={{ marginBottom: 10 }}>Lead Details</h4>
          {[
            ['Contact', lead.contact],
            ['Source',  lead.source],
            ['Service', lead.service],
          ].map(([label, value], i, arr) => (
            <div key={label} className="jarvis-row" style={{ borderBottom: i < arr.length - 1 ? undefined : 'none' }}>
              <span className="jarvis-small">{label}</span>
              <span className="jarvis-body" style={{ fontWeight: 600 }}>{value ?? '—'}</span>
            </div>
          ))}
        </div>

        {/* Linked contract */}
        {contract ? (
          <div className="jarvis-card" style={{ padding: 16 }}>
            <h4 className="jarvis-label" style={{ marginBottom: 10 }}>Linked Contract</h4>
            <div className="jarvis-row">
              <span className="jarvis-small">Contract</span>
              <span className="jarvis-body" style={{ fontWeight: 600 }}>{contract.id}</span>
            </div>
            <div className="jarvis-row" style={{ borderBottom: 'none' }}>
              <span className="jarvis-small">Status</span>
              <StatusBadge status={contract.status} />
            </div>
          </div>
        ) : (
          <div className="jarvis-card jarvis-empty" style={{ padding: 16, minHeight: 80 }}>
            <span className="jarvis-empty-icon">📋</span>
            <span className="jarvis-muted">No linked contract</span>
          </div>
        )}
      </div>

      {/* Notes */}
      {lead.notes && (
        <div className="jarvis-card" style={{ padding: 16, marginBottom: 16 }}>
          <h4 className="jarvis-label" style={{ marginBottom: 8 }}>Notes</h4>
          <p className="jarvis-body">{lead.notes}</p>
        </div>
      )}
    </div>
  )
}

// ─── Leads table ──────────────────────────────────────────────────────────────
type SortKey = 'name' | 'estimated_value' | 'probability' | 'status'

function LeadsTable({ leads, onSelect }: {
  leads:    Lead[]
  onSelect: (lead: Lead) => void
}) {
  const [sort, setSort]   = useState<SortKey>('estimated_value')
  const [asc,  setAscDir] = useState(false)

  const sorted = useMemo(() => {
    return [...leads].sort((a, b) => {
      const av = a[sort] ?? ''
      const bv = b[sort] ?? ''
      const cmp = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv))
      return asc ? cmp : -cmp
    })
  }, [leads, sort, asc])

  const toggleSort = (key: SortKey) => {
    if (sort === key) setAscDir(d => !d)
    else { setSort(key); setAscDir(false) }
  }

  const th = (key: SortKey, label: string) => (
    <th
      onClick={() => toggleSort(key)}
      style={{ cursor: 'pointer', userSelect: 'none' }}
      aria-sort={sort === key ? (asc ? 'ascending' : 'descending') : 'none'}
    >
      {label} {sort === key ? (asc ? '↑' : '↓') : ''}
    </th>
  )

  if (leads.length === 0) {
    return (
      <div className="jarvis-empty" role="status">
        <span className="jarvis-empty-icon">🔍</span>
        <span>No leads match your search</span>
      </div>
    )
  }

  return (
    <div className="jarvis-scroll-y jarvis-max-h-lg">
      <table className="jarvis-table" aria-label="Leads list">
        <thead>
          <tr>
            {th('name',            'Lead Name')}
            {th('status',          'Stage')}
            {th('estimated_value', 'Est. Value')}
            {th('probability',     'Prob.')}
            <th>Weighted</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(lead => {
            const weighted = (lead.estimated_value ?? 0) * (lead.probability ?? 0) / 100
            return (
              <tr
                key={lead.id}
                onClick={() => onSelect(lead)}
                style={{ cursor: 'pointer' }}
              >
                <td>
                  <span style={{ fontWeight: 600 }}>{lead.name}</span>
                  {lead.contact && (
                    <span className="jarvis-small" style={{ display: 'block' }}>{lead.contact}</span>
                  )}
                </td>
                <td><StatusBadge status={lead.status} /></td>
                <td className="jarvis-text-mono">{fmtCurrency(lead.estimated_value ?? 0)}</td>
                <td>
                  <span style={{
                    color: (lead.probability ?? 0) >= 70 ? 'var(--jarvis-grn)'
                         : (lead.probability ?? 0) >= 40 ? 'var(--jarvis-amb)'
                         : 'var(--jarvis-red)',
                    fontFamily: 'var(--jarvis-font-mono)',
                    fontWeight: 700,
                  }}>
                    {pct(lead.probability ?? 0)}
                  </span>
                </td>
                <td className="jarvis-text-mono jarvis-text-muted">{fmtCurrency(weighted)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── CRMLeads (main export) ───────────────────────────────────────────────────
export function CRMLeads({ policy, onNavigate, onAudit, onToast }: CRMLeadsProps) {
  const rawLeads     = useBizStore(selectLeads)    as Lead[]
  const rawContracts = useBizStore(selectContracts) as Contract[]

  const [selected, setSelected] = useState<Lead | null>(null)
  const [search,   setSearch]   = useState('')

  const { dispatch } = useMemo(() => createDispatch({
    policy,
    audit:    onAudit ? (e) => onAudit(e) : undefined,
    toast:    onToast ? (m, t) => onToast(m, t) : undefined,
  }), [policy, onAudit, onToast])

  // ── Derived ──────────────────────────────────────────────────────────────────
  const filteredLeads = useMemo(() => {
    const q = search.toLowerCase()
    if (!q) return rawLeads
    return rawLeads.filter(l =>
      l.name?.toLowerCase().includes(q)
      || l.contact?.toLowerCase().includes(q)
      || l.service?.toLowerCase().includes(q)
      || l.status?.toLowerCase().includes(q)
    )
  }, [rawLeads, search])

  const pipelineValue  = rawLeads.reduce((s, l) => s + (l.estimated_value ?? 0), 0)
  const weightedValue  = rawLeads.reduce((s, l) => s + (l.estimated_value ?? 0) * (l.probability ?? 0) / 100, 0)
  const wonLeads       = rawLeads.filter(l => l.status === 'won')
  const winRate        = rawLeads.length > 0 ? wonLeads.length / rawLeads.length * 100 : 0
  const activeLeads    = rawLeads.filter(l => l.status !== 'lost' && l.status !== 'won')

  // ── Handlers ─────────────────────────────────────────────────────────────────
  const handleStageChange = useCallback((stage: string) => {
    if (!selected) return
    dispatch(actions.updateLead({ id: selected.id, status: stage }))
    setSelected(prev => prev ? { ...prev, status: stage } : null)
    onToast?.(`Lead moved to ${STAGE_LABELS[stage]}`, 'success')
  }, [selected, dispatch, onToast])

  const handleSelect = useCallback((lead: Lead) => {
    setSelected(lead)
  }, [])

  const linkedContract = useMemo(() => {
    if (!selected) return null
    return rawContracts.find(c =>
      selected.name && c.project && selected.name.includes(c.project)
    ) ?? null
  }, [selected, rawContracts])

  // ── Empty state ───────────────────────────────────────────────────────────────
  if (rawLeads.length === 0) {
    return (
      <div className="jarvis-empty" style={{ marginTop: 48 }}>
        <span className="jarvis-empty-icon">🎯</span>
        <h3 className="jarvis-heading">No leads yet</h3>
        <p className="jarvis-muted">Try asking the AI assistant: "Add a lead for Embassy X, $200K, 60%"</p>
      </div>
    )
  }

  // ── Detail view ───────────────────────────────────────────────────────────────
  if (selected) {
    return (
      <LeadDetail
        lead={selected}
        contract={linkedContract}
        canWrite={policy.writesEnabled && policy.activeRole !== 'viewer'}
        onBack={() => setSelected(null)}
        onStageChange={handleStageChange}
      />
    )
  }

  // ── List view ─────────────────────────────────────────────────────────────────
  return (
    <div role="main" aria-label="CRM Leads">

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 10, marginBottom: 16 }}>
        <KpiCard label="Total Leads"  value={rawLeads.length}         sub={`${activeLeads.length} active`} />
        <KpiCard label="Pipeline"     value={fmtCurrency(pipelineValue)}
          sub={`${rawLeads.length} leads`} color="var(--jarvis-blue)" />
        <KpiCard label="Weighted"     value={fmtCurrency(weightedValue)}
          sub="probability-adjusted" color="var(--jarvis-pur)" />
        <KpiCard label="Win Rate"     value={pct(winRate)}
          sub={`${wonLeads.length} won`}
          color={winRate >= 50 ? 'var(--jarvis-grn)' : winRate >= 25 ? 'var(--jarvis-amb)' : 'var(--jarvis-red)'} />
      </div>

      {/* Funnel */}
      <PipelineFunnel leads={rawLeads} />

      {/* Search */}
      <div style={{ marginBottom: 12 }}>
        <input
          className="jarvis-input"
          type="search"
          placeholder="Search leads by name, contact, service…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          aria-label="Search leads"
        />
      </div>

      {/* Table */}
      <LeadsTable leads={filteredLeads} onSelect={handleSelect} />

    </div>
  )
}

export default CRMLeads
