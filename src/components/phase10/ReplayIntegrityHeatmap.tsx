// Denver Engineering — Replay Integrity Heatmap (v10.0.0)
// Visualizes replay determinism across event streams as a heatmap.

import React, { useState, useEffect } from 'react'

interface StreamIntegrity {
  eventStreamId: string
  deterministicPasses: number
  deterministicFailures: number
  determinismRate: number
  status: 'clean' | 'degraded' | 'failing'
  lastCheckedAt: string
}

interface ReplayIntegrityAudit {
  id: string
  environment: string
  streamsAudited: number
  violationsFound: number
  status: string
  completedAt: string | null
  createdAt: string
}

interface ReplayIntegrityHeatmapProps {
  environment?: string
  onStreamClick?: (streamId: string) => void
}

function getDeterminismColor(rate: number): string {
  if (rate >= 1.0) return 'bg-green-500'
  if (rate >= 0.95) return 'bg-yellow-400'
  if (rate >= 0.8) return 'bg-orange-400'
  return 'bg-red-500'
}

export function ReplayIntegrityHeatmap({
  environment = 'production',
  onStreamClick,
}: ReplayIntegrityHeatmapProps) {
  const [streams, setStreams] = useState<StreamIntegrity[]>([])
  const [latestAudit, setLatestAudit] = useState<ReplayIntegrityAudit | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [streamsRes, auditRes] = await Promise.all([
          fetch(`/api/phase10/replay/stream-integrity?environment=${environment}`),
          fetch(`/api/phase10/replay/audits?environment=${environment}&limit=1`),
        ])
        if (streamsRes.ok) setStreams(await streamsRes.json())
        if (auditRes.ok) {
          const audits: ReplayIntegrityAudit[] = await auditRes.json()
          setLatestAudit(audits[0] ?? null)
        }
      } finally {
        setLoading(false)
      }
    }
    void fetchData()
  }, [environment])

  const cleanCount = streams.filter(s => s.status === 'clean').length
  const failingCount = streams.filter(s => s.status === 'failing').length

  return (
    <div className="replay-integrity-heatmap p-6 bg-white rounded-lg shadow">
      <div className="flex justify-between items-start mb-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Replay Integrity Heatmap</h2>
          <p className="text-sm text-gray-500">{environment} · {streams.length} streams monitored</p>
        </div>
        {latestAudit && (
          <div className="text-right text-sm">
            <div className={`font-medium ${latestAudit.violationsFound > 0 ? 'text-red-600' : 'text-green-600'}`}>
              {latestAudit.violationsFound > 0
                ? `${latestAudit.violationsFound} violation(s)`
                : 'All clean'}
            </div>
            <div className="text-xs text-gray-400">
              {latestAudit.streamsAudited} streams audited
            </div>
          </div>
        )}
      </div>

      {loading ? (
        <div className="text-gray-500 text-center py-8">Loading replay integrity data...</div>
      ) : (
        <>
          <div className="flex gap-4 mb-4 text-sm">
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded bg-green-500" />
              <span>Clean ({cleanCount})</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded bg-yellow-400" />
              <span>Degraded</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded bg-red-500" />
              <span>Failing ({failingCount})</span>
            </div>
          </div>

          <div className="grid grid-cols-8 md:grid-cols-12 gap-1 mb-6">
            {streams.map(stream => (
              <button
                key={stream.eventStreamId}
                title={`${stream.eventStreamId}: ${(stream.determinismRate * 100).toFixed(1)}% deterministic`}
                className={`w-full aspect-square rounded ${getDeterminismColor(stream.determinismRate)} hover:opacity-80 transition-opacity`}
                onClick={() => onStreamClick?.(stream.eventStreamId)}
              />
            ))}
          </div>

          {failingCount > 0 && (
            <div className="border border-red-200 rounded p-3 bg-red-50">
              <h3 className="text-sm font-semibold text-red-800 mb-2">Failing Streams</h3>
              <div className="space-y-1">
                {streams.filter(s => s.status === 'failing').map(s => (
                  <div key={s.eventStreamId} className="flex justify-between text-sm">
                    <span className="font-mono text-xs text-red-700">{s.eventStreamId}</span>
                    <span className="text-red-600">
                      {s.deterministicFailures} failure(s) / {s.deterministicPasses + s.deterministicFailures} runs
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default ReplayIntegrityHeatmap
