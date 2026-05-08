// Denver Engineering — Reliability Command Center (v10.0.0)
// Real-time SLO status, uptime metrics, and health aggregation.

import React, { useState, useEffect, useCallback } from 'react'

interface SLOStatus {
  environment: string
  sloMet: boolean
  currentUptime: number
  target: number
  compositeScore: number
  p95Ms: number
  errorRate: number
}

interface UptimeMetric {
  metricType: string
  uptimePercent: number
  avgValueMs: number
  healthyChecks: number
  totalChecks: number
}

interface ReliabilityCommandCenterProps {
  environment?: string
  refreshIntervalMs?: number
  onAlertTriggered?: (metric: UptimeMetric) => void
}

export function ReliabilityCommandCenter({
  environment = 'production',
  refreshIntervalMs = 30000,
  onAlertTriggered,
}: ReliabilityCommandCenterProps) {
  const [sloStatus, setSloStatus] = useState<SLOStatus | null>(null)
  const [metrics, setMetrics] = useState<UptimeMetric[]>([])
  const [loading, setLoading] = useState(true)
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const [sloRes, metricsRes] = await Promise.all([
        fetch(`/api/phase10/reliability/slo-status?environment=${environment}`),
        fetch(`/api/phase10/uptime/summary?environment=${environment}`),
      ])
      if (sloRes.ok) setSloStatus(await sloRes.json())
      if (metricsRes.ok) {
        const data: UptimeMetric[] = await metricsRes.json()
        setMetrics(data)
        data.filter(m => m.uptimePercent < 99).forEach(m => onAlertTriggered?.(m))
      }
      setLastRefreshed(new Date())
    } finally {
      setLoading(false)
    }
  }, [environment, onAlertTriggered])

  useEffect(() => {
    void fetchData()
    const interval = setInterval(() => void fetchData(), refreshIntervalMs)
    return () => clearInterval(interval)
  }, [fetchData, refreshIntervalMs])

  const sloColor = sloStatus?.sloMet ? 'text-green-600' : 'text-red-600'

  return (
    <div className="reliability-command-center p-6 bg-white rounded-lg shadow">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Reliability Command Center</h2>
        {lastRefreshed && (
          <span className="text-sm text-gray-500">
            Last updated: {lastRefreshed.toLocaleTimeString()}
          </span>
        )}
      </div>

      {loading ? (
        <div className="text-gray-500 text-center py-8">Loading reliability data...</div>
      ) : (
        <>
          {sloStatus && (
            <div className="mb-6 p-4 bg-gray-50 rounded-lg">
              <div className="flex items-center gap-4">
                <div className={`text-4xl font-bold ${sloColor}`}>
                  {sloStatus.currentUptime.toFixed(3)}%
                </div>
                <div>
                  <div className="text-sm text-gray-600">Current Uptime</div>
                  <div className="text-xs text-gray-400">Target: {sloStatus.target.toFixed(3)}%</div>
                </div>
                <div className="ml-auto">
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                    sloStatus.sloMet ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                  }`}>
                    {sloStatus.sloMet ? 'SLO Met' : 'SLO Breached'}
                  </span>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-4 text-sm">
                <div>
                  <span className="text-gray-500">Composite Score</span>
                  <div className="font-semibold">{sloStatus.compositeScore}/100</div>
                </div>
                <div>
                  <span className="text-gray-500">P95 Latency</span>
                  <div className="font-semibold">{sloStatus.p95Ms}ms</div>
                </div>
                <div>
                  <span className="text-gray-500">Error Rate</span>
                  <div className="font-semibold">{(sloStatus.errorRate * 100).toFixed(3)}%</div>
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {metrics.map(metric => (
              <div
                key={metric.metricType}
                className={`p-4 rounded-lg border ${
                  metric.uptimePercent >= 99.9
                    ? 'border-green-200 bg-green-50'
                    : metric.uptimePercent >= 99
                    ? 'border-yellow-200 bg-yellow-50'
                    : 'border-red-200 bg-red-50'
                }`}
              >
                <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                  {metric.metricType.replace(/_/g, ' ')}
                </div>
                <div className="text-2xl font-bold text-gray-900">
                  {metric.uptimePercent.toFixed(2)}%
                </div>
                <div className="text-sm text-gray-600 mt-1">
                  Avg: {metric.avgValueMs}ms · {metric.healthyChecks}/{metric.totalChecks} healthy
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export default ReliabilityCommandCenter
