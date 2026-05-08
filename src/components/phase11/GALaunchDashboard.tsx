// Denver Engineering — GA Launch Dashboard (Phase 11)
// Aggregate GA readiness scores and show GO / NO-GO determination

import React, { useEffect, useState, useCallback } from 'react'

interface GAReadinessScore {
  id: string
  dimension: string
  score: number
  status: 'ready' | 'at_risk' | 'blocking'
  notes: string | null
  scoredAt: string
}

interface GALaunchDashboardProps {
  environment?: string
  onLaunchApproved?: () => void
}

const DIMENSION_LABELS: Record<string, string> = {
  regression: 'Regression Tests',
  telemetry: 'Telemetry',
  deployment: 'Deployment',
  onboarding: 'Onboarding',
  support: 'Support',
  sre: 'SRE / Reliability',
  billing: 'Billing',
  governance: 'Governance',
  compliance: 'Compliance',
  scale: 'Scale Validation',
  partner: 'Partner Ecosystem',
  documentation: 'Documentation',
}

function ScoreCard({ score }: { score: GAReadinessScore }) {
  const colors = { ready: '#22c55e', at_risk: '#f59e0b', blocking: '#ef4444' }
  const color = colors[score.status]
  return (
    <div style={{
      background: '#1e293b', borderRadius: 8, padding: 14,
      border: `1px solid ${color}33`,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#cbd5e1' }}>
          {DIMENSION_LABELS[score.dimension] ?? score.dimension}
        </div>
        <span style={{
          background: color + '22', color, border: `1px solid ${color}44`,
          borderRadius: 4, padding: '2px 8px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
        }}>
          {score.status.replace('_', ' ')}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ background: '#0f172a', borderRadius: 4, height: 8, flex: 1 }}>
          <div style={{
            background: color, borderRadius: 4, height: '100%',
            width: `${score.score}%`, transition: 'width 0.3s',
          }} />
        </div>
        <span style={{ fontWeight: 700, color, fontSize: 16, minWidth: 36, textAlign: 'right' }}>
          {score.score}
        </span>
      </div>
      {score.notes && (
        <div style={{ fontSize: 11, color: '#64748b', marginTop: 6 }}>{score.notes}</div>
      )}
    </div>
  )
}

export function GALaunchDashboard({ environment = 'production', onLaunchApproved }: GALaunchDashboardProps) {
  const [scores, setScores] = useState<GAReadinessScore[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchScores = useCallback(async () => {
    try {
      const res = await fetch(`/api/phase11/ga-readiness?environment=${environment}`)
      if (!res.ok) throw new Error('Failed to fetch readiness scores')
      const data = await res.json()
      setScores(data.scores ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [environment])

  useEffect(() => { fetchScores() }, [fetchScores])

  const blockingDimensions = scores.filter(s => s.status === 'blocking')
  const atRiskDimensions = scores.filter(s => s.status === 'at_risk')
  const readyDimensions = scores.filter(s => s.status === 'ready')
  const isGoForLaunch = blockingDimensions.length === 0
  const avgScore = scores.length > 0
    ? Math.round(scores.reduce((acc, s) => acc + s.score, 0) / scores.length)
    : 0

  return (
    <div style={{ background: '#0f172a', color: '#e2e8f0', fontFamily: 'sans-serif', padding: 24 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>GA Launch Dashboard</h2>
          <p style={{ margin: '4px 0 0', color: '#94a3b8', fontSize: 13 }}>
            {environment} · {scores.length} dimensions evaluated
          </p>
        </div>
        {!loading && (
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 32, fontWeight: 800, color: isGoForLaunch ? '#22c55e' : '#ef4444' }}>
              {isGoForLaunch ? '✓ GO' : '✕ NO-GO'}
            </div>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>Overall: {avgScore}/100</div>
          </div>
        )}
      </div>

      {/* Status Banner */}
      {!loading && (
        <div style={{
          borderRadius: 8, padding: 14, marginBottom: 20,
          background: isGoForLaunch ? '#22c55e10' : '#ef444410',
          border: `1px solid ${isGoForLaunch ? '#22c55e33' : '#ef444433'}`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div>
            <div style={{ fontWeight: 700, color: isGoForLaunch ? '#22c55e' : '#ef4444', fontSize: 15 }}>
              {isGoForLaunch ? 'All systems GO for General Availability' : `Launch blocked — ${blockingDimensions.length} blocking dimension(s)`}
            </div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
              {readyDimensions.length} ready · {atRiskDimensions.length} at risk · {blockingDimensions.length} blocking
            </div>
          </div>
          {onLaunchApproved && isGoForLaunch && (
            <button
              onClick={onLaunchApproved}
              style={{
                padding: '10px 20px', background: '#22c55e', color: '#fff',
                border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 14,
              }}
            >
              Approve GA Launch
            </button>
          )}
        </div>
      )}

      {loading && <div style={{ color: '#64748b', textAlign: 'center', padding: 40 }}>Loading readiness scores…</div>}
      {error && <div style={{ color: '#ef4444', padding: 12 }}>{error}</div>}

      {!loading && !error && (
        <>
          {blockingDimensions.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <h3 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600, color: '#ef4444', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Blocking ({blockingDimensions.length})
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
                {blockingDimensions.map(s => <ScoreCard key={s.id} score={s} />)}
              </div>
            </div>
          )}

          {atRiskDimensions.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <h3 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                At Risk ({atRiskDimensions.length})
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
                {atRiskDimensions.map(s => <ScoreCard key={s.id} score={s} />)}
              </div>
            </div>
          )}

          <div>
            <h3 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600, color: '#22c55e', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Ready ({readyDimensions.length})
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
              {readyDimensions.map(s => <ScoreCard key={s.id} score={s} />)}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
