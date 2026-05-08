/**
 * Denver Engineering — Portfolio Heatmap (v4.40.0)
 * ──────────────────────────────────────────────────
 * Ava Phase 4 — Executive-level portfolio risk visualization.
 * Shows readiness, escalations, and overdue actions per project.
 */
import React, { useEffect, useState } from 'react'

interface ProjectRisk {
  project_id:       string
  project_name:     string
  open_actions:     number
  escalated:        number
  overdue:          number
  readiness_score:  number | null
  readiness_state:  string | null
}

interface PortfolioHeatmapProps {
  onProjectClick?: (projectId: string) => void
}

const STATE_COLORS: Record<string, string> = {
  ready:                 '#10b981',
  conditionally_ready:   '#d97706',
  at_risk:               '#f97316',
  not_ready:             '#dc2626',
}

function _riskColor(project: ProjectRisk): string {
  if (project.overdue > 5 || project.escalated > 3) return '#dc2626'
  if (project.overdue > 2 || project.escalated > 1) return '#f97316'
  if (project.overdue > 0 || project.open_actions > 10) return '#d97706'
  return '#10b981'
}

export function PortfolioHeatmap({ onProjectClick }: PortfolioHeatmapProps) {
  const [projects, setProjects] = useState<ProjectRisk[]>([])
  const [loading, setLoading]  = useState(true)
  const [sortKey, setSortKey]  = useState<keyof ProjectRisk>('overdue')

  useEffect(() => {
    setLoading(true)
    fetch('/api/v1/executive/portfolio-risk')
      .then(r => r.json())
      .then(j => setProjects(j.data ?? []))
      .catch(() => setProjects([]))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div style={{ padding: 16, color: '#9ca3af', fontSize: 13 }}>Building portfolio heatmap…</div>

  const sorted = [...projects].sort((a, b) => {
    const av = a[sortKey]; const bv = b[sortKey]
    if (av === null || av === undefined) return 1
    if (bv === null || bv === undefined) return -1
    return (bv as number) - (av as number)
  })

  const maxOpen = Math.max(...projects.map(p => p.open_actions), 1)

  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>Portfolio Risk Heatmap</div>
          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{projects.length} projects</div>
        </div>
        <select value={String(sortKey)} onChange={e => setSortKey(e.target.value as keyof ProjectRisk)}
          style={{ fontSize: 11, padding: '3px 6px', borderRadius: 4, border: '1px solid #d1d5db', color: '#374151' }}>
          <option value="overdue">Sort: Overdue</option>
          <option value="escalated">Sort: Escalated</option>
          <option value="open_actions">Sort: Open</option>
          <option value="readiness_score">Sort: Readiness</option>
        </select>
      </div>

      <div style={{ overflowX: 'auto' }}>
        {sorted.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>No projects found.</div>
        ) : sorted.map(p => {
          const color = _riskColor(p)
          const barWidth = (p.open_actions / maxOpen) * 100

          return (
            <div key={p.project_id}
              onClick={() => onProjectClick?.(p.project_id)}
              style={{ padding: '10px 14px', borderBottom: '1px solid #f3f4f6',
                cursor: onProjectClick ? 'pointer' : 'default',
                display: 'grid', gridTemplateColumns: '200px 1fr auto', gap: 12, alignItems: 'center' }}>

              {/* Project name + state */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 500, color: '#111827',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.project_name}
                </div>
                {p.readiness_state && (
                  <span style={{ fontSize: 9, fontWeight: 600, color: STATE_COLORS[p.readiness_state] ?? '#6b7280' }}>
                    {p.readiness_state.replace(/_/g, ' ')}
                  </span>
                )}
              </div>

              {/* Bar + metric chips */}
              <div>
                <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
                  <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 10,
                    background: '#fef2f2', color: '#dc2626', fontWeight: 600 }}>
                    {p.overdue}↑ overdue
                  </span>
                  {p.escalated > 0 && (
                    <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 10,
                      background: '#fff7ed', color: '#f97316', fontWeight: 600 }}>
                      {p.escalated} escalated
                    </span>
                  )}
                </div>
                <div style={{ height: 6, background: '#f3f4f6', borderRadius: 3 }}>
                  <div style={{ height: 6, width: `${barWidth}%`, background: color, borderRadius: 3, transition: 'width 0.3s' }} />
                </div>
              </div>

              {/* Readiness score */}
              <div style={{ textAlign: 'right', minWidth: 40 }}>
                {p.readiness_score !== null ? (
                  <div style={{ fontSize: 16, fontWeight: 700,
                    color: STATE_COLORS[p.readiness_state ?? ''] ?? '#6b7280' }}>
                    {Math.round(p.readiness_score)}
                  </div>
                ) : (
                  <div style={{ fontSize: 11, color: '#d1d5db' }}>—</div>
                )}
                <div style={{ fontSize: 9, color: '#9ca3af' }}>{p.open_actions} open</div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
