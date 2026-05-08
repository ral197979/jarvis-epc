// Denver Engineering — Marketplace Governance Panel (Phase 9)
// Admin review queue for playbooks: approve, reject, and stats.

import React, { useState, useEffect } from 'react'

interface Playbook {
  id: string
  name: string
  type: string
  industryTags: string[]
  author: string
  status: 'review' | 'published' | 'deprecated' | 'rejected'
  versionImmutable?: boolean
}

interface PlaybookStats {
  totalPublished: number
  totalPendingReview: number
  totalDeprecated: number
}

type LocalStatus = 'review' | 'approved' | 'rejected'

export function MarketplaceGovernancePanel() {
  const [reviewPlaybooks, setReviewPlaybooks] = useState<Playbook[]>([])
  const [stats, setStats] = useState<PlaybookStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [localStatus, setLocalStatus] = useState<Record<string, LocalStatus>>({})
  const [actioning, setActioning] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  function load() {
    setLoading(true)
    setError(null)
    Promise.all([
      fetch('/api/v1/ecosystem/marketplace/playbooks?status=review').then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<Playbook[]>
      }),
      Promise.all([
        fetch('/api/v1/ecosystem/marketplace/playbooks?status=published').then(r => r.ok ? r.json() as Promise<Playbook[]> : Promise.resolve([])),
        fetch('/api/v1/ecosystem/marketplace/playbooks?status=deprecated').then(r => r.ok ? r.json() as Promise<Playbook[]> : Promise.resolve([])),
      ]).then(([published, deprecated]) => ({
        totalPublished: (published as Playbook[]).length,
        totalPendingReview: 0,
        totalDeprecated: (deprecated as Playbook[]).length,
      })),
    ])
      .then(([review, s]) => {
        setReviewPlaybooks(review)
        setStats({ ...s, totalPendingReview: review.length })
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  function handleApprove(playbook: Playbook) {
    setActioning(playbook.id)
    setActionError(null)
    fetch(`/api/v1/ecosystem/marketplace/playbooks/${playbook.id}/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sandboxValidated: true }),
    })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(() => {
        setLocalStatus(prev => ({ ...prev, [playbook.id]: 'approved' }))
        setStats(prev => prev != null
          ? { ...prev, totalPublished: prev.totalPublished + 1, totalPendingReview: Math.max(0, prev.totalPendingReview - 1) }
          : prev
        )
      })
      .catch(e => setActionError(e.message))
      .finally(() => setActioning(null))
  }

  function handleReject(playbookId: string) {
    setLocalStatus(prev => ({ ...prev, [playbookId]: 'rejected' }))
    setStats(prev => prev != null
      ? { ...prev, totalPendingReview: Math.max(0, prev.totalPendingReview - 1) }
      : prev
    )
  }

  if (loading) {
    return (
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 space-y-3 animate-pulse">
        <div className="h-5 bg-zinc-700 rounded w-56" />
        <div className="grid grid-cols-3 gap-3">
          {[1, 2, 3].map(i => <div key={i} className="h-16 bg-zinc-800 rounded" />)}
        </div>
        {[1, 2, 3].map(i => <div key={i} className="h-20 bg-zinc-800 rounded" />)}
      </div>
    )
  }

  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">Marketplace Governance</h2>
          <p className="text-xs text-zinc-500 mt-0.5">Phase 9 — Playbook Review Queue</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="text-xs text-zinc-400 hover:text-zinc-200 border border-zinc-600 rounded px-3 py-1 disabled:opacity-50"
        >
          Refresh
        </button>
      </div>

      {error != null && (
        <p className="text-red-400 text-sm border border-red-800 rounded p-3">{error}</p>
      )}

      {actionError != null && (
        <p className="text-red-400 text-sm border border-red-800 rounded p-3">{actionError}</p>
      )}

      {/* Stats */}
      {stats != null && (
        <div className="grid grid-cols-3 gap-3">
          <div className="border border-emerald-800 rounded-lg p-3 bg-emerald-900/10 text-center">
            <p className="text-2xl font-bold text-emerald-400">{stats.totalPublished}</p>
            <p className="text-xs text-zinc-400 mt-0.5">Published</p>
          </div>
          <div className="border border-amber-800 rounded-lg p-3 bg-amber-900/10 text-center">
            <p className="text-2xl font-bold text-amber-400">{stats.totalPendingReview}</p>
            <p className="text-xs text-zinc-400 mt-0.5">Pending Review</p>
          </div>
          <div className="border border-zinc-700 rounded-lg p-3 bg-zinc-800/40 text-center">
            <p className="text-2xl font-bold text-zinc-400">{stats.totalDeprecated}</p>
            <p className="text-xs text-zinc-400 mt-0.5">Deprecated</p>
          </div>
        </div>
      )}

      {/* Review queue */}
      <div>
        <h3 className="text-sm font-semibold text-zinc-300 mb-3">
          Pending Review ({reviewPlaybooks.length})
        </h3>

        {reviewPlaybooks.length === 0 ? (
          <p className="text-zinc-500 text-sm">No playbooks awaiting review.</p>
        ) : (
          <div className="space-y-3">
            {reviewPlaybooks.map(pb => {
              const status = localStatus[pb.id]

              return (
                <div
                  key={pb.id}
                  className={`border rounded-lg p-4 space-y-3 transition-colors ${
                    status === 'approved'
                      ? 'border-emerald-700 bg-emerald-900/10'
                      : status === 'rejected'
                        ? 'border-zinc-700 bg-zinc-800/20 opacity-60'
                        : 'border-zinc-700 bg-zinc-800/30'
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-zinc-100">{pb.name}</p>
                        <span className="text-xs text-zinc-500 border border-zinc-700 rounded px-1.5 py-0.5">
                          {pb.type}
                        </span>
                        {pb.versionImmutable === true && (
                          <span className="text-xs bg-sky-900/40 border border-sky-800 text-sky-400 rounded px-1.5 py-0.5">
                            Version Immutable
                          </span>
                        )}
                        {status === 'approved' && (
                          <span className="text-xs bg-emerald-700 text-emerald-100 rounded-full px-2 py-0.5 font-medium">
                            Approved
                          </span>
                        )}
                        {status === 'rejected' && (
                          <span className="text-xs bg-red-900 text-red-300 rounded-full px-2 py-0.5 font-medium border border-red-800">
                            Rejected
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-zinc-500">by {pb.author}</p>
                      {pb.industryTags.length > 0 && (
                        <div className="flex flex-wrap gap-1 pt-1">
                          {pb.industryTags.map(tag => (
                            <span
                              key={tag}
                              className="text-xs bg-zinc-800 border border-zinc-700 text-zinc-400 rounded px-1.5 py-0.5"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {status == null && (
                      <div className="flex gap-2 shrink-0">
                        <button
                          onClick={() => handleApprove(pb)}
                          disabled={actioning === pb.id}
                          className="text-xs border border-emerald-700 text-emerald-400 hover:border-emerald-500 hover:text-emerald-200 rounded px-3 py-1.5 disabled:opacity-40 transition-colors"
                        >
                          {actioning === pb.id ? 'Approving...' : 'Approve'}
                        </button>
                        <button
                          onClick={() => handleReject(pb.id)}
                          disabled={actioning === pb.id}
                          className="text-xs border border-zinc-600 text-zinc-400 hover:border-red-700 hover:text-red-400 rounded px-3 py-1.5 disabled:opacity-40 transition-colors"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
