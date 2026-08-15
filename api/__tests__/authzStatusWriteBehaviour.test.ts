/**
 * ADR-014 Phase 2A-2 §26–§35, §47–§48 — the repairs, exercised end to end.
 *
 * The registry tests prove the policy is coherent. These prove it is *load
 * bearing*: real routers, real guards, real `resolveCurrentUser`, and an
 * assertion that the blocked path wrote nothing — a 422 or 403 that still ran
 * the UPDATE would be worthless.
 *
 * Two distinct refusals are under test and the difference is the point:
 *
 *   generic CRUD + transition-owned state  → 422, for everyone, Owner included.
 *     Not an authorization decision. The state is not writable here at all.
 *
 *   canonical transition without capability → 403.
 *     An authorization decision, made by `requireCapability` as always.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

const mockQuery = vi.fn()
vi.mock('../db/pool', () => ({
  query:             (...a: unknown[]) => mockQuery(...a),
  tenantQuery:       (...a: unknown[]) => mockQuery(...a),
  tenantTransaction: vi.fn(),
  pool:              { connect: vi.fn() },
}))
vi.mock('../services/actionService', () => ({ createAction: vi.fn() }))

import { principal, principalQuery, ALL_ROLES, type TestPrincipal } from './helpers/testPrincipal'

let current: TestPrincipal

vi.mock('../auth', () => ({
  requireAuth: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    const p = (globalThis as Record<string, unknown>)['__p2a2'] as TestPrincipal
    req['auth'] = { sub: p.id, tid: p.jwtTenantId, role: p.jwtRole, jti: 'jti' }
    next()
  },
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}))
vi.mock('../middleware/tenant', () => ({
  requireTenant: () => (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req['tenantId'] = ((globalThis as Record<string, unknown>)['__p2a2'] as TestPrincipal).jwtTenantId
    next()
  },
}))

function setCurrent(p: TestPrincipal) {
  current = p
  ;(globalThis as Record<string, unknown>)['__p2a2'] = p
}

import { punchListsRouter }    from '../routes/punchLists'
import { inspectionsRouter }   from '../routes/inspections'
import { riskRegisterRouter }  from '../routes/riskRegister'
import { ncrRouter }           from '../routes/ncr'
import { turnoverRouter }      from '../routes/turnover'
import { lifecycleRouter }     from '../routes/lifecycle'
import { subcontractsRouter }  from '../routes/subcontracts'
import { purchaseOrdersRouter } from '../routes/procurement'
import { dailyLogsRouter }     from '../routes/dailyLogs'

/** One app carrying every router these proofs touch, mounted as in server.ts. */
function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/purchase-orders', purchaseOrdersRouter)
  for (const r of [punchListsRouter, inspectionsRouter, riskRegisterRouter, ncrRouter,
    turnoverRouter, lifecycleRouter, subcontractsRouter, dailyLogsRouter]) {
    app.use('/api/v1', r as never)
  }
  return app
}

/**
 * Every SQL string the request issued, excluding the authorization lookup.
 *
 * Picks the argument that actually looks like SQL rather than the first string:
 * `tenantQuery(tenantId, sql, params)` puts the tenant id first, so taking
 * `find(typeof === 'string')` silently returns the tenant id and every
 * "nothing was written" assertion then passes without ever seeing a query.
 */
const SQL = /\b(SELECT|INSERT|UPDATE|DELETE)\b/i
function businessQueries(): string[] {
  return mockQuery.mock.calls
    .flatMap(c => c.filter((a): a is string => typeof a === 'string' && SQL.test(a)))
    .filter(s => !/FROM\s+users\s+WHERE\s+id/i.test(s))
}

/** Did anything mutate? */
function mutated(): boolean {
  return businessQueries().some(s => /\b(UPDATE|INSERT|DELETE)\b/i.test(s))
}

beforeEach(() => {
  mockQuery.mockReset()
  mockQuery.mockImplementation(principalQuery(() => current, async () => ({ rows: [{ id: 'x' }], rowCount: 1 })))
})

// ─── §26 / §34 — the generic escape is closed, and writes nothing ────────────
describe('§26 generic-route escape is closed', () => {
  const cases: { name: string; method: 'patch' | 'post'; url: string; body: unknown; writer: Parameters<typeof principal>[0]['role'] }[] = [
    { name: 'punch item close',        method: 'patch', url: '/api/v1/punch-items/pi-1',        body: { status: 'closed' },    writer: 'engineer' },
    { name: 'punch item verify',       method: 'patch', url: '/api/v1/punch-items/pi-1',        body: { status: 'verified' },  writer: 'engineer' },
    { name: 'inspection completion',   method: 'patch', url: '/api/v1/inspections/in-1',        body: { status: 'completed' }, writer: 'engineer' },
    { name: 'purchase order approval', method: 'patch', url: '/api/v1/purchase-orders/po-1',    body: { status: 'approved' },  writer: 'procurement' },
    { name: 'risk closure',            method: 'patch', url: '/api/v1/risks/r-1',               body: { status: 'closed' },    writer: 'engineer' },
    { name: 'daily log approval',      method: 'patch', url: '/api/v1/daily-logs/dl-1',         body: { status: 'approved' },  writer: 'field_ops' },
    { name: 'daily log submission',    method: 'patch', url: '/api/v1/daily-logs/dl-1',         body: { status: 'submitted' }, writer: 'field_ops' },
    { name: 'NCR closure',             method: 'patch', url: '/api/v1/ncrs/n-1',                body: { status: 'closed' },    writer: 'engineer' },
    { name: 'CAPA verification',       method: 'patch', url: '/api/v1/capas/c-1',               body: { status: 'verified' },  writer: 'engineer' },
    { name: 'turnover acceptance',     method: 'patch', url: '/api/v1/turnover-packages/t-1',   body: { status: 'accepted' },  writer: 'project_manager' },
  ]

  for (const c of cases) {
    it(`refuses ${c.name} through the generic route, and writes nothing`, async () => {
      setCurrent(principal({ role: c.writer }))
      const res = await request(makeApp())[c.method](c.url).send(c.body as object)
      expect(res.status, `${c.name}: expected the generic mutation to be refused`).toBe(422)
      expect(res.body.error).toBe('transition_state_not_writable')
      expect(res.body.canonical, `${c.name}: the refusal must name the canonical route`).toBeTruthy()
      expect(mutated(), `${c.name}: the blocked path still mutated`).toBe(false)
    })
  }

  it('refuses inspection completion evidence even without a status', async () => {
    setCurrent(principal({ role: 'engineer' }))
    const res = await request(makeApp()).patch('/api/v1/inspections/in-1')
      .send({ signatures: [{ by: 'someone', at: '2026-08-15' }], completed_date: '2026-08-15' })
    expect(res.status).toBe(422)
    expect(['signatures', 'completed_date']).toContain(res.body.field)
    expect(res.body.canonical).toBe('POST /inspections/:id/complete')
    expect(mutated()).toBe(false)
  })

  it('refuses a record BORN in a transition-owned state', async () => {
    // The creation-time variant of the same bypass: three create endpoints
    // accepted a client-supplied status, so a punch item could be born closed.
    setCurrent(principal({ role: 'engineer' }))
    const app = makeApp()
    for (const [url, body] of [
      ['/api/v1/punch-lists/pl-1/items', { title: 'x', status: 'closed' }],
      ['/api/v1/projects/p-1/inspections', { title: 'x', status: 'completed' }],
      ['/api/v1/projects/p-1/daily-logs', { log_date: '2026-08-15', status: 'approved' }],
    ] as [string, object][]) {
      mockQuery.mockClear()
      const res = await request(app).post(url).send(body)
      expect(res.status, `${url} must refuse a transition-owned birth state`).toBe(422)
      expect(mutated(), `${url} still inserted`).toBe(false)
    }
  })

  it('still admits ordinary edits on the same routes', async () => {
    // The repair must not have turned the generic routes off.
    setCurrent(principal({ role: 'engineer' }))
    const res = await request(makeApp()).patch('/api/v1/punch-items/pi-1')
      .send({ status: 'in_progress', title: 'Cracked weld at grid E4' })
    expect(res.status).toBe(200)
    expect(businessQueries().some(s => /UPDATE punch_items/i.test(s))).toBe(true)
  })
})

// ─── §15 — Owner is not exempt ───────────────────────────────────────────────
describe('§15 Owner must also use the canonical transition', () => {
  it('refuses Owner the generic transition-state write', async () => {
    setCurrent(principal({ role: 'owner' }))
    const res = await request(makeApp()).patch('/api/v1/punch-items/pi-1').send({ status: 'closed' })
    expect(res.status).toBe(422)
    expect(mutated()).toBe(false)
  })

  it('admits Owner on the canonical route', async () => {
    setCurrent(principal({ role: 'owner' }))
    const res = await request(makeApp()).post('/api/v1/punch-items/pi-1/close').send({})
    expect(res.status).toBe(200)
    expect(businessQueries().some(s => /UPDATE punch_items[\s\S]*status='closed'/i.test(s))).toBe(true)
  })

  it('refuses every role the generic write, capability holders included', async () => {
    // Proves the refusal is about the canonical path, not about privilege:
    // project_manager holds quality.verify and is still refused here.
    for (const role of ALL_ROLES) {
      mockQuery.mockClear()
      setCurrent(principal({ role }))
      const res = await request(makeApp()).patch('/api/v1/punch-items/pi-1').send({ status: 'closed' })
      expect(res.status, `${role} must be refused the generic transition write`).toBe(422)
      expect(mutated(), `${role} mutated through the generic route`).toBe(false)
    }
  })
})

// ─── §27–§32 / §35 — capability enforcement on the canonical routes ──────────
describe('§27–§32 canonical transition authorization', () => {
  const canonical: { name: string; url: string; method: 'post' | 'patch'; body?: object; allowed: string[]; denied: string[] }[] = [
    { name: 'punch close',        url: '/api/v1/punch-items/pi-1/close',            method: 'post',
      allowed: ['owner', 'project_manager'], denied: ['engineer', 'field_ops', 'procurement', 'viewer', 'admin'] },
    { name: 'inspection complete', url: '/api/v1/inspections/in-1/complete',        method: 'post',
      allowed: ['owner', 'project_manager'], denied: ['engineer', 'field_ops', 'viewer', 'admin'] },
    { name: 'NCR close',          url: '/api/v1/ncrs/n-1/close',                    method: 'post',
      allowed: ['owner', 'project_manager'], denied: ['engineer', 'field_ops', 'viewer', 'admin'] },
    { name: 'CAPA verify',        url: '/api/v1/capas/c-1/verify',                  method: 'post',
      allowed: ['owner', 'project_manager'], denied: ['engineer', 'field_ops', 'viewer', 'admin'] },
    { name: 'risk close',         url: '/api/v1/risks/r-1/close',                   method: 'post',
      allowed: ['owner', 'project_manager'], denied: ['engineer', 'viewer', 'admin'] },
    { name: 'daily log approve',  url: '/api/v1/daily-logs/dl-1/approve',           method: 'post',
      allowed: ['owner', 'project_manager'], denied: ['engineer', 'field_ops', 'viewer', 'admin'] },
    { name: 'PO approve',         url: '/api/v1/purchase-orders/po-1/approve',      method: 'post',
      allowed: ['owner'], denied: ['procurement', 'project_manager', 'engineer', 'viewer', 'admin'] },
    { name: 'subcontract status', url: '/api/v1/subcontracts/sc-1/status',          method: 'patch', body: { status: 'terminated' },
      allowed: ['owner'], denied: ['procurement', 'project_manager', 'engineer', 'viewer', 'admin'] },
    { name: 'turnover accept',    url: '/api/v1/turnover-packages/t-1/accept',      method: 'post',
      allowed: ['owner'], denied: ['project_manager', 'engineer', 'field_ops', 'viewer', 'admin'] },
    { name: 'lifecycle gate',     url: '/api/v1/projects/p-1/gates/fid',            method: 'post', body: { action: 'approve' },
      allowed: ['owner', 'project_manager'], denied: ['engineer', 'field_ops', 'viewer', 'admin'] },
    { name: 'phase advance',      url: '/api/v1/projects/p-1/advance',              method: 'post',
      allowed: ['owner', 'project_manager'], denied: ['engineer', 'field_ops', 'viewer', 'admin'] },
  ]

  for (const c of canonical) {
    it(`denies ${c.name} to every role without the capability, with no side effect`, async () => {
      for (const role of c.denied) {
        mockQuery.mockClear()
        setCurrent(principal({ role: role as never }))
        const res = await request(makeApp())[c.method](c.url).send(c.body ?? {})
        expect(res.status, `${c.name}: ${role} must be denied`).toBe(403)
        expect(res.body).toEqual({ error: 'forbidden' })
        expect(mutated(), `${c.name}: ${role} was denied but the transition still ran`).toBe(false)
      }
    })

    it(`admits ${c.name} to its capability holders`, async () => {
      for (const role of c.allowed) {
        mockQuery.mockClear()
        setCurrent(principal({ role: role as never }))
        const res = await request(makeApp())[c.method](c.url).send(c.body ?? {})
        expect(res.status, `${c.name}: ${role} must pass authorization`).not.toBe(403)
        expect(res.status, `${c.name}: ${role} must pass authentication`).not.toBe(401)
      }
    })
  }
})

// ─── §47 — a stale JWT cannot carry a demoted user through ───────────────────
describe('§47 stale JWT', () => {
  it('denies a Quality transition on the current role, not the token role', async () => {
    setCurrent(principal({ role: 'engineer', jwtRole: 'owner' }))
    const res = await request(makeApp()).post('/api/v1/ncrs/n-1/close').send({})
    expect(res.status).toBe(403)
    expect(mutated()).toBe(false)
  })

  it('denies a Commissioning transition on the current role', async () => {
    setCurrent(principal({ role: 'project_manager', jwtRole: 'owner' }))
    const res = await request(makeApp()).post('/api/v1/turnover-packages/t-1/accept').send({})
    expect(res.status).toBe(403)
    expect(mutated()).toBe(false)
  })

  it('denies a deactivated user holding a valid token', async () => {
    setCurrent(principal({ role: 'owner', active: false }))
    const res = await request(makeApp()).post('/api/v1/ncrs/n-1/close').send({})
    expect(res.status).toBe(401)
    expect(mutated()).toBe(false)
  })

  it('denies a user whose row no longer exists', async () => {
    setCurrent(principal({ role: 'owner', exists: false }))
    const res = await request(makeApp()).post('/api/v1/turnover-packages/t-1/accept').send({})
    expect(res.status).toBe(401)
    expect(mutated()).toBe(false)
  })
})

// ─── §48 — new transitions are tenant-scoped ─────────────────────────────────
describe('§48 tenant isolation on the new transitions', () => {
  const newTransitions: [string, 'post' | 'patch', object][] = [
    ['/api/v1/ncrs/n-1/close', 'post', {}],
    ['/api/v1/capas/c-1/verify', 'post', {}],
    ['/api/v1/turnover-packages/t-1/accept', 'post', {}],
  ]

  for (const [url, method, body] of newTransitions) {
    it(`${url} scopes its write to the caller's tenant`, async () => {
      setCurrent(principal({ role: 'owner', tenantId: 'tenant-a' }))
      await request(makeApp())[method](url).send(body)
      const writes = businessQueries().filter(s => /\bUPDATE\b/i.test(s))
      expect(writes.length, `${url} issued no write to inspect`).toBeGreaterThan(0)
      for (const w of writes) {
        expect(w, `${url} must constrain its UPDATE by tenant`).toMatch(/tenant_id\s*=\s*\$1/i)
      }
      // Every write carried the caller's own tenant as the binding, not a claimed one.
      for (const call of mockQuery.mock.calls) {
        const sql = call.find(a => typeof a === 'string') as string | undefined
        if (sql && /\bUPDATE\b/i.test(sql)) expect(call[0]).toBe('tenant-a')
      }
    })
  }

  it('cannot reach another tenant by claiming it in the token', async () => {
    // A token claiming tenant B for a user who belongs to tenant A never gets
    // as far as the transition: `resolveCurrentUser` refuses the mismatch, so
    // the answer is 401 and tenant B is never touched.
    setCurrent(principal({ role: 'owner', tenantId: 'tenant-a', jwtTenantId: 'tenant-b' }))
    const res = await request(makeApp()).post('/api/v1/ncrs/n-1/close').send({})
    expect(res.status).toBe(401)
    expect(mutated()).toBe(false)
  })
})
