/**
 * Denver Engineering — ProcurementView Component
 * ─────────────────────────────────────────
 * Phase 10: Extraction of JarvisCore `fn()` — the Procurement module.
 *
 * Three tabs:
 *   Overview   — KPIs, spend by status bar, top vendors table
 *   POs        — Purchase Orders list with status/vendor filters + detail panel
 *   RFQs       — Request For Quotation pipeline + bidder analysis
 *
 * Zero dependency on JarvisCore globals.
 * All state from Zustand selectors, all mutations through createDispatch.
 */

import React, { useState, useMemo } from 'react'
import {
  useBizStore,
  selectPurchaseOrders,
  selectRFQs,
} from '../modules/biz/store'
import { createDispatch, actions, type PolicyConfig } from '../modules/biz/dispatch'
import { StatusBadge } from './StatusBadge'
import { KpiCard }     from './KpiCard'

// ─── Types ────────────────────────────────────────────────────────────────────
interface PurchaseOrder {
  id:          string
  subject?:    string
  vendor?:     string
  amount?:     number
  status?:     string
  date?:       string
  project?:    string
  description?: string
  notes?:      string
  [key: string]: unknown
}

interface RFQ {
  id:       string
  title?:   string
  scope?:   string
  status?:  string
  date?:    string
  project?: string
  po_ref?:  string
  bidders?: Bidder[]
  [key: string]: unknown
}

interface Bidder {
  name:    string
  amount:  number
  score:   number
  notes?:  string
}

type ProcurementTab = 'overview' | 'pos' | 'rfqs'

export interface ProcurementViewProps {
  policy:      PolicyConfig
  onNavigate?: (tab: string) => void
  onAudit?:    (entry: unknown) => void
  onToast?:    (msg: string, type: string) => void
}

// ─── PO stage pipeline ────────────────────────────────────────────────────────
const PO_STAGES = ['draft', 'issued', 'ordered', 'shipped', 'received', 'invoiced', 'closed']
const RFQ_STAGES = ['draft', 'issued', 'evaluation', 'awarded', 'po_issued']

// ─── Formatters ───────────────────────────────────────────────────────────────
function fmtCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}

// ─── Mini stage pipeline (display only) ──────────────────────────────────────
function StagePipeline({ stages, current }: { stages: string[]; current?: string }) {
  const activeIdx = current ? stages.indexOf(current) : -1
  return (
    <div style={{ display: 'flex', gap: 0, marginBottom: 16 }}>
      {stages.map((s, i) => {
        const isActive = s === current
        const isPast   = i < activeIdx
        const bg = isActive ? 'var(--jarvis-ac)' : isPast ? 'var(--jarvis-grn)' : 'var(--jarvis-bd)'
        const tc = isActive || isPast ? '#fff' : 'var(--jarvis-td)'
        return (
          <div key={s} style={{
            flex: 1, padding: '6px 4px', background: bg, color: tc,
            fontSize: 9, fontWeight: isActive ? 700 : 500, textAlign: 'center',
            borderRight: i < stages.length - 1 ? '1px solid rgba(0,0,0,0.12)' : 'none',
            borderRadius: i === 0 ? '6px 0 0 6px' : i === stages.length - 1 ? '0 6px 6px 0' : 0,
            textTransform: 'capitalize',
          }}>
            {s.replace('_', ' ')}
          </div>
        )
      })}
    </div>
  )
}

// ─── Field grid ───────────────────────────────────────────────────────────────
function FieldGrid({ fields }: { fields: [string, string | number | undefined | null][] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8, marginBottom: 16 }}>
      {fields.map(([label, value]) => (
        <div key={label} className="jarvis-card" style={{ padding: '8px 10px', background: 'var(--jarvis-bl)' }}>
          <div className="jarvis-muted" style={{ fontSize: 9, marginBottom: 2 }}>{label}</div>
          <div className="jarvis-body" style={{ fontWeight: 600, fontSize: 11 }}>{value ?? '—'}</div>
        </div>
      ))}
    </div>
  )
}

// ─── PO detail ────────────────────────────────────────────────────────────────
function PODetail({ po, onBack, canWrite, onDelete }: {
  po:       PurchaseOrder
  onBack:   () => void
  canWrite: boolean
  onDelete: (po: PurchaseOrder) => void
}) {
  return (
    <div>
      <div className="jarvis-header" style={{ padding: '10px 0', marginBottom: 16 }}>
        <button className="jarvis-btn jarvis-btn-ghost jarvis-btn-sm" onClick={onBack}>← All POs</button>
        <div style={{ display: 'flex', gap: 8 }}>
          <StatusBadge status={po.status ?? 'draft'} />
          {canWrite && (
            <button
              className="jarvis-btn jarvis-btn-sm"
              style={{ background: 'var(--jarvis-red)', color: '#fff', border: 'none' }}
              onClick={() => { if (confirm(`Delete PO ${po.id}?`)) onDelete(po) }}
              aria-label={`Delete PO ${po.id}`}
            >
              Delete
            </button>
          )}
        </div>
      </div>
      <h2 className="jarvis-heading" style={{ marginBottom: 4 }}>{po.id}</h2>
      <p className="jarvis-small" style={{ marginBottom: 12 }}>{po.subject}</p>
      <StagePipeline stages={PO_STAGES} current={po.status} />
      <FieldGrid fields={[
        ['Vendor',  po.vendor],
        ['Amount',  po.amount != null ? fmtCurrency(Number(po.amount)) : null],
        ['Project', po.project],
        ['Date',    po.date],
        ['Status',  po.status],
      ]} />
      {po.description && (
        <div className="jarvis-card" style={{ padding: 16, marginBottom: 12 }}>
          <h4 className="jarvis-label" style={{ marginBottom: 8 }}>Description</h4>
          <p className="jarvis-body">{po.description}</p>
        </div>
      )}
      {po.notes && (
        <div className="jarvis-card" style={{ padding: 16 }}>
          <h4 className="jarvis-label" style={{ marginBottom: 8 }}>Notes</h4>
          <p className="jarvis-body">{po.notes}</p>
        </div>
      )}
    </div>
  )
}

// ─── RFQ detail ───────────────────────────────────────────────────────────────
function RFQDetail({ rfq, onBack }: { rfq: RFQ; onBack: () => void }) {
  const bidders = rfq.bidders ?? []
  const maxScore = bidders.length ? Math.max(...bidders.map(b => b.score)) : 0

  return (
    <div>
      <div className="jarvis-header" style={{ padding: '10px 0', marginBottom: 16 }}>
        <button className="jarvis-btn jarvis-btn-ghost jarvis-btn-sm" onClick={onBack}>← All RFQs</button>
        <StatusBadge status={rfq.po_ref ? 'po_issued' : (rfq.status ?? 'draft')} />
      </div>
      <h2 className="jarvis-heading" style={{ marginBottom: 4 }}>{rfq.id} — {rfq.title}</h2>
      <p className="jarvis-small" style={{ marginBottom: 12 }}>{rfq.scope}</p>
      <StagePipeline stages={RFQ_STAGES} current={rfq.po_ref ? 'po_issued' : rfq.status} />
      <FieldGrid fields={[
        ['Project', rfq.project],
        ['Status',  rfq.status],
        ['Date',    rfq.date],
        ['PO Ref',  rfq.po_ref],
        ['Bidders', bidders.length],
      ]} />

      {bidders.length > 0 && (
        <div className="jarvis-card" style={{ padding: 16 }}>
          <h4 className="jarvis-label" style={{ marginBottom: 10 }}>Bid Analysis</h4>
          <table className="jarvis-table" aria-label="Bid analysis">
            <thead>
              <tr>
                <th>Vendor</th>
                <th style={{ textAlign: 'right' }}>Bid Amount</th>
                <th style={{ textAlign: 'right' }}>Score</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {[...bidders].sort((a, b) => b.score - a.score).map((b, i) => (
                <tr key={i} style={{ fontWeight: b.score === maxScore ? 700 : 400 }}>
                  <td>
                    {b.score === maxScore && <span style={{ color: 'var(--jarvis-grn)', marginRight: 6 }}>★</span>}
                    {b.name}
                  </td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--jarvis-font-mono)' }}>
                    {fmtCurrency(b.amount)}
                  </td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--jarvis-font-mono)', color: b.score === maxScore ? 'var(--jarvis-grn)' : 'var(--jarvis-ts)' }}>
                    {b.score}
                  </td>
                  <td className="jarvis-small">{b.notes ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── POs tab ──────────────────────────────────────────────────────────────────
function POsTab({ pos, canWrite, onSelect, onDelete }: {
  pos:      PurchaseOrder[]
  canWrite: boolean
  onSelect: (po: PurchaseOrder) => void
  onDelete: (po: PurchaseOrder) => void
}) {
  const [search,       setSearch]       = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [vendorFilter, setVendorFilter] = useState('all')

  const statuses = useMemo(() => ['all', ...new Set(pos.map(p => p.status).filter(Boolean))], [pos])
  const vendors  = useMemo(() => ['all', ...new Set(pos.map(p => p.vendor).filter(Boolean))], [pos])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return pos.filter(p => {
      if (statusFilter !== 'all' && p.status !== statusFilter) return false
      if (vendorFilter !== 'all' && p.vendor !== vendorFilter) return false
      if (q) return (p.id + p.subject + p.vendor + p.project).toLowerCase().includes(q)
      return true
    })
  }, [pos, search, statusFilter, vendorFilter])

  const totalFiltered = filtered.reduce((s, p) => s + Number(p.amount ?? 0), 0)

  if (pos.length === 0) {
    return (
      <div className="jarvis-empty" role="status">
        <span className="jarvis-empty-icon">📦</span>
        <span>No purchase orders yet</span>
      </div>
    )
  }

  return (
    <div>
      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <input
          className="jarvis-input"
          type="search"
          placeholder="Search POs…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          aria-label="Search purchase orders"
          style={{ flex: 1, minWidth: 180 }}
        />
        <select className="jarvis-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)} aria-label="Filter by status">
          {statuses.map(s => <option key={s} value={s}>{s === 'all' ? 'All Statuses' : s}</option>)}
        </select>
        <select className="jarvis-select" value={vendorFilter} onChange={e => setVendorFilter(e.target.value)} aria-label="Filter by vendor">
          {vendors.map(v => <option key={v} value={v}>{v === 'all' ? 'All Vendors' : v}</option>)}
        </select>
      </div>

      {/* Summary */}
      <div className="jarvis-row" style={{ marginBottom: 8 }}>
        <span className="jarvis-small">{filtered.length} of {pos.length} POs</span>
        <span className="jarvis-small" style={{ fontFamily: 'var(--jarvis-font-mono)', fontWeight: 700 }}>
          {fmtCurrency(totalFiltered)} filtered
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="jarvis-empty" role="status"><span>No POs match your filters</span></div>
      ) : (
        <div className="jarvis-scroll-y jarvis-max-h-lg">
          <table className="jarvis-table" aria-label="Purchase orders">
            <thead>
              <tr>
                <th>PO Number</th><th>Vendor</th><th>Subject</th>
                <th style={{ textAlign: 'right' }}>Amount</th><th>Status</th><th>Date</th>
                {canWrite && <th></th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map(po => (
                <tr key={po.id} style={{ cursor: 'pointer' }}>
                  <td onClick={() => onSelect(po)} style={{ fontWeight: 700, color: 'var(--jarvis-ac)' }}>
                    {po.id}
                  </td>
                  <td onClick={() => onSelect(po)} className="jarvis-small">{po.vendor ?? '—'}</td>
                  <td onClick={() => onSelect(po)} className="jarvis-truncate" style={{ maxWidth: 200 }}>
                    {po.subject ?? '—'}
                  </td>
                  <td
                    onClick={() => onSelect(po)}
                    style={{ textAlign: 'right', fontFamily: 'var(--jarvis-font-mono)', fontSize: 11 }}
                  >
                    {po.amount != null ? fmtCurrency(Number(po.amount)) : '—'}
                  </td>
                  <td onClick={() => onSelect(po)}><StatusBadge status={po.status ?? 'draft'} /></td>
                  <td onClick={() => onSelect(po)} className="jarvis-small">{po.date ?? '—'}</td>
                  {canWrite && (
                    <td>
                      <button
                        className="jarvis-btn jarvis-btn-sm"
                        style={{ background: 'transparent', color: 'var(--jarvis-red)', border: 'none', padding: '2px 6px' }}
                        onClick={e => { e.stopPropagation(); if (confirm(`Delete ${po.id}?`)) onDelete(po) }}
                        aria-label={`Delete PO ${po.id}`}
                      >
                        ✕
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── RFQs tab ─────────────────────────────────────────────────────────────────
function RFQsTab({ rfqs, onSelect }: { rfqs: RFQ[]; onSelect: (r: RFQ) => void }) {
  const [search,       setSearch]       = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  const statuses = useMemo(() => ['all', ...new Set(rfqs.map(r => r.status).filter(Boolean))], [rfqs])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return rfqs.filter(r => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      if (q) return (r.id + r.title + r.project + r.scope).toLowerCase().includes(q)
      return true
    })
  }, [rfqs, search, statusFilter])

  if (rfqs.length === 0) {
    return (
      <div className="jarvis-empty" role="status">
        <span className="jarvis-empty-icon">📋</span>
        <span>No RFQs yet</span>
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          className="jarvis-input"
          type="search"
          placeholder="Search RFQs…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          aria-label="Search RFQs"
          style={{ flex: 1 }}
        />
        <select className="jarvis-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)} aria-label="Filter RFQs by status">
          {statuses.map(s => <option key={s} value={s}>{s === 'all' ? 'All Statuses' : s}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="jarvis-empty" role="status"><span>No RFQs match</span></div>
      ) : (
        <div className="jarvis-scroll-y jarvis-max-h-lg">
          <table className="jarvis-table" aria-label="Request for quotations">
            <thead>
              <tr>
                <th>RFQ ID</th><th>Title</th><th>Project</th>
                <th style={{ textAlign: 'right' }}>Bidders</th><th>Status</th><th>PO Ref</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(rfq => (
                <tr key={rfq.id} onClick={() => onSelect(rfq)} style={{ cursor: 'pointer' }}>
                  <td style={{ fontWeight: 700, color: 'var(--jarvis-ac)' }}>{rfq.id}</td>
                  <td className="jarvis-truncate" style={{ maxWidth: 200 }}>{rfq.title ?? '—'}</td>
                  <td className="jarvis-small">{rfq.project ?? '—'}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--jarvis-font-mono)' }}>
                    {rfq.bidders?.length ?? 0}
                  </td>
                  <td><StatusBadge status={rfq.po_ref ? 'po_issued' : (rfq.status ?? 'draft')} /></td>
                  <td className="jarvis-small">{rfq.po_ref ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Overview tab ─────────────────────────────────────────────────────────────
function OverviewTab({ pos, rfqs }: { pos: PurchaseOrder[]; rfqs: RFQ[] }) {
  const totalSpend   = pos.reduce((s, p) => s + Number(p.amount ?? 0), 0)
  const openPOs      = pos.filter(p => !['closed', 'invoiced'].includes(p.status ?? ''))
  const awardedRFQs  = rfqs.filter(r => r.po_ref || r.status === 'awarded')
  const openRFQs     = rfqs.filter(r => !r.po_ref && r.status !== 'awarded')

  // Spend by status breakdown
  const spendByStatus = useMemo(() => {
    const map: Record<string, number> = {}
    pos.forEach(p => {
      const s = p.status ?? 'draft'
      map[s] = (map[s] ?? 0) + Number(p.amount ?? 0)
    })
    return Object.entries(map).sort((a, b) => b[1] - a[1])
  }, [pos])

  // Top vendors
  const topVendors = useMemo(() => {
    const map: Record<string, number> = {}
    pos.forEach(p => {
      const v = p.vendor ?? 'Unknown'
      map[v] = (map[v] ?? 0) + Number(p.amount ?? 0)
    })
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 5)
  }, [pos])

  const statusColors: Record<string, string> = {
    draft:    'var(--jarvis-td)',
    issued:   'var(--jarvis-blue)',
    ordered:  'var(--jarvis-pur)',
    shipped:  'var(--jarvis-amb)',
    received: 'var(--jarvis-cyn)',
    invoiced: 'var(--jarvis-org)',
    closed:   'var(--jarvis-grn)',
  }

  return (
    <div>
      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginBottom: 16 }}>
        <KpiCard label="Total POs"     value={pos.length}         sub={`${openPOs.length} open`} />
        <KpiCard label="Total Spend"   value={fmtCurrency(totalSpend)} color="var(--jarvis-blue)" />
        <KpiCard label="Open RFQs"     value={openRFQs.length}    sub={`${awardedRFQs.length} awarded`} color="var(--jarvis-amb)" />
        <KpiCard label="Avg PO Value"  value={pos.length ? fmtCurrency(totalSpend / pos.length) : '—'} color="var(--jarvis-ts)" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {/* Spend by status */}
        <div className="jarvis-card" style={{ padding: 16 }}>
          <h4 className="jarvis-label" style={{ marginBottom: 12 }}>Spend by Status</h4>
          {spendByStatus.length === 0 ? (
            <p className="jarvis-muted" style={{ fontStyle: 'italic' }}>No data</p>
          ) : spendByStatus.map(([status, amount]) => {
            const pct = totalSpend > 0 ? (amount / totalSpend) * 100 : 0
            return (
              <div key={status} style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <span className="jarvis-small" style={{ textTransform: 'capitalize' }}>{status}</span>
                  <span className="jarvis-small" style={{ fontFamily: 'var(--jarvis-font-mono)', fontWeight: 700 }}>
                    {fmtCurrency(amount)}
                  </span>
                </div>
                <div style={{ background: 'var(--jarvis-bl)', borderRadius: 4, height: 6 }}>
                  <div style={{
                    width: `${pct}%`, height: '100%', borderRadius: 4,
                    background: statusColors[status] ?? 'var(--jarvis-ts)',
                    minWidth: pct > 0 ? 3 : 0,
                  }} />
                </div>
              </div>
            )
          })}
        </div>

        {/* Top vendors */}
        <div className="jarvis-card" style={{ padding: 16 }}>
          <h4 className="jarvis-label" style={{ marginBottom: 12 }}>Top Vendors by Spend</h4>
          {topVendors.length === 0 ? (
            <p className="jarvis-muted" style={{ fontStyle: 'italic' }}>No vendor data</p>
          ) : topVendors.map(([vendor, amount], i) => (
            <div key={vendor} className="jarvis-row" style={{ borderBottom: i < topVendors.length - 1 ? '1px solid var(--jarvis-bd)' : 'none' }}>
              <span className="jarvis-body" style={{ fontWeight: 600, flex: 1 }}>
                <span className="jarvis-muted" style={{ marginRight: 8 }}>#{i + 1}</span>
                {vendor}
              </span>
              <span style={{ fontFamily: 'var(--jarvis-font-mono)', fontSize: 11, fontWeight: 700 }}>
                {fmtCurrency(amount)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── ProcurementView (main export) ───────────────────────────────────────────
export function ProcurementView({ policy, onNavigate: _onNavigate, onAudit, onToast }: ProcurementViewProps) {
  const allPOs  = useBizStore(selectPurchaseOrders) as PurchaseOrder[]
  const allRFQs = useBizStore(selectRFQs) as RFQ[]

  const [activeTab,   setActiveTab]   = useState<ProcurementTab>('overview')
  const [selectedPO,  setSelectedPO]  = useState<PurchaseOrder | null>(null)
  const [selectedRFQ, setSelectedRFQ] = useState<RFQ | null>(null)

  const { dispatch } = useMemo(() => createDispatch({
    policy,
    audit: onAudit ? (e) => onAudit(e) : undefined,
    toast: onToast ? (m, t) => onToast(m, t) : undefined,
  }), [policy, onAudit, onToast])

  const canWrite = policy.writesEnabled && policy.activeRole !== 'viewer'

  const handleDeletePO = (po: PurchaseOrder) => {
    dispatch(actions.deletePO(po.id))
    setSelectedPO(null)
  }

  const tabCounts: Partial<Record<ProcurementTab, number>> = {
    pos:  allPOs.filter(p => !['closed', 'invoiced'].includes(p.status ?? '')).length,
    rfqs: allRFQs.filter(r => !r.po_ref && r.status !== 'awarded').length,
  }

  // ── Detail routing ────────────────────────────────────────────────────────────
  if (selectedPO) {
    return (
      <PODetail
        po={selectedPO}
        onBack={() => setSelectedPO(null)}
        canWrite={canWrite}
        onDelete={handleDeletePO}
      />
    )
  }
  if (selectedRFQ) {
    return <RFQDetail rfq={selectedRFQ} onBack={() => setSelectedRFQ(null)} />
  }

  const TABS = [
    { id: 'overview' as ProcurementTab, label: 'Overview',  icon: '📊' },
    { id: 'pos'      as ProcurementTab, label: 'POs',       icon: '📦' },
    { id: 'rfqs'     as ProcurementTab, label: 'RFQs',      icon: '📋' },
  ]

  return (
    <div role="main" aria-label="Procurement">
      {/* Tab bar */}
      <div role="tablist" aria-label="Procurement sections" style={{
        display: 'flex', gap: 4, marginBottom: 16,
        borderBottom: '1px solid var(--jarvis-bd)', paddingBottom: 0,
      }}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '8px 14px 10px',
              background: 'transparent', border: 'none',
              borderBottom: activeTab === tab.id ? '2px solid var(--jarvis-ac)' : '2px solid transparent',
              color:        activeTab === tab.id ? 'var(--jarvis-tx)' : 'var(--jarvis-ts)',
              fontWeight:   activeTab === tab.id ? 700 : 500,
              fontSize: 12, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
              transition: 'color 0.15s ease, border-color 0.15s ease',
            }}
          >
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
            {(tabCounts[tab.id] ?? 0) > 0 && (
              <span style={{ background: 'var(--jarvis-ac)', color: '#fff', borderRadius: 99, padding: '1px 6px', fontSize: 9, fontWeight: 700 }}>
                {tabCounts[tab.id]}
              </span>
            )}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && <OverviewTab pos={allPOs} rfqs={allRFQs} />}
      {activeTab === 'pos'      && (
        <POsTab
          pos={allPOs}
          canWrite={canWrite}
          onSelect={setSelectedPO}
          onDelete={handleDeletePO}
        />
      )}
      {activeTab === 'rfqs' && <RFQsTab rfqs={allRFQs} onSelect={setSelectedRFQ} />}
    </div>
  )
}

export default ProcurementView
