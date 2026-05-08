/**
 * JARVIS EPC — ActionItemsView Component
 * ────────────────────────────────────────
 * Phase 11: Extraction of JarvisCore `Cn()` — the Action Items register.
 *
 * Features:
 *   - 5-KPI strip (Total / Open / High-Priority / Overdue / Resolved)
 *   - Multi-filter: status × priority × project × assignee × category
 *   - Split view: Open items table + Resolved items table
 *   - Item detail: 6-stage pipeline + field grid + notes
 *   - Priority badges with colour coding (high → red, med → amber, low → muted)
 *   - Policy-gated add button
 *
 * Zero dependency on JarvisCore globals.
 */

import React, { useState, useMemo } from 'react'
import {
  useBizStore,
  selectActionItems,
} from '../modules/biz/store'
import { createDispatch, type PolicyConfig } from '../modules/biz/dispatch'
import { StatusBadge } from './StatusBadge'
import { KpiCard }     from './KpiCard'

// ─── Types ─────────────────────────────────────────────────────────────────────
interface ActionItem {
  id:          string
  subject?:    string
  project?:    string
  priority?:   string
  assigned?:   string
  due?:        string
  category?:   string
  status?:     string
  notes?:      string
  ref_id?:     string
  created?:    string
  created_by?: string
  [key: string]: unknown
}

export interface ActionItemsViewProps {
  policy:      PolicyConfig
  onNavigate?: (tab: string) => void
  onAudit?:    (entry: unknown) => void
  onToast?:    (msg: string, type: string) => void
}

// ─── Constants ─────────────────────────────────────────────────────────────────
const STAGES = [
  { id: 'open',        l: 'Open' },
  { id: 'assigned',    l: 'Assigned' },
  { id: 'in-progress', l: 'In Progress' },
  { id: 'resolved',    l: 'Complete' },
  { id: 'verified',    l: 'Verified' },
]

const PRIORITY_COLOR: Record<string, string> = {
  high:   'var(--jarvis-red)',
  medium: 'var(--jarvis-amb)',
  med:    'var(--jarvis-amb)',
  low:    'var(--jarvis-ts)',
}

// ─── Sub-components ─────────────────────────────────────────────────────────────
function StagePipeline({ current }: { current?: string }) {
  const activeIdx = current ? STAGES.findIndex(s => s.id === current) : -1
  return (
    <div style={{ display: 'flex', gap: 0, marginBottom: 16 }}>
      {STAGES.map((s, i) => {
        const isActive = s.id === current
        const isPast   = i < activeIdx
        const bg = isActive ? 'var(--jarvis-ac)' : isPast ? 'var(--jarvis-grn)' : 'var(--jarvis-bd)'
        const tc = (isActive || isPast) ? '#fff' : 'var(--jarvis-td)'
        return (
          <div key={s.id} style={{
            flex: 1, padding: '6px 4px', background: bg, color: tc,
            fontSize: 9, fontWeight: isActive ? 700 : 500,
            textAlign: 'center',
            borderRight: i < STAGES.length - 1 ? '1px solid rgba(0,0,0,0.12)' : 'none',
            borderRadius: i === 0 ? '6px 0 0 6px' : i === STAGES.length - 1 ? '0 6px 6px 0' : 0,
          }}>
            {s.l}
          </div>
        )
      })}
    </div>
  )
}

function PriorityBadge({ priority }: { priority?: string }) {
  const key   = (priority ?? 'low').toLowerCase()
  const color = PRIORITY_COLOR[key] ?? 'var(--jarvis-ts)'
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, textTransform: 'uppercase',
      color, background: `color-mix(in srgb, ${color} 12%, transparent)`,
      padding: '2px 6px', borderRadius: 4,
    }}>
      {priority ?? 'low'}
    </span>
  )
}

function FieldGrid({ fields }: { fields: [string, string | undefined | null][] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8, marginBottom: 16 }}>
      {fields.map(([label, value]) => (
        <div key={label} className="jarvis-card" style={{ padding: '8px 10px', background: 'var(--jarvis-bl)' }}>
          <div className="jarvis-muted" style={{ fontSize: 9, marginBottom: 2 }}>{label}</div>
          <div className="jarvis-body" style={{ fontWeight: 600, fontSize: 11 }}>{value ?? '—'}</div>
        </div>
      ))}
    </div>
  )
}

// ─── Detail view ───────────────────────────────────────────────────────────────
function ItemDetail({ item, onBack }: { item: ActionItem; onBack: () => void }) {
  return (
    <div>
      <div className="jarvis-header" style={{ padding: '10px 0', marginBottom: 16 }}>
        <button className="jarvis-btn jarvis-btn-ghost jarvis-btn-sm" onClick={onBack}>
          ← All Actions
        </button>
        <StatusBadge status={item.status ?? 'open'} />
      </div>
      <h2 className="jarvis-heading" style={{ marginBottom: 4 }}>{item.id} — {item.subject}</h2>
      <p className="jarvis-small" style={{ marginBottom: 12 }}>
        {item.project} · {item.category}
      </p>
      <StagePipeline current={item.status} />
      <FieldGrid fields={[
        ['Priority',   item.priority],
        ['Assigned',   item.assigned],
        ['Due',        item.due],
        ['Category',   item.category],
        ['Reference',  item.ref_id],
        ['Created',    item.created],
        ['Created By', item.created_by],
        ['Status',     item.status],
      ]} />
      {item.notes && (
        <div className="jarvis-card" style={{ padding: 14 }}>
          <div className="jarvis-muted" style={{ fontSize: 9, marginBottom: 4 }}>Notes</div>
          <p className="jarvis-body" style={{ lineHeight: 1.5 }}>{item.notes}</p>
        </div>
      )}
    </div>
  )
}

// ─── Items table ───────────────────────────────────────────────────────────────
function ItemsTable({
  items,
  label,
  onSelect,
}: {
  items:    ActionItem[]
  label:    string
  onSelect: (item: ActionItem) => void
}) {
  if (items.length === 0) return null
  return (
    <div className="jarvis-card" style={{ marginBottom: 12 }}>
      <div className="jarvis-label" style={{ padding: '10px 14px 0' }}>
        {label} <span style={{ color: 'var(--jarvis-ts)', fontWeight: 400 }}>({items.length})</span>
      </div>
      <div className="jarvis-scroll-y" style={{ maxHeight: 300 }}>
        <table className="jarvis-table" aria-label={`${label} action items`}>
          <thead>
            <tr>
              <th>ID</th><th>Subject</th><th>Project</th>
              <th>Priority</th><th>Assigned</th><th>Due</th>
              <th>Category</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map(item => (
              <tr key={item.id} onClick={() => onSelect(item)} style={{ cursor: 'pointer' }}>
                <td style={{ fontWeight: 700, color: 'var(--jarvis-ac)', fontFamily: 'var(--jarvis-font-mono)', fontSize: 10 }}>
                  {item.id}
                </td>
                <td className="jarvis-truncate" style={{ maxWidth: 200 }}>{item.subject ?? '—'}</td>
                <td className="jarvis-small">{item.project ?? '—'}</td>
                <td><PriorityBadge priority={item.priority} /></td>
                <td className="jarvis-small">{item.assigned ?? '—'}</td>
                <td className="jarvis-small">{item.due ?? '—'}</td>
                <td className="jarvis-small">{item.category ?? '—'}</td>
                <td><StatusBadge status={item.status ?? 'open'} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── ActionItemsView ──────────────────────────────────────────────────────────
export function ActionItemsView({ policy, onNavigate, onAudit, onToast }: ActionItemsViewProps) {
  const allItems = useBizStore(selectActionItems) as ActionItem[]

  const [statusFilter,   setStatusFilter]   = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [projectFilter,  setProjectFilter]  = useState('all')
  const [assigneeFilter, setAssigneeFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [search,         setSearch]         = useState('')
  const [selected,       setSelected]       = useState<ActionItem | null>(null)

  const canWrite = policy.writesEnabled && policy.activeRole !== 'viewer'

  const statuses   = useMemo(() => ['all', ...new Set(allItems.map(i => i.status).filter(Boolean)   as string[])], [allItems])
  const priorities = useMemo(() => ['all', ...new Set(allItems.map(i => i.priority).filter(Boolean) as string[])], [allItems])
  const projects   = useMemo(() => ['all', ...new Set(allItems.map(i => i.project).filter(Boolean)  as string[])], [allItems])
  const assignees  = useMemo(() => ['all', ...new Set(allItems.map(i => i.assigned).filter(Boolean) as string[])], [allItems])
  const categories = useMemo(() => ['all', ...new Set(allItems.map(i => i.category).filter(Boolean) as string[])], [allItems])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return allItems.filter(item => {
      if (statusFilter   !== 'all' && item.status   !== statusFilter)   return false
      if (priorityFilter !== 'all' && item.priority !== priorityFilter) return false
      if (projectFilter  !== 'all' && item.project  !== projectFilter)  return false
      if (assigneeFilter !== 'all' && item.assigned !== assigneeFilter) return false
      if (categoryFilter !== 'all' && item.category !== categoryFilter) return false
      if (q) return (item.id + item.subject + item.project + item.assigned + item.category)
        .toLowerCase().includes(q)
      return true
    })
  }, [allItems, statusFilter, priorityFilter, projectFilter, assigneeFilter, categoryFilter, search])

  const openItems     = filtered.filter(i => i.status !== 'resolved' && i.status !== 'verified')
  const resolvedItems = filtered.filter(i => i.status === 'resolved' || i.status === 'verified')

  const today       = new Date().toISOString().slice(0, 10)
  const kpiOpen     = allItems.filter(i => i.status === 'open').length
  const kpiHigh     = allItems.filter(i => (i.priority === 'high') && i.status === 'open').length
  const kpiOverdue  = allItems.filter(i => i.status === 'open' && i.due && i.due < today).length
  const kpiResolved = allItems.filter(i => i.status === 'resolved' || i.status === 'verified').length

  if (selected) {
    return <ItemDetail item={selected} onBack={() => setSelected(null)} />
  }

  if (allItems.length === 0) {
    return (
      <div className="jarvis-empty" role="status">
        <span className="jarvis-empty-icon">✅</span>
        <h3 className="jarvis-heading">No action items</h3>
        <p className="jarvis-muted">Action items created across all modules appear here</p>
      </div>
    )
  }

  return (
    <div role="main" aria-label="Action Items">
      {/* KPI strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 10, marginBottom: 16 }}>
        <KpiCard label="Total"         value={allItems.length} />
        <KpiCard label="Open"          value={kpiOpen}     color="var(--jarvis-blue)" />
        <KpiCard label="High Priority" value={kpiHigh}     color="var(--jarvis-red)" />
        <KpiCard label="Overdue"       value={kpiOverdue}  color={kpiOverdue > 0 ? 'var(--jarvis-red)' : 'var(--jarvis-ts)'} />
        <KpiCard label="Resolved"      value={kpiResolved} color="var(--jarvis-grn)" />
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        <input
          className="jarvis-input"
          type="search"
          placeholder="Search action items…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          aria-label="Search action items"
          style={{ flex: 1, minWidth: 180 }}
        />
        <select className="jarvis-select" value={statusFilter}   onChange={e => setStatusFilter(e.target.value)}   aria-label="Filter by status">
          {statuses.map(s   => <option key={s} value={s}>{s === 'all' ? 'All Statuses'   : s}</option>)}
        </select>
        <select className="jarvis-select" value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)} aria-label="Filter by priority">
          {priorities.map(p => <option key={p} value={p}>{p === 'all' ? 'All Priorities' : p}</option>)}
        </select>
        <select className="jarvis-select" value={projectFilter}  onChange={e => setProjectFilter(e.target.value)}  aria-label="Filter by project">
          {projects.map(p   => <option key={p} value={p}>{p === 'all' ? 'All Projects'   : p}</option>)}
        </select>
        <select className="jarvis-select" value={assigneeFilter} onChange={e => setAssigneeFilter(e.target.value)} aria-label="Filter by assignee">
          {assignees.map(a  => <option key={a} value={a}>{a === 'all' ? 'All Assignees'  : a}</option>)}
        </select>
        <select className="jarvis-select" value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} aria-label="Filter by category">
          {categories.map(c => <option key={c} value={c}>{c === 'all' ? 'All Categories' : c}</option>)}
        </select>
      </div>

      <div className="jarvis-row" style={{ marginBottom: 10 }}>
        <span className="jarvis-small">{filtered.length} of {allItems.length} items</span>
        {canWrite && (
          <button className="jarvis-btn jarvis-btn-sm" aria-label="Add action item">
            + Add Action
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="jarvis-empty" role="status"><span>No action items match your filters</span></div>
      ) : (
        <>
          <ItemsTable items={openItems}     label="Open Items"     onSelect={setSelected} />
          <ItemsTable items={resolvedItems} label="Resolved Items" onSelect={setSelected} />
        </>
      )}
    </div>
  )
}

export default ActionItemsView
