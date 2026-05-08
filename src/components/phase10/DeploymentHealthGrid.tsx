// Denver Engineering — Deployment Health Grid (v10.0.0)
// Visualizes deployment audit history, rollback safety, and migration status.

import React, { useState, useEffect } from 'react'

interface DeploymentAudit {
  id: string
  deploymentId: string
  environment: string
  version: string
  previousVersion: string | null
  status: 'pending' | 'running' | 'passed' | 'failed' | 'rolled_back'
  migrationsApplied: number
  migrationsRolledBack: number
  servicesHealthy: number
  servicesDegraded: number
  rollbackAvailable: boolean
  auditedAt: string
  completedAt: string | null
}

interface DeploymentHealthGridProps {
  environment?: string
  limit?: number
  onRollbackRequest?: (audit: DeploymentAudit) => void
}

const STATUS_STYLES: Record<string, string> = {
  passed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  running: 'bg-blue-100 text-blue-800',
  pending: 'bg-gray-100 text-gray-600',
  rolled_back: 'bg-yellow-100 text-yellow-800',
}

export function DeploymentHealthGrid({
  environment = 'production',
  limit = 20,
  onRollbackRequest,
}: DeploymentHealthGridProps) {
  const [audits, setAudits] = useState<DeploymentAudit[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchAudits = async () => {
      try {
        const res = await fetch(
          `/api/phase10/deployments?environment=${environment}&limit=${limit}`
        )
        if (res.ok) setAudits(await res.json())
      } finally {
        setLoading(false)
      }
    }
    void fetchAudits()
  }, [environment, limit])

  const healthScore = (audit: DeploymentAudit) => {
    const total = audit.servicesHealthy + audit.servicesDegraded
    if (total === 0) return 100
    return Math.round((audit.servicesHealthy / total) * 100)
  }

  return (
    <div className="deployment-health-grid p-6 bg-white rounded-lg shadow">
      <h2 className="text-xl font-bold text-gray-900 mb-4">Deployment Health Grid</h2>

      {loading ? (
        <div className="text-gray-500 text-center py-8">Loading deployments...</div>
      ) : audits.length === 0 ? (
        <div className="text-gray-400 text-center py-8">No deployment audits found.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-gray-500">
                <th className="pb-2 font-medium">Version</th>
                <th className="pb-2 font-medium">Status</th>
                <th className="pb-2 font-medium">Health</th>
                <th className="pb-2 font-medium">Migrations</th>
                <th className="pb-2 font-medium">Rollback</th>
                <th className="pb-2 font-medium">Time</th>
                <th className="pb-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {audits.map(audit => (
                <tr key={audit.id} className="border-b hover:bg-gray-50">
                  <td className="py-2 font-mono text-xs">
                    {audit.version}
                    {audit.previousVersion && (
                      <div className="text-gray-400">← {audit.previousVersion}</div>
                    )}
                  </td>
                  <td className="py-2">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLES[audit.status] ?? ''}`}>
                      {audit.status}
                    </span>
                  </td>
                  <td className="py-2">
                    <div className="flex items-center gap-2">
                      <div className="w-16 bg-gray-200 rounded-full h-1.5">
                        <div
                          className={`h-1.5 rounded-full ${healthScore(audit) >= 80 ? 'bg-green-500' : 'bg-red-500'}`}
                          style={{ width: `${healthScore(audit)}%` }}
                        />
                      </div>
                      <span>{healthScore(audit)}%</span>
                    </div>
                  </td>
                  <td className="py-2 text-gray-600">
                    {audit.migrationsApplied} applied
                    {audit.migrationsRolledBack > 0 && (
                      <span className="text-red-500 ml-1">/ {audit.migrationsRolledBack} rolled back</span>
                    )}
                  </td>
                  <td className="py-2">
                    {audit.rollbackAvailable ? (
                      <span className="text-green-600">✓ Available</span>
                    ) : (
                      <span className="text-gray-400">–</span>
                    )}
                  </td>
                  <td className="py-2 text-gray-500 text-xs">
                    {new Date(audit.auditedAt).toLocaleString()}
                  </td>
                  <td className="py-2">
                    {audit.rollbackAvailable && audit.status === 'passed' && onRollbackRequest && (
                      <button
                        className="text-xs text-orange-600 hover:underline"
                        onClick={() => onRollbackRequest(audit)}
                      >
                        Rollback
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default DeploymentHealthGrid
