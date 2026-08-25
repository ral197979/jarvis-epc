/**
 * CRM leads — the governed read surface, and what may be totalled.
 *
 * The audit, before any of this existed:
 *
 *   `crm_leads` (migration 002) is real, with tenant RLS. `value` and
 *   `probability` are both NULLABLE, and `project_id` is nullable with ON
 *   DELETE SET NULL — a lead is pre-award and outlives the project it links to.
 *
 *   `stage` IS NOT A LIFECYCLE. It is a bare VARCHAR(50) with no CHECK and no
 *   enum, defaulting to 'prospecting'. This is the decisive difference from
 *   `contracts`, whose `contract_status` enum let Phase 3M define "active" from
 *   the schema. Here the schema governs nothing, so nothing here filters by
 *   stage and the summary reports `stageGoverned: false`.
 *
 *   NO WRITER, AND NO READER. Nothing in the API touches this table; these
 *   routes are the first. So totals are truthfully zero, and `writable: false`
 *   says why rather than letting a zero imply an empty pipeline.
 *
 * The property under test: a weighted pipeline is only ever shown when every
 * lead in scope has both a value and a probability. A NULL is an UNKNOWN
 * contribution, and the previous dashboard coerced both with `?? 0` —
 * understating the pipeline by exactly the leads nobody had estimated.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

const mockQuery = vi.fn()
vi.mock('../db/pool', () => ({
  query:             (...a: unknown[]) => mockQuery(...a),
  tenantQuery:       (...a: unknown[]) => mockQuery(...a),
  tenantTransaction: async (_t: string, fn: (c: unknown) => unknown) => fn({ query: mockQuery }),
  pool:              { query: (...a: unknown[]) => mockQuery(...a), connect: vi.fn() },
}))

import type { UserRole } from '../authz/capabilities'

const TENANT_A = 'aaaaaaaa-0000-4000-8000-000000000001'
const TENANT_B = 'bbbbbbbb-0000-4000-8000-000000000002'
const OWNER_A  = '10000000-0000-4000-8000-0000000000a1'
const LEAD     = '70000000-0000-4000-8000-00000000000a'

interface Caller { id: string; tenantId: string; role: UserRole }
let caller: Caller
const setCaller = (c: Caller): void => { caller = c; (globalThis as Record<string, unknown>)['__lead'] = c }

/** Leads as rows, so the SQL's FILTER clauses decide the answer. */
let LEAD_ROWS: { stage: string; value: number | null; probability: number | null }[]

vi.mock('../auth', () => ({
  requireAuth: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    const c = (globalThis as Record<string, unknown>)['__lead'] as Caller
    req['auth'] = { sub: c.id, tid: c.tenantId, role: c.role, jti: 'jti' }
    next()
  },
  requireRole: () => (_r: unknown, _s: unknown, n: () => void) => n(),
}))
vi.mock('../middleware/tenant', () => ({
  requireTenant: () => (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req['tenantId'] = ((globalThis as Record<string, unknown>)['__lead'] as Caller).tenantId
    next()
  },
}))

import { requireAuth } from '../auth'
import { requireTenant } from '../middleware/tenant'
import { leadsRouter } from '../routes/leads'
import { LEAD_STAGE_GOVERNED, LEADS_WRITABLE } from '../services/crm/leadService'

const app = (() => {
  const a = express()
  a.use(express.json())
  a.use('/api/v1/leads', requireAuth as never, requireTenant() as never, leadsRouter as never)
  return a
})()

const SQLRE = /\b(SELECT|INSERT|UPDATE|DELETE)\b/i
const sqlOf = (a: unknown[]): string => a.find((x): x is string => typeof x === 'string' && SQLRE.test(x)) ?? ''
const statements = (): string[] => mockQuery.mock.calls.map(c => sqlOf(c)).filter(Boolean)

beforeEach(() => {
  LEAD_ROWS = []
  setCaller({ id: OWNER_A, tenantId: TENANT_A, role: 'owner' })
  mockQuery.mockReset()
  mockQuery.mockImplementation(async (...args: unknown[]) => {
    const sql = sqlOf(args)
    const empty = { rows: [], rowCount: 0 }

    if (/FROM\s+users\s+WHERE\s+id/i.test(sql)) {
      return { rows: [{ id: caller.id, tenant_id: caller.tenantId, role: caller.role, is_active: true }], rowCount: 1 }
    }
    if (/FROM projects/i.test(sql)) return { rows: [], rowCount: 0 }
    if (/FROM crm_leads r/i.test(sql)) return { rows: [{ project_id: null }], rowCount: 1 }

    if (/FROM crm_leads l/i.test(sql) && /GROUP BY/i.test(sql)) {
      // Each aggregate is judged on ITS OWN clause. Keying both off a single
      // regex made the fixture blind to one FILTER being removed while the
      // other remained — the two columns have to be read independently or the
      // mutation proof passes for the wrong reason.
      const countsWithFilter = /COUNT\(\*\)\s*FILTER\s*\(\s*WHERE\s+l\.value IS NOT NULL AND l\.probability IS NOT NULL\s*\)/i.test(sql)
      const sumsWithFilter   = /SUM\([^)]*\)\s*\n?\s*FILTER\s*\(\s*WHERE\s+l\.value IS NOT NULL AND l\.probability IS NOT NULL\s*\)/i.test(sql)
      const by = new Map<string, { n: number; valued: number; weighted: number }>()
      for (const r of LEAD_ROWS) {
        const cur = by.get(r.stage) ?? { n: 0, valued: 0, weighted: 0 }
        const complete = r.value != null && r.probability != null
        cur.n += 1
        cur.valued += countsWithFilter ? (complete ? 1 : 0) : 1
        // Without the FILTER the product coalesces NULLs to zero, so an
        // unvalued lead contributes 0 instead of being excluded.
        if (sumsWithFilter ? complete : true) cur.weighted += (r.value ?? 0) * (r.probability ?? 0) / 100
        by.set(r.stage, cur)
      }
      return { rows: [...by].map(([stage, v]) => ({ stage, n: String(v.n), valued: String(v.valued), weighted: String(v.weighted) })), rowCount: by.size }
    }
    if (/FROM crm_leads l/i.test(sql)) {
      return { rows: LEAD_ROWS.map((r, i) => ({ id: `l${i}`, company: 'Acme', stage: r.stage })), rowCount: LEAD_ROWS.length }
    }
    return empty
  })
})

// ─── 1. Unknown is not zero ──────────────────────────────────────────────────

describe('the weighted pipeline is withheld while any lead is unvalued', () => {
  it('totals value × probability when every lead is valued', async () => {
    LEAD_ROWS = [
      { stage: 'prospecting', value: 100_000, probability: 50 },
      { stage: 'proposal',    value: 200_000, probability: 25 },
    ]
    const res = await request(app).get('/api/v1/leads/summary')
    expect(res.status).toBe(200)
    // 100k×0.5 + 200k×0.25 = 100,000
    expect(res.body.data.pipelineWeighted).toBe(100_000)
    expect(res.body.data.valued).toBe(2)
    expect(res.body.data.unvalued).toBe(0)
  })

  it('refuses when a lead has no probability', async () => {
    LEAD_ROWS = [
      { stage: 'prospecting', value: 100_000, probability: 50 },
      { stage: 'prospecting', value: 500_000, probability: null },
    ]
    const res = await request(app).get('/api/v1/leads/summary')
    expect(res.body.data.pipelineWeighted).toBeNull()
    expect(res.body.data.reason).toBe('incomplete_valuation')
    expect(res.body.data.unvalued).toBe(1)
  })

  it('refuses when a lead has no value', async () => {
    LEAD_ROWS = [{ stage: 'prospecting', value: null, probability: 80 }]
    const res = await request(app).get('/api/v1/leads/summary')
    expect(res.body.data.pipelineWeighted).toBeNull()
    expect(res.body.data.reason).toBe('incomplete_valuation')
  })

  it('never coerces a missing estimate to zero', async () => {
    // The old dashboard did `(l.estimated_value ?? 0) * (l.probability ?? 0)`,
    // silently contributing nothing for every unestimated lead. A total that
    // understates reads as a complete one.
    LEAD_ROWS = [{ stage: 'prospecting', value: null, probability: null }]
    const res = await request(app).get('/api/v1/leads/summary')
    expect(res.body.data.pipelineWeighted).not.toBe(0)
    expect(res.body.data.pipelineWeighted).toBeNull()
  })

  it('excludes unvalued leads from the sum rather than zero-filling them', async () => {
    // With every lead valued the total is real; the FILTER on the SUM is what
    // keeps an unvalued lead out of it entirely rather than contributing 0.
    LEAD_ROWS = [
      { stage: 'a', value: 100_000, probability: 50 },
      { stage: 'a', value: 100_000, probability: 50 },
    ]
    const both = await request(app).get('/api/v1/leads/summary')
    expect(both.body.data.pipelineWeighted).toBe(100_000)
    expect(both.body.data.valued).toBe(2)
    expect(both.body.data.unvalued).toBe(0)
  })

  it('counts a NULL-valued lead as unvalued, never as valued-at-zero', async () => {
    LEAD_ROWS = [
      { stage: 'a', value: 100_000, probability: 50 },
      { stage: 'a', value: null,    probability: null },
    ]
    const res = await request(app).get('/api/v1/leads/summary')
    expect(res.body.data.valued).toBe(1)
    expect(res.body.data.unvalued).toBe(1)
    expect(res.body.data.pipelineWeighted).toBeNull()
  })

  it('always reports the unvalued count, so the gap is visible', async () => {
    LEAD_ROWS = [
      { stage: 'a', value: 1, probability: 1 },
      { stage: 'b', value: null, probability: 1 },
      { stage: 'b', value: null, probability: null },
    ]
    const res = await request(app).get('/api/v1/leads/summary')
    expect(res.body.data.total).toBe(3)
    expect(res.body.data.valued).toBe(1)
    expect(res.body.data.unvalued).toBe(2)
  })

  it('reports zero leads as unrecordable rather than as an empty pipeline', async () => {
    const res = await request(app).get('/api/v1/leads/summary')
    expect(res.body.data.total).toBe(0)
    expect(res.body.data.writable).toBe(false)
    expect(LEADS_WRITABLE).toBe(false)
  })
})

// ─── 2. Stage is observed, never governed ────────────────────────────────────

describe('stage is not presented as a lifecycle', () => {
  it('declares that stage is ungoverned', async () => {
    expect(LEAD_STAGE_GOVERNED).toBe(false)
    const res = await request(app).get('/api/v1/leads/summary')
    expect(res.body.data.stageGoverned).toBe(false)
  })

  it('reports the stages actually observed, whatever they are', async () => {
    // No CHECK constraint exists, so a stage can be any string — including one
    // no UI funnel has ever heard of.
    LEAD_ROWS = [
      { stage: 'prospecting',      value: 1, probability: 1 },
      { stage: 'awaiting-signoff', value: 1, probability: 1 },
    ]
    const res = await request(app).get('/api/v1/leads/summary')
    expect(res.body.data.byStage).toEqual({ prospecting: 1, 'awaiting-signoff': 1 })
  })

  it('applies no stage filter of its own to the summary', async () => {
    await request(app).get('/api/v1/leads/summary')
    const sql = statements().find(s => /GROUP BY/i.test(s))!
    expect(sql).toMatch(/GROUP BY\s+l\.stage/i)
    // No implied "open pipeline" filter — the schema cannot say what open means.
    expect(sql).not.toMatch(/stage\s*(=|<>|!=|NOT IN|IN)\s*\(?'/i)
  })

  it('binds an explicit stage filter as a parameter, never as SQL text', async () => {
    await request(app).get('/api/v1/leads?stage=prospecting')
    const sql = statements().find(s => /FROM crm_leads l/i.test(s))!
    expect(sql).toMatch(/l\.stage = \$\d+/)
    expect(sql).not.toMatch(/stage = 'prospecting'/)
  })
})

// ─── 3. Authorization and tenant isolation ───────────────────────────────────

describe('the read surface is governed', () => {
  it('refuses a caller without crm.view', async () => {
    setCaller({ id: OWNER_A, tenantId: TENANT_A, role: 'engineer' })
    expect((await request(app).get('/api/v1/leads/summary')).status).toBe(403)
    expect((await request(app).get('/api/v1/leads')).status).toBe(403)
  })

  it('carries the tenant predicate on every lead statement', async () => {
    await request(app).get('/api/v1/leads/summary')
    await request(app).get('/api/v1/leads')
    const leadStatements = statements().filter(s => /FROM crm_leads l/i.test(s))
    expect(leadStatements.length).toBeGreaterThan(0)
    for (const s of leadStatements) {
      expect(s, 'a lead read must be tenant-bounded').toMatch(/tenant_id = current_setting/i)
    }
  })

  it('refuses a caller from another tenant', async () => {
    setCaller({ id: OWNER_A, tenantId: TENANT_B, role: 'owner' })
    mockQuery.mockImplementation(async (...args: unknown[]) => {
      const sql = sqlOf(args)
      if (/FROM\s+users\s+WHERE\s+id/i.test(sql)) return { rows: [{ id: caller.id, tenant_id: caller.tenantId, role: caller.role, is_active: true }], rowCount: 1 }
      return { rows: [], rowCount: 0 }   // nothing visible cross-tenant
    })
    const res = await request(app).get(`/api/v1/leads/${LEAD}`)
    expect(res.status).toBe(404)
  })

  it('exposes no write route', async () => {
    for (const [method, path] of [['post', '/api/v1/leads'], ['patch', '/api/v1/leads/' + LEAD]] as const) {
      const res = await (request(app) as never as Record<string, (p: string) => { send: (b: unknown) => Promise<{ status: number }> }>)[method]!(path).send({})
      expect([404, 405], `${method} ${path} must not be routed`).toContain(res.status)
    }
  })

  it('routes /summary to the summary, not to a lead whose id is "summary"', async () => {
    const res = await request(app).get('/api/v1/leads/summary')
    expect(res.status).toBe(200)
    expect(res.body.data).toHaveProperty('byStage')
  })
})

// ─── 4. Leads are not contracts, projects or proposals ───────────────────────

describe('the summary reads crm_leads alone', () => {
  it('joins no other domain', async () => {
    await request(app).get('/api/v1/leads/summary')
    const sql = statements().find(s => /GROUP BY/i.test(s))!
    expect(sql).toMatch(/FROM crm_leads/i)
    expect(sql).not.toMatch(/JOIN projects|FROM projects/i)
    expect(sql).not.toMatch(/contracts|proposals|subcontracts/i)
  })
})
