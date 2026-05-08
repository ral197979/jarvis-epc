// Denver Engineering — Tenant Health Intervention Panel (Phase 12)
// Displays health signals and triggers CSM interventions

import React, { useState, useEffect } from 'react'

interface TenantHealthData {
  tenantId: string
  overallScore: number
  churnRiskScore: number
  maturityLevel: string
  onboardingScore: number
  adoptionScore: number
  maturityScore: number
  supportHealthScore: number
  aiUsageScore: number
  computedAt: string
}

interface Intervention {
  type: string
  reason: string
  urgency: 'critical' | 'high' | 'medium'
}

function computeInterventions(data: TenantHealthData): Intervention[] {
  const interventions: Intervention[] = []
  if (data.churnRiskScore >= 0.35) {
    interventions.push({ type: 'Churn Recovery', reason: `Churn risk ${(data.churnRiskScore * 100).toFixed(0)}% — executive escalation needed`, urgency: 'critical' })
  }
  if (data.adoptionScore < 40) {
    interventions.push({ type: 'Adoption Coaching', reason: `Adoption ${data.adoptionScore}% — below minimum threshold`, urgency: 'high' })
  }
  if (data.supportHealthScore < 50) {
    interventions.push({ type: 'Support Review', reason: `Support health ${data.supportHealthScore}% — SLA breaches likely`, urgency: 'high' })
  }
  if (data.onboardingScore < 70) {
    interventions.push({ type: 'Onboarding Assistance', reason: `Onboarding ${data.onboardingScore}% — needs guided session`, urgency: 'medium' })
  }
  return interventions
}

const URGENCY_COLORS = { critical: '#ef4444', high: '#f97316', medium: '#eab308' }
const MATURITY_COLORS: Record<string, string> = {
  optimized: '#22c55e', advanced: '#3b82f6', proficient: '#8b5cf6',
  developing: '#f97316', starter: '#64748b',
}

interface TenantHealthInterventionPanelProps {
  tenantId: string
}

export function TenantHealthInterventionPanel({ tenantId }: TenantHealthInterventionPanelProps) {
  const [health, setHealth] = useState<TenantHealthData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/phase12/tenants/${tenantId}/health`)
        const data = await res.json()
        setHealth(data)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [tenantId])

  if (loading) return <div style={{ color: '#64748b', padding: 24 }}>Loading…</div>
  if (!health) return <div style={{ color: '#64748b', padding: 24 }}>No health data available.</div>

  const interventions = computeInterventions(health)

  return (
    <div style={{ background: '#0a0f1e', fontFamily: 'sans-serif', padding: 24 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0', marginBottom: 16 }}>
        🏥 Tenant Health — {tenantId.slice(0, 12)}…
      </div>

      {/* Overall Score */}
      <div style={{
        background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: 16, marginBottom: 16,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div>
          <div style={{ fontSize: 28, fontWeight: 700, color: health.overallScore >= 70 ? '#22c55e' : health.overallScore >= 50 ? '#eab308' : '#ef4444' }}>
            {health.overallScore}
          </div>
          <div style={{ fontSize: 11, color: '#64748b' }}>Overall Success Score</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <span style={{
            padding: '3px 10px', borderRadius: 4, fontSize: 11, fontWeight: 700,
            background: `${MATURITY_COLORS[health.maturityLevel] ?? '#64748b'}20`,
            color: MATURITY_COLORS[health.maturityLevel] ?? '#64748b',
          }}>
            {health.maturityLevel.toUpperCase()}
          </span>
          <div style={{ fontSize: 11, color: health.churnRiskScore >= 0.35 ? '#ef4444' : '#64748b', marginTop: 4 }}>
            Churn Risk: {(health.churnRiskScore * 100).toFixed(0)}%
          </div>
        </div>
      </div>

      {/* Dimension Bars */}
      <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: 16, marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 12, textTransform: 'uppercase' }}>Score Breakdown</div>
        {[
          ['Onboarding', health.onboardingScore],
          ['Adoption', health.adoptionScore],
          ['Maturity', health.maturityScore],
          ['Support Health', health.supportHealthScore],
          ['AI Usage', health.aiUsageScore],
        ].map(([label, score]) => (
          <div key={label as string} style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
              <span style={{ fontSize: 12, color: '#94a3b8' }}>{label}</span>
              <span style={{ fontSize: 12, color: (score as number) >= 70 ? '#22c55e' : '#eab308' }}>{score}</span>
            </div>
            <div style={{ background: '#1e293b', borderRadius: 3, height: 4 }}>
              <div style={{
                width: `${score}%`, height: '100%', borderRadius: 3,
                background: (score as number) >= 70 ? '#22c55e' : (score as number) >= 50 ? '#eab308' : '#ef4444',
                transition: 'width 0.3s',
              }} />
            </div>
          </div>
        ))}
      </div>

      {/* Interventions */}
      {interventions.length > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 8, textTransform: 'uppercase' }}>
            Required Interventions ({interventions.length})
          </div>
          {interventions.map((iv, i) => (
            <div key={i} style={{
              background: `${URGENCY_COLORS[iv.urgency]}10`, border: `1px solid ${URGENCY_COLORS[iv.urgency]}30`,
              borderRadius: 6, padding: '10px 14px', marginBottom: 8,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>{iv.type}</div>
                <span style={{ fontSize: 10, color: URGENCY_COLORS[iv.urgency], fontWeight: 700, textTransform: 'uppercase' }}>
                  {iv.urgency}
                </span>
              </div>
              <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 3 }}>{iv.reason}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
