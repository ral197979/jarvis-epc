/**
 * Tests: api/services/ciArbiter.ts
 *
 * Exercises the arbitration state machine in read-only mode
 * (commit: false) so we don't need to mock tenantTransaction. Covers
 * rule precedence, hard-band rejection, warmup, z-score, std-floor.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

const mockQuery = vi.fn()
vi.mock('../db/pool', () => ({
  query: (sql: string, params: unknown[]) => mockQuery(sql, params),
  tenantTransaction: vi.fn(), // unused in these tests (commit:false path)
}))

// Silence agent_action writes — recordAction is invoked during no_rule/preview paths.
vi.mock('../services/agentActions', () => ({
  record: vi.fn().mockResolvedValue('action-id'),
}))

// Control fix-library responses without touching the real implementation.
// Default is "no hits" so every existing test stays green.
const mockSearchFixes = vi.fn().mockResolvedValue([])
vi.mock('../services/fixLibrary', () => ({
  searchFixes: (input: unknown) => mockSearchFixes(input),
}))

import { arbitrate } from '../services/ciArbiter'

// Small helpers ────────────────────────────────────────────────────────────────

function numericRule(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rule-1', scope: 'project', system_type: 'chiller', criteria_name: 'inlet_pressure_psig',
    criteria_kind: 'numeric',
    target_value: '100.0', tolerance_pct: '2.0', tolerance_abs: null, unit: 'psig',
    expected_bool: null, baseline_min_samples: 30, novelty_z_threshold: '2.5',
    ...overrides,
  }
}

function booleanRule(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rule-b', scope: 'global', system_type: 'chiller', criteria_name: 'isolation_valve_open',
    criteria_kind: 'boolean', target_value: null, tolerance_pct: null, tolerance_abs: null,
    unit: null, expected_bool: true, baseline_min_samples: 30, novelty_z_threshold: '2.5',
    ...overrides,
  }
}

function baseline(overrides: Record<string, unknown> = {}) {
  return { id: 'b-1', sample_count: 50, mean_value: '100.0', std_dev: '1.0', ...overrides }
}

// ─── no_rule ──────────────────────────────────────────────────────────────────

describe('arbitrate — no rule found', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns no_rule with explanation', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })           // rule lookup empty
    const r = await arbitrate({
      tenantId: 't', systemType: 'unknown', criteriaName: 'foo',
      numericValue: 42,
    })
    expect(r.decision).toBe('no_rule')
    expect(r.decision_trail).toMatch(/no autosign rule/)
  })
})

// ─── boolean ──────────────────────────────────────────────────────────────────

describe('arbitrate — boolean rules', () => {
  beforeEach(() => vi.clearAllMocks())

  it('pass when observed matches expected', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [booleanRule({ expected_bool: true })] })
    const r = await arbitrate({
      tenantId: 't', systemType: 'chiller', criteriaName: 'isolation_valve_open',
      booleanValue: true,
    })
    expect(r.decision).toBe('auto_pass')
    expect(r.decision_trail).toMatch(/boolean rule_pass/)
  })

  it('fail when observed differs from expected', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [booleanRule({ expected_bool: true })] })
    const r = await arbitrate({
      tenantId: 't', systemType: 'chiller', criteriaName: 'isolation_valve_open',
      booleanValue: false,
    })
    expect(r.decision).toBe('auto_fail')
  })
})

// ─── numeric hard band ────────────────────────────────────────────────────────

describe('arbitrate — numeric rule band', () => {
  beforeEach(() => vi.clearAllMocks())

  it('auto_fail when value outside tolerance', async () => {
    // target 100, ±2% → [98, 102]. 105 is out.
    mockQuery.mockResolvedValueOnce({ rows: [numericRule()] })
    const r = await arbitrate({
      tenantId: 't', systemType: 'chiller', criteriaName: 'inlet_pressure_psig',
      numericValue: 105,
    })
    expect(r.decision).toBe('auto_fail')
    expect(r.decision_trail).toMatch(/rule_fail; value 105 outside 100±2/)
  })

  it('queue_warmup when within band but baseline is immature', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [numericRule({ baseline_min_samples: 30 })] })
      .mockResolvedValueOnce({ rows: [baseline({ sample_count: 10 })] })
    const r = await arbitrate({
      tenantId: 't', systemType: 'chiller', criteriaName: 'inlet_pressure_psig',
      numericValue: 100,
    })
    expect(r.decision).toBe('queued_warmup')
    expect(r.decision_trail).toMatch(/baseline=10\/30 so queued_warmup/)
  })

  it('queue_warmup when no baseline row exists at all', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [numericRule()] })
      .mockResolvedValueOnce({ rows: [] })
    const r = await arbitrate({
      tenantId: 't', systemType: 'chiller', criteriaName: 'inlet_pressure_psig',
      numericValue: 100,
    })
    expect(r.decision).toBe('queued_warmup')
    expect(r.decision_trail).toMatch(/baseline=0\/30/)
  })
})

// ─── z-score path ────────────────────────────────────────────────────────────

describe('arbitrate — z-score decisions', () => {
  beforeEach(() => vi.clearAllMocks())

  it('auto_pass when |z| is below threshold', async () => {
    // Mean 100, std 1, value 100.5 → z = 0.5. Threshold 2.5.
    mockQuery
      .mockResolvedValueOnce({ rows: [numericRule()] })
      .mockResolvedValueOnce({ rows: [baseline()] })
    const r = await arbitrate({
      tenantId: 't', systemType: 'chiller', criteriaName: 'inlet_pressure_psig',
      numericValue: 100.5,
    })
    expect(r.decision).toBe('auto_pass')
    expect(r.decision_trail).toMatch(/rule_pass; z=0\.50 within 2\.50/)
    expect(r.z_score).toBeCloseTo(0.5, 2)
  })

  it('queue_novelty when |z| exceeds threshold but still within tolerance', async () => {
    // Target 100, tolerance ±2%. Band [98,102]. Value 101.5 is inside band.
    // But mean=100, std=0.5 → z = 3.0, above 2.5 threshold.
    mockQuery
      .mockResolvedValueOnce({ rows: [numericRule()] })
      .mockResolvedValueOnce({ rows: [baseline({ std_dev: '0.5' })] })
    const r = await arbitrate({
      tenantId: 't', systemType: 'chiller', criteriaName: 'inlet_pressure_psig',
      numericValue: 101.5,
    })
    expect(r.decision).toBe('queued_novelty')
    expect(r.decision_trail).toMatch(/z=3\.00 above 2\.50 threshold/)
  })
})

// ─── std-dev floor ────────────────────────────────────────────────────────────

describe('arbitrate — std-dev floor', () => {
  beforeEach(() => vi.clearAllMocks())

  it('clamps effective std so ultra-stable criteria do not explode z-score', async () => {
    // Raw std is 0 (perfectly stable baseline). Without the floor, z
    // would be Infinity. With floor = tolerance_band * 0.1 = 0.2, a
    // value of 100.1 produces z = 0.5, well within threshold → auto_pass.
    mockQuery
      .mockResolvedValueOnce({ rows: [numericRule()] })   // target 100, ±2% → band 2.0
      .mockResolvedValueOnce({ rows: [baseline({ std_dev: '0' })] })
    const r = await arbitrate({
      tenantId: 't', systemType: 'chiller', criteriaName: 'inlet_pressure_psig',
      numericValue: 100.1,
    })
    expect(r.decision).toBe('auto_pass')
    expect(Number.isFinite(r.z_score ?? NaN)).toBe(true)
    expect(Math.abs(r.z_score!)).toBeLessThan(1.0)
    expect((r.evidence as Record<string, unknown>)['effective_std']).toBeGreaterThanOrEqual(0.2)
  })
})

// ─── input validation ────────────────────────────────────────────────────────

describe('arbitrate — input validation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects when both value kinds provided', async () => {
    const r = await arbitrate({
      tenantId: 't', systemType: 'x', criteriaName: 'y',
      numericValue: 1, booleanValue: true,
    })
    expect(r.decision).toBe('no_rule')
    expect(r.decision_trail).toMatch(/exactly one of numericValue or booleanValue/)
  })

  it('rejects when neither value kind provided', async () => {
    const r = await arbitrate({ tenantId: 't', systemType: 'x', criteriaName: 'y' })
    expect(r.decision).toBe('no_rule')
    expect(r.decision_trail).toMatch(/exactly one of/)
  })
})

// ─── Fix-hint enrichment ──────────────────────────────────────────────────────

describe('arbitrate — fix-library enrichment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSearchFixes.mockResolvedValue([])      // reset to default per test
  })

  it('auto_fail decisions get fix_hints attached to evidence', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [numericRule()] })
    mockSearchFixes.mockResolvedValueOnce([{
      fix: {
        id: 'fix-1', confidence: 'confirmed',
        asset_system: 'chiller', asset_tag: 'CH-01',
        symptoms: ['low_inlet_pressure_psig'],
        root_cause: 'Upstream isolation valve partially closed',
        resolution_steps: 'Open V-04 fully, verify pressure returns.',
        source_url: null, source_note: null,
      },
      score: 0.72, symptom_overlap: 1, why: 'symptoms 1/1 · confirmed',
    }])

    const r = await arbitrate({
      tenantId: 't', systemType: 'chiller', criteriaName: 'inlet_pressure_psig',
      numericValue: 90,    // outside 100 ± 2%
    })
    expect(r.decision).toBe('auto_fail')
    const ev = r.evidence as Record<string, unknown>
    expect(ev['fix_hints']).toBeDefined()
    expect((ev['fix_hints'] as unknown[]).length).toBe(1)
    expect(r.decision_trail).toMatch(/prior fix \(confirmed/)
  })

  it('auto_pass decisions do NOT call fix search', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [numericRule()] })
      .mockResolvedValueOnce({ rows: [baseline()] })
    const r = await arbitrate({
      tenantId: 't', systemType: 'chiller', criteriaName: 'inlet_pressure_psig',
      numericValue: 100.5,
    })
    expect(r.decision).toBe('auto_pass')
    expect(mockSearchFixes).not.toHaveBeenCalled()
  })

  it('queued_novelty uses anomalous_ symptom tag', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [numericRule()] })
      .mockResolvedValueOnce({ rows: [baseline({ std_dev: '0.5' })] })
    const r = await arbitrate({
      tenantId: 't', systemType: 'chiller', criteriaName: 'inlet_pressure_psig',
      numericValue: 101.5,
    })
    expect(r.decision).toBe('queued_novelty')
    const call = mockSearchFixes.mock.calls[0]![0] as { symptoms: string[] }
    expect(call.symptoms).toContain('anomalous_inlet_pressure_psig')
  })

  it('fix search failure does NOT break the decision', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [numericRule()] })
    mockSearchFixes.mockRejectedValueOnce(new Error('kaboom'))

    const r = await arbitrate({
      tenantId: 't', systemType: 'chiller', criteriaName: 'inlet_pressure_psig',
      numericValue: 90,
    })
    expect(r.decision).toBe('auto_fail')   // decision survives the error
  })

  it('low-score hints are attached to evidence but do NOT edit decision_trail', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [numericRule()] })
    mockSearchFixes.mockResolvedValueOnce([{
      fix: {
        id: 'fix-1', confidence: 'suspected',
        asset_system: null, asset_tag: null,
        symptoms: ['something'],
        root_cause: 'Weakly related possibility',
        resolution_steps: 'Try X.',
        source_url: null, source_note: null,
      },
      score: 0.2, symptom_overlap: 0, why: 'low match',
    }])

    const r = await arbitrate({
      tenantId: 't', systemType: 'chiller', criteriaName: 'inlet_pressure_psig',
      numericValue: 90,
    })
    expect(r.decision_trail).not.toMatch(/prior fix/)
    // Hint still in evidence so UI can display if desired
    expect((r.evidence as Record<string, unknown>)['fix_hints']).toBeDefined()
  })
})
