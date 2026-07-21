/**
 * Tests: api/services/integration/novaProgressProjection.ts
 *
 * Pure phase/status mapping table (contract README), turnover status mapping,
 * stable hashing, and the honest field-omission behavior of the aggregator
 * (mocked tenantQuery — no real DB).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const mockTenantQuery = vi.fn()
vi.mock('../db/pool', () => ({
  query: vi.fn(),
  tenantQuery: (...a: unknown[]) => mockTenantQuery(...a),
  tenantTransaction: vi.fn(),
  pool: { connect: vi.fn() },
}))

import {
  phaseToOverallStatus,
  turnoverStatusFromPackages,
  stableStringify,
  summaryHash,
  buildProgressSummary,
} from '../services/integration/novaProgressProjection'

describe('phaseToOverallStatus (pure)', () => {
  it('maps every Denver phase per the contract README table', () => {
    expect(phaseToOverallStatus('active', 'feasibility')).toBe('planning')
    expect(phaseToOverallStatus('active', 'feed')).toBe('planning')
    expect(phaseToOverallStatus('active', 'detailed_design')).toBe('engineering')
    expect(phaseToOverallStatus('active', 'procurement')).toBe('procurement')
    expect(phaseToOverallStatus('active', 'construction')).toBe('construction')
    expect(phaseToOverallStatus('active', 'commissioning')).toBe('commissioning')
    expect(phaseToOverallStatus('active', 'closeout')).toBe('turnover')
  })

  it('lets project status win for hold/terminal states', () => {
    expect(phaseToOverallStatus('on_hold', 'construction')).toBe('on_hold')
    expect(phaseToOverallStatus('cancelled', 'feed')).toBe('cancelled')
    expect(phaseToOverallStatus('completed', 'closeout')).toBe('closed')
  })

  it('falls back to planning for unknown/null phase', () => {
    expect(phaseToOverallStatus('planning', null)).toBe('planning')
    expect(phaseToOverallStatus('active', 'something_new')).toBe('planning')
  })
})

describe('turnoverStatusFromPackages (pure)', () => {
  it('maps package states honestly (issued is never produced — Denver has no such state)', () => {
    expect(turnoverStatusFromPackages([])).toBe('not_started')
    expect(turnoverStatusFromPackages(['open'])).toBe('in_progress')
    expect(turnoverStatusFromPackages(['in_commissioning', 'accepted'])).toBe('in_progress')
    expect(turnoverStatusFromPackages(['accepted', 'accepted'])).toBe('accepted')
  })
})

describe('stableStringify / summaryHash (pure)', () => {
  it('is independent of key order and drops undefined values', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }))
    expect(stableStringify({ a: 1, gone: undefined })).toBe(stableStringify({ a: 1 }))
    expect(summaryHash({ b: 1, a: [1, 2] })).toBe(summaryHash({ a: [1, 2], b: 1 }))
  })

  it('changes when a value changes', () => {
    expect(summaryHash({ overallPercent: 10 })).not.toBe(summaryHash({ overallPercent: 11 }))
  })
})

describe('buildProgressSummary', () => {
  beforeEach(() => { mockTenantQuery.mockReset() })

  function script(rows: {
    project?: Record<string, unknown> | null
    deficiencies?: Record<string, unknown>
    actions?: Record<string, unknown>
    packages?: Record<string, unknown>[]
  }) {
    mockTenantQuery.mockImplementation((_tenantId: string, sql: string) => {
      if (sql.includes('FROM projects'))          return Promise.resolve({ rows: rows.project === null ? [] : [rows.project] })
      if (sql.includes('FROM deficiencies'))      return Promise.resolve({ rows: [rows.deficiencies ?? { open: '0', critical: '0' }] })
      if (sql.includes('FROM action_items'))      return Promise.resolve({ rows: [rows.actions ?? { overdue: '0' }] })
      if (sql.includes('FROM turnover_packages')) return Promise.resolve({ rows: rows.packages ?? [] })
      return Promise.resolve({ rows: [] })
    })
  }

  it('returns null when the project does not exist', async () => {
    script({ project: null })
    expect(await buildProgressSummary('t1', 'p1')).toBeNull()
  })

  it('assembles a full summary from the rollups', async () => {
    script({
      project: { status: 'active', current_phase: 'construction', progress_pct: '61.50' },
      deficiencies: { open: '4', critical: '1' },
      actions: { overdue: '2' },
      packages: [{ status: 'open' }, { status: 'accepted' }],
    })
    expect(await buildProgressSummary('t1', 'p1')).toEqual({
      overallStatus: 'construction',
      overallPercent: 61.5,
      deficienciesOpen: 4,
      criticalDeficienciesOpen: 1,
      overdueActivities: 2,
      turnoverStatus: 'in_progress',
    })
  })

  it('OMITS overallPercent when progress_pct is null — never zero-fills', async () => {
    script({ project: { status: 'active', current_phase: 'feed', progress_pct: null } })
    const summary = await buildProgressSummary('t1', 'p1')
    expect(summary).not.toBeNull()
    expect('overallPercent' in summary!).toBe(false)
    expect(summary!.overallStatus).toBe('planning')
  })

  it('never emits discipline-split percents or systems counts (no honest source)', async () => {
    script({ project: { status: 'active', current_phase: 'commissioning', progress_pct: '80' } })
    const summary = (await buildProgressSummary('t1', 'p1')) as unknown as Record<string, unknown>
    for (const key of ['engineeringPercent', 'procurementPercent', 'constructionPercent',
                       'mechanicalCompletionPercent', 'commissioningPercent',
                       'systemsReadyForStartup', 'systemsAccepted']) {
      expect(key in summary).toBe(false)
    }
  })

  it('clamps out-of-range percent values into 0..100', async () => {
    script({ project: { status: 'active', current_phase: 'construction', progress_pct: '104' } })
    expect((await buildProgressSummary('t1', 'p1'))!.overallPercent).toBe(100)
  })
})
