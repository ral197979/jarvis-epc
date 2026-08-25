/**
 * Contracts — the governed read surface, and what may count as "active".
 *
 * What the audit established before any of this existed:
 *
 *   `contracts` (migration 002) carries `vendor_id NOT NULL` and
 *   `project_id NOT NULL`. A contract is a commitment to a VENDOR delivered on
 *   a project. It is not a project, and the dashboard tile that counted
 *   projects as contracts is the defect this closes.
 *
 *   Its lifecycle is a persisted enum:
 *       draft | negotiation | active | variation | closed | disputed
 *   so ACTIVE is determinable without inventing or inferring anything.
 *
 *   NOTHING WRITES TO IT. No INSERT or UPDATE exists anywhere in the API; the
 *   only reference is a LEFT JOIN in the purchase-order detail. So the count is
 *   truthfully zero, and `writable: false` says why rather than letting a zero
 *   imply an empty order book.
 *
 *   `subcontracts` (migration 059) IS written and has its OWN lifecycle
 *   (active|suspended|complete|terminated). It is a different table and is
 *   deliberately not folded in — that would be the same substitution error as
 *   counting projects, only harder to notice.
 *
 * Fixture:
 *   Tenant A   OWNER_A (owner)           → tenant-wide by project.list.all
 *              PM_A    (project_manager) → member of PROJECT_A only
 *   Tenant B   PM_B    (project_manager) → another tenant entirely
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
const OWNER_A   = '10000000-0000-4000-8000-0000000000a1'
const PM_A      = '10000000-0000-4000-8000-0000000000a2'
const PROJECT_A = '30000000-0000-4000-8000-00000000000a'
const PROJECT_B = '30000000-0000-4000-8000-00000000000b'
const CONTRACT  = '60000000-0000-4000-8000-00000000000a'

interface Caller { id: string; tenantId: string; role: UserRole }
let caller: Caller
const setCaller = (c: Caller): void => { caller = c; (globalThis as Record<string, unknown>)['__ctr'] = c }
let MEMBERS: { projectId: string; userId: string; active: boolean }[]

/** Contract rows, keyed by persisted status. */
let CONTRACT_ROWS: { status: string; project: string; approved: number }[]

vi.mock('../auth', () => ({
  requireAuth: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    const c = (globalThis as Record<string, unknown>)['__ctr'] as Caller
    req['auth'] = { sub: c.id, tid: c.tenantId, role: c.role, jti: 'jti' }
    next()
  },
  requireRole: () => (_r: unknown, _s: unknown, n: () => void) => n(),
}))
vi.mock('../middleware/tenant', () => ({
  requireTenant: () => (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req['tenantId'] = ((globalThis as Record<string, unknown>)['__ctr'] as Caller).tenantId
    next()
  },
}))

import { requireAuth } from '../auth'
import { requireTenant } from '../middleware/tenant'
import { contractsRouter } from '../routes/contracts'
import { ACTIVE_CONTRACT_STATUS, CONTRACT_STATUSES } from '../services/contracts/contractService'

const app = (() => {
  const a = express()
  a.use(express.json())
  a.use('/api/v1/contracts', requireAuth as never, requireTenant() as never, contractsRouter as never)
  return a
})()

const SQLRE = /\b(SELECT|INSERT|UPDATE|DELETE)\b/i
const sqlOf = (a: unknown[]): string => a.find((x): x is string => typeof x === 'string' && SQLRE.test(x)) ?? ''
const paramsOf = (a: unknown[]): unknown[] => (a.find(x => Array.isArray(x)) as unknown[] | undefined) ?? []
const statements = (): string[] => mockQuery.mock.calls.map(c => sqlOf(c)).filter(Boolean)

beforeEach(() => {
  MEMBERS = [{ projectId: PROJECT_A, userId: PM_A, active: true }]
  CONTRACT_ROWS = []
  setCaller({ id: OWNER_A, tenantId: TENANT_A, role: 'owner' })

  mockQuery.mockReset()
  mockQuery.mockImplementation(async (...args: unknown[]) => {
    const sql = sqlOf(args)
    const params = paramsOf(args)
    const empty = { rows: [], rowCount: 0 }

    if (/FROM\s+users\s+WHERE\s+id/i.test(sql)) {
      return { rows: [{ id: caller.id, tenant_id: caller.tenantId, role: caller.role, is_active: true }], rowCount: 1 }
    }
    if (/FROM projects/i.test(sql)) {
      const wantsMembership = /project_members/i.test(sql)
      const honoursTenant   = /tenant_id = current_setting/i.test(sql)
      if (honoursTenant && caller.tenantId !== TENANT_A) return empty
      const candidates = Array.isArray(params[0]) ? params[0] as string[] : [PROJECT_A, PROJECT_B]
      const visible = candidates.filter(id => !wantsMembership ||
        MEMBERS.some(m => m.projectId === id && m.userId === caller.id && m.active))
      return { rows: visible.map(id => ({ id })), rowCount: visible.length }
    }
    // record-scope projection for a single contract
    if (/FROM contracts r/i.test(sql)) {
      return { rows: [{ project_id: PROJECT_A }], rowCount: 1 }
    }
    // the grouped summary
    if (/FROM contracts c/i.test(sql) && /GROUP BY/i.test(sql)) {
      const scoped = /project_id/i.test(sql) && /ANY|IN \(/i.test(sql)
      const rows = CONTRACT_ROWS.filter(r => !scoped ||
        MEMBERS.some(m => m.projectId === r.project && m.userId === caller.id && m.active) ||
        caller.role === 'owner')
      const by = new Map<string, { n: number; approved: number }>()
      for (const r of rows) {
        const cur = by.get(r.status) ?? { n: 0, approved: 0 }
        by.set(r.status, { n: cur.n + 1, approved: cur.approved + r.approved })
      }
      return { rows: [...by].map(([status, v]) => ({ status, n: String(v.n), approved: String(v.approved) })), rowCount: by.size }
    }
    if (/FROM contracts c/i.test(sql)) {
      return { rows: CONTRACT_ROWS.map((r, i) => ({ id: `c${i}`, status: r.status, project_id: r.project })), rowCount: CONTRACT_ROWS.length }
    }
    return empty
  })
})

// ─── 1. The governed definition of active ────────────────────────────────────

describe('active means the persisted enum member, and nothing else', () => {
  it('pins the definition to the schema value', () => {
    expect(ACTIVE_CONTRACT_STATUS).toBe('active')
    expect(CONTRACT_STATUSES).toEqual(['draft', 'negotiation', 'active', 'variation', 'closed', 'disputed'])
  })

  it('counts only contracts whose persisted status is active', async () => {
    CONTRACT_ROWS = [
      { status: 'active',      project: PROJECT_A, approved: 100 },
      { status: 'active',      project: PROJECT_A, approved: 200 },
      { status: 'draft',       project: PROJECT_A, approved: 999 },
      { status: 'negotiation', project: PROJECT_A, approved: 999 },
      { status: 'closed',      project: PROJECT_A, approved: 999 },
    ]
    const res = await request(app).get('/api/v1/contracts/summary')
    expect(res.status).toBe(200)
    expect(res.body.data.active).toBe(2)
    expect(res.body.data.activeValue).toBe(300)
    expect(res.body.data.total).toBe(5)
  })

  it('does not count variation or disputed as active', async () => {
    // Both describe live commercial relationships and an argument exists for
    // either — which is exactly why neither is folded in silently. The enum's
    // author made them distinct from `active`.
    CONTRACT_ROWS = [
      { status: 'variation', project: PROJECT_A, approved: 100 },
      { status: 'disputed',  project: PROJECT_A, approved: 100 },
    ]
    const res = await request(app).get('/api/v1/contracts/summary')
    expect(res.body.data.active).toBe(0)
    expect(res.body.data.total).toBe(2)
  })

  it('reports every state, so an excluded one is visible rather than buried', async () => {
    CONTRACT_ROWS = [
      { status: 'active',    project: PROJECT_A, approved: 10 },
      { status: 'variation', project: PROJECT_A, approved: 20 },
      { status: 'disputed',  project: PROJECT_A, approved: 30 },
    ]
    const res = await request(app).get('/api/v1/contracts/summary')
    expect(res.body.data.byStatus).toEqual({ active: 1, variation: 1, disputed: 1 })
  })

  it('reads status from the contract row, never from dates or amounts', async () => {
    const res = await request(app).get('/api/v1/contracts/summary')
    expect(res.status).toBe(200)
    const sql = statements().find(s => /FROM contracts c/i.test(s) && /GROUP BY/i.test(s))!
    expect(sql).toMatch(/GROUP BY\s+c\.status/i)
    // Nothing infers activity from a date window or a linked record.
    expect(sql).not.toMatch(/start_date|end_date|executed_date|CURRENT_DATE|NOW\(\)/i)
    expect(sql).not.toMatch(/purchase_orders|subcontracts/i)
  })
})

// ─── 2. A project is not a contract ──────────────────────────────────────────

describe('a project can never count as a contract', () => {
  it('summarises from the contracts table alone', async () => {
    await request(app).get('/api/v1/contracts/summary')
    const sql = statements().find(s => /GROUP BY/i.test(s))!
    expect(sql).toMatch(/FROM contracts/i)
    // `projects` may appear only as the membership predicate, never as a source
    // of counted rows.
    expect(sql).not.toMatch(/FROM projects|JOIN projects/i)
    expect(sql).not.toMatch(/FROM subcontracts|JOIN subcontracts/i)
  })

  it('counts zero contracts even when the tenant has projects', async () => {
    // The substitution bug in one assertion: projects exist and are reachable,
    // contracts do not exist, and the answer must be zero.
    CONTRACT_ROWS = []
    const res = await request(app).get('/api/v1/contracts/summary')
    expect(res.body.data.active).toBe(0)
    expect(res.body.data.total).toBe(0)
  })

  it('reports that no contract can be created yet', async () => {
    // Zero is truthful about the DATA. `writable:false` is what stops it being
    // read as a truthful statement about the BUSINESS.
    const res = await request(app).get('/api/v1/contracts/summary')
    expect(res.body.data.writable).toBe(false)
  })

  it('exposes no write route at all', async () => {
    for (const [method, path] of [['post', '/api/v1/contracts'], ['patch', '/api/v1/contracts/' + CONTRACT]] as const) {
      const res = await (request(app) as never as Record<string, (p: string) => { send: (b: unknown) => Promise<{ status: number }> }>)[method]!(path).send({})
      expect([404, 405], `${method} ${path} must not be routed`).toContain(res.status)
    }
  })
})

// ─── 3. Authorization and tenant isolation ───────────────────────────────────

describe('the read surface is governed', () => {
  it('refuses a caller without procurement.view', async () => {
    setCaller({ id: PM_A, tenantId: TENANT_A, role: 'engineer' })
    expect((await request(app).get('/api/v1/contracts/summary')).status).toBe(403)
    expect((await request(app).get('/api/v1/contracts')).status).toBe(403)
  })

  it('restricts the summary to projects the caller can reach', async () => {
    setCaller({ id: PM_A, tenantId: TENANT_A, role: 'project_manager' })
    CONTRACT_ROWS = [
      { status: 'active', project: PROJECT_A, approved: 100 },
      { status: 'active', project: PROJECT_B, approved: 100 },
    ]
    const res = await request(app).get('/api/v1/contracts/summary')
    expect(res.status).toBe(200)
    const sql = statements().find(s => /GROUP BY/i.test(s))!
    expect(sql, 'the summary must carry a project predicate').toMatch(/project_id/i)
  })

  it('carries the tenant predicate on every contract statement', async () => {
    await request(app).get('/api/v1/contracts/summary')
    await request(app).get('/api/v1/contracts')
    const contractStatements = statements().filter(s => /FROM contracts c/i.test(s))
    expect(contractStatements.length).toBeGreaterThan(0)
    for (const s of contractStatements) {
      expect(s, 'a contract read must be tenant-bounded').toMatch(/tenant_id = current_setting/i)
    }
  })

  it('refuses a contract in a project the caller cannot reach', async () => {
    setCaller({ id: PM_A, tenantId: TENANT_A, role: 'project_manager' })
    mockQuery.mockImplementation(async (...args: unknown[]) => {
      const sql = sqlOf(args)
      if (/FROM\s+users\s+WHERE\s+id/i.test(sql)) return { rows: [{ id: caller.id, tenant_id: caller.tenantId, role: caller.role, is_active: true }], rowCount: 1 }
      if (/FROM contracts r/i.test(sql)) return { rows: [{ project_id: PROJECT_B }], rowCount: 1 }
      if (/FROM projects/i.test(sql)) return { rows: [], rowCount: 0 }   // no membership
      return { rows: [], rowCount: 0 }
    })
    const res = await request(app).get(`/api/v1/contracts/${CONTRACT}`)
    expect(res.status).toBe(404)
  })

  it('refuses a caller from another tenant', async () => {
    setCaller({ id: PM_A, tenantId: TENANT_B, role: 'project_manager' })
    const res = await request(app).get(`/api/v1/contracts/${CONTRACT}`)
    expect(res.status).toBe(404)
  })
})

// ─── 4. Filters narrow; they never widen ─────────────────────────────────────

describe('the list filter is validated, not passed through', () => {
  it('accepts a real lifecycle state', async () => {
    expect((await request(app).get('/api/v1/contracts?status=active')).status).toBe(200)
  })

  it('refuses a state the enum does not have, rather than ignoring the filter', async () => {
    // Silently dropping an unrecognised filter returns EVERY contract to a
    // caller who asked for one state — a widening disguised as a no-op.
    const res = await request(app).get('/api/v1/contracts?status=live')
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('invalid_status')
  })

  it('binds the status as a parameter, never as SQL text', async () => {
    await request(app).get('/api/v1/contracts?status=active')
    const sql = statements().find(s => /FROM contracts c/i.test(s))!
    expect(sql).toMatch(/c\.status = \$\d+::contract_status/)
    expect(sql).not.toMatch(/status = 'active'/)
  })

  it('routes /summary to the summary, not to a contract whose id is "summary"', async () => {
    // Declaration order: a parameter route would otherwise swallow it.
    const res = await request(app).get('/api/v1/contracts/summary')
    expect(res.status).toBe(200)
    expect(res.body.data).toHaveProperty('byStatus')
  })
})
