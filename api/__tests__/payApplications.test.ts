/**
 * Pay Applications (AIA G702/G703) — computation + route tests (v4.45.0)
 *
 * The billing math (`computeBilling`) is pure — exhaustively unit-tested for
 * correctness against hand-computed AIA figures. Route smoke covers the computed
 * view, edit-locking, and validation.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// ADR-014 Phase 2B-1: The SOV and pay-application reads disclose billing values, so they require `cost.view` — a capability Phase 1 grants to the tenant owner alone.
// Authorization re-resolves that role from the database on every request,
// so the pool answers the lookup for the caller under test.
const CALLER = vi.hoisted(() => ({ id: 'caller', tenant_id: 'tenant-1', role: 'owner', is_active: true }))

const mockQuery = vi.fn()

/**
 * ADR-014 Phase 3D — the record-scope layer asks two questions before a handler
 * runs: which project owns this record, and may the caller reach it. Both are
 * answered here rather than through the scripted mock, for the same reason the
 * current-user lookup already is: an authorization query must not consume a
 * `mockResolvedValueOnce` entry written for the handler's own queries.
 */
const _recordScopeAnswer = (sql: unknown, params: unknown): { rows: unknown[]; rowCount: number } | null => {
  const s = String(sql)
  if (/AS\s+project_id/i.test(s)) return { rows: [{ project_id: '30000000-0000-4000-8000-000000000001' }], rowCount: 1 }
  if (/FROM\s+projects\s+p?\b/i.test(s) && /ANY\(\$\d+::uuid\[\]\)/i.test(s)) {
    // Echo back the ids the resolver asked about, so the fixture's own
    // project is the one reported reachable.
    const ids = ((params as unknown[])?.find(x => Array.isArray(x)) as string[] | undefined) ?? []
    return { rows: ids.map(id => ({ id })), rowCount: ids.length }
  }
  return null
}

vi.mock('../db/pool', () => ({
  tenantQuery:       (...__a: unknown[]) => _recordScopeAnswer(__a[1], __a[2]) ?? (((t: string, sql: string, p: unknown[]) => mockQuery(t, sql, p)) as (...z: unknown[]) => unknown)(...__a),
  query:             (sql: string, p: unknown[]) =>
    /FROM\s+users\s+WHERE\s+id/i.test(String(sql))
      ? Promise.resolve({ rows: [CALLER], rowCount: 1 })
      : mockQuery(null, sql, p),
  tenantTransaction: async <T>(_t: string, fn: (c: any) => Promise<T>) => fn({ query: (sql: string, p: unknown[]) => mockQuery(_t, sql, p) }),
}))
vi.mock('../auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.auth = { sub: 'user-1', tid: 'tenant-1', role: 'owner' }
    next()
  },
}))
vi.mock('../middleware/tenant', () => ({ requireTenant: () => (req: any, _res: any, next: any) => { req.tenantId = 'tenant-1'; next() } }))

import { computeBilling, type SovItemRow, type LineAmountRow, type PriorEntry } from '../services/costControl/payApplicationService'

function prior(map: Record<string, number>): Map<string, PriorEntry> {
  return new Map(Object.entries(map).map(([k, v]) => [k, { previousCompleted: v }]))
}

describe('computeBilling — single line, first period', () => {
  it('computes retainage and current payment due (AIA hand-check)', () => {
    const sov: SovItemRow[] = [{ id: 's1', item_no: '1', description: 'Concrete', scheduled_value: 100000 }]
    const lines: LineAmountRow[] = [{ sov_item_id: 's1', work_completed: 50000, materials_stored: 0 }]
    const c = computeBilling(sov, lines, prior({}), 10)
    const l = c.lines[0]
    expect(l.completedAndStored).toBe(50000)
    expect(l.pctComplete).toBe(50)
    expect(l.retainage).toBe(5000)
    expect(l.balanceToFinish).toBe(50000)
    expect(c.summary.totalEarnedLessRetainage).toBe(45000)
    expect(c.summary.lessPreviousCertificates).toBe(0)
    expect(c.summary.currentPaymentDue).toBe(45000)
    expect(c.summary.balanceToFinishPlusRetainage).toBe(55000)
  })
})

describe('computeBilling — with prior completed', () => {
  it('nets out previous certificates so payment due equals this period less retention', () => {
    const sov: SovItemRow[] = [{ id: 's1', item_no: '1', description: 'Steel', scheduled_value: 200000 }]
    const lines: LineAmountRow[] = [{ sov_item_id: 's1', work_completed: 30000, materials_stored: 0 }]
    const c = computeBilling(sov, lines, prior({ s1: 40000 }), 10)
    const l = c.lines[0]
    expect(l.fromPrevious).toBe(40000)
    expect(l.completedAndStored).toBe(70000)        // 40k prior + 30k this
    expect(l.retainage).toBe(7000)                   // 10% of 70k
    expect(c.summary.totalEarnedLessRetainage).toBe(63000)
    expect(c.summary.lessPreviousCertificates).toBe(36000)  // 40k - 10%
    expect(c.summary.currentPaymentDue).toBe(27000)         // = 30k this period less 10%
  })
})

describe('computeBilling — materials stored', () => {
  it('counts stored materials in completed-and-stored and payment due', () => {
    const sov: SovItemRow[] = [{ id: 's1', item_no: '1', description: 'Switchgear', scheduled_value: 500000 }]
    const lines: LineAmountRow[] = [{ sov_item_id: 's1', work_completed: 20000, materials_stored: 10000 }]
    const c = computeBilling(sov, lines, prior({}), 10)
    expect(c.lines[0].completedAndStored).toBe(30000)
    expect(c.summary.currentPaymentDue).toBe(27000)  // (20k+10k) less 10%
  })
})

describe('computeBilling — multi-line summary & zero scheduled value', () => {
  it('aggregates across lines and never divides by zero', () => {
    const sov: SovItemRow[] = [
      { id: 's1', item_no: '1', description: 'A', scheduled_value: 100000 },
      { id: 's2', item_no: '2', description: 'B', scheduled_value: 0 },        // zero-value line
      { id: 's3', item_no: '3', description: 'C', scheduled_value: 50000 },
    ]
    const lines: LineAmountRow[] = [
      { sov_item_id: 's1', work_completed: 100000 },
      { sov_item_id: 's3', work_completed: 25000 },
    ]
    const c = computeBilling(sov, lines, prior({}), 5)
    expect(c.summary.originalContractSum).toBe(150000)
    expect(c.summary.totalCompletedAndStored).toBe(125000)
    expect(c.summary.totalRetainage).toBe(6250)              // 5% of 125k
    expect(c.summary.currentPaymentDue).toBe(118750)
    expect(c.lines.find(l => l.sovItemId === 's2')!.pctComplete).toBe(0)   // no NaN
    expect(c.lines.find(l => l.sovItemId === 's1')!.pctComplete).toBe(100)
  })
})

describe('computeBilling — zero retention', () => {
  it('pays the full earned amount', () => {
    const sov: SovItemRow[] = [{ id: 's1', item_no: '1', description: 'X', scheduled_value: 10000 }]
    const c = computeBilling(sov, [{ sov_item_id: 's1', work_completed: 4000 }], prior({}), 0)
    expect(c.summary.totalRetainage).toBe(0)
    expect(c.summary.currentPaymentDue).toBe(4000)
  })
})

// ─── Route smoke ──────────────────────────────────────────────────────────────
import express from 'express'
import request from 'supertest'
import { payApplicationsRouter } from '../routes/payApplications'

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1', payApplicationsRouter as any)
  return app
}

describe('Pay application routes', () => {
  beforeEach(() => vi.clearAllMocks())

  it('GET /pay-applications/:id returns the computed G702/G703 view', async () => {
    mockQuery.mockImplementation(async (_t: string, sql: string) => {
      if (/FROM pay_applications WHERE tenant_id=\$1 AND id=\$2/.test(sql)) {
        return { rows: [{ id: 'pa1', project_id: 'p1', application_number: 2, status: 'draft', retention_pct: 10 }], rowCount: 1 }
      }
      if (/FROM sov_items/.test(sql)) return { rows: [{ id: 's1', item_no: '1', description: 'Concrete', scheduled_value: 100000 }] }
      if (/SUM\(l\.work_completed/.test(sql)) return { rows: [{ sov_item_id: 's1', previous_completed: 40000 }] }   // prior
      if (/FROM pay_application_lines/.test(sql)) return { rows: [{ sov_item_id: 's1', work_completed: 30000, materials_stored: 0 }] }  // this app
      return { rows: [] }
    })
    const res = await request(makeApp()).get('/api/v1/pay-applications/4361b644-1337-47c5-80da-cde691017e3e')
    expect(res.status).toBe(200)
    expect(res.body.data.summary.currentPaymentDue).toBe(27000)
    expect(res.body.data.lines[0].completedAndStored).toBe(70000)
  })

  it('GET /pay-applications/:id 404s for an unknown id', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 })
    const res = await request(makeApp()).get('/api/v1/pay-applications/nope')
    expect(res.status).toBe(404)
  })

  it('PATCH /pay-applications/:id/lines is blocked once approved', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ status: 'approved' }], rowCount: 1 })
    const res = await request(makeApp())
      .patch('/api/v1/pay-applications/4361b644-1337-47c5-80da-cde691017e3e/lines')
      .send({ lines: [{ sov_item_id: 's1', work_completed: 100 }] })
    expect(res.status).toBe(409)
  })

  it('POST /projects/:id/sov-items validates required fields', async () => {
    const res = await request(makeApp())
      .post('/api/v1/projects/30000000-0000-4000-8000-000000000001/sov-items')
      .send({ description: 'no item_no' })
    expect(res.status).toBe(400)
  })

  it('POST /projects/:id/pay-applications creates a draft', async () => {
    mockQuery.mockImplementation(async (_t: string, sql: string) => {
      if (/MAX\(application_number\)/.test(sql)) return { rows: [{ next: 1 }], rowCount: 1 }
      if (/INSERT INTO pay_applications/.test(sql)) return { rows: [{ id: 'pa-new', application_number: 1, status: 'draft', retention_pct: 10 }], rowCount: 1 }
      return { rows: [] }
    })
    const res = await request(makeApp())
      .post('/api/v1/projects/30000000-0000-4000-8000-000000000001/pay-applications')
      .send({ retention_pct: 10 })
    expect(res.status).toBe(201)
    expect(res.body.data.application_number).toBe(1)
  })
})
