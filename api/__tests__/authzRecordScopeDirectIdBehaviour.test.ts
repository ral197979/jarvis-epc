/**
 * ADR-014 Phase 3C — direct-ID record scope, exercised through the real routers.
 *
 * Phase 3B closed the surfaces whose PATH names a project. This file proves the
 * surface it left open: a route that names only the RECORD.
 *
 * The condition under test is exactly the one Phase 3C exists to eliminate:
 *
 *     correct functional capability
 *   + knowledge of a record id
 *   + no live membership of that record's project
 *   = the operation still succeeded
 *
 * Fixture (HOB §28), modelled rather than mocked per call, so a test cannot pass
 * by being handed a reply the database would never give:
 *
 *   Tenant A   USER_A  → member of PROJECT_A
 *              USER_B  → member of PROJECT_B
 *   Tenant B   PROJECT_C
 *
 *   DRAWING_A / INSPECTION_A / PUNCHLIST_A / PUNCHITEM_A  belong to PROJECT_A
 *   DRAWING_B                                             belongs to PROJECT_B
 *   MARKUP_A  hangs off DRAWING_A  (FK_PATH: markup → drawing → project)
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

const DRAWING_A    = '40000000-0000-4000-8000-00000000000a'
const DRAWING_B    = '40000000-0000-4000-8000-00000000000b'
const INSPECTION_A = '50000000-0000-4000-8000-00000000000a'
const PUNCHLIST_A  = '60000000-0000-4000-8000-00000000000a'
const PUNCHITEM_A  = '70000000-0000-4000-8000-00000000000a'
const MARKUP_A     = '80000000-0000-4000-8000-00000000000a'
const ABSENT       = '90000000-0000-4000-8000-0000000000ff'

/**
 * The tables, modelled as rows rather than as answers.
 *
 * The fixture resolves a parent by READING the statement the resolver actually
 * issued — its FROM, its JOIN and its foreign key — instead of pattern-matching
 * the record id to a project. That distinction is load bearing: a fixture that
 * returns the "right" project regardless of the query cannot tell a correct FK
 * hop from a broken one, and a mutation that resolves a markup by its own id
 * would pass unnoticed.
 */
const TABLES: Record<string, Record<string, string>[]> = {
  projects:        [{ id: PROJECT_A, tenant_id: TENANT_A }, { id: PROJECT_B, tenant_id: TENANT_A }],
  drawings:        [{ id: DRAWING_A, project_id: PROJECT_A }, { id: DRAWING_B, project_id: PROJECT_B }],
  drawing_markups: [{ id: MARKUP_A, drawing_id: DRAWING_A }],
  drawing_revisions: [],
  inspections:     [{ id: INSPECTION_A, project_id: PROJECT_A }],
  punch_lists:     [{ id: PUNCHLIST_A, project_id: PROJECT_A }],
  punch_items:     [{ id: PUNCHITEM_A, project_id: PROJECT_A }],
}

interface MemberRow { projectId: string; userId: string; active: boolean }
let MEMBERS: MemberRow[]

interface Caller { id: string; tenantId: string; role: UserRole }
let caller: Caller
const setCaller = (c: Caller) => { caller = c; (globalThis as Record<string, unknown>)['__p3c'] = c }

vi.mock('../auth', () => ({
  requireAuth: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    const c = (globalThis as Record<string, unknown>)['__p3c'] as Caller
    req['auth'] = { sub: c.id, tid: c.tenantId, role: c.role, jti: 'jti' }
    next()
  },
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}))
vi.mock('../middleware/tenant', () => ({
  requireTenant: () => (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req['tenantId'] = ((globalThis as Record<string, unknown>)['__p3c'] as Caller).tenantId
    next()
  },
}))

import { drawingsRouter }    from '../routes/drawings'
import { inspectionsRouter } from '../routes/inspections'
import { punchListsRouter }  from '../routes/punchLists'

function makeApp() {
  const app = express()
  app.use(express.json())
  for (const r of [drawingsRouter, inspectionsRouter, punchListsRouter]) app.use('/api/v1', r as never)
  return app
}

const SQL = /\b(SELECT|INSERT|UPDATE|DELETE)\b/i
const sqlOf = (args: unknown[]): string =>
  args.find((a): a is string => typeof a === 'string' && SQL.test(a)) ?? ''

/** Every statement issued, excluding the authorization lookups themselves. */
function businessQueries(): string[] {
  return mockQuery.mock.calls.map(c => sqlOf(c)).filter(s =>
    s && !/FROM\s+users\s+WHERE\s+id/i.test(s)
       && !/AS\s+project_id/i.test(s)
       && !/FROM\s+projects\s+p?\b/i.test(s))
}
const mutated = () => businessQueries().some(s => /\b(UPDATE|INSERT|DELETE)\b/i.test(s))

/**
 * The database, modelled. The principal lookup, the parent-project resolution
 * and the membership test are all answered from the SAME fixture rows, so the
 * guard is exercised rather than simulated.
 */
beforeEach(() => {
  MEMBERS = [
    { projectId: PROJECT_A, userId: USER_A, active: true },
    { projectId: PROJECT_B, userId: USER_B, active: true },
  ]
  setCaller({ id: USER_A, tenantId: TENANT_A, role: 'engineer' })

  mockQuery.mockReset()
  mockQuery.mockImplementation(async (...args: unknown[]) => {
    const sql = sqlOf(args)
    const params = (args.find(a => Array.isArray(a)) as unknown[] | undefined) ?? []
    const empty = { rows: [], rowCount: 0 }

    // live principal
    if (/FROM\s+users\s+WHERE\s+id/i.test(sql)) {
      return { rows: [{ id: caller.id, tenant_id: caller.tenantId, role: caller.role, is_active: true }], rowCount: 1 }
    }

    // `resolveParentProjectId` — answered by following the statement's own
    // FROM/JOIN, so a wrong foreign key resolves to nothing, as it would.
    if (/AS\s+project_id/i.test(sql)) {
      const id   = params[0] as string
      const from = /FROM\s+(\w+)\s+r/i.exec(sql)?.[1]
      if (!from || !TABLES[from]) return empty
      const child = TABLES[from].find(x => x['id'] === id)
      if (!child) return empty

      const join = /JOIN\s+(\w+)\s+p\s+ON\s+p\.(\w+)\s*=\s*r\.(\w+)/i.exec(sql)
      if (join) {
        const [, parentTable, parentIdCol, viaCol] = join
        const fk = child[viaCol]
        const parent = TABLES[parentTable]?.find(x => x[parentIdCol] === fk)
        return parent?.['project_id']
          ? { rows: [{ project_id: parent['project_id'] }], rowCount: 1 }
          : empty
      }
      const col = /SELECT\s+r\.(\w+)\s+AS\s+project_id/i.exec(sql)?.[1] ?? 'project_id'
      return child[col] ? { rows: [{ project_id: child[col] }], rowCount: 1 }: empty
    }

    // `filterAccessibleProjectIds`. The active-membership window is read OFF the
    // statement: if the predicate is not there, closed memberships come back
    // too — which is exactly what the database would do.
    if (/FROM\s+projects\s+p?\b/i.test(sql) && /ANY\(\$\d+::uuid\[\]\)/i.test(sql)) {
      const ids = (params.find(x => Array.isArray(x)) as string[] | undefined) ?? []
      const tenantWide = !/project_members/i.test(sql)
      const honoursWindow =
        /active_from\s*<=\s*NOW\(\)/i.test(sql) &&
        /active_to\s+IS\s+NULL\s+OR\s+m\.active_to\s*>\s*NOW\(\)/i.test(sql)

      const reachable = ids.filter(id => {
        const project = TABLES['projects']!.find(x => x['id'] === id)
        if (!project || project['tenant_id'] !== caller.tenantId) return false
        if (tenantWide) return true
        return MEMBERS.some(m =>
          m.projectId === id && m.userId === caller.id && (honoursWindow ? m.active : true))
      })
      return { rows: reachable.map(id => ({ id })), rowCount: reachable.length }
    }

    // any business query
    return { rows: [{ id: 'row-1', tenant_id: caller.tenantId, project_id: PROJECT_A }], rowCount: 1 }
  })
})

// ─── §18–§20 direct-ID reads ─────────────────────────────────────────────────
describe('§18–§20 a direct-ID read requires scope to the record’s project', () => {
  const reads: [string, string][] = [
    ['drawing detail',   `/api/v1/drawings/${DRAWING_A}`],
    ['drawing revisions', `/api/v1/drawings/${DRAWING_A}/revisions`],
    ['drawing markups',  `/api/v1/drawings/${DRAWING_A}/markups`],
    ['inspection detail', `/api/v1/inspections/${INSPECTION_A}`],
    ['punch list detail', `/api/v1/punch-lists/${PUNCHLIST_A}`],
    ['punch list items',  `/api/v1/punch-lists/${PUNCHLIST_A}/items`],
  ]

  for (const [name, url] of reads) {
    it(`admits a member of the record's project — ${name}`, async () => {
      const res = await request(makeApp()).get(url)
      expect(res.status, `${name}: a member must still be admitted`).toBe(200)
    })

    it(`refuses a same-tenant NON-member with 404 — ${name}`, async () => {
      setCaller({ id: USER_B, tenantId: TENANT_A, role: 'engineer' })
      const res = await request(makeApp()).get(url)
      expect(res.status, `${name}: capability + known id must not be enough`).toBe(404)
    })
  }

  it('does not load the payload before refusing (§20)', async () => {
    setCaller({ id: USER_B, tenantId: TENANT_A, role: 'engineer' })
    const res = await request(makeApp()).get(`/api/v1/drawings/${DRAWING_A}`)
    expect(res.status).toBe(404)
    expect(businessQueries(), 'the refusal must precede every payload query').toEqual([])
  })

  it('is indistinguishable from a record that does not exist', async () => {
    setCaller({ id: USER_B, tenantId: TENANT_A, role: 'engineer' })
    const outOfScope = await request(makeApp()).get(`/api/v1/drawings/${DRAWING_A}`)
    const missing    = await request(makeApp()).get(`/api/v1/drawings/${ABSENT}`)
    expect(outOfScope.status).toBe(missing.status)
    expect(outOfScope.body).toEqual(missing.body)
  })

  it('refuses a malformed record id rather than passing it to a uuid column', async () => {
    const res = await request(makeApp()).get('/api/v1/drawings/not-a-uuid')
    expect(res.status).toBe(404)
    expect(businessQueries()).toEqual([])
  })
})

// ─── §17, §28, §34 direct-ID mutations ───────────────────────────────────────
describe('§17 a direct-ID mutation requires scope, and refuses before writing', () => {
  const mutations: [string, 'patch' | 'delete' | 'post', string, object][] = [
    ['drawing update',   'patch',  `/api/v1/drawings/${DRAWING_A}`,        { title: 'x' }],
    ['drawing delete',   'delete', `/api/v1/drawings/${DRAWING_A}`,        {}],
    ['markup update',    'patch',  `/api/v1/markups/${MARKUP_A}`,          { note: 'x' }],
    ['markup delete',    'delete', `/api/v1/markups/${MARKUP_A}`,          {}],
    ['punch list update','patch',  `/api/v1/punch-lists/${PUNCHLIST_A}`,   { title: 'x' }],
    ['punch list delete','delete', `/api/v1/punch-lists/${PUNCHLIST_A}`,   {}],
    ['punch item delete','delete', `/api/v1/punch-items/${PUNCHITEM_A}`,   {}],
  ]

  for (const [name, method, url, body] of mutations) {
    it(`refuses a same-tenant non-member, and writes nothing — ${name}`, async () => {
      setCaller({ id: USER_B, tenantId: TENANT_A, role: 'engineer' })
      const res = await request(makeApp())[method](url).send(body)
      expect(res.status, `${name}: must be refused`).toBe(404)
      expect(mutated(), `${name}: the refused path still wrote`).toBe(false)
    })
  }

  it('resolves a parent through a foreign key, not just a direct column (§36 FK_PATH)', async () => {
    // MARKUP_A reaches its project only through DRAWING_A. A member of that
    // project is admitted; a non-member is refused — which is only possible if
    // the FK hop actually happened.
    const asMember = await request(makeApp()).patch(`/api/v1/markups/${MARKUP_A}`).send({ note: 'x' })
    expect(asMember.status, 'the markup owner’s project member must be admitted').not.toBe(404)

    setCaller({ id: USER_B, tenantId: TENANT_A, role: 'engineer' })
    const asStranger = await request(makeApp()).patch(`/api/v1/markups/${MARKUP_A}`).send({ note: 'x' })
    expect(asStranger.status).toBe(404)
  })
})

// ─── §15 create under a project ──────────────────────────────────────────────
describe('§15 creating under a project requires scope to THAT project', () => {
  it('admits a member creating in their own project', async () => {
    const res = await request(makeApp())
      .post(`/api/v1/projects/${PROJECT_A}/drawings`).send({ sheet_number: 'A-101', title: 'Plan' })
    expect(res.status).not.toBe(404)
  })

  it('refuses the same caller creating in another project, with zero INSERT', async () => {
    const res = await request(makeApp())
      .post(`/api/v1/projects/${PROJECT_B}/drawings`).send({ sheet_number: 'A-101', title: 'Plan' })
    expect(res.status, 'engineering.write must not reach an unrelated project').toBe(404)
    expect(mutated(), 'the refused create still inserted').toBe(false)
  })

  it('refuses a project in another tenant', async () => {
    const res = await request(makeApp())
      .post(`/api/v1/projects/${PROJECT_B}/punch-lists`).send({ title: 'Punch' })
    expect(res.status).toBe(404)
    expect(mutated()).toBe(false)
  })
})

// ─── §25 consequential transitions need BOTH authorities ─────────────────────
describe('§25 a consequential transition needs its approval authority AND scope', () => {
  const transitions: [string, string][] = [
    ['inspection complete', `/api/v1/inspections/${INSPECTION_A}/complete`],
    ['punch item verify',   `/api/v1/punch-items/${PUNCHITEM_A}/verify`],
    ['punch item close',    `/api/v1/punch-items/${PUNCHITEM_A}/close`],
  ]

  for (const [name, url] of transitions) {
    it(`refuses a holder of the approval capability who is out of scope — ${name}`, async () => {
      // project_manager holds quality.verify; USER_B is not in PROJECT_A.
      setCaller({ id: USER_B, tenantId: TENANT_A, role: 'project_manager' })
      const res = await request(makeApp()).post(url).send({})
      expect(res.status, `${name}: approval authority alone must not suffice`).toBe(404)
      expect(mutated(), `${name}: the refused transition still wrote`).toBe(false)
    })

    it(`still refuses a scoped caller who lacks the approval capability — ${name}`, async () => {
      // USER_A IS in PROJECT_A but viewer holds no quality.verify. Membership
      // must not substitute for functional authority.
      setCaller({ id: USER_A, tenantId: TENANT_A, role: 'viewer' })
      const res = await request(makeApp()).post(url).send({})
      expect(res.status, `${name}: membership must not grant approval authority`).toBe(403)
      expect(mutated()).toBe(false)
    })
  }
})

// ─── §29 revocation is live ──────────────────────────────────────────────────
describe('§29 closing a membership takes effect on the next request', () => {
  it('admits, then refuses after revocation, with the SAME token', async () => {
    const app = makeApp()
    const before = await request(app).get(`/api/v1/drawings/${DRAWING_A}`)
    expect(before.status, 'the member must be admitted first').toBe(200)

    MEMBERS = MEMBERS.map(m =>
      m.projectId === PROJECT_A && m.userId === USER_A ? { ...m, active: false } : m)

    const after = await request(app).get(`/api/v1/drawings/${DRAWING_A}`)
    expect(after.status, 'no token refresh — scope is re-read every request').toBe(404)
  })

  it('refuses a WRITE the moment membership closes, and writes nothing', async () => {
    const app = makeApp()
    expect((await request(app).patch(`/api/v1/drawings/${DRAWING_A}`).send({ title: 'x' })).status).not.toBe(404)

    MEMBERS = MEMBERS.map(m =>
      m.projectId === PROJECT_A && m.userId === USER_A ? { ...m, active: false } : m)
    mockQuery.mockClear()

    const after = await request(app).patch(`/api/v1/drawings/${DRAWING_A}`).send({ title: 'x' })
    expect(after.status).toBe(404)
    expect(mutated(), 'a revoked member still wrote').toBe(false)
  })
})

// ─── §30 the two authorities discriminate independently ──────────────────────
describe('§30 functional authority and record authority are independent', () => {
  it('capability without membership is refused', async () => {
    setCaller({ id: USER_B, tenantId: TENANT_A, role: 'engineer' })   // holds engineering.write
    expect((await request(makeApp()).patch(`/api/v1/drawings/${DRAWING_A}`).send({ title: 'x' })).status).toBe(404)
  })

  it('membership without capability is refused, and with 403 not 404', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'viewer' })     // in PROJECT_A, no write
    const res = await request(makeApp()).patch(`/api/v1/drawings/${DRAWING_A}`).send({ title: 'x' })
    expect(res.status, 'the functional dimension refuses first, and says so').toBe(403)
  })

  it('both together are admitted', async () => {
    expect((await request(makeApp()).patch(`/api/v1/drawings/${DRAWING_A}`).send({ title: 'x' })).status).not.toBe(404)
  })
})

// ─── §11 cross-tenant ────────────────────────────────────────────────────────
describe('§11 a record in another tenant is unreachable, owner included', () => {
  it('refuses an owner reaching outside their own tenant', async () => {
    setCaller({ id: USER_B, tenantId: TENANT_B, role: 'owner' })
    const res = await request(makeApp()).get(`/api/v1/drawings/${DRAWING_A}`)
    expect(res.status, 'owner is tenant-wide, never global').toBe(404)
  })
})
