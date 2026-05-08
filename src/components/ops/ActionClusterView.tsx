/**
 * Denver Engineering — Action Cluster View (v4.35.0)
 * ─────────────────────────────────────────────────────
 * Ava Phase 3 — Groups actions by priority × module matrix,
 * enabling supervisors to spot concentrations at a glance.
 */
import React, { useEffect, useState } from 'react'

interface ClusterCell {
  count:    number
  overdue:  number
  escalated: number
}

type ClusterMatrix = Record<string, Record<string, ClusterCell>>

interface ActionClusterViewProps {
  projectId?: string
  onCellClick?: (module: string, priority: string) => void
}

const PRIORITIES = ['critical', 'high', 'medium', 'low']
const PRIORITY_COLORS: Record<string, string> = {
  critical: '#dc2626', high: '#f97316', medium: '#d97706', low: '#6b7280',
}

const MODULES = ['rfis', 'submittals', 'punch_items', 'inspections', 'compliance_tasks', 'bim_issues']
const MODULE_LABELS: Record<string, string> = {
  rfis: 'RFIs', submittals: 'Submittals', punch_items: 'Punch',
  inspections: 'Inspect.', compliance_tasks: 'Comply', bim_issues: 'BIM',
}

function _intensityColor(count: number, overdue: number): string {
  if (count === 0) return 'transparent'
  const overdueRatio = count > 0 ? overdue / count : 0
  if (overdueRatio > 0.5) return '#dc262620'
  if (count > 10)          return '#f9731620'
  if (count > 5)           return '#d9770620'
  return '#6b728015'
}

function _borderColor(count: number, overdue: number): string {
  if (count === 0) return '#f3f4f6'
  const overdueRatio = count > 0 ? overdue / count : 0
  if (overdueRatio > 0.5) return '#dc2626'
  if (count > 10)          return '#f97316'
  return '#e5e7eb'
}

export function ActionClusterView({ projectId, onCellClick }: ActionClusterViewProps) {
  const [matrix, setMatrix]   = useState<ClusterMatrix>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({ status: 'open' })
    if (projectId) params.set('project_id', projectId)
    fetch(`/api/v1/actions/inbox?${params}&limit=200`)
      .then(r => r.json())
      .then(j => {
        const data = j.data ?? []
        const m: ClusterMatrix = {}
        for (const row of data) {
          const mod  = row.source_module as string
          const pri  = row.priority as string
          if (!m[mod]) m[mod] = {}
          if (!m[mod]![pri]) m[mod]![pri] = { count: 0, overdue: 0, escalated: 0 }
          m[mod]![pri]!.count++
          if ((row.sla_remaining_minutes ?? 1) <= 0) m[mod]![pri]!.overdue++
          if ((row.max_escalation_level ?? 0) >= 1)  m[mod]![pri]!.escalated++
        }
        setMatrix(m)
      })
      .catch(() => setMatrix({}))
      .finally(() => setLoading(false))
  }, [projectId])

  if (loading) {
    return <div style={{ padding: 16, color: '#9ca3af', fontSize: 13 }}>Building cluster view…</div>
  }

  const totalsByModule = MODULES.reduce<Record<string, number>>((acc, mod) => {
    acc[mod] = PRIORITIES.reduce((s, p) => s + (matrix[mod]?.[p]?.count ?? 0), 0)
    return acc
  }, {})

  const maxCount = Math.max(...Object.values(matrix).flatMap(m => Object.values(m).map(c => c.count)), 1)

  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid #e5e7eb' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>Action Clusters</div>
        <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>By module × priority</div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: '#f9fafb' }}>
              <th style={{ textAlign: 'left', padding: '8px 10px', color: '#6b7280',
                fontWeight: 500, borderBottom: '1px solid #e5e7eb', width: 100 }}>
                Module
              </th>
              {PRIORITIES.map(p => (
                <th key={p} style={{ textAlign: 'center', padding: '8px 6px', color: PRIORITY_COLORS[p],
                  fontWeight: 600, borderBottom: '1px solid #e5e7eb', textTransform: 'capitalize' }}>
                  {p}
                </th>
              ))}
              <th style={{ textAlign: 'right', padding: '8px 10px', color: '#6b7280',
                fontWeight: 500, borderBottom: '1px solid #e5e7eb' }}>
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {MODULES.filter(mod => totalsByModule[mod]! > 0 || true).map(mod => (
              <tr key={mod} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={{ padding: '8px 10px', color: '#374151', fontWeight: 500 }}>
                  {MODULE_LABELS[mod] ?? mod}
                </td>
                {PRIORITIES.map(pri => {
                  const cell = matrix[mod]?.[pri]
                  const bg   = _intensityColor(cell?.count ?? 0, cell?.overdue ?? 0)
                  const border = _borderColor(cell?.count ?? 0, cell?.overdue ?? 0)
                  const sizeRatio = cell ? cell.count / maxCount : 0

                  return (
                    <td key={pri} style={{ padding: '6px 4px', textAlign: 'center' }}>
                      {cell && cell.count > 0 ? (
                        <div
                          onClick={() => onCellClick?.(mod, pri)}
                          title={`${MODULE_LABELS[mod]} / ${pri}: ${cell.count} (${cell.overdue} overdue, ${cell.escalated} escalated)`}
                          style={{
                            display:        'flex',
                            flexDirection:  'column',
                            alignItems:     'center',
                            padding:        '4px',
                            borderRadius:   6,
                            background:     bg,
                            border:         `1px solid ${border}`,
                            cursor:         onCellClick ? 'pointer' : 'default',
                            minHeight:      36,
                            justifyContent: 'center',
                            position:       'relative',
                          }}>
                          {/* Count */}
                          <div style={{ fontSize: 14, fontWeight: 700,
                            color: PRIORITY_COLORS[pri] ?? '#374151' }}>
                            {cell.count}
                          </div>
                          {/* Overdue indicator */}
                          {cell.overdue > 0 && (
                            <div style={{ fontSize: 9, color: '#dc2626', fontWeight: 600 }}>
                              {cell.overdue}↑
                            </div>
                          )}
                          {/* Size hint bar */}
                          <div style={{
                            position: 'absolute', bottom: 0, left: 0,
                            height: 2, width: `${sizeRatio * 100}%`,
                            background: PRIORITY_COLORS[pri] ?? '#e5e7eb',
                            borderRadius: '0 0 0 6px', opacity: 0.6,
                          }} />
                        </div>
                      ) : (
                        <div style={{ color: '#e5e7eb', fontSize: 12 }}>—</div>
                      )}
                    </td>
                  )
                })}
                <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700,
                  color: totalsByModule[mod]! > 0 ? '#111827' : '#d1d5db' }}>
                  {totalsByModule[mod] ?? 0}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
