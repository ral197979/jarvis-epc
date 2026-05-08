/**
 * Denver Engineering — Action Detail Drawer (v4.34.0)
 * ─────────────────────────────────────────────────────
 * Ava Phase 2 — Side drawer showing full action details:
 *   - Header: title, type, status, priority badges
 *   - SLA badge + escalation indicator
 *   - Dependency graph (placeholder)
 *   - Timeline panel
 *   - Relationship list
 *
 * Usage:
 *   <ActionDetailDrawer actionId={id} open={open} onClose={() => setOpen(false)} />
 */
import React, { useEffect, useState, useCallback } from 'react'
import { SlaBadge }                   from './SlaBadge'
import { EscalationIndicator }        from './EscalationIndicator'
import { DependencyGraphPlaceholder } from './DependencyGraphPlaceholder'
import { TimelinePanel }              from './TimelinePanel'

interface ActionRow {
  id:                   string
  title:                string
  action_type:          string
  source_module:        string
  status:               string
  priority:             string
  due_at:               string | null
  sla_remaining_minutes?: number | null
  sla_status?:          string | null
  max_escalation_level?: number | null
  escalation_count?:    number | null
  is_blocked?:          boolean
  blocked_by_count?:    number
  dependency_count?:    number
  assigned_user_email?: string | null
  project_name?:        string | null
  created_at:           string
}

interface ActionDetailDrawerProps {
  actionId: string | null
  open:     boolean
  onClose:  () => void
}

type DrawerTab = 'details' | 'timeline' | 'dependencies'

const PRIORITY_COLOR: Record<string, string> = {
  critical: '#dc2626', high: '#f97316', medium: '#d97706', low: '#6b7280',
}
const STATUS_COLOR: Record<string, string> = {
  open: '#2563eb', in_progress: '#7c3aed', completed: '#059669', cancelled: '#9ca3af',
}

export function ActionDetailDrawer({ actionId, open, onClose }: ActionDetailDrawerProps) {
  const [action, setAction] = useState<ActionRow | null>(null)
  const [loading, setLoading] = useState(false)
  const [tab, setTab]         = useState<DrawerTab>('details')

  const loadAction = useCallback(async () => {
    if (!actionId) return
    setLoading(true)
    try {
      const res = await fetch(`/api/v1/actions/${actionId}`)
      const j   = await res.json()
      setAction(j.data ?? null)
    } catch {
      setAction(null)
    } finally {
      setLoading(false)
    }
  }, [actionId])

  useEffect(() => {
    if (open && actionId) { void loadAction() }
    if (!open) { setTab('details') }
  }, [open, actionId, loadAction])

  if (!open) return null

  const drawerStyle: React.CSSProperties = {
    position:   'fixed', top: 0, right: 0, bottom: 0,
    width:      480, maxWidth: '100vw',
    background: '#fff', boxShadow: '-4px 0 24px rgba(0,0,0,0.12)',
    display:    'flex', flexDirection: 'column',
    zIndex:     1000, overflowY: 'auto',
  }

  const overlayStyle: React.CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.25)', zIndex: 999,
  }

  return (
    <>
      <div style={overlayStyle} onClick={onClose} />
      <div style={drawerStyle}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          {loading ? (
            <div style={{ color: '#9ca3af' }}>Loading…</div>
          ) : action ? (
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {action.action_type} · {action.source_module}
              </div>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#111827', lineHeight: 1.4 }}>
                {action.title}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                  background: `${STATUS_COLOR[action.status]}18`, color: STATUS_COLOR[action.status] ?? '#6b7280' }}>
                  {action.status.replace('_', ' ')}
                </span>
                <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                  background: `${PRIORITY_COLOR[action.priority]}18`, color: PRIORITY_COLOR[action.priority] ?? '#6b7280' }}>
                  {action.priority}
                </span>
                <SlaBadge remainingMinutes={action.sla_remaining_minutes ?? null}
                  slaStatus={(action.sla_status as never) ?? null} />
                <EscalationIndicator level={action.max_escalation_level ?? 0} />
              </div>
            </div>
          ) : (
            <div style={{ color: '#9ca3af' }}>Action not found</div>
          )}
          <button onClick={onClose} style={{ marginLeft: 12, background: 'none', border: 'none',
            cursor: 'pointer', fontSize: 18, color: '#9ca3af', lineHeight: 1 }}>✕</button>
        </div>

        {action && (
          <>
            {/* Tabs */}
            <div style={{ display: 'flex', borderBottom: '1px solid #e5e7eb', padding: '0 20px' }}>
              {(['details', 'timeline', 'dependencies'] as DrawerTab[]).map(t => (
                <button key={t} onClick={() => setTab(t)} style={{
                  padding: '10px 12px', fontSize: 13, fontWeight: tab === t ? 600 : 400,
                  color: tab === t ? '#2563eb' : '#6b7280',
                  borderBottom: tab === t ? '2px solid #2563eb' : '2px solid transparent',
                  background: 'none', border: 'none', cursor: 'pointer', marginRight: 4,
                  textTransform: 'capitalize',
                }}>
                  {t}
                </button>
              ))}
            </div>

            {/* Tab content */}
            {tab === 'details' && (
              <div style={{ padding: 20, fontSize: 13 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 24px' }}>
                  {[
                    ['Project',   action.project_name ?? '—'],
                    ['Assignee',  action.assigned_user_email ?? 'Unassigned'],
                    ['Created',   new Date(action.created_at).toLocaleDateString()],
                    ['Due',       action.due_at ? new Date(action.due_at).toLocaleString() : '—'],
                    ['Blockers',  action.blocked_by_count ? String(action.blocked_by_count) : '0'],
                    ['Relations', action.dependency_count ? String(action.dependency_count) : '0'],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <div style={{ color: '#9ca3af', fontSize: 11, marginBottom: 2 }}>{label}</div>
                      <div style={{ color: '#111827', fontWeight: 500 }}>{value}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tab === 'timeline' && (
              <TimelinePanel actionId={action.id} />
            )}

            {tab === 'dependencies' && (
              <DependencyGraphPlaceholder actionId={action.id} />
            )}
          </>
        )}
      </div>
    </>
  )
}
