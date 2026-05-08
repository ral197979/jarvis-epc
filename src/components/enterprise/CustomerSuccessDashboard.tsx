// Denver Engineering — Customer Success Dashboard (v8.0.0)
// Central view for customer health, adoption, churn risk, and open support load.

import React, { useEffect, useState } from 'react'
import { CustomerHealthScore } from '../../../api/services/enterprise/enterpriseTypes'

interface Props {
  tenantId: string
}

const RING_SIZE = 72

function ScoreRing({ value, label, color }: { value: number; label: string; color: string }) {
  const pct = Math.min(100, Math.max(0, value))
  const r = 28
  const circ = 2 * Math.PI * r
  const dash = (pct / 100) * circ

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={RING_SIZE} height={RING_SIZE} viewBox="0 0 64 64">
        <circle cx="32" cy="32" r={r} fill="none" stroke="#374151" strokeWidth={6} />
        <circle
          cx="32" cy="32" r={r}
          fill="none"
          stroke={color}
          strokeWidth={6}
          strokeDasharray={`${dash} ${circ - dash}`}
          strokeLinecap="round"
          transform="rotate(-90 32 32)"
        />
        <text x="32" y="37" textAnchor="middle" fontSize="13" fontWeight="bold" fill="white">
          {pct}
        </text>
      </svg>
      <span className="text-xs text-gray-400 text-center w-20">{label}</span>
    </div>
  )
}

function riskColor(score: number): string {
  if (score >= 70) return '#ef4444'
  if (score >= 40) return '#f59e0b'
  return '#10b981'
}

function healthColor(score: number): string {
  if (score >= 70) return '#10b981'
  if (score >= 40) return '#f59e0b'
  return '#ef4444'
}

export function CustomerSuccessDashboard({ tenantId }: Props) {
  const [health, setHealth] = useState<CustomerHealthScore | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/v1/enterprise/health-score`, {
      headers: { 'X-Tenant-ID': tenantId },
    })
      .then(r => r.json())
      .then((data: CustomerHealthScore) => { setHealth(data); setLoading(false) })
      .catch(e => { setError(String(e)); setLoading(false) })
  }, [tenantId])

  if (loading) return <div className="p-6 text-gray-400 animate-pulse">Loading health data…</div>
  if (error) return <div className="p-6 text-red-400">{error}</div>
  if (!health) return null

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-white font-semibold text-lg">Customer Health</h2>
        <span className="text-xs text-gray-500">
          Generated {new Date(health.generatedAt).toLocaleTimeString()}
        </span>
      </div>

      {/* Overall score */}
      <div className="flex items-center gap-4 bg-gray-800 rounded-lg p-4">
        <ScoreRing value={health.tenantHealthScore} label="Overall Health" color={healthColor(health.tenantHealthScore)} />
        <div className="flex-1">
          <p className="text-white font-medium">
            {health.tenantHealthScore >= 70 ? 'Healthy' : health.tenantHealthScore >= 40 ? 'At Risk' : 'Critical'}
          </p>
          <p className="text-sm text-gray-400 mt-1">
            {health.activeUsers7Days} active users (7d) · {health.featuresEnabled} features enabled
          </p>
          <p className="text-sm text-gray-400">
            {health.openTicketCount} open {health.openTicketCount === 1 ? 'ticket' : 'tickets'}
          </p>
        </div>
      </div>

      {/* Sub-scores */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <ScoreRing value={health.adoptionScore} label="Adoption" color={healthColor(health.adoptionScore)} />
        <ScoreRing value={health.riskOfChurn} label="Churn Risk" color={riskColor(health.riskOfChurn)} />
        <ScoreRing value={100 - health.supportLoad} label="Support OK" color={healthColor(100 - health.supportLoad)} />
        <ScoreRing value={health.aiUsageEfficiency} label="AI Efficiency" color={healthColor(health.aiUsageEfficiency)} />
      </div>
    </div>
  )
}

export default CustomerSuccessDashboard
