// Denver Engineering — SLA Compliance Panel (v10.0.0)
// Displays SLO violations, error budget, and compliance history.

import React, { useState, useEffect } from 'react'

interface SLOViolation {
  id: string
  violationType: string
  description: string
  durationMs: number
  impactedTenants: number
  rootCause: string | null
  occurredAt: string
  resolvedAt: string | null
}

interface ComplianceSummary {
  period: string
  sloMet: boolean
  uptimePercent: number
  errorBudgetRemaining: number
  violationCount: number
}

interface SLACompliancePanelProps {
  environment?: string
  periodDays?: number
}

export function SLACompliancePanel({
  environment = 'production',
  periodDays = 30,
}: SLACompliancePanelProps) {
  const [violations, setViolations] = useState<SLOViolation[]>([])
  const [summary, setSummary] = useState<ComplianceSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [resolving, setResolving] = useState<string | null>(null)

  useEffect(() => {
    const fetchCompliance = async () => {
      try {
        const [violationsRes, summaryRes] = await Promise.all([
          fetch(`/api/phase10/reliability/violations?environment=${environment}&limit=50`),
          fetch(`/api/phase10/reliability/compliance-summary?environment=${environment}&days=${periodDays}`),
        ])
        if (violationsRes.ok) setViolations(await violationsRes.json())
        if (summaryRes.ok) setSummary(await summaryRes.json())
      } finally {
        setLoading(false)
      }
    }
    void fetchCompliance()
  }, [environment, periodDays])

  const handleResolve = async (violationId: string, rootCause: string) => {
    setResolving(violationId)
    try {
      await fetch(`/api/phase10/reliability/violations/${violationId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rootCause }),
      })
      setViolations(prev => prev.map(v =>
        v.id === violationId ? { ...v, resolvedAt: new Date().toISOString(), rootCause } : v
      ))
    } finally {
      setResolving(null)
    }
  }

  const unresolvedViolations = violations.filter(v => !v.resolvedAt)
  const budgetColor = (summary?.errorBudgetRemaining ?? 100) > 20
    ? 'text-green-600' : 'text-red-600'

  return (
    <div className="sla-compliance-panel p-6 bg-white rounded-lg shadow">
      <h2 className="text-xl font-bold text-gray-900 mb-4">SLA Compliance — {environment}</h2>

      {loading ? (
        <div className="text-gray-500 text-center py-6">Loading compliance data...</div>
      ) : (
        <>
          {summary && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div className="p-3 bg-gray-50 rounded">
                <div className="text-xs text-gray-500">Uptime ({periodDays}d)</div>
                <div className="text-xl font-bold">{summary.uptimePercent.toFixed(3)}%</div>
              </div>
              <div className="p-3 bg-gray-50 rounded">
                <div className="text-xs text-gray-500">Error Budget Left</div>
                <div className={`text-xl font-bold ${budgetColor}`}>
                  {summary.errorBudgetRemaining.toFixed(4)}%
                </div>
              </div>
              <div className="p-3 bg-gray-50 rounded">
                <div className="text-xs text-gray-500">Violations</div>
                <div className="text-xl font-bold">{summary.violationCount}</div>
              </div>
              <div className="p-3 bg-gray-50 rounded">
                <div className="text-xs text-gray-500">SLO Status</div>
                <div className={`text-xl font-bold ${summary.sloMet ? 'text-green-600' : 'text-red-600'}`}>
                  {summary.sloMet ? '✓ Met' : '✗ Breached'}
                </div>
              </div>
            </div>
          )}

          {unresolvedViolations.length > 0 && (
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-red-700 mb-2">
                Active Violations ({unresolvedViolations.length})
              </h3>
              <div className="space-y-2">
                {unresolvedViolations.map(v => (
                  <ViolationRow
                    key={v.id}
                    violation={v}
                    resolving={resolving === v.id}
                    onResolve={handleResolve}
                  />
                ))}
              </div>
            </div>
          )}

          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Recent History</h3>
            <div className="space-y-1">
              {violations.filter(v => v.resolvedAt).slice(0, 10).map(v => (
                <div key={v.id} className="flex justify-between text-sm p-2 bg-gray-50 rounded">
                  <span className="text-gray-700">{v.violationType}</span>
                  <span className="text-green-600 text-xs">Resolved</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function ViolationRow({
  violation,
  resolving,
  onResolve,
}: {
  violation: SLOViolation
  resolving: boolean
  onResolve: (id: string, rootCause: string) => void
}) {
  const [rootCause, setRootCause] = useState('')
  return (
    <div className="p-3 border border-red-200 rounded bg-red-50">
      <div className="flex justify-between">
        <div>
          <div className="font-medium text-red-800">{violation.violationType}</div>
          <div className="text-sm text-red-600">{violation.description}</div>
          <div className="text-xs text-gray-500 mt-1">
            {violation.impactedTenants} tenants · {Math.round(violation.durationMs / 60000)}m duration
          </div>
        </div>
      </div>
      <div className="mt-2 flex gap-2">
        <input
          className="flex-1 text-sm border rounded px-2 py-1"
          placeholder="Root cause..."
          value={rootCause}
          onChange={e => setRootCause(e.target.value)}
        />
        <button
          className="text-sm px-3 py-1 bg-red-600 text-white rounded disabled:opacity-50"
          disabled={resolving || !rootCause}
          onClick={() => onResolve(violation.id, rootCause)}
        >
          {resolving ? 'Resolving...' : 'Resolve'}
        </button>
      </div>
    </div>
  )
}

export default SLACompliancePanel
