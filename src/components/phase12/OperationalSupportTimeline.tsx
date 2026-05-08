// Denver Engineering — Operational Support Timeline (Phase 12)
// Chronological view of support events for a tenant

import React, { useState, useEffect } from 'react'

interface TimelineEvent {
  id: string
  type: 'support_opened' | 'escalated' | 'replay_started' | 'root_cause_found' | 'resolved'
  title: string
  detail: string
  priority?: string
  at: string
}

const EVENT_ICONS: Record<string, string> = {
  support_opened: '🎯',
  escalated: '⬆️',
  replay_started: '🔁',
  root_cause_found: '🔍',
  resolved: '✅',
}

const EVENT_COLORS: Record<string, string> = {
  support_opened: '#64748b',
  escalated: '#f97316',
  replay_started: '#8b5cf6',
  root_cause_found: '#3b82f6',
  resolved: '#22c55e',
}

interface OperationalSupportTimelineProps {
  tenantId: string
}

export function OperationalSupportTimeline({ tenantId }: OperationalSupportTimelineProps) {
  const [events, setEvents] = useState<TimelineEvent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/phase12/support/timeline?tenantId=${tenantId}`)
        const data = await res.json()
        setEvents(data.events ?? [])
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [tenantId])

  // Group by date
  const grouped = events.reduce<Record<string, TimelineEvent[]>>((acc, e) => {
    const date = new Date(e.at).toLocaleDateString()
    if (!acc[date]) acc[date] = []
    acc[date].push(e)
    return acc
  }, {})

  return (
    <div style={{ background: '#0a0f1e', fontFamily: 'sans-serif', padding: 24 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0', marginBottom: 20 }}>
        📋 Support Timeline — {tenantId.slice(0, 12)}…
      </div>

      {loading ? (
        <div style={{ color: '#64748b', textAlign: 'center', padding: 40 }}>Loading…</div>
      ) : events.length === 0 ? (
        <div style={{ color: '#64748b', textAlign: 'center', padding: 40 }}>No support events found.</div>
      ) : (
        <div>
          {Object.entries(grouped).map(([date, dayEvents]) => (
            <div key={date} style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 12, fontWeight: 700, textTransform: 'uppercase' }}>
                {date}
              </div>
              <div style={{ position: 'relative', paddingLeft: 24 }}>
                {/* Timeline line */}
                <div style={{
                  position: 'absolute', left: 7, top: 0, bottom: 0,
                  width: 2, background: '#1e293b',
                }} />
                {dayEvents.map(event => (
                  <div key={event.id} style={{ position: 'relative', marginBottom: 16 }}>
                    {/* Dot */}
                    <div style={{
                      position: 'absolute', left: -20, top: 3,
                      width: 14, height: 14, borderRadius: '50%',
                      background: EVENT_COLORS[event.type] ?? '#64748b',
                      border: '2px solid #0a0f1e',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 8,
                    }}>
                      {EVENT_ICONS[event.type]}
                    </div>
                    <div style={{
                      background: '#0f172a', border: '1px solid #1e293b',
                      borderRadius: 6, padding: '10px 14px',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>
                          {EVENT_ICONS[event.type]} {event.title}
                        </div>
                        <div style={{ fontSize: 11, color: '#64748b' }}>
                          {new Date(event.at).toLocaleTimeString()}
                        </div>
                      </div>
                      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>{event.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
