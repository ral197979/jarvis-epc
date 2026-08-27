/**
 * ADR-014 Phase 3B §49 — project-child collections, on three discriminating
 * domains at once.
 *
 * The point is that the two authorization dimensions stay INDEPENDENT after
 * membership exists. Being on a project must not hand you every domain of it,
 * and holding a domain capability must not hand you every project.
 *
 * The three domains are chosen because their holder sets differ:
 *
 *   construction.view   owner, project_manager, engineer, field_ops
 *   engineering.view    owner, project_manager, engineer
 *   cost.view           owner ONLY
 *
 * So a field_ops user on the project reads its RFIs and not its drawings, and
 * nobody but the owner reads its change orders — however complete their
 * membership.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

const mockQuery = vi.fn()
vi.mock('../db/pool', () => ({
  query:       (...a: unknown[]) => mockQuery(...a),
  tenantQuery: (...a: unknown[]) => mockQuery(...a),
  tenantTransaction: async (_t: string, fn: (c: unknown) => unknown) => fn({ query: mockQuery }),
  pool: { query: (...a: unknown[]) => mockQuery(...a), connect: vi.fn() },
}))
vi.mock('../authz/transitionStates', () => ({
  guardTransitionOwnedState: () => (_r: unknown, _s: unknown, next: () => void) => next(),
}))
vi.mock('../services/changeOrders/changeOrderService', () => ({
  listChangeOrders: vi.fn(async () => ({ items: [], total: 0 })),
  createChangeOrder: vi.fn(), getChangeOrder: vi.fn(), updateChangeOrder: vi.fn(),
  approveChangeOrder: vi.fn(), rejectChangeOrder: vi.fn(), submitChangeOrder: vi.fn(),
  changeOrderSummary: vi.fn(async () => ({})),
}))

import type { UserRole } from '../authz/capabilities'

const TENANT_A = 'aaaaaaaa-0000-4000-8000-000000000001'
const MEMBER   = '10000000-0000-4000-8000-00000000000a'
const PROJ_IN  = '30000000-0000-4000-8000-00000000000a'
const PROJ_OUT = '30000000-0000-4000-8000-00000000000b'

interface Caller { id: string; tenantId: string; role: UserRole }
let caller: Caller
const setCaller = (c: Caller) => { caller = c; (globalThis as Record<string, unknown>)['__p3d'] = c }

vi.mock('../auth', () => ({
  requireAuth: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    const c = (globalThis as Record<string, unknown>)['__p3d'] as Caller
    req['auth'] = { sub: c.id, tid: c.tenantId, role: c.role, jti: 'jti' }
    next()
  },
  requireRole: () => (_r: unknown, _s: unknown, next: () => void) => next(),
}))
vi.mock('../middleware/tenant', () => {
  const mw = (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req['tenantId'] = ((globalThis as Record<string, unknown>)['__p3d'] as Caller).tenantId
    next()
  }
  return {
    requireTenant: (...args: unknown[]) =>
      typeof args[2] === 'function'
        ? mw(args[0] as Record<string, unknown>, args[1], args[2] as () => void)
        : mw,
    invalidateTenantCache: () => {},
  }
})

import { drawingsRouter } from '../routes/drawings'
import { inspectionsRouter } from '../routes/inspections'
import { changeOrdersRouter } from '../routes/changeOrders'
import { rfisRouter } from '../routes/procurement'

const makeApp = () => {
  const app = express()
  app.use(express.json())
  app.use('/api/v1', drawingsRouter as never)
  app.use('/api/v1', inspectionsRouter as never)
  app.use('/api/v1', changeOrdersRouter as never)
  app.use('/api/v1/rfis', rfisRouter as never)
  return app
}

const sqlOf = (args: unknown[]): string =>
  (args.find(a => typeof a === 'string' && /\b(SELECT|INSERT|UPDATE|DELETE)\b/i.test(a)) as string) ?? ''

/** Whether the caller's own domain query ran at all. */
const domainReads = (table: RegExp) =>
  mockQuery.mock.calls.map(sqlOf).filter(s => table.test(s))

beforeEach(() => {
  mockQuery.mockReset()
  mockQuery.mockImplementation(async (...args: unknown[]) => {
    const sql = sqlOf(args)
    const params = (args[args.length - 1] ?? []) as unknown[]
    if (/FROM users/i.test(sql) && /is_active/i.test(sql)) {
      return { rows: [{ id: caller.id, tenant_id: caller.tenantId, role: caller.role, is_active: true }] }
    }
    // Record scope: the caller is a member of PROJ_IN only. Honours whether the
    // query actually asks for membership, so removing the predicate widens this.
    if (/SELECT (id|p\.id) FROM projects/i.test(sql)) {
      const boundedByMembership = /FROM project_members m/i.test(sql)
      const ids = (params[0] ?? []) as string[]
      const visible = boundedByMembership ? [PROJ_IN] : [PROJ_IN, PROJ_OUT]
      return { rows: (Array.isArray(ids) ? ids : []).filter(i => visible.includes(i)).map(id => ({ id })) }
    }
    return { rows: [], rowCount: 0 }
  })
  setCaller({ id: MEMBER, tenantId: TENANT_A, role: 'engineer' })
})

const get = (url: string) => request(makeApp()).get(url)

// ─── 1. Record scope, per domain ──────────────────────────────────────────────
describe('a project-child collection needs membership of that project', () => {
  const COLLECTIONS: Array<[string, string, UserRole]> = [
    ['drawings',    `/api/v1/projects/${'PID'}/drawings`,    'engineer'],
    ['inspections', `/api/v1/projects/${'PID'}/inspections`, 'engineer'],
  ]

  it.each(COLLECTIONS)('%s: admitted for a member', async (_n, tpl, role) => {
    setCaller({ id: MEMBER, tenantId: TENANT_A, role })
    expect((await get(tpl.replace('PID', PROJ_IN))).status).toBeLessThan(400)
  })

  it.each(COLLECTIONS)('%s: refused for a non-member, same tenant', async (_n, tpl, role) => {
    setCaller({ id: MEMBER, tenantId: TENANT_A, role })
    expect((await get(tpl.replace('PID', PROJ_OUT))).status).toBe(404)
  })

  it('reads no drawing row for an out-of-scope project', async () => {
    setCaller({ id: MEMBER, tenantId: TENANT_A, role: 'engineer' })
    await get(`/api/v1/projects/${PROJ_OUT}/drawings`)
    expect(domainReads(/FROM\s+drawings/i), 'scope refuses before the domain query').toEqual([])
  })
})

// ─── 2. Functional capability, independently ──────────────────────────────────
describe('membership does not confer the domain capability', () => {
  it('field_ops reads the project’s RFIs — it holds construction.view', async () => {
    setCaller({ id: MEMBER, tenantId: TENANT_A, role: 'field_ops' })
    const res = await get(`/api/v1/rfis?project_id=${PROJ_IN}`)
    expect(res.status).toBeLessThan(400)
  })

  it('field_ops does NOT read the same project’s drawings — no engineering.view', async () => {
    setCaller({ id: MEMBER, tenantId: TENANT_A, role: 'field_ops' })
    const res = await get(`/api/v1/projects/${PROJ_IN}/drawings`)
    expect(res.status, 'membership is not engineering authority').toBe(403)
    expect(domainReads(/FROM\s+drawings/i)).toEqual([])
  })

  it('nobody but the owner reads the project’s change orders — cost.view', async () => {
    for (const role of ['engineer', 'project_manager', 'field_ops', 'procurement', 'viewer'] as UserRole[]) {
      setCaller({ id: MEMBER, tenantId: TENANT_A, role })
      const res = await get(`/api/v1/projects/${PROJ_IN}/change-orders`)
      expect(res.status, `${role} must not read commercial data`).toBe(403)
    }
    setCaller({ id: MEMBER, tenantId: TENANT_A, role: 'owner' })
    expect((await get(`/api/v1/projects/${PROJ_IN}/change-orders`)).status).toBeLessThan(400)
  })

  it('the capability gate runs BEFORE the scope gate, so the two are distinguishable', async () => {
    // A caller lacking the capability is 403 even on a project it cannot reach —
    // the functional dimension answers first and no scope query is issued.
    setCaller({ id: MEMBER, tenantId: TENANT_A, role: 'procurement' })
    const res = await get(`/api/v1/projects/${PROJ_OUT}/drawings`)
    expect(res.status).toBe(403)
    const scopeQueries = mockQuery.mock.calls.map(sqlOf).filter(s => /SELECT (id|p\.id) FROM projects/i.test(s))
    expect(scopeQueries, 'no scope lookup for a caller without the capability').toEqual([])
  })
})

// ─── 3. The owner is tenant-wide but still needs the domain ───────────────────
describe('the owner is tenant-wide, and still bounded by capability', () => {
  it('reaches a project it is not a member of', async () => {
    setCaller({ id: MEMBER, tenantId: TENANT_A, role: 'owner' })
    expect((await get(`/api/v1/projects/${PROJ_OUT}/drawings`)).status).toBeLessThan(400)
  })
})

// ─── 4. Query-filtered collections cannot be widened by the filter (§28) ──────
describe('?project_id is a filter, not the scope', () => {
  it('naming an out-of-scope project returns nothing rather than that project', async () => {
    setCaller({ id: MEMBER, tenantId: TENANT_A, role: 'engineer' })
    const res = await get(`/api/v1/rfis?project_id=${PROJ_OUT}`)
    expect(res.status).toBe(200)
    expect(res.body.data, 'the membership predicate is the outer, mandatory one').toEqual([])
  })

  it('applies the membership predicate even with no project filter at all', async () => {
    setCaller({ id: MEMBER, tenantId: TENANT_A, role: 'engineer' })
    await get('/api/v1/rfis')
    const rfiRead = mockQuery.mock.calls.map(sqlOf).find(s => /FROM rfis r/i.test(s))
    expect(rfiRead, 'the RFI query ran').toBeTruthy()
    expect(rfiRead!, 'and it carried the membership predicate').toMatch(/FROM project_members m/)
  })

  it('issues no membership predicate for a tenant-wide caller', async () => {
    setCaller({ id: MEMBER, tenantId: TENANT_A, role: 'owner' })
    await get('/api/v1/rfis')
    const rfiRead = mockQuery.mock.calls.map(sqlOf).find(s => /FROM rfis r/i.test(s))
    expect(rfiRead!, 'project.list.all suppresses the predicate').not.toMatch(/FROM project_members m/)
  })
})
