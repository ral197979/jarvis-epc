/**
 * ADR-014 Phase 3E-R — dual project/tenant scope, through the real routers.
 *
 * Phase 3E closed the direct-ID read surface by refusing every record whose
 * project parent was NULL. This file proves the reconciliation that followed:
 * a project-less row is now reachable where the RESOURCE says project-less
 * rows are legitimate, and still refused where it does not — without weakening
 * anything Phase 3D/3E established about rows that DO name a project.
 *
 * The four things that must hold together:
 *
 *   project row  + member          → admitted
 *   project row  + non-member      → 404   (unchanged from Phase 3E)
 *   global row   + capability      → admitted   (this is the fix)
 *   global row   + other tenant    → 404   (tenant-global is not global)
 *
 * Fixture (§42), modelled rather than mocked per call. The parent lookup, the
 * membership test and the tenant predicate are answered by READING the
 * statement the product issued. Critically, the fixture distinguishes "no row"
 * from "a row whose project_id is NULL" the same way the database would — that
 * distinction IS the slice, and a fixture that collapsed it could not tell the
 * fix from the bug.
 *
 *   Tenant A   USER_A (engineer)   → member of PROJECT_A
 *              USER_B (engineer)   → member of PROJECT_B
 *              OWNER_A (owner)     → tenant-wide, no membership row
 *   Tenant B   USER_C (engineer)   → member of PROJECT_C
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

const USER_A  = '10000000-0000-4000-8000-00000000000a'
const USER_B  = '10000000-0000-4000-8000-00000000000b'
const USER_C  = '10000000-0000-4000-8000-00000000000c'
const OWNER_A = '10000000-0000-4000-8000-000000000001'

const PROJECT_A = '30000000-0000-4000-8000-00000000000a'
const PROJECT_B = '30000000-0000-4000-8000-00000000000b'
const PROJECT_C = '30000000-0000-4000-8000-00000000000c'

// DUAL resource, DIRECT_COLUMN: a knowledge source may be project-tagged or not.
const SOURCE_PROJ   = '46000000-0000-4000-8000-00000000000a'   // → PROJECT_A
const SOURCE_GLOBAL = '46000000-0000-4000-8000-00000000000f'   // → NULL
const SOURCE_OTHER  = '46000000-0000-4000-8000-00000000000b'   // → PROJECT_B
const SOURCE_TEN_B  = '46000000-0000-4000-8000-0000000000bb'   // tenant B, NULL project

// DUAL resource, FK_PATH: a chunk inherits its source's position.
const CHUNK_PROJ    = '47000000-0000-4000-8000-00000000000a'   // → SOURCE_PROJ
const CHUNK_GLOBAL  = '47000000-0000-4000-8000-00000000000f'   // → SOURCE_GLOBAL

// PROJECT_REQUIRED resource: daily_logs.project_id is NOT NULL in migration 007.
const LOG_PROJ = '41000000-0000-4000-8000-00000000000a'
// A daily log whose parent is NULL cannot exist in the schema, but the fixture
// can still present one — that is how the PROJECT_REQUIRED denial gets proved.
const LOG_ORPHAN = '41000000-0000-4000-8000-0000000000ff'

const ABSENT = '9fffffff-0000-4000-8000-0000000000ff'

/**
 * The tables, as rows. `project_id: null` is a REAL value here — distinct from
 * the row being absent — because that is exactly the distinction under test.
 */
const TABLES: Record<string, Record<string, string | null>[]> = {
  projects: [
    { id: PROJECT_A, tenant_id: TENANT_A },
    { id: PROJECT_B, tenant_id: TENANT_A },
    { id: PROJECT_C, tenant_id: TENANT_B },
  ],
  knowledge_sources: [
    { id: SOURCE_PROJ,   project_id: PROJECT_A, tenant_id: TENANT_A },
    { id: SOURCE_GLOBAL, project_id: null,      tenant_id: TENANT_A },
    { id: SOURCE_OTHER,  project_id: PROJECT_B, tenant_id: TENANT_A },
    { id: SOURCE_TEN_B,  project_id: null,      tenant_id: TENANT_B },
  ],
  knowledge_chunks: [
    { id: CHUNK_PROJ,   source_id: SOURCE_PROJ,   tenant_id: TENANT_A },
    { id: CHUNK_GLOBAL, source_id: SOURCE_GLOBAL, tenant_id: TENANT_A },
  ],
  daily_logs: [
    { id: LOG_PROJ,   project_id: PROJECT_A, tenant_id: TENANT_A },
    { id: LOG_ORPHAN, project_id: null,      tenant_id: TENANT_A },
  ],
}

interface MemberRow { projectId: string; userId: string; active: boolean }
let MEMBERS: MemberRow[]

interface Caller { id: string; tenantId: string; role: UserRole; active?: boolean }
let caller: Caller
const setCaller = (c: Caller) => { caller = c; (globalThis as Record<string, unknown>)['__p3er'] = c }

vi.mock('../auth', () => ({
  requireAuth: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    const c = (globalThis as Record<string, unknown>)['__p3er'] as Caller
    req['auth'] = { sub: c.id, tid: c.tenantId, role: c.role, jti: 'jti' }
    next()
  },
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}))
vi.mock('../middleware/tenant', () => ({
  requireTenant: () => (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req['tenantId'] = ((globalThis as Record<string, unknown>)['__p3er'] as Caller).tenantId
    next()
  },
}))

import knowledgeRouter    from '../routes/knowledge'
import askRouter          from '../routes/ask'
import { dailyLogsRouter } from '../routes/dailyLogs'

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/knowledge', knowledgeRouter as never)
  app.use('/api/v1/ask', askRouter as never)
  app.use('/api/v1', dailyLogsRouter as never)
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
    { projectId: PROJECT_A, userId: USER_A, active: true },
    { projectId: PROJECT_B, userId: USER_B, active: true },
    { projectId: PROJECT_C, userId: USER_C, active: true },
  ]
  setCaller({ id: USER_A, tenantId: TENANT_A, role: 'engineer' })

  mockQuery.mockReset()
  mockQuery.mockImplementation(async (...args: unknown[]) => {
    const sql = sqlOf(args)
    const params = (args.find(a => Array.isArray(a)) as unknown[] | undefined) ?? []
    const empty = { rows: [], rowCount: 0 }

    if (/FROM\s+users\s+WHERE\s+id/i.test(sql)) {
      return { rows: [{ id: caller.id, tenant_id: caller.tenantId, role: caller.role,
                        is_active: caller.active !== false }], rowCount: 1 }
    }

    // `resolveRecordScope`. Answered by following the statement's own FROM/JOIN
    // and honouring its tenant predicate — and, load-bearing for this slice,
    // returning a ROW whose project_id is null rather than returning no row.
    if (/AS\s+project_id/i.test(sql)) {
      const id   = params[0] as string
      const from = /FROM\s+(\w+)\s+r/i.exec(sql)?.[1]
      if (!from || !TABLES[from]) return empty
      const honoursTenant = /r\.\w+ = current_setting\('app\.current_tenant_id', true\)::uuid/i.test(sql)
      const child = TABLES[from].find(x => x['id'] === id)
      if (!child) return empty                                   // genuinely absent
      if (honoursTenant && child['tenant_id'] !== caller.tenantId) return empty

      const join = /JOIN\s+(\w+)\s+p\s+ON\s+p\.(\w+)\s*=\s*r\.(\w+)/i.exec(sql)
      if (join) {
        const [, parentTable, parentIdCol, viaCol] = join
        const parent = TABLES[parentTable!]?.find(x => x[parentIdCol!] === child[viaCol!])
        if (!parent) return empty                                // INNER JOIN drops it
        return { rows: [{ project_id: parent['project_id'] ?? null }], rowCount: 1 }
      }
      const col = /SELECT\s+r\.(\w+)\s+AS\s+project_id/i.exec(sql)?.[1] ?? 'project_id'
      // The row EXISTS; its project may be null. One row either way.
      return { rows: [{ project_id: child[col] ?? null }], rowCount: 1 }
    }

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

    return {
      rows: [{ id: 'row-1', tenant_id: caller.tenantId, project_id: PROJECT_A,
               created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z' }],
      rowCount: 1,
    }
  })
})

const SOURCE = (id: string) => `/api/v1/knowledge/sources/${id}`
const CHUNK  = (id: string) => `/api/v1/ask/chunks/${id}`
const LOG    = (id: string) => `/api/v1/daily-logs/${id}`

// ─── §12 the two branches of a dual resource ─────────────────────────────────
describe('§12 a DUAL resource resolves both branches from the row', () => {
  it('admits a project-tagged record to a member of that project', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'engineer' })
    expect((await request(app).get(SOURCE(SOURCE_PROJ))).status).toBe(200)
  })

  it('still refuses a project-tagged record to a same-tenant non-member', async () => {
    // The Phase-3E protection this slice must not weaken.
    setCaller({ id: USER_B, tenantId: TENANT_A, role: 'engineer' })
    expect((await request(app).get(SOURCE(SOURCE_PROJ))).status).toBe(404)
  })

  it('admits a project-LESS record to a capability holder who is a member of nothing relevant', async () => {
    // This is the fix. Before Phase 3E-R this answered 404 for everyone.
    setCaller({ id: USER_B, tenantId: TENANT_A, role: 'engineer' })
    expect((await request(app).get(SOURCE(SOURCE_GLOBAL))).status).toBe(200)
  })

  it('admits the same project-less record to the Owner, who had also been refused', async () => {
    setCaller({ id: OWNER_A, tenantId: TENANT_A, role: 'owner' })
    expect(MEMBERS.some(m => m.userId === OWNER_A)).toBe(false)
    expect((await request(app).get(SOURCE(SOURCE_GLOBAL))).status).toBe(200)
  })

  it('keeps the two branches genuinely distinct for one caller (§25)', async () => {
    setCaller({ id: USER_B, tenantId: TENANT_A, role: 'engineer' })   // member of PROJECT_B only
    expect((await request(app).get(SOURCE(SOURCE_OTHER))).status).toBe(200)   // own project
    expect((await request(app).get(SOURCE(SOURCE_PROJ))).status).toBe(404)    // foreign project
    expect((await request(app).get(SOURCE(SOURCE_GLOBAL))).status).toBe(200)  // tenant-global
  })

  it('still answers 404 for a record that is simply not there', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'engineer' })
    expect((await request(app).get(SOURCE(ABSENT))).status).toBe(404)
  })
})

// ─── §11 PROJECT_REQUIRED keeps denying NULL ─────────────────────────────────
describe('§11 a PROJECT_REQUIRED resource still refuses an unparented row', () => {
  it('admits the project-bound daily log to its member', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'engineer' })
    expect((await request(app).get(LOG(LOG_PROJ))).status).toBe(200)
  })

  it('refuses an unparented daily log even to the Owner', async () => {
    // daily_logs.project_id is NOT NULL, so this row should not exist at all.
    // If one ever does, it must not fall through to the tenant-global branch.
    setCaller({ id: OWNER_A, tenantId: TENANT_A, role: 'owner' })
    expect((await request(app).get(LOG(LOG_ORPHAN))).status).toBe(404)
  })

  it('refuses it to an ordinary capability holder too', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'engineer' })
    expect((await request(app).get(LOG(LOG_ORPHAN))).status).toBe(404)
  })
})

// ─── §24 tenant-global is tenant-BOUND ───────────────────────────────────────
describe('§24 tenant-global never means application-global', () => {
  it('refuses another tenant’s project-less record', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'engineer' })
    expect((await request(app).get(SOURCE(SOURCE_TEN_B))).status).toBe(404)
  })

  it('refuses it to that other tenant’s Owner as well, in the other direction', async () => {
    setCaller({ id: OWNER_A, tenantId: TENANT_A, role: 'owner' })
    expect((await request(app).get(SOURCE(SOURCE_TEN_B))).status).toBe(404)
  })

  it('admits tenant B’s own principal to tenant B’s global record', async () => {
    // Non-vacuity: the refusals above are about the tenant, not about the row
    // being unreachable by everyone.
    setCaller({ id: USER_C, tenantId: TENANT_B, role: 'engineer' })
    expect((await request(app).get(SOURCE(SOURCE_TEN_B))).status).toBe(200)
  })
})

// ─── §37 an FK child inherits its parent's position ──────────────────────────
describe('§37 a FK_PATH child inherits the parent’s project or global position', () => {
  it('admits a chunk of a project source to that project’s member', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'engineer' })
    expect((await request(app).get(CHUNK(CHUNK_PROJ))).status).toBe(200)
  })

  it('refuses a chunk of a project source to a non-member', async () => {
    setCaller({ id: USER_B, tenantId: TENANT_A, role: 'engineer' })
    expect((await request(app).get(CHUNK(CHUNK_PROJ))).status).toBe(404)
  })

  it('admits a chunk of a project-LESS source, following the hop to NULL', async () => {
    // The FK resolves to a real parent row whose project_id is null — not to
    // "no parent". A resolver that collapsed the two would refuse this.
    setCaller({ id: USER_B, tenantId: TENANT_A, role: 'engineer' })
    expect((await request(app).get(CHUNK(CHUNK_GLOBAL))).status).toBe(200)
  })
})

// ─── §26 membership revocation, on both branches ─────────────────────────────
describe('§26 revoking membership closes the project branch and leaves global open', () => {
  it('closes the project-tagged record on the next request, same token', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'engineer' })
    expect((await request(app).get(SOURCE(SOURCE_PROJ))).status).toBe(200)

    MEMBERS = MEMBERS.map(m =>
      m.projectId === PROJECT_A && m.userId === USER_A ? { ...m, active: false } : m)

    expect((await request(app).get(SOURCE(SOURCE_PROJ))).status).toBe(404)
  })

  it('leaves the tenant-global record readable after the same revocation', async () => {
    // Load-bearing: the global branch does not depend on membership, because
    // the record has no project to be a member of.
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'engineer' })
    MEMBERS = MEMBERS.map(m =>
      m.projectId === PROJECT_A && m.userId === USER_A ? { ...m, active: false } : m)

    expect((await request(app).get(SOURCE(SOURCE_PROJ))).status).toBe(404)
    expect((await request(app).get(SOURCE(SOURCE_GLOBAL))).status).toBe(200)
  })
})

// ─── §27 live capability, on the global branch too ───────────────────────────
describe('§27 a tenant-global record does not bypass live capability resolution', () => {
  it('refuses a role that lacks the route capability, with 403 not 404', async () => {
    // assistant.use is held by owner, project_manager, engineer and procurement
    // — field_ops is the discriminating non-holder.
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'field_ops' })
    expect((await request(app).get(SOURCE(SOURCE_GLOBAL))).status).toBe(403)
  })

  it('takes effect on the next request when the DB role changes, same token', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'engineer' })
    expect((await request(app).get(SOURCE(SOURCE_GLOBAL))).status).toBe(200)

    // Same JWT claims; the stored role is what the guard re-resolves.
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'field_ops' })
    expect((await request(app).get(SOURCE(SOURCE_GLOBAL))).status).toBe(403)
  })

  it('refuses a deactivated principal on the global branch with 401', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'engineer', active: false })
    expect((await request(app).get(SOURCE(SOURCE_GLOBAL))).status).toBe(401)
  })
})

// ─── §28/§38 classification precedes payload, on every branch ────────────────
describe('§28 the position is decided before any payload or side effect', () => {
  const refusals: [string, string, UserRole, string][] = [
    ['foreign project',        SOURCE(SOURCE_PROJ),   'engineer', USER_B],
    ['other tenant’s global',  SOURCE(SOURCE_TEN_B),  'engineer', USER_A],
    ['unparented, required',   LOG(LOG_ORPHAN),       'engineer', USER_A],
    ['absent',                 SOURCE(ABSENT),        'engineer', USER_A],
  ]
  for (const [name, url, role, who] of refusals) {
    it(`loads no payload for a refused read — ${name}`, async () => {
      setCaller({ id: who, tenantId: TENANT_A, role })
      const res = await request(app).get(url)
      expect(res.status).toBe(404)
      expect(payloadQueries(), `${name} loaded its payload before refusing`).toEqual([])
      expect(wrote()).toBe(false)
    })
  }

  it('refuses a foreign-tenant record without ever classifying it as global', async () => {
    // The dangerous ordering would be: find the row, see project_id IS NULL,
    // admit it as tenant-global, and only then notice the tenant. The tenant
    // predicate is on the resolver's own statement, so that cannot happen.
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'engineer' })
    const res = await request(app).get(SOURCE(SOURCE_TEN_B))
    expect(res.status).toBe(404)
    expect(payloadQueries()).toEqual([])
  })
})

// ─── §40 refusal still discloses nothing ─────────────────────────────────────
describe('§40 the added branch introduces no new disclosure', () => {
  it('answers a foreign-project record exactly as it answers an absent one', async () => {
    setCaller({ id: USER_B, tenantId: TENANT_A, role: 'engineer' })
    const foreign = await request(app).get(SOURCE(SOURCE_PROJ))
    const absent  = await request(app).get(SOURCE(ABSENT))
    expect(foreign.status).toBe(absent.status)
    expect(foreign.body).toEqual(absent.body)
  })

  it('answers a foreign-TENANT global record the same way too', async () => {
    // Otherwise the pair (404-with-body-X vs 404-with-body-Y) would reveal that
    // a given uuid exists in some other tenant.
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'engineer' })
    const foreignTenant = await request(app).get(SOURCE(SOURCE_TEN_B))
    const absent        = await request(app).get(SOURCE(ABSENT))
    expect(foreignTenant.status).toBe(absent.status)
    expect(foreignTenant.body).toEqual(absent.body)
  })
})
