// Denver Engineering — Executive Operations Center (Phase 12)
// High-level platform health and operational maturity dashboard

import React, { useState, useEffect } from 'react'

interface ExecMetric {
  label: string
  value: string | number
  unit?: string
  trend?: 'up' | 'down' | 'stable'
  status: 'good' | 'warn' | 'bad'
}

interface PlatformSummary {
  governanceStatus: string
  replayDeterminism: number
  activeTenants: number
  churnRiskCount: number
  avgResilienceScore: number
  avgMaturityLevel: string
  openCriticalIncidents: number
  ecosystemTrustScore: number
  complexityScore: number
  complexityBudget: number
  slaComplianceRate: number
  deploymentConfidence: number
}

const STATUS_COLORS = { good: '#22c55e', warn: '#eab308', bad: '#ef4444' }

function MetricCard({ metric }: { metric: ExecMetric }) {
  const color = STATUS_COLORS[metric.status]
  return (
    <div style={{
      background: '#0f172a', border: `1px solid ${color}30`,
      borderRadius: 8, padding: 16,
    }}>
      <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', marginBottom: 6 }}>{metric.label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color }}>
        {metric.value}{metric.unit}
      </div>
      {metric.trend && (
        <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
          {metric.trend === 'up' ? '↑' : metric.trend === 'down' ? '↓' : '→'}
        </div>
      )}
    </div>
  )
}

export function ExecutiveOperationsCenter() {
  const [summary, setSummary] = useState<PlatformSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())

  const load = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/phase12/executive/summary')
      setSummary(await res.json())
      setLastRefresh(new Date())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const getMetrics = (s: PlatformSummary): ExecMetric[] => [
    {
      label: 'Governance', value: s.governanceStatus.toUpperCase(),
      status: s.governanceStatus === 'compliant' ? 'good' : s.governanceStatus === 'warning' ? 'warn' : 'bad',
    },
    {
      label: 'Replay Determinism', value: (s.replayDeterminism * 100).toFixed(1), unit: '%',
      status: s.replayDeterminism === 1.0 ? 'good' : s.replayDeterminism >= 0.99 ? 'warn' : 'bad',
    },
    {
      label: 'Active Tenants', value: s.activeTenants,
      status: 'good',
    },
    {
      label: 'Churn Risk Tenants', value: s.churnRiskCount,
      status: s.churnRiskCount === 0 ? 'good' : s.churnRiskCount <= 3 ? 'warn' : 'bad',
    },
    {
      label: 'Resilience Score', value: s.avgResilienceScore, unit: '/100',
      status: s.avgResilienceScore >= 75 ? 'good' : s.avgResilienceScore >= 60 ? 'warn' : 'bad',
    },
    {
      label: 'Open Critical Incidents', value: s.openCriticalIncidents,
      status: s.openCriticalIncidents === 0 ? 'good' : s.openCriticalIncidents <= 2 ? 'warn' : 'bad',
    },
    {
      label: 'Ecosystem Trust', value: (s.ecosystemTrustScore * 100).toFixed(0), unit: '%',
      status: s.ecosystemTrustScore >= 0.75 ? 'good' : s.ecosystemTrustScore >= 0.55 ? 'warn' : 'bad',
    },
    {
      label: 'Complexity Budget', value: `${s.complexityScore}/${s.complexityBudget}`,
      status: s.complexityScore <= s.complexityBudget * 0.65 ? 'good' : s.complexityScore <= s.complexityBudget ? 'warn' : 'bad',
    },
    {
      label: 'SLA Compliance', value: (s.slaComplianceRate * 100).toFixed(0), unit: '%',
      status: s.slaComplianceRate >= 0.95 ? 'good' : s.slaComplianceRate >= 0.85 ? 'warn' : 'bad',
    },
    {
      label: 'Deployment Confidence', value: s.deploymentConfidence, unit: '/100',
      status: s.deploymentConfidence >= 80 ? 'good' : s.deploymentConfidence >= 65 ? 'warn' : 'bad',
    },
  ]

  return (
    <div style={{ background: '#0a0f1e', minHeight: '100vh', fontFamily: 'sans-serif', padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#e2e8f0' }}>📊 Executive Operations Center</div>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
            Last updated: {lastRefresh.toLocaleTimeString()}
          </div>
        </div>
        <button
          onClick={load}
          disabled={loading}
          style={{
            padding: '7px 14px', borderRadius: 6, border: '1px solid #334155',
            background: '#1e293b', color: '#94a3b8', cursor: 'pointer', fontSize: 12,
          }}
        >
          {loading ? 'Refreshing…' : '↻ Refresh'}
        </button>
      </div>

      {loading && !summary ? (
        <div style={{ color: '#64748b', textAlign: 'center', padding: 80 }}>Loading…</div>
      ) : summary ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
          {getMetrics(summary).map(m => <MetricCard key={m.label} metric={m} />)}
        </div>
      ) : null}
    </div>
  )
}
