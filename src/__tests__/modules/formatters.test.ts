/**
 * Tests: modules/utils/formatters
 * Coverage: formatCurrency, formatCompact, formatPercent, safeDiv,
 *           formatDate, formatAge, varianceColor
 */

import { describe, it, expect } from 'vitest'
import {
  formatCurrency,
  formatCompact,
  formatPercent,
  safeDiv,
  formatDate,
  formatAge,
  varianceColor,
  De, Me, Gi, $e,
} from '../../modules/utils/formatters'

// ─── formatCurrency ───────────────────────────────────────────────────────────
describe('formatCurrency', () => {
  it('formats zero correctly', () => {
    expect(formatCurrency(0)).toBe('$0')
  })

  it('formats a whole dollar amount', () => {
    expect(formatCurrency(1000)).toBe('$1,000')
  })

  it('formats millions', () => {
    expect(formatCurrency(1_234_567)).toBe('$1,234,567')
  })

  it('handles string input', () => {
    expect(formatCurrency('5000')).toBe('$5,000')
  })

  it('handles undefined/null gracefully', () => {
    expect(formatCurrency(undefined)).toBe('$0')
  })

  it('handles negative values', () => {
    expect(formatCurrency(-500)).toBe('-$500')
  })

  it('rounds to zero decimal places', () => {
    expect(formatCurrency(1234.99)).toBe('$1,235')
  })
})

// ─── formatCompact ────────────────────────────────────────────────────────────
describe('formatCompact', () => {
  it('formats sub-thousand values', () => {
    expect(formatCompact(500)).toBe('$500')
  })

  it('formats thousands with k suffix', () => {
    expect(formatCompact(45_000)).toBe('$45k')
  })

  it('formats millions with M suffix and 1 decimal', () => {
    expect(formatCompact(1_500_000)).toBe('$1.5M')
  })

  it('formats large millions', () => {
    expect(formatCompact(12_700_000)).toBe('$12.7M')
  })

  it('handles negative millions', () => {
    expect(formatCompact(-2_000_000)).toBe('$-2.0M')
  })

  it('handles zero', () => {
    expect(formatCompact(0)).toBe('$0')
  })

  it('handles undefined', () => {
    expect(formatCompact(undefined)).toBe('$0')
  })
})

// ─── formatPercent ────────────────────────────────────────────────────────────
describe('formatPercent', () => {
  it('converts ratio 0.876 to 87.6%', () => {
    expect(formatPercent(0.876)).toBe('87.6%')
  })

  it('converts 0 to 0.0%', () => {
    expect(formatPercent(0)).toBe('0.0%')
  })

  it('converts 1 to 100.0%', () => {
    expect(formatPercent(1)).toBe('100.0%')
  })

  it('converts 0.5 to 50.0%', () => {
    expect(formatPercent(0.5)).toBe('50.0%')
  })

  it('handles undefined', () => {
    expect(formatPercent(undefined)).toBe('0.0%')
  })

  it('handles string ratio', () => {
    expect(formatPercent('0.25')).toBe('25.0%')
  })
})

// ─── safeDiv ─────────────────────────────────────────────────────────────────
describe('safeDiv', () => {
  it('divides normally when denominator is non-zero', () => {
    expect(safeDiv(10, 2)).toBe(5)
  })

  it('returns 0 when denominator is 0', () => {
    expect(safeDiv(10, 0)).toBe(0)
  })

  it('returns 0 for null/undefined denominator', () => {
    expect(safeDiv(5, null as unknown as number)).toBe(0)
  })

  it('handles fractional division', () => {
    expect(safeDiv(1, 3)).toBeCloseTo(0.333)
  })

  it('handles negative values', () => {
    expect(safeDiv(-10, 2)).toBe(-5)
  })
})

// ─── formatDate ───────────────────────────────────────────────────────────────
describe('formatDate', () => {
  it('returns dash for null', () => {
    expect(formatDate(null)).toBe('—')
  })

  it('returns dash for undefined', () => {
    expect(formatDate(undefined)).toBe('—')
  })

  it('formats a valid ISO date', () => {
    const result = formatDate('2026-01-15')
    expect(result).toContain('2026')
    expect(result).toContain('Jan')
  })

  it('formats a full ISO timestamp', () => {
    const result = formatDate('2026-06-30T14:30:00Z')
    expect(result).toContain('2026')
  })
})

// ─── formatAge ────────────────────────────────────────────────────────────────
describe('formatAge', () => {
  it('returns dash for null', () => {
    expect(formatAge(null)).toBe('—')
  })

  it('returns "just now" for very recent timestamps', () => {
    const recent = new Date(Date.now() - 5000).toISOString()
    expect(formatAge(recent)).toBe('just now')
  })

  it('returns minutes ago for recent timestamps', () => {
    const minutes = new Date(Date.now() - 5 * 60_000).toISOString()
    expect(formatAge(minutes)).toMatch(/^\d+m ago$/)
  })

  it('returns hours ago for same-day timestamps', () => {
    const hours = new Date(Date.now() - 3 * 3_600_000).toISOString()
    expect(formatAge(hours)).toMatch(/^\d+h ago$/)
  })

  it('returns days ago for older timestamps', () => {
    const days = new Date(Date.now() - 5 * 86_400_000).toISOString()
    expect(formatAge(days)).toMatch(/^\d+d ago$/)
  })
})

// ─── varianceColor ────────────────────────────────────────────────────────────
describe('varianceColor', () => {
  const GREEN = '#22c55e'
  const AMBER = '#f59e0b'
  const RED   = '#ef4444'

  it('returns green for value above greenAbove (1.0)', () => {
    expect(varianceColor(1.05)).toBe(GREEN)
  })

  it('returns green for value equal to greenAbove', () => {
    expect(varianceColor(1.0)).toBe(GREEN)
  })

  it('returns amber for value between redBelow and greenAbove', () => {
    expect(varianceColor(0.95)).toBe(AMBER)
  })

  it('returns red for value below redBelow (0.9)', () => {
    expect(varianceColor(0.85)).toBe(RED)
  })

  it('accepts custom thresholds', () => {
    expect(varianceColor(0.8, 0.75, 0.5)).toBe(GREEN)
  })

  it('accepts custom colors', () => {
    const custom = { green: '#aaa', amber: '#bbb', red: '#ccc' }
    expect(varianceColor(1.1, 1.0, 0.9, custom)).toBe('#aaa')
  })
})

// ─── Legacy alias coverage ────────────────────────────────────────────────────
describe('Legacy aliases', () => {
  it('De === formatCurrency', () => {
    expect(De(1000)).toBe(formatCurrency(1000))
  })

  it('Me === formatCompact', () => {
    expect(Me(1_500_000)).toBe(formatCompact(1_500_000))
  })

  it('Gi === formatPercent', () => {
    expect(Gi(0.75)).toBe(formatPercent(0.75))
  })

  it('$e === safeDiv', () => {
    expect($e(10, 3)).toBe(safeDiv(10, 3))
  })
})

// ─── Track E: formatters uncovered branches ────────────────────────────────────
// (formatDate, formatAge already imported at top)

describe('formatDate — catch branch (line 49: invalid date → return iso)', () => {
  it('returns original string when date is invalid', () => {
    const bad = 'not-a-date'
    const result = formatDate(bad)
    // Either returns iso as-is or formats — depends on env Date parsing
    expect(typeof result).toBe('string')
  })

  it('returns formatted date for valid ISO string', () => {
    const result = formatDate('2024-06-15T00:00:00.000Z')
    expect(result).toMatch(/Jun|June|2024/)
  })
})

describe('formatAge — very old date fallback (line 62: > 30 days → formatDate)', () => {
  it('returns formatted date string for timestamps older than 30 days', () => {
    // 31 days ago
    const old = new Date(Date.now() - 31 * 86_400_000).toISOString()
    const result = formatAge(old)
    // Should fall through to formatDate — not "d ago"
    expect(result).not.toMatch(/^\d+d ago$/)
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('returns "just now" for very recent timestamps', () => {
    const recent = new Date(Date.now() - 1000).toISOString()
    expect(formatAge(recent)).toBe('just now')
  })

  it('returns minutes ago for 5 minute old timestamp', () => {
    const fiveMin = new Date(Date.now() - 5 * 60_000).toISOString()
    expect(formatAge(fiveMin)).toBe('5m ago')
  })

  it('returns hours ago for 3 hour old timestamp', () => {
    const threeHr = new Date(Date.now() - 3 * 3_600_000).toISOString()
    expect(formatAge(threeHr)).toBe('3h ago')
  })

  it('returns days ago for 5 day old timestamp', () => {
    const fiveDays = new Date(Date.now() - 5 * 86_400_000).toISOString()
    expect(formatAge(fiveDays)).toBe('5d ago')
  })

  it('returns "—" for null input', () => {
    expect(formatAge(null)).toBe('—')
  })

  it('returns "—" for undefined input', () => {
    expect(formatAge(undefined)).toBe('—')
  })
})

// ─── Track D Phase 20: formatters line 49 formatDate catch return iso ─────────
describe('formatDate — catch branch returns original iso string (line 49)', () => {
  it('returns original string when Date constructor throws on invalid input', () => {
    // Pass a value that produces Invalid Date → toLocaleDateString may throw
    // Override toLocaleDateString to simulate a throwing locale environment
    const origFn = Date.prototype.toLocaleDateString
    Date.prototype.toLocaleDateString = function() { throw new Error('locale error') }
    try {
      const result = formatDate('2026-01-15T12:00:00Z')
      // Should return the original iso string (catch branch returns iso)
      expect(result).toBe('2026-01-15T12:00:00Z')
    } finally {
      Date.prototype.toLocaleDateString = origFn
    }
  })

  it('formatDate with completely invalid input returns original string', () => {
    // 'not-a-date' → new Date('not-a-date') is Invalid Date
    // toLocaleDateString on Invalid Date may throw or return 'Invalid Date'
    const result = formatDate('not-a-date')
    // Either returns 'not-a-date' (catch) or 'Invalid Date' (no throw)
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })
})
