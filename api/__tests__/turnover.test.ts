/**
 * Turnover packages — pure helpers + route tests (v4.38.0)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// ADR-014 Phase 2C-1: turnover packages are the docs domain, so the routes now
// require docs.write, resolved from the database rather than the token.
const AUTHZ_USER = { id: 'u1', tenant_id: 't1', role: 'project_manager', is_active: true }
const isCurrentUserLookup = (sql: string) => /FROM\s+users\s+WHERE\s+id/i.test(sql)

const mockQuery = vi.fn()
vi.mock('../db/pool', () => ({
  tenantQuery: (tenantId: string, sql: string, params: unknown[]) => mockQuery(tenantId, sql, params),
  query:       (sql: string, params: unknown[]) =>
    isCurrentUserLookup(sql)
      ? Promise.resolve({ rows: [AUTHZ_USER], rowCount: 1 })
      : mockQuery(null, sql, params),
}))
vi.mock('../auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.auth = { sub: 'u1', tid: 't1' }; next() },
}))
vi.mock('../middleware/tenant', () => ({
  requireTenant: () => (req: any, _res: any, next: any) => { req.tenantId = 'tenant-1'; next() },
}))

import { computeCompleteness, nextHandoffStatus, decorate, isValidStatus } from '../services/turnover/turnoverService'

describe('computeCompleteness', () => {
  it('counts only checked deliverables', () => {
    expect(computeCompleteness({})).toEqual({ done: 0, total: 5, pct: 0 })
    expect(computeCompleteness({ as_built: true, om_manuals: true })).toMatchObject({ done: 2, pct: 40 })
    expect(computeCompleteness({ as_built: true, om_manuals: true, warranties: true, test_records: true, punch_signoff: true }).pct).toBe(100)
  })
  it('ignores non-true values', () => {
    expect(computeCompleteness({ as_built: 'yes', om_manuals: 1, warranties: false }).done).toBe(0)
  })
})

describe('nextHandoffStatus', () => {
  it('walks the chain and stops at accepted', () => {
    expect(nextHandoffStatus('open')).toBe('ready_for_commissioning')
    expect(nextHandoffStatus('in_commissioning')).toBe('ready_for_turnover')
    expect(nextHandoffStatus('accepted')).toBeNull()
    expect(nextHandoffStatus('bogus')).toBeNull()
  })
})

describe('decorate', () => {
  const base = {
    id: 'tp1', project_id: 'p1', name: 'AHU-1', area: 'Mech', status: 'open',
    deliverables: {}, commissioning_url: null, commissioning_status: null, owner_id: null, notes: null,
  }
  it('gates the first hop (open → ready) on 100% completeness', () => {
    expect(decorate({ ...base }).canAdvance).toBe(false)
    const full = { as_built: true, om_manuals: true, warranties: true, test_records: true, punch_signoff: true }
    expect(decorate({ ...base, deliverables: full }).canAdvance).toBe(true)
  })
  it('allows later hops regardless of the checklist (commissioning is external)', () => {
    expect(decorate({ ...base, status: 'in_commissioning' }).canAdvance).toBe(true)
    expect(decorate({ ...base, status: 'accepted' }).canAdvance).toBe(false) // end of chain
  })
})

describe('isValidStatus', () => {
  it('accepts chain statuses and rejects others', () => {
    expect(isValidStatus('ready_for_turnover')).toBe(true)
    expect(isValidStatus('nope')).toBe(false)
  })
})

// ─── Route smoke test ─────────────────────────────────────────────────────────
import express from 'express'
import request from 'supertest'
import { turnoverRouter } from '../routes/turnover'

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1', turnoverRouter as any)
  return app
}

describe('Turnover route smoke', () => {
  beforeEach(() => vi.clearAllMocks())

  it('POST requires a name', async () => {
    const res = await request(makeApp()).post('/api/v1/projects/p1/turnover-packages').send({})
    expect(res.status).toBe(400)
  })

  it('POST creates a package and returns derived completeness', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{
      id: 'tp1', project_id: 'p1', name: 'AHU-1', area: 'Mech', status: 'open',
      deliverables: {}, commissioning_url: null, commissioning_status: null, owner_id: null, notes: null,
    }] })
    const res = await request(makeApp()).post('/api/v1/projects/p1/turnover-packages').send({ name: 'AHU-1', area: 'Mech' })
    expect(res.status).toBe(201)
    expect(res.body.data.completeness.pct).toBe(0)
    expect(res.body.data.nextStatus).toBe('ready_for_commissioning')
    expect(res.body.data.canAdvance).toBe(false)
  })

  it('PATCH rejects an invalid status', async () => {
    const res = await request(makeApp()).patch('/api/v1/turnover-packages/tp1').send({ status: 'bogus' })
    expect(res.status).toBe(400)
  })
})
