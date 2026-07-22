/**
 * Route-shadow anti-regression — PR #22 (un-shadow Risk Register & Change Orders).
 *
 * Two collisions were fixed and must never come back:
 *
 *   1. `risksRouter` (api/routes/risks.ts) was mounted on /api/v1 *before*
 *      `riskRegisterRouter` and used the pre-migration column shape
 *      (likelihood/mitigation/contingency). It shadowed the real service-backed
 *      Risk Register. The stale router + its file were deleted.
 *
 *   2. Inline change-order CRUD lived in `budgetsRouter` (api/routes/budgets.ts),
 *      mounted on /api/v1 *before* `changeOrdersRouter`. It used the pre-083
 *      shape (co_type/amount/schedule_days) and the wrong `{ change_orders }`
 *      envelope. The inline routes were deleted; `changeOrdersRouter` owns them.
 *
 * These tests mount the real routers in *production order* (budgets/risks first,
 * the service-backed routers after) and assert the request resolves to the
 * service-backed handler with the correct contract. Re-introducing either
 * shadow makes them fail.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const h = vi.hoisted(() => ({
  identity: { sub: 'u1', role: 'project_manager', tid: 'tenant-1' } as {
    sub?: string; role?: string; tid?: string
  },
  // change-order service
  createChangeOrder: vi.fn(),
  listChangeOrders:  vi.fn(),
  // risk service
  createRisk: vi.fn(),
  listRisks:  vi.fn(),
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

// budgets.ts touches the pool at request time only; mock it so importing the
// router never opens a connection.
vi.mock('../db/pool', () => ({ tenantQuery: vi.fn().mockResolvedValue({ rows: [] }) }))

vi.mock('../services/changeOrders/changeOrderService', () => ({
  createChangeOrder: h.createChangeOrder, getChangeOrder: vi.fn(),
  listChangeOrders: h.listChangeOrders, updateChangeOrder: vi.fn(),
  submitChangeOrder: vi.fn(), approveChangeOrder: vi.fn(), rejectChangeOrder: vi.fn(),
  voidChangeOrder: vi.fn(), linkTasks: vi.fn(), unlinkTask: vi.fn(),
  listLinkedTasks: vi.fn(), getChangeOrderSummary: vi.fn(),
}))

vi.mock('../services/riskRegister/riskService', () => ({
  createRisk: h.createRisk, listRisks: h.listRisks, getRisk: vi.fn(),
  updateRisk: vi.fn(), closeRisk: vi.fn(), getRiskSummary: vi.fn(),
}))

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import express from 'express'
import request from 'supertest'
import { budgetsRouter } from '../routes/budgets'
import { changeOrdersRouter } from '../routes/changeOrders'
import { riskRegisterRouter } from '../routes/riskRegister'

// Mirrors api/server.ts: budgets mounts BEFORE changeOrders, both on /api/v1.
function makeChangeOrderApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1', budgetsRouter as any)       // mounted first — used to shadow
  app.use('/api/v1', changeOrdersRouter as any)  // real, service-backed owner
  return app
}

// budgets ONLY — proves budgets no longer answers change-order paths.
function makeBudgetsOnlyApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1', budgetsRouter as any)
  return app
}

function makeRiskApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1', riskRegisterRouter as any)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
  h.identity = { sub: 'u1', role: 'project_manager', tid: 'tenant-1' }
})

describe('PR #22 — Change Orders route ownership', () => {
  it('production mount order resolves list to changeOrdersRouter (service-backed)', async () => {
    h.listChangeOrders.mockResolvedValue({ items: [{ id: 'co-1', type: 'PCO' }], total: 1 })
    const res = await request(makeChangeOrderApp()).get('/api/v1/projects/p1/change-orders')
    expect(res.status).toBe(200)
    expect(h.listChangeOrders).toHaveBeenCalledTimes(1)
  })

  it('list returns the { items, total } envelope, NOT the legacy { change_orders }', async () => {
    h.listChangeOrders.mockResolvedValue({ items: [{ id: 'co-1' }], total: 1 })
    const res = await request(makeChangeOrderApp()).get('/api/v1/projects/p1/change-orders')
    expect(res.body).toHaveProperty('items')
    expect(res.body).toHaveProperty('total', 1)
    expect(res.body).not.toHaveProperty('change_orders') // legacy budgets.ts shape
  })

  it('create preserves type / costImpact / scheduleImpactDays (no silent amount:0)', async () => {
    h.createChangeOrder.mockResolvedValue({ id: 'co-9' })
    const res = await request(makeChangeOrderApp())
      .post('/api/v1/projects/p1/change-orders')
      .send({ title: 'Added scope', type: 'PCO', costImpact: 12500, scheduleImpactDays: 4 })
    expect(res.status).toBe(201)
    expect(res.body).toHaveProperty('changeOrder')
    const [, payload] = h.createChangeOrder.mock.calls[0]
    expect(payload).toMatchObject({ type: 'PCO', costImpact: 12500, scheduleImpactDays: 4 })
    // legacy inline route mapped body.amount ?? 0 → would drop costImpact
    expect(payload).not.toHaveProperty('amount')
  })

  it('ANTI-REGRESSION: budgetsRouter alone no longer answers change-order paths (404)', async () => {
    const app = makeBudgetsOnlyApp()
    const list = await request(app).get('/api/v1/projects/p1/change-orders')
    const create = await request(app).post('/api/v1/projects/p1/change-orders').send({ title: 'x' })
    expect(list.status).toBe(404)
    expect(create.status).toBe(404)
    // If inline change-order routes are re-added to budgets.ts, these become 200/201 and fail.
  })
})

describe('PR #22 — Risk Register route ownership', () => {
  it('create accepts the real service fields and returns { risk }', async () => {
    h.createRisk.mockResolvedValue({ id: 'r-1' })
    const res = await request(makeRiskApp())
      .post('/api/v1/projects/p1/risks')
      .send({
        title: 'Long-lead switchgear', category: 'procurement',
        probability: 4, impact: 5, costExposure: 250000,
        mitigationPlan: 'Expedite PO; identify alt vendor',
        owner: 'jsmith', contingencyPlan: 'Rent temporary gear',
      })
    expect(res.status).toBe(201)
    expect(res.body).toHaveProperty('risk')
    const [, , input] = h.createRisk.mock.calls[0]
    expect(input).toMatchObject({
      title: 'Long-lead switchgear', category: 'procurement',
      probability: 4, impact: 5, costExposure: 250000,
      mitigationPlan: 'Expedite PO; identify alt vendor',
    })
  })

  it('create rejects missing required fields (400) before hitting the service', async () => {
    const res = await request(makeRiskApp())
      .post('/api/v1/projects/p1/risks')
      .send({ title: 'no category/prob/impact' })
    expect(res.status).toBe(400)
    expect(h.createRisk).not.toHaveBeenCalled()
  })

  it('list resolves to the service-backed handler and returns { risks }', async () => {
    h.listRisks.mockResolvedValue([{ id: 'r-1' }])
    const res = await request(makeRiskApp()).get('/api/v1/projects/p1/risks')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('risks')
    expect(h.listRisks).toHaveBeenCalledTimes(1)
  })
})

describe('PR #22 — source-level shadow guards', () => {
  const api = (p: string) => resolve(__dirname, '..', p)

  it('the stale risksRouter file is gone', () => {
    expect(existsSync(api('routes/risks.ts'))).toBe(false)
  })

  it('server.ts no longer imports or mounts risksRouter', () => {
    const server = readFileSync(api('server.ts'), 'utf8')
    expect(server).not.toMatch(/risksRouter/)
    expect(server).not.toMatch(/from '\.\/routes\/risks'/)
  })

  it('budgets.ts no longer owns change-order routes or writes change_orders', () => {
    const budgets = readFileSync(api('routes/budgets.ts'), 'utf8')
    expect(budgets).not.toMatch(/INSERT INTO change_orders/)
    expect(budgets).not.toMatch(/router\.(get|post|patch)\([^)]*change-orders/)
  })

  it('the service-backed risk register uses the migrated schema, not pre-migration columns', () => {
    const svc = readFileSync(api('services/riskRegister/riskService.ts'), 'utf8')
    // migrated columns present
    expect(svc).toMatch(/mitigation_plan/)
    expect(svc).toMatch(/cost_exposure/)
    // pre-migration columns absent (the stale risks.ts used these)
    expect(svc).not.toMatch(/\blikelihood\b/)
  })
})
