/**
 * Denver Engineering — Operational Heatmap (v4.35.0)
 * ────────────────────────────────────────────────────
 * Ava Phase 3 — Grid heatmap showing readiness scores
 * per project × domain, with color intensity by score.
 */
import React, { useEffect, useState } from 'react'

interface ReadinessRow {
  entity_id:       string
  entity_name?:    string
  domain:          string
  readiness_score: number
  readiness_state: string
  computed_at?:    string
}

interface OperationalHeatmapProps {
  onCellClick?: (entityId: string, domain: string) => void
}

const DOMAINS = ['project', 'commissioning', 'safety', 'compliance']
const DOMAIN_LABELS: Record<string, string> = {
  project: 'Project', commissioning: 'Commissioning', safety: 'Safety', compliance: 'Compliance',
}

function _scoreToColor(score: number): string {
  if (score >= 85) return '#059669'  // ready
  if (score >= 65) return '#d97706'  // conditionally ready
  if (score >= 40) return '#f97316'  // at risk
  return '#dc2626'                   // not ready
}

function _scoreToAlpha(score: number): number {
  return 0.15 + (score / 100) * 0.75
}

function _stateToLabel(state: string): string {
  return { not_ready: 'Not Ready', at_risk: 'At Risk',
    conditionally_ready: 'Cond. Ready', ready: 'Ready' }[state] ?? state
}

export function OperationalHeatmap({ onCellClick }: OperationalHeatmapProps) {
  const [rows, setRows]       = useState<ReadinessRow[]>([])
  const [loading, setLoading] = useState(true)
  const [hoveredCell, setHoveredCell] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/v1/readiness/overview')
      .then(r => r.json())
      .then(j => setRows(j.data ?? []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return <div style={{ padding: 16, color: '#9ca3af', fontSize: 13 }}>Loading heatmap…</div>
  }

  // Group by entity, pivot domains
  const byEntity = new Map<string, { name: string; scores: Record<string, { score: number; state: string }> }>()
  for (const row of rows) {
    if (!byEntity.has(row.entity_id)) {
      byEntity.set(row.entity_id, { name: row.entity_name ?? row.entity_id, scores: {} })
    }
    byEntity.get(row.entity_id)!.scores[row.domain] = {
      score: row.readiness_score, state: row.readiness_state,
    }
  }

  const entities = Array.from(byEntity.entries())

  if (entities.length === 0) {
    return (
      <div style={{ padding: 16, color: '#9ca3af', fontSize: 13, textAlign: 'center' }}>
        No readiness data available. Scores are computed automatically.
      </div>
    )
  }

  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '10px 14px', borderBottom: '1px solid #e5e7eb' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>Readiness Heatmap</div>
        <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>Click a cell to drill down</div>
      </div>

      {/* Grid */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: '#f9fafb' }}>
              <th style={{ textAlign: 'left', padding: '8px 12px', color: '#6b7280',
                fontWeight: 500, borderBottom: '1px solid #e5e7eb', minWidth: 140 }}>
                Project
              </th>
              {DOMAINS.map(d => (
                <th key={d} style={{ textAlign: 'center', padding: '8px 10px', color: '#6b7280',
                  fontWeight: 500, borderBottom: '1px solid #e5e7eb', minWidth: 100 }}>
                  {DOMAIN_LABELS[d]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entities.map(([entityId, entity]) => (
              <tr key={entityId} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={{ padding: '8px 12px', color: '#111827', fontWeight: 500,
                  maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {entity.name}
                </td>
                {DOMAINS.map(domain => {
                  const cell     = entity.scores[domain]
                  const cellKey  = `${entityId}:${domain}`
                  const isHovered = hoveredCell === cellKey

                  if (!cell) {
                    return (
                      <td key={domain} style={{ padding: '6px 10px', textAlign: 'center' }}>
                        <div style={{ color: '#d1d5db', fontSize: 11 }}>—</div>
                      </td>
                    )
                  }

                  const color = _scoreToColor(cell.score)
                  const alpha = _scoreToAlpha(cell.score)

                  return (
                    <td key={domain} style={{ padding: '4px 6px', textAlign: 'center' }}>
                      <div
                        onClick={() => onCellClick?.(entityId, domain)}
                        onMouseEnter={() => setHoveredCell(cellKey)}
                        onMouseLeave={() => setHoveredCell(null)}
                        title={`${entity.name} · ${DOMAIN_LABELS[domain]}: ${Math.round(cell.score)} (${_stateToLabel(cell.state)})`}
                        style={{
                          display:       'flex',
                          flexDirection: 'column',
                          alignItems:    'center',
                          padding:       '6px 4px',
                          borderRadius:  6,
                          background:    `${color}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`,
                          border:        isHovered ? `1.5px solid ${color}` : '1.5px solid transparent',
                          cursor:        onCellClick ? 'pointer' : 'default',
                          transition:    'all 0.15s',
                        }}
                      >
                        <span style={{ fontWeight: 700, color, fontSize: 14 }}>
                          {Math.round(cell.score)}
                        </span>
                        <span style={{ fontSize: 9, color, marginTop: 2, textAlign: 'center' }}>
                          {_stateToLabel(cell.state)}
                        </span>
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div style={{ padding: '8px 12px', borderTop: '1px solid #e5e7eb',
        display: 'flex', gap: 16, fontSize: 11, color: '#6b7280' }}>
        {[['#059669', 'Ready (85+)'], ['#d97706', 'Cond. Ready (65–85)'],
          ['#f97316', 'At Risk (40–65)'], ['#dc2626', 'Not Ready (<40)']].map(([c, l]) => (
          <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: c }} />
            {l}
          </div>
        ))}
      </div>
    </div>
  )
}
