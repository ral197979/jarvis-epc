/**
 * ADR-014 Phase 2C-4A — the Personal Inbox boundary, exercised.
 *
 * Real routers, real `resolveCurrentUser`, real `requireCapability` /
 * `requireAllCapabilities`, real ownership helper. Nothing injects a capability
 * onto the request: every principal is resolved from the database row the mock
 * returns, which is what keeps the stale-token closure under test.
 *
 * The test this file exists for is the SAME-TENANT one. Tenant isolation was
 * already proved by earlier slices and proves nothing about a Personal Inbox:
 * `personal.write` is held by five of seven roles, so the interesting question
 * is not "can tenant A reach tenant B" but "can user A reach user B's queue
 * while sharing a tenant". The fixture therefore models three principals:
 *
 *   Tenant A   USER_A  (owns action ACTION_A)
 *              USER_B  (owns action ACTION_B)
 *   Tenant B   USER_C
 *
 * Every refusal additionally asserts the side effect never happened.
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
vi.mock('../services/myWork/myWorkService', () => ({
  buildMyWork: vi.fn(async (_t: string, userId: string) => ({ userId, lanes: {}, counts: {} })),
}))
vi.mock('../services/agents/personalAgentService', () => ({
  isPersonalAgentEnabled: () => true,
  rememberForUser: vi.fn(async () => ({ key: 'k' })),
  listUserMemory:  vi.fn(async () => []),
  forgetUserMemory: vi.fn(async () => true),
  getPersonalBriefing: vi.fn(async (_t: string, userId: string) => ({ userId })),
  askPersonalAgent: vi.fn(async () => ({ answer: 'ok' })),
}))

import type { UserRole } from '../authz/capabilities'
import { roleHasCapability } from '../authz/capabilities'
import { ALL_ROLES } from './helpers/testPrincipal'

const TENANT_A = 'tenant-a'
const TENANT_B = 'tenant-b'
const USER_A   = 'user-a'
const USER_B   = 'user-b'
const USER_C   = 'user-c'
const ACTION_A = 'action-owned-by-a'
const ACTION_B = 'action-owned-by-b'

interface Caller {
  id: string; tenantId: string; role: UserRole
  active?: boolean; exists?: boolean
  jwtRole?: string; jwtTenantId?: string
}
let caller: Caller
let unauthenticated = false

const setCaller = (c: Caller) => {
  caller = c
  const g = globalThis as Record<string, unknown>
  g['__p2c4a'] = c
  g['__p2c4a_unauth'] = unauthenticated
}

vi.mock('../auth', () => ({
  requireAuth: (req: Record<string, unknown>, res: Record<string, unknown>, next: () => void) => {
    const g = globalThis as Record<string, unknown>
    if (g['__p2c4a_unauth']) {
      ;(res as unknown as { status: (n: number) => { json: (b: unknown) => void } })
        .status(401).json({ error: 'unauthenticated' })
      return
    }
    const c = g['__p2c4a'] as Caller
    req['auth'] = { sub: c.id, tid: c.jwtTenantId ?? c.tenantId, role: c.jwtRole ?? c.role, jti: 'jti' }
    next()
  },
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}))
vi.mock('../middleware/tenant', () => {
  const mw = (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    const c = (globalThis as Record<string, unknown>)['__p2c4a'] as Caller
    req['tenantId'] = c.jwtTenantId ?? c.tenantId
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

import { requireAuth } from '../auth'
import { requireTenant } from '../middleware/tenant'
import { actionsRouter } from '../routes/actions'
import { personalAgentRouter } from '../routes/personalAgent'
import { myWorkRouter } from '../routes/myWork'

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/actions', requireAuth as never, requireTenant() as never, actionsRouter as never)
  app.use('/api/v1', personalAgentRouter as never)
  app.use('/api/v1', myWorkRouter as never)
  return app
}

/** Who owns which action — the fixture the ownership helper reads. */
const ACTION_OWNER: Record<string, { owner: string; tenant: string }> = {
  [ACTION_A]: { owner: USER_A, tenant: TENANT_A },
  [ACTION_B]: { owner: USER_B, tenant: TENANT_A },
}

/**
 * `tenantQuery(tenantId, sql, params)` passes the tenant id as the first string
 * argument, so "the first string" is NOT the statement. Match on SQL keywords.
 */
const SQL_RE = /\b(SELECT|INSERT|UPDATE|DELETE)\b/i
const sql = (a: unknown[]) => a.find((x): x is string => typeof x === 'string' && SQL_RE.test(x)) ?? ''
const params = (a: unknown[]) => (a.find(x => Array.isArray(x)) ?? []) as unknown[]

beforeEach(() => {
  unauthenticated = false
  mockQuery.mockReset()
  mockQuery.mockImplementation(async (...a: unknown[]) => {
    const q = sql(a)
    const p = params(a)

    // ── tenant-membership probe (assignee / delegate validation) ──────────
    // Checked BEFORE the principal lookup: both read `users`, and the principal
    // pattern is the looser of the two, so it would swallow this one.
    if (/SELECT\s+id\s+FROM\s+users\s+WHERE\s+id\s*=\s*\$1\s+AND\s+tenant_id/i.test(q)) {
      const [userId, tenantId] = p as [string, string]
      const known: Record<string, string> = {
        [USER_A]: TENANT_A, [USER_B]: TENANT_A, [USER_C]: TENANT_B,
      }
      return known[userId] === tenantId
        ? { rows: [{ id: userId }], rowCount: 1 }
        : { rows: [], rowCount: 0 }
    }
    // ── the live-principal lookup ─────────────────────────────────────────
    if (/FROM\s+users\s+WHERE\s+id/i.test(q)) {
      if (caller.exists === false) return { rows: [], rowCount: 0 }
      return {
        rows: [{
          id: caller.id, tenant_id: caller.tenantId, role: caller.role,
          is_active: caller.active !== false,
        }],
        rowCount: 1,
      }
    }
    // ── the ownership lookup ──────────────────────────────────────────────
    if (/SELECT\s+assigned_to_user_id\s+FROM\s+actions/i.test(q)) {
      const [actionId, tenantId] = p as [string, string]
      const row = ACTION_OWNER[actionId]
      return row && row.tenant === tenantId
        ? { rows: [{ assigned_to_user_id: row.owner }], rowCount: 1 }
        : { rows: [], rowCount: 0 }
    }
    // ── relation → parent action ──────────────────────────────────────────
    if (/SELECT\s+source_action_id\s+FROM\s+action_relations/i.test(q)) {
      return { rows: [{ source_action_id: ACTION_B }], rowCount: 1 }
    }
    return { rows: [{ id: 'x' }], rowCount: 1 }
  })
  setCaller({ id: USER_A, tenantId: TENANT_A, role: 'project_manager' })
})

const businessQueries = () => mockQuery.mock.calls
  .flatMap(c => c.filter((a): a is string => typeof a === 'string'))
  .filter(s => !/FROM\s+users\s+WHERE\s+id/i.test(s))
const wrote = (re: RegExp) => businessQueries().some(s => re.test(s))
const actionUpdated = () => wrote(/UPDATE\s+actions\s+SET/i)
const delegationInserted = () => wrote(/INSERT\s+INTO\s+approval_delegations/i)
const slaRuleWritten = () => wrote(/INSERT\s+INTO\s+sla_rules|UPDATE\s+sla_rules\s+SET/i)

const holdersOf = (c: string) => ALL_ROLES.filter(r => roleHasCapability(r, c))
const nonHoldersOf = (c: string) => ALL_ROLES.filter(r => !roleHasCapability(r, c))

// ══ D10-R / D11 holder policy ═════════════════════════════════════════════════
describe('the Personal Inbox holder policy (D10-R, D11)', () => {
  it('grants personal.write to every personal.view holder except viewer', () => {
    const expected = ALL_ROLES.filter(r => roleHasCapability(r, 'personal.view') && r !== 'viewer')
    expect(holdersOf('personal.write')).toEqual(expected)
    expect(expected).toHaveLength(5)
    expect(roleHasCapability('viewer', 'personal.write')).toBe(false)
  })
  it('grants personal.admin to the owner alone', () => {
    expect(holdersOf('personal.admin')).toEqual(['owner'])
  })
})

// ══ SAME-TENANT CROSS-USER ISOLATION — the point of the slice ════════════════
describe('same-tenant cross-user isolation', () => {
  const patchOwn    = () => request(makeApp()).patch(`/api/v1/actions/${ACTION_A}`).send({ status: 'in_progress' })
  const patchOthers = () => request(makeApp()).patch(`/api/v1/actions/${ACTION_B}`).send({ status: 'in_progress' })

  it('lets a holder update their OWN action', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'project_manager' })
    const res = await patchOwn()
    expect([401, 403, 404]).not.toContain(res.status)
    expect(actionUpdated()).toBe(true)
  })

  it.each(holdersOf('personal.write').filter(r => r !== 'owner'))(
    'refuses %s acting on another user\'s action in the SAME tenant', async role => {
      setCaller({ id: USER_A, tenantId: TENANT_A, role })
      const res = await patchOthers()
      expect(res.status, 'same tenant is not "mine"').toBe(404)
      expect(actionUpdated(), 'a refused cross-user patch must not write').toBe(false)
    })

  it('lets the owner administer another user\'s action through personal.admin', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'owner' })
    const res = await patchOthers()
    expect([401, 403, 404]).not.toContain(res.status)
    expect(actionUpdated()).toBe(true)
  })

  it('refuses a caller from another tenant entirely', async () => {
    setCaller({ id: USER_C, tenantId: TENANT_B, role: 'owner' })
    const res = await patchOwn()
    expect(res.status, 'ACTION_A belongs to tenant A').toBe(404)
    expect(actionUpdated()).toBe(false)
  })

  it('refuses a viewer even on their own action', async () => {
    ACTION_OWNER['viewer-action'] = { owner: 'viewer-user', tenant: TENANT_A }
    setCaller({ id: 'viewer-user', tenantId: TENANT_A, role: 'viewer' })
    const res = await request(makeApp()).patch('/api/v1/actions/viewer-action').send({ status: 'in_progress' })
    expect(res.status, 'ADR-014 D3: viewer is read-only').toBe(403)
    expect(actionUpdated()).toBe(false)
  })

  it('reads: a holder may open their own action but not a peer\'s', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'engineer' })
    expect((await request(makeApp()).get(`/api/v1/actions/${ACTION_A}`)).status).not.toBe(404)
    expect((await request(makeApp()).get(`/api/v1/actions/${ACTION_B}`)).status).toBe(404)
  })

  it('reads: a viewer may open their OWN action', async () => {
    ACTION_OWNER['v2'] = { owner: 'viewer-user', tenant: TENANT_A }
    setCaller({ id: 'viewer-user', tenantId: TENANT_A, role: 'viewer' })
    expect((await request(makeApp()).get('/api/v1/actions/v2')).status).not.toBe(403)
    expect((await request(makeApp()).get(`/api/v1/actions/${ACTION_B}`)).status).toBe(404)
  })
})

// ══ mass-assignment closure ═══════════════════════════════════════════════════
describe('action assignment fields require personal.admin', () => {
  it.each(holdersOf('personal.write').filter(r => r !== 'owner'))(
    'refuses %s supplying assigned_to_user_id, with no write', async role => {
      setCaller({ id: USER_A, tenantId: TENANT_A, role })
      const res = await request(makeApp())
        .patch(`/api/v1/actions/${ACTION_A}`).send({ assigned_to_user_id: USER_B })
      expect(res.status).toBe(403)
      expect(res.body.restricted_fields, 'the refusal must name the field, not drop it silently')
        .toContain('assigned_to_user_id')
      expect(actionUpdated()).toBe(false)
    })

  it('refuses assigned_to_role from an ordinary holder', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'project_manager' })
    const res = await request(makeApp())
      .patch(`/api/v1/actions/${ACTION_A}`).send({ assigned_to_role: 'engineer' })
    expect(res.status).toBe(403)
    expect(actionUpdated()).toBe(false)
  })

  it('admits an owner reassignment to a member of the same tenant', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'owner' })
    const res = await request(makeApp())
      .patch(`/api/v1/actions/${ACTION_A}`).send({ assigned_to_user_id: USER_B })
    expect([401, 403, 404]).not.toContain(res.status)
    expect(actionUpdated()).toBe(true)
  })

  it('refuses an owner reassignment to a user in ANOTHER tenant', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'owner' })
    const res = await request(makeApp())
      .patch(`/api/v1/actions/${ACTION_A}`).send({ assigned_to_user_id: USER_C })
    expect(res.status, 'personal.admin governs THIS tenant only').toBe(422)
    expect(actionUpdated(), 'validation must precede the UPDATE').toBe(false)
  })

  it('refuses an unknown role literal even from the owner', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'owner' })
    const res = await request(makeApp())
      .patch(`/api/v1/actions/${ACTION_A}`).send({ assigned_to_role: 'superuser' })
    expect(res.status).toBe(422)
    expect(actionUpdated()).toBe(false)
  })
})

// ══ tenant-wide reads ═════════════════════════════════════════════════════════
describe('tenant-wide action reads require personal.admin', () => {
  // `/inbox` was omitted here until ADR-014 Phase 2C-5 §24: GET /:id was declared
  // before it in actions.ts, so a request to /actions/inbox resolved to the
  // single-action handler and 404'd for everyone — including, crucially, under
  // that handler's WEAKER personal.view guard. Phase 2C-5 moved the literal
  // declarations above /:id, so /inbox is now genuinely reachable and genuinely
  // governed by personal.admin, and it belongs in this sweep like its siblings.
  const ROUTES = ['/api/v1/actions', '/api/v1/actions/inbox', '/api/v1/actions/overdue',
    '/api/v1/actions/summary', '/api/v1/actions/analytics/overview',
    '/api/v1/actions/analytics/trends', '/api/v1/actions/analytics/workload']

  it.each(ROUTES)('%s admits the owner', async url => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'owner' })
    expect([401, 403]).not.toContain((await request(makeApp()).get(url)).status)
  })

  it.each(ROUTES)('%s refuses every non-owner role', async url => {
    for (const role of nonHoldersOf('personal.admin')) {
      setCaller({ id: USER_A, tenantId: TENANT_A, role })
      expect((await request(makeApp()).get(url)).status, `${role} on ${url}`).toBe(403)
    }
  })

  it('refuses the platform administrator, which holds no Personal Inbox authority', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'admin' })
    expect((await request(makeApp()).get('/api/v1/actions')).status).toBe(403)
  })
})

// ══ SLA policy vs action-local SLA ════════════════════════════════════════════
describe('SLA policy is personal.admin; action-local SLA is personal.write', () => {
  it('admits the owner creating an SLA rule', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'owner' })
    const res = await request(makeApp()).post('/api/v1/actions/sla-rules').send({ action_type: 'rfi' })
    expect([401, 403]).not.toContain(res.status)
    expect(slaRuleWritten()).toBe(true)
  })

  it.each(nonHoldersOf('personal.admin'))('refuses %s writing SLA policy', async role => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role })
    const res = await request(makeApp()).post('/api/v1/actions/sla-rules').send({ action_type: 'rfi' })
    expect(res.status).toBe(403)
    expect(slaRuleWritten(), 'policy must not change for a refused caller').toBe(false)
  })

  it('refuses a stale token claiming owner when the live row is project_manager', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'project_manager', jwtRole: 'owner' })
    const res = await request(makeApp()).patch('/api/v1/actions/sla-rules/r1').send({ is_active: false })
    expect(res.status, 'authority must come from the live row').toBe(403)
    expect(slaRuleWritten()).toBe(false)
  })

  it('lets an ordinary holder pause the SLA on their OWN action', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'field_ops' })
    const res = await request(makeApp()).post(`/api/v1/actions/${ACTION_A}/sla/pause`).send({})
    expect([401, 403, 404]).not.toContain(res.status)
  })

  it('refuses SLA pause on a peer\'s action in the same tenant', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'field_ops' })
    expect((await request(makeApp()).post(`/api/v1/actions/${ACTION_B}/sla/resume`).send({})).status).toBe(404)
  })

  it('refuses a viewer', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'viewer' })
    expect((await request(makeApp()).post(`/api/v1/actions/${ACTION_A}/sla/pause`).send({})).status).toBe(403)
  })
})

// ══ delegations ══════════════════════════════════════════════════════════════
describe('delegation is self-service, and is no longer dead', () => {
  const body = { delegate_user_id: USER_B, start_date: '2026-01-01', end_date: '2026-02-01' }
  const post = (b: Record<string, unknown> = body) =>
    request(makeApp()).post('/api/v1/actions/delegations').send(b)

  it('admits a holder delegating their own queue to a same-tenant user', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'project_manager' })
    const res = await post()
    expect([401, 403], 'the route was permanently 401 before the identity repair')
      .not.toContain(res.status)
    expect(delegationInserted()).toBe(true)
  })

  it('binds the delegator to the live principal — a supplied one is refused', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'project_manager' })
    for (const field of ['user_id', 'delegator_id', 'created_by']) {
      mockQuery.mockClear()
      const res = await post({ ...body, [field]: USER_B })
      expect(res.status, `${field} must not be caller-selectable`).toBe(403)
      expect(res.body.restricted_fields).toContain(field)
      expect(delegationInserted()).toBe(false)
    }
  })

  it('refuses a delegate from another tenant', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'project_manager' })
    const res = await post({ ...body, delegate_user_id: USER_C })
    expect(res.status).toBe(422)
    expect(delegationInserted()).toBe(false)
  })

  it('refuses a viewer', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'viewer' })
    expect((await post()).status).toBe(403)
    expect(delegationInserted()).toBe(false)
  })

  it('refuses the platform administrator', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'admin' })
    expect((await post()).status).toBe(403)
  })

  it('scopes a delegation update to the delegator for an ordinary holder', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'engineer' })
    await request(makeApp()).patch('/api/v1/actions/delegations/d1').send({})
    const call = mockQuery.mock.calls.find(c => /UPDATE\s+approval_delegations/i.test(sql(c)))
    expect(call, 'the update must run').toBeDefined()
    const p = params(call!)
    expect(p[1], 'the admin-widening flag must be false for a non-admin').toBe(false)
    expect(p[2], 'the predicate must bind the live principal').toBe(USER_A)
  })

  it('widens a delegation update only for a personal.admin holder', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'owner' })
    await request(makeApp()).patch('/api/v1/actions/delegations/d1').send({})
    const call = mockQuery.mock.calls.find(c => /UPDATE\s+approval_delegations/i.test(sql(c)))
    expect(params(call!)[1]).toBe(true)
  })

  it('does not widen for a stale token claiming owner over a live engineer', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'engineer', jwtRole: 'owner' })
    await request(makeApp()).patch('/api/v1/actions/delegations/d1').send({})
    const call = mockQuery.mock.calls.find(c => /UPDATE\s+approval_delegations/i.test(sql(c)))
    expect(params(call!)[1], 'the old code read this from the JWT role').toBe(false)
  })

  it('does not widen for the platform administrator', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'admin' })
    const res = await request(makeApp()).patch('/api/v1/actions/delegations/d1').send({})
    expect(res.status, 'admin holds no personal.write').toBe(403)
  })
})

// ══ personal agent ═══════════════════════════════════════════════════════════
describe('personal agent', () => {
  it('lets a viewer read their own briefing and memory', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'viewer' })
    expect((await request(makeApp()).get('/api/v1/me/agent/briefing')).status).not.toBe(403)
    expect((await request(makeApp()).get('/api/v1/me/agent/memory')).status).not.toBe(403)
  })

  it('refuses a viewer writing memory — D3 holds', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'viewer' })
    expect((await request(makeApp()).post('/api/v1/me/agent/memory').send({ key: 'k', value: {} })).status).toBe(403)
    expect((await request(makeApp()).delete('/api/v1/me/agent/memory/k')).status).toBe(403)
  })

  it('refuses the platform administrator, which lacks personal.view', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'admin' })
    expect((await request(makeApp()).get('/api/v1/me/agent/memory')).status).toBe(403)
  })

  it.each(holdersOf('personal.write'))('admits %s writing their own memory', async role => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role })
    const res = await request(makeApp()).post('/api/v1/me/agent/memory').send({ key: 'k', value: {} })
    expect([401, 403]).not.toContain(res.status)
  })

  describe('/ask requires BOTH personal.write and assistant.use', () => {
    const ask = () => request(makeApp()).post('/api/v1/me/agent/ask').send({ question: 'hi' })

    it('admits a role holding both', async () => {
      setCaller({ id: USER_A, tenantId: TENANT_A, role: 'project_manager' })
      expect([401, 403]).not.toContain((await ask()).status)
    })

    it('refuses field_ops, which holds personal.write but NOT assistant.use', async () => {
      expect(roleHasCapability('field_ops', 'personal.write')).toBe(true)
      expect(roleHasCapability('field_ops', 'assistant.use')).toBe(false)
      setCaller({ id: USER_A, tenantId: TENANT_A, role: 'field_ops' })
      expect((await ask()).status, 'the conjunction must be real').toBe(403)
    })

    it('refuses viewer, which holds neither half', async () => {
      setCaller({ id: USER_A, tenantId: TENANT_A, role: 'viewer' })
      expect((await ask()).status).toBe(403)
    })

    it('refuses a stale token claiming project_manager over a live viewer', async () => {
      setCaller({ id: USER_A, tenantId: TENANT_A, role: 'viewer', jwtRole: 'project_manager' })
      expect((await ask()).status).toBe(403)
    })
  })
})

// ══ my work ══════════════════════════════════════════════════════════════════
describe('GET /my-work is self-scoped', () => {
  it('builds the queue for the LIVE principal, not the token subject', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'engineer' })
    const res = await request(makeApp()).get('/api/v1/my-work')
    expect(res.status).toBe(200)
    expect(res.body.data.userId).toBe(USER_A)
  })

  it('admits a viewer — reading your own queue is a read', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'viewer' })
    expect((await request(makeApp()).get('/api/v1/my-work')).status).toBe(200)
  })

  it('refuses the platform administrator', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'admin' })
    expect((await request(makeApp()).get('/api/v1/my-work')).status).toBe(403)
  })
})

// ══ the live-principal closures ══════════════════════════════════════════════
describe('every Personal Inbox route resolves the live principal', () => {
  const CASES: Array<[string, () => request.Test]> = [
    ['PATCH /actions/:id',        () => request(makeApp()).patch(`/api/v1/actions/${ACTION_A}`).send({ status: 'open' })],
    ['POST /actions/delegations', () => request(makeApp()).post('/api/v1/actions/delegations').send({ delegate_user_id: USER_B, start_date: 'a', end_date: 'b' })],
    ['POST /me/agent/memory',     () => request(makeApp()).post('/api/v1/me/agent/memory').send({ key: 'k', value: {} })],
    ['GET  /my-work',             () => request(makeApp()).get('/api/v1/my-work')],
    ['GET  /actions/my',          () => request(makeApp()).get('/api/v1/actions/my')],
  ]

  it.each(CASES)('%s refuses a deactivated account', async (_l, send) => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'owner', active: false })
    expect((await send()).status).toBe(401)
    expect(actionUpdated()).toBe(false)
    expect(delegationInserted()).toBe(false)
  })

  it.each(CASES)('%s refuses a user row that no longer exists', async (_l, send) => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'owner', exists: false })
    expect((await send()).status).toBe(401)
    expect(actionUpdated()).toBe(false)
  })

  it.each(CASES)('%s refuses a token whose tenant contradicts the row', async (_l, send) => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'owner', jwtTenantId: TENANT_B })
    expect((await send()).status).toBe(401)
    expect(actionUpdated()).toBe(false)
  })

  it.each(CASES)('%s refuses an unauthenticated caller', async (_l, send) => {
    unauthenticated = true
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'owner' })
    expect((await send()).status).toBe(401)
    expect(actionUpdated()).toBe(false)
    expect(delegationInserted()).toBe(false)
  })
})
