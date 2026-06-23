// Denver Engineering — Launch Readiness Dashboard (v10.0.0)
// Aggregated view of all readiness dimensions for go/no-go decision.

import React, { useState, useEffect } from 'react'

interface ReadinessDimension {
  dimension: string
  level: 'ready' | 'degraded' | 'not_ready' | 'unknown'
  score: number
  details: string
  blockers: string[]
  warnings: string[]
}

interface ReadinessScan {
  id: string
  environment: string
  overallScore: number
  overallLevel: 'ready' | 'degraded' | 'not_ready' | 'unknown'
  readyCount: number
  degradedCount: number
  notReadyCount: number
  completedAt: string | null
}

interface LaunchReadinessDashboardProps {
  environment?: string
  onLaunchApproved?: () => void
  onLaunchBlocked?: (blockers: string[]) => void
}

const LEVEL_CONFIG = {
  ready: { color: 'text-green-600', bg: 'bg-green-100', label: 'Ready', icon: '✓' },
  degraded: { color: 'text-yellow-600', bg: 'bg-yellow-100', label: 'Degraded', icon: '⚠' },
  not_ready: { color: 'text-red-600', bg: 'bg-red-100', label: 'Not Ready', icon: '✗' },
  unknown: { color: 'text-gray-500', bg: 'bg-gray-100', label: 'Unknown', icon: '?' },
}

export function LaunchReadinessDashboard({
  environment = 'production',
  onLaunchApproved,
  onLaunchBlocked,
}: LaunchReadinessDashboardProps) {
  const [scan, setScan] = useState<ReadinessScan | null>(null)
  const [dimensions, setDimensions] = useState<ReadinessDimension[]>([])
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)

  const fetchLatest = async () => {
    try {
      const res = await fetch(`/api/phase10/readiness/scans?environment=${environment}&limit=1`)
      if (res.ok) {
        const scans: ReadinessScan[] = await res.json()
        if (scans[0]) {
          setScan(scans[0])
          const dimRes = await fetch(`/api/phase10/readiness/scans/${scans[0].id}/results`)
          if (dimRes.ok) setDimensions(await dimRes.json())
        }
      }
    } finally {
      setLoading(false)
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void fetchLatest() }, [environment])

  const runNewScan = async () => {
    setScanning(true)
    try {
      const res = await fetch('/api/phase10/readiness/run-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ environment }),
      })
      if (res.ok) {
        const { scanId } = await res.json() as { scanId: string }
        const scanRes = await fetch(`/api/phase10/readiness/scans/${scanId}`)
        const dimRes = await fetch(`/api/phase10/readiness/scans/${scanId}/results`)
        if (scanRes.ok) setScan(await scanRes.json())
        if (dimRes.ok) {
          const dims: ReadinessDimension[] = await dimRes.json()
          setDimensions(dims)
          const allBlockers = dims.flatMap(d => d.blockers)
          if (allBlockers.length > 0) onLaunchBlocked?.(allBlockers)
          else onLaunchApproved?.()
        }
      }
    } finally {
      setScanning(false)
    }
  }

  const canLaunch = scan?.overallLevel === 'ready' && scan?.notReadyCount === 0

  return (
    <div className="launch-readiness-dashboard p-6 bg-white rounded-lg shadow">
      <div className="flex justify-between items-start mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Launch Readiness</h2>
          <p className="text-sm text-gray-500">{environment}</p>
        </div>
        <button
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium text-sm"
          disabled={scanning}
          onClick={() => void runNewScan()}
        >
          {scanning ? 'Scanning...' : 'Run Scan'}
        </button>
      </div>

      {loading ? (
        <div className="text-center py-8 text-gray-400">Loading readiness data...</div>
      ) : !scan ? (
        <div className="text-center py-8 text-gray-400">
          <p>No scan completed yet. Click "Run Scan" to assess launch readiness.</p>
        </div>
      ) : (
        <>
          <div className="mb-6 p-5 rounded-xl border-2 border-gray-200">
            <div className="flex items-center gap-4">
              <div className={`text-5xl font-black ${LEVEL_CONFIG[scan.overallLevel].color}`}>
                {scan.overallScore}
              </div>
              <div>
                <div className="text-sm text-gray-500">Overall Score</div>
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${LEVEL_CONFIG[scan.overallLevel].bg} ${LEVEL_CONFIG[scan.overallLevel].color}`}>
                  {LEVEL_CONFIG[scan.overallLevel].icon} {LEVEL_CONFIG[scan.overallLevel].label}
                </span>
              </div>
              <div className="ml-auto grid grid-cols-3 gap-4 text-center text-sm">
                <div>
                  <div className="text-2xl font-bold text-green-600">{scan.readyCount}</div>
                  <div className="text-gray-500">Ready</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-yellow-600">{scan.degradedCount}</div>
                  <div className="text-gray-500">Degraded</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-red-600">{scan.notReadyCount}</div>
                  <div className="text-gray-500">Not Ready</div>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
            {dimensions.map(dim => {
              const cfg = LEVEL_CONFIG[dim.level]
              return (
                <div key={dim.dimension} className={`p-3 rounded-lg border ${cfg.bg}`}>
                  <div className="flex justify-between items-center">
                    <span className="font-medium text-sm capitalize">
                      {dim.dimension.replace(/_/g, ' ')}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold">{dim.score}</span>
                      <span className={`text-xs font-medium ${cfg.color}`}>{cfg.icon}</span>
                    </div>
                  </div>
                  <p className="text-xs text-gray-600 mt-1">{dim.details}</p>
                  {dim.blockers.length > 0 && (
                    <div className="mt-1 text-xs text-red-600">
                      {dim.blockers.map(b => <div key={b}>⛔ {b}</div>)}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <div className={`p-4 rounded-lg text-center ${canLaunch ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
            <div className={`text-lg font-bold ${canLaunch ? 'text-green-700' : 'text-red-700'}`}>
              {canLaunch ? '✅ READY TO LAUNCH' : '🚫 NOT READY — Resolve blockers first'}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default LaunchReadinessDashboard
