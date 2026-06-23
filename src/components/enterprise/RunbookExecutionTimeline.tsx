/**
 * Denver Engineering — Runbook Execution Timeline (v4.40.0)
 * ────────────────────────────────────────────────────────────
 * Ava Phase 4 — Visualizes runbook step execution progress,
 * approval checkpoints, and step results in a vertical timeline.
 */
import React, { useEffect, useState } from 'react'

interface RunbookStep {
  id:               string
  step_index:       number
  step_type:        string
  status:           string
  requires_approval: boolean
  approved_by?:     string
  approved_at?:     string
}

interface StepResult {
  outcome:     string
  output:      Record<string, unknown>
  error?:      string
  duration_ms: number
  executed_at: string
}

interface ExecutionDetail {
  id:            string
  status:        string
  mode:          string
  triggered_by:  string
  current_step:  number
  total_steps:   number
  result_summary?: { stepsCompleted: number; errors: string[] }
  started_at?:   string
  completed_at?: string
  steps:         (RunbookStep & { result?: StepResult })[]
}

interface RunbookExecutionTimelineProps {
  executionId: string
  onStepApprove?: (executionId: string, stepIndex: number) => void
}

const STATUS_COLORS: Record<string, string> = {
  completed:       '#10b981',
  running:         '#2563eb',
  failed:          '#dc2626',
  skipped:         '#9ca3af',
  waiting_approval:'#f97316',
  pending:         '#d1d5db',
  rolled_back:     '#7c3aed',
  dry_run:         '#6b7280',
}

const STEP_ICONS: Record<string, string> = {
  create_action:      '➕',
  assign_action:      '👤',
  escalate_action:    '⬆',
  freeze_workflow:    '❄',
  request_approval:   '✋',
  notify_users:       '🔔',
  generate_report:    '📄',
  trigger_integration:'🔗',
  create_deficiency:  '⚠',
  create_inspection:  '🔍',
  update_readiness:   '📊',
}

function StepBubble({ step }: { step: RunbookStep & { result?: StepResult } }) {
  const [expanded, setExpanded] = useState(false)
  const color = STATUS_COLORS[step.status] ?? '#9ca3af'

  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 16 }}>
      {/* Connector */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{
          width: 28, height: 28, borderRadius: '50%', background: color,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 12, flexShrink: 0,
        }}>
          {STEP_ICONS[step.step_type] ?? '•'}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, background: '#f9fafb', borderRadius: 8, padding: '8px 12px',
        border: `1px solid ${color}30` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#111827', textTransform: 'capitalize' }}>
            {step.step_type.replace(/_/g, ' ')}
          </div>
          <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 10,
            background: `${color}18`, color, fontWeight: 600 }}>
            {step.status.replace(/_/g, ' ')}
          </span>
        </div>

        {step.requires_approval && (
          <div style={{ fontSize: 10, color: '#f97316', marginTop: 3 }}>
            {step.approved_at ? `✓ Approved ${new Date(step.approved_at).toLocaleDateString()}` : '⏳ Awaiting approval'}
          </div>
        )}

        {step.result && (
          <>
            <button onClick={() => setExpanded(!expanded)}
              style={{ fontSize: 10, color: '#6b7280', background: 'none', border: 'none',
                cursor: 'pointer', padding: '4px 0 0 0' }}>
              {expanded ? '▲' : '▼'} {step.result.outcome} · {step.result.duration_ms}ms
            </button>
            {expanded && (
              <div style={{ marginTop: 6, background: '#fff', borderRadius: 6, padding: 8,
                fontSize: 11, fontFamily: 'monospace', color: '#374151', wordBreak: 'break-all' }}>
                {step.result.error
                  ? <span style={{ color: '#dc2626' }}>{step.result.error}</span>
                  : JSON.stringify(step.result.output, null, 2)}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export function RunbookExecutionTimeline({ executionId, onStepApprove: _onStepApprove }: RunbookExecutionTimelineProps) {
  const [exec, setExec] = useState<ExecutionDetail | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    // Load execution + steps (combined endpoint)
    Promise.all([
      fetch(`/api/v1/runbooks/executions/${executionId}`).then(r => r.json()),
      fetch(`/api/v1/runbooks/executions/${executionId}/steps`).then(r => r.json()),
    ]).then(([execJ, stepsJ]) => {
      setExec({ ...execJ.data, steps: stepsJ.data ?? [] })
    }).catch(() => setExec(null))
      .finally(() => setLoading(false))
  }, [executionId])

  if (loading) return <div style={{ padding: 16, color: '#9ca3af', fontSize: 13 }}>Loading execution…</div>
  if (!exec)   return <div style={{ padding: 16, color: '#dc2626', fontSize: 13 }}>Execution not found</div>

  const statusColor = STATUS_COLORS[exec.status] ?? '#9ca3af'
  const pct = exec.total_steps > 0 ? Math.round((exec.current_step / exec.total_steps) * 100) : 0

  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '10px 14px', borderBottom: '1px solid #e5e7eb', background: '#f9fafb' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>
              Execution Timeline
            </div>
            <div style={{ fontSize: 10, color: '#9ca3af', fontFamily: 'monospace' }}>
              {executionId.slice(0, 8)}… · {exec.mode}
            </div>
          </div>
          <span style={{ fontSize: 11, padding: '2px 10px', borderRadius: 12,
            background: `${statusColor}18`, color: statusColor, fontWeight: 600 }}>
            {exec.status.replace(/_/g, ' ')}
          </span>
        </div>
        {/* Progress bar */}
        <div style={{ height: 4, background: '#e5e7eb', borderRadius: 2 }}>
          <div style={{ height: 4, width: `${pct}%`, background: statusColor, borderRadius: 2, transition: 'width 0.4s' }} />
        </div>
        <div style={{ fontSize: 10, color: '#6b7280', marginTop: 3 }}>
          {exec.current_step} / {exec.total_steps} steps
        </div>
      </div>

      {/* Steps */}
      <div style={{ padding: '16px 14px', maxHeight: 480, overflowY: 'auto' }}>
        {exec.steps.length === 0 ? (
          <div style={{ color: '#9ca3af', fontSize: 13, textAlign: 'center' }}>No step records yet.</div>
        ) : exec.steps.map(step => (
          <StepBubble key={step.id} step={step} />
        ))}
      </div>

      {/* Result summary */}
      {exec.result_summary && exec.result_summary.errors.length > 0 && (
        <div style={{ padding: '8px 14px', borderTop: '1px solid #e5e7eb', background: '#fef2f2' }}>
          {exec.result_summary.errors.map((e, i) => (
            <div key={i} style={{ fontSize: 11, color: '#dc2626' }}>⚠ {e}</div>
          ))}
        </div>
      )}
    </div>
  )
}
