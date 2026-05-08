/**
 * StatusBadge — inline status indicator with dot
 * Extracted from JarvisCore `Ae()` (Phase 7)
 *
 * Renders a small coloured dot + status text for any EPC record status.
 */
import React from 'react'

export type StatusValue =
  | 'active' | 'won' | 'paid' | 'complete' | 'approved'
  | 'answered' | 'resolved' | 'received' | 'closed'
  | 'new' | 'draft' | 'pending' | 'submitted' | 'upcoming' | 'issued'
  | 'open' | 'qualified' | 'in-progress' | 'sent' | 'shipped'
  | 'proposal' | 'negotiation' | 'overdue' | 'lost' | 'rejected'
  | 'revise-resubmit' | string

const STATUS_COLORS: Record<string, string> = {
  active:            'var(--jarvis-green)',
  won:               'var(--jarvis-green)',
  paid:              'var(--jarvis-green)',
  complete:          'var(--jarvis-green)',
  approved:          'var(--jarvis-green)',
  answered:          'var(--jarvis-green)',
  resolved:          'var(--jarvis-green)',
  received:          'var(--jarvis-green)',
  closed:            'var(--jarvis-text-dim)',
  new:               'var(--jarvis-blue)',
  draft:             'var(--jarvis-blue)',
  pending:           'var(--jarvis-blue)',
  submitted:         'var(--jarvis-blue)',
  upcoming:          'var(--jarvis-blue)',
  issued:            'var(--jarvis-blue)',
  open:              'var(--jarvis-amber)',
  qualified:         'var(--jarvis-amber)',
  'in-progress':     'var(--jarvis-amber)',
  sent:              'var(--jarvis-amber)',
  shipped:           'var(--jarvis-amber)',
  proposal:          'var(--jarvis-purple)',
  negotiation:       'var(--jarvis-purple)',
  overdue:           'var(--jarvis-red)',
  lost:              'var(--jarvis-red)',
  rejected:          'var(--jarvis-red)',
  'revise-resubmit': 'var(--jarvis-amber)',
}

export interface StatusBadgeProps {
  status: StatusValue
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const color = STATUS_COLORS[status] ?? 'var(--jarvis-text-dim)'
  return (
    <span
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color }}
    >
      <span
        aria-hidden
        style={{ width: 6, height: 6, borderRadius: 3, background: color, flexShrink: 0 }}
      />
      {status}
    </span>
  )
}
