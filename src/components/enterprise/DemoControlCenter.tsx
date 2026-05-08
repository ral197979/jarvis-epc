// Denver Engineering — Demo Control Center (v8.0.0)
// Create, inspect, and reset demo/pilot tenants for sales and pre-sales use.

import React, { useEffect, useState } from 'react'
import { DemoTenant } from '../../../api/services/enterprise/enterpriseTypes'

const TEMPLATES = [
  { key: 'construction_enterprise', label: 'Apex Construction Group', industry: 'Construction', tier: 'Enterprise' },
  { key: 'manufacturing_pro', label: 'Precision Works Inc', industry: 'Manufacturing', tier: 'Professional' },
  { key: 'utilities_enterprise', label: 'GridTech Energy', industry: 'Utilities', tier: 'Enterprise' },
  { key: 'healthcare_pro', label: 'Meridian Health Systems', industry: 'Healthcare', tier: 'Professional' },
  { key: 'logistics_enterprise', label: 'FastFreight Logistics', industry: 'Logistics', tier: 'Enterprise' },
]

function StatusBadge({ status }: { status: string }) {
  const color = status === 'active' ? 'bg-emerald-700 text-emerald-200'
    : status === 'expired' ? 'bg-gray-700 text-gray-400'
    : 'bg-amber-800 text-amber-200'
  return <span className={`text-xs px-2 py-0.5 rounded font-medium ${color}`}>{status}</span>
}

export function DemoControlCenter() {
  const [demos, setDemos] = useState<DemoTenant[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState<string | null>(null)
  const [resetting, setResetting] = useState<string | null>(null)
  const [createdBy, setCreatedBy] = useState('')

  useEffect(() => {
    fetch('/api/v1/enterprise/demo')
      .then(r => r.json())
      .then((d: DemoTenant[]) => { setDemos(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  async function createDemo(templateKey: string) {
    setCreating(templateKey)
    try {
      const res = await fetch('/api/v1/enterprise/demo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateKey, createdBy: createdBy || undefined }),
      })
      const demo: DemoTenant = await res.json()
      setDemos(prev => [demo, ...prev])
    } finally {
      setCreating(null)
    }
  }

  async function resetDemo(tenantId: string) {
    setResetting(tenantId)
    try {
      const res = await fetch(`/api/v1/enterprise/demo/${tenantId}/reset`, { method: 'POST' })
      const demo: DemoTenant = await res.json()
      setDemos(prev => prev.map(d => d.tenantId === tenantId ? demo : d))
    } finally {
      setResetting(null)
    }
  }

  function daysLeft(d: DemoTenant): string {
    if (!d.expiresAt) return '—'
    const diff = new Date(d.expiresAt).getTime() - Date.now()
    if (diff < 0) return 'Expired'
    return `${Math.ceil(diff / 86_400_000)}d`
  }

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 space-y-6">
      <h2 className="text-white font-semibold">Demo Control Center</h2>

      {/* Create new demo */}
      <div className="space-y-3">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Create Demo Tenant</p>
        <input
          type="text"
          placeholder="Created by (optional)"
          value={createdBy}
          onChange={e => setCreatedBy(e.target.value)}
          className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {TEMPLATES.map(t => (
            <button
              key={t.key}
              onClick={() => createDemo(t.key)}
              disabled={creating === t.key}
              className="flex flex-col items-start bg-gray-800 hover:bg-gray-700 border border-gray-600 rounded-md p-3 text-left transition disabled:opacity-50"
            >
              <span className="text-white text-sm font-medium">{t.label}</span>
              <span className="text-xs text-gray-400">{t.industry} · {t.tier}</span>
              {creating === t.key && <span className="text-xs text-blue-400 mt-1">Creating…</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Active demos */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Active Demos ({demos.length})</p>
        {loading && <p className="text-gray-500 text-sm animate-pulse">Loading…</p>}
        {!loading && demos.length === 0 && <p className="text-gray-500 text-sm">No demo tenants yet.</p>}
        {demos.map(d => (
          <div key={d.id} className="flex items-center gap-3 bg-gray-800 rounded-md p-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm text-white truncate">{d.label}</p>
              <p className="text-xs text-gray-400">{d.industry} · {daysLeft(d)} left · ID: {d.tenantId.slice(0, 8)}</p>
            </div>
            <StatusBadge status={d.status} />
            {d.status === 'active' && (
              <button
                onClick={() => resetDemo(d.tenantId)}
                disabled={resetting === d.tenantId}
                className="text-xs text-orange-400 hover:text-orange-300 disabled:opacity-50"
              >
                {resetting === d.tenantId ? 'Resetting…' : 'Reset'}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export default DemoControlCenter
