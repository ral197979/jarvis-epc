/**
 * Tests: api/routes/risks.ts
 * Coverage targets: risk CRUD, matrix computation, stats aggregation,
 *                   tenant isolation, validation errors, risk band assignment
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ─── Mock DB pool ─────────────────────────────────────────────────────────────

const mockQuery = vi.fn()
vi.mock('../db/pool', () => ({
  tenantQuery: (tenantId: string, sql: string, params: unknown[]) => mockQuery(tenantId, sql, params),
  query:       (sql: string, params: unknown[]) => mockQuery(null, sql, params),
}))

vi.mock('../auth', () => ({
  requireAuth: (_req: any, _res: any, next: any) => next(),
}))

// v4.31.0: requireTenant is used as a factory in routes (`requireTenant()`),
// so the mock must return a middleware from a no-arg call.
vi.mock('../middleware/tenant', () => ({
  requireTenant: () => (req: any, _res: any, next: any) => {
    req.tenantId = 'tenant-123'
    next()
  },
}))

// ─── Import after mocking ─────────────────────────────────────────────────────

import express from 'express'
import request from 'supertest'
// v4.31.0 fix: module exports the router under the name `risksRouter`, not `router`
import { risksRouter } from '../routes/risks'

const app = express()
app.use(express.json())
app.use('/api/v1', risksRouter as any)

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockRow(overrides: Record<string, unknown> = {}) {
  return {
    id:          'risk-uuid-1',
    risk_number: 'RSK-001',
    title:       'Schedule overrun due to late procurement',
    description: 'Membrane delivery delay',
    category:    'Schedule',
    likelihood:  'possible',
    impact:      'major',
    risk_score:  12,
    mitigation:  'Fast-track alternate vendor sourcing',
    contingency: 'Extend completion date by 4 weeks',
    owner_name:  'Rommel D.',
    status:      'open',
    created_at:  '2026-01-15T00:00:00Z',
    updated_at:  '2026-01-15T00:00:00Z',
    metadata:    {},
    ...overrides,
  }
}

function makeRequest() {
  return { tenantId: 'tenant-123', auth: { sub: 'user-uuid-1', tid: 'tenant-123', role: 'project_manager', jti: 'abc' } }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/v1/projects/:projectId/risks', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns risk list with band annotation', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [mockRow()], rowCount: 1 })
    const res = await request(app).get('/api/v1/projects/proj-1/risks')
    expect(res.status).toBe(200)
    expect(res.body.risks).toHaveLength(1)
    expect(res.body.risks[0].band).toBe('high')   // score 12 = high
    expect(res.body.risks[0].risk_number).toBe('RSK-001')
  })

  it('annotates band=critical for score >= 17', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [mockRow({ risk_score: 20 })], rowCount: 1 })
    const res = await request(app).get('/api/v1/projects/proj-1/risks')
    expect(res.body.risks[0].band).toBe('critical')
  })

  it('annotates band=medium for score 5–9', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [mockRow({ risk_score: 9 })], rowCount: 1 })
    const res = await request(app).get('/api/v1/projects/proj-1/risks')
    expect(res.body.risks[0].band).toBe('medium')
  })

  it('annotates band=low for score <= 4', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [mockRow({ risk_score: 2 })], rowCount: 1 })
    const res = await request(app).get('/api/v1/projects/proj-1/risks')
    expect(res.body.risks[0].band).toBe('low')
  })

  it('passes status filter to DB query', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 })
    await request(app).get('/api/v1/projects/proj-1/risks?status=closed')
    const [, sql] = mockQuery.mock.calls[0]
    expect(sql).toContain('r.status = $')
  })

  it('returns 500 on DB error', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB down'))
    const res = await request(app).get('/api/v1/projects/proj-1/risks')
    expect(res.status).toBe(500)
    expect(res.body.error).toMatch(/Failed to list/)
  })
})

describe('POST /api/v1/projects/:projectId/risks', () => {
  const validBody = {
    title:       'Foundation delay',
    likelihood:  'likely',
    impact:      'major',
    category:    'Schedule',
    mitigation:  'Pre-pour inspections',
    contingency: 'Float buffer',
  }

  beforeEach(() => vi.clearAllMocks())

  it('creates a risk and returns 201', async () => {
    // Count query for risk_number generation
    mockQuery.mockResolvedValueOnce({ rows: [{ n: '0' }] })
    // Insert query
    mockQuery.mockResolvedValueOnce({ rows: [mockRow({ risk_score: 16 })] })

    const res = await request(app).post('/api/v1/projects/proj-1/risks').send(validBody)
    expect(res.status).toBe(201)
    expect(res.body.risk.band).toBe('high')
  })

  it('returns 400 when title is missing', async () => {
    const res = await request(app).post('/api/v1/projects/proj-1/risks').send({ likelihood: 'likely', impact: 'major' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/title/)
  })

  it('returns 400 for invalid likelihood', async () => {
    const res = await request(app).post('/api/v1/projects/proj-1/risks').send({ title: 'Test', likelihood: 'extreme', impact: 'major' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/likelihood/)
  })

  it('returns 400 for invalid impact', async () => {
    const res = await request(app).post('/api/v1/projects/proj-1/risks').send({ title: 'Test', likelihood: 'possible', impact: 'colossal' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/impact/)
  })

  it('auto-generates risk_number as RSK-001 when no existing risks', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ n: '0' }] })
    mockQuery.mockResolvedValueOnce({ rows: [mockRow()] })
    await request(app).post('/api/v1/projects/proj-1/risks').send(validBody)
    const insertCall = mockQuery.mock.calls[1]
    expect(insertCall[1]).toContain('INSERT INTO risks')
    expect(insertCall[2]).toContain('RSK-001')
  })
})

describe('PATCH /api/v1/risks/:id', () => {
  beforeEach(() => vi.clearAllMocks())

  it('updates risk and returns band', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [mockRow({ risk_score: 20, status: 'open' })] })
    const res = await request(app).patch('/api/v1/risks/risk-uuid-1').send({ title: 'Updated title' })
    expect(res.status).toBe(200)
    expect(res.body.risk.band).toBe('critical')
  })

  it('sets closed_at when status changes to closed', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [mockRow({ status: 'closed' })] })
    await request(app).patch('/api/v1/risks/risk-uuid-1').send({ status: 'closed' })
    const [, sql] = mockQuery.mock.calls[0]
    expect(sql).toContain('closed_at = NOW()')
  })

  it('returns 404 when risk not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    const res = await request(app).patch('/api/v1/risks/nonexistent').send({ title: 'x' })
    expect(res.status).toBe(404)
  })

  it('returns 400 when no valid fields provided', async () => {
    const res = await request(app).patch('/api/v1/risks/risk-uuid-1').send({ nonexistent_field: 'x' })
    expect(res.status).toBe(400)
  })
})

describe('DELETE /api/v1/risks/:id', () => {
  beforeEach(() => vi.clearAllMocks())

  it('deletes risk and returns deleted:true', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 })
    const res = await request(app).delete('/api/v1/risks/risk-uuid-1')
    expect(res.status).toBe(200)
    expect(res.body.deleted).toBe(true)
  })
})

describe('GET /api/v1/projects/:projectId/risks/matrix', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 5×5 matrix structure', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ likelihood: 'possible', impact: 'major', count: '3', avg_score: '12.0' }],
    })
    const res = await request(app).get('/api/v1/projects/proj-1/risks/matrix')
    expect(res.status).toBe(200)
    expect(res.body.matrix).toHaveLength(5)           // 5 likelihood levels
    expect(res.body.matrix[0]).toHaveLength(5)        // 5 impact levels
    expect(res.body.likelihood_labels).toHaveLength(5)
    expect(res.body.impact_labels).toHaveLength(5)
  })

  it('correctly populates cell with data from DB', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ likelihood: 'likely', impact: 'catastrophic', count: '2', avg_score: '20.0' }],
    })
    const res = await request(app).get('/api/v1/projects/proj-1/risks/matrix')
    const likelyIdx = res.body.likelihood_labels.indexOf('likely')
    const catIdx    = res.body.impact_labels.indexOf('catastrophic')
    const cell      = res.body.matrix[likelyIdx][catIdx]
    expect(cell.count).toBe(2)
    expect(cell.band).toBe('critical')   // 4×5=20 → critical
  })

  it('computes correct band for each cell', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    const res = await request(app).get('/api/v1/projects/proj-1/risks/matrix')
    // rare × negligible = 1×1 = 1 → low
    const rareNeg = res.body.matrix[0][0]
    expect(rareNeg.score).toBe(1)
    expect(rareNeg.band).toBe('low')
  })
})

describe('GET /api/v1/projects/:projectId/risks/stats', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns stats with band breakdown and top risks', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ open: '5', closed: '2', critical: '1', high: '2', avg_score: '10.5' }] })
      .mockResolvedValueOnce({ rows: [{ low: '1', medium: '1', high: '2', critical: '1' }] })
      .mockResolvedValueOnce({ rows: [mockRow({ risk_score: 20 })] })

    const res = await request(app).get('/api/v1/projects/proj-1/risks/stats')
    expect(res.status).toBe(200)
    expect(res.body.summary.open).toBe('5')
    expect(res.body.by_band.critical).toBe('1')
    expect(res.body.top_risks[0].band).toBe('critical')
  })
})
