// Denver Engineering — Enterprise Admin Console (v8.0.0)
// Admin view: subscription list, feature flag management, tenant lifecycle controls.

import React, { useEffect, useState } from 'react'
import { TenantSubscription } from '../../../api/services/enterprise/enterpriseTypes'

const TIER_COLOR: Record<string, string> = {
  starter: 'bg-gray-600 text-gray-200',
  professional: 'bg-blue-700 text-blue-100',
  enterprise: 'bg-purple-700 text-purple-100',
  custom: 'bg-amber-700 text-amber-100',
}

const LIFECYCLE_COLOR: Record<string, string> = {
  trial: 'text-blue-400',
  onboarding: 'text-cyan-400',
  active: 'text-emerald-400',
  suspended: 'text-amber-400',
  cancelled: 'text-red-400',
  archived: 'text-gray-500',
}

function TierBadge({ tier }: { tier: string }) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded font-medium ${TIER_COLOR[tier] ?? 'bg-gray-700 text-gray-300'}`}>
      {tier}
    </span>
  )
}

export function EnterpriseAdminConsole() {
  const [subs, setSubs] = useState<TenantSubscription[]>([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState('')
  const [filterTier, setFilterTier] = useState('')

  function load() {
    const params = new URLSearchParams()
    if (filterStatus) params.set('lifecycleStatus', filterStatus)
    if (filterTier) params.set('tier', filterTier)
    fetch(`/api/v1/enterprise/subscriptions?${params}`)
      .then(r => r.json())
      .then((data: TenantSubscription[]) => { setSubs(data); setLoading(false) })
      .catch(() => setLoading(false))
  }

  useEffect(() => { load() }, [filterStatus, filterTier]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleTransition(tenantId: string, toStatus: string) {
    await fetch(`/api/v1/enterprise/tenants/${tenantId}/lifecycle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toStatus, actor: 'admin_console', reason: `Transition to ${toStatus}` }),
    })
    load()
  }

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-white font-semibold">Enterprise Admin</h2>
        <div className="flex gap-2">
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            className="bg-gray-800 border border-gray-600 text-sm text-gray-300 rounded px-2 py-1 focus:outline-none"
          >
            <option value="">All Statuses</option>
            {['trial', 'onboarding', 'active', 'suspended', 'cancelled', 'archived'].map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select
            value={filterTier}
            onChange={e => setFilterTier(e.target.value)}
            className="bg-gray-800 border border-gray-600 text-sm text-gray-300 rounded px-2 py-1 focus:outline-none"
          >
            <option value="">All Tiers</option>
            {['starter', 'professional', 'enterprise', 'custom'].map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>

      {loading
        ? <p className="text-gray-400 animate-pulse">Loading subscriptions…</p>
        : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400 border-b border-gray-700">
                  <th className="pb-2 pr-4">Tenant ID</th>
                  <th className="pb-2 pr-4">Tier</th>
                  <th className="pb-2 pr-4">Status</th>
                  <th className="pb-2 pr-4">Seats</th>
                  <th className="pb-2 pr-4">API Quota</th>
                  <th className="pb-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {subs.map(s => (
                  <tr key={s.id} className="border-b border-gray-800 hover:bg-gray-800/50">
                    <td className="py-2 pr-4 font-mono text-xs text-gray-400">{s.tenantId.slice(0, 12)}…</td>
                    <td className="py-2 pr-4"><TierBadge tier={s.tier} /></td>
                    <td className={`py-2 pr-4 ${LIFECYCLE_COLOR[s.lifecycleStatus]}`}>{s.lifecycleStatus}</td>
                    <td className="py-2 pr-4 text-gray-300">{s.seatCount}/{s.seatLimit}</td>
                    <td className="py-2 pr-4 text-gray-300">{s.apiQuotaMonthly.toLocaleString()}</td>
                    <td className="py-2">
                      <div className="flex gap-2">
                        {s.lifecycleStatus === 'suspended' && (
                          <button
                            onClick={() => handleTransition(s.tenantId, 'active')}
                            className="text-xs text-emerald-400 hover:text-emerald-300"
                          >Reactivate</button>
                        )}
                        {s.lifecycleStatus === 'active' && (
                          <button
                            onClick={() => handleTransition(s.tenantId, 'suspended')}
                            className="text-xs text-amber-400 hover:text-amber-300"
                          >Suspend</button>
                        )}
                        {!['archived', 'cancelled'].includes(s.lifecycleStatus) && (
                          <button
                            onClick={() => handleTransition(s.tenantId, 'archived')}
                            className="text-xs text-red-400 hover:text-red-300"
                          >Archive</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {subs.length === 0 && (
                  <tr><td colSpan={6} className="py-4 text-center text-gray-500">No subscriptions found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )
      }
    </div>
  )
}

export default EnterpriseAdminConsole
