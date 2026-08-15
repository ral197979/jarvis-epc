/**
 * NCR / CAPA — analysis + route tests (v4.55.0)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// ADR-014 Phase 2B-2: NCR and CAPA reads require `quality.view`. Phase 1
// grants it to owner, PM, engineer and field ops; the engineer is the
// narrowest role that legitimately raises and reads a non-conformance.
// Authorization re-resolves that role from the database on every request,
// so the pool answers the lookup for the caller under test.
const CALLER = vi.hoisted(() => ({ id: 'caller', tenant_id: 'tenant-1', role: 'engineer', is_active: true }))

const mockQuery = vi.fn()
vi.mock('../db/pool', () => ({
  tenantQuery:       (t: string, sql: string, p: unknown[]) => mockQuery(t, sql, p),
  query:       (sql: string, p: unknown[]) =>
    /FROM\s+users\s+WHERE\s+id/i.test(String(sql))
      ? Promise.resolve({ rows: [CALLER], rowCount: 1 })
      : mockQuery(null, sql, p),
  tenantTransaction: async <T>(_t: string, fn: (c: any) => Promise<T>) => fn({ query: (sql: string, p: unknown[]) => mockQuery(_t, sql, p) }),
}))
vi.mock('../auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.auth = { sub: 'u1', tid: 'tenant-1', role: 'engineer' }
    next()
  },
}))
vi.mock('../middleware/tenant', () => ({ requireTenant: () => (req: any, _res: any, next: any) => { req.tenantId = 'tenant-1'; next() } }))

import { analyzeNcr, buildAutoRaisedNcr, type NcrRow, type CapaRow } from '../services/quality/ncrService'

const NOW = new Date('2026-06-22T12:00:00Z')

describe('analyzeNcr — empty', () => {
  it('reports none raised', () => {
    const s = analyzeNcr([], [], NOW)
    expect(s.totals.ncrs).toBe(0)
    expect(s.headline).toMatch(/no ncrs/i)
  })
})

describe('analyzeNcr — totals & severity', () => {
  it('counts open vs closed and open critical/major', () => {
    const ncrs: NcrRow[] = [
      { severity: 'critical', status: 'open', raised_at: '2026-06-01' },
      { severity: 'major', status: 'investigating', raised_at: '2026-06-10' },
      { severity: 'minor', status: 'closed', raised_at: '2026-05-01', closed_at: '2026-05-11' },
    ]
    const s = analyzeNcr(ncrs, [], NOW)
    expect(s.totals.open).toBe(2)
    expect(s.totals.closed).toBe(1)
    expect(s.totals.openCritical).toBe(1)
    expect(s.totals.openMajor).toBe(1)
    expect(s.aging.avgDaysToClose).toBe(10)
    expect(s.byStatus.investigating).toBe(1)
  })
})

describe('analyzeNcr — overdue CAPAs & verification rate', () => {
  it('counts overdue open corrective actions and the verified rate', () => {
    const capas: CapaRow[] = [
      { status: 'open', due_date: '2026-06-01' },          // overdue
      { status: 'in_progress', due_date: '2026-07-30' },   // not overdue
      { status: 'completed', due_date: '2026-06-01' },     // done → not overdue
      { status: 'verified', due_date: '2026-06-01' },      // verified
    ]
    const s = analyzeNcr([], capas, NOW)
    expect(s.overdueCapas).toBe(1)
    expect(s.capaVerificationRatePct).toBe(25) // 1 of 4
  })
})

describe('analyzeNcr — recurring root causes', () => {
  it('clusters repeated root-cause keywords (>=2)', () => {
    const ncrs: NcrRow[] = [
      { status: 'closed', root_cause: 'Inadequate welding procedure followed' },
      { status: 'closed', root_cause: 'Welding rod incorrect specification' },
      { status: 'open', root_cause: 'Concrete cure time too short' },
    ]
    const s = analyzeNcr(ncrs, [], NOW)
    expect(s.recurringRootCauses.find(r => r.cause === 'welding')?.count).toBe(2)
    expect(s.recurringRootCauses.find(r => r.cause === 'concrete')).toBeFalsy() // only 1
  })
})

describe('buildAutoRaisedNcr', () => {
  it('maps a failed inspection to a major NCR sourced to the inspection', () => {
    const n = buildAutoRaisedNcr({ id: 'insp-uuid-123', inspection_number: 'C-12', title: 'Concrete pour', discipline: 'Structural', location: 'Grid A' })
    expect(n.severity).toBe('major')
    expect(n.source).toBe('inspection')
    expect(n.source_ref).toBe('insp-uuid-123')
    expect(n.title).toContain('Concrete pour')
    expect(n.discipline).toBe('Structural')
  })
})

// ─── Route smoke ──────────────────────────────────────────────────────────────
import express from 'express'
import request from 'supertest'
import { ncrRouter } from '../routes/ncr'

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1', ncrRouter as any)
  return app
}

describe('NCR / CAPA routes', () => {
  beforeEach(() => vi.clearAllMocks())

  it('POST NCR requires a title', async () => {
    const res = await request(makeApp()).post('/api/v1/projects/p1/ncrs').send({ severity: 'major' })
    expect(res.status).toBe(400)
  })

  it('POST NCR auto-numbers and creates', async () => {
    mockQuery.mockImplementation(async (_t: string, sql: string) => {
      if (/MAX\(ncr_number\)/.test(sql)) return { rows: [{ next: 7 }], rowCount: 1 }
      if (/INSERT INTO ncrs/.test(sql)) return { rows: [{ id: 'n1', ncr_number: 7, title: 'Weld defect', severity: 'major', status: 'open' }], rowCount: 1 }
      return { rows: [] }
    })
    const res = await request(makeApp()).post('/api/v1/projects/p1/ncrs').send({ title: 'Weld defect', severity: 'major' })
    expect(res.status).toBe(201)
    expect(res.body.data.ncr_number).toBe(7)
  })

  it('POST CAPA 404s when the NCR does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }) // project lookup in createCorrectiveAction
    const res = await request(makeApp()).post('/api/v1/ncrs/missing/capas').send({ description: 'Re-weld and re-inspect' })
    expect(res.status).toBe(404)
  })

  it('GET ncr-summary returns the analysis', async () => {
    mockQuery.mockImplementation(async (_t: string, sql: string) => {
      if (/FROM projects WHERE/.test(sql)) return { rows: [{ id: 'p1' }], rowCount: 1 }
      if (/FROM ncrs/.test(sql)) return { rows: [{ severity: 'critical', status: 'open', root_cause: null, raised_at: '2026-06-01' }] }
      if (/FROM corrective_actions/.test(sql)) return { rows: [{ status: 'open', due_date: '2026-06-01' }] }
      return { rows: [] }
    })
    const res = await request(makeApp()).get('/api/v1/projects/p1/ncr-summary')
    expect(res.status).toBe(200)
    expect(res.body.data.totals.openCritical).toBe(1)
    expect(res.body.data.overdueCapas).toBe(1)
  })

  it('PATCH capa validates status', async () => {
    const res = await request(makeApp()).patch('/api/v1/capas/c1').send({ status: 'bogus' })
    expect(res.status).toBe(400)
  })

  it('POST auto-raise creates an NCR for a failed inspection without one', async () => {
    mockQuery.mockImplementation(async (_t: string, sql: string) => {
      if (/FROM inspections/.test(sql)) return { rows: [{ id: 'insp1', inspection_number: 'C-1', title: 'Pour', discipline: 'Structural', location: 'A' }] }
      if (/MAX\(ncr_number\)/.test(sql)) return { rows: [{ max: 3 }], rowCount: 1 }
      if (/INSERT INTO ncrs/.test(sql)) return { rows: [{ id: 'n1', ncr_number: 4, title: 'Failed inspection: Pour', severity: 'major', status: 'open', source: 'inspection', source_ref: 'insp1' }], rowCount: 1 }
      return { rows: [] }
    })
    const res = await request(makeApp()).post('/api/v1/projects/p1/ncrs/auto-raise').send({})
    expect(res.status).toBe(201)
    expect(res.body.data.count).toBe(1)
    expect(res.body.data.created[0].source).toBe('inspection')
  })

  it('POST auto-raise is idempotent (200, none created) when there are no new failures', async () => {
    mockQuery.mockImplementation(async (_t: string, sql: string) => {
      if (/FROM inspections/.test(sql)) return { rows: [] }   // all failed inspections already have NCRs
      return { rows: [] }
    })
    const res = await request(makeApp()).post('/api/v1/projects/p1/ncrs/auto-raise').send({})
    expect(res.status).toBe(200)
    expect(res.body.data.count).toBe(0)
  })
})
