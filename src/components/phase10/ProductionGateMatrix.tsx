// Denver Engineering — Production Gate Matrix (v10.0.0)
// Full matrix of all production gate checks with status, categories, and drill-down.

import React, { useState, useEffect } from 'react'

interface GateCheck {
  id: string
  category: string
  checkName: string
  status: 'pass' | 'fail' | 'warn' | 'skip'
  message: string
  durationMs: number
  metadata: Record<string, unknown>
}

interface GateRun {
  id: string
  environment: string
  totalChecks: number
  passed: number
  failed: number
  warned: number
  skipped: number
  overallStatus: 'pass' | 'fail' | 'warn' | 'skip'
  startedAt: string
  completedAt: string | null
}

interface ProductionGateMatrixProps {
  environment?: string
  onRunGates?: () => void
}

const STATUS_ICON: Record<string, string> = {
  pass: '✅',
  fail: '❌',
  warn: '⚠️',
  skip: '⏭️',
}

const STATUS_ROW: Record<string, string> = {
  pass: 'bg-green-50 border-green-200',
  fail: 'bg-red-50 border-red-200',
  warn: 'bg-yellow-50 border-yellow-200',
  skip: 'bg-gray-50 border-gray-200',
}

export function ProductionGateMatrix({ environment = 'production', onRunGates }: ProductionGateMatrixProps) {
  const [run, setRun] = useState<GateRun | null>(null)
  const [checks, setChecks] = useState<GateCheck[]>([])
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState<string>('all')

  useEffect(() => {
    const fetchLatest = async () => {
      try {
        const res = await fetch(`/api/phase10/gates/runs?environment=${environment}&limit=1`)
        if (res.ok) {
          const runs: GateRun[] = await res.json()
          if (runs[0]) {
            setRun(runs[0])
            const checksRes = await fetch(`/api/phase10/gates/runs/${runs[0].id}/checks`)
            if (checksRes.ok) setChecks(await checksRes.json())
          }
        }
      } finally {
        setLoading(false)
      }
    }
    void fetchLatest()
  }, [environment])

  const runGates = async () => {
    setRunning(true)
    try {
      const res = await fetch('/api/phase10/gates/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ environment }),
      })
      if (res.ok) {
        const { runId } = await res.json() as { runId: string }
        const [runRes, checksRes] = await Promise.all([
          fetch(`/api/phase10/gates/runs/${runId}`),
          fetch(`/api/phase10/gates/runs/${runId}/checks`),
        ])
        if (runRes.ok) setRun(await runRes.json())
        if (checksRes.ok) setChecks(await checksRes.json())
        onRunGates?.()
      }
    } finally {
      setRunning(false)
    }
  }

  const categories = ['all', ...new Set(checks.map(c => c.category))]
  const filtered = categoryFilter === 'all' ? checks : checks.filter(c => c.category === categoryFilter)
  const passRate = run && run.totalChecks > 0
    ? Math.round((run.passed / run.totalChecks) * 100)
    : null

  return (
    <div className="production-gate-matrix p-6 bg-white rounded-lg shadow">
      <div className="flex justify-between items-start mb-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Production Gate Matrix</h2>
          {run && (
            <div className="text-sm text-gray-500 mt-0.5">
              {run.totalChecks} checks · {passRate}% pass rate ·{' '}
              <span className={run.overallStatus === 'pass' ? 'text-green-600' : 'text-red-600'}>
                {STATUS_ICON[run.overallStatus]} {run.overallStatus.toUpperCase()}
              </span>
            </div>
          )}
        </div>
        <button
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          disabled={running}
          onClick={() => void runGates()}
        >
          {running ? 'Running gates...' : 'Run All Gates'}
        </button>
      </div>

      {run && (
        <div className="grid grid-cols-4 gap-3 mb-4">
          {(['passed', 'failed', 'warned', 'skipped'] as const).map(key => {
            const colors = {
              passed: 'text-green-700 bg-green-50',
              failed: 'text-red-700 bg-red-50',
              warned: 'text-yellow-700 bg-yellow-50',
              skipped: 'text-gray-600 bg-gray-50',
            }
            return (
              <div key={key} className={`p-3 rounded-lg text-center ${colors[key]}`}>
                <div className="text-2xl font-bold">{run[key]}</div>
                <div className="text-xs capitalize">{key}</div>
              </div>
            )
          })}
        </div>
      )}

      <div className="flex gap-2 mb-3 flex-wrap">
        {categories.map(cat => (
          <button
            key={cat}
            className={`px-3 py-1 text-xs rounded-full border ${
              categoryFilter === cat ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
            onClick={() => setCategoryFilter(cat)}
          >
            {cat}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-8 text-gray-400">Loading gates...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-8 text-gray-400">No gate runs yet. Click "Run All Gates".</div>
      ) : (
        <div className="space-y-1.5">
          {filtered.map(check => (
            <div key={check.id} className={`flex items-center gap-3 p-3 border rounded-lg ${STATUS_ROW[check.status]}`}>
              <span>{STATUS_ICON[check.status]}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400 font-mono">{check.category}</span>
                  <span className="font-medium text-sm text-gray-800">{check.checkName}</span>
                </div>
                <div className="text-xs text-gray-600 truncate">{check.message}</div>
              </div>
              <div className="text-xs text-gray-400 whitespace-nowrap">{check.durationMs}ms</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default ProductionGateMatrix
