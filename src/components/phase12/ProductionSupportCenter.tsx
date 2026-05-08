// Denver Engineering — Production Support Center (Phase 12)
// Unified support view with replay-assisted diagnostics and SLA tracking

import React, { useState, useEffect } from 'react'

interface SupportRecord {
  id: string
  tenantId: string
  category: string
  priority: 'critical' | 'high' | 'medium' | 'low'
  replayAssisted: boolean
  resolutionTimeMs: number | null
  aiSummaryGenerated: boolean
  resolvedAt: string | null
  createdAt: string
}

const PRIORITY_COLORS = { critical: '#ef4444', high: '#f97316', medium: '#eab308', low: '#64748b' }
const SLA_MS = { critical: 4 * 3600000, high: 24 * 3600000, medium: 72 * 3600000, low: 7 * 24 * 3600000 }

function formatDuration(ms: number): string {
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`
  if (ms < 86400000) return `${Math.round(ms / 3600000)}h`
  return `${Math.round(ms / 86400000)}d`
}

function isSLABreached(record: SupportRecord): boolean {
  if (record.resolvedAt) return false
  const elapsed = Date.now() - new Date(record.createdAt).getTime()
  return elapsed > SLA_MS[record.priority]
}

interface ProductionSupportCenterProps {
  tenantId?: string
}

export function ProductionSupportCenter({ tenantId }: ProductionSupportCenterProps) {
  const [records, setRecords] = useState<SupportRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'open' | 'critical'>('all')
  const [selected, setSelected] = useState<SupportRecord | null>(null)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const url = tenantId
          ? `/api/phase12/support?tenantId=${tenantId}`
          : '/api/phase12/support'
        const res = await fetch(url)
        const data = await res.json()
        setRecords(data.records ?? [])
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [tenantId])

  const filtered = records.filter(r => {
    if (filter === 'open') return !r.resolvedAt
    if (filter === 'critical') return r.priority === 'critical' && !r.resolvedAt
    return true
  })

  return (
    <div style={{ display: 'flex', height: '100%', fontFamily: 'sans-serif', background: '#0a0f1e' }}>
      {/* Left Panel */}
      <div style={{ width: 380, borderRight: '1px solid #1e293b', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid #1e293b' }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: '#e2e8f0', marginBottom: 10 }}>
            🎯 Support Center
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['all', 'open', 'critical'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{
                  padding: '4px 10px', borderRadius: 4, border: 'none', cursor: 'pointer',
                  fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
                  background: filter === f ? '#3b82f6' : '#1e293b',
                  color: filter === f ? '#fff' : '#64748b',
                }}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ color: '#64748b', textAlign: 'center', padding: 24, fontSize: 13 }}>Loading…</div>
          ) : filtered.map(r => {
            const breached = isSLABreached(r)
            return (
              <div
                key={r.id}
                onClick={() => setSelected(r)}
                style={{
                  padding: '12px 16px', cursor: 'pointer', borderBottom: '1px solid #1e293b',
                  background: selected?.id === r.id ? '#1e293b' : 'transparent',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{
                    fontSize: 10, fontWeight: 700, color: PRIORITY_COLORS[r.priority],
                    textTransform: 'uppercase', letterSpacing: '0.05em',
                  }}>
                    {r.priority}
                  </span>
                  {breached && (
                    <span style={{ fontSize: 9, color: '#ef4444', background: '#ef444415', padding: '1px 5px', borderRadius: 3 }}>
                      SLA BREACH
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 13, color: '#e2e8f0', marginTop: 2 }}>{r.category}</div>
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                  Tenant: {r.tenantId.slice(0, 8)}…
                  {r.replayAssisted && ' · 🔁 replay'}
                  {r.aiSummaryGenerated && ' · 🤖 AI'}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Right Panel */}
      <div style={{ flex: 1, padding: 24 }}>
        {selected ? (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
              <span style={{
                padding: '3px 10px', borderRadius: 4, fontSize: 11, fontWeight: 700,
                background: `${PRIORITY_COLORS[selected.priority]}20`,
                color: PRIORITY_COLORS[selected.priority],
                textTransform: 'uppercase',
              }}>
                {selected.priority}
              </span>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0' }}>{selected.category}</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {[
                ['Tenant ID', selected.tenantId],
                ['Status', selected.resolvedAt ? '✅ Resolved' : '🔴 Open'],
                ['Replay Assisted', selected.replayAssisted ? '✅ Yes' : '—'],
                ['AI Summary', selected.aiSummaryGenerated ? '✅ Generated' : '—'],
                ['Resolution Time', selected.resolutionTimeMs ? formatDuration(selected.resolutionTimeMs) : 'Pending'],
                ['SLA Limit', formatDuration(SLA_MS[selected.priority])],
              ].map(([label, value]) => (
                <div key={label} style={{ background: '#1e293b', borderRadius: 6, padding: '10px 14px' }}>
                  <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', marginBottom: 3 }}>{label}</div>
                  <div style={{ fontSize: 13, color: '#e2e8f0' }}>{value}</div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ color: '#64748b', textAlign: 'center', marginTop: 80, fontSize: 13 }}>
            Select a support record to view details
          </div>
        )}
      </div>
    </div>
  )
}
