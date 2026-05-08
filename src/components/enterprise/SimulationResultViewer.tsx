/**
 * Denver Engineering — Simulation Result Viewer (v4.40.0)
 * ─────────────────────────────────────────────────────────
 * Ava Phase 4 — Renders simulation/replay results including
 * projected readiness, bottlenecks, and what-if comparisons.
 */
import React, { useEffect, useState } from 'react'

interface SimResult {
  id:                    string
  simulation_type:       string
  status:                string
  events_replayed:       number
  replay_checksum:       string
  projected_readiness:   number | null
  projected_escalations: number
  projected_sla_breaches:number
  predicted_bottlenecks: string[]
  readiness_delta:       number | null
}

interface SimulationResultViewerProps {
  sessionId: string
}

const BOTTLENECK_LABELS: Record<string, string> = {
  dependency_chain: 'Dependency Chain',
  sla_overload:     'SLA Overload',
  escalation_chain: 'Escalation Chain',
  action_saturation:'Action Saturation',
}

export function SimulationResultViewer({ sessionId }: SimulationResultViewerProps) {
  const [result, setResult] = useState<SimResult | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const poll = () => {
      fetch(`/api/v1/simulation/${sessionId}/results`)
        .then(r => r.json())
        .then(j => {
          setResult(j.data ?? null)
          if (j.data?.status === 'running') setTimeout(poll, 2000)
        })
        .catch(() => {})
        .finally(() => setLoading(false))
    }
    poll()
  }, [sessionId])

  if (loading) return <div style={{ padding: 16, color: '#9ca3af', fontSize: 13 }}>Running simulation…</div>
  if (!result) return <div style={{ padding: 16, color: '#dc2626', fontSize: 13 }}>Simulation not found.</div>

  const deltaColor = result.readiness_delta === null ? '#6b7280'
    : result.readiness_delta >= 0 ? '#10b981' : '#dc2626'
  const deltaSign  = result.readiness_delta === null ? '' : result.readiness_delta >= 0 ? '+' : ''

  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '10px 14px', borderBottom: '1px solid #e5e7eb', background: '#f9fafb' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>
          {result.simulation_type === 'what_if' ? 'What-If Simulation' : 'Replay Results'}
        </div>
        <div style={{ fontSize: 11, color: '#9ca3af', fontFamily: 'monospace', marginTop: 2 }}>
          {result.events_replayed} events · {result.replay_checksum?.slice(0, 12)}…
        </div>
      </div>

      {/* Metrics row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1, background: '#e5e7eb' }}>
        {[
          { label: 'Projected Readiness', value: result.projected_readiness !== null ? `${Math.round(result.projected_readiness)}` : '—', color: '#2563eb' },
          { label: 'Projected Escalations', value: String(result.projected_escalations), color: '#f97316' },
          { label: 'SLA Breaches', value: String(result.projected_sla_breaches), color: '#dc2626' },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ background: '#fff', padding: '12px 14px', textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
            <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Delta indicator */}
      {result.readiness_delta !== null && (
        <div style={{ padding: '10px 14px', borderBottom: '1px solid #e5e7eb',
          background: result.readiness_delta >= 0 ? '#f0fdf4' : '#fef2f2' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: deltaColor }}>
            {deltaSign}{result.readiness_delta.toFixed(1)} pts vs. current readiness
          </span>
          <span style={{ fontSize: 11, color: '#6b7280', marginLeft: 8 }}>
            {result.readiness_delta >= 0 ? 'Improvement' : 'Degradation'}
          </span>
        </div>
      )}

      {/* Bottlenecks */}
      {result.predicted_bottlenecks.length > 0 && (
        <div style={{ padding: '10px 14px', borderBottom: '1px solid #e5e7eb' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Predicted Bottlenecks</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {result.predicted_bottlenecks.map(b => (
              <span key={b} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 12,
                background: '#fef2f2', color: '#dc2626', fontWeight: 600 }}>
                {BOTTLENECK_LABELS[b] ?? b}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Checksum */}
      <div style={{ padding: '8px 14px', background: '#f9fafb', fontSize: 10, color: '#9ca3af',
        fontFamily: 'monospace', display: 'flex', gap: 6, alignItems: 'center' }}>
        <span>🔒</span>
        <span>SHA-256: {result.replay_checksum ?? '—'}</span>
      </div>
    </div>
  )
}
