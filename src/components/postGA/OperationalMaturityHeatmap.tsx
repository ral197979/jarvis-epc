// Denver Engineering — Operational Maturity Heatmap (Post-GA)
// Visualizes per-tenant adoption scores, maturity tiers, and churn risk across the platform

import React, { useState, useEffect } from 'react'

interface TenantAdoptionRecord {
  id: string
  tenantId: string
  tenantName?: string
  adoptionScore: number
  adoptionTier: 'new' | 'activating' | 'active' | 'power' | 'champion'
  churnRisk: number
  dailyActiveRate: number
  workflowCompletionRate: number
  aiAcceptanceRate: number
  interventionType: string | null
  measuredAt: string
}

interface MaturityData {
  records: TenantAdoptionRecord[]
  avgAdoptionScore: number
  tierCounts: Record<string, number>
  churnRiskCount: number
}

const TIER_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
  new:        { color: '#94a3b8', bg: '#0f172a', label: 'New' },
  activating: { color: '#60a5fa', bg: '#0c1f3f', label: 'Activating' },
  active:     { color: '#34d399', bg: '#052e1a', label: 'Active' },
  power:      { color: '#a78bfa', bg: '#1a0f3f', label: 'Power' },
  champion:   { color: '#fbbf24', bg: '#2a1c00', label: 'Champion' },
}

const INTERVENTION_LABELS: Record<string, string> = {
  churn_recovery: '🚨 Churn Recovery',
  onboarding_assist: '📋 Onboarding',
  feature_enablement: '⚡ Feature Enablement',
  adoption_coaching: '🎯 Adoption Coaching',
}

function TierPill({ tier }: { tier: string }) {
  const cfg = TIER_CONFIG[tier] ?? { color: '#94a3b8', bg: '#0f172a', label: tier }
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 11,
      background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.color}40`, fontWeight: 600,
    }}>
      {cfg.label}
    </span>
  )
}

function ChurnRiskBar({ risk }: { risk: number }) {
  const pct = Math.round(risk * 100)
  const color = risk >= 0.5 ? '#ef4444' : risk >= 0.35 ? '#f97316' : '#22c55e'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ width: 60, height: 4, background: '#1e293b', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2 }} />
      </div>
      <span style={{ fontSize: 11, color, minWidth: 32, textAlign: 'right' }}>{pct}%</span>
    </div>
  )
}

function ScoreCell({ value, low, high }: { value: number; low: number; high: number }) {
  const color = value >= high ? '#22c55e' : value >= low ? '#eab308' : '#ef4444'
  const pct = Math.round(value * 100)
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 12, fontWeight: 600, color }}>{pct}%</div>
    </div>
  )
}

function TenantCard({ record }: { record: TenantAdoptionRecord }) {
  const cfg = TIER_CONFIG[record.adoptionTier] ?? TIER_CONFIG.new
  const isAtRisk = record.churnRisk >= 0.35
  return (
    <div style={{
      background: cfg.bg,
      border: `1px solid ${isAtRisk ? '#ef444440' : `${cfg.color}30`}`,
      borderRadius: 8, padding: 14,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>
            {record.tenantName ?? record.tenantId}
          </div>
          <TierPill tier={record.adoptionTier} />
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{
            fontSize: 22, fontWeight: 700,
            color: record.adoptionScore >= 65 ? '#22c55e' : record.adoptionScore >= 50 ? '#eab308' : '#ef4444',
          }}>
            {record.adoptionScore}
          </div>
          <div style={{ fontSize: 10, color: '#475569' }}>score</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginBottom: 10 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 10, color: '#475569', marginBottom: 2 }}>Daily Active</div>
          <ScoreCell value={record.dailyActiveRate} low={0.3} high={0.6} />
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 10, color: '#475569', marginBottom: 2 }}>Workflows</div>
          <ScoreCell value={record.workflowCompletionRate} low={0.5} high={0.75} />
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 10, color: '#475569', marginBottom: 2 }}>AI Acceptance</div>
          <ScoreCell value={record.aiAcceptanceRate} low={0.5} high={0.7} />
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 10, color: '#475569', marginBottom: 3 }}>Churn Risk</div>
          <ChurnRiskBar risk={record.churnRisk} />
        </div>
        {record.interventionType && (
          <span style={{ fontSize: 11, color: '#fbbf24' }}>
            {INTERVENTION_LABELS[record.interventionType] ?? record.interventionType}
          </span>
        )}
      </div>
    </div>
  )
}

export function OperationalMaturityHeatmap() {
  const [data, setData] = useState<MaturityData | null>(null)
  const [loading, setLoading] = useState(true)
  const [tierFilter, setTierFilter] = useState<string>('all')
  const [sortBy, setSortBy] = useState<'score' | 'risk'>('score')

  const load = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/postGA/adoption/maturity')
      setData(await res.json())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const filtered = (data?.records ?? [])
    .filter(r => tierFilter === 'all' || r.adoptionTier === tierFilter)
    .sort((a, b) => sortBy === 'score'
      ? b.adoptionScore - a.adoptionScore
      : b.churnRisk - a.churnRisk
    )

  return (
    <div style={{ background: '#060d1a', minHeight: '100vh', fontFamily: 'sans-serif', padding: 24, color: '#e2e8f0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 700 }}>🗺 Operational Maturity Heatmap</div>
          <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>
            Per-tenant adoption scores and maturity tier distribution
          </div>
        </div>
        <button
          onClick={load}
          disabled={loading}
          style={{
            padding: '7px 14px', borderRadius: 6, border: '1px solid #1e3a5f',
            background: '#0f2241', color: '#7dd3fc', cursor: 'pointer', fontSize: 12,
          }}
        >
          {loading ? '…' : '↻'}
        </button>
      </div>

      {data && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            {Object.entries(TIER_CONFIG).map(([tier, cfg]) => (
              <div key={tier} style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: '10px 14px', textAlign: 'center', minWidth: 80 }}>
                <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', marginBottom: 3 }}>{cfg.label}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: cfg.color }}>
                  {data.tierCounts[tier] ?? 0}
                </div>
              </div>
            ))}
            <div style={{ background: '#1c0000', border: '1px solid #ef444440', borderRadius: 8, padding: '10px 14px', textAlign: 'center', minWidth: 80 }}>
              <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', marginBottom: 3 }}>At Risk</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#ef4444' }}>{data.churnRiskCount}</div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
            <select
              value={tierFilter}
              onChange={e => setTierFilter(e.target.value)}
              style={{
                background: '#0f172a', border: '1px solid #1e293b', borderRadius: 6,
                color: '#94a3b8', padding: '5px 10px', fontSize: 12,
              }}
            >
              <option value="all">All Tiers</option>
              {Object.entries(TIER_CONFIG).map(([tier, cfg]) => (
                <option key={tier} value={tier}>{cfg.label}</option>
              ))}
            </select>
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value as 'score' | 'risk')}
              style={{
                background: '#0f172a', border: '1px solid #1e293b', borderRadius: 6,
                color: '#94a3b8', padding: '5px 10px', fontSize: 12,
              }}
            >
              <option value="score">Sort: Score ↓</option>
              <option value="risk">Sort: Churn Risk ↓</option>
            </select>
            <span style={{ fontSize: 12, color: '#475569' }}>{filtered.length} tenants</span>
          </div>
        </>
      )}

      {loading && !data ? (
        <div style={{ color: '#475569', textAlign: 'center', padding: 80 }}>Loading…</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {filtered.map(r => <TenantCard key={r.id} record={r} />)}
          {filtered.length === 0 && (
            <div style={{ color: '#475569', textAlign: 'center', padding: 40, gridColumn: '1/-1' }}>No tenants match filter.</div>
          )}
        </div>
      )}
    </div>
  )
}
