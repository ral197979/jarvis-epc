/**
 * Denver Engineering — Escalation Timeline (v4.35.0)
 * ─────────────────────────────────────────────────────
 * Ava Phase 3 — Chronological view of escalated actions
 * with level indicators, SLA status, and supervisor actions.
 */
import React, { useEffect, useState } from 'react'
import { SlaBadge }           from '../actions/SlaBadge'
import { EscalationIndicator } from '../actions/EscalationIndicator'

interface EscalatedAction {
  id:               string
  title:            string
  action_type:      string
  priority:         string
  status:           string
  escalation_level: number
  due_at:           string | null
  project_name?:    string
  assignee_email?:  string
  sla_remaining_minutes?: number | null
  sla_status?:      string | null
}

interface EscalationTimelineProps {
  projectId?: string
  maxItems?:  number
  height?:    number
  onSelect?:  (actionId: string) => void
}

const PRIORITY_COLORS: Record<string, string> = {
  critical: '#dc2626', high: '#f97316', medium: '#d97706', low: '#6b7280',
}

function _formatDue(due: string | null): string {
  if (!due) return '—'
  const d    = new Date(due)
  const now  = Date.now()
  const diff = d.getTime() - now
  if (diff < 0) return `${Math.abs(Math.floor(diff / 3_600_000))}h overdue`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h left`
  return d.toLocaleDateString()
}

export function EscalationTimeline({
  projectId, maxItems = 30, height = 480, onSelect,
}: EscalationTimelineProps) {
  const [items, setItems]     = useState<EscalatedAction[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({ limit: String(maxItems) })
    if (projectId) params.set('project_id', projectId)
    fetch(`/api/v1/ops/escalations?${params}`)
      .then(r => r.json())
      .then(j => setItems(j.data ?? []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }, [projectId, maxItems])

  const handleSelect = (id: string) => {
    setSelected(id)
    onSelect?.(id)
  }

  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8,
      display: 'flex', flexDirection: 'column', height }}>
      {/* Header */}
      <div style={{ padding: '10px 14px', borderBottom: '1px solid #e5e7eb',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>Escalation Queue</div>
        {!loading && (
          <span style={{ fontSize: 11, background: '#fef3c7', color: '#d97706',
            padding: '2px 8px', borderRadius: 12, fontWeight: 600 }}>
            {items.length} escalated
          </span>
        )}
      </div>

      {/* Timeline */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ padding: 20, color: '#9ca3af', fontSize: 13 }}>Loading escalations…</div>
        ) : items.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>
            No escalated actions.
          </div>
        ) : (
          items.map(item => {
            const isSelected = selected === item.id
            const isOverdue  = item.due_at && new Date(item.due_at).getTime() < Date.now()

            return (
              <div
                key={item.id}
                onClick={() => handleSelect(item.id)}
                style={{
                  padding: '10px 14px',
                  borderBottom: '1px solid #f3f4f6',
                  background: isSelected ? '#eff6ff' : isOverdue ? '#fff7ed' : 'transparent',
                  cursor: 'pointer',
                  transition: 'background 0.1s',
                }}
              >
                {/* Row 1: level indicator + title */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <EscalationIndicator level={item.escalation_level} compact />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: '#111827',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.title}
                    </div>
                    {item.project_name && (
                      <div style={{ fontSize: 11, color: '#9ca3af' }}>{item.project_name}</div>
                    )}
                  </div>
                </div>

                {/* Row 2: priority + SLA + due */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'capitalize',
                    color: PRIORITY_COLORS[item.priority] ?? '#6b7280' }}>
                    {item.priority}
                  </span>
                  {item.sla_remaining_minutes !== undefined && (
                    <SlaBadge remainingMinutes={item.sla_remaining_minutes ?? null}
                      slaStatus={item.sla_status as never ?? null} />
                  )}
                  <span style={{ fontSize: 10, color: isOverdue ? '#dc2626' : '#6b7280', fontWeight: isOverdue ? 600 : 400 }}>
                    {_formatDue(item.due_at)}
                  </span>
                  {item.assignee_email && (
                    <span style={{ fontSize: 10, color: '#9ca3af', marginLeft: 'auto' }}>
                      {item.assignee_email.split('@')[0]}
                    </span>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
