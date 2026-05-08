// Denver Engineering — AgentTaskTimeline (v5.0.0)
// Visual timeline of agent task execution steps.

import React from 'react'

interface TaskStep {
  id: string
  stepIndex: number
  stepType: string
  description: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
  startedAt?: string
  completedAt?: string
  error?: string
}

interface AgentTask {
  id: string
  agentType: string
  taskType: string
  status: string
  steps: TaskStep[]
  createdAt: string
  startedAt?: string
  completedAt?: string
}

interface Props {
  task: AgentTask
}

const STEP_COLORS: Record<string, { bg: string; border: string; dot: string }> = {
  completed: { bg: '#f0fdf4', border: '#86efac', dot: '#22c55e' },
  running:   { bg: '#eff6ff', border: '#93c5fd', dot: '#3b82f6' },
  failed:    { bg: '#fef2f2', border: '#fca5a5', dot: '#ef4444' },
  skipped:   { bg: '#f9fafb', border: '#e5e7eb', dot: '#d1d5db' },
  pending:   { bg: '#fafafa', border: '#e5e7eb', dot: '#9ca3af' },
}

function StepCard({ step, isLast }: { step: TaskStep; isLast: boolean }) {
  const colors = STEP_COLORS[step.status] ?? STEP_COLORS.pending

  return (
    <div style={{ display: 'flex', gap: '12px' }}>
      {/* Timeline column */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '24px', flexShrink: 0 }}>
        <div style={{
          width: '14px', height: '14px', borderRadius: '50%',
          background: colors.dot, flexShrink: 0, marginTop: '14px',
        }} />
        {!isLast && (
          <div style={{
            width: '2px', flex: 1, background: '#e2e8f0', minHeight: '16px',
          }} />
        )}
      </div>

      {/* Card */}
      <div style={{
        flex: 1, marginBottom: isLast ? 0 : '8px',
        border: `1px solid ${colors.border}`,
        background: colors.bg, borderRadius: '8px', padding: '12px 16px',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
          <span style={{ fontWeight: 600, fontSize: '14px' }}>
            Step {step.stepIndex + 1}: {step.stepType.replace(/_/g, ' ')}
          </span>
          <span style={{ fontSize: '12px', color: colors.dot, fontWeight: 500, textTransform: 'capitalize' }}>
            {step.status}
          </span>
        </div>
        <div style={{ color: '#6b7280', fontSize: '13px' }}>{step.description}</div>

        {step.error && (
          <div style={{ marginTop: '8px', color: '#ef4444', fontSize: '12px', fontFamily: 'monospace' }}>
            {step.error}
          </div>
        )}

        <div style={{ marginTop: '8px', display: 'flex', gap: '16px' }}>
          {step.startedAt && (
            <span style={{ fontSize: '11px', color: '#9ca3af' }}>
              Started: {new Date(step.startedAt).toLocaleTimeString()}
            </span>
          )}
          {step.completedAt && (
            <span style={{ fontSize: '11px', color: '#9ca3af' }}>
              Completed: {new Date(step.completedAt).toLocaleTimeString()}
            </span>
          )}
          {step.startedAt && step.completedAt && (
            <span style={{ fontSize: '11px', color: '#9ca3af' }}>
              Duration: {new Date(step.completedAt).getTime() - new Date(step.startedAt).getTime()}ms
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

export function AgentTaskTimeline({ task }: Props) {
  const totalDuration = task.startedAt && task.completedAt
    ? new Date(task.completedAt).getTime() - new Date(task.startedAt).getTime()
    : null

  const statusColor: Record<string, string> = {
    completed: '#22c55e', failed: '#ef4444', running: '#3b82f6',
    queued: '#9ca3af', pending_approval: '#f59e0b',
  }

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif' }}>
      {/* Header */}
      <div style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>
              {task.agentType}
            </h3>
            <div style={{ color: '#6b7280', fontSize: '13px', marginTop: '2px' }}>
              {task.taskType.replace(/_/g, ' ')} · {task.id.slice(0, 8)}…
            </div>
          </div>
          <span style={{
            padding: '4px 12px', borderRadius: '16px', fontSize: '13px', fontWeight: 600,
            background: `${statusColor[task.status] ?? '#9ca3af'}20`,
            color: statusColor[task.status] ?? '#9ca3af',
          }}>
            {task.status.replace(/_/g, ' ')}
          </span>
        </div>

        {totalDuration != null && (
          <div style={{ marginTop: '8px', color: '#6b7280', fontSize: '13px' }}>
            Total duration: {totalDuration}ms
          </div>
        )}
      </div>

      {/* Steps */}
      {task.steps.length === 0 ? (
        <div style={{ color: '#9ca3af', fontSize: '14px', textAlign: 'center', padding: '24px' }}>
          No steps recorded
        </div>
      ) : (
        <div>
          {task.steps.map((step, idx) => (
            <StepCard key={step.id} step={step} isLast={idx === task.steps.length - 1} />
          ))}
        </div>
      )}
    </div>
  )
}
