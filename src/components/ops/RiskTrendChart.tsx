/**
 * Denver Engineering — Risk Trend Chart (v4.35.0)
 * ─────────────────────────────────────────────────
 * Ava Phase 3 — SVG sparkline/trend chart for readiness
 * and SLA breach risk over time. No external chart library.
 */
import React, { useEffect, useState } from 'react'

interface TrendPoint {
  date:            string
  readiness_score: number
  readiness_state: string
  open?:           number
  overdue?:        number
}

interface RiskTrendChartProps {
  entityId:   string
  entityType: 'project'
  domain?:    string
  days?:      number
  width?:     number
  height?:    number
}

const STATE_COLORS: Record<string, string> = {
  not_ready: '#dc2626', at_risk: '#f97316',
  conditionally_ready: '#d97706', ready: '#10b981',
}

function _buildPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return ''
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
}

function _buildArea(points: { x: number; y: number }[], svgH: number): string {
  if (points.length === 0) return ''
  const top    = _buildPath(points)
  const bottom = `L ${points[points.length - 1]!.x} ${svgH} L ${points[0]!.x} ${svgH} Z`
  return `${top} ${bottom}`
}

export function RiskTrendChart({
  entityId, entityType, domain = 'project', days = 30,
  width = 400, height = 120,
}: RiskTrendChartProps) {
  const [data, setData]       = useState<TrendPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [hovered, setHovered] = useState<TrendPoint | null>(null)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/v1/readiness/${entityType}/${entityId}/history?domain=${domain}&days=${days}`)
      .then(r => r.json())
      .then(j => setData(j.data ?? []))
      .catch(() => setData([]))
      .finally(() => setLoading(false))
  }, [entityId, entityType, domain, days])

  if (loading) {
    return <div style={{ width, height, display: 'flex', alignItems: 'center',
      justifyContent: 'center', color: '#9ca3af', fontSize: 12 }}>Loading…</div>
  }

  if (data.length < 2) {
    return (
      <div style={{ width, height, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: 12,
        background: '#f9fafb', borderRadius: 8, border: '1px solid #e5e7eb' }}>
        <div>Not enough history</div>
        <div style={{ fontSize: 11, marginTop: 4 }}>Trend data builds up over time</div>
      </div>
    )
  }

  const padX = 40; const padY = 12; const padB = 24
  const svgW  = width - padX
  const svgH  = height - padY - padB
  const n     = data.length

  const points = data.map((d, i) => ({
    x: padX + (i / (n - 1)) * svgW,
    y: padY + (1 - d.readiness_score / 100) * svgH,
    d,
  }))

  const current  = data[data.length - 1]
  const previous = data[data.length - 2]
  const delta    = current && previous
    ? Math.round(current.readiness_score - previous.readiness_score) : 0
  const color    = STATE_COLORS[current?.readiness_state ?? 'at_risk'] ?? '#6b7280'

  // Y-axis labels
  const yLabels = [100, 75, 50, 25, 0]

  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>Readiness Trend ({days}d)</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ fontSize: 22, fontWeight: 700, color }}>
              {Math.round(current?.readiness_score ?? 0)}
            </span>
            {delta !== 0 && (
              <span style={{ fontSize: 12, color: delta > 0 ? '#10b981' : '#dc2626', fontWeight: 600 }}>
                {delta > 0 ? '+' : ''}{delta}
              </span>
            )}
          </div>
        </div>
        <div style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 12,
          background: `${color}18`, color }}>
          {(current?.readiness_state ?? 'unknown').replace(/_/g, ' ')}
        </div>
      </div>

      {/* SVG Chart */}
      <svg width={width} height={height} style={{ overflow: 'visible' }}>
        {/* Y-axis grid lines */}
        {yLabels.map(v => {
          const y = padY + (1 - v / 100) * svgH
          return (
            <g key={v}>
              <line x1={padX} y1={y} x2={width} y2={y}
                stroke="#f3f4f6" strokeWidth={1} />
              <text x={padX - 4} y={y + 4} fontSize={9} fill="#9ca3af" textAnchor="end">{v}</text>
            </g>
          )
        })}

        {/* Area fill */}
        <path d={_buildArea(points, padY + svgH)} fill={`${color}18`} />

        {/* Line */}
        <path d={_buildPath(points)} fill="none" stroke={color} strokeWidth={2}
          strokeLinejoin="round" strokeLinecap="round" />

        {/* Hover dots */}
        {points.map(({ x, y, d }, i) => (
          <circle key={i} cx={x} cy={y} r={hovered === d ? 5 : 3}
            fill={STATE_COLORS[d.readiness_state] ?? color}
            stroke="#fff" strokeWidth={1.5}
            style={{ cursor: 'pointer' }}
            onMouseEnter={() => setHovered(d)}
            onMouseLeave={() => setHovered(null)}
          />
        ))}

        {/* Tooltip */}
        {hovered && (() => {
          const idx   = data.indexOf(hovered)
          const pt    = points[idx]!
          const ttX   = Math.min(pt.x, width - 80)
          const ttY   = Math.max(pt.y - 48, padY)
          return (
            <g>
              <rect x={ttX} y={ttY} width={78} height={38} rx={4} fill="#1f2937" opacity={0.9} />
              <text x={ttX + 6} y={ttY + 14} fontSize={10} fill="#fff" fontWeight={600}>
                {Math.round(hovered.readiness_score)}
              </text>
              <text x={ttX + 6} y={ttY + 26} fontSize={9} fill="#d1d5db">
                {new Date(hovered.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </text>
            </g>
          )
        })()}

        {/* X-axis date labels */}
        {[0, Math.floor(n / 2), n - 1].map(i => {
          const pt = points[i]
          if (!pt) return null
          return (
            <text key={i} x={pt.x} y={padY + svgH + 16} fontSize={9} fill="#9ca3af" textAnchor="middle">
              {new Date(data[i]!.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </text>
          )
        })}
      </svg>
    </div>
  )
}
