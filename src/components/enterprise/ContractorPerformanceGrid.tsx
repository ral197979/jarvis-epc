/**
 * Denver Engineering — Contractor Performance Grid (v4.40.0)
 * ────────────────────────────────────────────────────────────
 * Ava Phase 4 — Assignee performance summary with completion rates,
 * overdue counts, and escalation signals.
 */
import React, { useEffect, useState } from 'react'

interface ContractorMetrics {
  assignee_id:           string
  total_assigned:        number
  completed:             number
  overdue:               number
  escalated:             number
  avg_completion_hours:  number | null
}

function _completionRate(m: ContractorMetrics): number {
  if (!m.total_assigned) return 0
  return Math.round((m.completed / m.total_assigned) * 100)
}

function _riskLevel(m: ContractorMetrics): 'high' | 'medium' | 'low' {
  if (m.overdue > 5 || m.escalated > 2) return 'high'
  if (m.overdue > 1 || m.escalated > 0) return 'medium'
  return 'low'
}

const RISK_COLORS = { high: '#dc2626', medium: '#f97316', low: '#10b981' }

interface ContractorPerformanceGridProps {
  onSelect?: (assigneeId: string) => void
}

export function ContractorPerformanceGrid({ onSelect }: ContractorPerformanceGridProps) {
  const [metrics, setMetrics] = useState<ContractorMetrics[]>([])
  const [loading, setLoading] = useState(true)
  const [sortKey, setSortKey] = useState<'overdue' | 'completed' | 'total_assigned'>('overdue')

  useEffect(() => {
    setLoading(true)
    fetch('/api/v1/executive/contractor-performance')
      .then(r => r.json())
      .then(j => setMetrics(j.data ?? []))
      .catch(() => setMetrics([]))
      .finally(() => setLoading(false))
  }, [])

  const sorted = [...metrics].sort((a, b) => (b[sortKey] ?? 0) - (a[sortKey] ?? 0))

  if (loading) return <div style={{ padding: 16, color: '#9ca3af', fontSize: 13 }}>Loading contractor data…</div>

  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>Contractor Performance</div>
        <select value={sortKey} onChange={e => setSortKey(e.target.value as typeof sortKey)}
          style={{ fontSize: 11, padding: '3px 6px', borderRadius: 4, border: '1px solid #d1d5db' }}>
          <option value="overdue">Sort: Overdue</option>
          <option value="completed">Sort: Completed</option>
          <option value="total_assigned">Sort: Total</option>
        </select>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: '#f9fafb' }}>
              {['Assignee', 'Total', 'Completed', 'Overdue', 'Escalated', 'Avg Hrs', 'Risk'].map(h => (
                <th key={h} style={{ padding: '6px 10px', textAlign: h === 'Assignee' ? 'left' : 'center',
                  color: '#6b7280', fontWeight: 500, borderBottom: '1px solid #e5e7eb', fontSize: 11 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map(m => {
              const rate  = _completionRate(m)
              const risk  = _riskLevel(m)
              const color = RISK_COLORS[risk]
              return (
                <tr key={m.assignee_id} onClick={() => onSelect?.(m.assignee_id)}
                  style={{ borderBottom: '1px solid #f3f4f6', cursor: onSelect ? 'pointer' : 'default' }}>
                  <td style={{ padding: '8px 10px', color: '#374151', fontFamily: 'monospace', fontSize: 11 }}>
                    {m.assignee_id.slice(0, 8)}…
                  </td>
                  <td style={{ textAlign: 'center', padding: '8px 6px', color: '#374151' }}>{m.total_assigned}</td>
                  <td style={{ textAlign: 'center', padding: '8px 6px' }}>
                    <div style={{ fontSize: 12, color: '#10b981', fontWeight: 600 }}>{m.completed}</div>
                    <div style={{ fontSize: 9, color: '#9ca3af' }}>{rate}%</div>
                  </td>
                  <td style={{ textAlign: 'center', padding: '8px 6px', fontWeight: 600,
                    color: m.overdue > 0 ? '#dc2626' : '#9ca3af' }}>
                    {m.overdue}
                  </td>
                  <td style={{ textAlign: 'center', padding: '8px 6px', color: m.escalated > 0 ? '#f97316' : '#9ca3af', fontWeight: 600 }}>
                    {m.escalated}
                  </td>
                  <td style={{ textAlign: 'center', padding: '8px 6px', color: '#6b7280' }}>
                    {m.avg_completion_hours !== null ? `${m.avg_completion_hours}h` : '—'}
                  </td>
                  <td style={{ textAlign: 'center', padding: '8px 6px' }}>
                    <span style={{ fontSize: 9, fontWeight: 600, padding: '2px 6px', borderRadius: 10,
                      background: `${color}18`, color }}>
                      {risk}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
