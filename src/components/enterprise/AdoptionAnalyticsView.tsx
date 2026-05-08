// Denver Engineering — Adoption Analytics View (v8.0.0)
// Feature adoption rates, usage trends, and entitlement utilization.

import React, { useEffect, useState } from 'react'
import { TenantFeatureFlag, UsageSummary } from '../../../api/services/enterprise/enterpriseTypes'

interface Props {
  tenantId: string
}

const FEATURE_LABELS: Record<string, string> = {
  digital_twin: 'Digital Twin',
  adaptive_intelligence: 'Adaptive Intelligence',
  scenario_simulation: 'Scenario Simulation',
  multi_agent: 'Multi-Agent',
  compliance_export: 'Compliance Export',
  advanced_analytics: 'Advanced Analytics',
  api_access: 'API Access',
  webhook_delivery: 'Webhooks',
  ai_agents: 'AI Agents',
  predictive_maintenance: 'Predictive Maintenance',
}

function FeatureRow({ flag }: { flag: TenantFeatureFlag }) {
  const label = FEATURE_LABELS[flag.featureKey] ?? flag.featureKey
  const expired = flag.expiresAt != null && new Date(flag.expiresAt) < new Date()
  const active = flag.enabled && !expired
  return (
    <div className="flex items-center gap-3 py-2 border-b border-gray-800 last:border-0">
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${active ? 'bg-emerald-500' : 'bg-gray-600'}`} />
      <span className="text-sm text-gray-300 flex-1">{label}</span>
      {flag.expiresAt != null && !expired && (
        <span className="text-xs text-amber-400">
          Exp {new Date(flag.expiresAt).toLocaleDateString()}
        </span>
      )}
      {expired && <span className="text-xs text-red-400">Expired</span>}
      <span className={`text-xs ${active ? 'text-emerald-400' : 'text-gray-600'}`}>
        {active ? 'Enabled' : 'Disabled'}
      </span>
    </div>
  )
}

export function AdoptionAnalyticsView({ tenantId }: Props) {
  const [flags, setFlags] = useState<TenantFeatureFlag[]>([])
  const [summary, setSummary] = useState<UsageSummary | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const headers = { 'X-Tenant-ID': tenantId }
    Promise.all([
      fetch('/api/v1/enterprise/features', { headers }).then(r => r.json()),
      fetch('/api/v1/enterprise/usage/summary', { headers }).then(r => r.json()),
    ])
      .then(([f, s]: [TenantFeatureFlag[], UsageSummary]) => {
        setFlags(f)
        setSummary(s)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [tenantId])

  if (loading) return <div className="p-4 text-gray-400 animate-pulse">Loading adoption data…</div>

  const enabledCount = flags.filter(f => f.enabled && (f.expiresAt == null || new Date(f.expiresAt) > new Date())).length
  const adoptionPct = flags.length > 0 ? Math.round((enabledCount / flags.length) * 100) : 0

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 space-y-5">
      <h2 className="text-white font-semibold">Adoption Analytics</h2>

      {/* Adoption rate */}
      <div className="bg-gray-800 rounded-lg p-4 flex items-center gap-4">
        <div>
          <p className="text-3xl font-bold text-white">{adoptionPct}%</p>
          <p className="text-xs text-gray-400 mt-0.5">Feature Adoption</p>
        </div>
        <div className="flex-1">
          <div className="bg-gray-700 rounded-full h-2">
            <div className="bg-emerald-500 h-2 rounded-full" style={{ width: `${adoptionPct}%` }} />
          </div>
          <p className="text-xs text-gray-500 mt-1">{enabledCount} of {flags.length} features enabled</p>
        </div>
      </div>

      {/* Usage summary */}
      {summary != null && Object.keys(summary.byType).length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">This Month</p>
          {Object.entries(summary.byType).map(([type, data]) => (
            data != null && (
              <div key={type} className="flex items-center gap-2 text-sm">
                <span className="text-gray-300 flex-1">{type.replace('_', ' ')}</span>
                <span className="text-gray-400">{data.quantity.toLocaleString()} {data.unit}</span>
                {data.cost > 0 && <span className="text-gray-500 text-xs">${data.cost.toFixed(4)}</span>}
              </div>
            )
          ))}
          <div className="pt-1 border-t border-gray-700 flex justify-between text-xs">
            <span className="text-gray-400">Total Cost</span>
            <span className="text-white">${summary.totalCostUsd.toFixed(4)}</span>
          </div>
        </div>
      )}

      {/* Feature flags */}
      <div className="space-y-1">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Feature Flags</p>
        {flags.length === 0
          ? <p className="text-gray-500 text-sm py-2">No features configured</p>
          : flags.map(f => <FeatureRow key={f.id} flag={f} />)
        }
      </div>
    </div>
  )
}

export default AdoptionAnalyticsView
