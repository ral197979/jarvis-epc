/**
 * ADR-014 Phase 3J — nested parent guards, exercised through the real routers.
 *
 * The condition this slice removes:
 *
 *     correct functional capability
 *   + a child URL you already know
 *   = the child, whoever owns the parent
 *
 * §20 is the whole point: a child route must be secure against a DIRECT HTTP
 * call. "The UI could only reach it from the guarded detail page" is not an
 * authorization argument, and `/bim-models/:modelId/elements` was reachable
 * exactly that way — nine sub-routes on a PROJECT_REQUIRED parent, two guarded
 * siblings on either side of them in the same file.
 *
 * Fixture (§62), modelled rather than mocked per call: the membership window,
 * the tenant predicate and the parent projection are read OFF the statement the
 * product issued, and the child queries answer from real rows keyed by their
 * real foreign key — so removing `model_id = $3` changes what comes back, which
 * is what makes mutation C mean something.
 *
 *   Tenant A   USER_A (engineer) → member of PROJECT_A only
 *              OWNER_A (owner)   → tenant-wide by project.list.all
 *   Tenant B   USER_C (engineer) → PROJECT_C
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

const TENANT_A  = 'aaaaaaaa-0000-4000-8000-000000000001'
const TENANT_B  = 'bbbbbbbb-0000-4000-8000-000000000002'
const USER_A    = '10000000-0000-4000-8000-0000000000a1'
const OWNER_A   = '10000000-0000-4000-8000-0000000000a2'
const PROJECT_A = '30000000-0000-4000-8000-00000000000a'
const PROJECT_B = '30000000-0000-4000-8000-00000000000b'

/** bim_models: MODEL_A under PROJECT_A, MODEL_B under PROJECT_B. */
const MODEL_A = '40000000-0000-4000-8000-00000000000a'
const MODEL_B = '40000000-0000-4000-8000-00000000000b'
const MODELS: Record<string, { project: string; tenant: string }> = {
  [MODEL_A]: { project: PROJECT_A, tenant: TENANT_A },
  [MODEL_B]: { project: PROJECT_B, tenant: TENANT_A },
}

/** bim_elements, each bound to exactly one model — the §24 mismatch fixture. */
const ELEM_A = '50000000-0000-4000-8000-00000000000a'
const ELEM_B = '50000000-0000-4000-8000-00000000000b'
const ELEMENTS: Record<string, { model: string }> = {
  [ELEM_A]: { model: MODEL_A },
  [ELEM_B]: { model: MODEL_B },
}

interface MemberRow { projectId: string; userId: string; active: boolean }
let MEMBERS: MemberRow[]
interface Caller { id: string; tenantId: string; role: UserRole }
let caller: Caller
const setCaller = (c: Caller) => { caller = c; (globalThis as Record<string, unknown>)['__p3j'] = c }

vi.mock('../auth', () => ({
  requireAuth: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    const c = (globalThis as Record<string, unknown>)['__p3j'] as Caller
    req['auth'] = { sub: c.id, tid: c.tenantId, role: c.role, jti: 'jti' }
    next()
  },
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}))
vi.mock('../middleware/tenant', () => ({
  requireTenant: () => (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req['tenantId'] = ((globalThis as Record<string, unknown>)['__p3j'] as Caller).tenantId
    next()
  },
}))
// The parse/takeoff engines, stubbed so a 200 proves the GUARD admitted rather
// than that the engine happened to work.
vi.mock('../services/estimating/ifcParseQueue', () => ({
  enqueueIfcParseJob: vi.fn(async () => 'job-1'),
  getParseJobStatus:  vi.fn(async () => ({ status: 'done' })),
}))

import { requireAuth }   from '../auth'
import { requireTenant } from '../middleware/tenant'
import { estimatingRouter } from '../routes/estimating'
import { proposalsRouter }  from '../routes/proposals'

function makeApp() {
  const app = express()
  app.use(express.json())
  // Mounted as api/server.ts mounts them: both routers carry their own
  // requireAuth/requireTenant, at '/api/v1'.
  app.use('/api/v1', requireAuth as never, requireTenant() as never, estimatingRouter as never)
  app.use('/api/v1', requireAuth as never, requireTenant() as never, proposalsRouter as never)
  return app
}
const app = makeApp()

const SQLRE = /\b(SELECT|INSERT|UPDATE|DELETE)\b/i
const sqlOf = (a: unknown[]): string =>
  a.find((x): x is string => typeof x === 'string' && SQLRE.test(x)) ?? ''
const paramsOf = (a: unknown[]): unknown[] =>
  (a.find(x => Array.isArray(x)) as unknown[] | undefined) ?? []
const statements = () => mockQuery.mock.calls.map(c => sqlOf(c)).filter(Boolean)
/** Everything except principal resolution and the authorization lookups. */
const payloadQueries = () => statements().filter(s =>
  !/FROM\s+users\s+WHERE\s+id/i.test(s) &&
  !/FROM projects/i.test(s) &&
  !/AS\s+project_id/i.test(s))
const wrote = () => payloadQueries().some(s => /\b(INSERT|UPDATE|DELETE)\b/i.test(s))

beforeEach(() => {
  MEMBERS = [{ projectId: PROJECT_A, userId: USER_A, active: true }]
  setCaller({ id: USER_A, tenantId: TENANT_A, role: 'engineer' })

  mockQuery.mockReset()
  mockQuery.mockImplementation(async (...args: unknown[]) => {
    const sql = sqlOf(args)
    const params = paramsOf(args)
    const empty = { rows: [], rowCount: 0 }

    if (/FROM\s+users\s+WHERE\s+id/i.test(sql)) {
      return { rows: [{ id: caller.id, tenant_id: caller.tenantId, role: caller.role, is_active: true }], rowCount: 1 }
    }

    // resolveParentProjectId for bim_models — the parent projection.
    if (/FROM bim_models r/i.test(sql)) {
      const m = MODELS[params[0] as string]
      const honoursTenant = /r\.tenant_id = current_setting/i.test(sql)
      if (!m || (honoursTenant && m.tenant !== caller.tenantId)) return empty
      return { rows: [{ project_id: m.project }], rowCount: 1 }
    }

    // filterAccessibleProjectIds — honour whichever branch the product issued.
    if (/FROM projects/i.test(sql) && /ANY\(\$1::uuid\[\]\)/i.test(sql)) {
      const candidates = (params[0] as string[]) ?? []
      const needsMembership = /project_members/i.test(sql)
      const honoursTenant   = /tenant_id = current_setting/i.test(sql)
      const visible = candidates.filter(id => {
        if (honoursTenant && caller.tenantId !== TENANT_A) return false
        if (!needsMembership) return true
        return MEMBERS.some(m => m.projectId === id && m.userId === caller.id && m.active)
      })
      return { rows: visible.map(id => ({ id })), rowCount: visible.length }
    }

    // ── child payload, answered from the real foreign key ──────────────────
    // getElementById: SELECT * FROM bim_elements WHERE id=$1 AND tenant_id=$2 AND model_id=$3
    if (/FROM bim_elements WHERE id=\$1/i.test(sql)) {
      const el = ELEMENTS[params[0] as string]
      if (!el) return empty
      const boundToModel = /model_id=\$3/i.test(sql)
      if (boundToModel && el.model !== params[2]) return empty
      return { rows: [{ id: params[0], model_id: el.model, ifc_type: 'IfcWall' }], rowCount: 1 }
    }
    if (/FROM bim_element_links/i.test(sql)) return empty
    if (/INSERT INTO bim_element_links/i.test(sql)) {
      // The INSERT selects its element through the model; honour that clause.
      const el = ELEMENTS[params[1] as string]
      const bound = /e\.model_id\s*=\s*\$7/i.test(sql)
      if (!el || (bound && el.model !== params[6])) return { rows: [], rowCount: 0 }
      return { rows: [{ id: 'link-1' }], rowCount: 1 }
    }
    if (/FROM bim_elements/i.test(sql)) return { rows: [], rowCount: 0 }

    return empty
  })
})

// ─── §20 a known child URL is not a key ──────────────────────────────────────

describe('a nested child is secure against a direct call (§19, §20)', () => {
  it('admits a sub-route on a model whose project the caller is in', async () => {
    const res = await request(app).get(`/api/v1/bim-models/${MODEL_A}/elements`)
    expect(res.status).toBe(200)
  })

  it('refuses the same sub-route on a model in another project', async () => {
    const res = await request(app).get(`/api/v1/bim-models/${MODEL_B}/elements`)
    expect(res.status).toBe(404)
    // §43 — the refusal precedes the child read entirely.
    expect(payloadQueries()).toHaveLength(0)
  })

  it('refuses every sibling sub-route the same way, not just the listed one', async () => {
    for (const path of ['elements', 'quantity-summary', 'takeoff', 'parse-job']) {
      mockQuery.mockClear()
      const res = await request(app).get(`/api/v1/bim-models/${MODEL_B}/${path}`)
      expect(res.status, `GET ${path} must refuse`).toBe(404)
    }
  })

  it('starts no work on a refused mutation (§27, §43)', async () => {
    const res = await request(app).post(`/api/v1/bim-models/${MODEL_B}/takeoff`).send({})
    expect(res.status).toBe(404)
    expect(wrote()).toBe(false)
  })

  it('still admits the tenant-wide owner on both models', async () => {
    setCaller({ id: OWNER_A, tenantId: TENANT_A, role: 'owner' })
    for (const m of [MODEL_A, MODEL_B]) {
      expect((await request(app).get(`/api/v1/bim-models/${m}/elements`)).status).toBe(200)
    }
  })
})

// ─── §23 / §24 the confused deputy ───────────────────────────────────────────

describe('a child may not be reached through the wrong parent (§23, §24)', () => {
  it('returns an element that really belongs to the addressed model', async () => {
    const res = await request(app).get(`/api/v1/bim-models/${MODEL_A}/elements/${ELEM_A}`)
    expect(res.status).toBe(200)
  })

  it('refuses an element belonging to a DIFFERENT model, through an authorized one', async () => {
    // The critical case: MODEL_A is authorized, ELEM_B is not part of it.
    // Before Phase 3J the handler looked the element up by id and tenant alone,
    // so the authorized parent laundered access to another project's element.
    const res = await request(app).get(`/api/v1/bim-models/${MODEL_A}/elements/${ELEM_B}`)
    expect(res.status).toBe(404)
  })

  it('refuses to link an element that is not part of the addressed model', async () => {
    const res = await request(app)
      .post(`/api/v1/bim-models/${MODEL_A}/elements/${ELEM_B}/link`)
      .send({ entity_type: 'punch_item', entity_id: PROJECT_B })
    expect(res.status).toBe(404)
  })

  it('links one that is', async () => {
    const res = await request(app)
      .post(`/api/v1/bim-models/${MODEL_A}/elements/${ELEM_A}/link`)
      .send({ entity_type: 'punch_item', entity_id: PROJECT_A })
    expect(res.status).toBe(201)
  })
})

// ─── §44 / §45 / §46 live authority ──────────────────────────────────────────

describe('authority is read live on every call', () => {
  it('refuses once membership is revoked, with no new token (§44)', async () => {
    expect((await request(app).get(`/api/v1/bim-models/${MODEL_A}/elements`)).status).toBe(200)
    MEMBERS = MEMBERS.map(m => ({ ...m, active: false }))
    expect((await request(app).get(`/api/v1/bim-models/${MODEL_A}/elements`)).status).toBe(404)
  })

  it('refuses once the functional capability is gone, before any child read (§45)', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'viewer' })   // no engineering.view
    const res = await request(app).get(`/api/v1/bim-models/${MODEL_A}/elements`)
    expect(res.status).toBe(403)
    expect(payloadQueries()).toHaveLength(0)
  })

  it('refuses across tenants (§46)', async () => {
    setCaller({ id: OWNER_A, tenantId: TENANT_B, role: 'owner' })
    expect((await request(app).get(`/api/v1/bim-models/${MODEL_A}/elements`)).status).toBe(404)
  })
})

// ─── D27: the parent segment is not decoration ───────────────────────────────

describe('a tenant-global parent still constrains its children (D27)', () => {
  const PROP_A = '60000000-0000-4000-8000-00000000000a'
  const PROP_B = '60000000-0000-4000-8000-00000000000b'
  const ITEM_B = '70000000-0000-4000-8000-00000000000b'

  it('binds a proposal item update to the proposal in the path', async () => {
    setCaller({ id: OWNER_A, tenantId: TENANT_A, role: 'owner' })
    mockQuery.mockClear()
    await request(app).patch(`/api/v1/proposals/${PROP_A}/items/${ITEM_B}`).send({ description: 'x' })
    const upd = mockQuery.mock.calls.find(c => /UPDATE proposal_items/i.test(sqlOf(c)))
    expect(upd, 'the update was attempted').toBeTruthy()
    const sql = sqlOf(upd as unknown[])
    expect(sql, 'and it constrains on the parent proposal').toMatch(/proposal_id = \$7/)
    expect(paramsOf(upd as unknown[])[6], 'with the id from the path').toBe(PROP_A)
  })

  it('binds a proposal item delete the same way', async () => {
    setCaller({ id: OWNER_A, tenantId: TENANT_A, role: 'owner' })
    mockQuery.mockClear()
    await request(app).delete(`/api/v1/proposals/${PROP_B}/items/${ITEM_B}`)
    const del = mockQuery.mock.calls.find(c => /DELETE FROM proposal_items/i.test(sqlOf(c)))
    expect(del).toBeTruthy()
    expect(sqlOf(del as unknown[])).toMatch(/proposal_id=\$3/)
    expect(paramsOf(del as unknown[])[2]).toBe(PROP_B)
  })
})
