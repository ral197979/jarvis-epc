/**
 * KpiCard — shared metric display component
 * Extracted from JarvisCore `w()` (Phase 7)
 */
import React from 'react'

export interface KpiCardProps {
  label:  string
  value:  string | number
  sub?:   string
  color?: string
}

export function KpiCard({ label, value, sub, color }: KpiCardProps) {
  return (
    <div
      role="group"
      aria-label={label}
      className="jarvis-card"
      style={{ minWidth: 0, position: 'relative', overflow: 'hidden' }}
    >
      <div className="jarvis-label" style={{ marginBottom: 3 }}>{label}</div>
      <div
        aria-label={label}
        className="jarvis-kpi-value"
        style={{ color: color ?? 'inherit' }}
      >
        {value}
      </div>
      {sub && <div className="jarvis-small" style={{ marginTop: 2 }}>{sub}</div>}
    </div>
  )
}
