/**
 * ADR-014 Phase 3D — project-bound MUTATION record scope, through real routers.
 *
 * Phase 3C proved the mechanism on three routers. Phase 3D rolled it across the
 * whole project-bound mutation surface, in three shapes, and this file proves
 * each shape refuses independently and writes nothing when it does:
 *
 *   path-project    POST /projects/:projectId/...   scope from the route
 *   direct-ID       PATCH /resource/:id             scope from the record's parent
 *   body-project    POST /team/assignments          scope from the payload's target
 *
 * Fixture (HOB §29):
 *
 *   Tenant A   USER_A → member of PROJECT_A
 *              USER_B → member of PROJECT_B
 *   Tenant B   USER_C, PROJECT_C
 *
 * The database is modelled as rows and every authorization answer is derived by
 * reading the statement the resolver actually issued — its FROM, its JOIN and
 * its active-membership window. A fixture that returned the "right" project
 * regardless of the query could not tell a correct parent hop from a broken one.
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
vi.mock('../services/actionService', () => ({ createAction: vi.fn() }))

import type { UserRole } from '../authz/capabilities'

const TENANT_A = 'aaaaaaaa-0000-4000-8000-000000000001'
const TENANT_B = 'bbbbbbbb-0000-4000-8000-000000000002'
const USER_A   = '10000000-0000-4000-8000-00000000000a'
const USER_B   = '10000000-0000-4000-8000-00000000000b'
const PROJECT_A = '30000000-0000-4000-8000-00000000000a'
const PROJECT_B = '30000000-0000-4000-8000-00000000000b'
const PROJECT_C = '30000000-0000-4000-8000-00000000000c'

const NCR_A   = '50000000-0000-4000-8000-00000000000a'
const CAPA_A  = '51000000-0000-4000-8000-00000000000a'
const TASK_A  = '52000000-0000-4000-8000-00000000000a'
const DEP_A   = '53000000-0000-4000-8000-00000000000a'
const LOG_A   = '54000000-0000-4000-8000-00000000000a'

const TABLES: Record<string, Record<string, string>[]> = {
  projects:              [{ id: PROJECT_A, tenant_id: TENANT_A }, { id: PROJECT_B, tenant_id: TENANT_A },
                          { id: PROJECT_C, tenant_id: TENANT_B }],
  ncrs:                  [{ id: NCR_A,  project_id: PROJECT_A }],
  corrective_actions:    [{ id: CAPA_A, project_id: PROJECT_A }],
  schedule_tasks:        [{ id: TASK_A, project_id: PROJECT_A }],
  schedule_dependencies: [{ id: DEP_A,  predecessor_id: TASK_A }],
  daily_logs:            [{ id: LOG_A,  project_id: PROJECT_A }],
}

interface MemberRow { projectId: string; userId: string; active: boolean }
let MEMBERS: MemberRow[]

interface Caller { id: string; tenantId: string; role: UserRole }
let caller: Caller
const setCaller = (c: Caller) => { caller = c; (globalThis as Record<string, unknown>)['__p3d'] = c }

vi.mock('../auth', () => ({
  requireAuth: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    const c = (globalThis as Record<string, unknown>)['__p3d'] as Caller
    req['auth'] = { sub: c.id, tid: c.tenantId, role: c.role, jti: 'jti' }
    next()
  },
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}))
vi.mock('../middleware/tenant', () => ({
  requireTenant: () => (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req['tenantId'] = ((globalThis as Record<string, unknown>)['__p3d'] as Caller).tenantId
    next()
  },
}))

import { ncrRouter }       from '../routes/ncr'
import scheduleRouter      from '../routes/schedule'
import { dailyLogsRouter } from '../routes/dailyLogs'
import { teamRouter }      from '../routes/team'

function makeApp() {
  const app = express()
  app.use(express.json())
  for (const r of [ncrRouter, dailyLogsRouter, teamRouter]) app.use('/api/v1', r as never)
  // schedule.ts is mounted under its own prefix in server.ts, and its routes are
  // declared relative to it — mounting it flat would change the paths.
  app.use('/api/v1/schedule', scheduleRouter as never)
  return app
}

const SQL = /\b(SELECT|INSERT|UPDATE|DELETE)\b/i
const sqlOf = (args: unknown[]): string =>
  args.find((a): a is string => typeof a === 'string' && SQL.test(a)) ?? ''

function businessQueries(): string[] {
  return mockQuery.mock.calls.map(c => sqlOf(c)).filter(s =>
    s && !/FROM\s+users\s+WHERE\s+id/i.test(s)
       && !/AS\s+project_id/i.test(s)
       && !/FROM\s+projects\s+p?\b/i.test(s))
}
const mutated = () => businessQueries().some(s => /\b(UPDATE|INSERT|DELETE)\b/i.test(s))

beforeEach(() => {
  MEMBERS = [
    { projectId: PROJECT_A, userId: USER_A, active: true },
    { projectId: PROJECT_B, userId: USER_B, active: true },
  ]
  setCaller({ id: USER_A, tenantId: TENANT_A, role: 'project_manager' })

  mockQuery.mockReset()
  mockQuery.mockImplementation(async (...args: unknown[]) => {
    const sql = sqlOf(args)
    const params = (args.find(a => Array.isArray(a)) as unknown[] | undefined) ?? []
    const empty = { rows: [], rowCount: 0 }

    if (/FROM\s+users\s+WHERE\s+id/i.test(sql)) {
      return { rows: [{ id: caller.id, tenant_id: caller.tenantId, role: caller.role, is_active: true }], rowCount: 1 }
    }

    // resolveParentProjectId — follow the statement's own FROM/JOIN
    if (/AS\s+project_id/i.test(sql)) {
      const id = params[0] as string
      const from = /FROM\s+(\w+)\s+r/i.exec(sql)?.[1]
      if (!from || !TABLES[from]) return empty
      const child = TABLES[from].find(x => x['id'] === id)
      if (!child) return empty
      const join = /JOIN\s+(\w+)\s+p\s+ON\s+p\.(\w+)\s*=\s*r\.(\w+)/i.exec(sql)
      if (join) {
        const [, parentTable, parentIdCol, viaCol] = join
        const parent = TABLES[parentTable]?.find(x => x[parentIdCol] === child[viaCol])
        return parent?.['project_id'] ? { rows: [{ project_id: parent['project_id'] }], rowCount: 1 } : empty
      }
      const col = /SELECT\s+r\.(\w+)\s+AS\s+project_id/i.exec(sql)?.[1] ?? 'project_id'
      return child[col] ? { rows: [{ project_id: child[col] }], rowCount: 1 } : empty
    }

    // filterAccessibleProjectIds — active window read OFF the statement
    if (/FROM\s+projects\s+p?\b/i.test(sql) && /ANY\(\$\d+::uuid\[\]\)/i.test(sql)) {
      const ids = (params.find(x => Array.isArray(x)) as string[] | undefined) ?? []
      const tenantWide = !/project_members/i.test(sql)
      const honoursWindow =
        /active_from\s*<=\s*NOW\(\)/i.test(sql) &&
        /active_to\s+IS\s+NULL\s+OR\s+m\.active_to\s*>\s*NOW\(\)/i.test(sql)
      // The tenant predicate is read OFF the statement too. Enforcing it in the
      // fixture would hide its removal from the product — an owner branch that
      // dropped it would still look tenant-bounded here.
      const honoursTenant = /tenant_id = current_setting\('app\.current_tenant_id', true\)::uuid/i.test(sql)
      const reachable = ids.filter(id => {
        const project = TABLES['projects']!.find(x => x['id'] === id)
        if (!project) return false
        if (honoursTenant && project['tenant_id'] !== caller.tenantId) return false
        if (tenantWide) return true
        return MEMBERS.some(m => m.projectId === id && m.userId === caller.id && (honoursWindow ? m.active : true))
      })
      return { rows: reachable.map(id => ({ id })), rowCount: reachable.length }
    }

    return { rows: [{ id: 'row-1', tenant_id: caller.tenantId, project_id: PROJECT_A }], rowCount: 1 }
  })
})

// ─── §14 path-project mutations ──────────────────────────────────────────────
describe('§14 a mutation under /projects/:projectId requires scope to that project', () => {
  const creates: [string, string, object][] = [
    ['NCR',       `/api/v1/projects/@/ncrs`,       { title: 'Weld defect' }],
    ['daily log', `/api/v1/projects/@/daily-logs`, { log_date: '2026-08-22', weather: 'clear' }],
  ]

  for (const [name, tmpl, body] of creates) {
    it(`admits a member creating in their own project — ${name}`, async () => {
      const res = await request(makeApp()).post(tmpl.replace('@', PROJECT_A)).send(body)
      expect(res.status, `${name}: a member must still be admitted`).not.toBe(404)
    })

    it(`refuses the same caller in another project, with zero write — ${name}`, async () => {
      const res = await request(makeApp()).post(tmpl.replace('@', PROJECT_B)).send(body)
      expect(res.status, `${name}: the capability must not reach an unrelated project`).toBe(404)
      expect(mutated(), `${name}: the refused create still wrote`).toBe(false)
    })

    it(`refuses a project in another tenant — ${name}`, async () => {
      const res = await request(makeApp()).post(tmpl.replace('@', PROJECT_C)).send(body)
      expect(res.status).toBe(404)
      expect(mutated()).toBe(false)
    })
  }
})

// ─── §15 direct-ID mutations, incl. an FK hop ────────────────────────────────
describe('§15 a direct-ID mutation resolves the record’s parent first', () => {
  const cases: [string, 'patch' | 'delete', string, object][] = [
    ['NCR update',            'patch',  `/api/v1/ncrs/${NCR_A}`,                    { title: 'x' }],
    ['CAPA update',           'patch',  `/api/v1/capas/${CAPA_A}`,                  { description: 'x' }],
    ['schedule task update',  'patch',  `/api/v1/schedule/tasks/${TASK_A}`,         { name: 'x' }],
    ['schedule task delete',  'delete', `/api/v1/schedule/tasks/${TASK_A}`,         {}],
    ['schedule dependency',   'delete', `/api/v1/schedule/dependencies/${DEP_A}`,   {}],
  ]

  for (const [name, method, url, body] of cases) {
    it(`refuses a same-tenant non-member, and writes nothing — ${name}`, async () => {
      setCaller({ id: USER_B, tenantId: TENANT_A, role: 'project_manager' })
      const res = await request(makeApp())[method](url).send(body)
      expect(res.status, `${name}: knowing the id must not be enough`).toBe(404)
      expect(mutated(), `${name}: the refused mutation still wrote`).toBe(false)
    })

    it(`admits a member of the record's project — ${name}`, async () => {
      const res = await request(makeApp())[method](url).send(body)
      expect(res.status, `${name}: a member must still be admitted`).not.toBe(404)
    })
  }

  it('resolves a dependency through its predecessor task, not its own id', async () => {
    // schedule_dependencies reaches a project only via predecessor_id. A member
    // is admitted and a stranger refused, which is only possible if the FK hop
    // actually ran.
    expect((await request(makeApp()).delete(`/api/v1/schedule/dependencies/${DEP_A}`)).status).not.toBe(404)
    setCaller({ id: USER_B, tenantId: TENANT_A, role: 'project_manager' })
    expect((await request(makeApp()).delete(`/api/v1/schedule/dependencies/${DEP_A}`)).status).toBe(404)
  })
})

// ─── §16 body-selected project ───────────────────────────────────────────────
describe('§16 a payload-named project is verified, never believed', () => {
  const assign = (projectId: string) => ({
    memberId: '60000000-0000-4000-8000-00000000000a', projectId,
    assignmentRole: 'Field Engineer', startDate: '2026-08-22',
  })

  it('admits assigning into a project the caller belongs to', async () => {
    const res = await request(makeApp()).post('/api/v1/team/assignments').send(assign(PROJECT_A))
    expect(res.status).not.toBe(404)
  })

  it('refuses assigning into an unrelated project, with zero write', async () => {
    const res = await request(makeApp()).post('/api/v1/team/assignments').send(assign(PROJECT_B))
    expect(res.status, 'team.approve must not reach an unrelated project').toBe(404)
    expect(mutated(), 'the refused assignment still wrote').toBe(false)
  })

  it('refuses a project in another tenant', async () => {
    const res = await request(makeApp()).post('/api/v1/team/assignments').send(assign(PROJECT_C))
    expect(res.status).toBe(404)
    expect(mutated()).toBe(false)
  })

  it('ignores caller-supplied authorization claims in the payload', async () => {
    const res = await request(makeApp()).post('/api/v1/team/assignments')
      .send({ ...assign(PROJECT_B), tenant_id: TENANT_A, authorized: true, memberOf: [PROJECT_B] })
    expect(res.status, 'a self-asserted membership claim is not evidence').toBe(404)
    expect(mutated()).toBe(false)
  })
})

// ─── §24 consequential transitions need BOTH authorities ─────────────────────
describe('§24 a transition needs its approval capability AND project scope', () => {
  const transitions: [string, string][] = [
    ['NCR close',   `/api/v1/ncrs/${NCR_A}/close`],
    ['CAPA verify', `/api/v1/capas/${CAPA_A}/verify`],
  ]

  for (const [name, url] of transitions) {
    it(`refuses an approval-capability holder who is out of scope — ${name}`, async () => {
      setCaller({ id: USER_B, tenantId: TENANT_A, role: 'project_manager' })  // holds quality.verify
      const res = await request(makeApp()).post(url).send({})
      expect(res.status, `${name}: approval authority alone must not suffice`).toBe(404)
      expect(mutated(), `${name}: the refused transition still wrote`).toBe(false)
    })

    it(`refuses a scoped caller lacking the approval capability — ${name}`, async () => {
      setCaller({ id: USER_A, tenantId: TENANT_A, role: 'engineer' })         // no quality.verify
      const res = await request(makeApp()).post(url).send({})
      expect(res.status, `${name}: membership must not confer approval authority`).toBe(403)
      expect(mutated()).toBe(false)
    })
  }
})

// ─── §28 live revocation on writes ───────────────────────────────────────────
describe('§28 closing a membership refuses the next write, same token', () => {
  it('admits, then refuses after revocation, with no token refresh', async () => {
    const app = makeApp()
    expect((await request(app).patch(`/api/v1/ncrs/${NCR_A}`).send({ title: 'x' })).status).not.toBe(404)

    MEMBERS = MEMBERS.map(m =>
      m.projectId === PROJECT_A && m.userId === USER_A ? { ...m, active: false } : m)
    mockQuery.mockClear()

    const after = await request(app).patch(`/api/v1/ncrs/${NCR_A}`).send({ title: 'x' })
    expect(after.status, 'scope is re-read from the database every request').toBe(404)
    expect(mutated(), 'a revoked member still wrote').toBe(false)
  })
})

// ─── §30 the two authorities discriminate independently ──────────────────────
describe('§30 functional authority and record authority are independent', () => {
  it('capability without membership is refused', async () => {
    setCaller({ id: USER_B, tenantId: TENANT_A, role: 'engineer' })   // holds quality.write
    expect((await request(makeApp()).patch(`/api/v1/ncrs/${NCR_A}`).send({ title: 'x' })).status).toBe(404)
  })

  it('membership without capability is refused, and with 403 not 404', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'viewer' })     // in PROJECT_A, no write
    const res = await request(makeApp()).patch(`/api/v1/ncrs/${NCR_A}`).send({ title: 'x' })
    expect(res.status, 'the functional dimension refuses first, and says so').toBe(403)
  })

  it('both together are admitted', async () => {
    expect((await request(makeApp()).patch(`/api/v1/ncrs/${NCR_A}`).send({ title: 'x' })).status).not.toBe(404)
  })
})

// ─── §29 cross-tenant ────────────────────────────────────────────────────────
describe('§29 a record in another tenant is unreachable, owner included', () => {
  it('refuses an owner reaching outside their own tenant', async () => {
    setCaller({ id: USER_B, tenantId: TENANT_B, role: 'owner' })
    const res = await request(makeApp()).patch(`/api/v1/ncrs/${NCR_A}`).send({ title: 'x' })
    expect(res.status, 'owner is tenant-wide, never global').toBe(404)
  })

  it('admits an owner inside their own tenant without any membership row', async () => {
    setCaller({ id: USER_B, tenantId: TENANT_A, role: 'owner' })
    expect(MEMBERS.some(m => m.userId === USER_B && m.projectId === PROJECT_A)).toBe(false)
    const res = await request(makeApp()).patch(`/api/v1/ncrs/${NCR_A}`).send({ title: 'x' })
    expect(res.status, 'project.list.all is tenant-wide scope, not a bypass').not.toBe(404)
  })
})
