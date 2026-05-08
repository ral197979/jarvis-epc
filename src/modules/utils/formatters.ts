/**
 * Denver Engineering — Formatters
 * ───────────────────────
 * Pure formatting and calculation utilities.
 * No dependencies, no side effects. Fully unit-testable.
 */

// ─── Currency Formatter ───────────────────────────────────────────────────────
/** Format a number as USD with no decimal places: 1_234_567 → "$1,234,567" */
export function formatCurrency(value: number | string | undefined): string {
  const n = Number(value) || 0
  return n.toLocaleString('en', {
    style:                'currency',
    currency:             'USD',
    maximumFractionDigits: 0,
  })
}

// ─── Compact Currency ────────────────────────────────────────────────────────
/** Human-readable compact: 1_500_000 → "$1.5M", 45_000 → "$45k" */
export function formatCompact(value: number | string | undefined): string {
  const n = Number(value) || 0
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(0)}k`
  return `$${n.toFixed(0)}`
}

// ─── Percent Formatter ───────────────────────────────────────────────────────
/** Convert a ratio to percentage string: 0.876 → "87.6%" */
export function formatPercent(value: number | string | undefined): string {
  return `${((Number(value) || 0) * 100).toFixed(1)}%`
}

// ─── Safe Division ───────────────────────────────────────────────────────────
/** Returns numerator/denominator, or 0 if denominator is falsy */
export function safeDiv(numerator: number, denominator: number): number {
  return denominator ? numerator / denominator : 0
}

// ─── Date Formatter ──────────────────────────────────────────────────────────
/** Format ISO date string to locale display: "2026-01-15" → "Jan 15, 2026" */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('en', {
      year: 'numeric', month: 'short', day: 'numeric',
    })
  } catch {
    return iso
  }
}

// ─── Age Formatter ───────────────────────────────────────────────────────────
/** Returns human-readable age from an ISO timestamp: "3 days ago", "2 hours ago" */
export function formatAge(iso: string | null | undefined): string {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000)      return 'just now'
  if (ms < 3_600_000)   return `${Math.floor(ms / 60_000)}m ago`
  if (ms < 86_400_000)  return `${Math.floor(ms / 3_600_000)}h ago`
  if (ms < 2_592_000_000) return `${Math.floor(ms / 86_400_000)}d ago`
  return formatDate(iso)
}

// ─── EVM Variance Color ───────────────────────────────────────────────────────
/** Returns a semantic color string based on CPI/SPI variance. */
export function varianceColor(
  value: number,
  greenAbove = 1.0,
  redBelow = 0.9,
  colors = { green: '#22c55e', amber: '#f59e0b', red: '#ef4444' }
): string {
  if (value >= greenAbove) return colors.green
  if (value >= redBelow)   return colors.amber
  return colors.red
}

// ─── Legacy aliases (JarvisCore compatibility) ────────────────────────────────
export const De = formatCurrency
export const Me = formatCompact
export const Gi = formatPercent
export const $e = safeDiv
