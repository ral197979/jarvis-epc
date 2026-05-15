// Denver Engineering — Tenant Health Panel (v8.0.0)
// Compact tenant health widget for embedding in dashboards and portals.

import React, { useEffect, useState } from 'react'
import { CustomerHealthScore } from '../../../api/services/enterprise/enterpriseTypes'
import { EntitlementSummary } from '../../../api/services/enterprise/featureGateService'

interface Props {
  tenantId: string
  compact?: boolean
}

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const w = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-gray-700 rounded-full h-1.5">
        <div className="h-1.5 rounded-full" style={{ width: `${w}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs text-gray-400 w-8 text-right">{value}</span>
    </div>
  )
}

function healthLabel(score: number): { text: string; color: string } {
  if (score >= 75) return { text: 'Healthy', color: 'text-emerald-400' }
  if (score >= 50) return { text: 'Fair', color: 'text-yellow-400' }
  if (score >= 25) return { text: 'At Risk', color: 'text-orange-400' }
  return { text: 'Critical', color: 'text-red-400' }
}

export function TenantHealthPanel({ tenantId, compact = false }: Props) {
  const [health, setHealth] = useState<CustomerHealthScore | null>(null)
  const [entitlements, setEntitlements] = useState<EntitlementSummary | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const headers = { 'X-Tenant-ID': tenantId }
    Promise.all([
      fetch('/api/v1/enterprise/health-score', { headers }).then(r => r.json()),
      fetch('/api/v1/enterprise/entitlements', { headers }).then(r => r.json()),
    ])
      .then(([h, e]: [CustomerHealthScore, EntitlementSummary]) => {
        setHealth(h)
        setEntitlements(e)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [tenantId])

  if (loading) return <div className="p-4 text-gray-400 text-sm animate-pulse">Loading…</div>
  if (!health) return null

  const { text: statusText, color: statusColor } = healthLabel(health.tenantHealthScore)

  if (compact) {
    return (
      <div className="flex items-center gap-3 bg-gray-800 rounded-lg px-4 py-2">
        <span className="text-2xl font-bold text-white">{health.tenantHealthScore}</span>
        <div>
          <p className={`text-sm font-medium ${statusColor}`}>{statusText}</p>
          <p className="text-xs text-gray-500">{health.activeUsers7Days} active · {health.openTicketCount} tickets</p>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg p-5 space-y-4">
      <div className="flex items-baseline gap-3">
        <span className="text-3xl font-bold text-white">{health.tenantHealthScore}</span>
        <span className={`text-sm font-medium ${statusColor}`}>{statusText}</span>
        <span className="text-xs text-gray-500 ml-auto">
          {entitlements != null ? `${entitlements.tier} · ${entitlements.seatCount}/${entitlements.seatLimit} seats` : ''}
        </span>
      </div>

      <div className="space-y-3">
        <div>
          <div className="flex justify-between text-xs text-gray-400 mb-1">
            <span>Adoption</span><span>{health.adoptionScore}/100</span>
          </div>
          <MiniBar value={health.adoptionScore} max={100} color="#10b981" />
        </div>
        <div>
          <div className="flex justify-between text-xs text-gray-400 mb-1">
            <span>Churn Risk</span><span>{health.riskOfChurn}/100</span>
          </div>
          <MiniBar value={health.riskOfChurn} max={100} color={health.riskOfChurn > 60 ? '#ef4444' : '#f59e0b'} />
        </div>
        <div>
          <div className="flex justify-between text-xs text-gray-400 mb-1">
            <span>Support Load</span><span>{health.supportLoad}/100</span>
          </div>
          <MiniBar value={health.supportLoad} max={100} color="#f59e0b" />
        </div>
        <div>
          <div className="flex justify-between text-xs text-gray-400 mb-1">
            <span>AI Efficiency</span><span>{health.aiUsageEfficiency}/100</span>
          </div>
          <MiniBar value={health.aiUsageEfficiency} max={100} color="#6366f1" />
        </div>
      </div>

      <div className="pt-1 border-t border-gray-800 flex gap-4 text-xs text-gray-500">
        <span>{health.activeUsers7Days} active (7d)</span>
        <span>{health.featuresEnabled} features</span>
        <span>{health.openTicketCount} open tickets</span>
      </div>
    </div>
  )
}

export default TenantHealthPanel
