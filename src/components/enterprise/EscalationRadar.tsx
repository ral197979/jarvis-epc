/**
 * Denver Engineering — Escalation Radar (v4.40.0)
 * ─────────────────────────────────────────────────
 * Ava Phase 4 — Displays escalation hotspots by module and project
 * as a radar/bubble chart (SVG, no external deps).
 */
import React, { useEffect, useState } from 'react'

interface Hotspot {
  project_id:    string
  source_module: string
  escalated_count: number
  max_level:     number
  also_overdue:  number
}

interface EscalationRadarProps {
  onSelect?: (projectId: string, module: string) => void
}

const MODULE_COLORS: Record<string, string> = {
  rfis:             '#2563eb',
  submittals:       '#7c3aed',
  punch_items:      '#f97316',
  inspections:      '#10b981',
  compliance_tasks: '#dc2626',
  bim_issues:       '#d97706',
}

export function EscalationRadar({ onSelect }: EscalationRadarProps) {
  const [hotspots, setHotspots] = useState<Hotspot[]>([])
  const [loading, setLoading]  = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch('/api/v1/executive/escalation-hotspots')
      .then(r => r.json())
      .then(j => setHotspots(j.data ?? []))
      .catch(() => setHotspots([]))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div style={{ padding: 16, color: '#9ca3af', fontSize: 13 }}>Loading escalation radar…</div>

  const maxCount = Math.max(...hotspots.map(h => h.escalated_count), 1)

  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid #e5e7eb' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>Escalation Hotspots</div>
        <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>By project × module</div>
      </div>

      {hotspots.length === 0 ? (
        <div style={{ padding: 24, textAlign: 'center', color: '#10b981', fontSize: 13 }}>
          No escalation hotspots detected. ✓
        </div>
      ) : (
        <>
          {/* SVG bubble chart */}
          <svg width="100%" viewBox="0 0 400 200" style={{ display: 'block', padding: '8px 0' }}>
            {hotspots.slice(0, 12).map((h, i) => {
              const cols = 4
              const row  = Math.floor(i / cols)
              const col  = i % cols
              const cx   = 50 + col * 90
              const cy   = 50 + row * 80
              const r    = 12 + (h.escalated_count / maxCount) * 25
              const color = MODULE_COLORS[h.source_module] ?? '#6b7280'
              const opacity = h.also_overdue > 0 ? 1 : 0.6

              return (
                <g key={i} onClick={() => onSelect?.(h.project_id, h.source_module)}
                  style={{ cursor: onSelect ? 'pointer' : 'default' }}>
                  <circle cx={cx} cy={cy} r={r} fill={color} opacity={opacity} />
                  <text x={cx} y={cy + 1} textAnchor="middle" dominantBaseline="middle"
                    fontSize={11} fontWeight={700} fill="#fff">
                    {h.escalated_count}
                  </text>
                  <text x={cx} y={cy + r + 10} textAnchor="middle" fontSize={8} fill="#6b7280">
                    {h.source_module.replace('_', ' ').slice(0, 8)}
                  </text>
                </g>
              )
            })}
          </svg>

          {/* Legend + table */}
          <div style={{ padding: '0 14px 12px' }}>
            {hotspots.slice(0, 8).map((h, i) => {
              const color = MODULE_COLORS[h.source_module] ?? '#6b7280'
              return (
                <div key={i} onClick={() => onSelect?.(h.project_id, h.source_module)}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0',
                    cursor: onSelect ? 'pointer' : 'default', borderBottom: '1px solid #f3f4f6' }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
                  <div style={{ flex: 1, fontSize: 11, color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {h.source_module.replace(/_/g, ' ')}
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 600, color }}>
                    {h.escalated_count} escalated
                  </div>
                  {h.also_overdue > 0 && (
                    <span style={{ fontSize: 9, color: '#dc2626', fontWeight: 600 }}>
                      {h.also_overdue}↑ overdue
                    </span>
                  )}
                  <div style={{ fontSize: 10, color: '#9ca3af' }}>
                    max L{h.max_level}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
