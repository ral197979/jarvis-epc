// Denver Engineering — Executive Operations Center V2 (Post-GA)
// Unified post-GA operational health dashboard with launch, adoption, and trust signals

import React, { useState, useEffect } from 'react'

interface PostGAExecSummary {
  launchReadyTenants: number
  activeTenants: number
  blockedTenants: number
  adoptionHealthyCount: number
  avgAdoptionScore: number
  churnRiskCount: number
  ecosystemTrustSignal: number
  criticalModerationItems: number
  governancePassRate: number
  replayDriftAlerts: number
  openSupportOperations: number
  slaBreachCount: number
  complexityOverLimit: boolean
  blockedProposals: number
  deploymentReadiness: number
}

interface ExecKPI {
  label: string
  value: string | number
  unit?: string
  status: 'good' | 'warn' | 'bad'
  sublabel?: string
}

const STATUS_COLORS = { good: '#22c55e', warn: '#eab308', bad: '#ef4444' }
const STATUS_BG = { good: '#052e16', warn: '#1c1400', bad: '#1c0000' }

function KPICard({ kpi }: { kpi: ExecKPI }) {
  const color = STATUS_COLORS[kpi.status]
  return (
    <div style={{
      background: STATUS_BG[kpi.status],
      border: `1px solid ${color}40`,
      borderRadius: 8,
      padding: 16,
    }}>
      <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
        {kpi.label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, color }}>
        {kpi.value}{kpi.unit}
      </div>
      {kpi.sublabel && (
        <div style={{ fontSize: 11, color: '#475569', marginTop: 4 }}>{kpi.sublabel}</div>
      )}
    </div>
  )
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div style={{ fontSize: 11, color: '#475569', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 8, marginTop: 24 }}>
      {title}
    </div>
  )
}

export function ExecutiveOperationsCenterV2() {
  const [summary, setSummary] = useState<PostGAExecSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/postGA/executive/summary')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setSummary(await res.json())
      setLastRefresh(new Date())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const getLaunchKPIs = (s: PostGAExecSummary): ExecKPI[] => [
    {
      label: 'Launch Ready',
      value: s.launchReadyTenants,
      status: s.launchReadyTenants > 0 ? 'good' : 'warn',
      sublabel: `${s.activeTenants} active`,
    },
    {
      label: 'Blocked Tenants',
      value: s.blockedTenants,
      status: s.blockedTenants === 0 ? 'good' : s.blockedTenants <= 2 ? 'warn' : 'bad',
      sublabel: 'awaiting gates',
    },
    {
      label: 'Deployment Readiness',
      value: s.deploymentReadiness,
      unit: '/100',
      status: s.deploymentReadiness >= 80 ? 'good' : s.deploymentReadiness >= 65 ? 'warn' : 'bad',
    },
  ]

  const getAdoptionKPIs = (s: PostGAExecSummary): ExecKPI[] => [
    {
      label: 'Adoption Healthy',
      value: s.adoptionHealthyCount,
      status: s.churnRiskCount === 0 ? 'good' : 'warn',
      sublabel: `of ${s.activeTenants} tenants`,
    },
    {
      label: 'Avg Adoption Score',
      value: s.avgAdoptionScore,
      unit: '/100',
      status: s.avgAdoptionScore >= 65 ? 'good' : s.avgAdoptionScore >= 50 ? 'warn' : 'bad',
    },
    {
      label: 'Churn Risk',
      value: s.churnRiskCount,
      status: s.churnRiskCount === 0 ? 'good' : s.churnRiskCount <= 2 ? 'warn' : 'bad',
      sublabel: 'tenants at risk',
    },
  ]

  const getEcosystemKPIs = (s: PostGAExecSummary): ExecKPI[] => [
    {
      label: 'Trust Signal',
      value: (s.ecosystemTrustSignal * 100).toFixed(0),
      unit: '%',
      status: s.ecosystemTrustSignal >= 0.75 ? 'good' : s.ecosystemTrustSignal >= 0.60 ? 'warn' : 'bad',
    },
    {
      label: 'Critical Moderation',
      value: s.criticalModerationItems,
      status: s.criticalModerationItems === 0 ? 'good' : s.criticalModerationItems <= 3 ? 'warn' : 'bad',
      sublabel: 'items pending',
    },
  ]

  const getGovernanceKPIs = (s: PostGAExecSummary): ExecKPI[] => [
    {
      label: 'Gov Pass Rate',
      value: (s.governancePassRate * 100).toFixed(1),
      unit: '%',
      status: s.governancePassRate >= 0.98 ? 'good' : s.governancePassRate >= 0.95 ? 'warn' : 'bad',
    },
    {
      label: 'Replay Drift Alerts',
      value: s.replayDriftAlerts,
      status: s.replayDriftAlerts === 0 ? 'good' : 'bad',
      sublabel: 'open alerts',
    },
    {
      label: 'Blocked Proposals',
      value: s.blockedProposals,
      status: s.blockedProposals === 0 ? 'good' : s.blockedProposals <= 2 ? 'warn' : 'bad',
      sublabel: 'high-risk unapproved',
    },
  ]

  const getSupportKPIs = (s: PostGAExecSummary): ExecKPI[] => [
    {
      label: 'Open Operations',
      value: s.openSupportOperations,
      status: s.openSupportOperations === 0 ? 'good' : s.openSupportOperations <= 5 ? 'warn' : 'bad',
    },
    {
      label: 'SLA Breaches',
      value: s.slaBreachCount,
      status: s.slaBreachCount === 0 ? 'good' : s.slaBreachCount <= 2 ? 'warn' : 'bad',
    },
  ]

  return (
    <div style={{ background: '#060d1a', minHeight: '100vh', fontFamily: 'sans-serif', padding: 28, color: '#e2e8f0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#f1f5f9' }}>
            🚀 Executive Operations Center <span style={{ fontSize: 13, color: '#38bdf8', fontWeight: 400 }}>v2 — Post-GA</span>
          </div>
          <div style={{ fontSize: 11, color: '#475569', marginTop: 3 }}>
            Last refreshed: {lastRefresh.toLocaleTimeString()}
          </div>
        </div>
        <button
          onClick={load}
          disabled={loading}
          style={{
            padding: '8px 16px', borderRadius: 6, border: '1px solid #1e3a5f',
            background: '#0f2241', color: '#7dd3fc', cursor: 'pointer', fontSize: 12,
          }}
        >
          {loading ? 'Refreshing…' : '↻ Refresh'}
        </button>
      </div>

      {error && (
        <div style={{ background: '#1c0000', border: '1px solid #ef444440', borderRadius: 8, padding: 12, marginBottom: 20, color: '#f87171', fontSize: 13 }}>
          ⚠ {error}
        </div>
      )}

      {loading && !summary ? (
        <div style={{ color: '#475569', textAlign: 'center', padding: 100 }}>Loading…</div>
      ) : summary ? (
        <>
          <SectionHeader title="Tenant Launch" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            {getLaunchKPIs(summary).map(k => <KPICard key={k.label} kpi={k} />)}
          </div>

          <SectionHeader title="Customer Adoption" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            {getAdoptionKPIs(summary).map(k => <KPICard key={k.label} kpi={k} />)}
          </div>

          <SectionHeader title="Ecosystem Trust" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
            {getEcosystemKPIs(summary).map(k => <KPICard key={k.label} kpi={k} />)}
          </div>

          <SectionHeader title="Governance & Replay" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            {getGovernanceKPIs(summary).map(k => <KPICard key={k.label} kpi={k} />)}
          </div>

          <SectionHeader title="Support Operations" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
            {getSupportKPIs(summary).map(k => <KPICard key={k.label} kpi={k} />)}
          </div>

          {summary.complexityOverLimit && (
            <div style={{ marginTop: 24, background: '#1c0000', border: '1px solid #ef4444', borderRadius: 8, padding: 14, color: '#f87171', fontSize: 13 }}>
              ⚠ Complexity growth is over the 10% limit. Platform Evolution Council review required.
            </div>
          )}
        </>
      ) : null}
    </div>
  )
}
