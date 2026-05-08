// Denver Engineering — Tenant Diagnostics Panel (v10.0.0)
// On-demand diagnostics for a specific tenant: config, replay health, billing, audit.

import React, { useState } from 'react'

interface DiagnosticCheck {
  id: string
  checkName: string
  severity: 'info' | 'warning' | 'critical'
  passed: boolean
  detail: string
  remediation: string | null
  checkedAt: string
}

interface DiagnosticReport {
  id: string
  tenantId: string
  status: 'pending' | 'healthy' | 'degraded' | 'critical'
  checkCount: number
  criticalCount: number
  warningCount: number
  completedAt: string | null
}

interface TenantDiagnosticsPanelProps {
  tenantId: string
  tenantName?: string
}

export function TenantDiagnosticsPanel({ tenantId, tenantName }: TenantDiagnosticsPanelProps) {
  const [report, setReport] = useState<DiagnosticReport | null>(null)
  const [checks, setChecks] = useState<DiagnosticCheck[]>([])
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const runDiagnostics = async () => {
    setRunning(true)
    setError(null)
    try {
      const createRes = await fetch('/api/phase10/support/diagnostics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          reportedBy: 'support-panel',
          issueDescription: 'Manual diagnostic run',
        }),
      })
      if (!createRes.ok) throw new Error('Failed to create diagnostic report')
      const { reportId } = await createRes.json() as { reportId: string }

      const runRes = await fetch(`/api/phase10/support/diagnostics/${reportId}/run`, {
        method: 'POST',
      })
      if (!runRes.ok) throw new Error('Failed to run diagnostics')

      const [reportRes, checksRes] = await Promise.all([
        fetch(`/api/phase10/support/diagnostics/${reportId}`),
        fetch(`/api/phase10/support/diagnostics/${reportId}/checks`),
      ])
      if (reportRes.ok) setReport(await reportRes.json())
      if (checksRes.ok) setChecks(await checksRes.json())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Diagnostic run failed')
    } finally {
      setRunning(false)
    }
  }

  const statusColor: Record<string, string> = {
    healthy: 'text-green-600',
    degraded: 'text-yellow-600',
    critical: 'text-red-600',
    pending: 'text-gray-500',
  }

  const severityColor: Record<string, string> = {
    critical: 'border-red-200 bg-red-50',
    warning: 'border-yellow-200 bg-yellow-50',
    info: 'border-gray-200 bg-gray-50',
  }

  return (
    <div className="tenant-diagnostics-panel p-6 bg-white rounded-lg shadow">
      <div className="flex justify-between items-start mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Tenant Diagnostics</h2>
          <p className="text-sm text-gray-500">{tenantName ?? tenantId}</p>
        </div>
        <button
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
          disabled={running}
          onClick={() => void runDiagnostics()}
        >
          {running ? 'Running...' : 'Run Diagnostics'}
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {error}
        </div>
      )}

      {report && (
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-3">
            <span className={`text-lg font-bold ${statusColor[report.status]}`}>
              {report.status.toUpperCase()}
            </span>
            <span className="text-sm text-gray-500">
              {report.checkCount} checks · {report.criticalCount} critical · {report.warningCount} warnings
            </span>
          </div>
        </div>
      )}

      {checks.length > 0 && (
        <div className="space-y-2">
          {checks.map(check => (
            <div
              key={check.id}
              className={`p-3 border rounded-lg ${severityColor[check.severity]}`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className={check.passed ? 'text-green-500' : 'text-red-500'}>
                      {check.passed ? '✓' : '✗'}
                    </span>
                    <span className="font-medium text-sm text-gray-800">{check.checkName}</span>
                    <span className="text-xs text-gray-500">[{check.severity}]</span>
                  </div>
                  <p className="text-sm text-gray-600 mt-1 ml-5">{check.detail}</p>
                  {!check.passed && check.remediation && (
                    <p className="text-xs text-blue-700 mt-1 ml-5">→ {check.remediation}</p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {!report && !running && (
        <div className="text-center py-10 text-gray-400">
          <div className="text-4xl mb-2">🔍</div>
          <p>Click "Run Diagnostics" to analyze this tenant's health.</p>
        </div>
      )}
    </div>
  )
}

export default TenantDiagnosticsPanel
