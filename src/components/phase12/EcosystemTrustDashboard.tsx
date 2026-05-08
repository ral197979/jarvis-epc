// Denver Engineering — Ecosystem Trust Dashboard (Phase 12)
// Shows moderation status, plugin trust scores, and partner reputation

import React, { useState, useEffect } from 'react'

interface PluginTrustScore {
  pluginId: string
  score: number
  abuseFlags: number
  sandboxPassRate: number
}

interface PartnerReputation {
  partnerId: string
  trustLevel: 'untrusted' | 'provisional' | 'trusted' | 'verified'
  reputationScore: number
  errorRate: number
}

interface EcosystemTrustSummary {
  totalPlugins: number
  trustedPlugins: number
  lowTrustPlugins: number
  avgPluginTrustScore: number
  totalPartners: number
  verifiedPartners: number
  untrustedPartners: number
  avgPartnerReputation: number
  pendingModerations: number
  trustSignalScore: number
}

const TRUST_LEVEL_COLORS: Record<string, string> = {
  verified: '#22c55e', trusted: '#3b82f6', provisional: '#eab308', untrusted: '#ef4444',
}

export function EcosystemTrustDashboard() {
  const [summary, setSummary] = useState<EcosystemTrustSummary | null>(null)
  const [lowTrustPlugins, setLowTrustPlugins] = useState<PluginTrustScore[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const [summaryRes, pluginsRes] = await Promise.all([
          fetch('/api/phase12/ecosystem/trust-summary'),
          fetch('/api/phase12/ecosystem/plugins/low-trust'),
        ])
        setSummary(await summaryRes.json())
        const p = await pluginsRes.json()
        setLowTrustPlugins(p.plugins ?? [])
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) return <div style={{ color: '#64748b', padding: 24 }}>Loading…</div>
  if (!summary) return null

  const trustPct = summary.totalPlugins > 0 ? ((summary.trustedPlugins / summary.totalPlugins) * 100).toFixed(0) : '0'

  return (
    <div style={{ background: '#0a0f1e', fontFamily: 'sans-serif', padding: 24 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0', marginBottom: 20 }}>🌐 Ecosystem Trust</div>

      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Plugin Trust Rate', value: `${trustPct}%`, sub: `${summary.lowTrustPlugins} low-trust`, color: summary.lowTrustPlugins === 0 ? '#22c55e' : '#eab308' },
          { label: 'Avg Plugin Score', value: summary.avgPluginTrustScore.toFixed(0), sub: '/100', color: summary.avgPluginTrustScore >= 70 ? '#22c55e' : '#eab308' },
          { label: 'Pending Moderations', value: summary.pendingModerations, sub: 'awaiting review', color: summary.pendingModerations === 0 ? '#22c55e' : '#f97316' },
          { label: 'Trust Signal', value: `${(summary.trustSignalScore * 100).toFixed(0)}%`, sub: 'ecosystem health', color: summary.trustSignalScore >= 0.75 ? '#22c55e' : '#eab308' },
        ].map(card => (
          <div key={card.label} style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: 14 }}>
            <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', marginBottom: 4 }}>{card.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: card.color }}>{card.value}</div>
            <div style={{ fontSize: 11, color: '#64748b' }}>{card.sub}</div>
          </div>
        ))}
      </div>

      {/* Low Trust Plugins */}
      {lowTrustPlugins.length > 0 && (
        <div style={{ background: '#0f172a', border: '1px solid #ef444430', borderRadius: 8, padding: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#ef4444', marginBottom: 10, textTransform: 'uppercase' }}>
            ⚠️ Low-Trust Plugins ({lowTrustPlugins.length})
          </div>
          {lowTrustPlugins.map(p => (
            <div key={p.pluginId} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '8px 0', borderBottom: '1px solid #1e293b',
            }}>
              <div>
                <div style={{ fontSize: 12, color: '#e2e8f0' }}>{p.pluginId.slice(0, 20)}…</div>
                {p.abuseFlags > 0 && (
                  <div style={{ fontSize: 10, color: '#ef4444' }}>⚑ {p.abuseFlags} abuse flag(s)</div>
                )}
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#ef4444' }}>{p.score}</div>
                <div style={{ fontSize: 10, color: '#64748b' }}>
                  sandbox: {(p.sandboxPassRate * 100).toFixed(0)}%
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Partner Summary */}
      <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 10, textTransform: 'uppercase' }}>
          Partner Ecosystem
        </div>
        <div style={{ display: 'flex', gap: 16 }}>
          {[
            ['Total', summary.totalPartners, '#64748b'],
            ['Verified', summary.verifiedPartners, '#22c55e'],
            ['Untrusted', summary.untrustedPartners, '#ef4444'],
          ].map(([label, val, color]) => (
            <div key={label as string}>
              <div style={{ fontSize: 18, fontWeight: 700, color: color as string }}>{val}</div>
              <div style={{ fontSize: 11, color: '#64748b' }}>{label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
