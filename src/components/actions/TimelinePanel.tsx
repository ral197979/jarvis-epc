/**
 * Denver Engineering — Action Timeline Panel (v4.34.0)
 * ───────────────────────────────────────────────────────
 * Ava Phase 2G — Renders the immutable action event stream.
 *
 * Fetches events from GET /api/v1/actions/:id/timeline.
 * Displays events in chronological order with actor, type, and diff.
 */
import React, { useEffect, useState, useCallback } from 'react'

type ActionEventType =
  | 'created' | 'assigned' | 'delegated' | 'reassigned'
  | 'escalated' | 'commented' | 'blocked' | 'unblocked'
  | 'status_changed' | 'priority_changed' | 'resolved'
  | 'reopened' | 'cancelled' | 'sla_paused' | 'sla_resumed'
  | 'relation_added' | 'relation_removed'

interface ActionEvent {
  id:             string
  event_type:     ActionEventType
  actor_id:       string | null
  actor_type:     string
  actor_label:    string | null
  before_snapshot: Record<string, unknown> | null
  after_snapshot:  Record<string, unknown> | null
  metadata:       Record<string, unknown>
  occurred_at:    string
}

interface TimelinePanelProps {
  actionId: string
  maxItems?: number
}

const EVENT_ICONS: Record<ActionEventType, string> = {
  created:          '✨',
  assigned:         '👤',
  delegated:        '↪',
  reassigned:       '🔄',
  escalated:        '⬆',
  commented:        '💬',
  blocked:          '🔒',
  unblocked:        '🔓',
  status_changed:   '📋',
  priority_changed: '🎯',
  resolved:         '✅',
  reopened:         '🔁',
  cancelled:        '✕',
  sla_paused:       '⏸',
  sla_resumed:      '▶',
  relation_added:   '🔗',
  relation_removed: '✂',
}

const EVENT_COLORS: Record<ActionEventType, string> = {
  created:          '#3b82f6',
  assigned:         '#8b5cf6',
  delegated:        '#8b5cf6',
  reassigned:       '#8b5cf6',
  escalated:        '#f97316',
  commented:        '#6b7280',
  blocked:          '#dc2626',
  unblocked:        '#10b981',
  status_changed:   '#0891b2',
  priority_changed: '#d97706',
  resolved:         '#10b981',
  reopened:         '#f59e0b',
  cancelled:        '#9ca3af',
  sla_paused:       '#f59e0b',
  sla_resumed:      '#10b981',
  relation_added:   '#0891b2',
  relation_removed: '#6b7280',
}

function _formatTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

function EventRow({ event }: { event: ActionEvent }) {
  const icon  = EVENT_ICONS[event.event_type] ?? '•'
  const color = EVENT_COLORS[event.event_type] ?? '#6b7280'
  const actor = event.actor_label ?? (event.actor_type === 'system' ? 'System' : 'Unknown')

  // Build diff label
  let detail = ''
  if (event.event_type === 'status_changed' && event.after_snapshot) {
    detail = `→ ${event.after_snapshot['status']}`
  } else if (event.event_type === 'priority_changed' && event.after_snapshot) {
    detail = `→ ${event.after_snapshot['priority']}`
  } else if (event.event_type === 'escalated') {
    detail = `Level ${event.metadata['level'] ?? ''}`
  } else if (event.event_type === 'relation_added') {
    detail = `${event.metadata['relation_type']} → …`
  }

  return (
    <div style={{ display: 'flex', gap: 12, padding: '10px 0', borderBottom: '1px solid #f3f4f6' }}>
      {/* Timeline dot */}
      <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{
          width: 28, height: 28, borderRadius: '50%',
          background: `${color}18`, border: `2px solid ${color}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 12,
        }}>
          {icon}
        </div>
        <div style={{ flex: 1, width: 2, background: '#f3f4f6', marginTop: 4 }} />
      </div>

      {/* Content */}
      <div style={{ flex: 1, paddingTop: 4 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: '#111827' }}>
            {event.event_type.replace(/_/g, ' ')}
            {detail && (
              <span style={{ color: '#6b7280', fontWeight: 400, marginLeft: 6 }}>{detail}</span>
            )}
          </div>
          <div style={{ fontSize: 11, color: '#9ca3af', whiteSpace: 'nowrap', marginLeft: 8 }}>
            {_formatTime(event.occurred_at)}
          </div>
        </div>
        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
          {actor}
        </div>
      </div>
    </div>
  )
}

export function TimelinePanel({ actionId, maxItems = 50 }: TimelinePanelProps) {
  const [events, setEvents]   = useState<ActionEvent[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/v1/actions/${actionId}/timeline?limit=${maxItems}`)
      const j   = await res.json()
      setEvents(j.data ?? [])
    } catch {
      setEvents([])
    } finally {
      setLoading(false)
    }
  }, [actionId, maxItems])

  useEffect(() => { void load() }, [load])

  if (loading) {
    return <div style={{ padding: 16, color: '#9ca3af', fontSize: 13 }}>Loading timeline…</div>
  }

  if (events.length === 0) {
    return <div style={{ padding: 16, color: '#9ca3af', fontSize: 13 }}>No events recorded yet.</div>
  }

  return (
    <div style={{ padding: '0 16px' }}>
      {events.map(e => <EventRow key={e.id} event={e} />)}
    </div>
  )
}
