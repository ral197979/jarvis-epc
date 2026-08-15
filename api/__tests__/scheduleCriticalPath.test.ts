/**
 * Critical-Path Intelligence — explain + what-if tests (v4.56.0)
 *
 * Network (durations): A(5) → B(3) → C(2)  and  A(5) → D(4) → C(2)
 *   path A-B-C = 10 ;  path A-D-C = 11  → critical path is A-D-C (11), B has 1d float.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// ADR-014 Phase 2B-2: Critical-path explain/what-if requires
// `schedule.view` — the engineer is the narrowest holder.
// Authorization re-resolves that role from the database on every request,
// so the pool answers the lookup for the caller under test.
const CALLER = vi.hoisted(() => ({ id: 'caller', tenant_id: 'tenant-1', role: 'engineer', is_active: true }))

const mockQuery = vi.fn()
vi.mock('../db/pool', () => ({
  tenantQuery: (t: string, sql: string, p: unknown[]) => mockQuery(t, sql, p),
  query:       (sql: string, p: unknown[]) =>
    /FROM\s+users\s+WHERE\s+id/i.test(String(sql))
      ? Promise.resolve({ rows: [CALLER], rowCount: 1 })
      : mockQuery(null, sql, p),
}))
vi.mock('../auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.auth = { sub: 'u1', tid: 'tenant-1', role: 'engineer' }
    next()
  },
}))
vi.mock('../middleware/tenant', () => ({ requireTenant: () => (req: any, _res: any, next: any) => { req.tenantId = 'tenant-1'; next() } }))

import { explainCriticalPath, whatIf, type TaskRow } from '../services/schedule/scheduleCriticalPathService'
import { type CpmDependency } from '../services/cpm'

const TASKS: TaskRow[] = [
  { id: 'A', name: 'Mobilize', duration_days: 5 },
  { id: 'B', name: 'Side work', duration_days: 3 },
  { id: 'C', name: 'Closeout', duration_days: 2 },
  { id: 'D', name: 'Main work', duration_days: 4 },
]
const DEPS: CpmDependency[] = [
  { predecessor_id: 'A', successor_id: 'B', lag_days: 0 },
  { predecessor_id: 'B', successor_id: 'C', lag_days: 0 },
  { predecessor_id: 'A', successor_id: 'D', lag_days: 0 },
  { predecessor_id: 'D', successor_id: 'C', lag_days: 0 },
]

describe('explainCriticalPath', () => {
  it('identifies the zero-float chain and the near-critical task with its buffer', () => {
    const e = explainCriticalPath(TASKS, DEPS)
    expect(e.projectFinish).toBe(11)
    const ids = e.criticalPath.map(s => s.taskId)
    expect(ids).toEqual(expect.arrayContaining(['A', 'D', 'C']))
    expect(ids).not.toContain('B')
    const b = e.nearCritical.find(t => t.taskId === 'B')
    expect(b).toBeTruthy()
    expect(b!.totalFloat).toBe(1)
  })
})

describe('whatIf', () => {
  it('delaying a critical task pushes the finish by the same amount', () => {
    const w = whatIf(TASKS, DEPS, [{ taskId: 'D', deltaDays: 3 }])
    expect(w.baselineFinish).toBe(11)
    expect(w.newFinish).toBe(14)
    expect(w.deltaDays).toBe(3)
  })

  it('delaying a near-critical task within its float does not move the finish', () => {
    const w = whatIf(TASKS, DEPS, [{ taskId: 'B', deltaDays: 1 }])
    expect(w.deltaDays).toBe(0)
    expect(w.newFinish).toBe(11)
  })

  it('delaying a near-critical task beyond its float makes it critical and slips the finish', () => {
    const w = whatIf(TASKS, DEPS, [{ taskId: 'B', deltaDays: 5 }])
    expect(w.newFinish).toBe(15)          // A-B-C now 5+8+2
    expect(w.deltaDays).toBe(4)           // 15 - 11
    expect(w.becameCritical.map(t => t.taskId)).toContain('B')
  })
})

// ─── Route smoke ──────────────────────────────────────────────────────────────
import express from 'express'
import request from 'supertest'
import { scheduleCriticalPathRouter } from '../routes/scheduleCriticalPath'

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/schedule', scheduleCriticalPathRouter as any)
  return app
}

function mockNetwork() {
  mockQuery.mockImplementation(async (_t: string, sql: string) => {
    if (/FROM projects WHERE/.test(sql)) return { rows: [{ id: 'p1' }], rowCount: 1 }
    if (/FROM schedule_dependencies/.test(sql)) return { rows: DEPS }
    if (/FROM schedule_tasks/.test(sql)) return { rows: TASKS }
    return { rows: [] }
  })
}

describe('Critical-path routes', () => {
  beforeEach(() => vi.clearAllMocks())

  it('GET /:id/critical-path returns the chain', async () => {
    mockNetwork()
    const res = await request(makeApp()).get('/api/v1/schedule/p1/critical-path')
    expect(res.status).toBe(200)
    expect(res.body.data.projectFinish).toBe(11)
  })

  it('POST /:id/what-if recomputes', async () => {
    mockNetwork()
    const res = await request(makeApp()).post('/api/v1/schedule/p1/what-if').send({ changes: [{ taskId: 'D', deltaDays: 3 }] })
    expect(res.status).toBe(200)
    expect(res.body.data.deltaDays).toBe(3)
  })

  it('POST /:id/what-if validates the changes array', async () => {
    const res = await request(makeApp()).post('/api/v1/schedule/p1/what-if').send({ changes: [] })
    expect(res.status).toBe(400)
  })

  it('404s for an unknown project', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 })
    const res = await request(makeApp()).get('/api/v1/schedule/nope/critical-path')
    expect(res.status).toBe(404)
  })
})
