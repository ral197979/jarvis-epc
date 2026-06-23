/**
 * Semantic status → presentation maps.
 *
 * These encode the "inviolable" status colours from the design language so every
 * module renders project health, priority, risk and commissioning lifecycle the
 * same way. `chip` = Tailwind classes for a low-opacity badge; `dot` = solid dot.
 */

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'purple'

export const toneChip: Record<Tone, string> = {
  success: 'bg-success-container text-success',
  warning: 'bg-warning-container text-warning',
  danger: 'bg-error-container text-on-error-container',
  info: 'bg-blue-100 text-blue-700',
  neutral: 'bg-surface-container-high text-on-surface-variant',
  purple: 'bg-indigo-100 text-indigo-700',
}

export const toneDot: Record<Tone, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
  neutral: 'bg-status-gray',
  purple: 'bg-indigo-500',
}

export const toneText: Record<Tone, string> = {
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  info: 'text-info',
  neutral: 'text-on-surface-variant',
  purple: 'text-indigo-600',
}

/** Generic health/status label → tone. Covers the labels used across modules. */
export function statusTone(status: string): Tone {
  const s = status.toLowerCase()
  if (/(healthy|complete|completed|on track|on target|approved|operational|optimized|closed|awarded|passed|no incidents|ahead)/.test(s)) return 'success'
  if (/(at risk|delayed|pending|attention|behind|warning|expediting|retest|medium|in fab)/.test(s)) return 'warning'
  if (/(critical|overrun|blocked|blocking|failed|open|over budget|high|breach|delay)/.test(s)) return 'danger'
  if (/(in progress|in-progress|testing|active|tendering|energize|loop|review)/.test(s)) return 'info'
  if (/(negotiation|qualification|cat a|blocker)/.test(s)) return 'purple'
  return 'neutral'
}

/** Project / risk priority → tone. */
export function priorityTone(priority: string): Tone {
  const p = priority.toLowerCase()
  if (p === 'critical' || p === 'p0' || p === 'urgent') return 'danger'
  if (p === 'high' || p === 'p1') return 'warning'
  if (p === 'medium' || p === 'p2') return 'info'
  return 'neutral'
}

/** Commissioning lifecycle stages, in execution order. */
export const COMMISSIONING_STAGES = [
  'DESIGN',
  'PROCURE',
  'INSTALL',
  'ENERGIZE',
  'PFC',
  'START-UP',
  'FPT',
  'IST',
  'TURNOVER',
] as const
export type CommissioningStage = (typeof COMMISSIONING_STAGES)[number]

export type CellStatus = 'complete' | 'in-progress' | 'delayed' | 'critical' | 'not-started'

export const cellStatusMeta: Record<CellStatus, { label: string; chip: string; dot: string }> = {
  complete: { label: 'Complete', chip: 'bg-success-container text-success', dot: 'bg-success' },
  'in-progress': { label: 'In Progress', chip: 'bg-blue-100 text-blue-700', dot: 'bg-info' },
  delayed: { label: 'Delayed', chip: 'bg-warning-container text-warning', dot: 'bg-warning' },
  critical: { label: 'Critical', chip: 'bg-error-container text-on-error-container', dot: 'bg-danger' },
  'not-started': { label: 'Not Started', chip: 'border border-outline-variant text-on-surface-variant', dot: 'bg-status-gray' },
}
