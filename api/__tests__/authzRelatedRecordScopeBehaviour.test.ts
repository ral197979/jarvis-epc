/**
 * ADR-014 Phase 3A §18–§25, §41 — `/related` source and target authorization.
 *
 * `/related/:source/:id` is a cross-module aggregator spanning nine resource
 * types across five domains. Two independent gates apply and each is proved
 * separately here:
 *
 *   SOURCE  the caller must be able to read the record being asked about,
 *           because its relationships are information about it.
 *   TARGET  every related record is authorized on its own terms — its domain's
 *           capability AND its own record scope. Reading an RFI confers nothing
 *           about the change order it produced.
 *
 * The discriminating pair is deliberate: an RFI is `construction.view`
 * (owner, project_manager, engineer, field_ops) while a change order is
 * `cost.view` (owner alone). So an engineer legitimately reads the source and
 * must still not see the target — the case a single route-level capability
 * could never express, and the reason Phase 2 deferred this endpoint.
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
const USER_A   = '10000000-0000-4000-8000-00000000000a'

const PROJ_IN   = '30000000-0000-4000-8000-000000000001'  // caller is attached
const PROJ_OUT  = '30000000-0000-4000-8000-000000000002'  // same tenant, not attached

const RFI_IN  = '40000000-0000-4000-8000-000000000001'
const RFI_OUT = '40000000-0000-4000-8000-000000000002'

interface Caller { id: string; tenantId: string; role: UserRole }
let caller: Caller
const setCaller = (c: Caller) => { caller = c; (globalThis as Record<string, unknown>)['__p3r'] = c }

vi.mock('../auth', () => ({
  requireAuth: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    const c = (globalThis as Record<string, unknown>)['__p3r'] as Caller
    req['auth'] = { sub: c.id, tid: c.tenantId, role: c.role, jti: 'jti' }
    next()
  },
  requireRole: () => (_r: unknown, _s: unknown, next: () => void) => next(),
}))
vi.mock('../middleware/tenant', () => {
  const mw = (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req['tenantId'] = ((globalThis as Record<string, unknown>)['__p3r'] as Caller).tenantId
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

import { relatedRouter } from '../routes/related'

const makeApp = () => {
  const app = express()
  app.use(express.json())
  app.use('/api/v1', relatedRouter as never)
  return app
}

const sqlOf = (args: unknown[]): string =>
  (args.find(a => typeof a === 'string' && /\b(SELECT|INSERT|UPDATE|DELETE)\b/i.test(a)) as string) ?? ''

/** Distinct project ids the scope layer was asked about, across the request. */
const scopeQueryCount = () => mockQuery.mock.calls.filter(c => /SELECT id FROM projects/i.test(sqlOf(c))).length

/**
 * Targets the RFI fans out to. The change order sits on the SAME project the
 * caller is attached to, so only its capability can exclude it — which keeps
 * the capability dimension and the scope dimension separable.
 */
let changeOrders: Array<Record<string, unknown>>
let linkedActions: Array<Record<string, unknown>>

beforeEach(() => {
  changeOrders  = [{ id: 'co1', co_number: 5, title: 'Added scope', status: 'submitted', project_id: PROJ_IN }]
  linkedActions = []
  mockQuery.mockReset()
  mockQuery.mockImplementation(async (...args: unknown[]) => {
    const sql = sqlOf(args)
    const params = (args[args.length - 1] ?? []) as unknown[]

    if (/FROM users/i.test(sql) && /is_active/i.test(sql)) {
      return { rows: [{ id: caller.id, tenant_id: caller.tenantId, role: caller.role, is_active: true }] }
    }
    // Source scope row.
    if (/FROM rfis\b/i.test(sql) && /project_id/i.test(sql) && /WHERE id = \$1/i.test(sql)) {
      const id = params[0]
      if (id === RFI_IN)  return { rows: [{ project_id: PROJ_IN,  assigned_to_user_id: null }] }
      if (id === RFI_OUT) return { rows: [{ project_id: PROJ_OUT, assigned_to_user_id: null }] }
      return { rows: [] }
    }
    // Record scope: the caller is attached to PROJ_IN only; the owner branch
    // (no membership predicate in the SQL) reaches both.
    //
    // As in the project suite, the fixture honours the SQL it is handed rather
    // than reimplementing the rule, so dropping the responsible-user predicate
    // from `recordScope.ts` widens what this returns and fails the isolation
    // assertions behaviourally.
    if (/SELECT id FROM projects/i.test(sql)) {
      const ids = (params[0] ?? []) as string[]
      const boundedByMembership = /project_manager = \$2/i.test(sql)
      const visible = boundedByMembership ? [PROJ_IN] : [PROJ_IN, PROJ_OUT]
      return { rows: ids.filter(i => visible.includes(i)).map(id => ({ id })) }
    }
    if (/FROM change_orders/i.test(sql)) return { rows: changeOrders }
    if (/FROM actions/i.test(sql))       return { rows: linkedActions }
    return { rows: [] }
  })
  setCaller({ id: USER_A, tenantId: TENANT_A, role: 'owner' })
})

const related = (source: string, id: string) =>
  request(makeApp()).get(`/api/v1/related/${source}/${id}`)

// ─── 1. Source authorization (§20) ────────────────────────────────────────────
describe('the caller must be able to read the source record', () => {
  it('admits a caller authorized to the source', async () => {
    const res = await related('rfi', RFI_IN)
    expect(res.status).toBe(200)
    expect(res.body.data.source).toBe('rfi')
  })

  it('refuses a source on a project the caller is not attached to', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'engineer' })
    const res = await related('rfi', RFI_OUT)
    expect(res.status, 'relationships of an unreadable record must not be enumerable').toBe(404)
    expect(res.body.data).toBeUndefined()
  })

  it('refuses a source whose domain capability the caller lacks', async () => {
    // procurement holds neither construction.view nor quality.view.
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'procurement' })
    expect((await related('rfi', RFI_IN)).status).toBe(404)
  })

  it('refuses a source that does not exist, identically', async () => {
    const missing = await related('rfi', '40000000-0000-4000-8000-0000000000ff')
    const forbidden = await (async () => {
      setCaller({ id: USER_A, tenantId: TENANT_A, role: 'engineer' })
      return related('rfi', RFI_OUT)
    })()
    expect(missing.status).toBe(404)
    expect(forbidden.status).toBe(404)
    expect(missing.body).toEqual(forbidden.body)
  })

  it('refuses an unknown source type safely', async () => {
    const res = await related('bogus', RFI_IN)
    expect(res.status).toBe(400)
    expect(res.body.data).toBeUndefined()
  })

  it('does not load related records at all when the source is refused', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'engineer' })
    await related('rfi', RFI_OUT)
    const loaded = mockQuery.mock.calls.map(sqlOf).filter(s => /FROM change_orders/i.test(s))
    expect(loaded, 'target loading must not happen for a refused source').toEqual([])
  })
})

// ─── 2. Target authorization is independent (§21) ─────────────────────────────
describe('access to the source confers nothing about the targets', () => {
  it('returns the change order to the owner, who holds cost.view', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'owner' })
    const res = await related('rfi', RFI_IN)
    expect(res.status).toBe(200)
    expect(res.body.data.groups).toHaveLength(1)
    expect(res.body.data.groups[0].items[0].sourceId).toBe('co1')
  })

  it('withholds it from an engineer, who reads the RFI but holds no cost.view', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'engineer' })
    const res = await related('rfi', RFI_IN)
    expect(res.status, 'the source is readable').toBe(200)
    expect(res.body.data.groups, 'the cost.view target must be gone').toEqual([])
  })

  it('withholds a target on a project the caller is not attached to', async () => {
    // Owner-level capability, but the change order hangs off a project outside
    // the caller's scope. Use a non-owner so scope actually binds.
    changeOrders = [{ id: 'co-out', co_number: 9, title: 'Elsewhere', status: 'submitted', project_id: PROJ_OUT }]
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'owner' })
    const asOwner = await related('rfi', RFI_IN)
    expect(asOwner.body.data.groups, 'owner is attached to every project in tenant').toHaveLength(1)

    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'project_manager' })
    const asPm = await related('rfi', RFI_IN)
    expect(asPm.status).toBe(200)
    expect(asPm.body.data.groups, 'out-of-scope target must be filtered').toEqual([])
  })

  it('withholds a target with no parent project rather than defaulting it open', async () => {
    changeOrders = [{ id: 'co-orphan', co_number: 1, title: 'Orphan', status: 'draft', project_id: null }]
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'project_manager' })
    const res = await related('rfi', RFI_IN)
    expect(res.body.data.groups, 'an unparented record inherits no scope').toEqual([])
  })
})

// ─── 3. Nothing leaks through metadata or group shape (§22, §23) ──────────────
describe('a filtered target leaves no trace in the response', () => {
  it('leaks no identifier, title, status or type of a withheld target', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'engineer' })
    const res = await related('rfi', RFI_IN)
    const body = JSON.stringify(res.body)
    for (const leak of ['co1', 'CO 5', 'Added scope', 'submitted', 'changeorder']) {
      expect(body, `must not disclose ${leak}`).not.toContain(leak)
    }
  })

  it('drops the group entirely rather than returning it empty', async () => {
    // An empty "Change orders from this RFI" group would itself disclose that
    // change orders exist — the aggregate side channel §23 forbids.
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'engineer' })
    const res = await related('rfi', RFI_IN)
    expect(res.body.data.groups).toEqual([])
    expect(JSON.stringify(res.body)).not.toContain('changeorders')
  })

  it('counts only what the caller may actually see', async () => {
    changeOrders = [
      { id: 'co-in',  co_number: 1, title: 'Visible', status: 'submitted', project_id: PROJ_IN },
      { id: 'co-out', co_number: 2, title: 'Hidden',  status: 'submitted', project_id: PROJ_OUT },
    ]
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'project_manager' })
    const res = await related('rfi', RFI_IN)
    // project_manager lacks cost.view, so BOTH are filtered — the visible count
    // must equal the authorized count, never the pre-filter total.
    const visible = res.body.data.groups.flatMap((g: { items: unknown[] }) => g.items)
    expect(visible).toHaveLength(0)
    expect(JSON.stringify(res.body)).not.toContain('Hidden')

    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'owner' })
    const asOwner = await related('rfi', RFI_IN)
    const ownerVisible = asOwner.body.data.groups.flatMap((g: { items: unknown[] }) => g.items)
    expect(ownerVisible, 'owner sees both, and the count matches').toHaveLength(2)
    expect(asOwner.body.data.groups[0].items.length).toBe(2)
  })

  it('does not expose the internal authorization field on returned items', async () => {
    linkedActions = [{ id: 'act1', title: 'Do the thing', status: 'open', project_id: PROJ_IN, assigned_to_user_id: USER_A }]
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'owner' })
    const res = await related('rfi', RFI_IN)
    const items = res.body.data.groups.flatMap((g: { items: Record<string, unknown>[] }) => g.items)
    expect(items.length).toBeGreaterThan(0)
    for (const i of items) {
      expect(i, 'assignedToUserId is authorization input, not response contract')
        .not.toHaveProperty('assignedToUserId')
    }
  })
})

// ─── 4. SELF-scoped targets keep their Personal Inbox rule (§25) ──────────────
describe('action targets are scoped to their assignee, not to the project', () => {
  beforeEach(() => {
    changeOrders = []
    linkedActions = [
      { id: 'act-mine',   title: 'Mine',   status: 'open', project_id: PROJ_IN, assigned_to_user_id: USER_A },
      { id: 'act-theirs', title: 'Theirs', status: 'open', project_id: PROJ_IN, assigned_to_user_id: 'someone-else' },
    ]
  })

  it('returns only the caller’s own action to a non-admin holder', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'engineer' })
    const res = await related('rfi', RFI_IN)
    const items = res.body.data.groups.flatMap((g: { items: { sourceId: string }[] }) => g.items) as { sourceId: string }[]
    expect(items.map(i => i.sourceId)).toEqual(['act-mine'])
    expect(JSON.stringify(res.body)).not.toContain('Theirs')
  })

  it('returns both to the holder of personal.admin', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'owner' })
    const res = await related('rfi', RFI_IN)
    const items = res.body.data.groups.flatMap((g: { items: { sourceId: string }[] }) => g.items) as { sourceId: string }[]
    expect(items.map(i => i.sourceId).sort()).toEqual(['act-mine', 'act-theirs'])
  })

  it('does not let project scope substitute for action ownership', async () => {
    // The caller IS attached to PROJ_IN, which both actions hang off. Inheriting
    // project scope would wrongly disclose the other user's action.
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'project_manager' })
    const res = await related('rfi', RFI_IN)
    expect(JSON.stringify(res.body)).not.toContain('act-theirs')
  })
})

// ─── 5. Authorization is batched, not N+1 (§38) ───────────────────────────────
describe('target authorization does not become an N+1', () => {
  it('resolves many targets with a bounded number of scope queries', async () => {
    changeOrders = Array.from({ length: 40 }, (_, i) => ({
      id: `co${i}`, co_number: i, title: `CO ${i}`, status: 'submitted',
      project_id: i % 2 === 0 ? PROJ_IN : PROJ_OUT,
    }))
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'owner' })
    const res = await related('rfi', RFI_IN)
    expect(res.status).toBe(200)

    // One scope query authorizes the source, one authorizes the whole target
    // batch. 40 targets must not mean 40 authorization round-trips.
    expect(scopeQueryCount(),
      '40 related targets must not cost 40 authorization queries').toBeLessThanOrEqual(2)
  })
})

// ─── 6. No side effects (§42) ─────────────────────────────────────────────────
describe('the related read has no side effects', () => {
  it('writes nothing on success or refusal', async () => {
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'owner' })
    await related('rfi', RFI_IN)
    setCaller({ id: USER_A, tenantId: TENANT_A, role: 'engineer' })
    await related('rfi', RFI_OUT)
    const writes = mockQuery.mock.calls.map(sqlOf)
      .filter(s => /\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i.test(s))
    expect(writes).toEqual([])
  })
})
