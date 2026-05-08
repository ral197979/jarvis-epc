// Denver Engineering — Readiness Score Matrix (Phase 11)
// Full grid of all GA readiness dimensions with score entry and history

import React, { useEffect, useState, useCallback } from 'react'

interface GAReadinessScore {
  id: string
  dimension: string
  score: number
  status: 'ready' | 'at_risk' | 'blocking'
  notes: string | null
  scoredAt: string
}

const DIMENSIONS = [
  'regression', 'telemetry', 'deployment', 'onboarding',
  'support', 'sre', 'billing', 'governance',
  'compliance', 'scale', 'partner', 'documentation',
] as const

const DIMENSION_LABELS: Record<string, string> = {
  regression: 'Regression Tests', telemetry: 'Telemetry', deployment: 'Deployment',
  onboarding: 'Onboarding', support: 'Support', sre: 'SRE / Reliability',
  billing: 'Billing', governance: 'Governance', compliance: 'Compliance',
  scale: 'Scale Validation', partner: 'Partner Ecosystem', documentation: 'Documentation',
}

interface ReadinessScoreMatrixProps {
  environment?: string
  allowEdit?: boolean
}

export function ReadinessScoreMatrix({ environment = 'production', allowEdit = false }: ReadinessScoreMatrixProps) {
  const [scores, setScores] = useState<GAReadinessScore[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<string | null>(null)
  const [editScore, setEditScore] = useState('')
  const [editNotes, setEditNotes] = useState('')

  const fetchScores = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/phase11/ga-readiness?environment=${environment}`)
      const data = await res.json()
      setScores(data.scores ?? [])
    } finally {
      setLoading(false)
    }
  }, [environment])

  useEffect(() => { fetchScores() }, [fetchScores])

  const saveScore = async (dimension: string) => {
    const score = Number(editScore)
    if (isNaN(score) || score < 0 || score > 100) return
    await fetch('/api/phase11/ga-readiness', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ environment, dimension, score, notes: editNotes || null }),
    })
    setEditing(null)
    setEditScore('')
    setEditNotes('')
    fetchScores()
  }

  const scoreByDimension = new Map(scores.map(s => [s.dimension, s]))
  const statusColors = { ready: '#22c55e', at_risk: '#f59e0b', blocking: '#ef4444' }

  const overallScore = scores.length > 0
    ? Math.round(scores.reduce((acc, s) => acc + s.score, 0) / scores.length)
    : 0
  const blockingCount = scores.filter(s => s.status === 'blocking').length

  return (
    <div style={{ background: '#0f172a', color: '#e2e8f0', fontFamily: 'sans-serif', padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Readiness Score Matrix</h2>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 24, fontWeight: 800, color: blockingCount === 0 ? '#22c55e' : '#ef4444' }}>
            {overallScore}/100
          </div>
          <div style={{ fontSize: 11, color: '#94a3b8' }}>{blockingCount} blocking</div>
        </div>
      </div>

      {loading ? (
        <div style={{ color: '#64748b', textAlign: 'center', padding: 40 }}>Loading…</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
          {DIMENSIONS.map(dimension => {
            const s = scoreByDimension.get(dimension)
            const color = s ? statusColors[s.status] : '#334155'
            const isEditing = editing === dimension

            return (
              <div
                key={dimension}
                style={{
                  background: '#1e293b', borderRadius: 8, padding: 14,
                  border: `1px solid ${s ? color + '44' : '#334155'}`,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#cbd5e1' }}>
                    {DIMENSION_LABELS[dimension]}
                  </span>
                  {s && (
                    <span style={{
                      background: color + '22', color, border: `1px solid ${color}44`,
                      borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                    }}>
                      {s.status.replace('_', ' ')}
                    </span>
                  )}
                </div>

                {s ? (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <div style={{ background: '#0f172a', borderRadius: 4, height: 6, flex: 1 }}>
                        <div style={{
                          background: color, borderRadius: 4, height: '100%',
                          width: `${s.score}%`,
                        }} />
                      </div>
                      <span style={{ fontWeight: 700, color, fontSize: 15, minWidth: 28, textAlign: 'right' }}>
                        {s.score}
                      </span>
                    </div>
                    {s.notes && (
                      <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6 }}>{s.notes}</div>
                    )}
                    <div style={{ fontSize: 10, color: '#475569' }}>
                      Updated {new Date(s.scoredAt).toLocaleDateString()}
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: 12, color: '#475569', fontStyle: 'italic' }}>Not yet scored</div>
                )}

                {allowEdit && !isEditing && (
                  <button
                    onClick={() => {
                      setEditing(dimension)
                      setEditScore(s?.score.toString() ?? '')
                      setEditNotes(s?.notes ?? '')
                    }}
                    style={{
                      marginTop: 8, padding: '4px 10px', background: 'transparent',
                      color: '#3b82f6', border: '1px solid #3b82f633', borderRadius: 4,
                      cursor: 'pointer', fontSize: 11,
                    }}
                  >
                    {s ? 'Update' : 'Score'}
                  </button>
                )}

                {allowEdit && isEditing && (
                  <div style={{ marginTop: 8 }}>
                    <input
                      type="number"
                      value={editScore}
                      onChange={e => setEditScore(e.target.value)}
                      min={0} max={100}
                      placeholder="Score (0-100)"
                      style={{
                        width: '100%', padding: '6px 8px', background: '#0f172a',
                        border: '1px solid #334155', borderRadius: 4, color: '#e2e8f0',
                        fontSize: 12, boxSizing: 'border-box', marginBottom: 4,
                      }}
                    />
                    <input
                      value={editNotes}
                      onChange={e => setEditNotes(e.target.value)}
                      placeholder="Notes (optional)"
                      style={{
                        width: '100%', padding: '6px 8px', background: '#0f172a',
                        border: '1px solid #334155', borderRadius: 4, color: '#e2e8f0',
                        fontSize: 12, boxSizing: 'border-box', marginBottom: 6,
                      }}
                    />
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        onClick={() => saveScore(dimension)}
                        style={{
                          padding: '5px 12px', background: '#22c55e', color: '#fff',
                          border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 11,
                        }}
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditing(null)}
                        style={{
                          padding: '5px 10px', background: 'transparent', color: '#94a3b8',
                          border: '1px solid #334155', borderRadius: 4, cursor: 'pointer', fontSize: 11,
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
