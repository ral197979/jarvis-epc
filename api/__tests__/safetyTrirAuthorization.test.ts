/**
 * TRIR — authorization, tenant isolation, and the shape of what is written.
 *
 * Exercised through the real router so the guards under test are the ones the
 * application mounts. Three properties:
 *
 *   1. the numerator of a TENANT rate is restricted to projects the caller can
 *      actually reach — an aggregate is a disclosure surface, and a rate built
 *      from projects someone cannot open still tells them about those projects;
 *   2. a recordability determination is an explicit boolean, never coerced from
 *      a string, a number, or a null;
 *   3. exposure hours cannot be written without a stated source, and cannot be
 *      double-counted by overlapping periods.
 *
 * Fixture:
 *   Tenant A   OWNER_A  (owner)     → tenant-wide by project.list.all
 *              PM_A     (project_manager) → member of PROJECT_A only
 *              FIELD_A  (field_ops) → member of PROJECT_A only
 *   Tenant B   PM_B     (project_manager) → PROJECT_C
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

const mockQuery = vi.fn()
vi.mock('../db/pool', () => ({
  query:             (...a: unknown[]) => mockQuery(...a),
  tenantQuery:       (...a: unknown[]) => mockQuery(...a),
  tenantTransaction: async (_t: string, fn: (c: unknown) => unknown) => fn({ query: mockQuery }),
  pool:              { query: (...a: unknown[]) => mockQuery(...a), connect: vi.fn() },
}))

import type { UserRole } from '../authz/capabilities'

const TENANT_A  = 'aaaaaaaa-0000-4000-8000-000000000001'
const TENANT_B  = 'bbbbbbbb-0000-4000-8000-000000000002'
const OWNER_A   = '10000000-0000-4000-8000-0000000000a1'
const PM_A      = '10000000-0000-4000-8000-0000000000a2'
const FIELD_A   = '10000000-0000-4000-8000-0000000000a3'
const PROJECT_A = '30000000-0000-4000-8000-00000000000a'
const PROJECT_B = '30000000-0000-4000-8000-00000000000b'
const INCIDENT  = '50000000-0000-4000-8000-00000000000a'

interface Caller { id: string; tenantId: string; role: UserRole }
let caller: Caller
const setCaller = (c: Caller): void => { caller = c; (globalThis as Record<string, unknown>)['__trir'] = c }

let MEMBERS: { projectId: string; userId: string; active: boolean }[]

vi.mock('../auth', () => ({
  requireAuth: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    const c = (globalThis as Record<string, unknown>)['__trir'] as Caller
    req['auth'] = { sub: c.id, tid: c.tenantId, role: c.role, jti: 'jti' }
    next()
  },
  requireRole: () => (_r: unknown, _s: unknown, n: () => void) => n(),
}))
vi.mock('../middleware/tenant', () => ({
  requireTenant: () => (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req['tenantId'] = ((globalThis as Record<string, unknown>)['__trir'] as Caller).tenantId
    next()
  },
}))

import { requireAuth } from '../auth'
import { requireTenant } from '../middleware/tenant'
import { safetyRouter } from '../routes/safety'

const app = (() => {
  const a = express()
  a.use(express.json())
  a.use('/api/v1', requireAuth as never, requireTenant() as never, safetyRouter as never)
  return a
})()

const SQLRE = /\b(SELECT|INSERT|UPDATE|DELETE)\b/i
const sqlOf = (a: unknown[]): string => a.find((x): x is string => typeof x === 'string' && SQLRE.test(x)) ?? ''
const paramsOf = (a: unknown[]): unknown[] => (a.find(x => Array.isArray(x)) as unknown[] | undefined) ?? []
const statements = (): string[] => mockQuery.mock.calls.map(c => sqlOf(c)).filter(Boolean)
const wrote = (): boolean => statements().some(s => /\b(INSERT|UPDATE|DELETE)\b/i.test(s))

beforeEach(() => {
  MEMBERS = [
    { projectId: PROJECT_A, userId: PM_A,    active: true },
    { projectId: PROJECT_A, userId: FIELD_A, active: true },
  ]
  setCaller({ id: OWNER_A, tenantId: TENANT_A, role: 'owner' })

  mockQuery.mockReset()
  mockQuery.mockImplementation(async (...args: unknown[]) => {
    const sql = sqlOf(args)
    const params = paramsOf(args)
    const empty = { rows: [], rowCount: 0 }

    if (/FROM\s+users\s+WHERE\s+id/i.test(sql)) {
      return { rows: [{ id: caller.id, tenant_id: caller.tenantId, role: caller.role, is_active: true }], rowCount: 1 }
    }
    // resolveProjectScope / filterAccessibleProjectIds
    if (/FROM projects/i.test(sql)) {
      const wantsMembership = /project_members/i.test(sql)
      const honoursTenant   = /tenant_id = current_setting/i.test(sql)
      if (honoursTenant && caller.tenantId !== TENANT_A) return empty
      const all = [PROJECT_A, PROJECT_B]
      const candidates = Array.isArray(params[0]) ? params[0] as string[] : all
      const visible = candidates.filter(id =>
        !wantsMembership || MEMBERS.some(m => m.projectId === id && m.userId === caller.id && m.active))
      return { rows: visible.map(id => ({ id })), rowCount: visible.length }
    }
    // record scope projection for safety_incidents
    if (/FROM safety_incidents r/i.test(sql) || /AS\s+project_id/i.test(sql)) {
      return { rows: [{ project_id: PROJECT_A }], rowCount: 1 }
    }
    if (/FROM safety_incidents/i.test(sql)) {
      return { rows: [{ total: '0', recordable: '0', unclassified: '0' }], rowCount: 1 }
    }
    if (/FROM safety_exposure_hours/i.test(sql)) return empty
    if (/INSERT INTO safety_exposure_hours/i.test(sql)) return { rows: [{ id: 'x' }], rowCount: 1 }
    if (/UPDATE safety_incidents/i.test(sql)) {
      return { rows: [{ id: INCIDENT, recordable: params[2], recordable_classified_at: '2026-08-24T00:00:00Z' }], rowCount: 1 }
    }
    return empty
  })
})

// ─── 1. The tenant rate discloses only reachable projects ────────────────────

describe('a tenant-wide rate is built only from projects the caller can reach', () => {
  it('restricts the numerator to the caller project set', async () => {
    setCaller({ id: PM_A, tenantId: TENANT_A, role: 'project_manager' })
    const res = await request(app).get('/api/v1/safety/trir?period_start=2026-01-01&period_end=2026-12-31')
    expect(res.status).toBe(200)
    const counts = mockQuery.mock.calls.find(c => /FROM safety_incidents/i.test(sqlOf(c)) && /FILTER/i.test(sqlOf(c)))
    expect(counts, 'the numerator query must run').toBeDefined()
    expect(sqlOf(counts!), 'numerator must be restricted by project').toMatch(/project_id = ANY/)
    // PROJECT_B is in the tenant but the caller is not a member.
    const bound = paramsOf(counts!).find(p => Array.isArray(p)) as string[]
    expect(bound).toEqual([PROJECT_A])
  })

  it('does not restrict for an Owner, who reaches the whole tenant', async () => {
    setCaller({ id: OWNER_A, tenantId: TENANT_A, role: 'owner' })
    await request(app).get('/api/v1/safety/trir?period_start=2026-01-01&period_end=2026-12-31')
    const counts = mockQuery.mock.calls.find(c => /FILTER/i.test(sqlOf(c)))!
    expect(sqlOf(counts)).not.toMatch(/project_id = ANY/)
  })

  it('restricts to an EMPTY set for a caller with no memberships', async () => {
    // The dangerous bug this guards: an empty project set must not be treated
    // as "unrestricted". `[]` and `null` mean opposite things here.
    MEMBERS = []
    setCaller({ id: PM_A, tenantId: TENANT_A, role: 'project_manager' })
    await request(app).get('/api/v1/safety/trir?period_start=2026-01-01&period_end=2026-12-31')
    const counts = mockQuery.mock.calls.find(c => /FILTER/i.test(sqlOf(c)))!
    expect(sqlOf(counts)).toMatch(/project_id = ANY/)
    expect(paramsOf(counts).find(p => Array.isArray(p))).toEqual([])
  })

  it('refuses a caller without safety.view', async () => {
    setCaller({ id: PM_A, tenantId: TENANT_A, role: 'engineer' })   // holds no safety.view
    const res = await request(app).get('/api/v1/safety/trir?period_start=2026-01-01&period_end=2026-12-31')
    expect(res.status).toBe(403)
  })
})

// ─── 2. Project-scoped routes refuse an unreachable project ──────────────────

describe('the project rate is behind project scope', () => {
  it('admits a member of the project', async () => {
    setCaller({ id: PM_A, tenantId: TENANT_A, role: 'project_manager' })
    const res = await request(app).get(`/api/v1/projects/${PROJECT_A}/safety/trir?period_start=2026-01-01&period_end=2026-12-31`)
    expect(res.status).toBe(200)
  })

  it('refuses a project the caller is not a member of', async () => {
    setCaller({ id: PM_A, tenantId: TENANT_A, role: 'project_manager' })
    const res = await request(app).get(`/api/v1/projects/${PROJECT_B}/safety/trir?period_start=2026-01-01&period_end=2026-12-31`)
    expect(res.status).toBe(404)
  })

  it('refuses a caller from another tenant', async () => {
    setCaller({ id: PM_A, tenantId: TENANT_B, role: 'project_manager' })
    const res = await request(app).get(`/api/v1/projects/${PROJECT_A}/safety/trir?period_start=2026-01-01&period_end=2026-12-31`)
    expect(res.status).toBe(404)
  })
})

// ─── 3. Classification is explicit, never coerced ────────────────────────────

describe('a recordability determination must be an explicit boolean', () => {
  it('accepts true and records it', async () => {
    const res = await request(app).patch(`/api/v1/safety/incidents/${INCIDENT}/recordable`)
      .send({ recordable: true, basis: 'Medical treatment beyond first aid' })
    expect(res.status).toBe(200)
    const upd = mockQuery.mock.calls.find(c => /UPDATE safety_incidents/i.test(sqlOf(c)))!
    expect(sqlOf(upd)).toMatch(/recordable_classified_at\s*=\s*NOW\(\)/)
    expect(sqlOf(upd)).toMatch(/recordable_classified_by/)
  })

  it('accepts false, which is a determination and not an absence', async () => {
    const res = await request(app).patch(`/api/v1/safety/incidents/${INCIDENT}/recordable`).send({ recordable: false })
    expect(res.status).toBe(200)
  })

  it.each([
    ['a string', 'true'], ['a number', 1], ['zero', 0], ['null', null], ['missing', undefined],
  ])('refuses %s rather than coercing it', async (_label, value) => {
    mockQuery.mockClear()
    const res = await request(app).patch(`/api/v1/safety/incidents/${INCIDENT}/recordable`)
      .send(value === undefined ? {} : { recordable: value })
    expect(res.status).toBe(400)
    expect(wrote(), 'a refused determination must write nothing').toBe(false)
  })

  it('refuses a caller without safety.write', async () => {
    setCaller({ id: PM_A, tenantId: TENANT_A, role: 'viewer' })
    const res = await request(app).patch(`/api/v1/safety/incidents/${INCIDENT}/recordable`).send({ recordable: true })
    expect(res.status).toBe(403)
    expect(wrote()).toBe(false)
  })
})

// ─── 4. Exposure hours must be auditable ─────────────────────────────────────

describe('exposure hours cannot be written without a basis', () => {
  const url = `/api/v1/projects/${PROJECT_A}/safety/exposure-hours`
  const good = { period_start: '2026-01-01', period_end: '2026-03-31', hours: 50000, source: 'Payroll export Q1' }

  it('accepts a well-formed record', async () => {
    setCaller({ id: FIELD_A, tenantId: TENANT_A, role: 'field_ops' })
    const res = await request(app).post(url).send(good)
    expect(res.status).toBe(201)
  })

  it('refuses hours with no stated source', async () => {
    const res = await request(app).post(url).send({ ...good, source: '' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('source_required')
    expect(wrote()).toBe(false)
  })

  it('refuses negative hours', async () => {
    const res = await request(app).post(url).send({ ...good, hours: -1 })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('invalid_hours')
  })

  it('refuses a non-numeric hours value rather than coercing it to zero', async () => {
    const res = await request(app).post(url).send({ ...good, hours: 'lots' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('invalid_hours')
  })

  it('refuses a reversed period', async () => {
    const res = await request(app).post(url).send({ ...good, period_start: '2026-03-31', period_end: '2026-01-01' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('invalid_period')
  })

  it('refuses a period that overlaps an existing record', async () => {
    // Two records over the same days would both be summed into the denominator,
    // inflating hours and understating the rate.
    mockQuery.mockImplementation(async (...args: unknown[]) => {
      const sql = sqlOf(args)
      if (/FROM\s+users\s+WHERE\s+id/i.test(sql)) return { rows: [{ id: caller.id, tenant_id: caller.tenantId, role: caller.role, is_active: true }], rowCount: 1 }
      if (/FROM projects/i.test(sql)) return { rows: [{ id: PROJECT_A }], rowCount: 1 }
      if (/FROM safety_exposure_hours/i.test(sql)) return { rows: [{ id: 'existing-row' }], rowCount: 1 }
      return { rows: [], rowCount: 0 }
    })
    const res = await request(app).post(url).send(good)
    expect(res.status).toBe(409)
    expect(res.body.error).toBe('overlapping_period')
    expect(res.body.conflictsWith).toBe('existing-row')
    expect(wrote()).toBe(false)
  })

  it('refuses a project the caller cannot reach', async () => {
    setCaller({ id: FIELD_A, tenantId: TENANT_A, role: 'field_ops' })
    const res = await request(app).post(`/api/v1/projects/${PROJECT_B}/safety/exposure-hours`).send(good)
    expect(res.status).toBe(404)
    expect(wrote()).toBe(false)
  })

  it('holds TENANT-wide hours at approve level, since they denominate the published rate', async () => {
    setCaller({ id: FIELD_A, tenantId: TENANT_A, role: 'field_ops' })   // has safety.write, not approve
    const res = await request(app).post('/api/v1/safety/exposure-hours').send(good)
    expect(res.status).toBe(403)
    expect(wrote()).toBe(false)

    setCaller({ id: OWNER_A, tenantId: TENANT_A, role: 'owner' })
    expect((await request(app).post('/api/v1/safety/exposure-hours').send(good)).status).toBe(201)
  })
})
