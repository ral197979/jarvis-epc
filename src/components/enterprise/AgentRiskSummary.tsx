// Denver Engineering — AgentRiskSummary (v5.0.0)
// Risk overview card powered by the RiskAgent.

import React, { useEffect, useState } from 'react'

interface RiskTask {
  taskId: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  result?: {
    riskScore: number
    level: 'low' | 'medium' | 'high' | 'critical'
    mitigations: string[]
  }
}

interface Props {
  tenantId: string
  /**
   * The principal recorded as having requested the analysis. Required because
   * running an analysis is a mutation (POST /agents/risk/analyze,
   * `crossdomain.write`) and the route records `created_by` from this value.
   */
  userId: string
  scopeType?: string
  scopeId?: string
  autoLoad?: boolean
}

const LEVEL_CONFIG = {
  critical: { color: '#ef4444', bg: '#fef2f2', label: 'Critical', icon: '🔴' },
  high:     { color: '#f97316', bg: '#fff7ed', label: 'High',     icon: '🟠' },
  medium:   { color: '#f59e0b', bg: '#fffbeb', label: 'Medium',   icon: '🟡' },
  low:      { color: '#22c55e', bg: '#f0fdf4', label: 'Low',      icon: '🟢' },
}

function GaugeMeter({ score }: { score: number }) {
  const color = score >= 70 ? '#ef4444' : score >= 40 ? '#f59e0b' : '#22c55e'
  const circumference = 2 * Math.PI * 40
  const offset = circumference - (score / 100) * circumference

  return (
    <div style={{ textAlign: 'center', position: 'relative', display: 'inline-block' }}>
      <svg width="100" height="100" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="40" fill="none" stroke="#e5e7eb" strokeWidth="10" />
        <circle
          cx="50" cy="50" r="40" fill="none"
          stroke={color} strokeWidth="10"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 50 50)"
          style={{ transition: 'stroke-dashoffset 0.5s ease' }}
        />
      </svg>
      <div style={{
        position: 'absolute', top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        fontSize: '22px', fontWeight: 700, color,
      }}>
        {score}
      </div>
    </div>
  )
}

// ADR-014 Phase 2C-5 §19–§22. Loading this card used to CREATE durable agent
// work: `GET /agents/risk/overview` enqueued an analysis task, so simply
// rendering the card wrote to the queue under a read capability. Reading and
// running are now separate actions against separate routes:
//
//   load  → GET  /agents/risk/overview   (crossdomain.read)  observes the latest
//   run   → POST /agents/risk/analyze    (crossdomain.write) creates the task
//
// A caller holding only read authority can still see the newest analysis; it can
// no longer cause one.
export function AgentRiskSummary({ tenantId, userId, scopeType = 'global', scopeId = '', autoLoad = false }: Props) {
  const [task, setTask] = useState<RiskTask | null>(null)
  const [loading, setLoading] = useState(false)
  const [polling, setPolling] = useState(false)

  useEffect(() => {
    // Read-only on mount. This deliberately no longer starts an analysis.
    if (autoLoad) void loadLatest()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, scopeId])

  useEffect(() => {
    if (!polling || !task) return
    if (task.status === 'completed' || task.status === 'failed') { setPolling(false); return }

    const timer = setTimeout(() => void pollTask(), 2000)
    return () => clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polling, task])

  /** Read the newest analysis for this scope. Creates nothing. */
  async function loadLatest() {
    setLoading(true)
    try {
      const res = await fetch(`/api/v1/agents/risk/overview?tenantId=${tenantId}&scopeType=${scopeType}&scopeId=${scopeId}`)
      const data = await res.json() as {
        task: { taskId: string; status: string; result?: RiskTask['result'] } | null
      }
      if (!data.task) { setTask(null); return }
      setTask({
        taskId: data.task.taskId,
        status: data.task.status as RiskTask['status'],
        result: data.task.result,
      })
      // Keep watching only while the observed task is still in flight.
      if (data.task.status === 'queued' || data.task.status === 'running') setPolling(true)
    } finally {
      setLoading(false)
    }
  }

  /** Start a new analysis. This is the mutation — it needs crossdomain.write. */
  async function runAnalysis() {
    setLoading(true)
    try {
      const res = await fetch(`/api/v1/agents/risk/analyze?tenantId=${tenantId}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ scopeType, scopeId, requestedBy: userId }),
      })
      if (!res.ok) return
      const data = await res.json() as { taskId: string; status: string }
      setTask({ taskId: data.taskId, status: 'queued' })
      setPolling(true)
    } finally {
      setLoading(false)
    }
  }

  async function pollTask() {
    if (!task) return
    const res = await fetch(`/api/v1/agents/tasks/${task.taskId}?tenantId=${tenantId}`)
    const data = await res.json() as { status: string; result?: Record<string, unknown> }
    setTask(prev => prev ? {
      ...prev,
      status: data.status as RiskTask['status'],
      result: data.result as RiskTask['result'],
    } : null)
  }

  const result = task?.result
  const levelConfig = result ? LEVEL_CONFIG[result.level] : null

  return (
    <div style={{
      fontFamily: 'system-ui, sans-serif',
      border: `1px solid ${levelConfig?.color ?? '#e2e8f0'}`,
      background: levelConfig?.bg ?? '#f8fafc',
      borderRadius: '12px', padding: '20px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>Risk Assessment</h3>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => void loadLatest()}
            disabled={loading || polling}
            style={{
              padding: '6px 14px', border: '1px solid #d1d5db', background: '#fff',
              borderRadius: '6px', cursor: 'pointer', fontSize: '13px',
            }}
          >
            ↺ Refresh
          </button>
          <button
            onClick={() => void runAnalysis()}
            disabled={loading || polling}
            style={{
              padding: '6px 14px', border: '1px solid #d1d5db', background: '#fff',
              borderRadius: '6px', cursor: 'pointer', fontSize: '13px',
            }}
          >
            {loading || polling ? '⟳ Analyzing…' : '▶ Run analysis'}
          </button>
        </div>
      </div>

      {!task && !loading && (
        <div style={{ textAlign: 'center', padding: '24px', color: '#9ca3af' }}>
          No risk analysis has been run for this scope yet — choose Run analysis
        </div>
      )}

      {(loading || (polling && task?.status !== 'completed')) && (
        <div style={{ textAlign: 'center', padding: '24px', color: '#6b7280' }}>
          <div style={{ fontSize: '24px', marginBottom: '8px' }}>⟳</div>
          Running risk analysis…
        </div>
      )}

      {result && (
        <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
          <GaugeMeter score={result.riskScore} />
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <span style={{ fontSize: '20px' }}>{levelConfig!.icon}</span>
              <span style={{ fontSize: '18px', fontWeight: 700, color: levelConfig!.color }}>
                {levelConfig!.label} Risk
              </span>
            </div>
            <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '12px' }}>
              Score: {result.riskScore}/100
            </div>

            {result.mitigations.length > 0 && (
              <div>
                <div style={{ fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>
                  RECOMMENDED MITIGATIONS
                </div>
                <ul style={{ margin: 0, paddingLeft: '16px' }}>
                  {result.mitigations.map((m, i) => (
                    <li key={i} style={{ fontSize: '13px', color: '#374151', marginBottom: '4px' }}>{m}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
