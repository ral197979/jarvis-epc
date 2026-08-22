/**
 * Quality Intelligence — analysis + route tests (v4.51.0)
 */
// ADR-014 Phase 3F: the collection routes below now carry `requireProjectScope`,
// which refuses a malformed project id WITHOUT issuing SQL (fail closed). These
// ids are real uuids so the request still reaches the handler and this stays a
// response-shape smoke test; `nope` became a uuid that simply does not exist.
import { describe, it, expect, beforeEach, vi } from 'vitest'

// ADR-014 Phase 2B-2: Quality-intelligence analytics require `quality.view`
// — the engineer is the narrowest legitimate reader.
// Authorization re-resolves that role from the database on every request,
// so the pool answers the lookup for the caller under test.
const CALLER = vi.hoisted(() => ({ id: 'caller', tenant_id: 'tenant-1', role: 'engineer', is_active: true }))

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
    req.auth = { sub: 'u1', tid: 'tenant-1', role: 'engineer' }
    next()
  },
}))
vi.mock('../middleware/tenant', () => ({ requireTenant: () => (req: any, _res: any, next: any) => { req.tenantId = 'tenant-1'; next() } }))

import { analyzeQuality, type QualityInputs } from '../services/quality/qualityIntelligenceService'

const NOW = new Date('2026-06-22T12:00:00Z')
function inputs(over: Partial<QualityInputs> = {}): QualityInputs {
  return { inspections: [], punchItems: [], ...over }
}

describe('analyzeQuality — empty', () => {
  it('returns a no-data headline', () => {
    const q = analyzeQuality(inputs(), NOW)
    expect(q.summary.inspections).toBe(0)
    expect(q.headline).toMatch(/no inspection or punch data/i)
    expect(q.recurringIssues).toHaveLength(0)
  })
})

describe('analyzeQuality — recurring issues', () => {
  it('clusters repeated failures by discipline + keyword (>=2)', () => {
    const q = analyzeQuality(inputs({
      inspections: [
        { discipline: 'Mechanical', location: 'L1', title: 'Ductwork seal failure', overall_result: 'fail', status: 'completed' },
        { discipline: 'Mechanical', location: 'L2', title: 'Ductwork hanger spacing', overall_result: 'fail', status: 'completed' },
        { discipline: 'Electrical', location: 'L3', title: 'Conduit support', overall_result: 'pass', status: 'completed' },
      ],
      punchItems: [
        { discipline: 'Mechanical', location: 'L1', title: 'Ductwork joint open', status: 'open' },
      ],
    }), NOW)
    const duct = q.recurringIssues.find(r => r.category === 'ductwork')
    expect(duct).toBeTruthy()
    expect(duct!.discipline).toBe('Mechanical')
    expect(duct!.count).toBe(3)   // 2 failed inspections + 1 open punch
    expect(duct!.examples.length).toBeGreaterThan(0)
  })
})

describe('analyzeQuality — discipline performance', () => {
  it('computes fail rate, open punch, close speed, and ranks worst first', () => {
    const q = analyzeQuality(inputs({
      inspections: [
        { discipline: 'Structural', overall_result: 'fail', status: 'completed' },
        { discipline: 'Structural', overall_result: 'fail', status: 'completed' },
        { discipline: 'Structural', overall_result: 'pass', status: 'completed' },
        { discipline: 'Architectural', overall_result: 'pass', status: 'completed' },
      ],
      punchItems: [
        { discipline: 'Structural', status: 'open' },
        { discipline: 'Structural', status: 'closed', created_at: '2026-06-01', closed_at: '2026-06-11' },
        { discipline: 'Architectural', status: 'closed', created_at: '2026-06-01', closed_at: '2026-06-03' },
      ],
    }), NOW)
    const structural = q.disciplinePerformance.find(d => d.discipline === 'Structural')!
    expect(structural.failRatePct).toBeCloseTo(66.7, 1)
    expect(structural.punchOpen).toBe(1)
    expect(structural.avgDaysToClose).toBe(10)
    // Structural (worse) ranks before Architectural
    expect(q.disciplinePerformance[0].discipline).toBe('Structural')
    expect(structural.qualityScore).toBeLessThan(q.disciplinePerformance[q.disciplinePerformance.length - 1].qualityScore)
  })
})

describe('analyzeQuality — hotspots', () => {
  it('ranks locations with the most open issues', () => {
    const q = analyzeQuality(inputs({
      punchItems: [
        { location: 'Area B', status: 'open' },
        { location: 'Area B', status: 'open' },
        { location: 'Area C', status: 'open' },
        { location: 'Area B', status: 'closed' },   // not open → excluded
      ],
    }), NOW)
    expect(q.hotspots[0].location).toBe('Area B')
    expect(q.hotspots[0].openIssues).toBe(2)
  })
})

// ─── Route smoke ──────────────────────────────────────────────────────────────
import express from 'express'
import request from 'supertest'
import { qualityIntelligenceRouter } from '../routes/qualityIntelligence'

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1', qualityIntelligenceRouter as any)
  return app
}

describe('Quality Intelligence route', () => {
  beforeEach(() => vi.clearAllMocks())

  it('GET /projects/:id/quality-intelligence returns the analysis', async () => {
    mockQuery.mockImplementation(async (_t: string, sql: string) => {
      if (/FROM projects WHERE/.test(sql)) return { rows: [{ id: 'p1' }], rowCount: 1 }
      if (/FROM inspections/.test(sql)) return { rows: [{ discipline: 'Mechanical', title: 'Ductwork seal', overall_result: 'fail', status: 'completed', location: 'B' }, { discipline: 'Mechanical', title: 'Ductwork hanger', overall_result: 'fail', status: 'completed', location: 'B' }] }
      if (/FROM punch_items/.test(sql)) return { rows: [{ discipline: 'Mechanical', title: 'Ductwork gap', status: 'open', location: 'B' }] }
      return { rows: [] }
    })
    const res = await request(makeApp()).get('/api/v1/projects/30000000-0000-4000-8000-000000000001/quality-intelligence')
    expect(res.status).toBe(200)
    expect(res.body.data.recurringIssues.length).toBeGreaterThan(0)
    expect(res.body.data.disciplinePerformance[0].discipline).toBe('Mechanical')
  })

  it('404s for an unknown project', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 })
    const res = await request(makeApp()).get('/api/v1/projects/30000000-0000-4000-8000-0000000000ff/quality-intelligence')
    expect(res.status).toBe(404)
  })
})
