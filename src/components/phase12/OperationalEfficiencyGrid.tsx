// Denver Engineering — Operational Efficiency Grid (Phase 12)
// Grid view of cost/performance efficiency metrics across all categories

import React, { useState, useEffect } from 'react'

interface EfficiencyMetric {
  id: string
  category: string
  baselineCost: number
  currentCost: number
  efficiencyGainPct: number
  measuredAt: string
}

interface AiBalance {
  modelId: string
  costPer1kTokens: number
  acceptanceRate: number
  qualityScore: number
  efficiencyScore: number
  recommendedAction: string | null
}

interface InfraEfficiency {
  computeEfficiencyScore: number
  storageEfficiencyScore: number
  networkEfficiencyScore: number
  overallEfficiencyScore: number
  topOptimizations: string[]
}

const CATEGORY_ICONS: Record<string, string> = {
  ai_routing: '🤖', replay_compute: '🔁', websocket_fanout: '📡',
  graph_traversal: '🕸️', telemetry_storage: '📦', export_generation: '📤', edge_sync: '⚡',
}

const ACTION_COLORS: Record<string, string> = {
  keep: '#22c55e', downgrade: '#3b82f6', upgrade: '#f97316', route_split: '#8b5cf6',
}

export function OperationalEfficiencyGrid() {
  const [metrics, setMetrics] = useState<EfficiencyMetric[]>([])
  const [aiBalances, setAiBalances] = useState<AiBalance[]>([])
  const [infraEfficiency, setInfraEfficiency] = useState<InfraEfficiency | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const [metricsRes, aiRes, infraRes] = await Promise.all([
          fetch('/api/phase12/efficiency/metrics'),
          fetch('/api/phase12/efficiency/ai-balance'),
          fetch('/api/phase12/efficiency/infrastructure'),
        ])
        const m = await metricsRes.json()
        setMetrics(m.metrics ?? [])
        const ai = await aiRes.json()
        setAiBalances(ai.models ?? [])
        const infra = await infraRes.json()
        setInfraEfficiency(infra)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) return <div style={{ color: '#64748b', padding: 24 }}>Loading…</div>

  return (
    <div style={{ background: '#0a0f1e', fontFamily: 'sans-serif', padding: 24 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0', marginBottom: 20 }}>⚡ Operational Efficiency</div>

      {/* Efficiency Metrics Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 20 }}>
        {metrics.map(m => {
          const improved = m.efficiencyGainPct > 0
          return (
            <div key={m.id} style={{
              background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: 14,
            }}>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>
                {CATEGORY_ICONS[m.category] ?? '📊'} {m.category.replace(/_/g, ' ')}
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: improved ? '#22c55e' : '#eab308' }}>
                {improved ? '+' : ''}{m.efficiencyGainPct.toFixed(1)}%
              </div>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                {m.currentCost.toFixed(2)} (was {m.baselineCost.toFixed(2)})
              </div>
            </div>
          )
        })}
      </div>

      {/* AI Model Routing */}
      {aiBalances.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 8, textTransform: 'uppercase' }}>
            AI Model Routing
          </div>
          {aiBalances.map(ai => (
            <div key={ai.modelId} style={{
              background: '#0f172a', border: '1px solid #1e293b', borderRadius: 6,
              padding: '10px 14px', marginBottom: 8,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <div>
                <div style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 600 }}>{ai.modelId}</div>
                <div style={{ fontSize: 11, color: '#64748b' }}>
                  ${ai.costPer1kTokens.toFixed(4)}/1k · {(ai.acceptanceRate * 100).toFixed(0)}% acceptance
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                {ai.recommendedAction && ai.recommendedAction !== 'keep' && (
                  <span style={{
                    padding: '3px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700,
                    background: `${ACTION_COLORS[ai.recommendedAction] ?? '#64748b'}20`,
                    color: ACTION_COLORS[ai.recommendedAction] ?? '#64748b',
                  }}>
                    → {ai.recommendedAction.replace('_', ' ')}
                  </span>
                )}
                <div style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0', marginTop: 2 }}>
                  {ai.efficiencyScore}/100
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Infra Efficiency */}
      {infraEfficiency && (
        <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 12, textTransform: 'uppercase' }}>
            Infrastructure Efficiency
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 12 }}>
            {[
              ['Compute', infraEfficiency.computeEfficiencyScore],
              ['Storage', infraEfficiency.storageEfficiencyScore],
              ['Network', infraEfficiency.networkEfficiencyScore],
              ['Overall', infraEfficiency.overallEfficiencyScore],
            ].map(([label, score]) => (
              <div key={label as string}>
                <div style={{ fontSize: 11, color: '#64748b', marginBottom: 2 }}>{label}</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: (score as number) >= 70 ? '#22c55e' : '#eab308' }}>{score}</div>
              </div>
            ))}
          </div>
          {infraEfficiency.topOptimizations.length > 0 && (
            <div>
              {infraEfficiency.topOptimizations.map((opt, i) => (
                <div key={i} style={{ fontSize: 12, color: '#94a3b8', padding: '4px 0', borderTop: i > 0 ? '1px solid #1e293b' : 'none' }}>
                  → {opt}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
