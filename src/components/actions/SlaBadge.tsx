/**
 * Denver Engineering — SLA Countdown Badge (v4.34.0)
 * ─────────────────────────────────────────────────────
 * Ava Phase 2 — Displays SLA time remaining or overdue status.
 *
 * Props:
 *   remainingMinutes — from inbox computed field; null = no SLA
 *   slaStatus        — 'active' | 'paused' | 'breached' | 'met'
 *   size             — 'sm' | 'md' (default 'sm')
 */
import React from 'react'

interface SlaBadgeProps {
  remainingMinutes: number | null
  slaStatus?:       'active' | 'paused' | 'breached' | 'met' | null
  size?:            'sm' | 'md'
}

function _formatRemaining(mins: number): string {
  if (mins <= 0) {
    const hrs = Math.floor(Math.abs(mins) / 60)
    return hrs >= 1 ? `${hrs}h overdue` : `${Math.abs(Math.round(mins))}m overdue`
  }
  const hrs = Math.floor(mins / 60)
  const m   = Math.round(mins % 60)
  if (hrs >= 24) return `${Math.floor(hrs / 24)}d ${hrs % 24}h`
  if (hrs >= 1)  return `${hrs}h ${m}m`
  return `${m}m`
}

export function SlaBadge({ remainingMinutes, slaStatus, size = 'sm' }: SlaBadgeProps) {
  if (remainingMinutes == null && !slaStatus) return null

  const isOverdue  = (remainingMinutes != null && remainingMinutes <= 0) || slaStatus === 'breached'
  const isPaused   = slaStatus === 'paused'
  const isMet      = slaStatus === 'met'
  const isWarning  = !isOverdue && !isPaused && !isMet
    && remainingMinutes != null && remainingMinutes <= 120   // within 2h

  const baseStyle: React.CSSProperties = {
    display:       'inline-flex',
    alignItems:    'center',
    gap:           4,
    borderRadius:  4,
    fontWeight:    600,
    whiteSpace:    'nowrap',
    padding:       size === 'md' ? '3px 8px' : '2px 6px',
    fontSize:      size === 'md' ? 12 : 11,
  }

  let style: React.CSSProperties
  let label: string
  let icon: string

  if (isPaused) {
    style = { ...baseStyle, background: '#f3f4f6', color: '#6b7280', border: '1px solid #d1d5db' }
    label = 'SLA Paused'
    icon  = '⏸'
  } else if (isMet) {
    style = { ...baseStyle, background: '#ecfdf5', color: '#059669', border: '1px solid #a7f3d0' }
    label = 'SLA Met'
    icon  = '✓'
  } else if (isOverdue) {
    style = { ...baseStyle, background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }
    label = remainingMinutes != null ? _formatRemaining(remainingMinutes) : 'Breached'
    icon  = '⚠'
  } else if (isWarning) {
    style = { ...baseStyle, background: '#fffbeb', color: '#d97706', border: '1px solid #fde68a' }
    label = remainingMinutes != null ? _formatRemaining(remainingMinutes) : ''
    icon  = '⏰'
  } else {
    style = { ...baseStyle, background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0' }
    label = remainingMinutes != null ? _formatRemaining(remainingMinutes) : ''
    icon  = '⏱'
  }

  return (
    <span style={style} title={`SLA: ${label}`}>
      <span>{icon}</span>
      <span>{label}</span>
    </span>
  )
}
