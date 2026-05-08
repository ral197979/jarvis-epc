/**
 * Denver Engineering — Workload Summary Cards (v4.34.0)
 * ──────────────────────────────────────────────────────
 * Ava Phase 2 — Assignee workload overview cards.
 *
 * Fetches GET /api/v1/actions/analytics/workload.
 * Renders cards showing each assignee's open, overdue, and avg age.
 */
import React, { useEffect, useState } from 'react'

interface AssigneeWorkload {
  user_id:      string
  email:        string
  open_count:   number
  overdue_count: number
  avg_age_hours: number
}

interface WorkloadSummaryCardsProps {
  limit?:    number
  compact?:  boolean
}

function initials(email: string): string {
  const parts = email.split('@')[0]?.split('.') ?? []
  return parts.slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('')
}

function Card({ w }: { w: AssigneeWorkload }) {
  const overdueRatio = w.open_count > 0 ? w.overdue_count / w.open_count : 0
  const barColor = overdueRatio > 0.5 ? '#dc2626' : overdueRatio > 0.2 ? '#f97316' : '#10b981'

  return (
    <div style={{
      background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8,
      padding: '12px 16px', minWidth: 180, flex: '1 1 180px',
    }}>
      {/* Avatar + name */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div style={{
          width: 32, height: 32, borderRadius: '50%',
          background: '#eff6ff', color: '#2563eb',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 700, fontSize: 12,
        }}>
          {initials(w.email)}
        </div>
        <div style={{ fontSize: 12, fontWeight: 500, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {w.email.split('@')[0]}
        </div>
      </div>

      {/* Metrics */}
      <div style={{ display: 'flex', gap: 16, fontSize: 12 }}>
        <div>
          <div style={{ color: '#9ca3af' }}>Open</div>
          <div style={{ fontWeight: 700, fontSize: 18, color: '#111827' }}>{w.open_count}</div>
        </div>
        <div>
          <div style={{ color: '#9ca3af' }}>Overdue</div>
          <div style={{ fontWeight: 700, fontSize: 18, color: w.overdue_count > 0 ? '#dc2626' : '#111827' }}>
            {w.overdue_count}
          </div>
        </div>
        <div>
          <div style={{ color: '#9ca3af' }}>Avg age</div>
          <div style={{ fontWeight: 600, fontSize: 14, color: '#374151' }}>
            {w.avg_age_hours < 24
              ? `${Math.round(w.avg_age_hours)}h`
              : `${Math.round(w.avg_age_hours / 24)}d`}
          </div>
        </div>
      </div>

      {/* Overdue bar */}
      <div style={{ marginTop: 10, height: 3, background: '#f3f4f6', borderRadius: 2 }}>
        <div style={{
          height: '100%', borderRadius: 2, background: barColor,
          width: `${Math.round(overdueRatio * 100)}%`, transition: 'width 0.3s',
        }} />
      </div>
    </div>
  )
}

export function WorkloadSummaryCards({ limit = 10, compact = false }: WorkloadSummaryCardsProps) {
  const [workload, setWorkload] = useState<AssigneeWorkload[]>([])
  const [loading, setLoading]  = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/v1/actions/analytics/workload?limit=${limit}`)
      .then(r => r.json())
      .then(j => setWorkload(j.data ?? []))
      .catch(() => setWorkload([]))
      .finally(() => setLoading(false))
  }, [limit])

  if (loading) {
    return <div style={{ color: '#9ca3af', fontSize: 13, padding: 8 }}>Loading workload…</div>
  }

  if (workload.length === 0) {
    return <div style={{ color: '#9ca3af', fontSize: 13, padding: 8 }}>No active assignments.</div>
  }

  if (compact) {
    // Compact: simple table
    return (
      <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}>
            <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 500 }}>Assignee</th>
            <th style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 500 }}>Open</th>
            <th style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 500 }}>Overdue</th>
          </tr>
        </thead>
        <tbody>
          {workload.map(w => (
            <tr key={w.user_id} style={{ borderBottom: '1px solid #f3f4f6' }}>
              <td style={{ padding: '6px 8px', color: '#374151' }}>{w.email.split('@')[0]}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600 }}>{w.open_count}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right', color: w.overdue_count > 0 ? '#dc2626' : '#374151', fontWeight: 600 }}>
                {w.overdue_count}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      {workload.map(w => <Card key={w.user_id} w={w} />)}
    </div>
  )
}
