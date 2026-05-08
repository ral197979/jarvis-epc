// Denver Engineering — Federated Pattern Review (v9.0.0)
// Admin review of published federated patterns: confidence, k-anonymity, contributor count.

import React, { useEffect, useState } from 'react'

interface FederatedPattern {
  id: string
  patternType: string
  industrySegment: string | null
  region: string | null
  patternData: Record<string, unknown>
  confidenceScore: number
  contributorCount: number
  kAnonymityMet: boolean
  version: number
  isActive: boolean
  createdAt: string
}

export function FederatedPatternReview() {
  const [patterns, setPatterns] = useState<FederatedPattern[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'active' | 'inactive'>('all')

  useEffect(() => {
    fetch('/api/v1/ecosystem/federated/patterns')
      .then(r => r.json())
      .then(setPatterns)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const filtered = patterns.filter(p => {
    if (filter === 'active') return p.isActive
    if (filter === 'inactive') return !p.isActive
    return true
  })

  const stats = {
    total: patterns.length,
    active: patterns.filter(p => p.isActive).length,
    kMet: patterns.filter(p => p.kAnonymityMet).length,
    avgConfidence: patterns.length > 0
      ? (patterns.reduce((s, p) => s + p.confidenceScore, 0) / patterns.length).toFixed(3)
      : '—',
  }

  if (loading) return <div className="animate-pulse text-zinc-500 text-sm">Loading patterns…</div>
  if (error) return <div className="text-red-500 text-sm">{error}</div>

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Total Patterns', value: stats.total },
          { label: 'Active', value: stats.active, color: 'emerald' },
          { label: 'K-Anonymity Met', value: stats.kMet, color: 'blue' },
          { label: 'Avg Confidence', value: stats.avgConfidence },
        ].map(s => (
          <div key={s.label} className="bg-zinc-800 rounded-lg p-3 border border-zinc-700">
            <p className="text-xs text-zinc-400">{s.label}</p>
            <p className={`text-xl font-semibold mt-1 ${s.color === 'emerald' ? 'text-emerald-400' : s.color === 'blue' ? 'text-blue-400' : 'text-white'}`}>
              {s.value}
            </p>
          </div>
        ))}
      </div>

      {/* Filter */}
      <div className="flex gap-2">
        {(['all', 'active', 'inactive'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
              filter === f
                ? 'bg-blue-600 text-white'
                : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
            }`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Pattern list */}
      {filtered.length === 0 ? (
        <p className="text-center text-zinc-500 text-sm py-8">No patterns found</p>
      ) : (
        <div className="space-y-2">
          {filtered.map(p => (
            <div
              key={p.id}
              className="bg-zinc-800 rounded-lg p-4 border border-zinc-700"
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white">{p.patternType}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      p.isActive
                        ? 'bg-emerald-900/40 text-emerald-400'
                        : 'bg-zinc-700 text-zinc-400'
                    }`}>
                      {p.isActive ? 'Active' : 'Inactive'}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      p.kAnonymityMet
                        ? 'bg-blue-900/40 text-blue-400'
                        : 'bg-red-900/40 text-red-400'
                    }`}>
                      {p.kAnonymityMet ? 'K-Anon ✓' : 'K-Anon ✗'}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400 mt-1">
                    {[p.industrySegment, p.region].filter(Boolean).join(' · ') || 'Global'}
                    {' · '}v{p.version}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-zinc-400">Confidence</p>
                  <p className={`text-sm font-semibold ${
                    p.confidenceScore >= 0.8 ? 'text-emerald-400'
                      : p.confidenceScore >= 0.6 ? 'text-amber-400'
                      : 'text-red-400'
                  }`}>
                    {(p.confidenceScore * 100).toFixed(1)}%
                  </p>
                  <p className="text-xs text-zinc-500 mt-0.5">{p.contributorCount} contributors</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
