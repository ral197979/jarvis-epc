/**
 * TRIR — the calculation, and every refusal it must make.
 *
 * What this replaces: the dashboard computed
 *
 *     (recordable × 200,000) / (200,000 × toolbox_talks.length)
 *
 * `safety_incidents` had no `recordable` column, so the numerator counted a
 * field that did not exist. `toolbox_talks` has no table, so the denominator
 * was invented — and clamped to a minimum of one, which meant the card ALWAYS
 * produced a plausible rate. TRIR is a regulated OSHA metric; a fabricated one
 * on an executive dashboard is a compliance claim about a workplace.
 *
 * The property under test is therefore not "the arithmetic is right" but
 * "there is no input for which a number appears that should not". Each refusal
 * below is a path by which a plausible rate could otherwise reach a reader.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockQuery = vi.fn()
vi.mock('../db/pool', () => ({
  query:             (...a: unknown[]) => mockQuery(...a),
  tenantQuery:       (...a: unknown[]) => mockQuery(...a),
  tenantTransaction: async (_t: string, fn: (c: unknown) => unknown) => fn({ query: mockQuery }),
  pool:              { query: (...a: unknown[]) => mockQuery(...a), connect: vi.fn() },
}))

import { computeTrir, uncoveredDayCount, OSHA_HOURS_BASE } from '../services/safety/trirService'

const TENANT = 'aaaaaaaa-0000-4000-8000-000000000001'
const PROJECT = '30000000-0000-4000-8000-00000000000a'

/**
 * Drive the two queries the service issues, ANSWERING FROM ROWS.
 *
 * The incident counts are computed by honouring the FILTER clauses the product
 * actually wrote, rather than returning fixed totals. That is what makes the
 * numerator testable: strip `FILTER (WHERE recordable IS TRUE)` from the query
 * and this fixture starts counting every incident, so the rate moves and the
 * tests go red. A fixture that returned canned counts would be blind to it.
 */
function rowsFixture(
  incidents: (boolean | null)[],
  exposure: { period_start: string; period_end: string; hours: string }[],
): void {
  mockQuery.mockReset()
  mockQuery.mockImplementation(async (_t: string, sql: string) => {
    if (/FROM safety_incidents/i.test(sql)) {
      const recordable = /FILTER\s*\(\s*WHERE\s+recordable\s+IS\s+TRUE\s*\)/i.test(sql)
        ? incidents.filter(r => r === true).length
        : incidents.length                       // no filter → counts everything
      const unclassified = /FILTER\s*\(\s*WHERE\s+recordable\s+IS\s+NULL\s*\)/i.test(sql)
        ? incidents.filter(r => r === null).length
        : 0
      return { rows: [{ total: String(incidents.length), recordable: String(recordable), unclassified: String(unclassified) }], rowCount: 1 }
    }
    if (/FROM safety_exposure_hours/i.test(sql)) {
      // Honour the scope predicate: a tenant rate must not read project rows.
      const wantsTenant = /project_id IS NULL/i.test(sql)
      const rows = wantsTenant ? exposure.filter(e => !(e as { project?: boolean }).project) : exposure
      return { rows, rowCount: rows.length }
    }
    return { rows: [], rowCount: 0 }
  })
}

/** Legacy shape kept for the tests that only care about counts. */
function fixture(counts: { total: number; recordable: number; unclassified: number },
                 exposure: { period_start: string; period_end: string; hours: string }[]): void {
  const rows: (boolean | null)[] = [
    ...Array<boolean>(counts.recordable).fill(true),
    ...Array<null>(counts.unclassified).fill(null),
    ...Array<boolean>(Math.max(0, counts.total - counts.recordable - counts.unclassified)).fill(false),
  ]
  rowsFixture(rows, exposure)
}

const FULL_YEAR = [{ period_start: '2026-01-01', period_end: '2026-12-31', hours: '200000' }]
const run = (o: Partial<Parameters<typeof computeTrir>[1]> = {}) =>
  computeTrir(TENANT, { projectId: PROJECT, periodStart: '2026-01-01', periodEnd: '2026-12-31', ...o })

beforeEach(() => mockQuery.mockReset())

// ─── 1. The arithmetic, when it is allowed to happen ─────────────────────────

describe('the rate itself', () => {
  it('is recordable × 200,000 / hours', async () => {
    fixture({ total: 3, recordable: 3, unclassified: 0 }, FULL_YEAR)
    const r = await run()
    // 3 × 200,000 / 200,000 = 3
    expect(r.trir).toBe(3)
    expect(r.reason).toBeUndefined()
    expect(r.recordableIncidents).toBe(3)
    expect(r.exposureHours).toBe(200_000)
  })

  it('uses the OSHA base of 200,000', () => {
    expect(OSHA_HOURS_BASE).toBe(200_000)
  })

  it('is zero — a real, earned zero — when incidents exist but none is recordable', async () => {
    // This is the ONE case where 0.0 is truthful: every incident was examined
    // and none met the recordable standard.
    fixture({ total: 4, recordable: 0, unclassified: 0 }, FULL_YEAR)
    const r = await run()
    expect(r.trir).toBe(0)
    expect(r.totalIncidents).toBe(4)
    expect(r.unclassifiedIncidents).toBe(0)
  })

  it('scales with the denominator', async () => {
    fixture({ total: 1, recordable: 1, unclassified: 0 },
      [{ period_start: '2026-01-01', period_end: '2026-12-31', hours: '100000' }])
    expect((await run()).trir).toBe(2)
  })

  it('sums several exposure records that together span the period', async () => {
    fixture({ total: 2, recordable: 2, unclassified: 0 }, [
      { period_start: '2026-01-01', period_end: '2026-06-30', hours: '120000' },
      { period_start: '2026-07-01', period_end: '2026-12-31', hours: '80000' },
    ])
    const r = await run()
    expect(r.exposureHours).toBe(200_000)
    expect(r.exposureRecords).toBe(2)
    expect(r.trir).toBe(2)
  })
})

// ─── 2. An unclassified incident blocks the whole rate ───────────────────────

describe('unknown recordability is never treated as "not recordable"', () => {
  it('refuses while any incident is unclassified', async () => {
    fixture({ total: 5, recordable: 2, unclassified: 3 }, FULL_YEAR)
    const r = await run()
    expect(r.trir).toBeNull()
    expect(r.reason).toBe('unclassified_incidents')
    expect(r.unclassifiedIncidents).toBe(3)
  })

  it('does not leak a numerator it refused to stand behind', async () => {
    // Reporting "2 recordable" beside a refusal invites the reader to divide it
    // themselves and arrive at exactly the understated rate we would not print.
    fixture({ total: 5, recordable: 2, unclassified: 3 }, FULL_YEAR)
    expect((await run()).recordableIncidents).toBeNull()
  })

  it('refuses even when the unclassified incident is the only one', async () => {
    fixture({ total: 1, recordable: 0, unclassified: 1 }, FULL_YEAR)
    expect((await run()).reason).toBe('unclassified_incidents')
  })

  it('refuses on the numerator BEFORE complaining about the denominator', async () => {
    // Both halves are broken. The numerator reason is the more actionable one:
    // it names work someone must do, rather than data that is merely absent.
    fixture({ total: 2, recordable: 0, unclassified: 2 }, [])
    expect((await run()).reason).toBe('unclassified_incidents')
  })

  it('still reports the unclassified count, so the gap is visible', async () => {
    fixture({ total: 9, recordable: 1, unclassified: 8 }, FULL_YEAR)
    const r = await run()
    expect(r.unclassifiedIncidents).toBe(8)
    expect(r.totalIncidents).toBe(9)
  })
})

// ─── 3. The denominator must be measured and complete ────────────────────────

describe('the denominator is never inferred', () => {
  it('refuses when no exposure hours exist at all', async () => {
    fixture({ total: 2, recordable: 2, unclassified: 0 }, [])
    const r = await run()
    expect(r.trir).toBeNull()
    expect(r.reason).toBe('no_exposure_hours')
    expect(r.exposureHours).toBeNull()
  })

  it('refuses when hours cover only part of the period', async () => {
    // One month of payroll is not a year's denominator. Dividing by it would
    // produce a rate twelve times too high — a fabrication in the alarming
    // direction rather than the reassuring one, but a fabrication either way.
    fixture({ total: 1, recordable: 1, unclassified: 0 },
      [{ period_start: '2026-01-01', period_end: '2026-01-31', hours: '16000' }])
    const r = await run()
    expect(r.trir).toBeNull()
    expect(r.reason).toBe('incomplete_exposure_coverage')
    expect(r.uncoveredDays).toBeGreaterThan(300)
  })

  it('refuses on a one-day hole in the middle', async () => {
    fixture({ total: 1, recordable: 1, unclassified: 0 }, [
      { period_start: '2026-01-01', period_end: '2026-06-29', hours: '100000' },
      { period_start: '2026-07-01', period_end: '2026-12-31', hours: '100000' },
    ])
    const r = await run()
    expect(r.reason).toBe('incomplete_exposure_coverage')
    expect(r.uncoveredDays).toBe(1)   // 2026-06-30
  })

  it('refuses to divide by zero recorded hours', async () => {
    fixture({ total: 1, recordable: 1, unclassified: 0 },
      [{ period_start: '2026-01-01', period_end: '2026-12-31', hours: '0' }])
    const r = await run()
    expect(r.trir).toBeNull()
    expect(r.reason).toBe('zero_exposure_hours')
    // Not Infinity, not a huge number, not zero.
    expect(Number.isFinite(r.trir as number)).toBe(false)
  })

  it('accepts hours recorded out of order and overlapping', async () => {
    fixture({ total: 1, recordable: 1, unclassified: 0 }, [
      { period_start: '2026-07-01', period_end: '2026-12-31', hours: '100000' },
      { period_start: '2026-01-01', period_end: '2026-08-31', hours: '100000' },
    ])
    const r = await run()
    expect(r.uncoveredDays).toBe(0)
    expect(r.trir).toBe(1)
  })
})

// ─── 3b. The numerator really is filtered, and the scopes really are separate ─

describe('the numerator counts only confirmed recordable incidents', () => {
  it('does not count non-recordable incidents in the rate', async () => {
    // Three incidents, one recordable. If the FILTER were dropped the rate
    // would be 3, not 1 — this is the assertion that catches that.
    rowsFixture([true, false, false], FULL_YEAR)
    const r = await run()
    expect(r.recordableIncidents).toBe(1)
    expect(r.totalIncidents).toBe(3)
    expect(r.trir).toBe(1)
  })

  it('moves with the recordable count and nothing else', async () => {
    rowsFixture([true, true, false, false, false], FULL_YEAR)
    expect((await run()).trir).toBe(2)
  })
})

describe('exposure scope levels are never mixed', () => {
  it('refuses a TENANT rate that has only project-scoped hours', async () => {
    // Summing project rows into a tenant denominator would silently omit every
    // project that never filed its hours, shrinking the denominator and
    // overstating safety performance. A tenant rate reads tenant rows only.
    rowsFixture([true], [
      { period_start: '2026-01-01', period_end: '2026-12-31', hours: '200000', project: true } as never,
    ])
    const r = await computeTrir(TENANT, { projectId: null, periodStart: '2026-01-01', periodEnd: '2026-12-31' })
    expect(r.trir).toBeNull()
    expect(r.reason).toBe('no_exposure_hours')
  })

  it('computes a tenant rate from tenant-scoped hours', async () => {
    rowsFixture([true], FULL_YEAR)
    const r = await computeTrir(TENANT, { projectId: null, periodStart: '2026-01-01', periodEnd: '2026-12-31' })
    expect(r.trir).toBe(1)
  })
})

// ─── 4. Coverage arithmetic, directly ────────────────────────────────────────

describe('uncoveredDayCount', () => {
  it('is zero for an exact match', () => {
    expect(uncoveredDayCount('2026-01-01', '2026-01-31',
      [{ start: '2026-01-01', end: '2026-01-31' }])).toBe(0)
  })

  it('counts the whole period when nothing covers it', () => {
    expect(uncoveredDayCount('2026-01-01', '2026-01-31', [])).toBe(31)
  })

  it('merges overlapping intervals instead of double-counting them', () => {
    expect(uncoveredDayCount('2026-01-01', '2026-01-31', [
      { start: '2026-01-01', end: '2026-01-20' },
      { start: '2026-01-10', end: '2026-01-31' },
    ])).toBe(0)
  })

  it('finds an interior gap', () => {
    expect(uncoveredDayCount('2026-01-01', '2026-01-10', [
      { start: '2026-01-01', end: '2026-01-04' },
      { start: '2026-01-07', end: '2026-01-10' },
    ])).toBe(2)   // the 5th and 6th
  })

  it('ignores coverage outside the period rather than crediting it', () => {
    expect(uncoveredDayCount('2026-06-01', '2026-06-30', [
      { start: '2025-01-01', end: '2025-12-31' },
    ])).toBe(30)
  })

  it('clips coverage that overhangs the period', () => {
    expect(uncoveredDayCount('2026-06-01', '2026-06-30', [
      { start: '2026-01-01', end: '2026-12-31' },
    ])).toBe(0)
  })

  it('counts a single-day period as one day', () => {
    expect(uncoveredDayCount('2026-06-01', '2026-06-01', [])).toBe(1)
    expect(uncoveredDayCount('2026-06-01', '2026-06-01',
      [{ start: '2026-06-01', end: '2026-06-01' }])).toBe(0)
  })
})

// ─── 5. Malformed input is refused, not coerced ──────────────────────────────

describe('an invalid period is refused', () => {
  it('rejects a reversed range', async () => {
    fixture({ total: 0, recordable: 0, unclassified: 0 }, FULL_YEAR)
    const r = await computeTrir(TENANT, { projectId: PROJECT, periodStart: '2026-12-31', periodEnd: '2026-01-01' })
    expect(r.trir).toBeNull()
    expect(r.reason).toBe('invalid_period')
  })

  it('rejects a missing or malformed date rather than defaulting one', async () => {
    for (const [s, e] of [['', '2026-12-31'], ['2026-01-01', ''], ['not-a-date', '2026-12-31']]) {
      const r = await computeTrir(TENANT, { projectId: PROJECT, periodStart: s!, periodEnd: e! })
      expect(r.reason, `${s}..${e}`).toBe('invalid_period')
    }
  })

  it('issues no queries at all for an invalid period', async () => {
    mockQuery.mockReset()
    await computeTrir(TENANT, { projectId: PROJECT, periodStart: 'x', periodEnd: 'y' })
    expect(mockQuery).not.toHaveBeenCalled()
  })
})
