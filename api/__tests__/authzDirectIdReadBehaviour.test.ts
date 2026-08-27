/**
 * ADR-014 Phase 3E — direct-ID reads, exercised through the real routers.
 *
 * Phase 3C proved the direct-ID MECHANISM on three routers; Phase 3D closed the
 * mutation surface. This file proves the condition Phase 3E exists to remove,
 * across the read surface and across domains:
 *
 *     correct functional READ capability
 *   + knowledge of a record id
 *   + no live membership of that record's project
 *   = the record was still returned
 *
 * Fixture (§48), modelled rather than mocked per call. The parent lookup, the
 * membership test and the tenant predicate are all answered by READING the
 * statement the product issued — its FROM, its JOIN, its foreign key and its
 * active-membership window. A fixture that returned the "right" project
 * regardless of the query could not tell a correct FK hop from a broken one,
 * and the mutation tests in the completion report would prove nothing.
 *
 *   Tenant A   USER_A (engineer)  → member of PROJECT_A
 *              USER_B (engineer)  → member of PROJECT_B
 *              FIELD_A (field_ops)→ member of PROJECT_A
 *              OWNER_A (owner)    → tenant-wide, no membership row
 *   Tenant B   OWNER_B (owner)    → PROJECT_C
 *
 * Derivation shapes covered: DIRECT_COLUMN (daily log, risk, test pack),
 * FK_PATH (knowledge chunk → source → project), PROJECT_ROOT (readiness by
 * project id), and PARENT-of-sub-collection (NCR → CAPAs). The change order is
 * present too, but only in the §24 pair — see the note on READS below.
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
vi.mock('../services/askBuilder', () => ({ askJarvis: vi.fn() }))

import type { UserRole } from '../authz/capabilities'

const TENANT_A = 'aaaaaaaa-0000-4000-8000-000000000001'
const TENANT_B = 'bbbbbbbb-0000-4000-8000-000000000002'

const USER_A   = '10000000-0000-4000-8000-00000000000a'
const USER_B   = '10000000-0000-4000-8000-00000000000b'
const FIELD_A  = '10000000-0000-4000-8000-00000000000f'
const OWNER_A  = '10000000-0000-4000-8000-000000000001'
const OWNER_B  = '10000000-0000-4000-8000-000000000002'

const PROJECT_A = '30000000-0000-4000-8000-00000000000a'
const PROJECT_B = '30000000-0000-4000-8000-00000000000b'
const PROJECT_C = '30000000-0000-4000-8000-00000000000c'

const LOG_A    = '41000000-0000-4000-8000-00000000000a'
const LOG_B    = '41000000-0000-4000-8000-00000000000b'
const LOG_C    = '41000000-0000-4000-8000-00000000000c'
const RISK_A   = '42000000-0000-4000-8000-00000000000a'
const CO_A     = '43000000-0000-4000-8000-00000000000a'
const PACK_A   = '44000000-0000-4000-8000-00000000000a'
const NCR_A    = '45000000-0000-4000-8000-00000000000a'
const SOURCE_A = '46000000-0000-4000-8000-00000000000a'
const CHUNK_A  = '47000000-0000-4000-8000-00000000000a'
const CHUNK_B  = '47000000-0000-4000-8000-00000000000b'
const SOURCE_B = '46000000-0000-4000-8000-00000000000b'
const ABSENT   = '9fffffff-0000-4000-8000-0000000000ff'

/**
 * The tables, as rows. `tenant_id` is carried on every child row because the
 * parent resolver applies the tenant predicate to the CHILD, and a fixture that
 * omitted it could not detect that predicate being dropped.
 */
const TABLES: Record<string, Record<string, string>[]> = {
  projects: [
    { id: PROJECT_A, tenant_id: TENANT_A },
    { id: PROJECT_B, tenant_id: TENANT_A },
    { id: PROJECT_C, tenant_id: TENANT_B },
  ],
  daily_logs: [
    { id: LOG_A, project_id: PROJECT_A, tenant_id: TENANT_A },
    { id: LOG_B, project_id: PROJECT_B, tenant_id: TENANT_A },
    { id: LOG_C, project_id: PROJECT_C, tenant_id: TENANT_B },
  ],
  risks:       [{ id: RISK_A, project_id: PROJECT_A, tenant_id: TENANT_A }],
  change_orders: [{ id: CO_A, project_id: PROJECT_A, tenant_id: TENANT_A }],
  test_packs:  [{ id: PACK_A, project_id: PROJECT_A, tenant_id: TENANT_A }],
  ncrs:        [{ id: NCR_A, project_id: PROJECT_A, tenant_id: TENANT_A }],
  knowledge_sources: [
    { id: SOURCE_A, project_id: PROJECT_A, tenant_id: TENANT_A },
    { id: SOURCE_B, project_id: PROJECT_B, tenant_id: TENANT_A },
  ],
  knowledge_chunks: [
    { id: CHUNK_A, source_id: SOURCE_A, tenant_id: TENANT_A },
    { id: CHUNK_B, source_id: SOURCE_B, tenant_id: TENANT_A },
  ],
}

interface MemberRow { projectId: string; userId: string; active: boolean }
let MEMBERS: MemberRow[]

interface Caller { id: string; tenantId: string; role: UserRole; active?: boolean }
let caller: Caller
const setCaller = (c: Caller) => { caller = c; (globalThis as Record<string, unknown>)['__p3e'] = c }

vi.mock('../auth', () => ({
  requireAuth: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    const c = (globalThis as Record<string, unknown>)['__p3e'] as Caller
    req['auth'] = { sub: c.id, tid: c.tenantId, role: c.role, jti: 'jti' }
    next()
  },
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}))
vi.mock('../middleware/tenant', () => ({
  requireTenant: () => (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req['tenantId'] = ((globalThis as Record<string, unknown>)['__p3e'] as Caller).tenantId
    next()
  },
}))

import { dailyLogsRouter }     from '../routes/dailyLogs'
import { riskRegisterRouter }  from '../routes/riskRegister'
import { changeOrdersRouter }  from '../routes/changeOrders'
import { testPacksRouter }     from '../routes/testPacks'
import { ncrRouter }           from '../routes/ncr'
import { readinessRouter }     from '../routes/readiness'
import askRouter               from '../routes/ask'

function makeApp() {
  const app = express()
  app.use(express.json())
  for (const r of [dailyLogsRouter, riskRegisterRouter, changeOrdersRouter,
                   testPacksRouter, ncrRouter]) app.use('/api/v1', r as never)
  app.use('/api/v1/readiness', readinessRouter as never)
  app.use('/api/v1/ask', askRouter as never)
  return app
}
const app = makeApp()

const SQL = /\b(SELECT|INSERT|UPDATE|DELETE)\b/i
const sqlOf = (args: unknown[]): string =>
  args.find((a): a is string => typeof a === 'string' && SQL.test(a)) ?? ''

/** Statements the HANDLER issued — the authorization lookups excluded. */
function payloadQueries(): string[] {
  return mockQuery.mock.calls.map(c => sqlOf(c)).filter(s =>
    s && !/FROM\s+users\s+WHERE\s+id/i.test(s)
       && !/AS\s+project_id/i.test(s)
       && !/FROM\s+projects\s+p?\b/i.test(s))
}
const wrote = () => payloadQueries().some(s => /\b(UPDATE|INSERT|DELETE)\b/i.test(s))

beforeEach(() => {
  MEMBERS = [
    { projectId: PROJECT_A, userId: USER_A,  active: true },
    { projectId: PROJECT_A, userId: FIELD_A, active: true },
    { projectId: PROJECT_B, userId: USER_B,  active: true },
  ]
  setCaller({ id: USER_A, tenantId: TENANT_A, role: 'engineer' })

  mockQuery.mockReset()
  mockQuery.mockImplementation(async (...args: unknown[]) => {
    const sql = sqlOf(args)
    const params = (args.find(a => Array.isArray(a)) as unknown[] | undefined) ?? []
    const empty = { rows: [], rowCount: 0 }

    // live principal — `is_active` is answered, not assumed
    if (/FROM\s+users\s+WHERE\s+id/i.test(sql)) {
      return { rows: [{ id: caller.id, tenant_id: caller.tenantId, role: caller.role,
                        is_active: caller.active !== false }], rowCount: 1 }
    }

    // `resolveParentProjectId`, answered by following the statement's own
    // FROM/JOIN and honouring its tenant predicate.
    if (/AS\s+project_id/i.test(sql)) {
      const id   = params[0] as string
      const from = /FROM\s+(\w+)\s+r/i.exec(sql)?.[1]
      if (!from || !TABLES[from]) return empty
      const honoursTenant = /r\.\w+ = current_setting\('app\.current_tenant_id', true\)::uuid/i.test(sql)
      const child = TABLES[from].find(x => x['id'] === id)
      if (!child) return empty
      if (honoursTenant && child['tenant_id'] !== caller.tenantId) return empty

      const join = /JOIN\s+(\w+)\s+p\s+ON\s+p\.(\w+)\s*=\s*r\.(\w+)/i.exec(sql)
      if (join) {
        const [, parentTable, parentIdCol, viaCol] = join
        const parent = TABLES[parentTable!]?.find(x => x[parentIdCol!] === child[viaCol!])
        return parent?.['project_id']
          ? { rows: [{ project_id: parent['project_id'] }], rowCount: 1 } : empty
      }
      const col = /SELECT\s+r\.(\w+)\s+AS\s+project_id/i.exec(sql)?.[1] ?? 'project_id'
      return child[col] ? { rows: [{ project_id: child[col] }], rowCount: 1 } : empty
    }

    // `filterAccessibleProjectIds`. The active window and the tenant predicate
    // are read OFF the statement, so removing either shows up here as a grant
    // the database would really have made.
    if (/FROM\s+projects\s+p?\b/i.test(sql) && /ANY\(\$\d+::uuid\[\]\)/i.test(sql)) {
      const ids = (params.find(x => Array.isArray(x)) as string[] | undefined) ?? []
      const tenantWide = !/project_members/i.test(sql)
      const honoursWindow =
        /active_from\s*<=\s*NOW\(\)/i.test(sql) &&
        /active_to\s+IS\s+NULL\s+OR\s+m\.active_to\s*>\s*NOW\(\)/i.test(sql)
      const honoursTenant =
        /tenant_id = current_setting\('app\.current_tenant_id', true\)::uuid/i.test(sql)

      const reachable = ids.filter(id => {
        const project = TABLES['projects']!.find(x => x['id'] === id)
        if (!project) return false
        if (honoursTenant && project['tenant_id'] !== caller.tenantId) return false
        if (tenantWide) return true
        return MEMBERS.some(m =>
          m.projectId === id && m.userId === caller.id && (honoursWindow ? m.active : true))
      })
      return { rows: reachable.map(id => ({ id })), rowCount: reachable.length }
    }

    // Any handler payload query. Timestamps are present because several
    // services map them eagerly; their absence would surface as a 500 and be
    // mistaken for an authorization outcome.
    return {
      rows: [{
        id: 'row-1', tenant_id: caller.tenantId, project_id: PROJECT_A,
        created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
      }],
      rowCount: 1,
    }
  })
})

/** The representative read per derivation shape, with the role that may use it. */
/**
 * The representative read per derivation shape, with the role that may use it.
 *
 * `/change-orders/:id` is deliberately NOT here. Its capability is `cost.view`,
 * which only the owner holds, and the owner is tenant-wide by policy — so there
 * is no "holds the capability but is not a member" caller to construct, and the
 * record-scope addition is holder-neutral for that route. It is covered instead
 * by the §24 discriminating pair below, which is where it says something.
 */
const READS: { name: string; url: string; role: UserRole; shape: string }[] = [
  { name: 'daily log detail',   url: `/api/v1/daily-logs/${LOG_A}`,   role: 'engineer',        shape: 'DIRECT_COLUMN' },
  { name: 'risk detail',        url: `/api/v1/risks/${RISK_A}`,       role: 'engineer',        shape: 'DIRECT_COLUMN' },
  { name: 'test pack (:packId)',url: `/api/v1/test-packs/${PACK_A}`,  role: 'project_manager', shape: 'DIRECT_COLUMN' },
  { name: 'NCR corrective actions', url: `/api/v1/ncrs/${NCR_A}/capas`, role: 'engineer',      shape: 'PARENT_OF_SUBCOLLECTION' },
  { name: 'knowledge chunk',    url: `/api/v1/ask/chunks/${CHUNK_A}`, role: 'engineer',        shape: 'FK_PATH' },
  { name: 'project readiness',  url: `/api/v1/readiness/project/${PROJECT_A}`, role: 'project_manager', shape: 'PROJECT_ROOT' },
]

// ─── §18–§21 the record's project decides the read ───────────────────────────
describe('§18 a direct-ID read requires scope to the record’s project', () => {
  for (const r of READS) {
    it(`admits a member of the record's project — ${r.name} (${r.shape})`, async () => {
      setCaller({ id: USER_A, tenantId: TENANT_A, role: r.role })
      MEMBERS.push({ projectId: PROJECT_A, userId: USER_A, active: true })
      const res = await request(app).get(r.url)
      expect(res.status, `${r.name} refused a member`).toBe(200)
    })

    it(`refuses a same-tenant NON-member with 404 — ${r.name} (${r.shape})`, async () => {
      // USER_B holds the same capability and is a member of PROJECT_B only.
      setCaller({ id: USER_B, tenantId: TENANT_A, role: r.role })
      const res = await request(app).get(r.url)
      expect(res.status, `${r.name} leaked across projects`).toBe(404)
      expect(JSON.stringify(res.body)).not.toMatch(new RegExp(PROJECT_A))
    })
  }
})

// ─── §21 the same principal, two projects, one tenant ────────────────────────
describe('§21 same-tenant cross-project isolation', () => {
  it('admits the caller’s own project and refuses the neighbouring one', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'engineer' })
    expect((await request(app).get(`/api/v1/daily-logs/${LOG_A}`)).status).toBe(200)
    expect((await request(app).get(`/api/v1/daily-logs/${LOG_B}`)).status).toBe(404)
  })

  it('follows the FK hop to the right project, not merely to some project', async () => {
    // CHUNK_B hangs off SOURCE_B, which belongs to PROJECT_B. A resolver that
    // returned any parent — or resolved the chunk by its own id — would admit.
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'engineer' })
    expect((await request(app).get(`/api/v1/ask/chunks/${CHUNK_A}`)).status).toBe(200)
    expect((await request(app).get(`/api/v1/ask/chunks/${CHUNK_B}`)).status).toBe(404)
  })
})

// ─── §11/§20 tenant, and the owner inside it ─────────────────────────────────
describe('§20 the owner is tenant-wide, never global', () => {
  it('admits an owner with no membership row, inside their own tenant', async () => {
    setCaller({ id: OWNER_A, tenantId: TENANT_A, role: 'owner' })
    expect(MEMBERS.some(m => m.userId === OWNER_A)).toBe(false)
    expect((await request(app).get(`/api/v1/daily-logs/${LOG_A}`)).status).toBe(200)
  })

  it('refuses an owner reaching a record in another tenant', async () => {
    setCaller({ id: OWNER_B, tenantId: TENANT_B, role: 'owner' })
    const res = await request(app).get(`/api/v1/daily-logs/${LOG_A}`)
    expect(res.status).toBe(404)
  })

  it('refuses a tenant-A member reaching a tenant-B record', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'engineer' })
    expect((await request(app).get(`/api/v1/daily-logs/${LOG_C}`)).status).toBe(404)
  })
})

// ─── §22 live membership ─────────────────────────────────────────────────────
describe('§22 closing a membership takes effect on the next request', () => {
  it('admits, then refuses after revocation, with the SAME token', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'engineer' })
    expect((await request(app).get(`/api/v1/risks/${RISK_A}`)).status).toBe(200)

    MEMBERS = MEMBERS.map(m =>
      m.projectId === PROJECT_A && m.userId === USER_A ? { ...m, active: false } : m)

    expect((await request(app).get(`/api/v1/risks/${RISK_A}`)).status).toBe(404)
  })

  it('admits again the moment the membership is reopened', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'engineer' })
    MEMBERS = MEMBERS.map(m =>
      m.projectId === PROJECT_A && m.userId === USER_A ? { ...m, active: false } : m)
    expect((await request(app).get(`/api/v1/risks/${RISK_A}`)).status).toBe(404)

    MEMBERS = MEMBERS.map(m =>
      m.projectId === PROJECT_A && m.userId === USER_A ? { ...m, active: true } : m)
    expect((await request(app).get(`/api/v1/risks/${RISK_A}`)).status).toBe(200)
  })

  it('refuses a principal whose account has been deactivated, same token', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'engineer', active: false })
    expect((await request(app).get(`/api/v1/risks/${RISK_A}`)).status).toBe(401)
  })
})

// ─── §23/§24 the two authorities are independent ─────────────────────────────
describe('§23 functional capability and record scope are independent', () => {
  it('refuses capability WITHOUT membership — 404, the record dimension', async () => {
    setCaller({ id: USER_B, tenantId: TENANT_A, role: 'engineer' })   // holds risk.view
    expect((await request(app).get(`/api/v1/risks/${RISK_A}`)).status).toBe(404)
  })

  it('refuses membership WITHOUT capability — 403, the functional dimension', async () => {
    // field_ops is an active member of PROJECT_A but holds neither risk.view
    // nor commissioning.view. Membership must not confer either.
    setCaller({ id: FIELD_A, tenantId: TENANT_A, role: 'field_ops' })
    expect((await request(app).get(`/api/v1/risks/${RISK_A}`)).status).toBe(403)
    expect((await request(app).get(`/api/v1/test-packs/${PACK_A}`)).status).toBe(403)
  })

  it('admits only when both hold', async () => {
    setCaller({ id: FIELD_A, tenantId: TENANT_A, role: 'field_ops' }) // holds construction.view
    expect((await request(app).get(`/api/v1/daily-logs/${LOG_A}`)).status).toBe(200)
  })
})

// ─── §24 project membership confers no commercial authority ──────────────────
describe('§24 membership does not widen a domain capability', () => {
  it('keeps the change order closed to an engineer who is a member of its project', async () => {
    // cost.view is owner-only. The engineer is an ACTIVE member of PROJECT_A and
    // can read that project's daily log, so this is a discriminating pair rather
    // than a caller who simply cannot see anything.
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'engineer' })
    expect((await request(app).get(`/api/v1/daily-logs/${LOG_A}`)).status).toBe(200)
    expect((await request(app).get(`/api/v1/change-orders/${CO_A}`)).status).toBe(403)
  })

  it('opens it to the owner, whose authority is functional and not membership', async () => {
    setCaller({ id: OWNER_A, tenantId: TENANT_A, role: 'owner' })
    expect((await request(app).get(`/api/v1/change-orders/${CO_A}`)).status).toBe(200)
  })
})

// ─── §41 the payload query does not run for a refused caller ─────────────────
describe('§41 scope is decided before the payload is loaded', () => {
  for (const r of READS) {
    it(`issues no payload query for an out-of-scope caller — ${r.name}`, async () => {
      setCaller({ id: USER_B, tenantId: TENANT_A, role: r.role })
      const res = await request(app).get(r.url)
      expect(res.status).toBe(404)
      expect(payloadQueries(), `${r.name} loaded its payload before refusing`).toEqual([])
    })
  }

  it('writes nothing on a refused read, so a cached score cannot be a side effect', async () => {
    // GET /readiness/project/:id upserts readiness_scores when it runs. The
    // guard is middleware, so a refusal happens before that write is reachable.
    setCaller({ id: USER_B, tenantId: TENANT_A, role: 'project_manager' })
    await request(app).get(`/api/v1/readiness/project/${PROJECT_A}`)
    expect(wrote()).toBe(false)
  })
})

// ─── §40 refusal discloses nothing ───────────────────────────────────────────
describe('§40 a refused record is indistinguishable from a missing one', () => {
  it('answers an out-of-scope record exactly as it answers an unknown id', async () => {
    setCaller({ id: USER_B, tenantId: TENANT_A, role: 'engineer' })
    const outOfScope = await request(app).get(`/api/v1/daily-logs/${LOG_A}`)
    const nonExistent = await request(app).get(`/api/v1/daily-logs/${ABSENT}`)
    expect(outOfScope.status).toBe(nonExistent.status)
    expect(outOfScope.body).toEqual(nonExistent.body)
  })

  it('says nothing about the project, the tenant or the record type', async () => {
    setCaller({ id: USER_B, tenantId: TENANT_A, role: 'engineer' })
    const body = JSON.stringify((await request(app).get(`/api/v1/risks/${RISK_A}`)).body)
    for (const leak of [PROJECT_A, TENANT_A, RISK_A]) expect(body).not.toMatch(new RegExp(leak))
  })
})

// ─── §45 malformed and hostile ids fail closed ───────────────────────────────
describe('§45 a malformed record id is refused without reaching SQL', () => {
  for (const bad of ['not-a-uuid', "' OR 1=1 --", '../../etc/passwd', '00000000']) {
    it(`refuses ${JSON.stringify(bad)} without issuing a parent lookup`, async () => {
      setCaller({ id: USER_A, tenantId: TENANT_A, role: 'engineer' })
      const res = await request(app).get(`/api/v1/daily-logs/${encodeURIComponent(bad)}`)
      expect(res.status).toBe(404)
      const issued = mockQuery.mock.calls.map(c => sqlOf(c))
      expect(issued.some(s => /AS\s+project_id/i.test(s)),
        'a malformed id must not reach a uuid column').toBe(false)
      expect(issued.every(s => !s.includes(bad)),
        'no id is ever interpolated into statement text').toBe(true)
    })
  }
})
