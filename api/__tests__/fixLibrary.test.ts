/**
 * Tests: api/services/fixLibrary.ts
 * Covers create validation and the ranking algorithm (pure JS path).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

const mockQuery = vi.fn()
vi.mock('../db/pool', () => ({
  tenantQuery: (_tenantId: string, sql: string, params: unknown[]) => mockQuery(sql, params),
  query:       (sql: string, params: unknown[]) => mockQuery(sql, params),
}))

import { createFix, searchFixes, __testHooks } from '../services/fixLibrary'

const T = 'tenant-1'

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'fix-1', tenant_id: T, project_id: null,
    asset_system: 'chiller', asset_tag: 'CH-01',
    symptoms: ['oil_pressure_trip', 'startup_fail'],
    root_cause: 'Oil filter clogged with debris',
    resolution_steps: 'Replace filter, bleed oil circuit, verify pressure.',
    confidence: 'confirmed',
    verified_by: null, verified_at: null,
    source_url: null, source_note: null,
    created_by: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

// ─── createFix — validation ───────────────────────────────────────────────────

describe('createFix — validation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects empty symptoms', async () => {
    await expect(createFix({
      tenantId: T, symptoms: [], rootCause: 'x', resolutionSteps: 'y',
    })).rejects.toThrow(/at least one symptom/)
  })

  it('rejects missing root_cause or resolution', async () => {
    await expect(createFix({
      tenantId: T, symptoms: ['a'], rootCause: '', resolutionSteps: 'y',
    })).rejects.toThrow(/required/)
    await expect(createFix({
      tenantId: T, symptoms: ['a'], rootCause: 'x', resolutionSteps: '',
    })).rejects.toThrow(/required/)
  })

  it('lowercases + trims symptom tags on insert', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [row()] })
    await createFix({
      tenantId: T, symptoms: [' Oil_Pressure_Trip ', 'STARTUP_FAIL'],
      rootCause: 'x', resolutionSteps: 'y',
    })
    const [, params] = mockQuery.mock.calls[0]!
    expect(params[3]).toEqual(['oil_pressure_trip', 'startup_fail'])
  })

  it('normalizes asset_tag before storing', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [row()] })
    await createFix({
      tenantId: T, assetTag: 'ch 01', symptoms: ['x'],
      rootCause: 'x', resolutionSteps: 'y',
    })
    const [, params] = mockQuery.mock.calls[0]!
    expect(params[2]).toBe('CH-01')
  })
})

// ─── searchFixes — ranking ────────────────────────────────────────────────────

describe('searchFixes — ranking', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns empty when no search signal is provided', async () => {
    const hits = await searchFixes({ tenantId: T })
    expect(hits).toEqual([])
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('ranks full symptom match above partial match', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [
      row({ id: 'a', symptoms: ['oil_pressure_trip', 'startup_fail'] }),
      row({ id: 'b', symptoms: ['oil_pressure_trip'] }),
    ] })
    const hits = await searchFixes({
      tenantId: T,
      symptoms: ['oil_pressure_trip', 'startup_fail'],
      limit: 5,
    })
    expect(hits[0]!.fix.id).toBe('a')
    expect(hits[0]!.symptom_overlap).toBe(1)
    expect(hits[1]!.symptom_overlap).toBeCloseTo(0.5, 2)
  })

  it('applies confidence weighting', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [
      row({ id: 'confirmed-row',  confidence: 'confirmed' }),
      row({ id: 'suspected-row',  confidence: 'suspected' }),
    ] })
    const hits = await searchFixes({ tenantId: T, symptoms: ['oil_pressure_trip'] })
    expect(hits[0]!.fix.id).toBe('confirmed-row')
    expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score)
  })

  it('prefers rows whose asset_system + tag match the query', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [
      row({ id: 'tag-match',    asset_system: 'chiller', asset_tag: 'CH-01' }),
      row({ id: 'system-match', asset_system: 'chiller', asset_tag: 'CH-09' }),
      row({ id: 'no-match',     asset_system: 'vfd',     asset_tag: 'V-05' }),
    ] })
    const hits = await searchFixes({
      tenantId: T,
      symptoms: ['oil_pressure_trip'],
      assetSystem: 'chiller',
      assetTag: 'CH-01',
    })
    expect(hits[0]!.fix.id).toBe('tag-match')
    expect(hits[1]!.fix.id).toBe('system-match')
  })

  it('respects minConfidence filter', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [row()] })
    await searchFixes({
      tenantId: T,
      symptoms: ['x'],
      minConfidence: 'confirmed',
    })
    const [sql, params] = mockQuery.mock.calls[0]!
    expect(sql).toMatch(/confidence = ANY/)
    expect(params.at(-1)).toEqual(['confirmed'])
  })

  it('normalizes asset_tag on query side too', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    await searchFixes({ tenantId: T, assetTag: 'ch 01' })
    const [, params] = mockQuery.mock.calls[0]!
    expect(params).toContain('CH-01')
  })
})

// ─── Weight table sanity ──────────────────────────────────────────────────────

describe('confidence weights', () => {
  it('confirmed > probable > suspected', () => {
    const { CONFIDENCE_WEIGHT } = __testHooks
    expect(CONFIDENCE_WEIGHT.confirmed).toBeGreaterThan(CONFIDENCE_WEIGHT.probable)
    expect(CONFIDENCE_WEIGHT.probable).toBeGreaterThan(CONFIDENCE_WEIGHT.suspected)
  })
})
