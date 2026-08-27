/**
 * ADR-014 Phase 2C-2A §12–§15, §19 — the owner-policy closures, exercised.
 *
 * Real routers, real `resolveCurrentUser`, real `requireCapability`, real SCIM
 * middleware. Every refusal additionally asserts that the business mutation never
 * ran: a 403 returned after the side effect is a failed implementation.
 *
 *   D3  credit issuance          -> platform.admin
 *   D4  project hard delete      -> project.delete, owner alone
 *   D5  /iot/ingest              -> verified service token OR platform.integrations
 *   D6  /sensors/:uid/readings   -> the same
 *   D7  SCIM                     -> may never assign `owner`
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

const mockQuery = vi.fn()
vi.mock('../db/pool', () => ({
  query:             (...a: unknown[]) => mockQuery(...a),
  tenantQuery:       (...a: unknown[]) => mockQuery(...a),
  tenantTransaction: async (_t: string, fn: (c: unknown) => unknown) =>
    fn({ query: (...a: unknown[]) => mockQuery(...a) }),
  pool:              { query: (...a: unknown[]) => mockQuery(...a), connect: vi.fn() },
}))
vi.mock('../services/actionService', () => ({ createAction: vi.fn() }))

import { principal, principalQuery, ALL_ROLES, type TestPrincipal } from './helpers/testPrincipal'
import { roleHasCapability, type UserRole } from '../authz/capabilities'

let current: TestPrincipal
let unauthenticated = false

vi.mock('../auth', () => ({
  requireAuth: (req: Record<string, unknown>, res: Record<string, unknown>, next: () => void) => {
    const g = globalThis as Record<string, unknown>
    if (g['__p2c2a_unauth']) {
      ;(res as unknown as { status: (n: number) => { json: (b: unknown) => void } })
        .status(401).json({ error: 'unauthenticated' })
      return
    }
    const p = g['__p2c2a'] as TestPrincipal
    req['auth'] = { sub: p.id, tid: p.jwtTenantId, role: p.jwtRole, jti: 'jti' }
    next()
  },
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}))
vi.mock('../middleware/tenant', () => {
  const mw = (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req['tenantId'] = ((globalThis as Record<string, unknown>)['__p2c2a'] as TestPrincipal).jwtTenantId
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

function setCurrent(p: TestPrincipal) {
  current = p
  ;(globalThis as Record<string, unknown>)['__p2c2a'] = p
  ;(globalThis as Record<string, unknown>)['__p2c2a_unauth'] = unauthenticated
}

import projectsRouter      from '../routes/projects'
import commissioningRouter from '../routes/commissioning'
import { iotRouter }       from '../routes/iot'
import { scimRouter }      from '../routes/scim'

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/projects', projectsRouter as never)
  app.use('/api/v1/commissioning', commissioningRouter as never)
  app.use('/api/v1', iotRouter as never)
  app.use('/scim/v2', scimRouter as never)
  return app
}

const SQL = /\b(SELECT|INSERT|UPDATE|DELETE)\b/i
const businessQueries = () => mockQuery.mock.calls
  .flatMap(c => c.filter((a): a is string => typeof a === 'string' && SQL.test(a)))
  .filter(s => !/FROM\s+users\s+WHERE\s+id/i.test(s))
const mutated = () => businessQueries().some(s => /\b(INSERT|UPDATE|DELETE)\b/i.test(s))
/** Writes that are not the SCIM token's own last_used_at bookkeeping. */
const businessMutations = () => businessQueries()
  .filter(s => /\b(INSERT|UPDATE|DELETE)\b/i.test(s))
  .filter(s => !/UPDATE\s+scim_tokens\s+SET\s+last_used_at/i.test(s))
  .filter(s => !/UPDATE\s+sensor_ingest_tokens/i.test(s))

beforeEach(() => {
  unauthenticated = false
  mockQuery.mockReset()
  mockQuery.mockImplementation(principalQuery(() => current, async () => ({
    rows: [{ id: 'x', status: 'draft', tenant_id: 'tenant-under-test' }], rowCount: 1,
  })))
})

// ══ D3 · commissioning credits ════════════════════════════════════════════════
describe('D3 POST /api/v1/commissioning/credits requires platform.admin', () => {
  const url  = '/api/v1/commissioning/credits'
  const body = { delta: 100, reason: 'goodwill' }
  const post = () => request(makeApp()).post(url).send(body)

  const creditWrite = () => businessQueries().some(s => /INSERT INTO billing_credits/i.test(s))

  it('refuses an unauthenticated caller and issues no credit', async () => {
    unauthenticated = true
    setCurrent(principal({ role: 'owner' }))
    expect((await post()).status).toBe(401)
    expect(creditWrite()).toBe(false)
  })

  it('refuses every role without platform.admin, and issues no credit', async () => {
    for (const role of ALL_ROLES.filter(r => !roleHasCapability(r, 'platform.admin'))) {
      mockQuery.mockClear()
      setCurrent(principal({ role: role as UserRole }))
      const res = await post()
      expect(res.status, `${role} reached credit issuance`).toBe(403)
      expect(res.body).toEqual({ error: 'forbidden' })
      expect(creditWrite(), `${role} was denied but a credit was still written`).toBe(false)
    }
  })

  it('refuses the viewer specifically', async () => {
    setCurrent(principal({ role: 'viewer' }))
    expect((await post()).status).toBe(403)
    expect(creditWrite()).toBe(false)
  })

  it('admits owner and admin — the legacy holder set, preserved', async () => {
    for (const role of ['owner', 'admin'] as const) {
      mockQuery.mockClear()
      setCurrent(principal({ role }))
      const res = await post()
      expect(res.status, `${role} was refused`).not.toBe(403)
      expect(res.status).not.toBe(401)
    }
  })

  it('refuses a deactivated holder', async () => {
    setCurrent(principal({ role: 'owner', active: false }))
    expect((await post()).status).toBe(401)
    expect(creditWrite()).toBe(false)
  })

  it('refuses a token claiming another tenant, before any write', async () => {
    setCurrent(principal({ role: 'owner', tenantId: 'tenant-a', jwtTenantId: 'tenant-b' }))
    expect((await post()).status).toBe(401)
    expect(creditWrite()).toBe(false)
  })

  it('refuses a stale owner token whose live role is viewer', async () => {
    setCurrent(principal({ role: 'viewer', jwtRole: 'owner' }))
    expect((await post()).status).toBe(403)
    expect(creditWrite()).toBe(false)
  })

  it('refuses a stale admin token whose live role is viewer', async () => {
    setCurrent(principal({ role: 'viewer', jwtRole: 'admin' }))
    expect((await post()).status).toBe(403)
    expect(creditWrite()).toBe(false)
  })
})

// ══ D4 · project hard delete ══════════════════════════════════════════════════
describe('D4 DELETE /api/v1/projects/:id requires project.delete', () => {
  const del = () => request(makeApp()).delete('/api/v1/projects/p-1')
  const deleteWrite = () => businessQueries().some(s => /DELETE FROM projects/i.test(s))

  it('admits the owner', async () => {
    setCurrent(principal({ role: 'owner' }))
    const res = await del()
    expect(res.status).not.toBe(403)
    expect(res.status).not.toBe(401)
  })

  it('refuses every other role, and deletes nothing', async () => {
    for (const role of ['admin', 'project_manager', 'engineer', 'procurement', 'field_ops', 'viewer'] as const) {
      mockQuery.mockClear()
      setCurrent(principal({ role }))
      const res = await del()
      expect(res.status, `${role} reached project deletion`).toBe(403)
      expect(res.body).toEqual({ error: 'forbidden' })
      expect(deleteWrite(), `${role} was denied but the project was still deleted`).toBe(false)
      expect(mutated(), `${role} caused a dependent write`).toBe(false)
    }
  })

  it('refuses an unauthenticated caller', async () => {
    unauthenticated = true
    setCurrent(principal({ role: 'owner' }))
    expect((await del()).status).toBe(401)
    expect(deleteWrite()).toBe(false)
  })

  it('refuses a deactivated owner', async () => {
    setCurrent(principal({ role: 'owner', active: false }))
    expect((await del()).status).toBe(401)
    expect(deleteWrite()).toBe(false)
  })

  it('refuses a token claiming another tenant', async () => {
    setCurrent(principal({ role: 'owner', tenantId: 'tenant-a', jwtTenantId: 'tenant-b' }))
    expect((await del()).status).toBe(401)
    expect(deleteWrite()).toBe(false)
  })

  it('refuses a stale owner token whose live role is viewer', async () => {
    setCurrent(principal({ role: 'viewer', jwtRole: 'owner' }))
    expect((await del()).status).toBe(403)
    expect(deleteWrite()).toBe(false)
  })

  it('refuses a stale owner token whose live role is project_manager', async () => {
    // The precise broadening the owner rejected: a PM must not delete projects,
    // and an old owner token must not carry them through either.
    setCurrent(principal({ role: 'project_manager', jwtRole: 'owner' }))
    expect((await del()).status).toBe(403)
    expect(deleteWrite()).toBe(false)
  })
})

// ══ D5 / D6 · hybrid ingest ═══════════════════════════════════════════════════
describe('D5/D6 hybrid ingest — the machine credential path', () => {
  const VALID   = 'a'.repeat(64)
  const INVALID = 'b'.repeat(64)
  const body = [{ sensorUid: 's-1', value: 21.5 }]

  /** Answers the ingest-token lookup for VALID only; everything else is a miss. */
  function tokenAware(tokenTenant = 'tenant-machine') {
    return async (...args: unknown[]): Promise<unknown> => {
      const sql = args.find(a => typeof a === 'string') as string | undefined
      if (sql && /FROM\s+users\s+WHERE\s+id/i.test(sql)) {
        return { rows: [{ id: current.id, tenant_id: current.tenantId, role: current.role, is_active: current.active }], rowCount: 1 }
      }
      if (sql && /UPDATE\s+sensor_ingest_tokens/i.test(sql)) {
        const hashArg = (args[1] as unknown[])?.[0]
        const { createHash } = await import('node:crypto')
        const validHash = createHash('sha256').update(VALID).digest('hex')
        return hashArg === validHash
          ? { rows: [{ tenant_id: tokenTenant, edge_node_id: null }], rowCount: 1 }
          : { rows: [], rowCount: 0 }
      }
      return { rows: [{ id: 'x' }], rowCount: 1 }
    }
  }

  beforeEach(() => {
    setCurrent(principal({ role: 'viewer' }))   // deliberately powerless as a user
    mockQuery.mockImplementation(tokenAware())
  })

  it('admits a valid machine token with no user principal at all', async () => {
    const res = await request(makeApp()).post('/api/v1/iot/ingest')
      .set('Authorization', `Bearer ${VALID}`).send(body)
    expect(res.status, 'a verified machine credential was refused').not.toBe(401)
    expect(res.status).not.toBe(403)
  })

  it('binds the tenant from the verified token row, not from the request', async () => {
    await request(makeApp()).post('/api/v1/iot/ingest?project_id=p-1')
      .set('Authorization', `Bearer ${VALID}`).send(body)
    const ingestCalls = mockQuery.mock.calls.filter(c =>
      typeof c[0] === 'string' && !/^SELECT|^UPDATE|^INSERT|^DELETE/i.test(c[0] as string))
    expect(ingestCalls.length).toBeGreaterThan(0)
    for (const call of ingestCalls) {
      expect(call[0], 'a write was bound to a tenant the token did not authorise').toBe('tenant-machine')
    }
  })

  it('refuses an invalid token-shaped credential WITHOUT falling through to session auth', async () => {
    // The caller's session is a viewer. If the middleware fell through, the
    // request would be judged as that viewer (403). It must be 401 on the
    // credential instead — the mode is decided once and not reconsidered.
    const res = await request(makeApp()).post('/api/v1/iot/ingest')
      .set('Authorization', `Bearer ${INVALID}`).send(body)
    expect(res.status).toBe(401)
    expect(res.body).toEqual({ error: 'Invalid ingest token' })
    expect(businessMutations(), 'an invalid machine credential still ingested').toEqual([])
  })

  it('refuses an invalid token on the single-reading route too', async () => {
    const res = await request(makeApp()).post('/api/v1/sensors/s-1/readings')
      .set('Authorization', `Bearer ${INVALID}`).send({ value: 1 })
    expect(res.status).toBe(401)
    expect(businessMutations()).toEqual([])
  })

  it('refuses a request with no credential at all', async () => {
    unauthenticated = true
    setCurrent(principal({ role: 'owner' }))
    mockQuery.mockImplementation(tokenAware())
    const res = await request(makeApp()).post('/api/v1/iot/ingest').send(body)
    expect(res.status).toBe(401)
    expect(businessMutations()).toEqual([])
  })
})

describe('D5/D6 hybrid ingest — the human session path', () => {
  const body = [{ sensorUid: 's-1', value: 21.5 }]
  const CASES = [
    { url: '/api/v1/iot/ingest',            payload: body as unknown },
    { url: '/api/v1/sensors/s-1/readings',  payload: { value: 21.5 } },
  ]

  for (const c of CASES) {
    const post = () => request(makeApp()).post(c.url).send(c.payload as object)

    it(`${c.url}: admits holders of platform.integrations`, async () => {
      for (const role of ALL_ROLES.filter(r => roleHasCapability(r, 'platform.integrations'))) {
        mockQuery.mockClear()
        setCurrent(principal({ role: role as UserRole }))
        const res = await post()
        expect(res.status, `${role} was refused`).not.toBe(403)
        expect(res.status).not.toBe(401)
      }
    })

    it(`${c.url}: refuses every role without it, and ingests nothing`, async () => {
      for (const role of ALL_ROLES.filter(r => !roleHasCapability(r, 'platform.integrations'))) {
        mockQuery.mockClear()
        setCurrent(principal({ role: role as UserRole }))
        const res = await post()
        expect(res.status, `${role} reached ingest`).toBe(403)
        expect(res.body).toEqual({ error: 'forbidden' })
        expect(businessMutations(), `${role} was denied but ingest still ran`).toEqual([])
      }
    })

    it(`${c.url}: refuses a deactivated holder`, async () => {
      setCurrent(principal({ role: 'admin', active: false }))
      expect((await post()).status).toBe(401)
      expect(businessMutations()).toEqual([])
    })

    it(`${c.url}: refuses a token claiming another tenant`, async () => {
      setCurrent(principal({ role: 'admin', tenantId: 'tenant-a', jwtTenantId: 'tenant-b' }))
      expect((await post()).status).toBe(401)
      expect(businessMutations()).toEqual([])
    })

    it(`${c.url}: refuses a stale admin token whose live role is viewer`, async () => {
      setCurrent(principal({ role: 'viewer', jwtRole: 'admin' }))
      expect((await post()).status).toBe(403)
      expect(businessMutations()).toEqual([])
    })

    it(`${c.url}: refuses a stale owner token whose live role is viewer`, async () => {
      setCurrent(principal({ role: 'viewer', jwtRole: 'owner' }))
      expect((await post()).status).toBe(403)
      expect(businessMutations()).toEqual([])
    })
  }
})

// ══ D7 · SCIM owner boundary ══════════════════════════════════════════════════
describe('D7 SCIM may never create or promote to owner', () => {
  const TOKEN = 'scim-token-under-test'
  const auth  = { Authorization: `Bearer ${TOKEN}` }

  /** A live, valid SCIM token; user lookups answer with an existing engineer. */
  function scimAware() {
    return async (...args: unknown[]): Promise<unknown> => {
      const sql = args.find(a => typeof a === 'string') as string | undefined
      if (sql && /FROM\s+scim_tokens/i.test(sql)) {
        return { rows: [{ id: 'tok-1', tenant_id: 'tenant-scim' }], rowCount: 1 }
      }
      if (sql && /SELECT\s+max_users/i.test(sql)) return { rows: [{ max_users: 50 }], rowCount: 1 }
      if (sql && /COUNT\(\*\)/i.test(sql))        return { rows: [{ count: '1' }], rowCount: 1 }
      return {
        rows: [{ id: 'u-9', email: 'e@x.test', display_name: 'E', role: 'engineer', is_active: true, created_at: 'now', updated_at: 'now' }],
        rowCount: 1,
      }
    }
  }

  beforeEach(() => {
    setCurrent(principal({ role: 'viewer' }))
    mockQuery.mockImplementation(scimAware())
  })

  const roleWrites = () => businessQueries().filter(s => /\brole\s*=\s*\$/i.test(s) || /INSERT INTO users/i.test(s))

  it('refuses POST /Users with role=owner, and creates nothing', async () => {
    const res = await request(makeApp()).post('/scim/v2/Users').set(auth)
      .send({ userName: 'new@x.test', roles: [{ value: 'owner' }] })
    expect(res.status).toBe(400)
    expect(JSON.stringify(res.body)).toMatch(/cannot be assigned through SCIM/)
    expect(roleWrites(), 'an owner was created').toEqual([])
  })

  it('refuses PUT /Users/:id with role=owner, and leaves the role unchanged', async () => {
    const res = await request(makeApp()).put('/scim/v2/Users/u-9').set(auth)
      .send({ displayName: 'E', roles: [{ value: 'owner' }] })
    expect(res.status).toBe(400)
    expect(roleWrites(), 'a role write ran despite refusal').toEqual([])
  })

  it('refuses PATCH /Users/:id promoting to owner, in every supported role form', async () => {
    for (const op of [
      { op: 'replace', path: 'roles', value: [{ value: 'owner' }] },
      { op: 'replace', path: 'roles[primary eq true].value', value: 'owner' },
      { op: 'add',     path: 'roles', value: [{ value: 'owner' }] },
    ]) {
      mockQuery.mockClear()
      const res = await request(makeApp()).patch('/scim/v2/Users/u-9').set(auth)
        .send({ Operations: [op] })
      expect(res.status, `PATCH form ${JSON.stringify(op)} was not refused`).toBe(400)
      expect(roleWrites(), 'a role write ran despite refusal').toEqual([])
    }
  })

  it('refuses a differently-cased owner, which is not a valid role either', async () => {
    for (const value of ['Owner', 'OWNER']) {
      mockQuery.mockClear()
      const res = await request(makeApp()).post('/scim/v2/Users').set(auth)
        .send({ userName: 'c@x.test', roles: [{ value }] })
      expect(res.status, `${value} was accepted`).toBe(400)
      expect(roleWrites()).toEqual([])
    }
  })

  it('refuses an unknown role rather than persisting a value nothing can reason about', async () => {
    const res = await request(makeApp()).post('/scim/v2/Users').set(auth)
      .send({ userName: 'd@x.test', roles: [{ value: 'totally_unknown_role' }] })
    expect(res.status).toBe(400)
    expect(JSON.stringify(res.body)).toMatch(/unknown role/)
    expect(roleWrites()).toEqual([])
  })

  it('still provisions a valid non-owner role — the fix does not disable SCIM', async () => {
    const res = await request(makeApp()).post('/scim/v2/Users').set(auth)
      .send({ userName: 'ok@x.test', roles: [{ value: 'engineer' }] })
    expect([200, 201]).toContain(res.status)
    expect(businessQueries().some(s => /INSERT INTO users/i.test(s)), 'no user was created').toBe(true)
  })

  it('still provisions admin — this gate narrows owner only', async () => {
    const res = await request(makeApp()).post('/scim/v2/Users').set(auth)
      .send({ userName: 'adm@x.test', roles: [{ value: 'admin' }] })
    expect([200, 201]).toContain(res.status)
  })

  it('does not demote an existing owner when SCIM updates another attribute', async () => {
    // The rule is "SCIM may not ASSIGN owner", not "SCIM must rewrite owners".
    const res = await request(makeApp()).patch('/scim/v2/Users/u-9').set(auth)
      .send({ Operations: [{ op: 'replace', path: 'displayName', value: 'Renamed' }] })
    expect(res.status).toBe(200)
    for (const sql of businessQueries().filter(s => /UPDATE users/i.test(s))) {
      expect(sql, 'a display-name patch also rewrote the role').not.toMatch(/\brole\s*=\s*\$/i)
    }
  })

  it('refuses without a valid SCIM token, regardless of role payload', async () => {
    mockQuery.mockImplementation(async (...args: unknown[]) => {
      const sql = args.find(a => typeof a === 'string') as string | undefined
      if (sql && /FROM\s+scim_tokens/i.test(sql)) return { rows: [], rowCount: 0 }
      return { rows: [], rowCount: 0 }
    })
    const res = await request(makeApp()).post('/scim/v2/Users')
      .set({ Authorization: 'Bearer not-a-real-token' })
      .send({ userName: 'x@x.test', roles: [{ value: 'engineer' }] })
    expect(res.status).toBe(401)
    expect(roleWrites()).toEqual([])
  })
})
