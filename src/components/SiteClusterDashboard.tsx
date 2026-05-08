// Denver Engineering — Site Cluster Dashboard (v6.0.0)
// Multi-site operational intelligence: cluster view of site twins.

import React, { useEffect, useState } from 'react'

interface SiteTwin {
  twinId: string
  entityId: string
  name: string
  status: string
  readinessScore?: number
  riskScore?: number
  healthScore?: number
  lastSyncedAt?: string
  syncLagMs?: number
}

interface SiteMetrics {
  totalSites: number
  activeSites: number
  avgReadiness: number
  avgRisk: number
  staleSites: number
}

const STATUS_RING: Record<string, string> = {
  active: 'ring-emerald-500',
  degraded: 'ring-amber-400',
  failed: 'ring-red-500',
  maintenance: 'ring-blue-400',
  inactive: 'ring-zinc-600',
}

const STALE_THRESHOLD_MS = 5 * 60 * 1000 // 5 minutes

function SiteCard({ site }: { site: SiteTwin }) {
  const isStale = site.lastSyncedAt
    ? Date.now() - new Date(site.lastSyncedAt).getTime() > STALE_THRESHOLD_MS
    : true

  const readiness = site.readinessScore ?? 0
  const risk = site.riskScore ?? 0

  return (
    <div className={`relative rounded-xl border border-zinc-700 bg-zinc-800/60 p-4 space-y-3 ring-2 ring-offset-2 ring-offset-zinc-900 ${STATUS_RING[site.status] ?? 'ring-zinc-600'}`}>
      {isStale && (
        <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-amber-400" title="Stale sync" />
      )}
      <div>
        <div className="text-sm font-medium text-white truncate">{site.name}</div>
        <div className="text-[10px] text-zinc-500 font-mono mt-0.5">{site.entityId.slice(0, 12)}…</div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <div className="text-zinc-500 mb-0.5">Readiness</div>
          <div className={`font-bold text-base ${readiness >= 75 ? 'text-emerald-400' : readiness >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
            {readiness.toFixed(0)}%
          </div>
        </div>
        <div>
          <div className="text-zinc-500 mb-0.5">Risk</div>
          <div className={`font-bold text-base ${risk >= 75 ? 'text-red-400' : risk >= 50 ? 'text-amber-400' : 'text-emerald-400'}`}>
            {risk.toFixed(0)}%
          </div>
        </div>
      </div>

      {/* Readiness mini bar */}
      <div className="space-y-1">
        <div className="h-1 bg-zinc-700 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full ${readiness >= 75 ? 'bg-emerald-500' : readiness >= 50 ? 'bg-amber-400' : 'bg-red-500'}`}
            style={{ width: `${readiness}%` }}
          />
        </div>
      </div>

      <div className="flex items-center justify-between text-[10px] text-zinc-600">
        <span className={`px-1.5 py-0.5 rounded ${
          site.status === 'active' ? 'bg-emerald-900/40 text-emerald-400' :
          site.status === 'degraded' ? 'bg-amber-900/40 text-amber-400' :
          'bg-zinc-700 text-zinc-400'
        }`}>{site.status}</span>
        {site.syncLagMs != null && (
          <span>{site.syncLagMs < 1000 ? `${site.syncLagMs}ms` : `${(site.syncLagMs / 1000).toFixed(1)}s`} lag</span>
        )}
      </div>
    </div>
  )
}

export default function SiteClusterDashboard() {
  const [sites, setSites] = useState<SiteTwin[]>([])
  const [metrics, setMetrics] = useState<SiteMetrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [sortBy, setSortBy] = useState<'readiness' | 'risk' | 'name'>('readiness')

  useEffect(() => {
    setLoading(true)
    fetch('/api/v1/twins?entityType=site&limit=50')
      .then(r => r.json())
      .then(data => {
        const siteList = (data.twins ?? []) as SiteTwin[]
        setSites(siteList)

        const active = siteList.filter(s => s.status === 'active').length
        const stale = siteList.filter(s =>
          s.lastSyncedAt
            ? Date.now() - new Date(s.lastSyncedAt).getTime() > STALE_THRESHOLD_MS
            : true
        ).length
        const avgReadiness = siteList.length > 0
          ? siteList.reduce((s, site) => s + (site.readinessScore ?? 0), 0) / siteList.length
          : 0
        const avgRisk = siteList.length > 0
          ? siteList.reduce((s, site) => s + (site.riskScore ?? 0), 0) / siteList.length
          : 0

        setMetrics({
          totalSites: siteList.length,
          activeSites: active,
          avgReadiness: Math.round(avgReadiness * 10) / 10,
          avgRisk: Math.round(avgRisk * 10) / 10,
          staleSites: stale,
        })
      })
      .finally(() => setLoading(false))
  }, [])

  const sorted = [...sites].sort((a, b) => {
    if (sortBy === 'readiness') return (b.readinessScore ?? 0) - (a.readinessScore ?? 0)
    if (sortBy === 'risk') return (b.riskScore ?? 0) - (a.riskScore ?? 0)
    return a.name.localeCompare(b.name)
  })

  if (loading) return (
    <div className="flex items-center justify-center h-48 text-zinc-400 text-sm">Loading sites…</div>
  )

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      {metrics && (
        <div className="grid grid-cols-5 gap-2">
          {[
            { label: 'Total Sites', value: metrics.totalSites, color: 'text-white' },
            { label: 'Active', value: metrics.activeSites, color: 'text-emerald-400' },
            { label: 'Avg Readiness', value: `${metrics.avgReadiness}%`, color: metrics.avgReadiness >= 70 ? 'text-emerald-400' : 'text-amber-400' },
            { label: 'Avg Risk', value: `${metrics.avgRisk}%`, color: metrics.avgRisk >= 60 ? 'text-red-400' : 'text-zinc-300' },
            { label: 'Stale Sync', value: metrics.staleSites, color: metrics.staleSites > 0 ? 'text-amber-400' : 'text-emerald-400' },
          ].map(s => (
            <div key={s.label} className="rounded-lg bg-zinc-800/60 border border-zinc-700 p-2 text-center">
              <div className={`text-lg font-bold ${s.color}`}>{s.value}</div>
              <div className="text-[10px] text-zinc-500 leading-tight mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Sort control */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-zinc-500">Sort by</span>
        <div className="flex rounded-lg bg-zinc-800/40 p-0.5 gap-0.5">
          {(['readiness', 'risk', 'name'] as const).map(s => (
            <button
              key={s}
              onClick={() => setSortBy(s)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium capitalize transition-colors ${
                sortBy === s ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Site grid */}
      {sorted.length === 0 ? (
        <div className="text-sm text-zinc-500 text-center py-8">
          No site twins registered. Use the Twin Registry to create site-type twins.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 max-h-96 overflow-y-auto">
          {sorted.map(site => (
            <SiteCard key={site.twinId} site={site} />
          ))}
        </div>
      )}
    </div>
  )
}
