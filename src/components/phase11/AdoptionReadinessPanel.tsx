// Denver Engineering — Adoption Readiness Panel (Phase 11)
// Show telemetry-driven adoption scores and readiness indicators per tenant

import React, { useEffect, useState, useCallback } from 'react'

interface AdoptionMetrics {
  featureAdoption: number
  workflowCompletion: number
  aiAcceptance: number
  onboardingCompletion: number
  tenantMaturity: number
}

interface TelemetryTrend {
  metricType: string
  direction: 'improving' | 'degrading' | 'stable'
  changePercent: number
  confidence: number
}

interface AdoptionReadinessPanelProps {
  tenantId: string
  environment?: string
}

const METRIC_LABELS: Record<string, string> = {
  featureAdoption: 'Feature Adoption',
  workflowCompletion: 'Workflow Completion',
  aiAcceptance: 'AI Acceptance',
  onboardingCompletion: 'Onboarding',
  tenantMaturity: 'Tenant Maturity',
}

function MetricRow({ label, value, trend }: { label: string; value: number; trend?: TelemetryTrend }) {
  const color = value >= 70 ? '#22c55e' : value >= 40 ? '#f59e0b' : '#ef4444'
  const trendIcon = trend
    ? trend.direction === 'improving' ? '↑'
    : trend.direction === 'degrading' ? '↓' : '→'
    : null
  const trendColor = trend
    ? trend.direction === 'improving' ? '#22c55e'
    : trend.direction === 'degrading' ? '#ef4444' : '#94a3b8'
    : '#94a3b8'

  return (
    <div style={{ padding: '10px 0', borderBottom: '1px solid #1e293b' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, alignItems: 'center' }}>
        <span style={{ fontSize: 13, color: '#cbd5e1' }}>{label}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {trendIcon && (
            <span style={{ fontSize: 12, color: trendColor, fontWeight: 600 }}>
              {trendIcon} {Math.abs(trend!.changePercent).toFixed(1)}%
            </span>
          )}
          <span style={{ fontWeight: 700, fontSize: 15, color }}>{value}%</span>
        </div>
      </div>
      <div style={{ background: '#0f172a', borderRadius: 4, height: 6 }}>
        <div
          style={{
            background: color, borderRadius: 4, height: '100%',
            width: `${Math.min(100, value)}%`, transition: 'width 0.3s',
          }}
        />
      </div>
    </div>
  )
}

export function AdoptionReadinessPanel({ tenantId, environment = 'production' }: AdoptionReadinessPanelProps) {
  const [metrics, setMetrics] = useState<AdoptionMetrics | null>(null)
  const [trends, setTrends] = useState<TelemetryTrend[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const [metricsRes, trendsRes] = await Promise.all([
        fetch(`/api/phase11/tenants/${tenantId}/adoption-metrics`),
        fetch(`/api/phase11/telemetry/trends?environment=${environment}`),
      ])
      const [metricsData, trendsData] = await Promise.all([metricsRes.json(), trendsRes.json()])
      setMetrics(metricsData)
      setTrends(trendsData.trends ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [tenantId, environment])

  useEffect(() => { fetchData() }, [fetchData])

  const getTrend = (metricKey: string) => {
    const metricMap: Record<string, string> = {
      featureAdoption: 'feature_adoption',
      workflowCompletion: 'workflow_completion',
      aiAcceptance: 'ai_acceptance',
      onboardingCompletion: 'onboarding_completion',
      tenantMaturity: 'tenant_maturity',
    }
    return trends.find(t => t.metricType === metricMap[metricKey])
  }

  const overallScore = metrics
    ? Math.round(
        (metrics.featureAdoption + metrics.workflowCompletion +
         metrics.aiAcceptance + metrics.onboardingCompletion + metrics.tenantMaturity) / 5
      )
    : 0

  const readinessLabel = overallScore >= 70 ? 'Ready' : overallScore >= 40 ? 'At Risk' : 'Not Ready'
  const readinessColor = overallScore >= 70 ? '#22c55e' : overallScore >= 40 ? '#f59e0b' : '#ef4444'

  const degradingCount = trends.filter(t => t.direction === 'degrading' && t.confidence >= 0.5).length

  return (
    <div style={{ background: '#0f172a', color: '#e2e8f0', fontFamily: 'sans-serif', padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Adoption Readiness</h3>
        {!loading && metrics && (
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: readinessColor }}>{overallScore}</div>
            <div style={{ fontSize: 11, color: readinessColor, fontWeight: 600 }}>{readinessLabel}</div>
          </div>
        )}
      </div>

      {degradingCount > 0 && (
        <div style={{
          background: '#ef444420', border: '1px solid #ef444444', borderRadius: 6,
          padding: '8px 12px', marginBottom: 12, fontSize: 12, color: '#fca5a5',
        }}>
          ⚠ {degradingCount} metric(s) degrading — review recommended
        </div>
      )}

      {loading && <div style={{ color: '#64748b', textAlign: 'center', padding: 24 }}>Loading…</div>}
      {error && <div style={{ color: '#ef4444', padding: 8 }}>{error}</div>}

      {!loading && metrics && (
        <div style={{ background: '#1e293b', borderRadius: 8, padding: 16 }}>
          {(Object.keys(METRIC_LABELS) as Array<keyof AdoptionMetrics>).map(key => (
            <MetricRow
              key={key}
              label={METRIC_LABELS[key]}
              value={metrics[key]}
              trend={getTrend(key)}
            />
          ))}
        </div>
      )}

      {!loading && metrics && (
        <div style={{
          marginTop: 12, display: 'flex', justifyContent: 'space-between',
          fontSize: 11, color: '#64748b',
        }}>
          <span>Based on last 7 days telemetry</span>
          <button
            onClick={fetchData}
            style={{ background: 'none', border: 'none', color: '#3b82f6', cursor: 'pointer', fontSize: 11 }}
          >
            Refresh
          </button>
        </div>
      )}
    </div>
  )
}
