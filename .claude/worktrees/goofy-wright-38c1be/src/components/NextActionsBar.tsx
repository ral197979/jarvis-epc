/**
 * JARVIS EPC — NextActionsBar
 * ────────────────────────────
 * Cross-domain "what to do right now" widget.
 * Shown above the active module content on every page.
 *
 * Reads three live streams from the biz store and surfaces them in one bar:
 *   1. Top 3 open action items with priority = 'high'
 *   2. Top 2 open service tickets with priority = 'critical' | 'high'
 *   3. Top 2 unread notifications with priority = 'high'
 *
 * Each item is clickable — calls onOpen() so the caller can navigate to the
 * correct module and open the entity drawer.
 *
 * Integration notes:
 *   - Reads from useBizStore via selectActionItems / selectTickets / selectNotifications
 *   - Zero props required except onOpen, onCreateAction, onViewTimeline
 *   - Hidden automatically when there are no items to show
 *   - Phase 20: Extracted from JarvisCore dash-only logic; now global
 */

import React, { useMemo } from 'react'
import {
  useBizStore,
  selectActionItems,
  selectTickets,
  selectNotifications,
} from '../modules/biz/store'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NextActionItem {
  kind:  'action' | 'ticket' | 'notif'
  id:    string
  text:  string
  tab?:  string
  link?: { type: string; id: string }
}

export interface NextActionsBarProps {
  onOpen:          (item: NextActionItem) => void
  onCreateAction:  () => void
  onViewTimeline:  () => void
}

// ─── Priority order map ───────────────────────────────────────────────────────

const PRIORITY_RANK: Record<string, number> = {
  critical: 0,
  high:     1,
  med:      2,
  medium:   2,
  low:      3,
}

const KIND_ICON: Record<string, string> = {
  action: '☑',
  ticket: '🎫',
  notif:  '🔔',
}

const KIND_LABEL: Record<string, string> = {
  action: 'Action',
  ticket: 'Ticket',
  notif:  'Alert',
}

// ─── Badge ────────────────────────────────────────────────────────────────────

function KindBadge({ kind }: { kind: string }) {
  const colors: Record<string, { bg: string; fg: string }> = {
    action: { bg: 'var(--jarvis-amber-bg, rgba(245,158,11,0.12))', fg: 'var(--jarvis-amber)' },
    ticket: { bg: 'var(--jarvis-red-bg,   rgba(239, 68, 68,0.12))', fg: 'var(--jarvis-red)' },
    notif:  { bg: 'var(--jarvis-blue-bg,  rgba( 59,130,246,0.12))', fg: 'var(--jarvis-blue)' },
  }
  const { bg, fg } = colors[kind] ?? { bg: 'transparent', fg: 'var(--jarvis-ts)' }
  return (
    <span
      aria-label={KIND_LABEL[kind] ?? kind}
      style={{
        background:    bg,
        color:         fg,
        padding:       '2px 7px',
        borderRadius:  5,
        fontSize:      9,
        fontWeight:    700,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        flexShrink:    0,
      }}
    >
      {KIND_ICON[kind]} {KIND_LABEL[kind] ?? kind}
    </span>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export function NextActionsBar({ onOpen, onCreateAction, onViewTimeline }: NextActionsBarProps) {
  const actionItems   = useBizStore(selectActionItems)
  const tickets       = useBizStore(selectTickets)
  const notifications = useBizStore(selectNotifications)

  const items: NextActionItem[] = useMemo(() => {
    // High-priority open actions (up to 3)
    const highActions = (actionItems as Record<string, unknown>[])
      .filter(a => a['status'] === 'open' && (a['priority'] === 'high' || a['priority'] === 'critical'))
      .sort((a, b) => (PRIORITY_RANK[a['priority'] as string] ?? 9) - (PRIORITY_RANK[b['priority'] as string] ?? 9))
      .slice(0, 3)
      .map(a => ({
        kind: 'action' as const,
        id:   a['id'] as string,
        text: String(a['subject'] ?? a['id']),
        tab:  'actions',
      }))

    // Critical/high open tickets (up to 2)
    const critTickets = (tickets as Record<string, unknown>[])
      .filter(t => t['status'] === 'open' && (t['priority'] === 'critical' || t['priority'] === 'high'))
      .sort((a, b) => (PRIORITY_RANK[a['priority'] as string] ?? 9) - (PRIORITY_RANK[b['priority'] as string] ?? 9))
      .slice(0, 2)
      .map(t => ({
        kind: 'ticket' as const,
        id:   t['id'] as string,
        text: String(t['issue'] ?? t['subject'] ?? t['id']),
        tab:  'field',
      }))

    // Unread high-priority notifications (up to 2)
    const urgentNotifs = (notifications as Record<string, unknown>[])
      .filter(n => !n['read'] && n['priority'] === 'high')
      .slice(0, 2)
      .map(n => ({
        kind: 'notif' as const,
        id:   n['id'] as string,
        text: String(n['title'] ?? n['message'] ?? n['id']),
        tab:  'notifications',
        link: n['link'] as NextActionItem['link'],
      }))

    return [...highActions, ...critTickets, ...urgentNotifs]
  }, [actionItems, tickets, notifications])

  // Nothing to show — render nothing
  if (items.length === 0) return null

  return (
    <section
      aria-label="Next actions"
      style={{
        background:   'var(--jarvis-cd)',
        border:       '1px solid var(--jarvis-bd)',
        borderRadius: 10,
        padding:      '12px 14px',
        marginBottom: 16,
      }}
    >
      {/* Header row */}
      <div
        style={{
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'space-between',
          marginBottom:   10,
        }}
      >
        <div
          style={{
            fontSize:   12,
            fontWeight: 700,
            color:      'var(--jarvis-tx)',
            display:    'flex',
            alignItems: 'center',
            gap:        6,
          }}
        >
          <span
            style={{
              display:         'inline-flex',
              alignItems:      'center',
              justifyContent:  'center',
              width:           18,
              height:          18,
              borderRadius:    5,
              background:      'var(--jarvis-ac)',
              color:           '#fff',
              fontSize:        9,
              fontWeight:      800,
            }}
          >
            {items.length}
          </span>
          Next Actions
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={onViewTimeline}
            aria-label="View activity timeline"
            style={{
              background:   'transparent',
              border:       '1px solid var(--jarvis-bd)',
              borderRadius: 6,
              padding:      '3px 9px',
              fontSize:     10,
              color:        'var(--jarvis-ts)',
              cursor:       'pointer',
            }}
          >
            Timeline
          </button>
          <button
            onClick={onCreateAction}
            aria-label="Create new action item"
            style={{
              background:   'var(--jarvis-ac)',
              border:       'none',
              borderRadius: 6,
              padding:      '3px 9px',
              fontSize:     10,
              fontWeight:   600,
              color:        '#fff',
              cursor:       'pointer',
            }}
          >
            + Action
          </button>
        </div>
      </div>

      {/* Item list */}
      <ul
        role="list"
        style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 5 }}
      >
        {items.map(item => (
          <li key={`${item.kind}-${item.id}`}>
            <button
              onClick={() => onOpen(item)}
              aria-label={`${KIND_LABEL[item.kind]}: ${item.text}`}
              style={{
                width:          '100%',
                display:        'flex',
                alignItems:     'center',
                gap:            8,
                background:     'var(--jarvis-sf)',
                border:         '1px solid var(--jarvis-bd)',
                borderRadius:   6,
                padding:        '7px 10px',
                cursor:         'pointer',
                textAlign:      'left',
                transition:     'border-color 0.15s',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--jarvis-ac)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--jarvis-bd)' }}
            >
              <KindBadge kind={item.kind} />
              <span
                style={{
                  flex:         1,
                  fontSize:     11,
                  color:        'var(--jarvis-tx)',
                  whiteSpace:   'nowrap',
                  overflow:     'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {item.text}
              </span>
              <span
                aria-hidden
                style={{ fontSize: 14, color: 'var(--jarvis-td)', flexShrink: 0 }}
              >
                ›
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default NextActionsBar
