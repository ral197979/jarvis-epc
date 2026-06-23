// Denver Engineering — Workflow Version History (Phase 9)
// Lists workflow versions with rollback capability.

import React, { useState, useEffect } from 'react'

interface WorkflowVersion {
  version: number
  createdAt: string
  createdBy: string
  changeSummary: string
  isCurrent: boolean
}

interface Props {
  workflowId: string
  tenantId: string
}

export function WorkflowVersionHistory({ workflowId, tenantId: _tenantId }: Props) {
  const [versions, setVersions] = useState<WorkflowVersion[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rollingBack, setRollingBack] = useState<number | null>(null)
  const [rollbackError, setRollbackError] = useState<string | null>(null)
  const [rollbackSuccess, setRollbackSuccess] = useState<number | null>(null)

  function load() {
    setLoading(true)
    setError(null)
    fetch(`/api/v1/ecosystem/workflows/${workflowId}/versions`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((data: WorkflowVersion[]) => setVersions(data))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [workflowId])

  function handleRollback(targetVersion: number) {
    setRollingBack(targetVersion)
    setRollbackError(null)
    setRollbackSuccess(null)
    fetch(`/api/v1/ecosystem/workflows/${workflowId}/rollback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetVersion }),
    })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(() => {
        setRollbackSuccess(targetVersion)
        load()
      })
      .catch(e => setRollbackError(e.message))
      .finally(() => setRollingBack(null))
  }

  if (loading) {
    return (
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 space-y-3 animate-pulse">
        <div className="h-5 bg-zinc-700 rounded w-48" />
        {[1, 2, 3].map(i => (
          <div key={i} className="h-16 bg-zinc-800 rounded" />
        ))}
      </div>
    )
  }

  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">Version History</h2>
          <p className="text-xs text-zinc-500 mt-0.5">Workflow ID: {workflowId}</p>
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

      {rollbackError != null && (
        <p className="text-red-400 text-sm border border-red-800 rounded p-3">{rollbackError}</p>
      )}

      {rollbackSuccess != null && (
        <p className="text-emerald-400 text-sm border border-emerald-800 rounded p-3">
          Rolled back to version {rollbackSuccess} successfully.
        </p>
      )}

      {versions.length === 0 && error == null ? (
        <p className="text-zinc-500 text-sm">No versions found.</p>
      ) : (
        <div className="space-y-2">
          {versions.map(v => (
            <div
              key={v.version}
              className={`border rounded-lg p-4 flex items-start justify-between gap-4 ${
                v.isCurrent
                  ? 'border-emerald-700 bg-emerald-900/10'
                  : 'border-zinc-700 bg-zinc-800/40'
              }`}
            >
              <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-zinc-100">
                    v{v.version}
                  </span>
                  {v.isCurrent && (
                    <span className="text-xs font-medium bg-emerald-700 text-emerald-100 rounded-full px-2 py-0.5">
                      Current
                    </span>
                  )}
                  <span className="text-xs text-zinc-500">by {v.createdBy}</span>
                </div>
                <p className="text-xs text-zinc-400">
                  {new Date(v.createdAt).toLocaleString()}
                </p>
                {v.changeSummary !== '' && (
                  <p className="text-sm text-zinc-300 mt-1">{v.changeSummary}</p>
                )}
              </div>

              {!v.isCurrent && (
                <button
                  onClick={() => handleRollback(v.version)}
                  disabled={rollingBack !== null}
                  className="shrink-0 text-xs border border-amber-700 text-amber-400 hover:border-amber-500 hover:text-amber-200 rounded px-3 py-1.5 disabled:opacity-40 transition-colors"
                >
                  {rollingBack === v.version ? 'Rolling back...' : 'Rollback to this version'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
