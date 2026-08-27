/**
 * ADR-014 Phase 2C-5 §23–§25 — actions.ts route resolution, proved behaviourally.
 *
 * The finding carried from Phase 2C-4A: `actions.ts` declares `GET /:id` before
 * three single-segment literal routes, so Express — which matches in declaration
 * order — was resolving `/actions/sla-rules`, `/actions/delegations` and
 * `/actions/inbox` to the single-action handler. Phase 2C-4A recorded it as
 * `KNOWN_SHADOWED_ROUTES` and deliberately did not repair it, because making
 * three endpoints reachable is a functional change that slice did not authorise.
 *
 * Phase 2C-5 §24 authorises the repair. This file is the permanent proof, and it
 * does NOT assume framework precedence either way: for every path it asserts
 * WHICH HANDLER ACTUALLY RAN, identified by the SQL that handler alone issues.
 * A regression in declaration order therefore fails here even if every route
 * still answers 200.
 *
 * `/inbox` matters most. It declares `personal.admin`; `GET /:id` declares
 * `personal.view`. While shadowed, a request to `/actions/inbox` was served by
 * the weaker guard — the unified operations inbox was both unreachable and
 * capability-downgraded, and two live client callers
 * (`UnifiedOperationsInbox.tsx`, `ActionClusterView.tsx`) were 404ing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import fs from 'node:fs'
import path from 'node:path'

const mockQuery = vi.fn()
vi.mock('../db/pool', () => ({
  query:             (...a: unknown[]) => mockQuery(...a),
  tenantQuery:       (...a: unknown[]) => mockQuery(...a),
  tenantTransaction: async (_t: string, fn: (c: unknown) => unknown) =>
    fn({ query: (...a: unknown[]) => mockQuery(...a) }),
  pool:              { query: (...a: unknown[]) => mockQuery(...a), connect: vi.fn() },
}))
vi.mock('../services/actions/actionEventPublisher', () => ({
  publishActionEvent: vi.fn(),
  getActionTimeline:  vi.fn(async () => []),
}))
vi.mock('../services/actions/actionRelationshipService', () => ({
  createRelation: vi.fn(async () => ({ relation: { id: 'rel-new' }, error: null })),
  listRelations:  vi.fn(async () => []),
  deleteRelation: vi.fn(async () => true),
}))
vi.mock('../services/actions/actionDependencyGraph', () => ({ buildDependencyReport: vi.fn(async () => ({})) }))
vi.mock('../services/actions/actionAnalyticsService', () => ({
  getOverview: vi.fn(async () => ({})), getTrends: vi.fn(async () => []), getWorkload: vi.fn(async () => []),
}))
vi.mock('../services/sla/slaPolicyEngine', () => ({
  pauseSla: vi.fn(async () => true), resumeSla: vi.fn(async () => true),
}))

import type { UserRole } from '../authz/capabilities'

const TENANT = 'tenant-a'
const USER   = 'user-a'

interface Caller { id: string; tenantId: string; role: UserRole }
const setCaller = (c: Caller) => { (globalThis as Record<string, unknown>)['__p2c5'] = c }

vi.mock('../auth', () => ({
  requireAuth: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    const c = (globalThis as Record<string, unknown>)['__p2c5'] as Caller
    req['auth'] = { sub: c.id, tid: c.tenantId, role: c.role, jti: 'jti' }
    next()
  },
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}))
vi.mock('../middleware/tenant', () => {
  const mw = (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    const c = (globalThis as Record<string, unknown>)['__p2c5'] as Caller
    req['tenantId'] = c.tenantId
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

import { actionsRouter } from '../routes/actions'
import { KNOWN_SHADOWED_ROUTES } from '../authz/personalInboxAuthorization'

const makeApp = () => {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/actions', actionsRouter as never)
  return app
}

/**
 * The SQL out of one call. `query(sql, params)` puts it first;
 * `tenantQuery(tenantId, sql, params)` puts it second — so take the first
 * argument that actually looks like a statement rather than trusting position.
 */
const sqlOf = (args: unknown[]): string =>
  args.find(a => typeof a === 'string' && /\b(SELECT|INSERT|UPDATE|DELETE)\b/i.test(a)) as string ?? ''

/** Every SQL string the handlers issued during one request. */
const sqlSeen = (): string => mockQuery.mock.calls.map(sqlOf).join('\n---\n')

/** Route the mock by statement, so handler order and arity do not matter. */
const respond = (role: UserRole) => async (...args: unknown[]) => {
  const text = sqlOf(args)
  if (/FROM\s+users\b/i.test(text) && /is_active/i.test(text)) {
    return { rows: [{ id: USER, tenant_id: TENANT, role, is_active: true }] }
  }
  return { rows: [] }
}

beforeEach(() => {
  mockQuery.mockReset()
  // `resolveCurrentUser` reads the live principal; every handler below then
  // issues its own query. Returning an active owner keeps the guard satisfied so
  // these tests measure ROUTING, not authorization.
  mockQuery.mockImplementation(respond('owner'))
  setCaller({ id: USER, tenantId: TENANT, role: 'owner' })
})

// ─── 1. Each literal path reaches its own handler ─────────────────────────────
describe('literal action routes resolve to their own handlers', () => {
  it('GET /actions/sla-rules runs the SLA-rules handler', async () => {
    const res = await request(makeApp()).get('/api/v1/actions/sla-rules')
    expect(res.status, 'must not be the /:id handler 404').toBe(200)
    expect(sqlSeen(), 'the SLA-rules handler alone selects from sla_rules').toMatch(/FROM\s+sla_rules/i)
  })

  it('GET /actions/delegations runs the delegations handler', async () => {
    const res = await request(makeApp()).get('/api/v1/actions/delegations')
    expect(res.status).toBe(200)
    expect(sqlSeen(), 'the delegations handler alone joins approval_delegations')
      .toMatch(/FROM\s+approval_delegations/i)
  })

  it('GET /actions/inbox runs the unified-inbox handler', async () => {
    const res = await request(makeApp()).get('/api/v1/actions/inbox')
    expect(res.status).toBe(200)
    expect(sqlSeen(), 'the inbox handler alone projects age_hours over actions')
      .toMatch(/age_hours/i)
  })
})

// ─── 2. The parameter route still works ───────────────────────────────────────
describe('the :id route is not broken by the reordering', () => {
  it('GET /actions/<uuid> still runs the single-action handler', async () => {
    const ACTION = '11111111-2222-4333-8444-555555555555'
    mockQuery.mockImplementation(async (...args: unknown[]) => {
      const text = sqlOf(args)
      if (/FROM\s+users\b/i.test(text) && /is_active/i.test(text)) {
        return { rows: [{ id: USER, tenant_id: TENANT, role: 'owner', is_active: true }] }
      }
      if (/FROM\s+actions\b/i.test(text)) {
        return { rows: [{ id: ACTION, assigned_to_user_id: USER, title: 'a' }] }
      }
      return { rows: [] }
    })
    const res = await request(makeApp()).get(`/api/v1/actions/${ACTION}`)
    expect(res.status).toBe(200)
    expect(sqlSeen(), 'the single-action handler selects one action row')
      .toMatch(/FROM\s+actions/i)
    expect(sqlSeen(), 'and must NOT have fallen into a literal handler')
      .not.toMatch(/FROM\s+sla_rules|FROM\s+approval_delegations/i)
  })
})

// ─── 3. /inbox is served under its OWN capability, not /:id's ─────────────────
describe('the inbox is guarded by personal.admin, not by the weaker /:id guard', () => {
  it('refuses a role holding personal.view but not personal.admin', async () => {
    // `engineer` holds personal.view and not personal.admin. While /inbox was
    // shadowed this request reached GET /:id — the weaker guard — and 404'd.
    // It must now be refused 403 by the inbox's own guard.
    setCaller({ id: USER, tenantId: TENANT, role: 'engineer' })
    mockQuery.mockImplementation(respond('engineer'))
    const res = await request(makeApp()).get('/api/v1/actions/inbox')
    expect(res.status, 'personal.admin governs the unified inbox').toBe(403)
    expect(sqlSeen(), 'refusal must not run the inbox query').not.toMatch(/age_hours/i)
  })
})

// ─── 4. The Phase 2C-4A deferral is converted, not deleted (§37) ──────────────
describe('the Phase 2C-4A shadowing deferral is closed', () => {
  it('records an empty known-shadow set', () => {
    expect([...KNOWN_SHADOWED_ROUTES],
      'Phase 2C-5 §24 repaired the declaration order; nothing may remain shadowed')
      .toEqual([])
  })

  it('declares every single-segment literal GET before the :id route', () => {
    // Source-level ratchet. Non-vacuous: it asserts it FOUND the routes first,
    // so a renamed file or a changed regex fails loudly instead of passing.
    const src = fs.readFileSync(path.join(process.cwd(), 'api', 'routes', 'actions.ts'), 'utf8')

    const idAt = src.indexOf("actionsRouter.get('/:id'")
    expect(idAt, "GET '/:id' must exist in actions.ts").toBeGreaterThan(-1)

    const LITERALS = ['/sla-rules', '/delegations', '/inbox']
    for (const literal of LITERALS) {
      const at = src.indexOf(`actionsRouter.get('${literal}'`)
      expect(at, `GET '${literal}' must exist in actions.ts`).toBeGreaterThan(-1)
      expect(at, `GET '${literal}' must be declared before GET '/:id'`).toBeLessThan(idAt)
    }
  })
})
