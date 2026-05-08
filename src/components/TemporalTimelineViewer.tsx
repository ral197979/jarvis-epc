// Denver Engineering — Temporal Timeline Viewer (v6.0.0)
// Time-travel query UI: replay snapshots, diff states, view velocity.

import React, { useState, useCallback } from 'react'

interface Snapshot {
  id: string
  twinId: string
  snapshotAt: string
  sequenceNum: number
  state: Record<string, unknown>
  diff?: Record<string, unknown>
  checksum: string
  triggeringEventId?: string
}

interface StateDiff {
  from: Record<string, unknown> | null
  to: Record<string, unknown> | null
  diff: Record<string, unknown>
}

interface Velocity {
  changesPerDay: number
  mostChangedFields: string[]
}

export default function TemporalTimelineViewer({ twinId }: { twinId: string }) {
  const [tab, setTab] = useState<'snapshots' | 'diff' | 'velocity'>('snapshots')
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Snapshot | null>(null)

  const [fromTs, setFromTs] = useState('')
  const [toTs, setToTs] = useState('')
  const [diff, setDiff] = useState<StateDiff | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)

  const [velocity, setVelocity] = useState<Velocity | null>(null)
  const [velocityLoading, setVelocityLoading] = useState(false)

  const loadSnapshots = useCallback(() => {
    setLoading(true)
    fetch(`/api/v1/twins/${twinId}/snapshots?limit=20`)
      .then(r => r.json())
      .then(data => setSnapshots(Array.isArray(data) ? data : []))
      .finally(() => setLoading(false))
  }, [twinId])

  const loadDiff = useCallback(() => {
    if (!fromTs || !toTs) return
    setDiffLoading(true)
    fetch(`/api/v1/scenarios/temporal/${twinId}/diff?from=${encodeURIComponent(fromTs)}&to=${encodeURIComponent(toTs)}`)
      .then(r => r.json())
      .then(setDiff)
      .finally(() => setDiffLoading(false))
  }, [twinId, fromTs, toTs])

  const loadVelocity = useCallback(() => {
    setVelocityLoading(true)
    fetch(`/api/v1/scenarios/temporal/${twinId}/velocity`)
      .then(r => r.json())
      .then(setVelocity)
      .finally(() => setVelocityLoading(false))
  }, [twinId])

  return (
    <div className="space-y-4">
      <div className="flex rounded-lg bg-zinc-800/40 p-0.5 gap-0.5">
        {(['snapshots', 'diff', 'velocity'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-colors ${
              tab === t ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'
            }`}
          >
            {t === 'snapshots' ? 'Snapshots' : t === 'diff' ? 'State Diff' : 'Velocity'}
          </button>
        ))}
      </div>

      {tab === 'snapshots' && (
        <div className="space-y-3">
          <button
            onClick={loadSnapshots}
            disabled={loading}
            className="w-full py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-sm text-white font-medium transition-colors"
          >
            {loading ? 'Loading…' : 'Load Snapshots'}
          </button>

          {snapshots.length > 0 && (
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {snapshots.map(snap => (
                <button
                  key={snap.id}
                  onClick={() => setSelected(selected?.id === snap.id ? null : snap)}
                  className={`w-full text-left rounded-lg border p-2.5 transition-colors ${
                    selected?.id === snap.id
                      ? 'border-violet-500 bg-violet-500/10'
                      : 'border-zinc-700 bg-zinc-800/60 hover:bg-zinc-700/60'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono text-zinc-300">#{snap.sequenceNum}</span>
                    <span className="text-xs text-zinc-500">
                      {new Date(snap.snapshotAt).toLocaleString()}
                    </span>
                  </div>
                  {snap.triggeringEventId && (
                    <div className="text-[10px] text-zinc-500 mt-0.5">
                      Event: {snap.triggeringEventId.slice(0, 12)}…
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}

          {selected && (
            <div className="rounded-lg border border-zinc-700 bg-zinc-800/40 p-3">
              <div className="text-xs font-medium text-zinc-300 mb-2">
                State at Snapshot #{selected.sequenceNum}
              </div>
              <pre className="text-[10px] text-zinc-400 overflow-auto max-h-32 bg-zinc-900 rounded p-2">
                {JSON.stringify(selected.state, null, 2)}
              </pre>
              {selected.diff && Object.keys(selected.diff).length > 0 && (
                <>
                  <div className="text-xs font-medium text-zinc-300 mt-2 mb-1">Diff from previous</div>
                  <pre className="text-[10px] text-amber-400 overflow-auto max-h-24 bg-zinc-900 rounded p-2">
                    {JSON.stringify(selected.diff, null, 2)}
                  </pre>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'diff' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-zinc-400 mb-1">From</label>
              <input
                type="datetime-local"
                value={fromTs}
                onChange={e => setFromTs(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">To</label>
              <input
                type="datetime-local"
                value={toTs}
                onChange={e => setToTs(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-white"
              />
            </div>
          </div>
          <button
            onClick={loadDiff}
            disabled={!fromTs || !toTs || diffLoading}
            className="w-full py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-sm text-white font-medium transition-colors"
          >
            {diffLoading ? 'Computing…' : 'Compute Diff'}
          </button>

          {diff && (
            <div className="space-y-2">
              {Object.keys(diff.diff).length === 0 ? (
                <p className="text-sm text-zinc-500 text-center py-3">No changes between these timestamps</p>
              ) : (
                <div className="rounded-lg border border-amber-600/30 bg-amber-900/10 p-3">
                  <div className="text-xs font-medium text-amber-300 mb-2">
                    {Object.keys(diff.diff).length} field(s) changed
                  </div>
                  <div className="space-y-1.5">
                    {Object.entries(diff.diff).map(([key, change]) => {
                      const c = change as { from: unknown; to: unknown }
                      return (
                        <div key={key} className="text-xs">
                          <span className="font-mono text-zinc-300">{key}:</span>
                          <span className="text-red-400 ml-2">- {JSON.stringify(c.from)}</span>
                          <span className="text-emerald-400 ml-2">+ {JSON.stringify(c.to)}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'velocity' && (
        <div className="space-y-3">
          <button
            onClick={loadVelocity}
            disabled={velocityLoading}
            className="w-full py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-sm text-white font-medium transition-colors"
          >
            {velocityLoading ? 'Computing…' : 'Compute Velocity (7d)'}
          </button>

          {velocity && (
            <div className="rounded-lg border border-zinc-700 bg-zinc-800/60 p-4 space-y-3">
              <div className="text-center">
                <div className="text-3xl font-bold text-violet-400">
                  {velocity.changesPerDay.toFixed(1)}
                </div>
                <div className="text-xs text-zinc-400 mt-1">Changes per day</div>
              </div>
              {velocity.mostChangedFields.length > 0 && (
                <div>
                  <div className="text-xs text-zinc-400 mb-1">Most changed fields</div>
                  <div className="flex flex-wrap gap-1">
                    {velocity.mostChangedFields.map(f => (
                      <span key={f} className="text-xs bg-violet-500/20 text-violet-300 px-2 py-0.5 rounded">
                        {f}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
