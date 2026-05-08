// Denver Engineering — Anomaly Radar (v6.0.0)
// Real-time anomaly detection UI with severity filtering and resolution controls.

import React, { useEffect, useState, useCallback } from 'react'

interface Anomaly {
  id: string
  twinId?: string
  anomalyType: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  anomalyScore: number
  impactedEntities: string[]
  explanation: string
  suggestedActions: string[]
  baselineValue?: number
  observedValue?: number
  detectedAt: string
  resolvedAt?: string
  falsePositive: boolean
  metadata: Record<string, unknown>
}

interface Summary {
  total: number
  bySeverity: Record<string, number>
  escalationCount: number
  topAnomalyScore: number
}

const SEVERITY_BADGE: Record<string, string> = {
  critical: 'bg-red-500 text-white',
  high: 'bg-orange-500 text-white',
  medium: 'bg-amber-400 text-zinc-900',
  low: 'bg-zinc-600 text-zinc-200',
}

const SEVERITY_BORDER: Record<string, string> = {
  critical: 'border-red-700/50',
  high: 'border-orange-700/50',
  medium: 'border-amber-700/50',
  low: 'border-zinc-700',
}

function AnomalyCard({ anomaly, onResolve, onFalsePositive }: {
  anomaly: Anomaly
  onResolve: (id: string) => void
  onFalsePositive: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [acting, setActing] = useState(false)

  const resolve = useCallback(async () => {
    setActing(true)
    await fetch(`/api/v1/portfolio/anomalies/${anomaly.id}/resolve`, { method: 'POST' })
    onResolve(anomaly.id)
    setActing(false)
  }, [anomaly.id, onResolve])

  const fp = useCallback(async () => {
    setActing(true)
    await fetch(`/api/v1/portfolio/anomalies/${anomaly.id}/false-positive`, { method: 'POST' })
    onFalsePositive(anomaly.id)
    setActing(false)
  }, [anomaly.id, onFalsePositive])

  return (
    <div className={`rounded-lg border bg-zinc-800/60 p-3 space-y-2 ${SEVERITY_BORDER[anomaly.severity]}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${SEVERITY_BADGE[anomaly.severity]}`}>
            {anomaly.severity.toUpperCase()}
          </span>
          <span className="text-sm text-white truncate">
            {anomaly.anomalyType.replace(/_/g, ' ')}
          </span>
        </div>
        <div className="flex items-center gap-1 text-xs font-mono text-zinc-400 flex-shrink-0">
          <span>score {anomaly.anomalyScore}</span>
        </div>
      </div>

      <p className="text-xs text-zinc-400 leading-relaxed">{anomaly.explanation}</p>

      {anomaly.baselineValue != null && anomaly.observedValue != null && (
        <div className="flex gap-4 text-xs">
          <span className="text-zinc-500">baseline <span className="text-zinc-300 font-mono">{anomaly.baselineValue.toFixed(1)}</span></span>
          <span className="text-zinc-500">observed <span className="text-amber-300 font-mono">{anomaly.observedValue.toFixed(1)}</span></span>
        </div>
      )}

      <button onClick={() => setExpanded(e => !e)} className="text-xs text-violet-400 hover:text-violet-300">
        {expanded ? '▲ less' : '▼ actions & details'}
      </button>

      {expanded && (
        <div className="space-y-2">
          {anomaly.suggestedActions.length > 0 && (
            <ul className="space-y-1">
              {anomaly.suggestedActions.map((a, i) => (
                <li key={i} className="text-xs text-zinc-400 flex gap-1.5">
                  <span className="text-violet-400 flex-shrink-0">›</span> {a}
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <button
              onClick={resolve}
              disabled={acting || !!anomaly.resolvedAt}
              className="flex-1 py-1 rounded bg-emerald-700/40 hover:bg-emerald-700/60 disabled:opacity-40 text-xs text-emerald-300 transition-colors"
            >
              Resolve
            </button>
            <button
              onClick={fp}
              disabled={acting || anomaly.falsePositive}
              className="flex-1 py-1 rounded bg-zinc-700/40 hover:bg-zinc-700/60 disabled:opacity-40 text-xs text-zinc-400 transition-colors"
            >
              False Positive
            </button>
          </div>
        </div>
      )}

      <div className="text-[10px] text-zinc-600">
        {new Date(anomaly.detectedAt).toLocaleString()}
        {anomaly.resolvedAt && ` • resolved ${new Date(anomaly.resolvedAt).toLocaleString()}`}
      </div>
    </div>
  )
}

export default function AnomalyRadar() {
  const [anomalies, setAnomalies] = useState<Anomaly[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [severity, setSeverity] = useState<string>('all')
  const [detecting, setDetecting] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    const params = severity !== 'all' ? `?severity=${severity}` : ''
    fetch(`/api/v1/portfolio/anomalies${params}`)
      .then(r => r.json())
      .then(data => {
        setAnomalies(data.anomalies ?? [])
        setSummary(data.summary)
      })
      .finally(() => setLoading(false))
  }, [severity])

  useEffect(() => { load() }, [load])

  const detect = useCallback(() => {
    setDetecting(true)
    fetch('/api/v1/portfolio/anomalies/detect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(() => load())
      .finally(() => setDetecting(false))
  }, [load])

  const onResolve = useCallback((id: string) => {
    setAnomalies(a => a.filter(x => x.id !== id))
  }, [])

  const onFalsePositive = useCallback((id: string) => {
    setAnomalies(a => a.map(x => x.id === id ? { ...x, falsePositive: true } : x))
  }, [])

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center gap-2">
        <div className="flex rounded-lg bg-zinc-800/40 p-0.5 gap-0.5">
          {['all', 'critical', 'high', 'medium', 'low'].map(s => (
            <button
              key={s}
              onClick={() => setSeverity(s)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium capitalize transition-colors ${
                severity === s ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <button
          onClick={detect}
          disabled={detecting}
          className="px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-xs text-white font-medium transition-colors ml-auto"
        >
          {detecting ? 'Detecting…' : '+ Detect Now'}
        </button>
      </div>

      {/* Summary */}
      {summary && (
        <div className="grid grid-cols-4 gap-2">
          {(['critical', 'high', 'medium', 'low'] as const).map(s => (
            <div key={s} className="rounded-lg bg-zinc-800/40 border border-zinc-700 p-2 text-center">
              <div className={`text-lg font-bold ${
                s === 'critical' ? 'text-red-400' :
                s === 'high' ? 'text-orange-400' :
                s === 'medium' ? 'text-amber-400' : 'text-zinc-400'
              }`}>{summary.bySeverity[s] ?? 0}</div>
              <div className="text-[10px] text-zinc-500 capitalize">{s}</div>
            </div>
          ))}
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="text-sm text-zinc-400 text-center py-6">Loading anomalies…</div>
      ) : anomalies.length === 0 ? (
        <div className="text-sm text-zinc-500 text-center py-6">No anomalies detected</div>
      ) : (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {anomalies.map(a => (
            <AnomalyCard
              key={a.id}
              anomaly={a}
              onResolve={onResolve}
              onFalsePositive={onFalsePositive}
            />
          ))}
        </div>
      )}
    </div>
  )
}
