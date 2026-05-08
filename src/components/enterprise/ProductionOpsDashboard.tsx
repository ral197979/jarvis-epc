// Denver Engineering — Production Ops Dashboard (v8.0.0)
// SRE view: deployment health, check status, and tenant subscription metrics.

import React, { useEffect, useState, useCallback } from 'react'
import { DeploymentHealthReport, DeploymentHealthCheck } from '../../../api/services/enterprise/enterpriseTypes'

const STATUS_COLOR: Record<string, string> = {
  passing: 'text-emerald-400',
  warning: 'text-amber-400',
  failing: 'text-red-400',
}

const STATUS_DOT: Record<string, string> = {
  passing: 'bg-emerald-500',
  warning: 'bg-amber-500',
  failing: 'bg-red-500',
}

const OVERALL_BG: Record<string, string> = {
  healthy: 'border-emerald-700 bg-emerald-950/20',
  degraded: 'border-amber-700 bg-amber-950/20',
  unhealthy: 'border-red-700 bg-red-950/20',
}

function CheckRow({ check }: { check: DeploymentHealthCheck }) {
  return (
    <div className="flex items-center gap-3 py-2 border-b border-gray-800 last:border-0">
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT[check.status]}`} />
      <span className="text-sm text-gray-300 flex-1">{check.checkName}</span>
      {check.value != null && (
        <span className="text-xs text-gray-500">
          {check.value}{check.threshold != null ? ` / ${check.threshold}` : ''}
        </span>
      )}
      <span className={`text-xs font-medium ${STATUS_COLOR[check.status]}`}>{check.status}</span>
    </div>
  )
}

export function ProductionOpsDashboard() {
  const [report, setReport] = useState<DeploymentHealthReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)

  const load = useCallback(() => {
    fetch('/api/v1/enterprise/deployment/health')
      .then(r => r.json())
      .then((data: DeploymentHealthReport) => { setReport(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  async function runChecks() {
    setRunning(true)
    try {
      const res = await fetch('/api/v1/enterprise/deployment/health/run', { method: 'POST' })
      const data: DeploymentHealthReport = await res.json()
      setReport(data)
    } finally {
      setRunning(false)
    }
  }

  if (loading) return <div className="p-6 text-gray-400 animate-pulse">Loading deployment health…</div>
  if (!report) return null

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-white font-semibold">Production Health</h2>
        <button
          onClick={runChecks}
          disabled={running}
          className="text-xs bg-gray-700 hover:bg-gray-600 text-white px-3 py-1.5 rounded disabled:opacity-50"
        >
          {running ? 'Running…' : 'Run Checks'}
        </button>
      </div>

      {/* Overall status */}
      <div className={`border rounded-lg p-4 ${OVERALL_BG[report.overall]}`}>
        <div className="flex items-center gap-3">
          <span className={`w-3 h-3 rounded-full ${STATUS_DOT[report.overall === 'healthy' ? 'passing' : report.overall === 'degraded' ? 'warning' : 'failing']}`} />
          <span className="text-white font-medium capitalize">{report.overall}</span>
          <span className="text-gray-400 text-sm ml-auto">
            {report.passingCount} passing · {report.warningCount} warning · {report.failingCount} failing
          </span>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          Generated {new Date(report.generatedAt).toLocaleTimeString()}
        </p>
      </div>

      {/* Individual checks */}
      <div>
        {report.checks.length > 0
          ? report.checks.map(c => <CheckRow key={c.id} check={c} />)
          : <p className="text-gray-500 text-sm text-center py-4">No checks recorded yet</p>
        }
      </div>
    </div>
  )
}

export default ProductionOpsDashboard
