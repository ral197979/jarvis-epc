/**
 * Tests: api/services/cpm.ts
 * CPM is pure computation — no mocks needed. Covers forward/backward
 * pass, critical-path detection, lag handling, cycle detection, and
 * missing-task validation.
 */

import { describe, it, expect } from 'vitest'
import { computeCpm, CpmCycleError, CpmMissingTaskError } from '../services/cpm'

describe('computeCpm', () => {
  it('trivial: two independent tasks, project_finish = max duration', () => {
    const out = computeCpm(
      [{ id: 'a', duration_days: 3 }, { id: 'b', duration_days: 5 }],
      [],
    )
    expect(out.project_finish).toBe(5)
    expect(out.results['a']!.es).toBe(0)
    expect(out.results['b']!.ef).toBe(5)
    // Only the longest parallel path is critical; the shorter one has float.
    expect(out.results['a']!.total_float).toBe(2)
    expect(out.results['a']!.is_critical).toBe(false)
    expect(out.results['b']!.total_float).toBe(0)
    expect(out.results['b']!.is_critical).toBe(true)
  })

  it('classic diamond: A → B, A → C, B → D, C → D with differing durations', () => {
    const out = computeCpm(
      [
        { id: 'A', duration_days: 2 },
        { id: 'B', duration_days: 5 },   // longer path
        { id: 'C', duration_days: 3 },
        { id: 'D', duration_days: 4 },
      ],
      [
        { predecessor_id: 'A', successor_id: 'B', lag_days: 0 },
        { predecessor_id: 'A', successor_id: 'C', lag_days: 0 },
        { predecessor_id: 'B', successor_id: 'D', lag_days: 0 },
        { predecessor_id: 'C', successor_id: 'D', lag_days: 0 },
      ],
    )
    // A(0-2) → B(2-7) → D(7-11) vs A → C(2-5) → D(5-9). Max EF = 11.
    expect(out.project_finish).toBe(11)
    expect(out.results['A']!.is_critical).toBe(true)
    expect(out.results['B']!.is_critical).toBe(true)
    expect(out.results['C']!.is_critical).toBe(false)   // 2 days of float
    expect(out.results['C']!.total_float).toBe(2)
    expect(out.results['D']!.is_critical).toBe(true)
  })

  it('lag_days extends earliest start of successor', () => {
    const out = computeCpm(
      [{ id: 'A', duration_days: 2 }, { id: 'B', duration_days: 3 }],
      [{ predecessor_id: 'A', successor_id: 'B', lag_days: 4 }],
    )
    // A finishes at day 2, B can't start until 2 + 4 = 6, B finishes at 9.
    expect(out.results['B']!.es).toBe(6)
    expect(out.project_finish).toBe(9)
  })

  it('negative lag (lead) is clamped so ES cannot go below zero', () => {
    const out = computeCpm(
      [{ id: 'A', duration_days: 2 }, { id: 'B', duration_days: 3 }],
      [{ predecessor_id: 'A', successor_id: 'B', lag_days: -10 }],
    )
    // A.ef = 2, so B.es = max(0, 2 - 10) = 0
    expect(out.results['B']!.es).toBe(0)
  })

  it('milestone (duration 0) inherits predecessor EF as its ES/EF', () => {
    const out = computeCpm(
      [{ id: 'A', duration_days: 4 }, { id: 'M', duration_days: 0 }],
      [{ predecessor_id: 'A', successor_id: 'M', lag_days: 0 }],
    )
    expect(out.results['M']!.es).toBe(4)
    expect(out.results['M']!.ef).toBe(4)
  })

  it('throws CpmCycleError on a 2-node cycle', () => {
    expect(() => computeCpm(
      [{ id: 'A', duration_days: 1 }, { id: 'B', duration_days: 1 }],
      [
        { predecessor_id: 'A', successor_id: 'B', lag_days: 0 },
        { predecessor_id: 'B', successor_id: 'A', lag_days: 0 },
      ],
    )).toThrow(CpmCycleError)
  })

  it('throws CpmMissingTaskError on unknown predecessor', () => {
    expect(() => computeCpm(
      [{ id: 'A', duration_days: 1 }],
      [{ predecessor_id: 'missing', successor_id: 'A', lag_days: 0 }],
    )).toThrow(CpmMissingTaskError)
  })

  it('empty input returns empty output', () => {
    const out = computeCpm([], [])
    expect(out.project_finish).toBe(0)
    expect(out.critical_path).toEqual([])
  })
})
