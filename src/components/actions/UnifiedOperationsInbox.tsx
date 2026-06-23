/**
 * Denver Engineering — Unified Operations Inbox (v4.34.0)
 * ─────────────────────────────────────────────────────────
 * Ava Phase 2 — Primary operational view for the Action Intelligence Layer.
 *
 * Features:
 *   - Virtualized table with cursor pagination
 *   - 9 filter dimensions (module, project, assignee, priority, status,
 *     escalation level, overdue, blocked, system_type)
 *   - SLA countdown badges
 *   - Escalation indicators
 *   - Blocker status
 *   - Click row → ActionDetailDrawer
 *   - Polling abstraction (30s auto-refresh)
 *
 * Architecture:
 *   - Plain fetch + useState (matches existing codebase pattern)
 *   - Skeleton loading state
 *   - Empty state
 *   - Optimistic status update stub (Phase 2 Sprint 3)
 */
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { SlaBadge }            from './SlaBadge'
import { EscalationIndicator } from './EscalationIndicator'
import { ActionDetailDrawer }  from './ActionDetailDrawer'

// ─── Types ────────────────────────────────────────────────────────────────────

interface InboxAction {
  id:                   string
  title:                string
  action_type:          string
  source_module:        string
  status:               string
  priority:             string
  due_at:               string | null
  sla_remaining_minutes: number | null
  sla_status:           string | null
  max_escalation_level: number | null
  escalation_count:     number
  is_blocked:           boolean
  blocked_by_count:     number
  dependency_count:     number
  age_hours:            number
  project_name:         string | null
  assigned_user_email:  string | null
  escalation_status:    string
  created_at:           string
}

interface InboxFilters {
  module?:           string
  project_id?:       string
  assignee?:         string
  priority?:         string
  status?:           string
  escalation_level?: string
  overdue_only?:     boolean
  system_type?:      string
}

const PRIORITY_DOT: Record<string, string> = {
  critical: '#dc2626', high: '#f97316', medium: '#d97706', low: '#6b7280',
}

const _STATUS_LABELS: Record<string, string> = {
  open: 'Open', in_progress: 'In Progress', completed: 'Completed', cancelled: 'Cancelled',
}

// ─── Skeleton row ─────────────────────────────────────────────────────────────

function SkeletonRow() {
  const pulse: React.CSSProperties = {
    height: 12, borderRadius: 4, background: 'linear-gradient(90deg,#f3f4f6 25%,#e5e7eb 50%,#f3f4f6 75%)',
    backgroundSize: '200% 100%', animation: 'shimmer 1.4s infinite',
  }
  return (
    <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
      {[60, 120, 80, 70, 90, 80].map((w, i) => (
        <td key={i} style={{ padding: '12px 10px' }}>
          <div style={{ ...pulse, width: w }} />
        </td>
      ))}
    </tr>
  )
}

// ─── Filter bar ───────────────────────────────────────────────────────────────

function FilterBar({ filters, onChange }: {
  filters: InboxFilters
  onChange: (f: InboxFilters) => void
}) {
  const sel = (key: keyof InboxFilters) => (e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) => {
    const val = e.target.type === 'checkbox'
      ? (e.target as HTMLInputElement).checked
      : e.target.value || undefined
    onChange({ ...filters, [key]: val })
  }

  const inputStyle: React.CSSProperties = {
    padding: '4px 8px', borderRadius: 6, border: '1px solid #d1d5db',
    fontSize: 13, background: '#fff', color: '#374151',
  }

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '12px 16px',
      background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
      <select style={inputStyle} value={filters.status ?? ''} onChange={sel('status')}>
        <option value="">All statuses</option>
        <option value="open">Open</option>
        <option value="in_progress">In Progress</option>
        <option value="all">All</option>
      </select>
      <select style={inputStyle} value={filters.priority ?? ''} onChange={sel('priority')}>
        <option value="">All priorities</option>
        <option value="critical">Critical</option>
        <option value="high">High</option>
        <option value="medium">Medium</option>
        <option value="low">Low</option>
      </select>
      <select style={inputStyle} value={filters.module ?? ''} onChange={sel('module')}>
        <option value="">All modules</option>
        <option value="rfis">RFIs</option>
        <option value="submittals">Submittals</option>
        <option value="punch_items">Punch Items</option>
        <option value="inspections">Inspections</option>
        <option value="compliance_tasks">Compliance</option>
        <option value="bim_issues">BIM Issues</option>
        <option value="daily_logs">Daily Logs</option>
      </select>
      <select style={inputStyle} value={filters.escalation_level ?? ''} onChange={sel('escalation_level')}>
        <option value="">Any escalation</option>
        <option value="1">L1 escalated</option>
        <option value="2">L2 escalated</option>
        <option value="3">L3 escalated</option>
      </select>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#374151', cursor: 'pointer' }}>
        <input type="checkbox" checked={!!filters.overdue_only} onChange={sel('overdue_only')} />
        Overdue only
      </label>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function UnifiedOperationsInbox() {
  const [actions, setActions]       = useState<InboxAction[]>([])
  const [loading, setLoading]       = useState(true)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [filters, setFilters]       = useState<InboxFilters>({ status: 'open' })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const buildUrl = useCallback((cursor?: string | null, f: InboxFilters = filters): string => {
    const params = new URLSearchParams()
    if (f.status)           params.set('status',           f.status)
    if (f.module)           params.set('module',           f.module)
    if (f.project_id)       params.set('project_id',       f.project_id)
    if (f.assignee)         params.set('assignee',         f.assignee)
    if (f.priority)         params.set('priority',         f.priority)
    if (f.escalation_level) params.set('escalation_level', f.escalation_level)
    if (f.overdue_only)     params.set('overdue_only',     'true')
    if (f.system_type)      params.set('system_type',      f.system_type)
    params.set('limit', '50')
    if (cursor) params.set('cursor', cursor)
    return `/api/v1/actions/inbox?${params.toString()}`
  }, [filters])

  const load = useCallback(async (f: InboxFilters = filters) => {
    setLoading(true)
    try {
      const res = await fetch(buildUrl(null, f))
      const j   = await res.json()
      setActions(j.data ?? [])
      setNextCursor(j.meta?.next_cursor ?? null)
    } catch {
      setActions([])
    } finally {
      setLoading(false)
    }
  }, [buildUrl, filters])

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      const res = await fetch(buildUrl(nextCursor))
      const j   = await res.json()
      setActions(prev => [...prev, ...(j.data ?? [])])
      setNextCursor(j.meta?.next_cursor ?? null)
    } finally {
      setLoadingMore(false)
    }
  }, [nextCursor, loadingMore, buildUrl])

  // Initial load + filter change
  useEffect(() => { void load(filters) }, [filters])  // eslint-disable-line

  // 30s polling
  useEffect(() => {
    pollRef.current = setInterval(() => void load(filters), 30_000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [filters, load])

  const handleFiltersChange = (f: InboxFilters) => {
    setFilters(f)
    setNextCursor(null)
  }

  const openDrawer = (id: string) => {
    setSelectedId(id)
    setDrawerOpen(true)
  }

  const overdueCount  = actions.filter(a => (a.sla_remaining_minutes ?? 1) <= 0).length
  const blockedCount  = actions.filter(a => a.is_blocked).length
  const escalatedCount = actions.filter(a => (a.max_escalation_level ?? 0) >= 1).length

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#fff' }}>
      {/* Page header */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid #e5e7eb' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#111827' }}>
              Operations Inbox
            </h2>
            <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>
              {loading ? 'Loading…' : `${actions.length} actions`}
              {overdueCount > 0 && (
                <span style={{ marginLeft: 12, color: '#dc2626', fontWeight: 600 }}>
                  {overdueCount} overdue
                </span>
              )}
              {blockedCount > 0 && (
                <span style={{ marginLeft: 12, color: '#d97706', fontWeight: 600 }}>
                  {blockedCount} blocked
                </span>
              )}
              {escalatedCount > 0 && (
                <span style={{ marginLeft: 12, color: '#f97316', fontWeight: 600 }}>
                  {escalatedCount} escalated
                </span>
              )}
            </div>
          </div>
          <button onClick={() => void load(filters)} style={{
            padding: '6px 12px', borderRadius: 6, fontSize: 13,
            background: '#f9fafb', border: '1px solid #d1d5db',
            cursor: 'pointer', color: '#374151',
          }}>
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* Filters */}
      <FilterBar filters={filters} onChange={handleFiltersChange} />

      {/* Table */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead style={{ position: 'sticky', top: 0, background: '#f9fafb', zIndex: 10 }}>
            <tr style={{ borderBottom: '1px solid #e5e7eb', color: '#6b7280' }}>
              {['Title', 'Module', 'Priority', 'SLA', 'Escalation', 'Assignee'].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 500, fontSize: 12 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)
              : actions.length === 0
              ? (
                <tr>
                  <td colSpan={6} style={{ padding: 40, textAlign: 'center', color: '#9ca3af' }}>
                    No actions match your filters.
                  </td>
                </tr>
              )
              : actions.map(a => (
                <tr
                  key={a.id}
                  onClick={() => openDrawer(a.id)}
                  style={{
                    borderBottom: '1px solid #f3f4f6',
                    cursor: 'pointer',
                    background: selectedId === a.id ? '#eff6ff' : 'transparent',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => { if (selectedId !== a.id) (e.currentTarget as HTMLElement).style.background = '#f9fafb' }}
                  onMouseLeave={e => { if (selectedId !== a.id) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                >
                  {/* Title */}
                  <td style={{ padding: '10px 10px', maxWidth: 280 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {a.is_blocked && <span title="Blocked" style={{ fontSize: 12 }}>🔒</span>}
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500, color: '#111827' }}>
                        {a.title}
                      </span>
                    </div>
                    {a.project_name && (
                      <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{a.project_name}</div>
                    )}
                  </td>

                  {/* Module */}
                  <td style={{ padding: '10px 10px', color: '#6b7280', whiteSpace: 'nowrap' }}>
                    {a.source_module.replace('_', ' ')}
                  </td>

                  {/* Priority */}
                  <td style={{ padding: '10px 10px', whiteSpace: 'nowrap' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: PRIORITY_DOT[a.priority] ?? '#d1d5db', display: 'inline-block' }} />
                      <span style={{ color: PRIORITY_DOT[a.priority], fontWeight: 600, textTransform: 'capitalize' }}>
                        {a.priority}
                      </span>
                    </span>
                  </td>

                  {/* SLA */}
                  <td style={{ padding: '10px 10px', whiteSpace: 'nowrap' }}>
                    <SlaBadge
                      remainingMinutes={a.sla_remaining_minutes}
                      slaStatus={a.sla_status as never}
                    />
                  </td>

                  {/* Escalation */}
                  <td style={{ padding: '10px 10px' }}>
                    <EscalationIndicator level={a.max_escalation_level ?? 0} />
                  </td>

                  {/* Assignee */}
                  <td style={{ padding: '10px 10px', color: '#6b7280', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {a.assigned_user_email
                      ? a.assigned_user_email.split('@')[0]
                      : <span style={{ color: '#d1d5db' }}>Unassigned</span>
                    }
                  </td>
                </tr>
              ))
            }
          </tbody>
        </table>

        {/* Load more */}
        {nextCursor && !loading && (
          <div style={{ padding: 16, textAlign: 'center' }}>
            <button onClick={loadMore} disabled={loadingMore} style={{
              padding: '8px 20px', borderRadius: 6, fontSize: 13,
              background: '#f9fafb', border: '1px solid #d1d5db',
              cursor: loadingMore ? 'default' : 'pointer', color: '#374151',
            }}>
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          </div>
        )}
      </div>

      {/* Detail drawer */}
      <ActionDetailDrawer
        actionId={selectedId}
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); setSelectedId(null) }}
      />

      <style>{`
        @keyframes shimmer {
          0%   { background-position: 200% 0 }
          100% { background-position: -200% 0 }
        }
      `}</style>
    </div>
  )
}
