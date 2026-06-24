/**
 * Vendor Scorecard — analysis + route tests (v4.59.0)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const mockQuery = vi.fn()
vi.mock('../db/pool', () => ({
  tenantQuery: (t: string, sql: string, p: unknown[]) => mockQuery(t, sql, p),
  query:       (sql: string, p: unknown[]) => mockQuery(null, sql, p),
}))
vi.mock('../auth', () => ({ requireAuth: (req: any, _res: any, next: any) => { req.auth = { sub: 'u1' }; next() } }))
vi.mock('../middleware/tenant', () => ({ requireTenant: () => (req: any, _res: any, next: any) => { req.tenantId = 'tenant-1'; next() } }))

import { analyzeVendorScorecard, type SubRow, type PoRow, type InvRow } from '../services/procurement/vendorScorecardService'

const NOW = new Date('2026-06-22T12:00:00Z')

describe('analyzeVendorScorecard — empty', () => {
  it('reports no vendors', () => {
    const r = analyzeVendorScorecard([], [], [], NOW)
    expect(r.summary.vendors).toBe(0)
    expect(r.headline).toMatch(/no vendors/i)
  })
})

describe('analyzeVendorScorecard — scoring', () => {
  it('aggregates commitments + billing + delivery and ranks weakest first', () => {
    const subs: SubRow[] = [
      { id: 'sc1', vendor_id: 'vA', vendor_name: 'ACME', status: 'active', contract_value: 500_000 },
      { id: 'sc2', vendor_id: 'vB', vendor_name: 'Beta', status: 'active', contract_value: 200_000 },
    ]
    const pos: PoRow[] = [
      // ACME: 1 on-time delivered, 1 open overdue (at risk)
      { vendor_id: 'vA', status: 'delivered', total_amount: 50_000, required_date: '2026-05-01', delivery_date: '2026-04-28' },
      { vendor_id: 'vA', status: 'issued', total_amount: 80_000, required_date: '2026-06-01', delivery_date: null },
      // Beta: 1 late delivered
      { vendor_id: 'vB', status: 'delivered', total_amount: 30_000, required_date: '2026-05-01', delivery_date: '2026-05-20' },
    ]
    const invs: InvRow[] = [{ subcontract_id: 'sc1', gross_amount: 100_000, status: 'approved' }]

    const r = analyzeVendorScorecard(subs, pos, invs, NOW)
    const acme = r.vendors.find(v => v.vendorId === 'vA')!
    const beta = r.vendors.find(v => v.vendorId === 'vB')!
    expect(acme.committedValue).toBe(500_000)
    expect(acme.billedValue).toBe(100_000)
    expect(acme.pctBilled).toBe(20)
    expect(acme.poOnTimeRatePct).toBe(100)    // 1 delivered, 0 late
    expect(acme.atRiskOpenPos).toBe(1)         // the overdue open PO
    expect(beta.poOnTimeRatePct).toBe(0)       // 1 delivered, 1 late
    expect(beta.standing).toBe('weak')         // 0% on-time
    // weakest first
    expect(r.vendors[0].vendorId).toBe('vB')
  })
})

// ─── Route smoke ──────────────────────────────────────────────────────────────
import express from 'express'
import request from 'supertest'
import { vendorScorecardRouter } from '../routes/vendorScorecard'

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1', vendorScorecardRouter as any)
  return app
}

describe('Vendor scorecard route', () => {
  beforeEach(() => vi.clearAllMocks())

  it('GET /projects/:id/vendor-scorecard returns the scorecard', async () => {
    mockQuery.mockImplementation(async (_t: string, sql: string) => {
      if (/FROM projects WHERE/.test(sql)) return { rows: [{ id: 'p1' }], rowCount: 1 }
      if (/FROM subcontracts/.test(sql)) return { rows: [{ id: 'sc1', vendor_id: 'vA', vendor_name: 'ACME', status: 'active', contract_value: 500_000 }] }
      if (/FROM purchase_orders/.test(sql)) return { rows: [{ vendor_id: 'vA', vendor_name: 'ACME', status: 'delivered', total_amount: 50_000, required_date: '2026-05-01', delivery_date: '2026-04-28' }] }
      if (/FROM subcontract_invoices/.test(sql)) return { rows: [{ subcontract_id: 'sc1', gross_amount: 100_000, status: 'approved' }] }
      return { rows: [] }
    })
    const res = await request(makeApp()).get('/api/v1/projects/p1/vendor-scorecard')
    expect(res.status).toBe(200)
    expect(res.body.data.vendors[0].vendor).toBe('ACME')
    expect(res.body.data.vendors[0].committedValue).toBe(500_000)
  })

  it('404s for an unknown project', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 })
    const res = await request(makeApp()).get('/api/v1/projects/nope/vendor-scorecard')
    expect(res.status).toBe(404)
  })
})
