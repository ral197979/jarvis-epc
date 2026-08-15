/**
 * ADR-014 Phase 2C-1 §14–§15 — the delivery mutation perimeter, exercised.
 *
 * The ratchet proves the guards are declared. This proves they decide, and that
 * a refusal costs the caller nothing: real routers, real `resolveCurrentUser`,
 * real `requireCapability`, and an assertion that no INSERT/UPDATE/DELETE ran.
 *
 * One representative mutation per delivery domain, and for each of them the
 * five outcomes that matter:
 *
 *   unauthenticated                  -> 401
 *   authenticated, no capability     -> 403
 *   viewer                           -> 403   (ADR-014 D3 — read-only, always)
 *   platform administrator           -> 403   (ADR-014 D2 — not business authority)
 *   capability holder                -> admitted
 *   capability holder, other tenant  -> writes nothing outside its own tenant
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

import { principal, principalQuery, ALL_ROLES, type TestPrincipal } from './helpers/testPrincipal'
import { roleHasCapability, type UserRole } from '../authz/capabilities'

let current: TestPrincipal
/** `null` models a request that never authenticated. */
let unauthenticated = false

vi.mock('../auth', () => ({
  requireAuth: (req: Record<string, unknown>, res: Record<string, unknown>, next: () => void) => {
    const g = globalThis as Record<string, unknown>
    if (g['__p2c1_unauth']) {
      ;(res as unknown as { status: (n: number) => { json: (b: unknown) => void } })
        .status(401).json({ error: 'unauthenticated' })
      return
    }
    const p = g['__p2c1'] as TestPrincipal
    req['auth'] = { sub: p.id, tid: p.jwtTenantId, role: p.jwtRole, jti: 'jti' }
    next()
  },
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}))
vi.mock('../middleware/tenant', () => ({
  requireTenant: () => (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req['tenantId'] = ((globalThis as Record<string, unknown>)['__p2c1'] as TestPrincipal).jwtTenantId
    next()
  },
}))

function setCurrent(p: TestPrincipal) {
  current = p
  ;(globalThis as Record<string, unknown>)['__p2c1'] = p
  ;(globalThis as Record<string, unknown>)['__p2c1_unauth'] = unauthenticated
}

import { meetingsRouter }     from '../routes/meetings'
import { teamRouter }         from '../routes/team'
import scheduleRouter         from '../routes/schedule'
import { riskRegisterRouter } from '../routes/riskRegister'
import { drawingsRouter }     from '../routes/drawings'
import { turnoverRouter }     from '../routes/turnover'
import { dailyLogsRouter }    from '../routes/dailyLogs'
import { syncRouter }         from '../routes/sync'
import { punchListsRouter }   from '../routes/punchLists'
import { safetyRouter }       from '../routes/safety'
import { subcontractsRouter } from '../routes/subcontracts'
import { systemsRouter }      from '../routes/systems'

import { requireAuth } from '../auth'
import { requireTenant } from '../middleware/tenant'

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/schedule', scheduleRouter as never)
  // syncRouter carries no auth of its own — server.ts applies it at the mount
  // point, so the test must mount it the same way or it would 401 on identity
  // rather than on the capability under test.
  app.use('/api/v1/sync', requireAuth as never, requireTenant() as never, syncRouter as never)
  for (const r of [meetingsRouter, teamRouter, riskRegisterRouter, drawingsRouter, turnoverRouter,
    dailyLogsRouter, punchListsRouter, safetyRouter, subcontractsRouter, systemsRouter]) {
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
  mockQuery.mockImplementation(principalQuery(() => current, async () => ({ rows: [{ id: 'x' }], rowCount: 1 })))
})

/** One representative ordinary mutation per delivery domain. */
const CASES: {
  domain: string; capability: string
  method: 'post' | 'patch' | 'put' | 'delete'; url: string; body: object
}[] = [
  { domain: 'project',       capability: 'project.write',       method: 'post',  url: '/api/v1/projects/p-1/meetings',              body: { title: 'Weekly coordination', meeting_date: '2026-08-20' } },
  { domain: 'team',          capability: 'team.write',          method: 'post',  url: '/api/v1/team/members',                       body: { name: 'A Person', email: 'a@example.com' } },
  { domain: 'schedule',      capability: 'schedule.write',      method: 'post',  url: '/api/v1/schedule/p-1/tasks',                 body: { name: 'Pour slab' } },
  { domain: 'risk',          capability: 'risk.write',          method: 'post',  url: '/api/v1/projects/p-1/risks',                 body: { title: 'Late steel delivery' } },
  { domain: 'engineering',   capability: 'engineering.write',   method: 'post',  url: '/api/v1/projects/p-1/drawings',              body: { drawing_number: 'A-101', title: 'Plan' } },
  { domain: 'docs',          capability: 'docs.write',          method: 'post',  url: '/api/v1/projects/p-1/turnover-packages',     body: { name: 'Unit 1 handover' } },
  { domain: 'construction',  capability: 'construction.write',  method: 'post',  url: '/api/v1/projects/p-1/daily-logs',            body: { log_date: '2026-08-15' } },
  { domain: 'field',         capability: 'field.write',         method: 'post',  url: '/api/v1/sync/register',                      body: { device_id: 'd-1' } },
  { domain: 'quality',       capability: 'quality.write',       method: 'post',  url: '/api/v1/projects/p-1/punch-lists',           body: { title: 'Level 3 closeout' } },
  { domain: 'safety',        capability: 'safety.write',        method: 'post',  url: '/api/v1/projects/p-1/safety/observations',   body: { description: 'Missing edge protection' } },
  { domain: 'procurement',   capability: 'procurement.write',   method: 'post',  url: '/api/v1/projects/p-1/subcontracts',          body: { vendorId: 'v-1', title: 'Electrical' } },
  { domain: 'commissioning', capability: 'commissioning.write', method: 'post',  url: '/api/v1/projects/p-1/systems',               body: { code: 'SYS-01', name: 'Chilled water' } },
]

describe('§14 delivery mutation authorization', () => {
  for (const c of CASES) {
    const holders  = ALL_ROLES.filter(r => roleHasCapability(r, c.capability))
    const outsiders = ALL_ROLES.filter(r => !roleHasCapability(r, c.capability))

    it(`${c.domain}: denies an unauthenticated caller, with no side effect`, async () => {
      unauthenticated = true
      setCurrent(principal({ role: 'owner' }))
      const res = await request(makeApp())[c.method](c.url).send(c.body)
      expect(res.status).toBe(401)
      expect(mutated(), `${c.domain}: unauthenticated request still mutated`).toBe(false)
    })

    it(`${c.domain}: denies every role without ${c.capability}, with no side effect`, async () => {
      expect(outsiders.length, `${c.capability} is held by every role — no denial to prove`).toBeGreaterThan(0)
      for (const role of outsiders) {
        mockQuery.mockClear()
        setCurrent(principal({ role: role as UserRole }))
        const res = await request(makeApp())[c.method](c.url).send(c.body)
        expect(res.status, `${c.domain}: ${role} must be denied`).toBe(403)
        expect(res.body).toEqual({ error: 'forbidden' })
        expect(mutated(), `${c.domain}: ${role} was denied but the mutation still ran`).toBe(false)
      }
    })

    it(`${c.domain}: admits every holder of ${c.capability}`, async () => {
      expect(holders.length).toBeGreaterThan(0)
      for (const role of holders) {
        mockQuery.mockClear()
        setCurrent(principal({ role: role as UserRole }))
        const res = await request(makeApp())[c.method](c.url).send(c.body)
        expect(res.status, `${c.domain}: ${role} must pass authorization`).not.toBe(403)
        expect(res.status, `${c.domain}: ${role} must pass authentication`).not.toBe(401)
      }
    })

    it(`${c.domain}: a deactivated holder is refused`, async () => {
      setCurrent(principal({ role: holders[0] as UserRole, active: false }))
      const res = await request(makeApp())[c.method](c.url).send(c.body)
      expect(res.status).toBe(401)
      expect(mutated()).toBe(false)
    })
  }
})

describe('§13 capability does not bypass tenant isolation', () => {
  for (const c of CASES) {
    const holder = ALL_ROLES.find(r => roleHasCapability(r, c.capability))!

    it(`${c.domain}: a holder writes only inside its own tenant`, async () => {
      setCurrent(principal({ role: holder as UserRole, tenantId: 'tenant-a' }))
      await request(makeApp())[c.method](c.url).send(c.body)
      // Every write the request issued was bound to the caller's own tenant.
      for (const call of mockQuery.mock.calls) {
        const sql = call.find(a => typeof a === 'string') as string | undefined
        if (sql && /\b(INSERT|UPDATE|DELETE)\b/i.test(sql) && !/FROM\s+users/i.test(sql)) {
          expect(call[0], `${c.domain}: write bound to the wrong tenant`).toBe('tenant-a')
        }
      }
    })

    it(`${c.domain}: a token claiming another tenant is refused, and writes nothing`, async () => {
      // The user belongs to tenant-a; the token claims tenant-b. Holding the
      // capability does not make the mismatch acceptable.
      setCurrent(principal({ role: holder as UserRole, tenantId: 'tenant-a', jwtTenantId: 'tenant-b' }))
      const res = await request(makeApp())[c.method](c.url).send(c.body)
      expect(res.status, `${c.domain}: cross-tenant claim must not be admitted`).toBe(401)
      expect(mutated(), `${c.domain}: cross-tenant request mutated`).toBe(false)
    })
  }
})

describe('§19 role anomalies the perimeter must never introduce', () => {
  it('never admits viewer to any delivery mutation', async () => {
    for (const c of CASES) {
      mockQuery.mockClear()
      setCurrent(principal({ role: 'viewer' }))
      const res = await request(makeApp())[c.method](c.url).send(c.body)
      expect(res.status, `viewer reached ${c.domain}`).toBe(403)
      expect(mutated()).toBe(false)
    }
  })

  it('never admits the platform administrator to any delivery mutation', async () => {
    // ADR-014 D2. Admin administers the platform; it holds no delivery domain.
    for (const c of CASES) {
      mockQuery.mockClear()
      setCurrent(principal({ role: 'admin' }))
      const res = await request(makeApp())[c.method](c.url).send(c.body)
      expect(res.status, `admin reached ${c.domain}`).toBe(403)
      expect(mutated()).toBe(false)
    }
  })

  it('keeps a stale token from carrying a demoted user through', async () => {
    // Token still says owner; the database says viewer. The database wins.
    for (const c of CASES) {
      mockQuery.mockClear()
      setCurrent(principal({ role: 'viewer', jwtRole: 'owner' }))
      const res = await request(makeApp())[c.method](c.url).send(c.body)
      expect(res.status, `${c.domain}: stale owner token was honoured`).toBe(403)
      expect(mutated()).toBe(false)
    }
  })
})
