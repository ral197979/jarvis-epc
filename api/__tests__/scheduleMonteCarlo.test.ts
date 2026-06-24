/**
 * Schedule Monte Carlo + recovery — simulation + route tests (v4.50.0)
 *
 * Uses a seeded RNG so the simulation is fully deterministic and asserts exact
 * structural invariants (P50 ≤ P90, criticality, recovery saves days).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const mockQuery = vi.fn()
vi.mock('../db/pool', () => ({
  tenantQuery: (t: string, sql: string, p: unknown[]) => mockQuery(t, sql, p),
  query:       (sql: string, p: unknown[]) => mockQuery(null, sql, p),
}))
vi.mock('../auth', () => ({ requireAuth: (req: any, _res: any, next: any) => { req.auth = { sub: 'u1' }; next() } }))
vi.mock('../middleware/tenant', () => ({ requireTenant: () => (req: any, _res: any, next: any) => { req.tenantId = 'tenant-1'; next() } }))

import { simulateSchedule, recoveryPlan, type SchedTask } from '../services/schedule/scheduleMonteCarloService'
import type { CpmDependency } from '../services/cpm'

// Deterministic PRNG (mulberry32)
function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// A → B → C chain: 10 + 20 + 5 = 35 days, all critical
const TASKS: SchedTask[] = [
  { id: 'A', name: 'Excavate', duration_days: 10 },
  { id: 'B', name: 'Foundation', duration_days: 20 },
  { id: 'C', name: 'Slab', duration_days: 5 },
]
const DEPS: CpmDependency[] = [
  { predecessor_id: 'A', successor_id: 'B', lag_days: 0 },
  { predecessor_id: 'B', successor_id: 'C', lag_days: 0 },
]

describe('simulateSchedule', () => {
  it('produces an ordered completion distribution around the deterministic finish', () => {
    const f = simulateSchedule(TASKS, DEPS, { iterations: 500, targetDays: 38 }, mulberry32(42))
    expect(f.deterministicFinish).toBe(35)
    expect(f.iterations).toBe(500)
    expect(f.p10).toBeLessThanOrEqual(f.p50)
    expect(f.p50).toBeLessThanOrEqual(f.p80)
    expect(f.p80).toBeLessThanOrEqual(f.p90)
    // Optimistic 0.85 → pessimistic 1.30 means the mean sits a little above 35.
    expect(f.mean).toBeGreaterThan(33)
    expect(f.mean).toBeLessThan(40)
  })

  it('reports probability of hitting a target date', () => {
    const f = simulateSchedule(TASKS, DEPS, { iterations: 500, targetDays: 35 }, mulberry32(7))
    expect(f.probabilityOnTarget).not.toBeNull()
    expect(f.probabilityOnTarget!).toBeGreaterThan(0)
    expect(f.probabilityOnTarget!).toBeLessThanOrEqual(1)
  })

  it('marks the chain tasks as critical', () => {
    const f = simulateSchedule(TASKS, DEPS, { iterations: 200 }, mulberry32(1))
    // Single path → all three tasks are (near-)always on the critical path.
    expect(f.criticality.map(c => c.taskId).sort()).toEqual(['A', 'B', 'C'])
    expect(f.criticality.every(c => c.index >= 0.9)).toBe(true)
    // Deterministic baseline (integer durations) → exact critical path, zero float.
    expect(f.criticalPath.map(s => s.taskId)).toEqual(['A', 'B', 'C'])
    expect(f.criticalPath.every(s => s.totalFloat === 0)).toBe(true)
  })
})

describe('recoveryPlan', () => {
  it('recommends crashing the longest critical task for the most days saved', () => {
    const crit = [
      { taskId: 'A', name: 'Excavate', index: 1 },
      { taskId: 'B', name: 'Foundation', index: 1 },
      { taskId: 'C', name: 'Slab', index: 1 },
    ]
    const plan = recoveryPlan(TASKS, DEPS, crit, 35)
    expect(plan.length).toBeGreaterThan(0)
    // Crashing B (20d) saves the most (6d at 30%)
    expect(plan[0].taskId).toBe('B')
    expect(plan[0].daysSaved).toBeCloseTo(6, 1)
  })
})

// ─── Route smoke ──────────────────────────────────────────────────────────────
import express from 'express'
import request from 'supertest'
import { scheduleForecastRouter } from '../routes/scheduleForecast'

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/schedule', scheduleForecastRouter as any)
  return app
}

describe('Schedule forecast route', () => {
  beforeEach(() => vi.clearAllMocks())

  it('GET /:id/forecast returns the forecast', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'p1' }], rowCount: 1 })  // project
      .mockResolvedValueOnce({ rows: TASKS.map(t => ({ id: t.id, name: t.name, duration_days: t.duration_days })) }) // tasks
      .mockResolvedValueOnce({ rows: DEPS.map(d => ({ ...d })) })   // deps
    const res = await request(makeApp()).get('/api/v1/schedule/p1/forecast?iterations=200&target=40')
    expect(res.status).toBe(200)
    expect(res.body.data.deterministicFinish).toBe(35)
    expect(res.body.data.recovery.length).toBeGreaterThan(0)
  })

  it('422 when the project has no schedule tasks', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'p1' }], rowCount: 1 }) // project
      .mockResolvedValueOnce({ rows: [] }) // tasks
      .mockResolvedValueOnce({ rows: [] }) // deps
    const res = await request(makeApp()).get('/api/v1/schedule/p1/forecast')
    expect(res.status).toBe(422)
  })

  it('404 for an unknown project', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 })
    const res = await request(makeApp()).get('/api/v1/schedule/nope/forecast')
    expect(res.status).toBe(404)
  })
})
