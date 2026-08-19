/**
 * ADR-014 Phase 3B — project membership, exercised through the real routers.
 *
 * Phase 3A proved the ENFORCEMENT machinery. This proves the MODEL underneath
 * it: that membership is what grants record scope, that it grants nothing else,
 * that provenance survives reassignment, and that administering it is itself
 * record-scoped so nobody can bootstrap their way into a project.
 *
 * Fixture (§46):
 *
 *   Tenant A   OWNER_A, PM_A, ENG_A, ENG_B, VIEWER_A
 *              PROJECT_A  — PM_A, ENG_A
 *              PROJECT_B  — ENG_B
 *   Tenant B   USER_C, PROJECT_C
 *
 * The database is MODELLED, and the fixture honours the SQL it is handed: the
 * membership predicate is applied only when the query actually asks for
 * `project_members`, so deleting it from the resolver widens what a real
 * database would return and fails these tests behaviourally.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

const mockQuery = vi.fn()
vi.mock('../db/pool', () => ({
  query:       (...a: unknown[]) => mockQuery(...a),
  tenantQuery: (...a: unknown[]) => mockQuery(...a),
  tenantTransaction: async (_t: string, fn: (c: unknown) => unknown) =>
    fn({ query: (...a: unknown[]) => mockQuery(...a) }),
  pool: { query: (...a: unknown[]) => mockQuery(...a), connect: vi.fn() },
}))
vi.mock('../authz/transitionStates', () => ({
  guardTransitionOwnedState: () => (_r: unknown, _s: unknown, next: () => void) => next(),
}))

import type { UserRole } from '../authz/capabilities'

const TENANT_A = 'aaaaaaaa-0000-4000-8000-000000000001'
const TENANT_B = 'bbbbbbbb-0000-4000-8000-000000000002'
const OWNER_A  = '10000000-0000-4000-8000-000000000001'
const PM_A     = '10000000-0000-4000-8000-000000000002'
const ENG_A    = '10000000-0000-4000-8000-00000000000a'
const ENG_B    = '10000000-0000-4000-8000-00000000000b'
const VIEWER_A = '10000000-0000-4000-8000-00000000000v'.replace('v', '3')
const ADMIN_A  = '10000000-0000-4000-8000-000000000004'
const USER_C   = '20000000-0000-4000-8000-00000000000c'
const PROJECT_A = '30000000-0000-4000-8000-00000000000a'
const PROJECT_B = '30000000-0000-4000-8000-00000000000b'
const PROJECT_C = '30000000-0000-4000-8000-00000000000c'

interface Member { projectId: string; userId: string; source: string; active: boolean }
interface Project { id: string; tenant_id: string; name: string; budget: number }
interface User { id: string; tenant_id: string; role: UserRole; is_active: boolean }

let MEMBERS: Member[]
let PROJECTS: Project[]
let USERS: User[]
/** Rows the handlers actually wrote, so a refusal can be proved inert. */
let WRITES: string[]

const activeFor = (projectId: string, userId: string) =>
  MEMBERS.filter(m => m.projectId === projectId && m.userId === userId && m.active)

interface Caller { id: string; tenantId: string; role: UserRole }
let caller: Caller
const setCaller = (c: Caller) => { caller = c; (globalThis as Record<string, unknown>)['__p3b'] = c }

vi.mock('../auth', () => ({
  requireAuth: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    const c = (globalThis as Record<string, unknown>)['__p3b'] as Caller
    req['auth'] = { sub: c.id, tid: c.tenantId, role: c.role, jti: 'jti' }
    next()
  },
  requireRole: () => (_r: unknown, _s: unknown, next: () => void) => next(),
}))
vi.mock('../middleware/tenant', () => {
  const mw = (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req['tenantId'] = ((globalThis as Record<string, unknown>)['__p3b'] as Caller).tenantId
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

import projectsRouter from '../routes/projects'

const makeApp = () => {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/projects', projectsRouter as never)
  return app
}

const sqlOf = (args: unknown[]): string =>
  (args.find(a => typeof a === 'string' && /\b(SELECT|INSERT|UPDATE|DELETE)\b/i.test(a)) as string) ?? ''
const tenantOf = (args: unknown[]): string | null =>
  typeof args[0] === 'string' && !/\b(SELECT|INSERT|UPDATE|DELETE)\b/i.test(args[0]) ? args[0] : null

beforeEach(() => {
  WRITES = []
  USERS = [
    { id: OWNER_A,  tenant_id: TENANT_A, role: 'owner',           is_active: true },
    { id: PM_A,     tenant_id: TENANT_A, role: 'project_manager', is_active: true },
    { id: ENG_A,    tenant_id: TENANT_A, role: 'engineer',        is_active: true },
    { id: ENG_B,    tenant_id: TENANT_A, role: 'engineer',        is_active: true },
    { id: VIEWER_A, tenant_id: TENANT_A, role: 'viewer',          is_active: true },
    { id: ADMIN_A,  tenant_id: TENANT_A, role: 'admin',           is_active: true },
    { id: USER_C,   tenant_id: TENANT_B, role: 'project_manager', is_active: true },
  ]
  PROJECTS = [
    { id: PROJECT_A, tenant_id: TENANT_A, name: 'Alpha', budget: 1_000_000 },
    { id: PROJECT_B, tenant_id: TENANT_A, name: 'Beta',  budget: 2_000_000 },
    { id: PROJECT_C, tenant_id: TENANT_B, name: 'Gamma', budget: 3_000_000 },
  ]
  MEMBERS = [
    { projectId: PROJECT_A, userId: PM_A,   source: 'project_manager', active: true },
    { projectId: PROJECT_A, userId: ENG_A,  source: 'manual',          active: true },
    { projectId: PROJECT_B, userId: ENG_B,  source: 'manual',          active: true },
    { projectId: PROJECT_C, userId: USER_C, source: 'project_manager', active: true },
  ]

  mockQuery.mockReset()
  mockQuery.mockImplementation(async (...args: unknown[]) => {
    const sql = sqlOf(args)
    const tenant = tenantOf(args)
    const params = (args[args.length - 1] ?? []) as unknown[]

    if (/\b(INSERT INTO|UPDATE \w+ SET|DELETE FROM)\b/i.test(sql)) WRITES.push(sql)

    // grantable-user lookup — the TENANT-SCOPED one. Checked first because the
    // principal lookup below also selects from `users` by id; only this query
    // carries the tenant predicate, which is what makes a foreign-tenant target
    // simply not found.
    if (/FROM users/i.test(sql) && /tenant_id = current_setting/i.test(sql)) {
      const u = USERS.find(x => x.id === params[0] && x.tenant_id === tenant)
      return { rows: u ? [{ id: u.id, is_active: u.is_active }] : [] }
    }
    // live principal
    if (/FROM users/i.test(sql) && /is_active/i.test(sql) && /WHERE id = \$1/i.test(sql)) {
      const u = USERS.find(x => x.id === params[0])
      return { rows: u ? [u] : [] }
    }
    // record scope — honours whether the query asks for membership at all
    if (/SELECT (id|p\.id) FROM projects/i.test(sql)) {
      const boundedByTenant     = /tenant_id = current_setting/i.test(sql)
      const boundedByIds        = /id = ANY\(\$1::uuid\[\]\)/i.test(sql)
      const boundedByMembership = /FROM project_members m/i.test(sql)
      const ids = boundedByIds ? (params[0] ?? []) as string[] : null
      const uid = (boundedByIds ? params[1] : params[0]) as string | undefined
      return {
        rows: PROJECTS
          .filter(p => !boundedByTenant || p.tenant_id === tenant)
          .filter(p => ids === null || ids.includes(p.id))
          .filter(p => !boundedByMembership || (uid !== undefined && activeFor(p.id, uid).length > 0))
          .map(p => ({ id: p.id })),
      }
    }
    // membership roster
    if (/FROM project_members m/i.test(sql) && /ARRAY_AGG/i.test(sql)) {
      const rows = [...new Set(MEMBERS.filter(m => m.projectId === params[0] && m.active).map(m => m.userId))]
        .map(uid => ({
          user_id: uid, display_name: `U-${uid.slice(-2)}`, email: `${uid.slice(-2)}@x`,
          sources: MEMBERS.filter(m => m.projectId === params[0] && m.userId === uid && m.active).map(m => m.source),
        }))
      return { rows }
    }
    // membership grant / revoke
    if (/INSERT INTO project_members/i.test(sql)) {
      MEMBERS.push({ projectId: params[1] as string, userId: params[2] as string, source: params[3] as string, active: true })
      return { rows: [], rowCount: 1 }
    }
    if (/UPDATE project_members/i.test(sql)) {
      const hits = MEMBERS.filter(m => m.projectId === params[1] && m.userId === params[2] && m.source === params[3] && m.active)
      for (const m of hits) m.active = false
      return { rows: [], rowCount: hits.length }
    }
    // project collection: data + count
    if (/LEFT JOIN users pm/i.test(sql)) {
      const scoped = /FROM project_members m/i.test(sql)
      const uid = params[0] as string | undefined
      return {
        rows: PROJECTS.filter(p => p.tenant_id === tenant)
          .filter(p => !scoped || (uid !== undefined && activeFor(p.id, uid).length > 0))
          .map(p => ({ ...p, pm_name: 'PM' })),
      }
    }
    if (/COUNT\(\*\)::text AS count FROM projects/i.test(sql)) {
      const scoped = /FROM project_members m/i.test(sql)
      const uid = params[0] as string | undefined
      const n = PROJECTS.filter(p => p.tenant_id === tenant)
        .filter(p => !scoped || (uid !== undefined && activeFor(p.id, uid).length > 0)).length
      return { rows: [{ count: String(n) }] }
    }
    // project detail payload
    if (/FROM projects p/i.test(sql)) {
      const p = PROJECTS.find(x => x.id === params[0] && x.tenant_id === tenant)
      return { rows: p ? [{ ...p, pm_name: 'PM' }] : [] }
    }
    return { rows: [] }
  })
  setCaller({ id: OWNER_A, tenantId: TENANT_A, role: 'owner' })
})

const list    = () => request(makeApp()).get('/api/v1/projects')
const roster  = (p: string) => request(makeApp()).get(`/api/v1/projects/${p}/members`)
const grant   = (p: string, u: string) => request(makeApp()).post(`/api/v1/projects/${p}/members`).send({ user_id: u })
const revoke  = (p: string, u: string) => request(makeApp()).delete(`/api/v1/projects/${p}/members/${u}`)

// ─── 1. Membership administration authority (§46, D20) ────────────────────────
describe('granting membership needs project.members.manage AND record scope', () => {
  it('Owner A adds Engineer A to Project A', async () => {
    setCaller({ id: OWNER_A, tenantId: TENANT_A, role: 'owner' })
    expect((await grant(PROJECT_A, ENG_B)).status).toBe(201)
    expect(activeFor(PROJECT_A, ENG_B).length).toBe(1)
  })

  it('PM already in Project A adds Engineer B to Project A', async () => {
    setCaller({ id: PM_A, tenantId: TENANT_A, role: 'project_manager' })
    expect((await grant(PROJECT_A, ENG_B)).status).toBe(201)
  })

  it('PM NOT in Project B cannot add itself to Project B — self-bootstrap closed (§12)', async () => {
    setCaller({ id: PM_A, tenantId: TENANT_A, role: 'project_manager' })
    const res = await grant(PROJECT_B, PM_A)
    expect(res.status, 'holding the capability is not holding it everywhere').toBe(404)
    expect(activeFor(PROJECT_B, PM_A).length, 'no membership may be created').toBe(0)
    expect(WRITES.filter(w => /INSERT INTO project_members/i.test(w)), 'nothing written').toEqual([])
  })

  const NO_AUTHORITY: Array<[string, string, UserRole]> = [
    ['engineer', ENG_A, 'engineer'],
    ['viewer',   VIEWER_A, 'viewer'],
    ['admin',    ADMIN_A, 'admin'],
  ]
  it.each(NO_AUTHORITY)('%s cannot grant membership', async (_n, id, role) => {
    setCaller({ id, tenantId: TENANT_A, role })
    const res = await grant(PROJECT_A, ENG_B)
    expect(res.status, 'project.members.manage is owner + project_manager only').toBe(403)
    expect(WRITES.filter(w => /INSERT INTO project_members/i.test(w))).toEqual([])
  })

  it('refuses a target user from another tenant, before any write (§15)', async () => {
    setCaller({ id: OWNER_A, tenantId: TENANT_A, role: 'owner' })
    const res = await grant(PROJECT_A, USER_C)
    expect(res.status).toBe(422)
    expect(activeFor(PROJECT_A, USER_C).length).toBe(0)
    expect(WRITES.filter(w => /INSERT INTO project_members/i.test(w))).toEqual([])
  })

  it('refuses a deactivated target user', async () => {
    USERS.find(u => u.id === ENG_B)!.is_active = false
    setCaller({ id: OWNER_A, tenantId: TENANT_A, role: 'owner' })
    expect((await grant(PROJECT_A, ENG_B)).status).toBe(422)
    expect(WRITES.filter(w => /INSERT INTO project_members/i.test(w))).toEqual([])
  })

  it('refuses a user that does not exist', async () => {
    setCaller({ id: OWNER_A, tenantId: TENANT_A, role: 'owner' })
    expect((await grant(PROJECT_A, '10000000-0000-4000-8000-0000000000ff')).status).toBe(422)
  })

  it('cannot forge system provenance — the source is always manual (§16)', async () => {
    setCaller({ id: OWNER_A, tenantId: TENANT_A, role: 'owner' })
    await request(makeApp()).post(`/api/v1/projects/${PROJECT_A}/members`)
      .send({ user_id: ENG_B, source: 'project_manager', membership_source: 'lead_engineer' })
    expect(activeFor(PROJECT_A, ENG_B).map(m => m.source),
      'a caller-named source must be ignored').toEqual(['manual'])
  })

  it('records the live principal as the granting actor, not a body field (§39)', async () => {
    setCaller({ id: PM_A, tenantId: TENANT_A, role: 'project_manager' })
    await request(makeApp()).post(`/api/v1/projects/${PROJECT_A}/members`)
      .send({ user_id: ENG_B, created_by: ENG_A, granted_by: ENG_A })
    const insert = mockQuery.mock.calls.find(c => /INSERT INTO project_members/i.test(sqlOf(c)))
    const params = insert![insert!.length - 1] as unknown[]
    expect(params[4], 'created_by is the authenticated principal').toBe(PM_A)
  })
})

// ─── 2. Membership read authority (§47) ───────────────────────────────────────
describe('the roster is visible to project members, and to nobody else', () => {
  it('a member with project.view sees it', async () => {
    setCaller({ id: ENG_A, tenantId: TENANT_A, role: 'engineer' })
    const res = await roster(PROJECT_A)
    expect(res.status).toBe(200)
    expect(res.body.data.map((m: { userId: string }) => m.userId).sort()).toEqual([PM_A, ENG_A].sort())
  })

  it('a same-tenant NON-member is refused, and told nothing', async () => {
    setCaller({ id: ENG_B, tenantId: TENANT_A, role: 'engineer' })
    const res = await roster(PROJECT_A)
    expect(res.status).toBe(404)
    expect(JSON.stringify(res.body)).not.toContain(PM_A)
  })

  it('the owner sees any roster in its own tenant, and none outside', async () => {
    setCaller({ id: OWNER_A, tenantId: TENANT_A, role: 'owner' })
    expect((await roster(PROJECT_A)).status).toBe(200)
    expect((await roster(PROJECT_C)).status, 'foreign tenant').toBe(404)
  })

  it('the platform administrator gets nothing', async () => {
    setCaller({ id: ADMIN_A, tenantId: TENANT_A, role: 'admin' })
    expect((await roster(PROJECT_A)).status).toBe(403)
  })

  it('exposes only project-team identity, not a tenant user directory', async () => {
    setCaller({ id: OWNER_A, tenantId: TENANT_A, role: 'owner' })
    const res = await roster(PROJECT_A)
    const ids = res.body.data.map((m: { userId: string }) => m.userId)
    expect(ids, 'ENG_B is not on this project').not.toContain(ENG_B)
    expect(ids, 'and neither is a foreign-tenant user').not.toContain(USER_C)
    for (const m of res.body.data) {
      expect(Object.keys(m).sort()).toEqual(['displayName', 'email', 'sources', 'userId'])
    }
  })
})

// ─── 3. Multi-source provenance (§19, §23) ────────────────────────────────────
describe('revoking one membership source never revokes another', () => {
  it('keeps access while any source remains active', async () => {
    MEMBERS.push({ projectId: PROJECT_A, userId: ENG_A, source: 'created_by', active: true })
    setCaller({ id: ENG_A, tenantId: TENANT_A, role: 'engineer' })
    expect((await request(makeApp()).get(`/api/v1/projects/${PROJECT_A}`)).status).toBe(200)

    // Revoke the manual grant only.
    setCaller({ id: OWNER_A, tenantId: TENANT_A, role: 'owner' })
    expect((await revoke(PROJECT_A, ENG_A)).status).toBe(200)

    setCaller({ id: ENG_A, tenantId: TENANT_A, role: 'engineer' })
    expect((await request(makeApp()).get(`/api/v1/projects/${PROJECT_A}`)).status,
      'created_by still stands').toBe(200)

    // Close the last one.
    MEMBERS.filter(m => m.userId === ENG_A && m.projectId === PROJECT_A).forEach(m => { m.active = false })
    expect((await request(makeApp()).get(`/api/v1/projects/${PROJECT_A}`)).status,
      'only now is access gone').toBe(404)
  })

  it('revokes only the manual source, leaving system sources to their workflow', async () => {
    MEMBERS.push({ projectId: PROJECT_A, userId: PM_A, source: 'manual', active: true })
    setCaller({ id: OWNER_A, tenantId: TENANT_A, role: 'owner' })
    await revoke(PROJECT_A, PM_A)
    expect(activeFor(PROJECT_A, PM_A).map(m => m.source),
      'the project_manager source is owned by the project column').toEqual(['project_manager'])
  })

  it('404s when there is no manual grant to revoke', async () => {
    setCaller({ id: OWNER_A, tenantId: TENANT_A, role: 'owner' })
    expect((await revoke(PROJECT_A, PM_A)).status).toBe(404)
  })
})

// ─── 4. Live revocation (§22) ─────────────────────────────────────────────────
describe('membership changes take effect on the next request, same JWT', () => {
  it('revoke then reactivate, with no token refresh', async () => {
    setCaller({ id: ENG_A, tenantId: TENANT_A, role: 'engineer' })
    const detail = () => request(makeApp()).get(`/api/v1/projects/${PROJECT_A}`)
    expect((await detail()).status).toBe(200)

    MEMBERS.filter(m => m.userId === ENG_A).forEach(m => { m.active = false })
    expect((await detail()).status, 'revoked immediately').toBe(404)

    MEMBERS.filter(m => m.userId === ENG_A).forEach(m => { m.active = true })
    expect((await detail()).status, 'reactivated immediately').toBe(200)
  })

  it('a deactivated user cannot use a membership that is still active (§8)', async () => {
    USERS.find(u => u.id === ENG_A)!.is_active = false
    setCaller({ id: ENG_A, tenantId: TENANT_A, role: 'engineer' })
    const res = await request(makeApp()).get(`/api/v1/projects/${PROJECT_A}`)
    expect([401, 403]).toContain(res.status)
    expect(activeFor(PROJECT_A, ENG_A).length, 'the membership is untouched — the USER is the problem').toBe(1)
  })
})

// ─── 5. The scoped project collection (§48, §50) ──────────────────────────────
describe('GET /projects returns only the caller’s projects', () => {
  const ids = (b: { data: { id: string }[] }) => b.data.map(p => p.id).sort()

  it('Owner A sees both tenant-A projects and no tenant-B project', async () => {
    setCaller({ id: OWNER_A, tenantId: TENANT_A, role: 'owner' })
    const res = await list()
    expect(res.status).toBe(200)
    expect(ids(res.body)).toEqual([PROJECT_A, PROJECT_B].sort())
    expect(JSON.stringify(res.body)).not.toContain(PROJECT_C)
  })

  it('Engineer A sees Project A only', async () => {
    setCaller({ id: ENG_A, tenantId: TENANT_A, role: 'engineer' })
    expect(ids((await list()).body)).toEqual([PROJECT_A])
  })

  it('Engineer B sees Project B only', async () => {
    setCaller({ id: ENG_B, tenantId: TENANT_A, role: 'engineer' })
    expect(ids((await list()).body)).toEqual([PROJECT_B])
  })

  it('a member of both sees both', async () => {
    MEMBERS.push({ projectId: PROJECT_B, userId: PM_A, source: 'manual', active: true })
    setCaller({ id: PM_A, tenantId: TENANT_A, role: 'project_manager' })
    expect(ids((await list()).body)).toEqual([PROJECT_A, PROJECT_B].sort())
  })

  it('a viewer sees only its own project', async () => {
    MEMBERS.push({ projectId: PROJECT_A, userId: VIEWER_A, source: 'manual', active: true })
    setCaller({ id: VIEWER_A, tenantId: TENANT_A, role: 'viewer' })
    expect(ids((await list()).body)).toEqual([PROJECT_A])
  })

  it('the platform administrator gets nothing', async () => {
    setCaller({ id: ADMIN_A, tenantId: TENANT_A, role: 'admin' })
    expect((await list()).status).toBe(403)
  })

  it('updates immediately when membership is revoked, same JWT', async () => {
    MEMBERS.push({ projectId: PROJECT_B, userId: PM_A, source: 'manual', active: true })
    setCaller({ id: PM_A, tenantId: TENANT_A, role: 'project_manager' })
    expect(ids((await list()).body)).toHaveLength(2)

    MEMBERS.filter(m => m.userId === PM_A && m.projectId === PROJECT_B).forEach(m => { m.active = false })
    const after = (await list()).body
    expect(ids(after)).toEqual([PROJECT_A])
    expect(after.meta.total, 'the count follows the rows').toBe(1)
  })

  it('never reports a total larger than what the caller can see (§27, §50)', async () => {
    // Two projects exist in the tenant; the caller may see one.
    setCaller({ id: ENG_A, tenantId: TENANT_A, role: 'engineer' })
    const res = await list()
    expect(res.body.data).toHaveLength(1)
    expect(res.body.meta.total, 'no hidden-count side channel').toBe(1)
    expect(res.body.meta.pages).toBe(1)
    expect(PROJECTS.filter(p => p.tenant_id === TENANT_A)).toHaveLength(2)   // …and 2 really exist
  })

  it('withholds the commercial columns from a member without cost.view', async () => {
    setCaller({ id: ENG_A, tenantId: TENANT_A, role: 'engineer' })
    const res = await list()
    expect(res.body.data[0]).not.toHaveProperty('budget')
  })

  it('a filter cannot widen scope (§28)', async () => {
    setCaller({ id: ENG_A, tenantId: TENANT_A, role: 'engineer' })
    const res = await request(makeApp()).get('/api/v1/projects?status=active&search=Beta&project_manager=' + ENG_B)
    expect(res.body.data.every((p: { id: string }) => p.id === PROJECT_A) || res.body.data.length === 0).toBe(true)
    expect(JSON.stringify(res.body)).not.toContain(PROJECT_B)
  })
})

// ─── 6. Membership grants scope, never capability (§1, §32) ───────────────────
describe('membership is not a capability', () => {
  it('does not give a viewer any write authority', async () => {
    MEMBERS.push({ projectId: PROJECT_A, userId: VIEWER_A, source: 'manual', active: true })
    setCaller({ id: VIEWER_A, tenantId: TENANT_A, role: 'viewer' })
    const res = await request(makeApp()).patch(`/api/v1/projects/${PROJECT_A}`).send({ name: 'renamed' })
    expect(res.status, 'project.write is not conferred by membership').toBe(403)
  })

  it('does not give an engineer the commercial columns', async () => {
    setCaller({ id: ENG_A, tenantId: TENANT_A, role: 'engineer' })
    const res = await request(makeApp()).get(`/api/v1/projects/${PROJECT_A}`)
    expect(res.status, 'the project itself is readable').toBe(200)
    expect(res.body.data, 'cost.view is still required for the money').not.toHaveProperty('budget')
  })

  it('does not give an engineer membership-administration authority', async () => {
    setCaller({ id: ENG_A, tenantId: TENANT_A, role: 'engineer' })
    expect((await grant(PROJECT_A, ENG_B)).status).toBe(403)
  })
})
