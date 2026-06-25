/**
 * Related records — service + route tests (v4.35.0)
 *
 * The service is query-driven; we mock the pool and assert the assembled groups
 * surface only real links and deep-link correctly.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

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

import { getRelated } from '../services/related/relatedService'

describe('getRelated — RFI', () => {
  beforeEach(() => vi.clearAllMocks())

  it('surfaces change orders from the RFI and skips empty groups', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'co1', co_number: 5, title: 'Added scope', status: 'submitted', project_id: 'p1' }] }) // change_orders
      .mockResolvedValueOnce({ rows: [] }) // actions
    const r = await getRelated('t1', 'rfi', 'r1')
    expect(r.groups).toHaveLength(1)
    expect(r.groups[0].key).toBe('changeorders')
    expect(r.groups[0].items[0].source).toBe('changeorder')
    expect(r.groups[0].items[0].tab).toBe('changeorders')
    expect(r.groups[0].items[0].identifier).toBe('CO 5')
  })

  it('returns no groups when nothing is linked', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] })
    const r = await getRelated('t1', 'rfi', 'r1')
    expect(r.groups).toHaveLength(0)
  })
})

describe('getRelated — punch → drawing + actions', () => {
  beforeEach(() => vi.clearAllMocks())

  it('surfaces the referenced drawing and linked actions', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'd1', sheet_number: 'A-101', title: 'Level 1 Plan', project_id: 'p1' }] }) // drawing
      .mockResolvedValueOnce({ rows: [{ id: 'a1', title: 'Fix firestop', status: 'open', project_id: 'p1' }] }) // actions
    const r = await getRelated('t1', 'punch', 'pi1')
    expect(r.groups.map(g => g.key)).toEqual(['drawing', 'actions'])
    expect(r.groups[0].items[0].source).toBe('drawing')
    expect(r.groups[0].items[0].identifier).toBe('A-101')
    expect(r.groups[1].items[0].source).toBe('action')
  })
})

describe('getRelated — submittal same spec section', () => {
  beforeEach(() => vi.clearAllMocks())

  it('groups siblings sharing the spec section', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // actions
      .mockResolvedValueOnce({ rows: [{ spec_section: '03 30 00' }] }) // self spec
      .mockResolvedValueOnce({ rows: [{ id: 's2', submittal_number: 12, title: 'Rebar', status: 'submitted', project_id: 'p1' }] }) // siblings
    const r = await getRelated('t1', 'submittal', 's1')
    expect(r.groups).toHaveLength(1)
    expect(r.groups[0].key).toBe('spec')
    expect(r.groups[0].label).toContain('03 30 00')
    expect(r.groups[0].items[0].identifier).toBe('SUB 12')
  })

  it('omits the spec group when the submittal has no spec section', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })            // actions
      .mockResolvedValueOnce({ rows: [{ spec_section: null }] }) // self spec
    const r = await getRelated('t1', 'submittal', 's1')
    expect(r.groups).toHaveLength(0)
  })
})

// ─── Route smoke test ─────────────────────────────────────────────────────────
import express from 'express'
import request from 'supertest'
import { relatedRouter } from '../routes/related'

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1', relatedRouter as any)
  return app
}

describe('Related route smoke', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects an unknown source with 400', async () => {
    const res = await request(makeApp()).get('/api/v1/related/bogus/x')
    expect(res.status).toBe(400)
  })

  it('GET /related/rfi/:id returns groups', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'co1', co_number: 5, title: 'x', status: 'submitted', project_id: 'p1' }] })
      .mockResolvedValueOnce({ rows: [] })
    const res = await request(makeApp()).get('/api/v1/related/rfi/r1')
    expect(res.status).toBe(200)
    expect(res.body.data.source).toBe('rfi')
    expect(res.body.data.groups.length).toBe(1)
  })
})
