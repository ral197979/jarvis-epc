/**
 * AUDIT-P1-12 regression — change-order approve/reject authorization.
 * Before the fix these routes had only requireAuth + requireTenant — any
 * authenticated tenant member, including a 'viewer', could approve or reject
 * a budget/contract-impacting change order.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const h = vi.hoisted(() => ({
  identity: {} as { sub?: string; role?: string; tid?: string },
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
})

describe('AUDIT-P1-12 — change-order approve/reject authorization', () => {
  it('blocks a viewer from approving a change order (403)', async () => {
    h.identity = { sub: 'u1', role: 'viewer', tid: 'tenant-1' }
    const res = await request(makeApp()).post('/api/v1/change-orders/co-1/approve').send({})
    expect(res.status).toBe(403)
    expect(h.approveChangeOrder).not.toHaveBeenCalled()
  })

  it('blocks an engineer from rejecting a change order (403)', async () => {
    h.identity = { sub: 'u1', role: 'engineer', tid: 'tenant-1' }
    const res = await request(makeApp()).post('/api/v1/change-orders/co-1/reject').send({})
    expect(res.status).toBe(403)
    expect(h.rejectChangeOrder).not.toHaveBeenCalled()
  })

  it('allows a project_manager to approve a change order', async () => {
    h.identity = { sub: 'u1', role: 'project_manager', tid: 'tenant-1' }
    const res = await request(makeApp()).post('/api/v1/change-orders/co-1/approve').send({})
    expect(res.status).toBe(200)
    expect(h.approveChangeOrder).toHaveBeenCalled()
  })

  it('allows an owner to approve a change order', async () => {
    h.identity = { sub: 'u1', role: 'owner', tid: 'tenant-1' }
    const res = await request(makeApp()).post('/api/v1/change-orders/co-1/approve').send({})
    expect(res.status).toBe(200)
    expect(h.approveChangeOrder).toHaveBeenCalled()
  })
})
