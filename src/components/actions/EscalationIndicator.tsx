/**
 * Denver Engineering — Escalation Indicator (v4.34.0)
 * ──────────────────────────────────────────────────────
 * Ava Phase 2 — Visual indicator for escalation level.
 *
 * Props:
 *   level   — 0 (none) | 1 | 2 | 3
 *   compact — true = dots only, no label
 */
import React from 'react'

interface EscalationIndicatorProps {
  level:    number
  compact?: boolean
}

const LEVEL_CONFIG = [
  { label: 'None',         color: '#d1d5db', bg: 'transparent' },
  { label: 'L1 Escalated', color: '#f59e0b', bg: '#fffbeb' },
  { label: 'L2 Escalated', color: '#f97316', bg: '#fff7ed' },
  { label: 'L3 Critical',  color: '#dc2626', bg: '#fef2f2' },
]

export function EscalationIndicator({ level, compact = false }: EscalationIndicatorProps) {
  const clampedLevel = Math.max(0, Math.min(3, level))
  const cfg = LEVEL_CONFIG[clampedLevel]!

  if (clampedLevel === 0) {
    if (compact) return null
    return null  // no indicator for un-escalated actions
  }

  const dotStyle: React.CSSProperties = {
    display:      'inline-block',
    width:        8,
    height:       8,
    borderRadius: '50%',
    background:   cfg.color,
    marginRight:  compact ? 0 : 5,
    animation:    clampedLevel >= 3 ? 'pulse 1.5s ease-in-out infinite' : undefined,
  }

  if (compact) {
    return (
      <span title={cfg.label} style={{ display: 'inline-flex', gap: 3 }}>
        {Array.from({ length: clampedLevel }).map((_, i) => (
          <span key={i} style={dotStyle} />
        ))}
      </span>
    )
  }

  return (
    <span style={{
      display:      'inline-flex',
      alignItems:   'center',
      padding:      '2px 8px',
      borderRadius: 4,
      fontSize:     11,
      fontWeight:   600,
      background:   cfg.bg,
      color:        cfg.color,
      border:       `1px solid ${cfg.color}44`,
    }}>
      <span style={dotStyle} />
      {cfg.label}
    </span>
  )
}
