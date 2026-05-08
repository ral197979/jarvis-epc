// Denver Engineering — Tenant Operational Timeline (Phase 11)
// Show a chronological view of events: deployments, incidents, import jobs, alerts

import React, { useEffect, useState, useCallback } from 'react'

interface TimelineEvent {
  id: string
  type: 'deployment' | 'incident' | 'import' | 'alert' | 'milestone' | 'checklist'
  title: string
  description: string
  severity?: 'critical' | 'warning' | 'info'
  status?: string
  occurredAt: string
}

interface TenantOperationalTimelineProps {
  tenantId: string
}

const TYPE_ICONS: Record<string, string> = {
  deployment: '🚀',
  incident: '🔴',
  import: '📥',
  alert: '⚠',
  milestone: '🏆',
  checklist: '✓',
}

const TYPE_COLORS: Record<string, string> = {
  deployment: '#3b82f6',
  incident: '#ef4444',
  import: '#8b5cf6',
  alert: '#f59e0b',
  milestone: '#22c55e',
  checklist: '#06b6d4',
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#ef4444',
  warning: '#f59e0b',
  info: '#3b82f6',
}

export function TenantOperationalTimeline({ tenantId }: TenantOperationalTimelineProps) {
  const [events, setEvents] = useState<TimelineEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [typeFilter, setTypeFilter] = useState<string>('all')

  const fetchTimeline = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/phase11/tenants/${tenantId}/timeline`)
      const data = await res.json()
      setEvents(data.events ?? [])
    } finally {
      setLoading(false)
    }
  }, [tenantId])

  useEffect(() => { fetchTimeline() }, [fetchTimeline])

  const allTypes = ['all', ...Array.from(new Set(events.map(e => e.type)))]
  const filtered = typeFilter === 'all' ? events : events.filter(e => e.type === typeFilter)

  const groupedByDate = filtered.reduce<Record<string, TimelineEvent[]>>((acc, event) => {
    const date = new Date(event.occurredAt).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    })
    if (!acc[date]) acc[date] = []
    acc[date].push(event)
    return acc
  }, {})

  return (
    <div style={{ background: '#0f172a', color: '#e2e8f0', fontFamily: 'sans-serif', padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Operational Timeline</h2>
          <p style={{ margin: '4px 0 0', color: '#94a3b8', fontSize: 13 }}>
            {filtered.length} events
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {allTypes.map(t => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              style={{
                padding: '5px 10px', borderRadius: 6, border: '1px solid',
                borderColor: typeFilter === t ? (TYPE_COLORS[t] ?? '#3b82f6') : '#334155',
                background: typeFilter === t ? (TYPE_COLORS[t] ?? '#3b82f6') + '20' : 'transparent',
                color: typeFilter === t ? (TYPE_COLORS[t] ?? '#3b82f6') : '#94a3b8',
                cursor: 'pointer', fontSize: 11, textTransform: 'capitalize',
              }}
            >
              {t !== 'all' && TYPE_ICONS[t] ? `${TYPE_ICONS[t]} ` : ''}{t}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ color: '#64748b', textAlign: 'center', padding: 40 }}>Loading timeline…</div>
      ) : (
        <div style={{ position: 'relative' }}>
          {/* Vertical line */}
          <div style={{
            position: 'absolute', left: 20, top: 0, bottom: 0, width: 2, background: '#1e293b',
          }} />

          {Object.entries(groupedByDate).map(([date, dateEvents]) => (
            <div key={date} style={{ marginBottom: 24 }}>
              <div style={{
                position: 'relative', marginLeft: 44, marginBottom: 12,
                fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em',
              }}>
                {date}
              </div>

              {dateEvents.map(event => {
                const typeColor = TYPE_COLORS[event.type] ?? '#64748b'
                const severityColor = event.severity ? SEVERITY_COLORS[event.severity] : typeColor
                return (
                  <div key={event.id} style={{ display: 'flex', marginBottom: 12, alignItems: 'flex-start' }}>
                    {/* Timeline dot */}
                    <div style={{
                      width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                      background: typeColor + '20', border: `2px solid ${typeColor}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 14, zIndex: 1,
                    }}>
                      {TYPE_ICONS[event.type] ?? '•'}
                    </div>

                    {/* Event card */}
                    <div style={{
                      marginLeft: 12, flex: 1, background: '#1e293b', borderRadius: 8, padding: 12,
                      border: `1px solid ${event.severity === 'critical' ? '#ef444433' : '#334155'}`,
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13, color: '#e2e8f0' }}>{event.title}</div>
                          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{event.description}</div>
                        </div>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          {event.severity && (
                            <span style={{
                              background: severityColor + '22', color: severityColor,
                              border: `1px solid ${severityColor}44`,
                              borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
                            }}>
                              {event.severity}
                            </span>
                          )}
                          <span style={{ fontSize: 11, color: '#475569' }}>
                            {new Date(event.occurredAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </div>
                      {event.status && (
                        <div style={{ marginTop: 6, fontSize: 11, color: '#64748b' }}>
                          Status: <span style={{ color: '#94a3b8' }}>{event.status}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          ))}

          {filtered.length === 0 && (
            <div style={{ textAlign: 'center', color: '#64748b', padding: 40, marginLeft: 40 }}>
              No timeline events found.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
