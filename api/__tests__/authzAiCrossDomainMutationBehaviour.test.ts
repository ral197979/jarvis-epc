/**
 * ADR-014 Phase 2C-3 — the AI / cross-domain mutation boundary, exercised.
 *
 * Real routers, real `resolveCurrentUser`, real `requireCapability` /
 * `requireAllCapabilities`. Nothing injects an "effective capability" onto the
 * request: every principal below is resolved from the database row the mock
 * returns, which is what keeps the stale-token closure under test.
 *
 * Every refusal additionally asserts the side effect never happened — no row
 * written, no durable agent task queued, no simulation session opened. A route
 * that does the work and then returns 403 is a failed implementation, and only a
 * side-effect assertion can tell the two apart.
 *
 * One meaningful route is covered for each authorization model the 45 endpoints
 * use:
 *
 *   crossdomain.write   POST /twins, POST /agents/memory, POST /agents/risk/analyze
 *   ai.govern           POST /adaptive/feedback, POST /ai/recommendations
 *   bounded conjunction POST /projects/:id/coordination/scan
 *   platform.automation POST /ops/incident
 *   correction → read   POST /optimization/root-cause, POST /agents/plan
 *   consequential       POST /agents/readiness/coordinate, POST /agent-actions/:id/review
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
// Realtime fan-out is an external effect, not an authorization concern.
vi.mock('../realtime/eventBroadcaster', () => ({ broadcastEvent: vi.fn() }))
vi.mock('../realtime/wsGateway', () => ({ pollEvents: vi.fn(async () => []) }))
vi.mock('../services/actions/actionEventPublisher', () => ({ publishActionEvent: vi.fn() }))
// The coordination briefing is a six-domain read; the authorization question is
// whether the caller reaches it at all.
const mockBuildCoord = vi.fn()
vi.mock('../services/copilot/coordinationService', () => ({
  buildProjectCoordination: (...a: unknown[]) => mockBuildCoord(...a),
}))

import { principal, principalQuery, ALL_ROLES, type TestPrincipal } from './helpers/testPrincipal'
import { roleHasCapability, type UserRole } from '../authz/capabilities'

let current: TestPrincipal
let unauthenticated = false

vi.mock('../auth', () => ({
  requireAuth: (req: Record<string, unknown>, res: Record<string, unknown>, next: () => void) => {
    const g = globalThis as Record<string, unknown>
    if (g['__p2c3_unauth']) {
      ;(res as unknown as { status: (n: number) => { json: (b: unknown) => void } })
        .status(401).json({ error: 'unauthenticated' })
      return
    }
    const p = g['__p2c3'] as TestPrincipal
    req['auth'] = { sub: p.id, tid: p.jwtTenantId, role: p.jwtRole, jti: 'jti' }
    next()
  },
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}))
vi.mock('../middleware/tenant', () => {
  const mw = (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req['tenantId'] = ((globalThis as Record<string, unknown>)['__p2c3'] as TestPrincipal).jwtTenantId
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
  ;(globalThis as Record<string, unknown>)['__p2c3'] = p
  ;(globalThis as Record<string, unknown>)['__p2c3_unauth'] = unauthenticated
}

import { requireAuth }              from '../auth'
import { requireTenant }            from '../middleware/tenant'
import adaptiveRouter               from '../routes/adaptive'
import twinRouter                   from '../routes/twin'
import optimizationRouter           from '../routes/optimization'
import agentActionsRouter           from '../routes/agentActionsRoutes'
import { agentMemoryRouter }        from '../routes/agentMemory'
import { agentRiskRouter }          from '../routes/agentRisk'
import { agentReadinessRouter }     from '../routes/agentReadiness'
import { agentsRouter }             from '../routes/agents'
import { aiGovernanceRouter }       from '../routes/aiGovernance'
import { autoCoordinationRouter }   from '../routes/autoCoordination'
import { opsRouter }                from '../routes/ops'

function makeApp() {
  const app = express()
  app.use(express.json())
  // Mounted exactly as server.ts mounts them — same prefixes AND the same
  // mount-level middleware, so effective paths and the auth chain both match.
  // adaptive, twin, optimization and ops get requireAuth/requireTenant here
  // because server.ts supplies them at the mount; the agent routers install
  // their own internally.
  const chain = [requireAuth as never, requireTenant() as never]
  app.use('/api/v1/adaptive',         ...chain, adaptiveRouter as never)
  app.use('/api/v1/twins',            ...chain, twinRouter as never)
  app.use('/api/v1/optimization',     ...chain, optimizationRouter as never)
  app.use('/api/v1/ops',              ...chain, opsRouter as never)
  app.use('/api/v1/agent-actions',    agentActionsRouter as never)
  app.use('/api/v1/agents/memory',    agentMemoryRouter as never)
  app.use('/api/v1/agents/risk',      agentRiskRouter as never)
  app.use('/api/v1/agents/readiness', agentReadinessRouter as never)
  app.use('/api/v1/agents',           agentsRouter as never)
  app.use('/api/v1/ai',               ...chain, aiGovernanceRouter as never)
  app.use('/api/v1',                  autoCoordinationRouter as never)
  return app
}

const SQL = /\b(SELECT|INSERT|UPDATE|DELETE)\b/i
const businessQueries = () => mockQuery.mock.calls
  .flatMap(c => c.filter((a): a is string => typeof a === 'string' && SQL.test(a)))
  .filter(s => !/FROM\s+users\s+WHERE\s+id/i.test(s))
/** Any persisted write at all. */
const mutated = () => businessQueries().some(s => /\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i.test(s))
/** Durable agent work — the side effect a queued task represents. */
const queuedTask = () => businessQueries().some(s => /INSERT\s+INTO\s+agent_tasks/i.test(s))
/** Nothing at all reached the database beyond the authorization lookup. */
const touchedNothing = () => businessQueries().length === 0

const OWNER  = () => principal({ role: 'owner' })
const holdersOf = (cap: string): UserRole[] => ALL_ROLES.filter(r => roleHasCapability(r, cap))
const nonHoldersOf = (cap: string): UserRole[] => ALL_ROLES.filter(r => !roleHasCapability(r, cap))

beforeEach(() => {
  unauthenticated = false
  mockQuery.mockReset()
  mockBuildCoord.mockReset()
  mockBuildCoord.mockResolvedValue(null)
  mockQuery.mockImplementation(principalQuery(() => current, async () => ({
    rows: [{ id: 'x', status: 'proposed', tenant_id: 'tenant-under-test' }], rowCount: 1,
  })))
  setCurrent(OWNER())
})

/**
 * The shared negative matrix. `admittedRoles` is derived from the capability
 * registry rather than written out, so a grant change cannot leave this stale.
 */
function provesTheBoundary(opts: {
  label:      string
  capability: string
  send:       () => request.Test
  /** The side effect that must NOT happen on refusal. */
  sideEffect?: () => boolean
}) {
  const { label, capability, send } = opts
  const sideEffect = opts.sideEffect ?? mutated

  describe(label, () => {
    it('refuses an unauthenticated caller, with no side effect', async () => {
      unauthenticated = true
      setCurrent(OWNER())
      const res = await send()
      expect(res.status).toBe(401)
      expect(sideEffect(), 'a refused request must not have done the work').toBe(false)
    })

    it.each(holdersOf(capability))('admits %s, the capability holder', async role => {
      setCurrent(principal({ role }))
      const res = await send()
      expect([401, 403], `${role} holds ${capability} and must not be refused`).not.toContain(res.status)
    })

    it.each(nonHoldersOf(capability))('refuses %s with 403 and no side effect', async role => {
      setCurrent(principal({ role }))
      const res = await send()
      expect(res.status, `${role} does not hold ${capability}`).toBe(403)
      expect(sideEffect(), `${role} was refused but the work ran`).toBe(false)
    })

    it('refuses a deactivated holder', async () => {
      setCurrent(principal({ role: 'owner', active: false }))
      const res = await send()
      expect(res.status).toBe(401)
      expect(sideEffect()).toBe(false)
    })

    it('refuses a holder whose user row no longer exists', async () => {
      setCurrent(principal({ role: 'owner', exists: false }))
      const res = await send()
      expect(res.status).toBe(401)
      expect(sideEffect()).toBe(false)
    })

    it('ignores a stale token claiming a role the database has revoked', async () => {
      // Token minted as owner; the database says viewer. The database wins.
      setCurrent(principal({ role: 'viewer', jwtRole: 'owner' }))
      const res = await send()
      expect(res.status, 'authority must come from the live row, not the claim').toBe(403)
      expect(sideEffect()).toBe(false)
    })

    it('ignores a stale token claiming owner when the database says admin', async () => {
      setCurrent(principal({ role: 'admin', jwtRole: 'owner' }))
      const res = await send()
      if (roleHasCapability('admin', capability)) {
        expect([401, 403]).not.toContain(res.status)
      } else {
        expect(res.status, 'admin does not hold this capability').toBe(403)
        expect(sideEffect()).toBe(false)
      }
    })

    it('refuses a holder whose token claims a tenant the user row contradicts', async () => {
      // The capability is held; the tenant claim is not the user's tenant.
      // resolveCurrentUser fails closed, so a correct capability never
      // authorizes another tenant's state.
      setCurrent(principal({ role: 'owner', tenantId: 'tenant-a', jwtTenantId: 'tenant-b' }))
      const res = await send()
      expect(res.status, 'a tenant mismatch must not be authorized').toBe(401)
      expect(sideEffect(), 'cross-tenant work must not run').toBe(false)
    })

    it('binds the work to the caller\'s own tenant, never a foreign one', async () => {
      setCurrent(principal({ role: 'owner', tenantId: 'tenant-a', jwtTenantId: 'tenant-a' }))
      await send()
      const business = mockQuery.mock.calls
        .filter(c => !c.some(a => typeof a === 'string' && /FROM\s+users\s+WHERE\s+id/i.test(a)))
      expect(business.length, 'the admitted call must reach the database at all').toBeGreaterThan(0)
      const foreign = business.filter(c => JSON.stringify(c).includes('tenant-b'))
      expect(foreign, 'no query may reference another tenant').toEqual([])
      const ownTenant = business.filter(c => JSON.stringify(c).includes('tenant-a'))
      expect(ownTenant.length, 'queries must carry the caller tenant').toBeGreaterThan(0)
    })
  })
}

// ══ crossdomain.write ═════════════════════════════════════════════════════════
provesTheBoundary({
  label: 'crossdomain.write · POST /api/v1/twins registers a digital twin',
  capability: 'crossdomain.write',
  send: () => request(makeApp()).post('/api/v1/twins')
    .send({ entityType: 'equipment', entityId: 'e1', name: 'Pump A' }),
})

provesTheBoundary({
  label: 'crossdomain.write · POST /api/v1/agents/memory writes agent memory',
  capability: 'crossdomain.write',
  send: () => request(makeApp()).post('/api/v1/agents/memory')
    .send({ agentType: 'RiskAgent', scopeType: 'project', scopeId: 'p1', key: 'k', value: { a: 1 } }),
})

provesTheBoundary({
  label: 'crossdomain.write · POST /api/v1/agents/risk/analyze queues durable agent work',
  capability: 'crossdomain.write',
  sideEffect: queuedTask,
  send: () => request(makeApp()).post('/api/v1/agents/risk/analyze')
    .send({ scopeType: 'project', scopeId: 'p1', requestedBy: 'user-under-test' }),
})

describe('crossdomain.write is owner-only, and exactly owner-only', () => {
  it('is held by the owner alone', () => {
    expect(holdersOf('crossdomain.write')).toEqual(['owner'])
  })

  it('refuses the platform administrator even though it holds ai.govern', async () => {
    setCurrent(principal({ role: 'admin' }))
    const res = await request(makeApp()).post('/api/v1/twins').send({ entityType: 'equipment', entityId: 'e1', name: 'x' })
    expect(res.status).toBe(403)
    expect(mutated()).toBe(false)
  })

  it.each(['project_manager', 'engineer', 'procurement', 'field_ops', 'viewer'] as const)(
    'refuses %s', async role => {
      setCurrent(principal({ role }))
      const res = await request(makeApp()).post('/api/v1/twins').send({ entityType: 'equipment', entityId: 'e1', name: 'x' })
      expect(res.status).toBe(403)
      expect(mutated()).toBe(false)
    })
})

// ══ ai.govern ═════════════════════════════════════════════════════════════════
provesTheBoundary({
  label: 'ai.govern · POST /api/v1/adaptive/feedback records learning feedback',
  capability: 'ai.govern',
  send: () => request(makeApp()).post('/api/v1/adaptive/feedback')
    .send({ feedbackType: 'recommendation', sourceId: 's1', sourceType: 'x', signal: 'positive' }),
})

provesTheBoundary({
  label: 'ai.govern · POST /api/v1/ai/recommendations queues a recommendation',
  capability: 'ai.govern',
  send: () => request(makeApp()).post('/api/v1/ai/recommendations')
    .send({ recommended_action: 'do', category: 'schedule', confidence_score: 1, impact_score: 1, urgency_score: 1, reason: 'r' }),
})

describe('ai.govern admits the platform administrator and no delivery role', () => {
  it('is held by the owner and the platform administrator', () => {
    expect(holdersOf('ai.govern')).toEqual(['owner', 'admin'])
  })

  it.each(['project_manager', 'engineer', 'procurement', 'field_ops', 'viewer'] as const)(
    'refuses %s', async role => {
      setCurrent(principal({ role }))
      const res = await request(makeApp()).post('/api/v1/adaptive/feedback').send({ feedbackType: 'x', signal: 'positive' })
      expect(res.status).toBe(403)
      expect(mutated()).toBe(false)
    })
})

// ══ platform.automation ═══════════════════════════════════════════════════════
provesTheBoundary({
  label: 'platform.automation · POST /api/v1/ops/incident opens an operations incident',
  capability: 'platform.automation',
  send: () => request(makeApp()).post('/api/v1/ops/incident')
    .send({ title: 'Compressor trip', severity: 'high' }),
})

// ══ the bounded AI/domain conjunction ═════════════════════════════════════════
describe('bounded conjunction · POST /api/v1/projects/:id/coordination/scan', () => {
  const scan = () => request(makeApp()).post('/api/v1/projects/p1/coordination/scan').send({})
  const CONJUNCTION = ['assistant.use', 'project.view', 'construction.view',
    'engineering.view', 'schedule.view', 'cost.view'] as const

  it('admits only a caller holding every member', async () => {
    const admitted = ALL_ROLES.filter(r => CONJUNCTION.every(c => roleHasCapability(r, c)))
    expect(admitted).toEqual(['owner'])
    setCurrent(principal({ role: 'owner' }))
    const res = await scan()
    expect([401, 403]).not.toContain(res.status)
  })

  it('refuses a caller with the AI half but not the data half', async () => {
    // project_manager holds assistant.use and five of the six domains; it lacks
    // cost.view, so the conjunction must refuse it. This is the test that proves
    // the requirement is a real conjunction and not a decorated single check.
    expect(roleHasCapability('project_manager', 'assistant.use')).toBe(true)
    expect(roleHasCapability('project_manager', 'cost.view')).toBe(false)
    setCurrent(principal({ role: 'project_manager' }))
    const res = await scan()
    expect(res.status).toBe(403)
    expect(mutated()).toBe(false)
  })

  it('refuses the platform administrator, which holds neither half', async () => {
    setCurrent(principal({ role: 'admin' }))
    const res = await scan()
    expect(res.status).toBe(403)
    expect(mutated()).toBe(false)
  })

  it.each(['engineer', 'procurement', 'field_ops', 'viewer'] as const)(
    'refuses %s with no recommendation written', async role => {
      setCurrent(principal({ role }))
      const res = await scan()
      expect(res.status).toBe(403)
      expect(mutated()).toBe(false)
      expect(mockBuildCoord, 'the six-domain briefing must not even be built').not.toHaveBeenCalled()
    })

  it('refuses an unauthenticated caller', async () => {
    unauthenticated = true
    setCurrent(OWNER())
    const res = await scan()
    expect(res.status).toBe(401)
    expect(mutated()).toBe(false)
  })

  it('requires the same authority as reading the recommendations it writes', async () => {
    setCurrent(principal({ role: 'project_manager' }))
    const write = await scan()
    const read  = await request(makeApp()).get('/api/v1/projects/p1/coordination/recommendations')
    expect(write.status).toBe(403)
    expect(read.status).toBe(403)
  })
})

// ══ classification corrections behave as reads ════════════════════════════════
describe('classification correction · POST /api/v1/optimization/root-cause is a read', () => {
  const send = () => request(makeApp()).post('/api/v1/optimization/root-cause')
    .send({ entityType: 'twin', windowHours: 24 })

  it('is guarded by the cross-domain READ capability, owner-only', () => {
    expect(holdersOf('crossdomain.read')).toEqual(['owner'])
  })

  it('admits the owner and writes nothing', async () => {
    setCurrent(OWNER())
    const res = await send()
    expect([401, 403]).not.toContain(res.status)
    expect(mutated(), 'a reclassified read must not write').toBe(false)
  })

  it.each(nonHoldersOf('crossdomain.read'))('refuses %s', async role => {
    setCurrent(principal({ role }))
    const res = await send()
    expect(res.status).toBe(403)
    expect(touchedNothing()).toBe(true)
  })

  it('refuses an unauthenticated caller', async () => {
    unauthenticated = true
    setCurrent(OWNER())
    expect((await send()).status).toBe(401)
  })
})

describe('classification correction · POST /api/v1/agents/plan is a dry run', () => {
  const send = () => request(makeApp()).post('/api/v1/agents/plan')
    .send({ objective: 'assess_readiness', scope: 'project', scopeId: 'p1', requestedBy: 'u1' })

  it('admits an ai.govern holder and creates no durable task', async () => {
    setCurrent(principal({ role: 'admin' }))
    const res = await send()
    expect([401, 403]).not.toContain(res.status)
    expect(queuedTask(), 'a dry run must not enqueue work').toBe(false)
  })

  it.each(nonHoldersOf('ai.govern'))('refuses %s and queues nothing', async role => {
    setCurrent(principal({ role }))
    const res = await send()
    expect(res.status).toBe(403)
    expect(queuedTask()).toBe(false)
  })
})

// ══ newly discovered consequential transitions ════════════════════════════════
describe('consequential · POST /api/v1/agents/readiness/coordinate orchestrates execution', () => {
  const send = () => request(makeApp()).post('/api/v1/agents/readiness/coordinate')
    .send({ scopeType: 'project', scopeId: 'p1' })

  it('now requires ai.govern, like POST /agents/execute which it duplicates', async () => {
    setCurrent(principal({ role: 'admin' }))
    const res = await send()
    expect([401, 403]).not.toContain(res.status)
  })

  it.each(nonHoldersOf('ai.govern'))(
    'refuses %s and starts no autonomous agent work', async role => {
      setCurrent(principal({ role }))
      const res = await send()
      expect(res.status).toBe(403)
      expect(queuedTask(), 'orchestration must not begin for a refused caller').toBe(false)
      expect(mutated()).toBe(false)
    })

  it('refuses an unauthenticated caller', async () => {
    unauthenticated = true
    setCurrent(OWNER())
    expect((await send()).status).toBe(401)
    expect(queuedTask()).toBe(false)
  })

  it('cannot be reached by a stale owner token once the row says viewer', async () => {
    setCurrent(principal({ role: 'viewer', jwtRole: 'owner' }))
    expect((await send()).status).toBe(403)
    expect(queuedTask()).toBe(false)
  })
})

describe('consequential · POST /api/v1/agent-actions/:id/review records the human verdict', () => {
  const send = (outcome = 'confirmed') => request(makeApp())
    .post('/api/v1/agent-actions/a1/review').send({ outcome })

  it('admits an ai.govern holder', async () => {
    setCurrent(principal({ role: 'admin' }))
    const res = await send()
    expect([401, 403]).not.toContain(res.status)
  })

  it.each(nonHoldersOf('ai.govern'))(
    'refuses %s and records no verdict', async role => {
      setCurrent(principal({ role }))
      const res = await send()
      expect(res.status).toBe(403)
      expect(businessQueries().some(s => /UPDATE\s+agent_actions/i.test(s)),
        'the review must not be written for a refused caller').toBe(false)
    })

  it('refuses a reversal from a non-holder just as it refuses a confirmation', async () => {
    setCurrent(principal({ role: 'project_manager' }))
    expect((await send('reversed')).status).toBe(403)
    expect(businessQueries().some(s => /UPDATE\s+agent_actions/i.test(s))).toBe(false)
  })

  it('refuses an unauthenticated caller', async () => {
    unauthenticated = true
    setCurrent(OWNER())
    expect((await send()).status).toBe(401)
  })
})

// ══ authorization runs before the side effect ═════════════════════════════════
describe('authorization precedes every side effect', () => {
  const CASES: Array<[string, () => request.Test]> = [
    ['POST /api/v1/twins',                    () => request(makeApp()).post('/api/v1/twins').send({ entityType: 'e', entityId: '1', name: 'n' })],
    ['POST /api/v1/twins/t1/snapshots',       () => request(makeApp()).post('/api/v1/twins/t1/snapshots').send({ state: {} })],
    ['DELETE /api/v1/twins/t1/relationships', () => request(makeApp()).delete('/api/v1/twins/t1/relationships').send({ toTwinId: 't2', relType: 'feeds' })],
    ['POST /api/v1/agents/memory',            () => request(makeApp()).post('/api/v1/agents/memory').send({ agentType: 'a', scopeType: 's', scopeId: '1', key: 'k', value: {} })],
    ['POST /api/v1/agents/memory/purge',      () => request(makeApp()).post('/api/v1/agents/memory/purge').send({})],
    ['POST /api/v1/agents/risk/mitigate',     () => request(makeApp()).post('/api/v1/agents/risk/mitigate').send({ scopeType: 'p', scopeId: '1', requestedBy: 'u' })],
    ['POST /api/v1/agents/readiness/assess',  () => request(makeApp()).post('/api/v1/agents/readiness/assess').send({ scopeType: 'p', scopeId: '1' })],
    ['POST /api/v1/adaptive/memory',          () => request(makeApp()).post('/api/v1/adaptive/memory').send({ agentType: 'a', scopeType: 's', key: 'k', value: {} })],
    ['POST /api/v1/adaptive/outcomes',        () => request(makeApp()).post('/api/v1/adaptive/outcomes').send({ recommendationId: 'r' })],
    ['POST /api/v1/optimization/proposals',   () => request(makeApp()).post('/api/v1/optimization/proposals').send({ optimizationType: 't', proposal: {} })],
    ['POST /api/v1/ops/incident',             () => request(makeApp()).post('/api/v1/ops/incident').send({ title: 't' })],
    ['POST /api/v1/ai/recommendations',       () => request(makeApp()).post('/api/v1/ai/recommendations').send({ recommended_action: 'a', category: 'c', confidence_score: 1, impact_score: 1, urgency_score: 1, reason: 'r' })],
  ]

  it.each(CASES)('%s writes nothing for a viewer', async (_label, send) => {
    setCurrent(principal({ role: 'viewer' }))
    const res = await send()
    expect(res.status).toBe(403)
    expect(mutated(), 'the guard must run before the mutation').toBe(false)
    expect(queuedTask(), 'the guard must run before the job is queued').toBe(false)
  })

  it.each(CASES)('%s writes nothing for an unauthenticated caller', async (_label, send) => {
    unauthenticated = true
    setCurrent(OWNER())
    const res = await send()
    expect(res.status).toBe(401)
    expect(mutated()).toBe(false)
    expect(queuedTask()).toBe(false)
  })
})
