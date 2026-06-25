/**
 * My Work — categorizer + route tests (v4.33.0)
 *
 * The categorizer (`categorizeMyWork`) is pure and deterministic given a fixed
 * `now`, so most coverage is plain unit tests with no DB. A small route smoke
 * test mirrors the mock-pool pattern to confirm the endpoint is wired.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// ─── Mock DB pool (used only by the route smoke test) ─────────────────────────
const mockQuery = vi.fn()
vi.mock('../db/pool', () => ({
  tenantQuery: (tenantId: string, sql: string, params: unknown[]) => mockQuery(tenantId, sql, params),
  query:       (sql: string, params: unknown[]) => mockQuery(null, sql, params),
}))
vi.mock('../auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.auth = { sub: 'u1', tid: 't1' }; next() },
}))
vi.mock('../middleware/tenant', () => ({
  requireTenant: () => (req: any, _res: any, next: any) => { req.tenantId = 'tenant-1'; next() },
}))

import { categorizeMyWork, type MyWorkItem } from '../services/myWork/myWorkService'

const NOW = new Date('2026-06-22T12:00:00Z') // today (UTC) = 2026-06-22

function item(over: Partial<MyWorkItem> = {}): MyWorkItem {
  return {
    key: 'rfi:r1', source: 'rfi', sourceId: 'r1', tab: 'rfis', parentId: null,
    projectId: 'p1', identifier: 'RFI 1', title: 'Something', status: 'open',
    priority: 'high', dueDate: null, kind: 'assigned',
    daysOverdue: 0, overdue: false, upcoming: false,
    ...over,
  }
}

describe('categorizeMyWork — empty', () => {
  it('returns zeroed lanes and counts', () => {
    const r = categorizeMyWork([], NOW)
    expect(r.counts.total).toBe(0)
    expect(r.counts.assigned).toBe(0)
    expect(r.counts.overdue).toBe(0)
    expect(r.lanes.assigned).toHaveLength(0)
    expect(r.generatedAt).toBe(NOW.toISOString())
  })
})

describe('categorizeMyWork — assigned + derived flags', () => {
  it('an overdue assigned item lands in both assigned and overdue with daysOverdue', () => {
    const r = categorizeMyWork([item({ dueDate: '2026-06-12' })], NOW) // 10 days ago
    expect(r.counts.assigned).toBe(1)
    expect(r.lanes.assigned[0].daysOverdue).toBe(10)
    expect(r.lanes.assigned[0].overdue).toBe(true)
    expect(r.lanes.overdue).toHaveLength(1)
    expect(r.lanes.upcoming).toHaveLength(0)
  })

  it('an item due within 7 days is upcoming, not overdue', () => {
    const r = categorizeMyWork([item({ dueDate: '2026-06-25' })], NOW) // +3 days
    expect(r.lanes.upcoming).toHaveLength(1)
    expect(r.lanes.overdue).toHaveLength(0)
    expect(r.lanes.assigned[0].upcoming).toBe(true)
    expect(r.lanes.assigned[0].daysOverdue).toBe(0)
  })

  it('an item due far in the future is neither overdue nor upcoming', () => {
    const r = categorizeMyWork([item({ dueDate: '2026-08-30' })], NOW)
    expect(r.lanes.overdue).toHaveLength(0)
    expect(r.lanes.upcoming).toHaveLength(0)
  })

  it('an undated item appears only in its kind lane', () => {
    const r = categorizeMyWork([item({ dueDate: null })], NOW)
    expect(r.lanes.assigned).toHaveLength(1)
    expect(r.lanes.overdue).toHaveLength(0)
    expect(r.lanes.upcoming).toHaveLength(0)
  })
})

describe('categorizeMyWork — approval + completed lanes', () => {
  it('approval items go to approvals (and overdue if past due)', () => {
    const r = categorizeMyWork([
      item({ key: 'submittal:s1', source: 'submittal', kind: 'approval', dueDate: '2026-06-10' }),
    ], NOW)
    expect(r.counts.approvals).toBe(1)
    expect(r.lanes.approvals).toHaveLength(1)
    expect(r.lanes.overdue).toHaveLength(1)
  })

  it('completed items never count as overdue/upcoming', () => {
    const r = categorizeMyWork([
      item({ key: 'action:a1', source: 'action', kind: 'completed', dueDate: '2026-06-01' }),
    ], NOW)
    expect(r.counts.completedToday).toBe(1)
    expect(r.lanes.overdue).toHaveLength(0)
    expect(r.lanes.upcoming).toHaveLength(0)
  })
})

describe('categorizeMyWork — sorting', () => {
  it('overdue lane is sorted most-overdue first', () => {
    const r = categorizeMyWork([
      item({ key: 'rfi:a', sourceId: 'a', dueDate: '2026-06-20' }), // 2 days
      item({ key: 'rfi:b', sourceId: 'b', dueDate: '2026-06-01' }), // 21 days
      item({ key: 'rfi:c', sourceId: 'c', dueDate: '2026-06-15' }), // 7 days
    ], NOW)
    expect(r.lanes.overdue.map(i => i.sourceId)).toEqual(['b', 'c', 'a'])
  })
})

// ─── Route smoke test ─────────────────────────────────────────────────────────
import express from 'express'
import request from 'supertest'
import { myWorkRouter } from '../routes/myWork'

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1', myWorkRouter as any)
  return app
}

describe('My Work route smoke', () => {
  beforeEach(() => vi.clearAllMocks())

  it('GET /my-work aggregates across modules', async () => {
    // Query order in buildMyWork: rfis, punch, capa, actions, inspections, submittals, changeOrders, doneActions
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'r1', rfi_number: '9', title: 'late RFI', status: 'open', priority: 'high', due_date: '2026-06-01', project_id: 'p1' }] }) // rfis (overdue)
      .mockResolvedValueOnce({ rows: [] }) // punch
      .mockResolvedValueOnce({ rows: [] }) // capa
      .mockResolvedValueOnce({ rows: [] }) // actions
      .mockResolvedValueOnce({ rows: [] }) // inspections
      .mockResolvedValueOnce({ rows: [{ id: 's1', submittal_number: '3', title: 'review me', status: 'submitted', due_date: '2026-06-25', project_id: 'p1' }] }) // submittals (approval, upcoming)
      .mockResolvedValueOnce({ rows: [] }) // change orders
      .mockResolvedValueOnce({ rows: [{ id: 'a1', title: 'done task', source_module: 'rfi', source_id: 'x', status: 'completed', project_id: 'p1' }] }) // doneActions
    const res = await request(makeApp()).get('/api/v1/my-work')
    expect(res.status).toBe(200)
    expect(res.body.data.userId).toBe('u1')
    expect(res.body.data.counts.assigned).toBe(1)
    expect(res.body.data.counts.approvals).toBe(1)
    expect(res.body.data.counts.overdue).toBe(1)
    expect(res.body.data.counts.completedToday).toBe(1)
    expect(res.body.data.counts.total).toBe(3)
  })
})
