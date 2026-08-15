/**
 * Cost Intelligence — analysis + route tests (v4.54.0)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// ADR-014 Phase 2B-1: GET /projects/:id/cost-intelligence discloses budget, forecast and change-order value, so it requires `cost.view` — a capability Phase 1 grants to the tenant owner alone.
// Authorization re-resolves that role from the database on every request,
// so the pool answers the lookup for the caller under test.
const CALLER = vi.hoisted(() => ({ id: 'caller', tenant_id: 'tenant-1', role: 'owner', is_active: true }))

const mockQuery = vi.fn()
vi.mock('../db/pool', () => ({
  tenantQuery: (t: string, sql: string, p: unknown[]) => mockQuery(t, sql, p),
  query:       (sql: string, p: unknown[]) =>
    /FROM\s+users\s+WHERE\s+id/i.test(String(sql))
      ? Promise.resolve({ rows: [CALLER], rowCount: 1 })
      : mockQuery(null, sql, p),
}))
vi.mock('../auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.auth = { sub: 'u1', tid: 'tenant-1', role: 'owner' }
    next()
  },
}))
vi.mock('../middleware/tenant', () => ({ requireTenant: () => (req: any, _res: any, next: any) => { req.tenantId = 'tenant-1'; next() } }))

import { analyzeCostIntelligence, type ProjectFin, type ChangeOrderRow } from '../services/costControl/costIntelligenceService'

const PROJ: ProjectFin = { id: 'p1', code: 'PRJ', name: 'DC', budget: 1_000_000, committed_cost: 600_000, actual_cost: 300_000, forecast_cost: 1_150_000, contingency_pct: 10 }

describe('analyzeCostIntelligence — revised budget & variance', () => {
  it('rolls approved COs into the revised budget and computes overrun', () => {
    const cos: ChangeOrderRow[] = [
      { co_number: 1, title: 'Added switchgear', status: 'approved', cost_impact: 80_000 },
      { co_number: 2, title: 'Credit', status: 'approved', cost_impact: -20_000 },
      { co_number: 3, title: 'Pending scope', status: 'submitted', cost_impact: 50_000 },
      { co_number: 4, title: 'Rejected', status: 'rejected', cost_impact: 999_999 },
    ]
    const r = analyzeCostIntelligence(PROJ, cos)
    expect(r.position.approvedCoTotal).toBe(60_000)              // 80k - 20k
    expect(r.position.revisedBudget).toBe(1_060_000)             // 1m + 60k
    expect(r.position.variance).toBe(90_000)                     // 1.15m - 1.06m
    expect(r.position.variancePct).toBeCloseTo(8.49, 1)
    expect(r.position.pendingCoTotal).toBe(50_000)
    expect(r.overrunRisk).toBe('high')                           // >5% over
  })

  it('cites approved change orders and the forecast overrun as drivers', () => {
    const cos: ChangeOrderRow[] = [{ co_number: 1, title: 'Switchgear', status: 'approved', cost_impact: 80_000 }]
    const r = analyzeCostIntelligence(PROJ, cos)
    expect(r.drivers.find(d => d.label === 'Approved change orders')).toBeTruthy()
    expect(r.drivers.find(d => d.label === 'Forecast over revised budget')).toBeTruthy()
    expect(r.headline).toMatch(/over the revised budget/i)
    expect(r.recommendations.length).toBeGreaterThan(0)
  })
})

describe('analyzeCostIntelligence — under budget', () => {
  it('reports low risk and a positive headline', () => {
    const r = analyzeCostIntelligence({ ...PROJ, forecast_cost: 950_000 }, [])
    expect(r.position.variance).toBeLessThan(0)
    expect(r.overrunRisk).toBe('low')
    expect(r.headline).toMatch(/within the revised budget/i)
  })

  it('handles no budget gracefully', () => {
    const r = analyzeCostIntelligence({ id: 'p1', budget: 0, forecast_cost: 0 }, [])
    expect(r.headline).toMatch(/no budget/i)
    expect(r.position.variancePct).toBe(0)
  })
})

// ─── Route smoke ──────────────────────────────────────────────────────────────
import express from 'express'
import request from 'supertest'
import { costIntelligenceRouter } from '../routes/costIntelligence'

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1', costIntelligenceRouter as any)
  return app
}

describe('Cost Intelligence route', () => {
  beforeEach(() => vi.clearAllMocks())

  it('GET /projects/:id/cost-intelligence returns the analysis', async () => {
    mockQuery.mockImplementation(async (_t: string, sql: string) => {
      if (/FROM projects WHERE/.test(sql)) return { rows: [{ id: 'p1', code: 'PRJ', name: 'DC', budget: 1_000_000, committed_cost: 0, actual_cost: 0, forecast_cost: 1_100_000, contingency_pct: 10 }], rowCount: 1 }
      if (/FROM change_orders/.test(sql)) return { rows: [{ co_number: 1, title: 'X', status: 'approved', cost_impact: 50_000 }] }
      return { rows: [] }
    })
    const res = await request(makeApp()).get('/api/v1/projects/p1/cost-intelligence')
    expect(res.status).toBe(200)
    expect(res.body.data.position.revisedBudget).toBe(1_050_000)
    expect(res.body.data.overrunRisk).toBeTruthy()
  })

  it('404s for an unknown project', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 })
    const res = await request(makeApp()).get('/api/v1/projects/nope/cost-intelligence')
    expect(res.status).toBe(404)
  })
})
