/**
 * ADR-014 Phase 3G — the collection remainder, exercised through the real routers.
 *
 * The five live gaps Phase 3F left for a non-Owner:
 *
 *   GET /team/members/:id/assignments      a member's work on projects you cannot see
 *   GET /team/members/:memberId/timesheets the hours behind that work
 *   GET /commissioning/uploads             staged uploads filed against any project
 *   GET /files/folders                     folders, and how many documents they hold
 *   GET /ops/readiness                     readiness for every project in the tenant
 *
 * The load-bearing distinction (§4, §22): the OUTER record and the ROWS beneath
 * it have different authorities. Jane Doe stays visible to anyone holding
 * `team.view`; Jane's Project-B assignment does not.
 *
 * Fixture (§63), modelled rather than mocked per call. The fixture reads the
 * tenant predicate, the membership predicate, the NULL/global branch and the
 * active window OFF the statement the product issued, so removing any of them
 * changes the rows this returns — which is what makes the mutation tests mean
 * something.
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
const MEMBER_M  = '20000000-0000-4000-8000-00000000000m'.replace('m', 'e')

/** One member working on two projects — the §5 fixture. */
interface Row { id: string; project_id: string | null; tenant_id: string; hours?: number }
const ASSIGNMENTS: Row[] = [
  { id: 'asn-A', project_id: PROJECT_A, tenant_id: TENANT_A },
  { id: 'asn-B', project_id: PROJECT_B, tenant_id: TENANT_A },
]
const TIMESHEETS: Row[] = [
  { id: 'ts-A', project_id: PROJECT_A, tenant_id: TENANT_A, hours: 8 },
  { id: 'ts-B', project_id: PROJECT_B, tenant_id: TENANT_A, hours: 10 },
]
/** DUAL resources: a project-less row is tenant-global and must survive. */
const UPLOADS: Row[] = [
  { id: 'up-G', project_id: null,      tenant_id: TENANT_A },
  { id: 'up-A', project_id: PROJECT_A, tenant_id: TENANT_A },
  { id: 'up-B', project_id: PROJECT_B, tenant_id: TENANT_A },
  { id: 'up-C', project_id: PROJECT_C, tenant_id: TENANT_B },
]
const FOLDERS: Row[] = [
  { id: 'fd-G', project_id: null,      tenant_id: TENANT_A },
  { id: 'fd-A', project_id: PROJECT_A, tenant_id: TENANT_A },
  { id: 'fd-B', project_id: PROJECT_B, tenant_id: TENANT_A },
]
const PROJECTS: Row[] = [
  { id: PROJECT_A, project_id: PROJECT_A, tenant_id: TENANT_A },
  { id: PROJECT_B, project_id: PROJECT_B, tenant_id: TENANT_A },
  { id: PROJECT_C, project_id: PROJECT_C, tenant_id: TENANT_B },
]

interface MemberRow { projectId: string; userId: string; active: boolean }
let MEMBERS: MemberRow[]
interface Caller { id: string; tenantId: string; role: UserRole; active?: boolean }
let caller: Caller
const setCaller = (c: Caller) => { caller = c; (globalThis as Record<string, unknown>)['__p3g'] = c }

vi.mock('../auth', () => ({
  requireAuth: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    const c = (globalThis as Record<string, unknown>)['__p3g'] as Caller
    req['auth'] = { sub: c.id, tid: c.tenantId, role: c.role, jti: 'jti' }
    next()
  },
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}))
vi.mock('../middleware/tenant', () => ({
  requireTenant: () => (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req['tenantId'] = ((globalThis as Record<string, unknown>)['__p3g'] as Caller).tenantId
    next()
  },
}))

import { teamRouter }       from '../routes/team'
import { timesheetsRouter } from '../routes/timesheets'
import { opsRouter }        from '../routes/ops'
import filesRouter          from '../routes/files'
import commissioningRouter  from '../routes/commissioning'

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1', teamRouter as never)
  app.use('/api/v1', timesheetsRouter as never)
  app.use('/api/v1/ops', opsRouter as never)
  app.use('/api/v1/files', filesRouter as never)
  app.use('/api/v1/commissioning', commissioningRouter as never)
  return app
}
const app = makeApp()

const SQL = /\b(SELECT|INSERT|UPDATE|DELETE)\b/i
const sqlOf = (a: unknown[]): string =>
  a.find((x): x is string => typeof x === 'string' && SQL.test(x)) ?? ''

/**
 * Apply the statement's OWN predicates. Every rule is read off the SQL, so a
 * removed predicate really widens what this returns.
 */
function visible(rows: Row[], sql: string): Row[] {
  const honoursTenant = /tenant_id\s*=\s*(\$1|current_setting)/i.test(sql)
  const hasMembership = /project_members/i.test(sql)
  const allowsGlobal  = /project_id IS NULL OR/i.test(sql)
  const honoursWindow = /active_from\s*<=\s*NOW\(\)/i.test(sql)
                     && /active_to IS NULL OR m\.active_to > NOW\(\)/i.test(sql)

  return rows.filter(r => {
    if (honoursTenant && r.tenant_id !== caller.tenantId) return false
    if (!hasMembership) return true                          // tenant-wide or unscoped
    if (r.project_id === null) return allowsGlobal
    return MEMBERS.some(m =>
      m.projectId === r.project_id && m.userId === caller.id && (honoursWindow ? m.active : true))
  })
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
    const sql = sqlOf(args)

    if (/FROM\s+users\s+WHERE\s+id/i.test(sql)) {
      return { rows: [{ id: caller.id, tenant_id: caller.tenantId, role: caller.role,
                        is_active: caller.active !== false }], rowCount: 1 }
    }
    if (/FROM\s+project_assignments a/i.test(sql) && /project_name/i.test(sql)) {
      const rows = visible(ASSIGNMENTS, sql)
      return { rows: rows.map(r => ({ ...r, member_id: MEMBER_M, allocation_pct: 50,
                                      start_date: '2026-01-01', project_name: 'p' })), rowCount: rows.length }
    }
    // getMember / listMembers — the member survives; the JOIN decides the counts
    if (/FROM team_members m/i.test(sql)) {
      const joined = visible(ASSIGNMENTS, sql)
      return { rows: [{ id: MEMBER_M, tenant_id: TENANT_A, first_name: 'Jane', last_name: 'Doe',
                        status: 'active', active_projects: joined.length,
                        total_allocation: joined.length * 50 }], rowCount: 1 }
    }
    if (/FROM timesheets t/i.test(sql)) {
      const rows = visible(TIMESHEETS, sql)
      return { rows: rows.map(r => ({ ...r, member_id: MEMBER_M, week_start: '2026-01-05',
                                      status: 'draft', total_hours: r.hours, member_name: 'Jane Doe' })),
               rowCount: rows.length }
    }
    if (/FROM source_uploads/i.test(sql)) {
      const rows = visible(UPLOADS, sql)
      return { rows: rows.map(r => ({ ...r, file_name: r.id, created_at: '2026-01-01' })), rowCount: rows.length }
    }
    if (/FROM document_folders f/i.test(sql)) {
      const rows = visible(FOLDERS, sql)
      return { rows: rows.map(r => ({ ...r, name: r.id, path: '/' + r.id })), rowCount: rows.length }
    }
    if (/FROM projects p/i.test(sql) && /status NOT IN/i.test(sql)) {
      const rows = visible(PROJECTS, sql)
      return { rows: rows.map(r => ({ id: r.id, name: r.id })), rowCount: rows.length }
    }
    // readiness metrics + any other query
    return { rows: [], rowCount: 0 }
  })
})

const ids = (xs: { id?: string; file_name?: string }[] | undefined) =>
  (xs ?? []).map(x => x.id ?? x.file_name).sort()

// ─── §5 member-keyed assignments ─────────────────────────────────────────────
describe('§5 a member’s assignments are filtered to the caller’s projects', () => {
  const get = () => request(app).get(`/api/v1/team/members/${MEMBER_M}/assignments`)

  it('shows a member of A only the Project-A assignment', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'project_manager' })
    const res = await get()
    expect(res.status).toBe(200)
    expect(ids(res.body.assignments)).toEqual(['asn-A'])
  })

  it('shows a member of B the mirror image, so the filter is per-caller', async () => {
    setCaller({ id: USER_B, tenantId: TENANT_A, role: 'project_manager' })
    expect(ids((await get()).body.assignments)).toEqual(['asn-B'])
  })

  it('shows the Owner both, without a membership row', async () => {
    setCaller({ id: OWNER_A, tenantId: TENANT_A, role: 'owner' })
    expect(MEMBERS.some(m => m.userId === OWNER_A)).toBe(false)
    expect(ids((await get()).body.assignments)).toEqual(['asn-A', 'asn-B'])
  })

  it('returns an empty list, not a 403, to a holder with no visible projects (§38)', async () => {
    setCaller({ id: USER_C, tenantId: TENANT_A, role: 'project_manager' })
    const res = await get()
    expect(res.status).toBe(200)
    expect(ids(res.body.assignments)).toEqual([])
  })
})

// ─── §4/§22 the member is not hidden, only their rows ───────────────────────
describe('§4 the outer member stays visible while their project rows are filtered', () => {
  it('still returns Jane to a caller who can see none of her projects', async () => {
    setCaller({ id: USER_C, tenantId: TENANT_A, role: 'project_manager' })
    const res = await request(app).get(`/api/v1/team/members/${MEMBER_M}`)
    expect(res.status, 'a member must not be hidden for working on another project').toBe(200)
    expect(res.body.member.firstName ?? res.body.member.first_name).toBe('Jane')
  })

  it('reports counts over visible assignments only (§7)', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'project_manager' })
    const a = (await request(app).get(`/api/v1/team/members/${MEMBER_M}`)).body.member
    expect(a.activeProjects, 'two assignments exist; one is visible').toBe(1)
    expect(a.totalAllocation, 'the hidden project must not raise the allocation').toBe(50)

    setCaller({ id: OWNER_A, tenantId: TENANT_A, role: 'owner' })
    const o = (await request(app).get(`/api/v1/team/members/${MEMBER_M}`)).body.member
    expect(o.activeProjects, 'the Owner sees both, so the count is not a constant').toBe(2)
  })
})

// ─── §6/§7 member-keyed timesheets and their hours ──────────────────────────
describe('§6 a member’s timesheets are filtered, and so are the hours', () => {
  const get = () => request(app).get(`/api/v1/team/members/${MEMBER_M}/timesheets`)

  it('returns only the authorized week, not the hidden project’s', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'project_manager' })
    const rows = (await get()).body.timesheets as { id: string; totalHours?: number }[]
    expect(rows.map(r => r.id)).toEqual(['ts-A'])
  })

  it('never lets the hidden project’s hours reach the response', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'project_manager' })
    const body = JSON.stringify((await get()).body)
    expect(body).not.toMatch(/ts-B/)
    expect(body, '10 hours belong to a project this caller cannot see').not.toMatch(/"totalHours":10/)
  })

  it('gives the Owner both weeks', async () => {
    setCaller({ id: OWNER_A, tenantId: TENANT_A, role: 'owner' })
    expect(ids((await get()).body.timesheets)).toEqual(['ts-A', 'ts-B'])
  })
})

// ─── §39 cross-tenant outer member ──────────────────────────────────────────
describe('§39 a foreign-tenant member id yields nothing', () => {
  it('returns no assignments to a caller in another tenant', async () => {
    setCaller({ id: USER_C, tenantId: TENANT_B, role: 'project_manager' })
    const res = await request(app).get(`/api/v1/team/members/${MEMBER_M}/assignments`)
    expect(ids(res.body.assignments)).toEqual([])
  })
})

// ─── §40 live membership revocation ─────────────────────────────────────────
describe('§40 revoking a membership changes the member’s rows on the next request', () => {
  it('drops the project’s assignment with the SAME token, keeping the member', async () => {
    setCaller({ id: OWNER_A, tenantId: TENANT_A, role: 'owner' })
    expect(ids((await request(app).get(`/api/v1/team/members/${MEMBER_M}/assignments`)).body.assignments))
      .toEqual(['asn-A', 'asn-B'])

    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'project_manager' })
    expect(ids((await request(app).get(`/api/v1/team/members/${MEMBER_M}/assignments`)).body.assignments))
      .toEqual(['asn-A'])

    MEMBERS = MEMBERS.map(m =>
      m.projectId === PROJECT_A && m.userId === USER_A ? { ...m, active: false } : m)

    expect(ids((await request(app).get(`/api/v1/team/members/${MEMBER_M}/assignments`)).body.assignments))
      .toEqual([])
    // and the member is still there
    expect((await request(app).get(`/api/v1/team/members/${MEMBER_M}`)).status).toBe(200)
  })
})

// ─── §41 live capability revocation ─────────────────────────────────────────
describe('§41 the stored role decides, on every request', () => {
  it('refuses with 403 once the role loses team.view, same token', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'project_manager' })
    expect((await request(app).get(`/api/v1/team/members/${MEMBER_M}/assignments`)).status).toBe(200)
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'engineer' })   // no team.view
    expect((await request(app).get(`/api/v1/team/members/${MEMBER_M}/assignments`)).status).toBe(403)
  })
})

// ─── §43 source_uploads, a DUAL collection ──────────────────────────────────
describe('§43 commissioning uploads keep tenant-global rows and filter the rest', () => {
  const get = () => request(app).get('/api/v1/commissioning/uploads')

  it('gives a member of A the global upload plus A’s', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'project_manager' })
    const res = await get()
    expect(res.status).toBe(200)
    expect(ids(res.body.items)).toEqual(['up-A', 'up-G'])
  })

  it('gives a member of B the global upload plus B’s', async () => {
    setCaller({ id: USER_B, tenantId: TENANT_A, role: 'project_manager' })
    expect(ids((await get()).body.items)).toEqual(['up-B', 'up-G'])
  })

  it('never crosses the tenant', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'project_manager' })
    expect(ids((await get()).body.items)).not.toContain('up-C')
  })
})

// ─── §42 document_folders, a DUAL collection ────────────────────────────────
describe('§42 folders keep the global folder across a membership revocation', () => {
  const get = () => request(app).get('/api/v1/files/folders')

  it('gives a member of A the global folder plus A’s', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'project_manager' })
    const res = await get()
    expect(res.status).toBe(200)
    expect(ids(res.body.data)).toEqual(['fd-A', 'fd-G'])
  })

  it('keeps the global folder and drops the project folder when membership closes', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'project_manager' })
    expect(ids((await get()).body.data)).toEqual(['fd-A', 'fd-G'])

    MEMBERS = MEMBERS.map(m =>
      m.projectId === PROJECT_A && m.userId === USER_A ? { ...m, active: false } : m)

    // The load-bearing dual assertion: the global folder never depended on a
    // membership, so revocation must not take it away.
    expect(ids((await get()).body.data)).toEqual(['fd-G'])
  })
})

// ─── §18 /ops/readiness returns projects, scoped ────────────────────────────
describe('§18 readiness lists only projects the caller can reach', () => {
  const get = () => request(app).get('/api/v1/ops/readiness')

  it('gives a member of A only project A', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'project_manager' })
    const res = await get()
    expect(res.status).toBe(200)
    expect((res.body.data as { project_id: string }[]).map(r => r.project_id)).toEqual([PROJECT_A])
  })

  it('gives the Owner every project in their own tenant, and none outside it', async () => {
    setCaller({ id: OWNER_A, tenantId: TENANT_A, role: 'owner' })
    const got = (await get()).body.data as { project_id: string }[]
    expect(got.map(r => r.project_id).sort()).toEqual([PROJECT_A, PROJECT_B].sort())
  })

  it('refuses a role lacking the functional conjunction', async () => {
    // /ops/readiness demands project.view AND quality.view; procurement has
    // project.view but not quality.view.
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'procurement' })
    expect((await get()).status).toBe(403)
  })
})
