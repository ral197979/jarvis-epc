/**
 * ADR-014 Phase 3A — project record scope, exercised through the real router.
 *
 * The two authorization dimensions are INDEPENDENT, and this file proves each
 * can refuse on its own:
 *
 *   functional capability   may this principal read project context at all
 *   record scope            may this principal read THIS project
 *
 * A caller with the capability and no relationship is refused. A caller with a
 * relationship and no capability is refused. Neither implies the other, and
 * `project_manager` as a ROLE grants access to no project it is not attached to.
 *
 * Fixture (Phase 3A §14) — scope is the canonical responsible-user assignment
 * on the project row, so `projects.project_manager` is what puts a user in scope:
 *
 *   Tenant A   OWNER_A, USER_A, USER_B
 *              PROJECT_A  → USER_A in scope, USER_B out
 *              PROJECT_B  → USER_B in scope, USER_A out
 *   Tenant B   OWNER_B, USER_C
 *              PROJECT_C  → USER_C in scope
 *
 * The database is modelled rather than mocked per-call: the fixture answers the
 * principal lookup, the scope query and the payload query from the same rows, so
 * a test cannot pass by feeding the handler a reply it would never really get.
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

import type { UserRole } from '../authz/capabilities'

const TENANT_A = 'aaaaaaaa-0000-4000-8000-000000000001'
const TENANT_B = 'bbbbbbbb-0000-4000-8000-000000000002'

const OWNER_A  = '10000000-0000-4000-8000-000000000001'
const USER_A   = '10000000-0000-4000-8000-00000000000a'
const USER_B   = '10000000-0000-4000-8000-00000000000b'
const USER_C   = '20000000-0000-4000-8000-00000000000c'

const PROJECT_A = '30000000-0000-4000-8000-00000000000a'
const PROJECT_B = '30000000-0000-4000-8000-00000000000b'
const PROJECT_C = '30000000-0000-4000-8000-00000000000c'

interface ProjectRow {
  id: string; tenant_id: string
  project_manager: string | null; lead_engineer: string | null; created_by: string | null
  name: string; status: string; client_name: string
  budget: number; committed_cost: number; actual_cost: number; forecast_cost: number; contingency_pct: number
}

let PROJECTS: ProjectRow[]

const baseProject = (id: string, tenant: string, pm: string | null): ProjectRow => ({
  id, tenant_id: tenant, project_manager: pm, lead_engineer: null, created_by: null,
  name: `Project ${id.slice(-1).toUpperCase()}`, status: 'active', client_name: 'Acme Energy',
  budget: 1_000_000, committed_cost: 400_000, actual_cost: 250_000,
  forecast_cost: 900_000, contingency_pct: 10,
})

interface Caller {
  id: string; tenantId: string
  /** The role the DATABASE row carries — the live authority. */
  role: UserRole
  /** The role the TOKEN claims, when it deliberately disagrees with the row. */
  jwtRole?: UserRole
  active?: boolean; exists?: boolean
}
let caller: Caller
const setCaller = (c: Caller) => { caller = c; (globalThis as Record<string, unknown>)['__p3a'] = c }

vi.mock('../auth', () => ({
  requireAuth: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    const c = (globalThis as Record<string, unknown>)['__p3a'] as Caller
    req['auth'] = { sub: c.id, tid: c.tenantId, role: c.jwtRole ?? c.role, jti: 'jti' }
    next()
  },
  requireRole: () => (_r: unknown, _s: unknown, next: () => void) => next(),
}))
vi.mock('../middleware/tenant', () => {
  const mw = (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req['tenantId'] = ((globalThis as Record<string, unknown>)['__p3a'] as Caller).tenantId
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
vi.mock('../authz/transitionStates', () => ({
  guardTransitionOwnedState: () => (_r: unknown, _s: unknown, next: () => void) => next(),
}))

import projectsRouter from '../routes/projects'
import { filterAccessibleProjectIds, canAccessProject, resolveProjectScope } from '../authz/recordScope'

const makeApp = () => {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/projects', projectsRouter as never)
  return app
}

/** The SQL of one call — `query(sql, …)` vs `tenantQuery(tenant, sql, …)`. */
const sqlOf = (args: unknown[]): string =>
  (args.find(a => typeof a === 'string' && /\b(SELECT|INSERT|UPDATE|DELETE)\b/i.test(a)) as string) ?? ''
/** The tenant a tenantQuery was scoped to, or null for a bare query. */
const tenantOf = (args: unknown[]): string | null =>
  typeof args[0] === 'string' && !/\b(SELECT|INSERT|UPDATE|DELETE)\b/i.test(args[0]) ? args[0] : null

/** Which project ids the handler actually asked the scope query about. */
const scopeQueries = () => mockQuery.mock.calls.filter(c => /SELECT id FROM projects/i.test(sqlOf(c)))
/** Whether the expensive payload query ran at all. */
const payloadQueries = () => mockQuery.mock.calls.filter(c => /FROM projects p/i.test(sqlOf(c)))

beforeEach(() => {
  PROJECTS = [
    baseProject(PROJECT_A, TENANT_A, USER_A),
    baseProject(PROJECT_B, TENANT_A, USER_B),
    baseProject(PROJECT_C, TENANT_B, USER_C),
  ]
  mockQuery.mockReset()
  mockQuery.mockImplementation(async (...args: unknown[]) => {
    const sql = sqlOf(args)
    const tenant = tenantOf(args)
    const params = (args[args.length - 1] ?? []) as unknown[]

    // 1. Live principal.
    if (/FROM users/i.test(sql) && /is_active/i.test(sql)) {
      if (caller.exists === false) return { rows: [] }
      return { rows: [{ id: caller.id, tenant_id: caller.tenantId, role: caller.role, is_active: caller.active !== false }] }
    }

    // 2. Record scope.
    //
    // The fixture HONOURS the SQL it is given rather than reimplementing the
    // rule. If the production query stops asking for the tenant predicate or
    // the responsible-user predicate, this returns the extra rows a real
    // database would return — so deleting either predicate from
    // `recordScope.ts` is visible here as a behavioural failure, not merely as
    // a source-inspection failure.
    if (/SELECT id FROM projects/i.test(sql)) {
      const boundedByTenant = /tenant_id = current_setting/i.test(sql)
      const boundedByIds    = /id = ANY\(\$1::uuid\[\]\)/i.test(sql)
      // `filterAccessibleProjectIds` passes (ids, uid); `resolveProjectScope`
      // asks for the whole set and passes (uid) alone.
      const ids = boundedByIds ? (params[0] ?? []) as string[] : null
      const uid = (boundedByIds ? params[1] : params[0]) as string | undefined
      const boundedByMembership = /project_manager = \$\d/i.test(sql)

      const rows = PROJECTS
        .filter(p => !boundedByTenant || p.tenant_id === tenant)
        .filter(p => ids === null || ids.includes(p.id))
        .filter(p => !boundedByMembership || uid === undefined
          || p.project_manager === uid || p.lead_engineer === uid || p.created_by === uid)
        .map(p => ({ id: p.id }))
      return { rows }
    }

    // 3. Payload.
    if (/FROM projects p/i.test(sql)) {
      const row = PROJECTS.find(p => p.id === params[0] && p.tenant_id === tenant)
      return { rows: row ? [{ ...row, pm_name: 'PM', open_rfis: '2' }] : [] }
    }

    return { rows: [] }
  })
  setCaller({ id: OWNER_A, tenantId: TENANT_A, role: 'owner' })
})

const get = (project: string) => request(makeApp()).get(`/api/v1/projects/${project}`)

// ─── 1. Same-tenant cross-project isolation (§14, §40) ────────────────────────
describe('a non-owner reaches only the projects they are attached to', () => {
  // project_manager is used as the ROLE here precisely because it is the role
  // whose name most invites the "manages projects ⇒ manages all projects"
  // shortcut Phase 3A §7 forbids.
  it('USER_A → PROJECT_A is admitted', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'project_manager' })
    const res = await get(PROJECT_A)
    expect(res.status).toBe(200)
    expect(res.body.data.id).toBe(PROJECT_A)
  })

  it('USER_A → PROJECT_B is refused, same tenant', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'project_manager' })
    const res = await get(PROJECT_B)
    expect(res.status, 'a same-tenant project they are not attached to').toBe(404)
    expect(res.body.data).toBeUndefined()
  })

  it('USER_A → PROJECT_C is refused, foreign tenant', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'project_manager' })
    expect((await get(PROJECT_C)).status).toBe(404)
  })

  it('USER_B → PROJECT_B is admitted', async () => {
    setCaller({ id: USER_B, tenantId: TENANT_A, role: 'project_manager' })
    expect((await get(PROJECT_B)).status).toBe(200)
  })

  it('USER_B → PROJECT_A is refused', async () => {
    setCaller({ id: USER_B, tenantId: TENANT_A, role: 'project_manager' })
    expect((await get(PROJECT_A)).status).toBe(404)
  })

  it('refuses an out-of-scope project identically to one that does not exist', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'project_manager' })
    const outOfScope = await get(PROJECT_B)
    const nonexistent = await get('30000000-0000-4000-8000-0000000000ff')
    expect(outOfScope.status).toBe(nonexistent.status)
    expect(outOfScope.body).toEqual(nonexistent.body)
  })

  it('does not load the project payload for a refused caller', async () => {
    // §12: record-scope refusal precedes downstream sensitive loading. The
    // client name, status and six summary sub-counts must never be selected.
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'project_manager' })
    await get(PROJECT_B)
    expect(scopeQueries().length, 'scope was evaluated').toBe(1)
    expect(payloadQueries().length, 'the payload query must not run').toBe(0)
  })
})

// ─── 2. Owner is tenant-wide, not global (§3) ─────────────────────────────────
describe('the owner reaches every project in its own tenant and none outside', () => {
  it('OWNER_A → PROJECT_A is admitted', async () => {
    setCaller({ id: OWNER_A, tenantId: TENANT_A, role: 'owner' })
    expect((await get(PROJECT_A)).status).toBe(200)
  })

  it('OWNER_A → PROJECT_B is admitted although it is attached to USER_B', async () => {
    setCaller({ id: OWNER_A, tenantId: TENANT_A, role: 'owner' })
    expect((await get(PROJECT_B)).status).toBe(200)
  })

  it('OWNER_A → PROJECT_C is refused — owner is not global', async () => {
    setCaller({ id: OWNER_A, tenantId: TENANT_A, role: 'owner' })
    expect((await get(PROJECT_C)).status).toBe(404)
  })
})

// ─── 3. The two dimensions refuse independently (§15) ─────────────────────────
describe('functional capability and record scope are independent', () => {
  it('refuses a caller holding the relationship but not the capability', async () => {
    // admin is the platform administrator: it holds no project.view at all
    // (ADR-014 D2). Attach it to the project anyway — it must still be refused,
    // and with 403 rather than 404, because the route authority fails first.
    PROJECTS[0]!.project_manager = USER_A
    PROJECTS[0]!.lead_engineer   = OWNER_A
    setCaller({ id: OWNER_A, tenantId: TENANT_A, role: 'admin' })
    const res = await get(PROJECT_A)
    expect(res.status, 'no project.view — refused on the functional dimension').toBe(403)
    expect(scopeQueries().length, 'and scope is never even consulted').toBe(0)
  })

  it('refuses a caller holding the capability but not the relationship', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'engineer' })
    const res = await get(PROJECT_B)
    expect(res.status, 'has project.view, is not attached — refused on the record dimension').toBe(404)
  })

  it('admits a caller holding both', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'engineer' })
    expect((await get(PROJECT_A)).status).toBe(200)
  })

  it('gives the platform administrator no implicit business access anywhere', async () => {
    setCaller({ id: OWNER_A, tenantId: TENANT_A, role: 'admin' })
    for (const p of [PROJECT_A, PROJECT_B, PROJECT_C]) {
      expect((await get(p)).status, `admin must not reach ${p}`).toBe(403)
    }
  })
})

// ─── 4. Every relationship column is load-bearing ─────────────────────────────
describe('each responsible-user column puts a principal in scope', () => {
  it('lead_engineer', async () => {
    PROJECTS[1]!.lead_engineer = USER_A
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'engineer' })
    expect((await get(PROJECT_B)).status).toBe(200)
  })

  it('created_by — so creating a project is not a read dead-end', async () => {
    PROJECTS[1]!.created_by = USER_A
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'project_manager' })
    expect((await get(PROJECT_B)).status).toBe(200)
  })

  it('and an unattached project stays refused', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'project_manager' })
    expect((await get(PROJECT_B)).status).toBe(404)
  })
})

// ─── 5. Live authority: revocation and deactivation (§16, §17) ────────────────
describe('scope is live database state, never the token', () => {
  it('revoking the relationship takes effect on the next request, same JWT', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'project_manager' })
    expect((await get(PROJECT_A)).status, 'in scope').toBe(200)

    // Revoke in the database. The caller keeps the identical token.
    PROJECTS[0]!.project_manager = USER_B

    expect((await get(PROJECT_A)).status, 'out of scope immediately').toBe(404)
  })

  it('granting the relationship also takes effect immediately', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'project_manager' })
    expect((await get(PROJECT_B)).status).toBe(404)
    PROJECTS[1]!.lead_engineer = USER_A
    expect((await get(PROJECT_B)).status).toBe(200)
  })

  it('a deactivated principal is refused before scope is even considered', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'project_manager', active: false })
    const res = await get(PROJECT_A)
    expect([401, 403]).toContain(res.status)
    expect(payloadQueries().length).toBe(0)
  })

  it('a principal whose row is gone is refused', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'project_manager', exists: false })
    const res = await get(PROJECT_A)
    expect([401, 403]).toContain(res.status)
    expect(payloadQueries().length).toBe(0)
  })

  it('refuses a stale token claiming owner over a live non-owner', async () => {
    // The token claims owner, which would be tenant-wide and would open
    // PROJECT_B. The database row says engineer, and that engineer is attached
    // to nothing. Scope must follow the ROW, so the request is refused.
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'engineer', jwtRole: 'owner' })
    expect((await get(PROJECT_B)).status, 'the token claim must not confer scope').toBe(404)
  })

  it('still admits that caller to the project the ROW entitles it to', async () => {
    // Non-vacuity for the case above: the refusal is about scope, not about the
    // divergence itself breaking every request.
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'engineer', jwtRole: 'owner' })
    expect((await get(PROJECT_A)).status).toBe(200)
  })

  it('does not let a stale owner claim unlock the commercial columns', async () => {
    // Field authority is live too: cost.view belongs to owner, and the token
    // says owner — but the row says engineer.
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'engineer', jwtRole: 'owner' })
    const res = await get(PROJECT_A)
    expect(res.status).toBe(200)
    expect(res.body.data).not.toHaveProperty('budget')
  })
})

// ─── 6. No client-supplied scope (§39) ────────────────────────────────────────
describe('scope cannot be supplied by the caller', () => {
  const ATTEMPTS: Array<[string, string]> = [
    ['projectIds',      `?projectIds=${PROJECT_B}`],
    ['allowedProjects', `?allowedProjects=${PROJECT_B}`],
    ['memberOf',        `?memberOf=${PROJECT_B}`],
    ['scope',           `?scope=all`],
    ['authorized',      `?authorized=true`],
    ['tenantId',        `?tenantId=${TENANT_B}`],
  ]

  it.each(ATTEMPTS)('ignores a %s query parameter', async (_name, qs) => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'project_manager' })
    const res = await request(makeApp()).get(`/api/v1/projects/${PROJECT_B}${qs}`)
    expect(res.status, 'caller-supplied scope must not widen anything').toBe(404)
  })
})

// ─── 7. Field authority: the commercial columns (§13, MIXED_PAYLOAD_PHASE3) ───
describe('the commercial columns need cost.view, not merely project access', () => {
  const COST_FIELDS = ['budget', 'committed_cost', 'actual_cost', 'forecast_cost', 'contingency_pct']

  it('discloses them to the owner, who holds cost.view', async () => {
    setCaller({ id: OWNER_A, tenantId: TENANT_A, role: 'owner' })
    const res = await get(PROJECT_A)
    expect(res.status).toBe(200)
    for (const f of COST_FIELDS) expect(res.body.data, `owner should see ${f}`).toHaveProperty(f)
  })

  it('withholds them from an in-scope caller without cost.view', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'project_manager' })
    const res = await get(PROJECT_A)
    expect(res.status, 'the project itself is readable').toBe(200)
    for (const f of COST_FIELDS) {
      expect(res.body.data, `${f} must not be disclosed`).not.toHaveProperty(f)
    }
    // Withheld by ABSENCE, not by a null that would read as "no budget set".
    for (const f of COST_FIELDS) expect(Object.keys(res.body.data)).not.toContain(f)
    // And no column smuggles the value out under another name.
    expect(Object.values(res.body.data), 'no cost figure may appear anywhere in the payload')
      .not.toContain(1_000_000)
  })

  it('still returns the delivery context the role legitimately needs', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'project_manager' })
    const res = await get(PROJECT_A)
    expect(res.body.data.name).toBe('Project A')
    expect(res.body.data.status).toBe('active')
    expect(res.body.data.client_name).toBe('Acme Energy')
    expect(res.body.data.open_rfis).toBe('2')
  })
})

// ─── 8. The read stays a read (§42) ───────────────────────────────────────────
describe('the project detail read has no side effects', () => {
  it('performs no write on success or on refusal', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'project_manager' })
    await get(PROJECT_A)
    await get(PROJECT_B)
    const writes = mockQuery.mock.calls
      .map(sqlOf)
      .filter(s => /\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i.test(s))
    expect(writes, 'a GET must not write').toEqual([])
  })
})

// ─── 9. The resolver itself, without the route on top ─────────────────────────
//
// The project payload query carries its OWN tenant predicate, which is correct
// defence in depth — but it also means a tenant leak in the SCOPE query alone
// would still 404 at the route and stay invisible. These exercise the resolver
// directly so the scope query is held to the boundary on its own merits.
describe('filterAccessibleProjectIds is bounded independently of the route', () => {
  const owner    = { id: OWNER_A, tenantId: TENANT_A, role: 'owner' as UserRole }
  const attached = { id: USER_A,  tenantId: TENANT_A, role: 'project_manager' as UserRole }

  it('never returns a foreign-tenant project, even to the owner', async () => {
    const got = await filterAccessibleProjectIds(owner, [PROJECT_A, PROJECT_B, PROJECT_C])
    expect([...got].sort(), 'the owner is tenant-wide, not global').toEqual([PROJECT_A, PROJECT_B].sort())
    expect(got.has(PROJECT_C), 'PROJECT_C belongs to tenant B').toBe(false)
  })

  it('returns only attached projects to a non-owner', async () => {
    const got = await filterAccessibleProjectIds(attached, [PROJECT_A, PROJECT_B, PROJECT_C])
    expect([...got]).toEqual([PROJECT_A])
  })

  it('answers a single-project question consistently', async () => {
    expect(await canAccessProject(owner, PROJECT_C)).toBe(false)
    expect(await canAccessProject(owner, PROJECT_B)).toBe(true)
    expect(await canAccessProject(attached, PROJECT_B)).toBe(false)
    expect(await canAccessProject(attached, PROJECT_A)).toBe(true)
  })

  it('refuses a malformed project id rather than passing it to the database', async () => {
    // `id = ANY($1::uuid[])` would raise on a non-uuid; the resolver filters it
    // out and denies instead, which must not become an implicit grant.
    expect(await canAccessProject(owner, 'not-a-uuid')).toBe(false)
    expect(await canAccessProject(owner, '')).toBe(false)
    const got = await filterAccessibleProjectIds(owner, ['not-a-uuid', PROJECT_A])
    expect([...got]).toEqual([PROJECT_A])
  })

  it('returns nothing at all when the lookup fails', async () => {
    mockQuery.mockImplementationOnce(async () => { throw new Error('connection reset') })
    const got = await filterAccessibleProjectIds(owner, [PROJECT_A])
    expect([...got], 'a failed lookup must never be an implicit grant').toEqual([])
  })

  it('reports the owner as tenant-wide and a non-owner as a bounded set', async () => {
    expect(await resolveProjectScope(owner)).toEqual({ kind: 'ALL_IN_TENANT' })
    const scope = await resolveProjectScope(attached)
    expect(scope.kind).toBe('PROJECT_SET')
    expect(scope.kind === 'PROJECT_SET' ? [...scope.projectIds] : []).toEqual([PROJECT_A])
  })
})
