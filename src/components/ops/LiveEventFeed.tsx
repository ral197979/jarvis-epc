/**
 * Denver Engineering — Live Event Feed (v4.35.0)
 * ─────────────────────────────────────────────────
 * Ava Phase 3 — Real-time operational event stream.
 * WebSocket primary, polling fallback.
 * Virtualized rendering for high-volume feeds.
 */
import React, { useEffect, useRef, useState, useCallback } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface LiveEvent {
  id?:                string
  event_type:         string
  tenant_id:          string
  payload:            Record<string, unknown>
  subscription_scope: string
  scope_id?:          string
  sequence_number?:   number
  published_at?:      string
}

interface LiveEventFeedProps {
  tenantId:   string
  projectId?: string
  maxEvents?: number
  height?:    number
  onEvent?:   (e: LiveEvent) => void
}

// ─── Event type display config ────────────────────────────────────────────────

const EVENT_CONFIG: Record<string, { icon: string; color: string; label: string }> = {
  action_created:       { icon: '✨', color: '#3b82f6', label: 'Action Created' },
  action_updated:       { icon: '📝', color: '#6b7280', label: 'Action Updated' },
  escalation_triggered: { icon: '⬆',  color: '#f97316', label: 'Escalation' },
  blocker_added:        { icon: '🔒', color: '#dc2626', label: 'Blocker Added' },
  blocker_removed:      { icon: '🔓', color: '#10b981', label: 'Blocker Removed' },
  readiness_changed:    { icon: '📊', color: '#8b5cf6', label: 'Readiness Changed' },
  incident_reported:    { icon: '🚨', color: '#dc2626', label: 'Incident' },
  inspection_failed:    { icon: '❌', color: '#dc2626', label: 'Inspection Failed' },
  notification_failed:  { icon: '📵', color: '#f97316', label: 'Notification Failed' },
  sync_completed:       { icon: '🔄', color: '#10b981', label: 'Sync Completed' },
  command_issued:       { icon: '⚡', color: '#7c3aed', label: 'Command Issued' },
  evidence_uploaded:    { icon: '📎', color: '#0891b2', label: 'Evidence Uploaded' },
  breach_predicted:     { icon: '⚠',  color: '#f59e0b', label: 'Breach Predicted' },
  recommendation_ready: { icon: '💡', color: '#10b981', label: 'Recommendation' },
}

function _relativeTime(iso?: string): string {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000)     return 'just now'
  if (diff < 3_600_000)  return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return new Date(iso).toLocaleDateString()
}

// ─── Event row ────────────────────────────────────────────────────────────────

function EventRow({ event }: { event: LiveEvent }) {
  const cfg   = EVENT_CONFIG[event.event_type] ?? { icon: '•', color: '#6b7280', label: event.event_type }
  const title = (event.payload['title'] ?? event.payload['action_id'] ?? cfg.label) as string

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10,
      padding: '8px 12px', borderBottom: '1px solid #f3f4f6' }}>
      <div style={{ width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
        background: `${cfg.color}18`, border: `1.5px solid ${cfg.color}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>
        {cfg.icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: '#111827',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
            {cfg.label}
            {title !== cfg.label && (
              <span style={{ color: '#6b7280', fontWeight: 400 }}> — {String(title).slice(0, 60)}</span>
            )}
          </div>
          <div style={{ fontSize: 10, color: '#9ca3af', whiteSpace: 'nowrap' }}>
            {_relativeTime(event.published_at)}
          </div>
        </div>
        {event.sequence_number && (
          <div style={{ fontSize: 10, color: '#d1d5db' }}>seq #{event.sequence_number}</div>
        )}
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

const POLL_INTERVAL = 10_000

export function LiveEventFeed({
  tenantId, projectId, maxEvents = 100, height = 400, onEvent,
}: LiveEventFeedProps) {
  const [events, setEvents]     = useState<LiveEvent[]>([])
  const [connected, setConnected] = useState(false)
  const [lastSeq, setLastSeq]   = useState(0)
  const wsRef    = useRef<WebSocket | null>(null)
  const pollRef  = useRef<ReturnType<typeof setInterval> | null>(null)
  const feedRef  = useRef<HTMLDivElement | null>(null)
  const autoScroll = useRef(true)

  const addEvents = useCallback((incoming: LiveEvent[]) => {
    if (!incoming.length) return
    setEvents(prev => {
      const merged = [...incoming, ...prev].slice(0, maxEvents)
      return merged
    })
    const maxS = Math.max(...incoming.map(e => e.sequence_number ?? 0))
    if (maxS > 0) setLastSeq(prev => Math.max(prev, maxS))
    incoming.forEach(e => onEvent?.(e))
    if (autoScroll.current && feedRef.current) feedRef.current.scrollTop = 0
  }, [maxEvents, onEvent])

  // ─── WebSocket connection ────────────────────────────────────────────────

  const connectWs = useCallback(() => {
    try {
      const params = new URLSearchParams({ tenant_id: tenantId, user_id: 'ui',
        last_seq: String(lastSeq) })
      if (projectId) params.set('replay_scope', 'project')
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?${params}`)

      ws.onopen = () => {
        setConnected(true)
        if (projectId) ws.send(JSON.stringify({ type: 'subscribe', scope: 'project', scope_id: projectId }))
      }
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data as string) as { type: string; data?: LiveEvent }
          if (msg.type === 'event' && msg.data) addEvents([msg.data])
        } catch { /* ignore malformed */ }
      }
      ws.onclose  = () => { setConnected(false); wsRef.current = null }
      ws.onerror  = () => { ws.close() }
      wsRef.current = ws
    } catch {
      setConnected(false)
    }
  }, [tenantId, projectId, lastSeq, addEvents])

  // ─── Polling fallback ────────────────────────────────────────────────────

  const poll = useCallback(async () => {
    try {
      const params = new URLSearchParams({ last_seq: String(lastSeq) })
      if (projectId) { params.set('scope', 'project'); params.set('scope_id', projectId) }
      const res = await fetch(`/api/v1/ops/live-feed?${params}`)
      const j   = await res.json()
      if (j.data?.length) addEvents(j.data as LiveEvent[])
    } catch { /* ignore */ }
  }, [lastSeq, projectId, addEvents])

  useEffect(() => {
    connectWs()
    // Polling fallback always runs (catches events missed during WS down)
    pollRef.current = setInterval(poll, POLL_INTERVAL)
    return () => {
      wsRef.current?.close()
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const statusDot = { width: 7, height: 7, borderRadius: '50%',
    background: connected ? '#10b981' : '#f97316',
    display: 'inline-block', marginRight: 6,
    ...(connected ? { boxShadow: '0 0 0 2px #d1fae5' } : {}),
  }

  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8,
      display: 'flex', flexDirection: 'column', height }}>
      {/* Header */}
      <div style={{ padding: '10px 12px', borderBottom: '1px solid #e5e7eb',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>Live Feed</div>
        <div style={{ fontSize: 11, color: '#6b7280' }}>
          <span style={statusDot} />
          {connected ? 'Live' : 'Polling'}
          {events.length > 0 && <span style={{ marginLeft: 8 }}>{events.length} events</span>}
        </div>
      </div>

      {/* Events */}
      <div
        ref={feedRef}
        onScroll={e => { autoScroll.current = (e.currentTarget.scrollTop < 50) }}
        style={{ flex: 1, overflowY: 'auto' }}
      >
        {events.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>
            Waiting for events…
          </div>
        ) : (
          events.map((ev, i) => <EventRow key={`${ev.sequence_number ?? i}-${ev.event_type}`} event={ev} />)
        )}
      </div>
    </div>
  )
}
