/**
 * ADR-014 Phase 2C-2 §40–§41, §47 — the high-sensitivity perimeter, exercised.
 *
 * The ratchet proves the guards are declared. This proves they decide, and that
 * a refusal costs the caller nothing: real routers, real `resolveCurrentUser`,
 * real `requireCapability`, and an assertion that no INSERT/UPDATE/DELETE ran.
 *
 * Covered here and nowhere else:
 *
 *   unauthenticated                       -> 401, no side effect
 *   authenticated without the capability  -> 403, no side effect  (every such role)
 *   viewer                                -> 403                  (ADR-014 D3)
 *   stale privileged token                -> 403                  (§15 — the DB wins)
 *   deactivated holder                    -> 401
 *   the holder                            -> admitted
 *   holder + another tenant's claim       -> 401, no side effect
 *   privilege escalation via identity     -> refused               (§32)
 *   the D1 pay-application lifecycle      -> four contracts, four outcomes (§47)
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
  pool:              { connect: vi.fn() },
}))
vi.mock('../services/actionService', () => ({ createAction: vi.fn() }))

import { principal, principalQuery, recordScopeQuery, ALL_ROLES, type TestPrincipal } from './helpers/testPrincipal'
import { roleHasCapability, type UserRole } from '../authz/capabilities'

let current: TestPrincipal
let unauthenticated = false

vi.mock('../auth', () => ({
  requireAuth: (req: Record<string, unknown>, res: Record<string, unknown>, next: () => void) => {
    const g = globalThis as Record<string, unknown>
    if (g['__p2c2_unauth']) {
      ;(res as unknown as { status: (n: number) => { json: (b: unknown) => void } })
        .status(401).json({ error: 'unauthenticated' })
      return
    }
    const p = g['__p2c2'] as TestPrincipal
    req['auth'] = { sub: p.id, tid: p.jwtTenantId, role: p.jwtRole, jti: 'jti' }
    next()
  },
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}))
// Most routers use `requireTenant()`; enterprise.ts passes `requireTenant`
// itself as middleware. The stand-in answers to both shapes, so the enterprise
// routes reach their capability guard instead of hanging on a middleware that
// never calls next().
vi.mock('../middleware/tenant', () => {
  // Declared inside the factory: vi.mock is hoisted above module-level consts.
  const mw = (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req['tenantId'] = ((globalThis as Record<string, unknown>)['__p2c2'] as TestPrincipal).jwtTenantId
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
  ;(globalThis as Record<string, unknown>)['__p2c2'] = p
  ;(globalThis as Record<string, unknown>)['__p2c2_unauth'] = unauthenticated
}

import { budgetsRouter }            from '../routes/budgets'
import { payApplicationsRouter }    from '../routes/payApplications'
import { proposalsRouter }          from '../routes/proposals'
import { costEntryRouter }          from '../routes/costEntry'
import { testResultsRouter }        from '../routes/testResults'
import { integrationsRouter, webhooksRouter } from '../routes/integrations'
import { auditVerificationRouter }  from '../routes/auditVerification'
import tenantsRouter                from '../routes/tenants'
import automationRouter             from '../routes/automation'
import enterpriseRouter             from '../routes/enterprise'
import ecosystemRouter              from '../routes/ecosystem'
import portfolioRouter              from '../routes/portfolio'
import complianceRouter             from '../routes/compliance'
import fixLibraryRouter             from '../routes/fixLibrary'
import autosignRulesRouter          from '../routes/autosignRules'

import { requireAuth } from '../auth'
import { requireTenant } from '../middleware/tenant'

function makeApp() {
  const app = express()
  app.use(express.json())
  const auth = [requireAuth as never, requireTenant() as never]
  app.use('/api/v1/tenants', tenantsRouter as never)
  app.use('/api/v1/admin/automation', automationRouter as never)
  app.use('/api/v1/enterprise', enterpriseRouter as never)
  app.use('/api/v1/integrations', integrationsRouter as never)
  app.use('/api/v1/webhooks', webhooksRouter as never)
  app.use('/api/v1/compliance-tasks', complianceRouter as never)
  app.use('/api/v1/knowledge-fixes', fixLibraryRouter as never)
  app.use('/api/v1/commissioning/autosign-rules', autosignRulesRouter as never)
  // These four carry no auth of their own — server.ts applies it at the mount
  // point, so the test must mount them the same way or they would 401 on
  // identity rather than on the capability under test.
  app.use('/api/v1/portfolio', ...auth, portfolioRouter as never)
  app.use('/api/v1/ecosystem', ...auth, ecosystemRouter as never)
  app.use('/api/v1/audit/verify', ...auth, auditVerificationRouter as never)
  for (const r of [budgetsRouter, payApplicationsRouter, proposalsRouter, costEntryRouter, testResultsRouter]) {
    app.use('/api/v1', r as never)
  }
  return app
}

const SQL = /\b(SELECT|INSERT|UPDATE|DELETE)\b/i
const businessQueries = () => mockQuery.mock.calls
  .flatMap(c => c.filter((a): a is string => typeof a === 'string' && SQL.test(a)))
  .filter(s => !/FROM\s+users\s+WHERE\s+id/i.test(s))
const mutated = () => businessQueries().some(s => /\b(INSERT|UPDATE|DELETE)\b/i.test(s))

beforeEach(() => {
  unauthenticated = false
  mockQuery.mockReset()
  mockQuery.mockImplementation(principalQuery(() => current, recordScopeQuery({ delegate: async () => ({
    rows: [{ id: 'x', status: 'draft', tenant_id: 'tenant-under-test', project_id: 'p-1' }], rowCount: 1,
  }) })))
})

/**
 * One representative mutation per capability family this slice attaches,
 * including each of the seven escalation resolutions.
 */
const CASES: {
  family: string; capability: string
  method: 'post' | 'patch' | 'put' | 'delete'; url: string; body?: object
}[] = [
  // commercial
  { family: 'commercial / cost.write',        capability: 'cost.write',        method: 'post',   url: '/api/v1/projects/30000000-0000-4000-8000-0000000000a1/budget',                   body: { total: 100 } },
  { family: 'commercial / cost.approve',      capability: 'cost.approve',      method: 'post',   url: '/api/v1/cost-entries/41923a13-bf46-41db-8cec-276f478aebf1/post' },
  // crm
  { family: 'crm / crm.write',                capability: 'crm.write',         method: 'post',   url: '/api/v1/proposals',                             body: { title: 'Substation upgrade' } },
  // project
  { family: 'project / ai.govern',            capability: 'ai.govern',         method: 'post',   url: '/api/v1/ecosystem/federated/opt-in' },
  // audit
  { family: 'audit / audit.view',             capability: 'audit.view',        method: 'post',   url: '/api/v1/audit/verify/snapshot' },
  // portfolio
  { family: 'portfolio / portfolio.approve',  capability: 'portfolio.approve', method: 'post',   url: '/api/v1/portfolio/anomalies/an-1/false-positive' },
  // platform
  { family: 'platform / platform.automation', capability: 'platform.automation', method: 'post', url: '/api/v1/admin/automation/scheduled',            body: { name: 'nightly', cron: '0 0 * * *' } },
  { family: 'platform / platform.integrations', capability: 'platform.integrations', method: 'post', url: '/api/v1/webhooks',                          body: { url: 'https://example.test/hook', events: ['x'] } },
  { family: 'platform / platform.identity',   capability: 'platform.identity', method: 'post',   url: '/api/v1/tenants/me/users',                       body: { email: 'n@example.test', displayName: 'N', password: 'Sufficiently-long-passw0rd!' } },
  { family: 'platform / platform.security',   capability: 'platform.security', method: 'post',   url: '/api/v1/enterprise/api-keys',                    body: { name: 'k' } },
  { family: 'platform / platform.admin',      capability: 'platform.admin',    method: 'post',   url: '/api/v1/enterprise/usage',                       body: { metric: 'seats', value: 1 } },
  // §19/§22 registered here
  { family: 'commissioning / commissioning.write', capability: 'commissioning.write', method: 'post', url: '/api/v1/test-results',                      body: { projectId: 'p-1', testPackId: 'tp-1', stepNo: 1 } },
  // §17 escalation resolutions
  { family: 'escalation / commissioning.approve', capability: 'commissioning.approve', method: 'post', url: '/api/v1/commissioning/autosign-rules',     body: { name: 'r', predicate: {} } },
  { family: 'escalation / safety.approve',    capability: 'safety.approve',    method: 'delete', url: '/api/v1/compliance-tasks/48398f90-4aa3-4c3b-8141-27c6b7d2522f' },
  { family: 'escalation / assistant.admin',   capability: 'assistant.admin',   method: 'delete', url: '/api/v1/knowledge-fixes/40c6ad7b-c087-4fe5-8523-b562ec48b163' },
]

describe('§40 high-sensitivity mutation authorization', () => {
  for (const c of CASES) {
    const holders   = ALL_ROLES.filter(r => roleHasCapability(r, c.capability))
    const outsiders = ALL_ROLES.filter(r => !roleHasCapability(r, c.capability))

    it(`${c.family}: denies an unauthenticated caller, with no side effect`, async () => {
      unauthenticated = true
      setCurrent(principal({ role: 'owner' }))
      const res = await request(makeApp())[c.method](c.url).send(c.body ?? {})
      expect(res.status).toBe(401)
      expect(mutated(), `${c.family}: unauthenticated request still mutated`).toBe(false)
    })

    it(`${c.family}: denies every role without ${c.capability}, with no side effect`, async () => {
      expect(outsiders.length, `${c.capability} is held by every role`).toBeGreaterThan(0)
      for (const role of outsiders) {
        mockQuery.mockClear()
        setCurrent(principal({ role: role as UserRole }))
        const res = await request(makeApp())[c.method](c.url).send(c.body ?? {})
        expect(res.status, `${c.family}: ${role} must be denied`).toBe(403)
        expect(res.body).toEqual({ error: 'forbidden' })
        expect(mutated(), `${c.family}: ${role} was denied but the mutation still ran`).toBe(false)
      }
    })

    it(`${c.family}: admits every holder of ${c.capability}`, async () => {
      expect(holders.length).toBeGreaterThan(0)
      for (const role of holders) {
        mockQuery.mockClear()
        setCurrent(principal({ role: role as UserRole }))
        const res = await request(makeApp())[c.method](c.url).send(c.body ?? {})
        expect(res.status, `${c.family}: ${role} must pass authorization`).not.toBe(403)
        expect(res.status, `${c.family}: ${role} must pass authentication`).not.toBe(401)
      }
    })

    it(`${c.family}: a deactivated holder is refused, with no side effect`, async () => {
      setCurrent(principal({ role: holders[0] as UserRole, active: false }))
      const res = await request(makeApp())[c.method](c.url).send(c.body ?? {})
      expect(res.status).toBe(401)
      expect(mutated()).toBe(false)
    })

    it(`${c.family}: a token claiming another tenant is refused, and writes nothing`, async () => {
      setCurrent(principal({ role: holders[0] as UserRole, tenantId: 'tenant-a', jwtTenantId: 'tenant-b' }))
      const res = await request(makeApp())[c.method](c.url).send(c.body ?? {})
      expect(res.status, `${c.family}: cross-tenant claim must not be admitted`).toBe(401)
      expect(mutated(), `${c.family}: cross-tenant request mutated`).toBe(false)
    })
  }
})

describe('§15 a stale token never carries a demoted user through', () => {
  it('refuses every family when the token says owner and the database says viewer', async () => {
    for (const c of CASES) {
      mockQuery.mockClear()
      setCurrent(principal({ role: 'viewer', jwtRole: 'owner' }))
      const res = await request(makeApp())[c.method](c.url).send(c.body ?? {})
      expect(res.status, `${c.family}: stale owner token was honoured`).toBe(403)
      expect(mutated()).toBe(false)
    }
  })

  it('refuses the legacy-guard families specifically, which read the JWT before this slice', async () => {
    // These five carried `['owner','admin']` / `requireRole` against the token.
    const legacy = CASES.filter(c => [
      'platform / platform.automation', 'platform / platform.identity',
      'escalation / commissioning.approve', 'escalation / safety.approve',
      'escalation / assistant.admin',
    ].includes(c.family))
    expect(legacy.length).toBe(5)
    for (const c of legacy) {
      mockQuery.mockClear()
      setCurrent(principal({ role: 'viewer', jwtRole: 'admin' }))
      const res = await request(makeApp())[c.method](c.url).send(c.body ?? {})
      expect(res.status, `${c.family}: stale admin token was honoured`).toBe(403)
      expect(mutated()).toBe(false)
    }
  })
})

describe('§32 identity mutations cannot be used to escalate', () => {
  it('never admits a viewer to any identity route', async () => {
    for (const url of ['/api/v1/tenants/me/users', '/api/v1/tenants/me']) {
      mockQuery.mockClear()
      setCurrent(principal({ role: 'viewer' }))
      const res = await request(makeApp()).post(url).send({ email: 'x@y.test', displayName: 'X', password: 'Sufficiently-long-passw0rd!' })
      expect([403, 404]).toContain(res.status)
      expect(mutated()).toBe(false)
    }
  })

  it('never admits an ordinary business writer to grant a role', async () => {
    // project_manager holds broad delivery authority and no identity authority.
    for (const role of ['project_manager', 'engineer', 'procurement', 'field_ops'] as UserRole[]) {
      mockQuery.mockClear()
      setCurrent(principal({ role }))
      const res = await request(makeApp())
        .patch('/api/v1/tenants/me/users/other-user')
        .send({ role: 'owner' })
      expect(res.status, `${role} reached role assignment`).toBe(403)
      expect(mutated(), `${role} was denied but the role write still ran`).toBe(false)
    }
  })

  it('refuses self-modification even for a full identity holder', async () => {
    setCurrent(principal({ role: 'owner', id: 'self' }))
    const res = await request(makeApp())
      .patch('/api/v1/tenants/me/users/self')
      .send({ role: 'owner' })
    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ error: 'self_modification' })
    expect(mutated()).toBe(false)
  })

  it('refuses a stale admin token at role assignment', async () => {
    setCurrent(principal({ role: 'engineer', jwtRole: 'admin', id: 'caller' }))
    const res = await request(makeApp())
      .patch('/api/v1/tenants/me/users/victim')
      .send({ role: 'owner' })
    expect(res.status).toBe(403)
    expect(mutated()).toBe(false)
  })
})

describe('§47 the D1 pay-application lifecycle enforces four distinct contracts', () => {
  const app = () => makeApp()

  it('cost.write may create the SOV, open a draft and edit its lines', async () => {
    setCurrent(principal({ role: 'owner' }))
    for (const [method, url, body] of [
      ['post',  '/api/v1/projects/30000000-0000-4000-8000-0000000000a1/sov-items',        { item_no: '1', description: 'Mobilisation' }],
      ['post',  '/api/v1/projects/30000000-0000-4000-8000-0000000000a1/pay-applications', {}],
      ['patch', '/api/v1/pay-applications/4a16a24b-bbcf-48ad-8cec-beaf93a2fa27/lines',   { lines: [{ sov_item_id: 's-1', work_completed: 10 }] }],
    ] as const) {
      mockQuery.mockClear()
      const res = await (request(app()) as never as Record<string, (u: string) => { send: (b: unknown) => Promise<{ status: number }> }>)[method](url).send(body)
      expect(res.status, `${method} ${url}`).not.toBe(403)
    }
  })

  it('cost.write may submit, and submission is refused outside draft/rejected', async () => {
    setCurrent(principal({ role: 'owner' }))
    const res = await request(app()).post('/api/v1/pay-applications/4a16a24b-bbcf-48ad-8cec-beaf93a2fa27/submit').send({})
    expect(res.status).not.toBe(403)

    mockQuery.mockImplementation(principalQuery(() => current, recordScopeQuery({ delegate: async () => ({
      rows: [{ status: 'approved' }], rowCount: 1,
    }) })))
    const late = await request(app()).post('/api/v1/pay-applications/4a16a24b-bbcf-48ad-8cec-beaf93a2fa27/submit').send({})
    expect(late.status).toBe(409)
  })

  it('the approval endpoint refuses `submitted` outright, so submission cannot be laundered through it', async () => {
    setCurrent(principal({ role: 'owner' }))     // holds cost.approve
    const res = await request(app()).patch('/api/v1/pay-applications/4a16a24b-bbcf-48ad-8cec-beaf93a2fa27').send({ status: 'submitted' })
    expect(res.status).toBe(422)
    expect(res.body).toMatchObject({
      error: 'ordinary_transition_not_writable',
      canonical: 'POST /api/v1/pay-applications/:id/submit',
    })
    expect(mutated(), 'the refused status write still ran').toBe(false)
  })

  it('every role without cost.write is refused the ordinary half, with no side effect', async () => {
    for (const role of ALL_ROLES.filter(r => !roleHasCapability(r, 'cost.write'))) {
      for (const [method, url] of [
        ['post',  '/api/v1/projects/30000000-0000-4000-8000-0000000000a1/sov-items'],
        ['post',  '/api/v1/projects/30000000-0000-4000-8000-0000000000a1/pay-applications'],
        ['patch', '/api/v1/pay-applications/4a16a24b-bbcf-48ad-8cec-beaf93a2fa27/lines'],
        ['post',  '/api/v1/pay-applications/4a16a24b-bbcf-48ad-8cec-beaf93a2fa27/submit'],
      ] as const) {
        mockQuery.mockClear()
        setCurrent(principal({ role: role as UserRole }))
        const res = await (request(app()) as never as Record<string, (u: string) => { send: (b: unknown) => Promise<{ status: number }> }>)[method](url)
          .send({ lines: [{ sov_item_id: 's-1' }], item_no: '1', description: 'd' })
        expect(res.status, `${role} reached ${method} ${url}`).toBe(403)
        expect(mutated(), `${role} was denied ${url} but it still mutated`).toBe(false)
      }
    }
  })

  it('every role without cost.approve is refused approve, paid and reject, with no side effect', async () => {
    for (const role of ALL_ROLES.filter(r => !roleHasCapability(r, 'cost.approve'))) {
      for (const status of ['approved', 'paid', 'rejected', 'draft']) {
        mockQuery.mockClear()
        setCurrent(principal({ role: role as UserRole }))
        const res = await request(app()).patch('/api/v1/pay-applications/4a16a24b-bbcf-48ad-8cec-beaf93a2fa27').send({ status })
        expect(res.status, `${role} reached status=${status}`).toBe(403)
        expect(mutated(), `${role} was denied status=${status} but it still mutated`).toBe(false)
      }
    }
  })

  it('cost.approve may approve, mark paid and reject — D1 assigns paid/final no narrower capability', async () => {
    setCurrent(principal({ role: 'owner' }))
    for (const status of ['approved', 'paid', 'rejected']) {
      mockQuery.mockClear()
      const res = await request(app()).patch('/api/v1/pay-applications/4a16a24b-bbcf-48ad-8cec-beaf93a2fa27').send({ status })
      expect(res.status, `owner was refused status=${status}`).not.toBe(403)
    }
  })

  it('a cross-tenant claim reaches neither half of the lifecycle', async () => {
    setCurrent(principal({ role: 'owner', tenantId: 'tenant-a', jwtTenantId: 'tenant-b' }))
    for (const [method, url, body] of [
      ['post',  '/api/v1/pay-applications/4a16a24b-bbcf-48ad-8cec-beaf93a2fa27/submit', {}],
      ['patch', '/api/v1/pay-applications/4a16a24b-bbcf-48ad-8cec-beaf93a2fa27',        { status: 'approved' }],
    ] as const) {
      mockQuery.mockClear()
      const res = await (request(app()) as never as Record<string, (u: string) => { send: (b: unknown) => Promise<{ status: number }> }>)[method](url).send(body)
      expect(res.status, `${method} ${url} admitted a cross-tenant claim`).toBe(401)
      expect(mutated()).toBe(false)
    }
  })
})

describe('§35 an ordinary capability cannot reach an approval state by mass assignment', () => {
  it('createPayApplication never accepts a caller-supplied status', async () => {
    setCurrent(principal({ role: 'owner' }))
    await request(makeApp())
      .post('/api/v1/projects/30000000-0000-4000-8000-0000000000a1/pay-applications')
      .send({ status: 'approved', retention_pct: 5 })
    const inserts = businessQueries().filter(s => /INSERT INTO pay_applications/i.test(s))
    expect(inserts.length).toBeGreaterThan(0)
    for (const sql of inserts) {
      // Only the column list matters — RETURNING legitimately reads status back.
      const columns = /INSERT INTO pay_applications\s*\(([^)]*)\)/i.exec(sql)?.[1] ?? ''
      expect(columns.length, 'no column list found').toBeGreaterThan(0)
      expect(columns, 'status reached the INSERT column list').not.toMatch(/\bstatus\b/i)
    }
  })

  it('the line editor refuses an application that is no longer draft or rejected', async () => {
    setCurrent(principal({ role: 'owner' }))
    mockQuery.mockImplementation(principalQuery(() => current, recordScopeQuery({ delegate: async () => ({
      rows: [{ status: 'approved' }], rowCount: 1,
    }) })))
    const res = await request(makeApp())
      .patch('/api/v1/pay-applications/4a16a24b-bbcf-48ad-8cec-beaf93a2fa27/lines')
      .send({ lines: [{ sov_item_id: 's-1', work_completed: 999 }] })
    expect(res.status).toBe(409)
    expect(mutated(), 'an approved billing was edited').toBe(false)
  })
})
