/**
 * AUDIT-P1-12 regression — change-order approve/reject authorization.
 * Before the fix these routes had only requireAuth + requireTenant — any
 * authenticated tenant member, including a 'viewer', could approve or reject
 * a budget/contract-impacting change order.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const h = vi.hoisted(() => ({
  identity: {} as { sub?: string; role?: string; tid?: string },
  /** The role the DATABASE reports — the authority Phase 2 authorizes against. */
  dbRole: 'viewer' as string,
  approveChangeOrder: vi.fn().mockResolvedValue({ id: 'co-1', status: 'approved' }),
  rejectChangeOrder:  vi.fn().mockResolvedValue({ id: 'co-1', status: 'rejected' }),
}))

vi.mock('../auth', async () => {
  const actual = await vi.importActual<typeof import('../auth')>('../auth')
  return {
    ...actual,
    requireAuth: (req: any, _res: any, next: any) => { req.auth = h.identity; next() },
  }
})

vi.mock('../middleware/tenant', () => ({
  requireTenant: () => (req: any, _res: any, next: any) => { req.tenantId = h.identity.tid; next() },
}))

// ADR-014 Phase 2A: authorization now re-resolves the caller's role from the
// database rather than trusting the token claim, so the pool must answer that
// lookup. `h.dbRole` is the authoritative role under test.
vi.mock('../db/pool', () => ({
  query: async (sql: string) =>
    /FROM\s+users\s+WHERE\s+id/i.test(String(sql))
      ? { rows: [{ id: 'u1', tenant_id: h.identity.tid ?? 'tenant-1', role: h.dbRole, is_active: true }], rowCount: 1 }
      : { rows: [], rowCount: 0 },
  tenantQuery: async () => ({ rows: [], rowCount: 0 }),
  tenantTransaction: vi.fn(),
}))

vi.mock('../services/changeOrders/changeOrderService', () => ({
  createChangeOrder: vi.fn(), getChangeOrder: vi.fn(), listChangeOrders: vi.fn(),
  updateChangeOrder: vi.fn(), submitChangeOrder: vi.fn(),
  approveChangeOrder: h.approveChangeOrder, rejectChangeOrder: h.rejectChangeOrder,
  voidChangeOrder: vi.fn(), linkTasks: vi.fn(), unlinkTask: vi.fn(),
  listLinkedTasks: vi.fn(), getChangeOrderSummary: vi.fn(),
}))

import express from 'express'
import request from 'supertest'
import { changeOrdersRouter } from '../routes/changeOrders'

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1', changeOrdersRouter)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
  h.identity = {}
  h.dbRole = 'viewer'
})

/** Set both the token claim and the authoritative database role. */
function callerIs(role: string) {
  h.identity = { sub: 'u1', role, tid: 'tenant-1' }
  h.dbRole = role
}

describe('AUDIT-P1-12 — change-order approve/reject authorization', () => {
  it('blocks a viewer from approving a change order (403)', async () => {
    callerIs('viewer')
    const res = await request(makeApp()).post('/api/v1/change-orders/co-1/approve').send({})
    expect(res.status).toBe(403)
    expect(h.approveChangeOrder).not.toHaveBeenCalled()
  })

  it('blocks an engineer from rejecting a change order (403)', async () => {
    callerIs('engineer')
    const res = await request(makeApp()).post('/api/v1/change-orders/co-1/reject').send({})
    expect(res.status).toBe(403)
    expect(h.rejectChangeOrder).not.toHaveBeenCalled()
  })

  // BEHAVIOUR CHANGE (ADR-014 Phase 2A §5). AUDIT-P1-12 originally granted
  // change-order approval to owner/admin/project_manager via requireRole. Phase
  // 2A replaces that with `cost.approve`, which is Owner-only under the
  // temporary fail-closed delegation policy while commercial approval authority
  // is designed. A PM therefore now receives 403 here.
  //
  // This is a deliberate REGRESSION of a previously established delegation and
  // is the first item queued for the delegation-refinement decision. It is
  // recorded in the Phase 2A report rather than silently flipped.
  it('now blocks a project_manager from approving a change order (403) — cost.approve is Owner-only', async () => {
    callerIs('project_manager')
    const res = await request(makeApp()).post('/api/v1/change-orders/co-1/approve').send({})
    expect(res.status).toBe(403)
    expect(h.approveChangeOrder).not.toHaveBeenCalled()
  })

  it('also blocks the platform administrator — Admin is not a commercial approver', async () => {
    callerIs('admin')
    const res = await request(makeApp()).post('/api/v1/change-orders/co-1/approve').send({})
    expect(res.status).toBe(403)
    expect(h.approveChangeOrder).not.toHaveBeenCalled()
  })

  it('honours the database role over a stale token claim', async () => {
    // Token still says owner; the user has since been demoted.
    h.identity = { sub: 'u1', role: 'owner', tid: 'tenant-1' }
    h.dbRole = 'viewer'
    const res = await request(makeApp()).post('/api/v1/change-orders/co-1/approve').send({})
    expect(res.status).toBe(403)
    expect(h.approveChangeOrder).not.toHaveBeenCalled()
  })

  it('allows an owner to approve a change order', async () => {
    callerIs('owner')
    const res = await request(makeApp()).post('/api/v1/change-orders/co-1/approve').send({})
    expect(res.status).toBe(200)
    expect(h.approveChangeOrder).toHaveBeenCalled()
  })
})
