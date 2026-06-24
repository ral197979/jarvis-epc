/**
 * Commitment Rollup — analysis + route tests (v4.57.0)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const mockQuery = vi.fn()
vi.mock('../db/pool', () => ({
  tenantQuery: (t: string, sql: string, p: unknown[]) => mockQuery(t, sql, p),
  query:       (sql: string, p: unknown[]) => mockQuery(null, sql, p),
}))
vi.mock('../auth', () => ({ requireAuth: (req: any, _res: any, next: any) => { req.auth = { sub: 'u1' }; next() } }))
vi.mock('../middleware/tenant', () => ({ requireTenant: () => (req: any, _res: any, next: any) => { req.tenantId = 'tenant-1'; next() } }))

import { analyzeCommitments, type SubcontractRow, type ScInvoiceRow } from '../services/costControl/commitmentRollupService'

describe('analyzeCommitments — empty', () => {
  it('reports no commitments', () => {
    const r = analyzeCommitments([], [])
    expect(r.totals.committed).toBe(0)
    expect(r.headline).toMatch(/no subcontracts/i)
  })
})

describe('analyzeCommitments — billed & retention', () => {
  it('sums approved invoices, holds retention, and excludes terminated from committed', () => {
    const subs: SubcontractRow[] = [
      { id: 's1', sc_number: 1, title: 'Electrical', vendor_name: 'ACME', status: 'active', contract_value: 500_000, retention_pct: 10 },
      { id: 's2', sc_number: 2, title: 'Mechanical', vendor_name: 'Beta', status: 'active', contract_value: 300_000, retention_pct: 5 },
      { id: 's3', sc_number: 3, title: 'Cancelled', vendor_name: 'Gone', status: 'terminated', contract_value: 100_000, retention_pct: 10 },
    ]
    const invs: ScInvoiceRow[] = [
      { subcontract_id: 's1', gross_amount: 200_000, net_amount: 180_000, status: 'approved' }, // 20k retention
      { subcontract_id: 's1', gross_amount: 50_000, net_amount: 45_000, status: 'submitted' },   // not approved → excluded
      { subcontract_id: 's2', gross_amount: 100_000, net_amount: 95_000, status: 'approved' },    // 5k retention
    ]
    const r = analyzeCommitments(subs, invs)
    expect(r.totals.committed).toBe(800_000)         // excludes terminated s3
    expect(r.totals.activeSubcontracts).toBe(2)
    expect(r.totals.billed).toBe(300_000)            // 200k + 100k approved only
    expect(r.totals.retentionHeld).toBe(25_000)      // (200k-180k) + (100k-95k)
    expect(r.totals.remainingToBill).toBe(500_000)   // 800k - 300k
    const s1 = r.lines.find(l => l.id === 's1')!
    expect(s1.billed).toBe(200_000)
    expect(s1.pctBilled).toBe(40)
  })
})

// ─── Route smoke ──────────────────────────────────────────────────────────────
import express from 'express'
import request from 'supertest'
import { commitmentsRouter } from '../routes/commitments'

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1', commitmentsRouter as any)
  return app
}

describe('Commitments route', () => {
  beforeEach(() => vi.clearAllMocks())

  it('GET /projects/:id/commitments returns the rollup', async () => {
    mockQuery.mockImplementation(async (_t: string, sql: string) => {
      if (/FROM projects WHERE/.test(sql)) return { rows: [{ id: 'p1' }], rowCount: 1 }
      if (/FROM subcontracts/.test(sql)) return { rows: [{ id: 's1', sc_number: 1, title: 'Electrical', status: 'active', contract_value: 500_000, retention_pct: 10, vendor_name: 'ACME' }] }
      if (/FROM subcontract_invoices/.test(sql)) return { rows: [{ subcontract_id: 's1', gross_amount: 100_000, net_amount: 90_000, status: 'approved' }] }
      return { rows: [] }
    })
    const res = await request(makeApp()).get('/api/v1/projects/p1/commitments')
    expect(res.status).toBe(200)
    expect(res.body.data.totals.committed).toBe(500_000)
    expect(res.body.data.totals.billed).toBe(100_000)
  })

  it('returns an empty rollup when there are no subcontracts', async () => {
    mockQuery.mockImplementation(async (_t: string, sql: string) => {
      if (/FROM projects WHERE/.test(sql)) return { rows: [{ id: 'p1' }], rowCount: 1 }
      return { rows: [] }
    })
    const res = await request(makeApp()).get('/api/v1/projects/p1/commitments')
    expect(res.status).toBe(200)
    expect(res.body.data.totals.subcontracts).toBe(0)
  })

  it('404s for an unknown project', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 })
    const res = await request(makeApp()).get('/api/v1/projects/nope/commitments')
    expect(res.status).toBe(404)
  })
})
