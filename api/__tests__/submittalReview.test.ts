/**
 * Submittal Review Assistant — checks / precedent / risk + route tests (v4.47.0)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const mockQuery = vi.fn()
vi.mock('../db/pool', () => ({
  tenantQuery: (t: string, sql: string, p: unknown[]) => mockQuery(t, sql, p),
  query:       (sql: string, p: unknown[]) => mockQuery(null, sql, p),
}))
vi.mock('../auth', () => ({ requireAuth: (req: any, _res: any, next: any) => { req.auth = { sub: 'u1' }; next() } }))
vi.mock('../middleware/tenant', () => ({ requireTenant: () => (req: any, _res: any, next: any) => { req.tenantId = 'tenant-1'; next() } }))

import { reviewChecks, findSimilarSubmittals, assessSubmittalRisk, type SubmittalLite } from '../services/submittal/submittalReviewService'

const NOW = new Date('2026-06-22T12:00:00Z')

describe('reviewChecks', () => {
  it('flags missing spec section and overdue review', () => {
    const s: SubmittalLite = { id: 's1', title: 'Pump', type: 'Product Data', spec_section: null, submitted_by: 'u', status: 'under_review', due_date: '2026-06-01' }
    const checks = reviewChecks(s, 0, NOW)
    expect(checks.find(c => c.label === 'Spec section')!.status).toBe('missing')
    expect(checks.find(c => c.label === 'Review timeliness')!.status).toBe('warn')
  })
  it('all-ok when complete and on time', () => {
    const s: SubmittalLite = { id: 's1', title: 'Pump', type: 'Product Data', spec_section: '23 21 23', submitted_by: 'u', status: 'submitted', due_date: '2026-08-01' }
    const checks = reviewChecks(s, 0, NOW)
    expect(checks.every(c => c.status === 'ok')).toBe(true)
  })
  it('warns when prior submittals in the spec section were returned', () => {
    const s: SubmittalLite = { id: 's1', title: 'Pump', type: 'Product Data', spec_section: '23 21 23', submitted_by: 'u', status: 'submitted', due_date: '2026-08-01' }
    const checks = reviewChecks(s, 2, NOW)
    expect(checks.find(c => c.label === 'Spec-section history')!.status).toBe('warn')
  })
})

describe('findSimilarSubmittals', () => {
  const target: SubmittalLite = { id: 't', title: 'Chilled water pump product data', type: 'Product Data', spec_section: '23 21 23' }
  const candidates: SubmittalLite[] = [
    { id: 'a', submittal_number: 'M-1', title: 'Chilled water pump data', type: 'Product Data', spec_section: '23 21 23', status: 'revise_resubmit' },
    { id: 'b', submittal_number: 'E-1', title: 'Panelboard schedule', type: 'Shop Drawing', spec_section: '26 24 16', status: 'approved' },
  ]
  it('ranks the same-spec pump submittal first and flags it as returned', () => {
    const out = findSimilarSubmittals(target, candidates)
    expect(out[0].number).toBe('M-1')
    expect(out[0].wasReturned).toBe(true)
    expect(out.map(o => o.number)).not.toContain('E-1')
  })
})

describe('assessSubmittalRisk', () => {
  it('is high when spec section missing plus other warnings', () => {
    const checks = reviewChecks({ id: 's', title: 'x', type: null, spec_section: null, submitted_by: null, status: 'under_review', due_date: '2026-06-01' }, 1, NOW)
    expect(assessSubmittalRisk(checks, 1).level).toBe('high')
  })
  it('is low when everything checks out', () => {
    const checks = reviewChecks({ id: 's', title: 'x', type: 'Sample', spec_section: '09', submitted_by: 'u', status: 'submitted', due_date: '2026-08-01' }, 0, NOW)
    expect(assessSubmittalRisk(checks, 0).level).toBe('low')
  })
})

// ─── Route smoke ──────────────────────────────────────────────────────────────
import express from 'express'
import request from 'supertest'
import { submittalReviewRouter } from '../routes/submittalReview'

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/submittals', submittalReviewRouter as any)
  return app
}

describe('Submittal review route', () => {
  beforeEach(() => vi.clearAllMocks())

  it('GET /submittals/:id/review returns checks, precedent, reviewers, risk', async () => {
    mockQuery.mockImplementation(async (_t: string, sql: string) => {
      if (/FROM submittals WHERE tenant_id=\$1 AND id=\$2/.test(sql)) {
        return { rows: [{ id: 'sub1', project_id: 'p1', submittal_number: 'M-2', title: 'Chilled water pump', type: 'Product Data', discipline: 'Mechanical', spec_section: '23 21 23', status: 'under_review', submitted_by: 'u', reviewed_by: null, due_date: '2026-06-01' }], rowCount: 1 }
      }
      if (/AND id<>\$3 LIMIT/.test(sql)) return { rows: [{ id: 'sub2', submittal_number: 'M-1', title: 'Chilled water pump data', type: 'Product Data', spec_section: '23 21 23', status: 'revise_resubmit' }] }
      if (/reviewed_by AS user_id/.test(sql)) return { rows: [{ user_id: 'rev-3', reviewed: 7 }] }
      if (/AS returned FROM submittals/.test(sql)) return { rows: [{ returned: 1 }] }
      return { rows: [] }
    })
    const res = await request(makeApp()).get('/api/v1/submittals/sub1/review')
    expect(res.status).toBe(200)
    expect(res.body.data.checks.length).toBeGreaterThan(0)
    expect(res.body.data.similar[0].number).toBe('M-1')
    expect(res.body.data.suggestedReviewers[0].userId).toBe('rev-3')
    expect(['medium', 'high']).toContain(res.body.data.risk.level)
  })

  it('404s for an unknown submittal', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 })
    const res = await request(makeApp()).get('/api/v1/submittals/nope/review')
    expect(res.status).toBe(404)
  })
})
