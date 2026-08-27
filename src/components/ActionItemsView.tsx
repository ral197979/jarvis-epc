/**
 * Denver Engineering — ActionItemsView Component
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

import React, { useState, useMemo, useEffect } from 'react'
import {
  useBizStore,
  selectActionItems,
} from '../modules/biz/store'
import { type PolicyConfig } from '../modules/biz/dispatch'
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
  /** `actions.source_module` — which module raised this, for the drill-through. */
  source?:     string
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
  critical: 'var(--jarvis-red)',
  high:     'var(--jarvis-red)',
  medium:   'var(--jarvis-amb)',
  med:      'var(--jarvis-amb)',
  low:      'var(--jarvis-ts)',
}

/**
 * Which statuses mean "off the desk".
 *
 * The legacy store vocabulary is `resolved` / `verified`; the `actions` table
 * (migration 029) constrains status to `open|in_progress|completed|cancelled`.
 * Both are listed because both sources feed this register.
 *
 * `cancelled` belongs here and NOT under `resolved`: it is finished, but it was
 * not done. Folding it into `resolved` would inflate the Resolved KPI with work
 * nobody completed, so it keeps its own label and simply leaves the open list.
 */
const CLOSED_STATUSES = new Set(['resolved', 'verified', 'completed', 'cancelled'])

// ─── Live data ────────────────────────────────────────────────────────────────
//
// The routed component made ZERO backend calls. Its only source was
// `useBizStore(selectActionItems)`, a collection store.ts documents as never
// hydrated — so the Action Center rendered "No action items" on every session
// while `api/routes/actions.ts` sat mounted and fully authorized beside it.
//
// The store still wins when it holds rows: some in-app flows dispatch
// `actions.addAction`, and a caller who has put items there means them. When it
// is empty — the routed case — the register reads the API instead of asserting
// that there is no work.
//
// Two scopes, because the API has two and they are not interchangeable:
//   GET /actions      personal.admin — every action in the tenant (Owner only)
//   GET /actions/my   personal.view  — the caller's own assigned actions
// The admin route is tried first and a 403 falls back, so each caller sees
// exactly what they are entitled to and is TOLD which of the two they got.

/** `actions.status` values, from the migration-029 CHECK constraint. */
const API_STATUSES = ['open', 'in_progress', 'completed', 'cancelled'] as const

/** API status → the vocabulary this component's stages and filters already use. */
const STATUS_FROM_API: Record<string, string> = {
  open:        'open',
  in_progress: 'in-progress',
  completed:   'resolved',
  cancelled:   'cancelled',
}

/**
 * Where actions come from.
 *
 * Migration 029 is explicit: "every module emits actions here. One row per
 * source record per tenant (idempotent via UNIQUE on
 * tenant_id+source_module+source_id)". `source_module` and `source_id` are both
 * NOT NULL, there is no POST /api/v1/actions, and `createAction` is called only
 * from the modules below. An action typed in by hand would have no source
 * record to point at, so the register is a DERIVED view by design — which is
 * why this file offers no create control (see NO_MANUAL_CREATE).
 *
 * The tabs are matched against the `source_module` values the API actually
 * emits, not guessed from the table name.
 */
const SOURCE_MODULE_TABS: Record<string, { tab: string; label: string }> = {
  rfis:                       { tab: 'rfis',         label: 'RFIs' },
  submittals:                 { tab: 'submittals',   label: 'Submittals' },
  punch_items:                { tab: 'punch',        label: 'Punch Lists' },
  inspections:                { tab: 'inspections',  label: 'Inspections' },
  compliance_tasks:           { tab: 'compliance',   label: 'Compliance' },
  daily_logs:                 { tab: 'dailylogs',    label: 'Daily Logs' },
  bim_issues:                 { tab: 'bim',          label: 'BIM' },
  coordination_recommendation:{ tab: 'coordination', label: 'Coordination' },
}

/**
 * There is no create endpoint, and that is the design rather than a gap.
 *
 * This screen used to carry a `+ Add Action` button with no onClick — a control
 * for an operation the API does not expose and, given the NOT NULL source
 * columns, could not expose without changing the model. It has been removed in
 * favour of saying where actions come from.
 */
const NO_MANUAL_CREATE = true

/**
 * The transitions offered on the detail panel.
 *
 * `from` is in the COMPONENT vocabulary (what a row's status looks like after
 * `toActionItem`) and `to` is in the migration-029 CHECK vocabulary (what the
 * PATCH body must carry). Keeping the target in schema terms is what stops the
 * display label leaking into the request — `Complete` sends `completed`, never
 * the `resolved` the badge shows.
 *
 * Only `status` is offered. `PATCH /actions/:id` also accepts `priority` and
 * `description` on the same personal.write + requireActionAccess ladder, and
 * `assigned_to_user_id` / `assigned_to_role` behind `personal.admin` — but
 * reassignment moves work out of somebody's inbox and is refused for every role
 * but Owner, so putting it on this panel would render a control that 403s for
 * nearly everyone. It is left off deliberately, not overlooked.
 */
const TRANSITIONS: { to: string; label: string; from: string[] }[] = [
  { to: 'in_progress', label: 'Start',    from: ['open', 'assigned'] },
  { to: 'completed',   label: 'Complete', from: ['open', 'assigned', 'in-progress'] },
  { to: 'cancelled',   label: 'Cancel',   from: ['open', 'assigned', 'in-progress'] },
  { to: 'open',        label: 'Reopen',   from: ['resolved', 'verified', 'cancelled'] },
]

interface ActionApiRow {
  id: string
  title?: string; description?: string
  status?: string; priority?: string
  action_type?: string; source_module?: string; source_id?: string
  project_code?: string; project_name?: string
  assigned_user_email?: string; assigned_to_role?: string
  due_at?: string | null; created_at?: string | null
  [key: string]: unknown
}

/** API row → the shape this component already renders. Nothing is invented. */
function toActionItem(row: ActionApiRow, selfLabel?: string): ActionItem {
  return {
    id:       row.id,
    subject:  row.title,
    project:  row.project_code ?? row.project_name,
    priority: row.priority,
    // `/actions/my` does not join users — every row is the caller by definition,
    // so it is labelled rather than left blank.
    assigned: row.assigned_user_email ?? row.assigned_to_role ?? selfLabel,
    due:      row.due_at ? String(row.due_at).slice(0, 10) : undefined,
    category: row.action_type ?? row.source_module,
    status:   STATUS_FROM_API[String(row.status ?? '')] ?? row.status,
    notes:    row.description,
    ref_id:   row.source_id,
    source:   row.source_module,
    created:  row.created_at ? String(row.created_at).slice(0, 10) : undefined,
  }
}

type ActionsScope = 'tenant' | 'self'
interface ActionsData {
  items: ActionItem[]
  state: 'loading' | 'ready' | 'error'
  scope?: ActionsScope
  detail?: string
}
interface ActionsSource extends ActionsData { replace: (next: ActionItem) => void }

function useActionItems(enabled: boolean): ActionsSource {
  const [data, setData] = useState<ActionsData>({ items: [], state: enabled ? 'loading' : 'ready' })

  useEffect(() => {
    if (!enabled) return
    let live = true
    void (async () => {
      try {
        const all = await fetch('/api/v1/actions?limit=200')
        if (!live) return

        if (all.ok) {
          const body = await all.json() as { data?: ActionApiRow[] }
          if (!live) return
          setData({ items: (body.data ?? []).map(r => toActionItem(r)), state: 'ready', scope: 'tenant' })
          return
        }
        // 401/403 is not a failure here — it is the ordinary case for every
        // role but Owner, and the personal register is what they should see.
        if (all.status !== 401 && all.status !== 403) {
          setData({ items: [], state: 'error', detail: `Request failed (${all.status}).` })
          return
        }

        // `/actions/my` filters on ONE status per call, so the four the table
        // groups are fetched together. A status that refuses is skipped rather
        // than failing the register.
        const perStatus = await Promise.all(API_STATUSES.map(async st => {
          const r = await fetch(`/api/v1/actions/my?status=${st}&limit=200`)
          if (!r.ok) return []
          const b = await r.json() as { data?: ActionApiRow[] }
          return b.data ?? []
        }))
        if (!live) return
        setData({
          items: perStatus.flat().map(r => toActionItem(r, 'You')),
          state: 'ready',
          scope: 'self',
        })
      } catch (err) {
        if (!live) return
        setData({ items: [], state: 'error', detail: err instanceof Error ? err.message : String(err) })
      }
    })()
    return () => { live = false }
  }, [enabled])

  /**
   * Replace one row after a successful write, from the row the server returned.
   * The list is not refetched: the PATCH response IS the updated record, and a
   * refetch would race with it and cost a round trip to learn what we already
   * hold.
   */
  const replace = React.useCallback((next: ActionItem) => {
    setData(d => ({ ...d, items: d.items.map(i => (i.id === next.id ? next : i)) }))
  }, [])

  return { ...data, replace }
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
/**
 * The transition strip.
 *
 * Rendered only when the action came from the API. A store-dispatched row has
 * an id like `AI-001`, which is not an `actions.id`, so a PATCH would 404 —
 * offering the control there would be a button that cannot work.
 *
 * The server is the authority on whether the caller may do this:
 * `personal.write` plus `requireActionAccess`, which is personal ownership and
 * strictly narrower than project membership (ADR-014 D29). `canWrite` only
 * hides controls the local policy already disables; it is not the check.
 */
function TransitionBar({ item, canWrite, onChanged }: {
  item: ActionItem
  canWrite: boolean
  onChanged: (next: ActionItem) => void
}) {
  const [busy,  setBusy]  = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const current   = item.status ?? 'open'
  const available = TRANSITIONS.filter(t => t.from.includes(current))
  if (!canWrite || available.length === 0) return null

  async function go(to: string, label: string): Promise<void> {
    setBusy(to); setError(null)
    try {
      const res = await fetch(`/api/v1/actions/${item.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ status: to }),
      })
      if (res.status === 401 || res.status === 403) {
        setError(`You are not allowed to ${label.toLowerCase()} this action.`); return
      }
      if (res.status === 404) {
        setError('This action no longer exists, or is not yours to change.'); return
      }
      if (!res.ok) { setError(`Update failed (${res.status}).`); return }

      // Answer from the row the server returned, never from the request — the
      // handler stamps completed_at / cancelled_at and may have applied its own
      // rules, so echoing the optimistic value would drift from the record.
      const body = await res.json() as { data?: ActionApiRow }
      onChanged(body.data ? toActionItem(body.data, item.assigned) : { ...item, status: STATUS_FROM_API[to] ?? to })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {available.map(t => (
          <button
            key={t.to}
            className="jarvis-btn jarvis-btn-sm"
            disabled={busy !== null}
            aria-busy={busy === t.to}
            onClick={() => void go(t.to, t.label)}
          >
            {busy === t.to ? `${t.label}…` : t.label}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="jarvis-small" style={{ color: 'var(--jarvis-red)', marginTop: 6 }}>
          {error}
        </p>
      )}
    </div>
  )
}

function ItemDetail({ item, canWrite, writable, onChanged, onBack, onNavigate }: {
  item: ActionItem
  canWrite: boolean
  /** The action came from the API, so its id addresses a real row. */
  writable: boolean
  onChanged: (next: ActionItem) => void
  onBack: () => void
  onNavigate?: (tab: string) => void
}) {
  // An action is a pointer at a record in another module, so the register has
  // to lead back to it. The app routes by TAB, not by record, so this opens the
  // module rather than the row — and says "Open X" rather than implying it will
  // land on the reference. An unrecognised source_module gets no control at
  // all: a link that goes nowhere is worse than plain text.
  const source = item.source ? SOURCE_MODULE_TABS[item.source] : undefined
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
      {writable && <TransitionBar item={item} canWrite={canWrite} onChanged={onChanged} />}
      {source && onNavigate && (
        <div style={{ marginBottom: 16 }}>
          <button
            className="jarvis-btn jarvis-btn-sm"
            onClick={() => onNavigate(source.tab)}
          >
            Open {source.label}
          </button>
          <span className="jarvis-small" style={{ marginLeft: 8, color: 'var(--jarvis-ts)' }}>
            Raised from {source.label}
            {item.ref_id ? ` · reference ${item.ref_id}` : ''}
          </span>
        </div>
      )}
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
export function ActionItemsView({ policy, onNavigate, onAudit: _onAudit, onToast: _onToast }: ActionItemsViewProps) {
  const storeItems = useBizStore(selectActionItems) as ActionItem[]
  // The store is a legacy in-app source that some flows still dispatch into.
  // When it holds nothing — the routed case, since nothing hydrates it — read
  // the API rather than assert that there is no work.
  const live     = storeItems.length === 0
  const fetched  = useActionItems(live)
  const allItems = live ? fetched.items : storeItems

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

  const openItems     = filtered.filter(i => !CLOSED_STATUSES.has(i.status ?? ''))
  const resolvedItems = filtered.filter(i =>  CLOSED_STATUSES.has(i.status ?? ''))

  const today       = new Date().toISOString().slice(0, 10)
  const kpiOpen     = allItems.filter(i => i.status === 'open').length
  const kpiHigh     = allItems.filter(i => (i.priority === 'high') && i.status === 'open').length
  const kpiOverdue  = allItems.filter(i => i.status === 'open' && i.due && i.due < today).length
  // Deliberately not CLOSED_STATUSES: a cancelled action left the open list but
  // nobody resolved it, and counting it here would overstate completed work.
  const kpiResolved = allItems.filter(i => i.status === 'resolved' || i.status === 'verified').length

  if (selected) {
    return (
      <ItemDetail
        item={selected}
        canWrite={canWrite}
        // Only API-backed rows are writable. A store-dispatched id is not an
        // `actions.id`, so its PATCH would 404 — no control is offered for it.
        writable={live}
        onChanged={next => { fetched.replace(next); setSelected(next) }}
        onBack={() => setSelected(null)}
        onNavigate={onNavigate}
      />
    )
  }

  if (live && fetched.state === 'loading') {
    return <div className="jarvis-empty" role="status"><span>Loading action items…</span></div>
  }

  if (live && fetched.state === 'error') {
    return (
      <div className="jarvis-empty" role="alert">
        <span className="jarvis-empty-icon">⚠️</span>
        <h3 className="jarvis-heading">Could not load action items</h3>
        <p className="jarvis-muted">{fetched.detail ?? 'Request failed.'}</p>
      </div>
    )
  }

  if (allItems.length === 0) {
    return (
      <div className="jarvis-empty" role="status">
        <span className="jarvis-empty-icon">✅</span>
        <h3 className="jarvis-heading">
          {live && fetched.scope === 'self' ? 'No action items assigned to you' : 'No action items'}
        </h3>
        <p className="jarvis-muted">Action items created across all modules appear here</p>
      </div>
    )
  }

  return (
    <div role="main" aria-label="Action Items">
      {/* Which register this is. A personal view that looks tenant-wide is the
          more dangerous of the two mistakes, so the narrower scope says so. */}
      {live && fetched.scope === 'self' && (
        <p className="jarvis-small" role="note" style={{ color: 'var(--jarvis-ts)', marginBottom: 10 }}>
          Showing action items assigned to you. A tenant-wide register requires the personal.admin capability.
        </p>
      )}

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
        {/* The `+ Add Action` button that stood here had no onClick and never
            could have: actions are emitted by the modules that raise them, and
            `source_module` / `source_id` are NOT NULL with a uniqueness rule
            that makes one action per source record. Saying so is more use than
            a control that cannot work. */}
        {NO_MANUAL_CREATE && (
          <span className="jarvis-small" style={{ marginLeft: 'auto', color: 'var(--jarvis-ts)' }}>
            Actions are raised by the module that needs them — RFIs, submittals,
            punch items, inspections, compliance, daily logs, BIM and coordination.
          </span>
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
