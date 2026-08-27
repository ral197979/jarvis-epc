/**
 * Commitment Rollup — analysis + route tests (v4.57.0)
 */
// ADR-014 Phase 3F: the collection routes below now carry `requireProjectScope`,
// which refuses a malformed project id WITHOUT issuing SQL (fail closed). These
// ids are real uuids so the request still reaches the handler and this stays a
// response-shape smoke test; `nope` became a uuid that simply does not exist.
import { describe, it, expect, beforeEach, vi } from 'vitest'

// ADR-014 Phase 2B-1: GET /projects/:id/commitments discloses subcontract commitment values, so it requires `cost.view` — a capability Phase 1 grants to the tenant owner alone.
// Authorization re-resolves that role from the database on every request,
// so the pool answers the lookup for the caller under test.
const CALLER = vi.hoisted(() => ({ id: 'caller', tenant_id: 'tenant-1', role: 'owner', is_active: true }))

const mockQuery = vi.fn()
/**
 * ADR-014 Phase 3F — `requireProjectScope` asks whether the caller can reach
 * the project named in the path before the handler runs. Answered here rather
 * than through the scripted mock, for the same reason the current-user lookup
 * already is: an authorization query must not consume a `mockResolvedValueOnce`
 * entry written for the handler's own queries. Whether the guard REFUSES is
 * proved in the Phase-3F behavioural suite, not in this shape smoke test.
 */
const _projectScopeAnswer = (sql: unknown, params: unknown): { rows: unknown[]; rowCount: number } | null => {
  const s = String(sql)
  if (/AS\s+project_id/i.test(s)) return { rows: [{ project_id: '30000000-0000-4000-8000-000000000001' }], rowCount: 1 }
  if (/FROM\s+projects\s+p?\b/i.test(s) && /ANY\(\$\d+::uuid\[\]\)/i.test(s)) {
    // Echo the ids the resolver asked about, so the fixture's own project is
    // the one reported reachable.
    const ids = ((params as unknown[])?.find(x => Array.isArray(x)) as string[] | undefined) ?? []
    return { rows: ids.map(id => ({ id })), rowCount: ids.length }
  }
  return null
}

vi.mock('../db/pool', () => ({
  tenantQuery: (t: string, sql: string, p: unknown[]) => _projectScopeAnswer(sql, p) ?? mockQuery(t, sql, p),
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
    const res = await request(makeApp()).get('/api/v1/projects/30000000-0000-4000-8000-000000000001/commitments')
    expect(res.status).toBe(200)
    expect(res.body.data.totals.committed).toBe(500_000)
    expect(res.body.data.totals.billed).toBe(100_000)
  })

  it('returns an empty rollup when there are no subcontracts', async () => {
    mockQuery.mockImplementation(async (_t: string, sql: string) => {
      if (/FROM projects WHERE/.test(sql)) return { rows: [{ id: 'p1' }], rowCount: 1 }
      return { rows: [] }
    })
    const res = await request(makeApp()).get('/api/v1/projects/30000000-0000-4000-8000-000000000001/commitments')
    expect(res.status).toBe(200)
    expect(res.body.data.totals.subcontracts).toBe(0)
  })

  it('404s for an unknown project', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 })
    const res = await request(makeApp()).get('/api/v1/projects/30000000-0000-4000-8000-0000000000ff/commitments')
    expect(res.status).toBe(404)
  })
})
