/**
 * Portfolio Copilot — insights + route tests (v4.44.0)
 *
 * `synthesizePortfolioInsights` is pure/deterministic. Route smoke mirrors the
 * mock-pool pattern.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const mockQuery = vi.fn()
vi.mock('../db/pool', () => ({
  tenantQuery: (tenantId: string, sql: string, params: unknown[]) => mockQuery(tenantId, sql, params),
  query:       (sql: string, params: unknown[]) => mockQuery(null, sql, params),
}))
vi.mock('../auth', () => ({ requireAuth: (req: any, _res: any, next: any) => { req.auth = { sub: 'u1' }; next() } }))
vi.mock('../middleware/tenant', () => ({ requireTenant: () => (req: any, _res: any, next: any) => { req.tenantId = 'tenant-1'; next() } }))

import { synthesizePortfolioInsights, type PortfolioInsightsInputs } from '../services/copilot/portfolioInsightsService'

const NOW = new Date('2026-06-22T12:00:00Z')

describe('synthesizePortfolioInsights — empty', () => {
  it('handles no projects', () => {
    const r = synthesizePortfolioInsights({ projects: [], workItems: [] }, NOW)
    expect(r.summary.projects).toBe(0)
    expect(r.headline).toMatch(/no active projects/i)
    expect(r.benchmarks.every(b => b.best === null)).toBe(true)
  })
})

describe('synthesizePortfolioInsights — benchmarks', () => {
  it('picks best/worst on cost variance', () => {
    const inputs: PortfolioInsightsInputs = {
      projects: [
        { id: 'a', name: 'Under', status: 'active', budget: 1000, forecast_cost: 900 },   // -10%
        { id: 'b', name: 'Over', status: 'active', budget: 1000, forecast_cost: 1300 },    // +30%
        { id: 'c', name: 'Even', status: 'active', budget: 1000, forecast_cost: 1000 },    // 0%
      ],
      workItems: [],
    }
    const r = synthesizePortfolioInsights(inputs, NOW)
    const cost = r.benchmarks.find(b => b.metric === 'Cost variance')!
    expect(cost.best!.name).toBe('Under')
    expect(cost.worst!.name).toBe('Over')
    expect(cost.median).toBe(0)
  })
})

describe('synthesizePortfolioInsights — resource conflicts', () => {
  it('flags a user with open/overdue work on ≥2 projects', () => {
    const inputs: PortfolioInsightsInputs = {
      projects: [{ id: 'a', name: 'A', status: 'active' }, { id: 'b', name: 'B', status: 'active' }, { id: 'c', name: 'C', status: 'active' }],
      workItems: [
        { assignee: 'u-busy', project_id: 'a', status: 'open', due: '2026-06-01' }, // overdue
        { assignee: 'u-busy', project_id: 'b', status: 'open', due: '2026-06-05' }, // overdue
        { assignee: 'u-busy', project_id: 'c', status: 'open', due: '2026-07-30' }, // future
        { assignee: 'u-solo', project_id: 'a', status: 'open', due: '2026-06-01' }, // only one project
      ],
    }
    const r = synthesizePortfolioInsights(inputs, NOW)
    expect(r.resourceConflicts).toHaveLength(1)
    const c = r.resourceConflicts[0]
    expect(c.userId).toBe('u-busy')
    expect(c.projectCount).toBe(3)
    expect(c.totalOverdue).toBe(2)
    expect(c.severity).toBe('critical') // 3 projects + overdue
    expect(c.summary).toContain('over-allocated')
  })
})

describe('synthesizePortfolioInsights — exemplars & outliers', () => {
  it('marks a clean project as an exemplar and a triple-bad one as an outlier', () => {
    const inputs: PortfolioInsightsInputs = {
      projects: [
        { id: 'good', name: 'Good', status: 'active', budget: 1000, forecast_cost: 900, planned_finish: '2026-12-01', progress_pct: 50 },
        { id: 'bad', name: 'Bad', status: 'active', budget: 1000, forecast_cost: 1400, planned_finish: '2026-05-01', progress_pct: 30 },
        { id: 'mid', name: 'Mid', status: 'active', budget: 1000, forecast_cost: 1050, planned_finish: '2026-11-01', progress_pct: 60 },
      ],
      workItems: [
        { assignee: null, project_id: 'bad', status: 'open', due: '2026-06-01' },
        { assignee: null, project_id: 'bad', status: 'open', due: '2026-06-02' },
      ],
    }
    const r = synthesizePortfolioInsights(inputs, NOW)
    expect(r.exemplars.map(e => e.name)).toContain('Good')
    const badOutlier = r.outliers.find(o => o.name === 'Bad')
    expect(badOutlier).toBeTruthy()
    expect(badOutlier!.reasons.length).toBeGreaterThanOrEqual(2)
  })
})

// ─── Route smoke ──────────────────────────────────────────────────────────────
import express from 'express'
import request from 'supertest'
import { copilotRouter } from '../routes/copilot'

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1', copilotRouter as any)
  return app
}

describe('Portfolio insights route smoke', () => {
  beforeEach(() => vi.clearAllMocks())

  it('GET /copilot/portfolio returns benchmarks even with no work items', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'a', name: 'A', status: 'active', budget: 1000, forecast_cost: 1200 }], rowCount: 1 }) // projects
      .mockResolvedValueOnce({ rows: [] })  // actions
      .mockResolvedValueOnce({ rows: [] })  // rfis
    const res = await request(makeApp()).get('/api/v1/copilot/portfolio')
    expect(res.status).toBe(200)
    expect(res.body.data.summary.projects).toBe(1)
    expect(res.body.data.benchmarks.length).toBe(3)
  })

  it('returns an empty-portfolio shape when there are no active projects', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }) // projects → none
    const res = await request(makeApp()).get('/api/v1/copilot/portfolio')
    expect(res.status).toBe(200)
    expect(res.body.data.summary.projects).toBe(0)
    expect(res.body.data.headline).toMatch(/no active projects/i)
  })
})
