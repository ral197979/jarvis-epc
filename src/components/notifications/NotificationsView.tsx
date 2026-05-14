/**
 * Denver Engineering — Notifications View (v10.14.0)
 *
 * Alert center: budget thresholds, overdue actions, bid deadlines,
 * meetings today, stale COs, pending invoices.
 */
import React, { useEffect, useState, useCallback } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

type NotifPriority = 'low' | 'medium' | 'high' | 'critical'
type NotifCategory =
  | 'budget' | 'schedule' | 'action_item' | 'bid_deadline'
  | 'meeting' | 'compliance' | 'change_order' | 'invoice' | 'team' | 'system'

interface Notification {
  id:          string
  category:    NotifCategory
  priority:    NotifPriority
  title:       string
  body:        string | null
  sourceType:  string | null
  linkTab:     string | null
  readAt:      string | null
  createdAt:   string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PRIORITY_COLOR: Record<NotifPriority, string> = {
  critical: '#ef4444',
  high:     '#f97316',
  medium:   '#f59e0b',
  low:      '#6b7280',
}

const CATEGORY_ICON: Record<NotifCategory, string> = {
  budget:        '💰',
  schedule:      '📅',
  action_item:   '⚡',
  bid_deadline:  '📄',
  meeting:       '📋',
  compliance:    '🛡️',
  change_order:  '🔄',
  invoice:       '🧾',
  team:          '👥',
  system:        '⚙️',
}

const CATEGORY_LABEL: Record<NotifCategory, string> = {
  budget:        'Budget',
  schedule:      'Schedule',
  action_item:   'Action Items',
  bid_deadline:  'Bid Deadlines',
  meeting:       'Meetings',
  compliance:    'Compliance',
  change_order:  'Change Orders',
  invoice:       'Invoices',
  team:          'Team',
  system:        'System',
}

function timeAgo(iso: string): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60)    return 'just now'
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

// ─── Notif row ────────────────────────────────────────────────────────────────

function NotifRow({
  n, onRead, onDismiss, onNavigate,
}: {
  n:          Notification
  onRead:     (id: string) => void
  onDismiss:  (id: string) => void
  onNavigate: (tab: string) => void
}) {
  const unread = !n.readAt
  return (
    <div
      style={{
        display: 'flex', gap: 12, padding: '12px 16px',
        borderBottom: '1px solid var(--jarvis-b)',
        background: unread ? 'var(--jarvis-s2)' : 'transparent',
        opacity: unread ? 1 : 0.65,
        cursor: 'pointer',
        transition: 'background .15s',
      }}
      onClick={() => { if (unread) onRead(n.id) }}
    >
      {/* Priority stripe */}
      <div style={{ width: 3, borderRadius: 2, flexShrink: 0, background: PRIORITY_COLOR[n.priority], alignSelf: 'stretch' }} />

      {/* Icon */}
      <div style={{ fontSize: 20, lineHeight: 1, marginTop: 1, flexShrink: 0 }}>
        {CATEGORY_ICON[n.category]}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: unread ? 600 : 400, color: 'var(--jarvis-t)', lineHeight: 1.3 }}>
            {n.title}
          </div>
          <div style={{ display: 'flex', gap: 4, flexShrink: 0, alignItems: 'center' }}>
            <span style={{ fontSize: 10, color: 'var(--jarvis-ts)', whiteSpace: 'nowrap' }}>{timeAgo(n.createdAt)}</span>
            {n.linkTab && (
              <button
                onClick={e => { e.stopPropagation(); onNavigate(n.linkTab!); onRead(n.id) }}
                title="Go to view"
                style={{ padding: '2px 6px', borderRadius: 4, border: '1px solid var(--jarvis-b)', background: 'none', color: 'var(--jarvis-ts)', cursor: 'pointer', fontSize: 11 }}
              >→</button>
            )}
            <button
              onClick={e => { e.stopPropagation(); onDismiss(n.id) }}
              title="Dismiss"
              style={{ padding: '2px 6px', borderRadius: 4, border: 'none', background: 'none', color: 'var(--jarvis-ts)', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}
            >✕</button>
          </div>
        </div>
        {n.body && (
          <div style={{ fontSize: 12, color: 'var(--jarvis-ts)', marginTop: 3, lineHeight: 1.4 }}>{n.body}</div>
        )}
        <div style={{ marginTop: 4, display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 99, background: `${PRIORITY_COLOR[n.priority]}22`, color: PRIORITY_COLOR[n.priority], fontWeight: 600 }}>
            {n.priority}
          </span>
          <span style={{ fontSize: 10, color: 'var(--jarvis-ts)' }}>{CATEGORY_LABEL[n.category]}</span>
        </div>
      </div>

      {/* Unread dot */}
      {unread && (
        <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--jarvis-a)', flexShrink: 0, marginTop: 6 }} />
      )}
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

interface Props {
  policy?:     Record<string, unknown>
  biz?:        Record<string, unknown>
  onNavigate?: (tab: string) => void
}

const ALL_CATEGORIES: NotifCategory[] = [
  'budget','action_item','bid_deadline','change_order','invoice','meeting','compliance','team','system',
]

export default function NotificationsView({ onNavigate }: Props) {
  const [notifs,     setNotifs]     = useState<Notification[]>([])
  const [loading,    setLoading]    = useState(false)
  const [scanning,   setScanning]   = useState(false)
  const [lastScan,   setLastScan]   = useState<string | null>(null)
  const [filterCat,  setFilterCat]  = useState<NotifCategory | 'all'>('all')
  const [unreadOnly, setUnreadOnly] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (unreadOnly)            params.set('unread', 'true')
      if (filterCat !== 'all')   params.set('category', filterCat)
      const res  = await fetch(`/api/v1/notifications?${params}`)
      const data = await res.json() as { notifications: Notification[] }
      setNotifs(data.notifications ?? [])
    } catch { /* ignore */ } finally { setLoading(false) }
  }, [filterCat, unreadOnly])

  useEffect(() => { load() }, [load])

  const scan = async () => {
    setScanning(true)
    try {
      const res  = await fetch('/api/v1/notifications/scan', { method: 'POST' })
      const data = await res.json() as { inserted: number }
      setLastScan(`${data.inserted} new alert${data.inserted !== 1 ? 's' : ''} generated`)
      await load()
    } catch { setLastScan('Scan failed') } finally { setScanning(false) }
  }

  const handleRead = async (id: string) => {
    await fetch(`/api/v1/notifications/${id}/read`, { method: 'POST' })
    setNotifs(prev => prev.map(n => n.id === id ? { ...n, readAt: new Date().toISOString() } : n))
  }

  const handleDismiss = async (id: string) => {
    await fetch(`/api/v1/notifications/${id}/dismiss`, { method: 'POST' })
    setNotifs(prev => prev.filter(n => n.id !== id))
  }

  const handleMarkAllRead = async () => {
    await fetch('/api/v1/notifications/read-all', { method: 'POST' })
    setNotifs(prev => prev.map(n => ({ ...n, readAt: new Date().toISOString() })))
  }

  const handleClearAll = async () => {
    await fetch('/api/v1/notifications/clear', { method: 'POST' })
    setNotifs([])
  }

  const unreadCount = notifs.filter(n => !n.readAt).length

  const PRIORITY_ORDER: NotifPriority[] = ['critical','high','medium','low']
  const byCritical = notifs.filter(n => n.priority === 'critical' && !n.readAt)

  const chipS = (active: boolean): React.CSSProperties => ({
    padding: '4px 10px', borderRadius: 99, fontSize: 11, cursor: 'pointer',
    border: '1px solid var(--jarvis-b)', fontWeight: active ? 600 : 400,
    background: active ? 'var(--jarvis-a)' : 'var(--jarvis-s2)',
    color:      active ? '#fff'            : 'var(--jarvis-t)',
    whiteSpace: 'nowrap',
  })

  return (
    <div style={{ padding: 24, maxWidth: 820, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--jarvis-t)', display: 'flex', alignItems: 'center', gap: 8 }}>
            🔔 Notifications
            {unreadCount > 0 && (
              <span style={{ fontSize: 13, padding: '2px 8px', borderRadius: 99, background: '#ef4444', color: '#fff', fontWeight: 700 }}>{unreadCount}</span>
            )}
          </h2>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--jarvis-ts)' }}>Budget · Deadlines · Action Items · Invoices</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={scan} disabled={scanning}
            style={{ padding: '7px 14px', borderRadius: 7, border: '1px solid var(--jarvis-b)', background: 'var(--jarvis-s2)', color: 'var(--jarvis-t)', cursor: 'pointer', fontSize: 13, fontWeight: 600, opacity: scanning ? .6 : 1 }}>
            {scanning ? '⟳ Scanning…' : '⟳ Scan Now'}
          </button>
          {unreadCount > 0 && (
            <button onClick={handleMarkAllRead}
              style={{ padding: '7px 14px', borderRadius: 7, border: '1px solid var(--jarvis-b)', background: 'var(--jarvis-s2)', color: 'var(--jarvis-t)', cursor: 'pointer', fontSize: 13 }}>
              Mark all read
            </button>
          )}
          {notifs.length > 0 && (
            <button onClick={handleClearAll}
              style={{ padding: '7px 14px', borderRadius: 7, border: '1px solid #ef444433', background: 'transparent', color: '#ef4444', cursor: 'pointer', fontSize: 13 }}>
              Clear all
            </button>
          )}
        </div>
      </div>

      {lastScan && (
        <div style={{ padding: '8px 14px', borderRadius: 7, background: 'var(--jarvis-s2)', border: '1px solid var(--jarvis-b)', fontSize: 12, color: 'var(--jarvis-ts)' }}>
          ✓ {lastScan}
        </div>
      )}

      {/* Critical banner */}
      {byCritical.length > 0 && (
        <div style={{ padding: '12px 16px', borderRadius: 8, background: '#fef2f2', border: '1px solid #fecaca', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <span style={{ fontSize: 18 }}>🚨</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#dc2626' }}>{byCritical.length} critical alert{byCritical.length > 1 ? 's' : ''}</div>
            <div style={{ fontSize: 12, color: '#991b1b', marginTop: 2 }}>{byCritical.map(n => n.title).join(' · ')}</div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <button style={chipS(filterCat === 'all')} onClick={() => setFilterCat('all')}>All</button>
        {ALL_CATEGORIES.filter(c => notifs.some(n => n.category === c)).map(c => (
          <button key={c} style={chipS(filterCat === c)} onClick={() => setFilterCat(c)}>
            {CATEGORY_ICON[c]} {CATEGORY_LABEL[c]}
          </button>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          <label style={{ fontSize: 12, color: 'var(--jarvis-ts)', display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={unreadOnly} onChange={e => setUnreadOnly(e.target.checked)} />
            Unread only
          </label>
        </div>
      </div>

      {/* List */}
      <div style={{ background: 'var(--jarvis-s2)', border: '1px solid var(--jarvis-b)', borderRadius: 10, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: '32px', textAlign: 'center', color: 'var(--jarvis-ts)', fontSize: 13 }}>Loading…</div>
        ) : notifs.length === 0 ? (
          <div style={{ padding: '48px', textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>✓</div>
            <div style={{ fontSize: 14, color: 'var(--jarvis-t)', fontWeight: 600 }}>All clear</div>
            <div style={{ fontSize: 12, color: 'var(--jarvis-ts)', marginTop: 4 }}>
              Run a scan to check for new alerts across all modules.
            </div>
          </div>
        ) : (
          <>
            {PRIORITY_ORDER.map(priority => {
              const group = notifs.filter(n => n.priority === priority)
              if (!group.length) return null
              return (
                <div key={priority}>
                  <div style={{ padding: '6px 16px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: PRIORITY_COLOR[priority], background: `${PRIORITY_COLOR[priority]}11`, borderBottom: '1px solid var(--jarvis-b)' }}>
                    {priority} · {group.length}
                  </div>
                  {group.map(n => (
                    <NotifRow
                      key={n.id}
                      n={n}
                      onRead={handleRead}
                      onDismiss={handleDismiss}
                      onNavigate={tab => onNavigate?.(tab)}
                    />
                  ))}
                </div>
              )
            })}
          </>
        )}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 11, color: 'var(--jarvis-ts)' }}>
        {PRIORITY_ORDER.map(p => (
          <span key={p} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: PRIORITY_COLOR[p], display: 'inline-block' }} />
            {p}
          </span>
        ))}
        <span style={{ marginLeft: 'auto' }}>Click → to jump to the source view</span>
      </div>
    </div>
  )
}
