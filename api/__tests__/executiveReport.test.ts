/**
 * Executive Copilot — briefing generation + route tests (v4.43.0)
 *
 * `generateProjectBriefing` is pure/deterministic. We feed it real Focus and
 * Coordination briefings (built via their own pure synthesizers) so the test
 * exercises the true integration without a DB. A route smoke test mirrors the
 * mock-pool pattern.
 */
// ADR-014 Phase 3F: the collection routes below now carry `requireProjectScope`,
// which refuses a malformed project id WITHOUT issuing SQL (fail closed). These
// ids are real uuids so the request still reaches the handler and this stays a
// response-shape smoke test; `nope` became a uuid that simply does not exist.
import { describe, it, expect, beforeEach, vi } from 'vitest'

// ADR-014 Phase 2B-3: The executive report computes budget, spend, forecast
// and cost variance, so it requires assistant.use AND project.view AND
// cost.view. cost.view has exactly one holder, making the owner the only
// role that satisfies the expression.
// Authorization re-resolves that role from the database on every request,
// so the pool answers the lookup for the caller under test.
const CALLER = vi.hoisted(() => ({ id: 'caller', tenant_id: 't1', role: 'owner', is_active: true }))

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
  tenantQuery: (tenantId: string, sql: string, params: unknown[]) => _projectScopeAnswer(sql, params) ?? mockQuery(tenantId, sql, params),
  query:       (sql: string, params: unknown[]) =>
    /FROM\s+users\s+WHERE\s+id/i.test(String(sql))
      ? Promise.resolve({ rows: [CALLER], rowCount: 1 })
      : mockQuery(null, sql, params),
}))
vi.mock('../auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.auth = { sub: 'u1', tid: 't1', role: 'owner' }
    next()
  },
}))
vi.mock('../middleware/tenant', () => ({
  requireTenant: () => (req: any, _res: any, next: any) => { req.tenantId = 'tenant-1'; next() },
}))

import { generateProjectBriefing } from '../services/copilot/executiveReportService'
import { synthesizeFocus, type FocusInputs } from '../services/copilot/projectCopilotService'
import { synthesizeCoordination, type CoordinationInputs } from '../services/copilot/coordinationService'

const NOW = new Date('2026-06-22T12:00:00Z')

function focusBriefing(over: Partial<FocusInputs> = {}) {
  return synthesizeFocus({
    project: { id: 'p1', code: 'PRJ-1', name: 'Denver DC', status: 'active' },
    rfis: [], submittals: [], risks: [], inspections: [], punchItems: [], actions: [],
    ...over,
  }, NOW)
}
function coordBriefing(over: Partial<CoordinationInputs> = {}) {
  return synthesizeCoordination({
    project: { id: 'p1', code: 'PRJ-1', name: 'Denver DC', status: 'active' },
    rfis: [], submittals: [], blockedActions: [], scheduleClashes: [], bimIssues: [], changeOrders: [],
    ...over,
  }, NOW)
}

describe('generateProjectBriefing — healthy project', () => {
  it('scores high and reports no material issues', () => {
    const r = generateProjectBriefing(
      { id: 'p1', code: 'PRJ-1', name: 'Denver DC', status: 'active', budget: 1_000_000, forecast_cost: 950_000, progress_pct: 60, planned_finish: '2026-12-01' },
      focusBriefing(), coordBriefing(), NOW,
    )
    expect(r.healthScore).toBeGreaterThanOrEqual(80)
    expect(r.healthStatus).toBe('on_track')
    expect(r.headline).toMatch(/no material issues/i)
    expect(r.sections.map(s => s.id)).toEqual(['summary', 'schedule', 'cost', 'risk', 'coordination'])
  })
})

describe('generateProjectBriefing — distressed project', () => {
  it('drops health and names the drivers (cost over budget, behind plan, criticals)', () => {
    const focus = focusBriefing({
      rfis: [{ id: 'r1', rfi_number: '1', title: 'beam clash', status: 'open', priority: 'critical', assigned_to: null, due_date: '2026-05-01' }],
      risks: [{ id: 'k1', risk_number: 3, title: 'switchgear', status: 'open', category: 'procurement', probability: 5, impact: 5, risk_score: 25, target_date: '2026-06-01' }],
    })
    const coord = coordBriefing({
      changeOrders: [{ id: 'co1', co_number: 14, title: 'upgrade', status: 'submitted', cost_impact: 800000, schedule_impact_days: 10 }],
    })
    const r = generateProjectBriefing(
      { id: 'p1', code: 'PRJ-1', name: 'Denver DC', status: 'active', budget: 1_000_000, forecast_cost: 1_200_000, progress_pct: 40, planned_finish: '2026-05-01' },
      focus, coord, NOW,
    )
    expect(r.healthScore).toBeLessThan(80)
    expect(['at_risk', 'critical', 'watch']).toContain(r.healthStatus)
    expect(r.headline.toLowerCase()).toMatch(/over budget|behind plan|critical|coordination/)
    // cost section reports the overrun
    expect(r.sections.find(s => s.id === 'cost')!.body).toMatch(/over budget/i)
    // schedule section reports the slip
    expect(r.sections.find(s => s.id === 'schedule')!.body).toMatch(/behind plan/i)
    // recommended actions are populated and unique
    expect(r.recommendedActions.length).toBeGreaterThan(0)
    expect(new Set(r.recommendedActions).size).toBe(r.recommendedActions.length)
  })
})

describe('generateProjectBriefing — sections surface real items', () => {
  it('lists coordination issues and risk items', () => {
    const coord = coordBriefing({
      blockedActions: [{ id: 'a1', title: 'pour', action_type: 'WORK_ORDER', priority: 'high', status: 'open', due_at: '2026-06-10', assigned_to_user_id: 'u1', blocker_title: 'inspection', blocker_status: 'open' }],
    })
    const r = generateProjectBriefing(
      { id: 'p1', code: 'PRJ-1', name: 'DC', status: 'active', budget: 0 },
      focusBriefing(), coord, NOW,
    )
    const coordSection = r.sections.find(s => s.id === 'coordination')!
    expect(coordSection.items!.length).toBeGreaterThan(0)
    expect(coordSection.items![0].text).toContain('inspection')
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

const PROJECT_ROW = { id: 'p1', code: 'PRJ-1', name: 'DC', status: 'active', budget: 1_000_000, forecast_cost: 1_200_000, committed_cost: 0, actual_cost: 0, progress_pct: 40, planned_finish: '2026-05-01' }

describe('Executive report route smoke', () => {
  beforeEach(() => vi.clearAllMocks())

  it('GET /copilot/projects/:id/report returns a deterministic briefing', async () => {
    mockQuery.mockImplementation(async (_t: string, sql: string) => {
      if (/FROM projects\b/.test(sql) && /id\s*=\s*\$2/.test(sql)) return { rows: [PROJECT_ROW], rowCount: 1 }
      return { rows: [], rowCount: 0 }  // all source queries empty
    })
    const res = await request(makeApp()).get('/api/v1/copilot/projects/30000000-0000-4000-8000-000000000001/report')
    expect(res.status).toBe(200)
    expect(res.body.data.healthScore).toBeLessThan(100)             // over budget + behind plan
    expect(res.body.data.sections.find((s: any) => s.id === 'cost').body).toMatch(/over budget/i)
  })

  it('404s for an unknown project', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 })
    const res = await request(makeApp()).get('/api/v1/copilot/projects/30000000-0000-4000-8000-0000000000ff/report')
    expect(res.status).toBe(404)
  })

  it('GET /copilot/report rolls up the portfolio', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }) // active projects → none
    const res = await request(makeApp()).get('/api/v1/copilot/report')
    expect(res.status).toBe(200)
    expect(res.body.data.summary.projects).toBe(0)
    expect(res.body.data.headline).toMatch(/no active projects/i)
  })
})
