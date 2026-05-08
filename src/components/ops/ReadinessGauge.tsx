/**
 * Denver Engineering — Readiness Gauge (v4.35.0)
 * ─────────────────────────────────────────────────
 * Ava Phase 3 — Circular gauge showing readiness score (0–100)
 * with color-coded state and blocking factor summary.
 */
import React, { useEffect, useState } from 'react'

export type ReadinessState = 'not_ready' | 'at_risk' | 'conditionally_ready' | 'ready'

interface BlockingFactor {
  type:        string
  count:       number
  severity:    string
  description: string
}

interface ReadinessData {
  entity_id:                 string
  entity_name?:              string
  domain:                    string
  readiness_score:           number
  readiness_state:           ReadinessState
  blocking_factors:          BlockingFactor[]
  predicted_completion_risk: number | null
  component_scores?: {
    open_actions:  number
    blockers:      number
    sla_health:    number
    inspections:   number
    escalations:   number
  }
}

interface ReadinessGaugeProps {
  entityId:    string
  entityType:  'project' | 'system' | 'subsystem'
  compact?:    boolean
  showDetails?: boolean
}

const STATE_COLORS: Record<ReadinessState, { fill: string; label: string; text: string }> = {
  not_ready:           { fill: '#dc2626', label: 'Not Ready',           text: '#dc2626' },
  at_risk:             { fill: '#f97316', label: 'At Risk',             text: '#f97316' },
  conditionally_ready: { fill: '#d97706', label: 'Conditionally Ready', text: '#d97706' },
  ready:               { fill: '#10b981', label: 'Ready',               text: '#10b981' },
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#dc2626', high: '#f97316', medium: '#d97706', low: '#6b7280',
}

// ─── Circular gauge SVG ───────────────────────────────────────────────────────

function GaugeSvg({ score, state, size = 120 }: { score: number; state: ReadinessState; size?: number }) {
  const r       = (size - 16) / 2
  const cx      = size / 2
  const cy      = size / 2
  const circum  = 2 * Math.PI * r
  // 270-degree arc (¾ circle, starting from bottom-left)
  const arcLen  = circum * 0.75
  const filled  = arcLen * (score / 100)
  const { fill } = STATE_COLORS[state]

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* Background arc */}
      <circle
        cx={cx} cy={cy} r={r}
        fill="none" stroke="#f3f4f6" strokeWidth={10}
        strokeDasharray={`${arcLen} ${circum}`}
        strokeDashoffset={0}
        strokeLinecap="round"
        transform={`rotate(135 ${cx} ${cy})`}
      />
      {/* Filled arc */}
      <circle
        cx={cx} cy={cy} r={r}
        fill="none" stroke={fill} strokeWidth={10}
        strokeDasharray={`${filled} ${circum}`}
        strokeDashoffset={0}
        strokeLinecap="round"
        transform={`rotate(135 ${cx} ${cy})`}
        style={{ transition: 'stroke-dasharray 0.6s ease' }}
      />
      {/* Score text */}
      <text x={cx} y={cy - 4} textAnchor="middle" fontSize={size * 0.22}
        fontWeight={700} fill={fill}>
        {Math.round(score)}
      </text>
      <text x={cx} y={cy + size * 0.14} textAnchor="middle" fontSize={size * 0.11}
        fill="#6b7280">
        / 100
      </text>
    </svg>
  )
}

// ─── Component score bar ──────────────────────────────────────────────────────

function ComponentBar({ label, score }: { label: string; score: number }) {
  const color = score >= 80 ? '#10b981' : score >= 60 ? '#d97706' : '#dc2626'
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#6b7280', marginBottom: 2 }}>
        <span>{label}</span>
        <span style={{ fontWeight: 600, color }}>{Math.round(score)}</span>
      </div>
      <div style={{ height: 4, background: '#f3f4f6', borderRadius: 2 }}>
        <div style={{ width: `${score}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 0.4s ease' }} />
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ReadinessGauge({ entityId, entityType, compact = false, showDetails = true }: ReadinessGaugeProps) {
  const [data, setData]       = useState<ReadinessData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/v1/readiness/${entityType}/${entityId}`)
      .then(r => r.json())
      .then(j => setData(j.data ?? null))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [entityId, entityType])

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: compact ? 80 : 160, height: compact ? 80 : 160, color: '#9ca3af', fontSize: 12 }}>
        Loading…
      </div>
    )
  }

  if (!data) {
    return <div style={{ color: '#9ca3af', fontSize: 12, padding: 8 }}>No readiness data.</div>
  }

  const stateInfo = STATE_COLORS[data.readiness_state]
  const size      = compact ? 80 : 120

  if (compact) {
    return (
      <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
        <GaugeSvg score={data.readiness_score} state={data.readiness_state} size={size} />
        <div style={{ fontSize: 10, fontWeight: 600, color: stateInfo.text }}>{stateInfo.label}</div>
      </div>
    )
  }

  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 16 }}>
      {/* Header */}
      {data.entity_name && (
        <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', marginBottom: 12 }}>{data.entity_name}</div>
      )}

      {/* Gauge + state */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12 }}>
        <GaugeSvg score={data.readiness_score} state={data.readiness_state} size={size} />
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: stateInfo.text }}>{stateInfo.label}</div>
          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2, textTransform: 'capitalize' }}>
            {data.domain} readiness
          </div>
          {data.predicted_completion_risk !== null && (
            <div style={{ marginTop: 6, fontSize: 11, color: '#374151' }}>
              Completion risk:{' '}
              <span style={{ fontWeight: 600, color: data.predicted_completion_risk > 60 ? '#dc2626' : '#6b7280' }}>
                {data.predicted_completion_risk}%
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Component scores */}
      {showDetails && data.component_scores && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 6, fontWeight: 500 }}>COMPONENTS</div>
          <ComponentBar label="Open Actions"  score={data.component_scores.open_actions} />
          <ComponentBar label="Blockers"      score={data.component_scores.blockers} />
          <ComponentBar label="SLA Health"    score={data.component_scores.sla_health} />
          <ComponentBar label="Inspections"   score={data.component_scores.inspections} />
          <ComponentBar label="Escalations"   score={data.component_scores.escalations} />
        </div>
      )}

      {/* Blocking factors */}
      {showDetails && data.blocking_factors.length > 0 && (
        <div>
          <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 6, fontWeight: 500 }}>BLOCKING FACTORS</div>
          {data.blocking_factors.map((f, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, fontSize: 12 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%',
                background: SEVERITY_COLORS[f.severity] ?? '#6b7280', flexShrink: 0 }} />
              <span style={{ color: '#374151' }}>{f.description}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
