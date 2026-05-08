/**
 * JARVIS EPC — NotificationsView  ·  Notification Stream  (P4)
 */
import React, { useState } from 'react'
import { useBizStore } from '../modules/biz/store'
import type { PolicyConfig } from '../modules/biz/dispatch'

interface Notification {
  id: string
  title: string
  body?: string
  kind: 'info' | 'warning' | 'error' | 'success'
  read: boolean
  ts: number
  source?: string
  action_url?: string
}

export interface NotificationsViewProps { policy?: Partial<PolicyConfig>; biz?: Record<string, unknown> }

const KIND_COLOR: Record<string, string> = {
  info: 'var(--jarvis-blue,#3498db)', warning: 'var(--jarvis-amb,#f39c12)',
  error: 'var(--jarvis-red,#e74c3c)', success: 'var(--jarvis-grn,#27ae60)',
}
const KIND_ICON: Record<string, string> = { info: 'ℹ️', warning: '⚠️', error: '🚨', success: '✅' }

export function NotificationsView({ policy: _policy }: NotificationsViewProps) {
  const raw = useBizStore(s => s.biz.notifications ?? []) as unknown as Notification[]
  const dispatch = useBizStore(s => s.dispatch)
  const [filter, setFilter] = useState<'all' | 'unread'>('unread')

  const demo: Notification[] = raw.length === 0 ? [
    { id: 'N1', title: 'RFI #007 response overdue',      body: 'Structural RFI from A. Smith is 3 days past due.',          kind: 'warning', read: false, ts: Date.now() - 3600000,   source: 'RFIs' },
    { id: 'N2', title: 'Budget threshold exceeded',       body: 'Project Sigma has consumed 92% of its approved budget.',    kind: 'error',   read: false, ts: Date.now() - 7200000,   source: 'Budget' },
    { id: 'N3', title: 'Inspection completed',            body: 'Mechanical pre-commissioning inspection passed.',           kind: 'success', read: false, ts: Date.now() - 14400000,  source: 'Inspections' },
    { id: 'N4', title: 'New submittal received',          body: 'Vendor HVAC submittal package ready for review.',           kind: 'info',    read: false, ts: Date.now() - 86400000,  source: 'Submittals' },
    { id: 'N5', title: 'Gateway API key expiring soon',   body: 'Your Anthropic API key expires in 7 days.',                kind: 'warning', read: true,  ts: Date.now() - 172800000, source: 'System' },
    { id: 'N6', title: 'Punch list item closed',          body: 'Item PL-042 closed by Jordan Kim.',                        kind: 'success', read: true,  ts: Date.now() - 259200000, source: 'Punch List' },
  ] : raw

  const displayed = filter === 'unread' ? demo.filter(n => !n.read) : demo
  const unreadCount = demo.filter(n => !n.read).length

  const markRead = (id: string) => {
    dispatch({ type: 'notif/mark_read', data: { id } })
  }

  const markAllRead = () => {
    demo.filter(n => !n.read).forEach(n => dispatch({ type: 'notif/mark_read', data: { id: n.id } }))
  }

  const timeAgo = (ts: number) => {
    const diff = Date.now() - ts
    if (diff < 60000) return 'just now'
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
    return `${Math.floor(diff / 86400000)}d ago`
  }

  return (
    <div role="main" aria-label="Notifications">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Notifications</h2>
        {unreadCount > 0 && <span style={{ background: 'var(--jarvis-ac)', color: '#fff', borderRadius: 12, padding: '1px 8px', fontSize: 11, fontWeight: 700 }}>{unreadCount} new</span>}
        {unreadCount > 0 && <button onClick={markAllRead} style={{ marginLeft: 'auto', padding: '5px 12px', fontSize: 11, background: 'transparent', border: '1px solid var(--jarvis-bd)', borderRadius: 4, color: 'var(--jarvis-ts)', cursor: 'pointer' }}>Mark all read</button>}
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 12, borderBottom: '1px solid var(--jarvis-bd)' }}>
        {(['unread', 'all'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{ padding: '7px 14px 9px', background: 'transparent', border: 'none', borderBottom: filter === f ? '2px solid var(--jarvis-ac)' : '2px solid transparent', color: filter === f ? 'var(--jarvis-tx)' : 'var(--jarvis-ts)', fontWeight: filter === f ? 700 : 400, fontSize: 12, cursor: 'pointer' }}>
            {f === 'unread' ? `Unread (${unreadCount})` : 'All'}
          </button>
        ))}
      </div>

      {displayed.length === 0 ? (
        <div className="jarvis-empty"><span className="jarvis-empty-icon">🔔</span><span>All caught up — no unread notifications</span></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {displayed.map(n => (
            <div key={n.id} onClick={() => !n.read && markRead(n.id)} style={{ display: 'flex', gap: 12, padding: 12, border: '1px solid var(--jarvis-bd)', borderLeft: `3px solid ${KIND_COLOR[n.kind] ?? 'var(--jarvis-ts)'}`, borderRadius: 6, background: n.read ? undefined : 'var(--jarvis-bg2)', cursor: n.read ? 'default' : 'pointer', opacity: n.read ? 0.7 : 1 }}>
              <span style={{ fontSize: 18, flexShrink: 0 }}>{KIND_ICON[n.kind]}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontWeight: n.read ? 400 : 700, fontSize: 13 }}>{n.title}</span>
                  {n.source && <span style={{ fontSize: 10, color: 'var(--jarvis-ts)', background: 'var(--jarvis-bg)', padding: '1px 6px', borderRadius: 8, border: '1px solid var(--jarvis-bd)' }}>{n.source}</span>}
                  <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--jarvis-ts)', flexShrink: 0 }}>{timeAgo(n.ts)}</span>
                </div>
                {n.body && <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--jarvis-ts)', lineHeight: 1.4 }}>{n.body}</p>}
              </div>
              {!n.read && <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--jarvis-ac)', flexShrink: 0, marginTop: 4 }} />}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default NotificationsView
