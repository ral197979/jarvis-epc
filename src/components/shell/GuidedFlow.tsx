/**
 * Denver Engineering — Guided Flow stepper (v4.36.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * Workflow Redesign W5 (see WORKFLOW_REDESIGN.md §5). A slim stepper shown on the
 * hubs that belong to a workflow: sequences the real screens, highlights where you
 * are, and one-clicks to any step (the next one is emphasised).
 */
import React from 'react'
import type { Flow } from '../../config/workflows'

interface Props { flow: Flow; activeTab: string; onNavigate?: (tab: string) => void }

export default function GuidedFlow({ flow, activeTab, onNavigate }: Props) {
  const currentIdx = flow.steps.findIndex(s => s.tab === activeTab)

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap',
      padding: '6px 16px', borderBottom: '1px solid var(--jarvis-bd)', background: 'var(--jarvis-bg)',
    }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--jarvis-td)', textTransform: 'uppercase', letterSpacing: '0.06em', marginRight: 6 }}>
        {flow.label}
      </span>
      {flow.steps.map((step, i) => {
        const isCurrent = i === currentIdx
        const isDone = currentIdx >= 0 && i < currentIdx
        const isNext = i === currentIdx + 1
        const color = isCurrent ? 'var(--jarvis-ac)' : isDone ? '#22c55e' : 'var(--jarvis-ts)'
        return (
          <React.Fragment key={step.tab}>
            {i > 0 && <span style={{ color: 'var(--jarvis-td)', fontSize: 11 }}>›</span>}
            <button
              onClick={() => onNavigate?.(step.tab)}
              aria-current={isCurrent ? 'step' : undefined}
              style={{
                display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer',
                padding: '3px 9px', borderRadius: 99, fontSize: 11.5,
                border: `1px solid ${isCurrent ? 'var(--jarvis-ac)' : isNext ? 'var(--jarvis-bd)' : 'transparent'}`,
                background: isCurrent ? 'rgba(245,158,11,0.12)' : 'transparent',
                color, fontWeight: isCurrent ? 700 : 500,
              }}
            >
              <span style={{
                width: 14, height: 14, borderRadius: 7, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 9, fontWeight: 700, flexShrink: 0,
                border: `1.5px solid ${color}`, color, background: isDone ? '#22c55e' : 'transparent',
              }}>
                {isDone ? <span style={{ color: '#0a0b0f' }}>✓</span> : i + 1}
              </span>
              {step.label}
            </button>
          </React.Fragment>
        )
      })}
    </div>
  )
}
