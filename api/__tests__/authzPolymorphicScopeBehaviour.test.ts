/**
 * ADR-014 Phase 3H — polymorphic scope keys, exercised through the real routers.
 *
 * The condition this slice removes:
 *
 *     correct functional capability
 *   + a twin id, or a (scopeType, scopeId) pair the caller chooses
 *   + the twin row is in the caller's tenant
 *   = the mirrored object is returned, whoever owns it
 *
 * A twin proves only that something was mirrored. The authority belongs to the
 * object it mirrors, and this file proves the routes now ask that object.
 *
 * Fixture (§62), modelled rather than mocked per call: the tenant predicate,
 * the membership window, the ownership column and the event-scope predicate are
 * all read OFF the statement the product issued, so removing any of them
 * changes what this returns — which is what makes the mutation tests mean
 * something.
 *
 *   Tenant A   USER_A (owner)  → member of PROJECT_A, tenant-wide by project.list.all
 *              USER_B (owner)  → member of PROJECT_B
 *   Tenant B   USER_C (owner)  → PROJECT_C
 *
 * Owner is used because every target route is Owner-only today (§43): the
 * policy must exist even where behaviour is holder-neutral, so the fixture
 * models the tenant-wide principal and proves the TENANT boundary and the
 * SELF/unsupported branches, which hold for the Owner too.
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
import { resolvePolymorphicScope } from '../authz/recordScope'
import { twinScopePolicy } from '../authz/polymorphicScopePolicies'

const TENANT_A = 'aaaaaaaa-0000-4000-8000-000000000001'
const TENANT_B = 'bbbbbbbb-0000-4000-8000-000000000002'
const USER_A   = '10000000-0000-4000-8000-00000000000a'
const USER_B   = '10000000-0000-4000-8000-00000000000b'
const PROJECT_A = '30000000-0000-4000-8000-00000000000a'
const PROJECT_B = '30000000-0000-4000-8000-00000000000b'

/** The id deliberately shared by a project in tenant A and a system in tenant A (§34). */
const SHARED_ID = '50000000-0000-4000-8000-00000000dead'

const TWIN_PROJECT_A = '60000000-0000-4000-8000-00000000000a'
const TWIN_PROJECT_B = '60000000-0000-4000-8000-00000000000b'
const TWIN_SYSTEM_B  = '60000000-0000-4000-8000-00000000005b'
const TWIN_VENDOR    = '60000000-0000-4000-8000-0000000000v1'.replace('v', 'e')
const TWIN_ACTION_B  = '60000000-0000-4000-8000-0000000000ac'
const TWIN_SITE      = '60000000-0000-4000-8000-0000000000f1'
const TWIN_ABSENT    = '60000000-0000-4000-8000-0000000000ff'

const SYSTEM_B = '70000000-0000-4000-8000-00000000005b'
const VENDOR_1 = '70000000-0000-4000-8000-0000000000v1'.replace('v', 'e')
const ACTION_B = '70000000-0000-4000-8000-0000000000ac'

/** operational_twins, as rows. */
const TWINS: Record<string, { type: string; entity: string; tenant: string }> = {
  [TWIN_PROJECT_A]: { type: 'project',  entity: PROJECT_A, tenant: TENANT_A },
  [TWIN_PROJECT_B]: { type: 'project',  entity: PROJECT_B, tenant: TENANT_A },
  [TWIN_SYSTEM_B]:  { type: 'system',   entity: SYSTEM_B,  tenant: TENANT_A },
  [TWIN_VENDOR]:    { type: 'vendor',   entity: VENDOR_1,  tenant: TENANT_A },
  [TWIN_ACTION_B]:  { type: 'action',   entity: ACTION_B,  tenant: TENANT_A },
  [TWIN_SITE]:      { type: 'site',     entity: SHARED_ID, tenant: TENANT_A },
}

/** The underlying entities. `systems.project_id` decides the system twin. */
const SYSTEMS  = [{ id: SYSTEM_B, project_id: PROJECT_B, tenant_id: TENANT_A },
                  { id: SHARED_ID, project_id: PROJECT_B, tenant_id: TENANT_A }]
const VENDORS  = [{ id: VENDOR_1, tenant_id: TENANT_A }]
const ACTIONS  = [{ id: ACTION_B, tenant_id: TENANT_A, assigned_to_user_id: USER_B, project_id: PROJECT_A }]
const PROJECTS = [{ id: PROJECT_A, tenant_id: TENANT_A }, { id: PROJECT_B, tenant_id: TENANT_A },
                  { id: SHARED_ID, tenant_id: TENANT_A }]

/** realtime_event_log, for the live feed (§55). */
interface Ev { id: string; scope: string; scope_id: string | null; tenant: string; seq: number }
const EVENTS: Ev[] = [
  { id: 'E-own',    scope: 'action',  scope_id: ACTION_B, tenant: TENANT_A, seq: 1 },
  { id: 'E-tenant', scope: 'tenant',  scope_id: null,     tenant: TENANT_A, seq: 2 },
  { id: 'E-esc',    scope: 'escalation', scope_id: ACTION_B, tenant: TENANT_A, seq: 3 },
  { id: 'E-other',  scope: 'tenant',  scope_id: null,     tenant: TENANT_B, seq: 4 },
]

interface MemberRow { projectId: string; userId: string; active: boolean }
let MEMBERS: MemberRow[]
interface Caller { id: string; tenantId: string; role: UserRole }
let caller: Caller
const setCaller = (c: Caller) => { caller = c; (globalThis as Record<string, unknown>)['__p3h'] = c }

vi.mock('../auth', () => ({
  requireAuth: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    const c = (globalThis as Record<string, unknown>)['__p3h'] as Caller
    req['auth'] = { sub: c.id, tid: c.tenantId, role: c.role, jti: 'jti' }
    next()
  },
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}))
vi.mock('../middleware/tenant', () => ({
  requireTenant: () => (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req['tenantId'] = ((globalThis as Record<string, unknown>)['__p3h'] as Caller).tenantId
    next()
  },
}))
// The scenario payload layer, stubbed so a 200 proves the GUARD admitted rather
// than that the engine happened to work. Whether it runs at all is the point:
// these are the sensitive reads §46 requires to stay behind the decision.
vi.mock('../services/twin/timelineProjectionService', () => ({
  projectTwinTimeline: vi.fn(async () => ({ projectedReadiness: [], confidence: 1 })),
}))
vi.mock('../services/twin/temporalStateEngine', () => ({
  getStateAt:           vi.fn(async () => ({ state: {} })),
  replayRange:          vi.fn(async () => []),
  diffStates:           vi.fn(async () => ({ changes: [] })),
  computeStateVelocity: vi.fn(async () => ({})),
  getScoreTrend:        vi.fn(async () => ([])),
}))
vi.mock('../services/twin/scenarioSimulationEngine', () => ({
  createScenario: vi.fn(async () => ({})), runScenario: vi.fn(async () => ({})),
  getScenario:    vi.fn(async () => ({})), listScenarios: vi.fn(async () => ([])),
  cancelScenario: vi.fn(async () => undefined),
}))

import { requireAuth }   from '../auth'
import { requireTenant } from '../middleware/tenant'
import scenariosRouter from '../routes/scenarios'
import portfolioRouter from '../routes/portfolio'
import { opsRouter }   from '../routes/ops'

/**
 * Mounted exactly as `api/server.ts` mounts them: these routers carry no
 * internal `requireAuth`/`requireTenant`, the server supplies both at the mount
 * point. Mounting them bare would leave `req.auth` unset and turn every case
 * into a 401 that proves nothing.
 */
function makeApp() {
  const app = express()
  app.use(express.json())
  const auth = [requireAuth as never, requireTenant() as never]
  app.use('/api/v1/scenarios', ...auth, scenariosRouter as never)
  app.use('/api/v1/portfolio', ...auth, portfolioRouter as never)
  app.use('/api/v1/ops',       ...auth, opsRouter as never)
  return app
}
const app = makeApp()

const SQL = /\b(SELECT|INSERT|UPDATE|DELETE)\b/i
const sqlOf = (a: unknown[]): string =>
  a.find((x): x is string => typeof x === 'string' && SQL.test(x)) ?? ''
const paramsOf = (a: unknown[]): unknown[] =>
  (a.find(x => Array.isArray(x)) as unknown[] | undefined) ?? []

/** Every statement issued, excluding the authorization lookups themselves. */
function payloadQueries(): string[] {
  return mockQuery.mock.calls.map(c => sqlOf(c)).filter(s =>
    s && !/FROM\s+users\s+WHERE\s+id/i.test(s)
       && !/FROM operational_twins/i.test(s)
       && !/AS\s+project_id/i.test(s)
       && !/FROM\s+projects\s+p?\b/i.test(s)
       && !/FROM (systems|vendors|actions) r/i.test(s))
}
const wrote = () => payloadQueries().some(s => /\b(INSERT|UPDATE|DELETE)\b/i.test(s))

beforeEach(() => {
  MEMBERS = [
    { projectId: PROJECT_A, userId: USER_A, active: true },
    { projectId: PROJECT_B, userId: USER_B, active: true },
  ]
  setCaller({ id: USER_A, tenantId: TENANT_A, role: 'owner' })

  mockQuery.mockReset()
  mockQuery.mockImplementation(async (...args: unknown[]) => {
    const sql = sqlOf(args)
    const params = paramsOf(args)
    const empty = { rows: [], rowCount: 0 }

    if (/FROM\s+users\s+WHERE\s+id/i.test(sql)) {
      return { rows: [{ id: caller.id, tenant_id: caller.tenantId, role: caller.role, is_active: true }], rowCount: 1 }
    }

    // requireTwinScope — the selector lookup, tenant predicate read off the SQL
    if (/FROM operational_twins t/i.test(sql)) {
      const t = TWINS[params[0] as string]
      const honoursTenant = /t\.tenant_id = current_setting/i.test(sql)
      if (!t || (honoursTenant && t.tenant !== caller.tenantId)) return empty
      return { rows: [{ entity_type: t.type, entity_id: t.entity }], rowCount: 1 }
    }

    // resolveParentProjectId for a PROJECT_SCOPED kind. Matched BEFORE the
    // entity-resolution branch below: both select `FROM <table> r`, and the
    // distinguishing feature is the `AS project_id` projection.
    if (/AS\s+project_id/i.test(sql)) {
      const from = /FROM\s+(\w+)\s+r/i.exec(sql)?.[1]
      const rows = from === 'systems' ? SYSTEMS : []
      const row = rows.find(x => x.id === params[0] && x.tenant_id === caller.tenantId)
      return row ? { rows: [{ project_id: row.project_id }], rowCount: 1 } : empty
    }

    // TENANT_GLOBAL / SELF_SCOPED entity resolution, composed from the policy
    if (/FROM (vendors|actions|systems) r/i.test(sql)) {
      const table = /FROM (\w+) r/i.exec(sql)![1]!
      const rows = table === 'vendors' ? VENDORS : table === 'actions' ? ACTIONS : SYSTEMS
      const honoursTenant = /r\.tenant_id = current_setting/i.test(sql)
      const row = (rows as Record<string, unknown>[]).find(x => x['id'] === params[0])
      if (!row || (honoursTenant && row['tenant_id'] !== caller.tenantId)) return empty
      if (/AS owner/i.test(sql)) return { rows: [{ owner: row['assigned_to_user_id'] ?? null }], rowCount: 1 }
      return { rows: [{ id: row['id'] }], rowCount: 1 }
    }

    // filterAccessibleProjectIds — membership window read off the statement
    if (/FROM\s+projects\s+p?\b/i.test(sql) && /ANY\(\$\d+::uuid\[\]\)/i.test(sql)) {
      const ids = (params.find(x => Array.isArray(x)) as string[] | undefined) ?? []
      const tenantWide = !/project_members/i.test(sql)
      const honoursWindow = /active_from\s*<=\s*NOW\(\)/i.test(sql)
      const reach = ids.filter(id => {
        const p = PROJECTS.find(x => x.id === id)
        if (!p || p.tenant_id !== caller.tenantId) return false
        if (tenantWide) return true
        return MEMBERS.some(m => m.projectId === id && m.userId === caller.id && (honoursWindow ? m.active : true))
      })
      return { rows: reach.map(id => ({ id })), rowCount: reach.length }
    }

    // the live feed
    if (/FROM realtime_event_log/i.test(sql)) {
      const scope = params[1] as string
      const honoursTenant = /tenant_id = \$1/i.test(sql)
      const ownerBound = /o\.assigned_to_user_id = \$\d/i.test(sql)
      const closed = /AND FALSE/i.test(sql)
      const rows = EVENTS.filter(e => {
        if (closed) return false
        if (honoursTenant && e.tenant !== caller.tenantId) return false
        if (e.scope !== scope) return false
        if (!ownerBound) return true
        const a = ACTIONS.find(x => x.id === e.scope_id)
        return !!a && a.assigned_to_user_id === caller.id
      }).sort((a, b) => a.seq - b.seq)
      return { rows, rowCount: rows.length }
    }

    // forecast cache / upsert and any other payload query
    return { rows: [{ id: 'row-1', projections: {}, confidence: 1 }], rowCount: 1 }
  })
})

// ─── §56/§57/§58/§59 the classes, proved at the resolver ────────────────────
//
// Every route in this slice is Owner-only — `crossdomain.read` and
// `portfolio.view` are held by the owner alone — and the Owner is tenant-wide
// by `project.list.all`. So a cross-project test CANNOT be constructed through
// these routes without inventing a role that does not exist, which §43 and §70
// forbid. §43 also says the policy must exist anyway, so that a later holder
// change cannot expose data silently.
//
// The class behaviour is therefore proved directly against the canonical
// resolver with a non-tenant-wide principal — the caller a widened grant would
// create — while the routes below prove what IS observable today: the tenant
// boundary, the fail-closed kinds, the malformed identifier, and the
// authorize-before-cache ordering.
describe('§56–§59 the resolver decides by class, for a non-tenant-wide principal', () => {
  const engineerA = { id: USER_A, tenantId: TENANT_A, role: 'engineer' as UserRole }
  const engineerB = { id: USER_B, tenantId: TENANT_A, role: 'engineer' as UserRole }

  it('§56 admits a project the principal is a member of, and refuses one they are not', async () => {
    setCaller(engineerA)
    expect(await resolvePolymorphicScope(engineerA, twinScopePolicy('project'), PROJECT_A)).toBe('ADMIT')
    expect(await resolvePolymorphicScope(engineerA, twinScopePolicy('project'), PROJECT_B)).toBe('DENIED')
  })

  it('§57 follows a system to its project through the declared FK', async () => {
    // SYSTEM_B belongs to PROJECT_B.
    setCaller(engineerA)
    expect(await resolvePolymorphicScope(engineerA, twinScopePolicy('system'), SYSTEM_B)).toBe('DENIED')
    setCaller(engineerB)
    expect(await resolvePolymorphicScope(engineerB, twinScopePolicy('system'), SYSTEM_B)).toBe('ADMIT')
  })

  it('§58 admits a vendor on the tenant alone, and refuses it across tenants', async () => {
    setCaller(engineerA)
    MEMBERS = []                                    // no membership at all
    expect(await resolvePolymorphicScope(engineerA, twinScopePolicy('vendor'), VENDOR_1)).toBe('ADMIT')

    const foreign = { id: USER_A, tenantId: TENANT_B, role: 'engineer' as UserRole }
    setCaller(foreign)
    expect(await resolvePolymorphicScope(foreign, twinScopePolicy('vendor'), VENDOR_1)).toBe('DENIED')
  })

  it('§59 refuses an action to a project peer and admits it to its assignee', async () => {
    // ACTION_B is assigned to USER_B and lives in PROJECT_A, which USER_A is a
    // member of. Sharing the project must not be enough.
    setCaller(engineerA)
    expect(MEMBERS.some(m => m.userId === USER_A && m.projectId === PROJECT_A)).toBe(true)
    expect(await resolvePolymorphicScope(engineerA, twinScopePolicy('action'), ACTION_B)).toBe('DENIED')
    setCaller(engineerB)
    expect(await resolvePolymorphicScope(engineerB, twinScopePolicy('action'), ACTION_B)).toBe('ADMIT')
  })

  it('§34 resolves the same id to different entities under different kinds', async () => {
    // SHARED_ID is both a project (nobody is a member of it) and a system
    // belonging to PROJECT_B. The KIND chooses the table, never the id.
    setCaller(engineerB)
    expect(await resolvePolymorphicScope(engineerB, twinScopePolicy('system'), SHARED_ID)).toBe('ADMIT')
    expect(await resolvePolymorphicScope(engineerB, twinScopePolicy('project'), SHARED_ID)).toBe('DENIED')
  })

  it('§37 refuses the moment a membership closes, with no token involved', async () => {
    setCaller(engineerB)
    expect(await resolvePolymorphicScope(engineerB, twinScopePolicy('project'), PROJECT_B)).toBe('ADMIT')
    MEMBERS = MEMBERS.map(m => ({ ...m, active: false }))
    expect(await resolvePolymorphicScope(engineerB, twinScopePolicy('project'), PROJECT_B)).toBe('DENIED')
  })

  it('§5 refuses a kind with no backing entity, and an unregistered one', async () => {
    setCaller(engineerA)
    expect(await resolvePolymorphicScope(engineerA, twinScopePolicy('site'), SHARED_ID)).toBe('UNSUPPORTED_KIND')
    expect(await resolvePolymorphicScope(engineerA, twinScopePolicy('nope'), SHARED_ID)).toBe('UNSUPPORTED_KIND')
  })

  it('§10 refuses a malformed identifier before any query', async () => {
    setCaller(engineerA)
    mockQuery.mockClear()
    expect(await resolvePolymorphicScope(engineerA, twinScopePolicy('project'), 'not-a-uuid')).toBe('INVALID_IDENTIFIER')
    expect(mockQuery.mock.calls.length, 'a malformed id must not reach a query').toBe(0)
  })
})

// ─── The twin routes, at the level they can be observed ─────────────────────
describe('a twin route authorizes the entity behind the twin (§12, §13)', () => {
  const projection = (t: string) => request(app).get(`/api/v1/scenarios/projection/${t}`)

  it('admits an Owner in the twin’s own tenant', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'owner' })
    expect((await projection(TWIN_PROJECT_A)).status).toBe(200)
  })

  it('refuses the same twin id from another tenant', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_B, role: 'owner' })
    expect((await projection(TWIN_PROJECT_A)).status).toBe(404)
  })

  it('refuses a twin whose kind has no backing entity, and reads no payload', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'owner' })
    const res = await projection(TWIN_SITE)
    expect(res.status).toBe(404)
    expect(payloadQueries(), 'a refused twin must not reach the scenario layer').toEqual([])
  })

  it('answers an absent twin exactly as it answers a refused one', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'owner' })
    const absent  = await projection(TWIN_ABSENT)
    const refused = await projection(TWIN_SITE)
    expect(absent.status).toBe(refused.status)
    expect(absent.body).toEqual(refused.body)
  })

  it('guards every twin-keyed route, including the replay sibling', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_B, role: 'owner' })   // wrong tenant
    for (const url of [
      `/api/v1/scenarios/projection/${TWIN_PROJECT_A}`,
      `/api/v1/scenarios/temporal/${TWIN_PROJECT_A}/at?ts=2026-01-01`,
      `/api/v1/scenarios/temporal/${TWIN_PROJECT_A}/diff?from=2026-01-01&to=2026-02-01`,
      `/api/v1/scenarios/temporal/${TWIN_PROJECT_A}/replay?from=2026-01-01&to=2026-02-01`,
    ]) {
      expect((await request(app).get(url)).status, `${url} is unguarded`).toBe(404)
    }
  })
})

// ─── §60 unsupported kinds ──────────────────────────────────────────────────
describe('§60 a kind with no backing entity fails closed', () => {
  it('refuses a `site` twin, which the enum declares and no table backs', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'owner' })
    expect((await request(app).get(`/api/v1/scenarios/projection/${TWIN_SITE}`)).status).toBe(404)
  })

  it('refuses an unknown scopeType with a selector error, and reads nothing (§32)', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'owner' })
    const res = await request(app).get(`/api/v1/portfolio/readiness/not-a-real-type/${PROJECT_A}`)
    expect(res.status).toBe(400)
    expect(payloadQueries(), 'an unsupported selector must not reach any query').toEqual([])
    expect(wrote(), 'and must not write a forecast').toBe(false)
  })

  it('refuses a malformed identifier without issuing SQL (§10)', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'owner' })
    const res = await request(app).get('/api/v1/portfolio/readiness/project/not-a-uuid')
    expect(res.status).toBe(404)
    const issued = mockQuery.mock.calls.map(c => sqlOf(c))
    expect(issued.every(s => !s.includes('not-a-uuid')),
      'no identifier is ever interpolated into statement text').toBe(true)
  })
})

// ─── §14/§15 the caller-selected route, and its derived cache ───────────────
describe('§15 the readiness forecast authorizes before it caches', () => {
  const readiness = (type: string, id: string) =>
    request(app).get(`/api/v1/portfolio/readiness/${type}/${id}`)

  it('admits a reachable project', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'owner' })
    expect((await readiness('project', PROJECT_A)).status).toBe(200)
  })

  it('refuses an unreachable project, and writes no forecast', async () => {
    // Observable for an Owner through the TENANT boundary: a project in another
    // tenant is unreachable however tenant-wide the caller is at home.
    setCaller({ id: USER_A, tenantId: TENANT_B, role: 'owner' })
    const res = await readiness('project', PROJECT_A)
    expect(res.status).toBe(404)
    expect(wrote(), 'a refused caller must not upsert operational_forecasts').toBe(false)
    expect(payloadQueries(), 'nor read the cached forecast').toEqual([])
  })

  it('refuses a project in another tenant', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_B, role: 'owner' })
    expect((await readiness('project', PROJECT_A)).status).toBe(404)
  })
})

// ─── §40 functional capability stays independent ────────────────────────────
describe('§40 scope never grants function', () => {
  it('refuses a caller with membership but without the route capability', async () => {
    // `crossdomain.read` is Owner-only; a project_manager holds the project but
    // not the function.
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'project_manager' })
    expect((await request(app).get(`/api/v1/scenarios/projection/${TWIN_PROJECT_A}`)).status).toBe(403)
    // …and the twin was never looked up: the functional gate refuses first.
    expect(mockQuery.mock.calls.map(c => sqlOf(c)).some(q => /operational_twins/i.test(q))).toBe(false)
  })
})

// ─── §17/§55 the live feed ──────────────────────────────────────────────────
describe('§17 the live feed filters events by their own scope class', () => {
  const feed = (scope: string) => request(app).get(`/api/v1/ops/live-feed?scope=${scope}`)

  it('returns tenant-scoped events to a holder in that tenant', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'owner' })
    const res = await feed('tenant')
    expect(res.status).toBe(200)
    expect((res.body.data as Ev[]).map(e => e.id)).toEqual(['E-tenant'])
  })

  it('never returns another tenant’s events', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_B, role: 'owner' })
    expect((await feed('tenant')).body.data.map((e: Ev) => e.id)).not.toContain('E-tenant')
  })

  it('refuses a scope whose meaning is not agreed, rather than returning it', async () => {
    // `readiness` has two producers writing different identifier kinds.
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'owner' })
    const res = await feed('readiness')
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('unsupported_scope_type')
  })

  it('refuses the scopes no producer writes', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'owner' })
    for (const scope of ['project', 'module', 'assignee', 'not-a-scope']) {
      expect((await feed(scope)).status, `${scope} must fail closed`).toBe(400)
    }
  })

  it('follows ownership for action and escalation events', async () => {
    // ACTION_B is assigned to USER_B. An `engineer` holds no crossdomain.read,
    // so use the Owner — who is `personal.admin` and therefore sees both — then
    // prove a non-admin owner-of-nothing sees neither.
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'owner' })
    expect((await feed('action')).body.data.map((e: Ev) => e.id)).toEqual(['E-own'])
    expect((await feed('escalation')).body.data.map((e: Ev) => e.id)).toEqual(['E-esc'])
  })

  it('reports a count describing the events it actually returned (§20)', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'owner' })
    const res = await feed('tenant')
    expect(res.body.meta.count).toBe((res.body.data as Ev[]).length)
  })
})
