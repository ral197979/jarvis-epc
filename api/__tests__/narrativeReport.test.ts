/**
 * Narrative Report — composition + route tests (v4.58.0)
 */
// ADR-014 Phase 3F: the collection routes below now carry `requireProjectScope`,
// which refuses a malformed project id WITHOUT issuing SQL (fail closed). These
// ids are real uuids so the request still reaches the handler and this stays a
// response-shape smoke test; `nope` became a uuid that simply does not exist.
import { describe, it, expect, beforeEach, vi } from 'vitest'

// ADR-014 Phase 2B-3: The narrative report composes the executive report,
// cost intelligence, safety intelligence and the NCR summary, so it
// requires cost.view alongside safety.view, quality.view and project.view.
// The owner is the only role holding all of them.
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

import { composeNarrative, type NarrativeInputs } from '../services/copilot/narrativeReportService'

const NOW = new Date('2026-06-22T12:00:00Z')

function inputs(over: Partial<NarrativeInputs> = {}): NarrativeInputs {
  return {
    project: { name: 'Denver DC', code: 'PRJ-1' },
    health: { score: 62, status: 'at_risk' },
    executiveHeadline: 'Denver DC is at risk, driven by cost 8% over budget.',
    scheduleBody: 'Behind plan: the planned finish passed 12 days ago at 40% complete.',
    costHeadline: 'Forecast $1,200,000 is 8.0% over the revised budget of $1,060,000.',
    costRisk: 'high',
    quality: { openNcrs: 4, openCritical: 1, overdueCapas: 2 },
    safety: { riskIndex: 55, riskLevel: 'high', recordables: 1, nearMisses: 3 },
    recommendations: ['Build a cost-recovery plan.', 'Resolve the pending change orders.'],
    ...over,
  }
}

describe('composeNarrative', () => {
  it('produces the standard sections with the health score in the summary', () => {
    const r = composeNarrative(inputs(), NOW)
    const headings = r.sections.map(s => s.heading)
    expect(headings).toEqual(['Executive Summary', 'Schedule', 'Cost', 'Quality & Safety', 'Recommended Actions'])
    expect(r.sections[0].body).toContain('62/100')
    expect(r.sections[0].body).toContain('At Risk')
  })

  it('renders quality + safety facts and a high cost-risk note', () => {
    const r = composeNarrative(inputs(), NOW)
    const qa = r.sections.find(s => s.heading === 'Quality & Safety')!.body
    expect(qa).toContain('4 open NCRs')
    expect(qa).toContain('risk index 55/100')
    expect(r.sections.find(s => s.heading === 'Cost')!.body).toMatch(/overrun risk is high/i)
  })

  it('emits clean markdown with a title and numbered actions', () => {
    const r = composeNarrative(inputs(), NOW)
    expect(r.markdown).toMatch(/^# Denver DC — Owner Report/)
    expect(r.markdown).toContain('## Recommended Actions')
    expect(r.markdown).toContain('1. Build a cost-recovery plan.')
  })

  it('omits optional sections when data is absent', () => {
    const r = composeNarrative(inputs({ scheduleBody: null, costHeadline: null, quality: null, safety: null, recommendations: [] }), NOW)
    expect(r.sections.map(s => s.heading)).toEqual(['Executive Summary'])
  })
})

// ─── Route smoke ──────────────────────────────────────────────────────────────
import express from 'express'
import request from 'supertest'
import { copilotRouter } from '../routes/copilot'

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1', copilotRouter as any)
  return app
}

describe('Narrative report route', () => {
  beforeEach(() => vi.clearAllMocks())

  it('GET /copilot/projects/:id/narrative-report returns markdown', async () => {
    // The executive builder needs a project row; everything else returns empty.
    mockQuery.mockImplementation(async (_t: string, sql: string) => {
      if (/FROM projects/.test(sql) && /id\s*=\s*\$2/.test(sql)) {
        return { rows: [{ id: 'p1', code: 'PRJ-1', name: 'DC', status: 'active', budget: 1_000_000, committed_cost: 0, actual_cost: 0, forecast_cost: 1_100_000, progress_pct: 40, planned_finish: '2026-05-01' }], rowCount: 1 }
      }
      return { rows: [] }
    })
    const res = await request(makeApp()).get('/api/v1/copilot/projects/30000000-0000-4000-8000-000000000001/narrative-report')
    expect(res.status).toBe(200)
    expect(res.body.data.markdown).toMatch(/Owner Report/)
    expect(res.body.data.sections[0].heading).toBe('Executive Summary')
  })

  it('404s for an unknown project', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 })
    const res = await request(makeApp()).get('/api/v1/copilot/projects/30000000-0000-4000-8000-0000000000ff/narrative-report')
    expect(res.status).toBe(404)
  })
})
