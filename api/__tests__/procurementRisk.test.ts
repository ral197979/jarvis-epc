/**
 * Procurement Risk Engine — analysis + route tests (v4.52.0)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// ADR-014 Phase 2B-2: Procurement-risk reads require `procurement.view` —
// procurement is the narrowest holder.
// Authorization re-resolves that role from the database on every request,
// so the pool answers the lookup for the caller under test.
const CALLER = vi.hoisted(() => ({ id: 'caller', tenant_id: 'tenant-1', role: 'procurement', is_active: true }))

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
    req.auth = { sub: 'u1', tid: 'tenant-1', role: 'procurement' }
    next()
  },
}))
vi.mock('../middleware/tenant', () => ({ requireTenant: () => (req: any, _res: any, next: any) => { req.tenantId = 'tenant-1'; next() } }))

import { analyzeProcurementRisk, type PoRow } from '../services/procurement/procurementRiskService'

const NOW = new Date('2026-06-22T12:00:00Z')

describe('analyzeProcurementRisk — empty / on-track', () => {
  it('reports no risk when POs are delivered or far out', () => {
    const pos: PoRow[] = [
      { id: 'a', po_number: '1', status: 'delivered', required_date: '2026-06-01', total_amount: 1000 },
      { id: 'b', po_number: '2', status: 'issued', required_date: '2027-01-01', total_amount: 1000, delivery_date: '2026-12-01' },
    ]
    const r = analyzeProcurementRisk(pos, NOW)
    expect(r.summary.openPOs).toBe(1)   // delivered excluded
    expect(r.items).toHaveLength(0)
    expect(r.headline).toMatch(/tracking to their need dates/i)
  })
})

describe('analyzeProcurementRisk — overdue & not issued', () => {
  it('flags an overdue, not-issued PO as critical with amount at risk', () => {
    const pos: PoRow[] = [
      { id: 'sw', po_number: 'PO-9', title: 'Switchgear', vendor_name: 'ACME', status: 'approved', required_date: '2026-05-01', total_amount: 500000, received_amount: 0 },
    ]
    const r = analyzeProcurementRisk(pos, NOW)
    const it = r.items[0]
    expect(it.riskType).toBe('overdue')
    expect(it.severity).toBe('critical')
    expect(it.amountAtRisk).toBe(500000)
    expect(it.reason).toMatch(/not yet issued/i)
    expect(it.recommendedAction).toMatch(/issue the po/i)
  })
})

describe('analyzeProcurementRisk — arriving late', () => {
  it('flags a PO whose promised delivery is after the need date', () => {
    const pos: PoRow[] = [
      { id: 'p', po_number: 'PO-3', title: 'Pumps', vendor_name: 'PumpCo', status: 'issued', required_date: '2026-07-01', delivery_date: '2026-08-01', total_amount: 80000, received_amount: 0 },
    ]
    const r = analyzeProcurementRisk(pos, NOW)
    const it = r.items[0]
    expect(['arriving_late', 'need_approaching']).toContain(it.riskType)
    expect(it.reason).toMatch(/after the need date/i)
  })
})

describe('analyzeProcurementRisk — vendor rollup', () => {
  it('aggregates at-risk value by vendor, worst first', () => {
    const pos: PoRow[] = [
      { id: 'a', po_number: '1', vendor_name: 'ACME', status: 'approved', required_date: '2026-05-01', total_amount: 300000, received_amount: 0 },
      { id: 'b', po_number: '2', vendor_name: 'ACME', status: 'approved', required_date: '2026-05-10', total_amount: 200000, received_amount: 0 },
      { id: 'c', po_number: '3', vendor_name: 'SmallCo', status: 'approved', required_date: '2026-05-01', total_amount: 50000, received_amount: 0 },
    ]
    const r = analyzeProcurementRisk(pos, NOW)
    expect(r.vendorRisk[0].vendor).toBe('ACME')
    expect(r.vendorRisk[0].atRiskPOs).toBe(2)
    expect(r.vendorRisk[0].amountAtRisk).toBe(500000)
  })
})

// ─── Route smoke ──────────────────────────────────────────────────────────────
import express from 'express'
import request from 'supertest'
import { procurementRiskRouter } from '../routes/procurementRisk'

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1', procurementRiskRouter as any)
  return app
}

describe('Procurement risk route', () => {
  beforeEach(() => vi.clearAllMocks())

  it('GET /projects/:id/procurement-risk returns risk + vendor rollup', async () => {
    mockQuery.mockImplementation(async (_t: string, sql: string) => {
      if (/FROM projects WHERE/.test(sql)) return { rows: [{ id: 'p1' }], rowCount: 1 }
      if (/FROM purchase_orders/.test(sql)) return { rows: [{ id: 'sw', po_number: 'PO-9', title: 'Switchgear', vendor_name: 'ACME', status: 'approved', required_date: '2026-05-01', total_amount: 500000, received_amount: 0 }] }
      return { rows: [] }
    })
    const res = await request(makeApp()).get('/api/v1/projects/p1/procurement-risk')
    expect(res.status).toBe(200)
    expect(res.body.data.items[0].severity).toBe('critical')
    expect(res.body.data.vendorRisk[0].vendor).toBe('ACME')
  })

  it('404s for an unknown project', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 })
    const res = await request(makeApp()).get('/api/v1/projects/nope/procurement-risk')
    expect(res.status).toBe(404)
  })
})
