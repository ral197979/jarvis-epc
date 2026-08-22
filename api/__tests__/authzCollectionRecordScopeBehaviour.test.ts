/**
 * ADR-014 Phase 3F — collection scope, exercised through the real routers.
 *
 * The condition this slice removes:
 *
 *     correct functional read capability
 *   + caller belongs to project A only
 *   + the collection query is tenant-wide
 *   = rows from project B come back anyway
 *
 * while keeping what Phase 3E-R restored: a row that legitimately has NO
 * project is tenant-global and stays visible.
 *
 * Fixture (§83), modelled rather than mocked per call. Rows live in tables and
 * the fixture ANSWERS the statement the product issued — it reads the tenant
 * predicate, the project predicate, the NULL/global branch, the membership
 * window, LIMIT/OFFSET and the COUNT off the SQL. A fixture that decided for
 * itself which rows "should" be visible could not tell a scoped query from an
 * unscoped one, and the mutation tests would prove nothing.
 *
 *   Tenant A   USER_A (project_manager)  → member of PROJECT_A
 *              USER_B (project_manager)  → member of PROJECT_B
 *              OWNER_A (owner)           → tenant-wide, no membership row
 *   Tenant B   USER_C (project_manager)  → member of PROJECT_C
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

const TENANT_A = 'aaaaaaaa-0000-4000-8000-000000000001'
const TENANT_B = 'bbbbbbbb-0000-4000-8000-000000000002'
const USER_A   = '10000000-0000-4000-8000-00000000000a'
const USER_B   = '10000000-0000-4000-8000-00000000000b'
const USER_C   = '10000000-0000-4000-8000-00000000000c'
const OWNER_A  = '10000000-0000-4000-8000-000000000001'
const PROJECT_A = '30000000-0000-4000-8000-00000000000a'
const PROJECT_B = '30000000-0000-4000-8000-00000000000b'
const PROJECT_C = '30000000-0000-4000-8000-00000000000c'

/**
 * `compliance_tasks` — a DUAL resource. Rows are interleaved in sort order so
 * a page of two cannot accidentally look right (§65).
 */
interface Row { id: string; project_id: string | null; tenant_id: string; due: number }
const TASKS: Row[] = [
  { id: 'b1', project_id: PROJECT_B, tenant_id: TENANT_A, due: 1 },
  { id: 'a1', project_id: PROJECT_A, tenant_id: TENANT_A, due: 2 },
  { id: 'b2', project_id: PROJECT_B, tenant_id: TENANT_A, due: 3 },
  { id: 'g1', project_id: null,      tenant_id: TENANT_A, due: 4 },
  { id: 'a2', project_id: PROJECT_A, tenant_id: TENANT_A, due: 5 },
  { id: 'b3', project_id: PROJECT_B, tenant_id: TENANT_A, due: 6 },
  { id: 'c1', project_id: PROJECT_C, tenant_id: TENANT_B, due: 7 },
]

interface MemberRow { projectId: string; userId: string; active: boolean }
let MEMBERS: MemberRow[]
interface Caller { id: string; tenantId: string; role: UserRole; active?: boolean }
let caller: Caller
const setCaller = (c: Caller) => { caller = c; (globalThis as Record<string, unknown>)['__p3f'] = c }

vi.mock('../auth', () => ({
  requireAuth: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    const c = (globalThis as Record<string, unknown>)['__p3f'] as Caller
    req['auth'] = { sub: c.id, tid: c.tenantId, role: c.role, jti: 'jti' }
    next()
  },
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}))
vi.mock('../middleware/tenant', () => ({
  requireTenant: () => (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req['tenantId'] = ((globalThis as Record<string, unknown>)['__p3f'] as Caller).tenantId
    next()
  },
}))

import complianceRouter from '../routes/compliance'
import { dailyLogsRouter } from '../routes/dailyLogs'

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/compliance-tasks', complianceRouter as never)
  app.use('/api/v1', dailyLogsRouter as never)
  return app
}
const app = makeApp()

const SQL = /\b(SELECT|INSERT|UPDATE|DELETE)\b/i
const sqlOf = (a: unknown[]): string =>
  a.find((x): x is string => typeof x === 'string' && SQL.test(x)) ?? ''

/**
 * Apply the statement's OWN predicates to the fixture rows.
 *
 * Each rule is read off the SQL. Drop one from the product and the rows this
 * returns change, which is what makes the mutation tests meaningful.
 */
function visible(sql: string, params: unknown[]): Row[] {
  const honoursTenant  = /tenant_id = current_setting\('app\.current_tenant_id',true\)::uuid/i.test(sql)
  const hasMembership  = /project_members/i.test(sql)
  const allowsGlobal   = /project_id IS NULL OR/i.test(sql)
  const honoursWindow  = /active_from\s*<=\s*NOW\(\)/i.test(sql)
                      && /active_to IS NULL OR m\.active_to > NOW\(\)/i.test(sql)
  // an explicit caller filter, e.g. ?project_id=
  const filtered = /project_id = \$\d/i.test(sql)
    ? (params.find(p => typeof p === 'string' && /^30000000-/.test(p)) as string | undefined)
    : undefined

  return TASKS.filter(r => {
    if (honoursTenant && r.tenant_id !== caller.tenantId) return false
    if (filtered && r.project_id !== filtered) return false
    if (!hasMembership) return true                        // tenant-wide / unscoped
    if (r.project_id === null) return allowsGlobal
    return MEMBERS.some(m =>
      m.projectId === r.project_id && m.userId === caller.id && (honoursWindow ? m.active : true))
  })
}

/** LIMIT/OFFSET read off the statement, applied AFTER the predicates. */
function paged(rows: Row[], sql: string, params: unknown[]): Row[] {
  const m = /LIMIT\s+\$(\d+)\s+OFFSET\s+\$(\d+)/i.exec(sql)
  if (!m) return rows
  const lim = Number(params[Number(m[1]) - 1] ?? rows.length)
  const off = Number(params[Number(m[2]) - 1] ?? 0)
  return rows.slice(off, off + lim)
}

beforeEach(() => {
  MEMBERS = [
    { projectId: PROJECT_A, userId: USER_A, active: true },
    { projectId: PROJECT_B, userId: USER_B, active: true },
    { projectId: PROJECT_C, userId: USER_C, active: true },
  ]
  setCaller({ id: USER_A, tenantId: TENANT_A, role: 'project_manager' })

  mockQuery.mockReset()
  mockQuery.mockImplementation(async (...args: unknown[]) => {
    // `sqlOf`, not the first string argument — `tenantQuery(tenantId, sql, …)`
    // passes the tenant id first, and matching that would make every branch miss.
    const sql = sqlOf(args)
    const params = (args.find(a => Array.isArray(a)) as unknown[] | undefined) ?? []

    if (/FROM\s+users\s+WHERE\s+id/i.test(sql)) {
      return { rows: [{ id: caller.id, tenant_id: caller.tenantId, role: caller.role,
                        is_active: caller.active !== false }], rowCount: 1 }
    }
    if (/FROM compliance_tasks/i.test(sql)) {
      const rows = visible(sql, params).sort((a, b) => a.due - b.due)
      if (/COUNT\(\*\)/i.test(sql)) return { rows: [{ count: String(rows.length) }], rowCount: 1 }
      return { rows: paged(rows, sql, params), rowCount: rows.length }
    }
    if (/FROM daily_logs/i.test(sql)) return { rows: [], rowCount: 0 }
    // requireProjectScope's membership lookup
    if (/FROM\s+projects\s+p?\b/i.test(sql) && /ANY\(\$\d+::uuid\[\]\)/i.test(sql)) {
      const ids = (params.find(x => Array.isArray(x)) as string[] | undefined) ?? []
      const tenantWide = !/project_members/i.test(sql)
      const reach = ids.filter(id => {
        const inTenant = id === PROJECT_C ? caller.tenantId === TENANT_B : caller.tenantId === TENANT_A
        if (!inTenant) return false
        if (tenantWide) return true
        return MEMBERS.some(m => m.projectId === id && m.userId === caller.id && m.active)
      })
      return { rows: reach.map(id => ({ id })), rowCount: reach.length }
    }
    return { rows: [], rowCount: 0 }
  })
})

const list = (q = '') => request(app).get(`/api/v1/compliance-tasks${q}`)
const ids  = (body: { data?: Row[] }) => (body.data ?? []).map(r => r.id).sort()

// ─── §60/§61 the standard collection matrices ────────────────────────────────
describe('§61 a DUAL collection returns global rows plus the caller’s projects', () => {
  it('gives a member of A the global row and A’s rows — and none of B’s', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'project_manager' })
    const res = await list()
    expect(res.status).toBe(200)
    expect(ids(res.body)).toEqual(['a1', 'a2', 'g1'])
  })

  it('gives a member of B the mirror image, proving the filter is per-caller', async () => {
    setCaller({ id: USER_B, tenantId: TENANT_A, role: 'project_manager' })
    expect(ids((await list()).body)).toEqual(['b1', 'b2', 'b3', 'g1'])
  })

  it('gives the Owner every row in the tenant, without a membership row', async () => {
    setCaller({ id: OWNER_A, tenantId: TENANT_A, role: 'owner' })
    expect(MEMBERS.some(m => m.userId === OWNER_A)).toBe(false)
    expect(ids((await list()).body)).toEqual(['a1', 'a2', 'b1', 'b2', 'b3', 'g1'])
  })

  it('gives a caller with no memberships the global row only', async () => {
    setCaller({ id: USER_C, tenantId: TENANT_A, role: 'project_manager' })   // memberships are in tenant B
    const res = await list()
    expect(res.status).toBe(200)
    expect(ids(res.body)).toEqual(['g1'])
  })
})

// ─── §60 tenant isolation ────────────────────────────────────────────────────
describe('§60 a collection never crosses the tenant', () => {
  it('never returns another tenant’s row, not even to that tenant’s member', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'project_manager' })
    expect(ids((await list()).body)).not.toContain('c1')
  })

  it('shows tenant B only its own rows', async () => {
    setCaller({ id: USER_C, tenantId: TENANT_B, role: 'project_manager' })
    expect(ids((await list()).body)).toEqual(['c1'])
  })

  it('refuses an unauthenticated caller', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'project_manager', active: false })
    expect((await list()).status).toBe(401)
  })
})

// ─── §69 functional capability is still required ─────────────────────────────
describe('§69 membership never grants a missing domain capability', () => {
  it('refuses a role without safety.view with 403, before any row scope', async () => {
    // engineer holds no safety.view; procurement holds neither.
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'engineer' })
    expect((await list()).status).toBe(403)
  })

  it('admits field_ops, which does hold safety.view, and still scopes its rows', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'field_ops' })
    const res = await list()
    expect(res.status).toBe(200)
    expect(ids(res.body)).toEqual(['a1', 'a2', 'g1'])
  })
})

// ─── §15 the COUNT describes the visible set ─────────────────────────────────
describe('§15 the total describes the authorized rows, not the tenant', () => {
  it('reports a total equal to what the caller can actually page through', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'project_manager' })
    const body = (await list()).body as { data: Row[]; pagination: { total: number } }
    expect(body.data.length).toBe(3)
    expect(body.pagination.total, 'a tenant-wide total would leak hidden-project occupancy').toBe(3)
  })

  it('reports a different total for a different caller, so it is not a constant', async () => {
    setCaller({ id: USER_B, tenantId: TENANT_A, role: 'project_manager' })
    const body = (await list()).body as { pagination: { total: number } }
    expect(body.pagination.total).toBe(4)
  })
})

// ─── §14/§65 authorization precedes pagination ───────────────────────────────
describe('§65 a page of two is two AUTHORIZED rows, not two tenant rows filtered down', () => {
  it('fills the page from the authorized set even though hidden rows sort first', async () => {
    // In due order the tenant set is b1, a1, b2, g1, a2, b3 — a caller scoped
    // to A sees a1, g1, a2. Post-filtering a tenant page of two would return
    // just `a1`; filtering first returns a full page.
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'project_manager' })
    const body = (await list('?limit=2')).body as { data: Row[]; pagination: { total: number } }
    expect(body.data.map(r => r.id)).toEqual(['a1', 'g1'])
    expect(body.pagination.total).toBe(3)
  })

  it('pages consistently onto the second page', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'project_manager' })
    const body = (await list('?limit=2&page=2')).body as { data: Row[] }
    expect(body.data.map(r => r.id)).toEqual(['a2'])
  })
})

// ─── §66 a project filter narrows, and cannot widen ──────────────────────────
describe('§66 a caller-supplied project filter can only narrow the authorized set', () => {
  it('returns the caller’s own project when they ask for it', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'project_manager' })
    expect(ids((await list(`?project_id=${PROJECT_A}`)).body)).toEqual(['a1', 'a2'])
  })

  it('returns nothing — not a 403, and not the rows — when they ask for another project', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'project_manager' })
    const res = await list(`?project_id=${PROJECT_B}`)
    expect(res.status).toBe(200)
    expect(ids(res.body)).toEqual([])
    expect(res.body.pagination.total).toBe(0)
  })

  it('cannot reach another tenant’s project by naming it', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'project_manager' })
    expect(ids((await list(`?project_id=${PROJECT_C}`)).body)).toEqual([])
  })
})

// ─── §43 live membership ─────────────────────────────────────────────────────
describe('§43 revoking membership changes the collection on the next request', () => {
  it('drops the project rows and keeps the global one, with the SAME token', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'project_manager' })
    expect(ids((await list()).body)).toEqual(['a1', 'a2', 'g1'])

    MEMBERS = MEMBERS.map(m =>
      m.projectId === PROJECT_A && m.userId === USER_A ? { ...m, active: false } : m)

    // Load-bearing for the dual model: the project rows go, the tenant-global
    // row stays — it never depended on a membership.
    expect(ids((await list()).body)).toEqual(['g1'])
  })

  it('restores them when the membership is reopened', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'project_manager' })
    MEMBERS = MEMBERS.map(m =>
      m.projectId === PROJECT_A && m.userId === USER_A ? { ...m, active: false } : m)
    expect(ids((await list()).body)).toEqual(['g1'])
    MEMBERS = MEMBERS.map(m =>
      m.projectId === PROJECT_A && m.userId === USER_A ? { ...m, active: true } : m)
    expect(ids((await list()).body)).toEqual(['a1', 'a2', 'g1'])
  })
})

// ─── §45 live capability ─────────────────────────────────────────────────────
describe('§45 the stored role decides, on every request', () => {
  it('stops returning rows when the role loses the capability, same token', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'project_manager' })
    expect((await list()).status).toBe(200)
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'engineer' })
    expect((await list()).status).toBe(403)
  })
})

// ─── §62 the path-project matrix ─────────────────────────────────────────────
describe('§62 a path-project collection refuses a project the caller cannot reach', () => {
  const logs = (p: string) => request(app).get(`/api/v1/projects/${p}/daily-logs`)

  it('admits a member on their own project path', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'field_ops' })   // holds construction.view
    expect((await logs(PROJECT_A)).status).toBe(200)
  })

  it('refuses the same caller on another project path', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'field_ops' })
    expect((await logs(PROJECT_B)).status).toBe(404)
  })

  it('admits the Owner anywhere in their own tenant', async () => {
    setCaller({ id: OWNER_A, tenantId: TENANT_A, role: 'owner' })
    expect((await logs(PROJECT_B)).status).toBe(200)
  })

  it('refuses an Owner reaching into another tenant', async () => {
    setCaller({ id: OWNER_A, tenantId: TENANT_A, role: 'owner' })
    expect((await logs(PROJECT_C)).status).toBe(404)
  })
})
