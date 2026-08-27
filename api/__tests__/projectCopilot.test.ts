/**
 * Project Copilot — synthesis + route tests (v4.41.0)
 *
 * The ranking engine (`synthesizeFocus`) is pure and deterministic given a fixed
 * `now`, so most coverage is plain unit tests with no DB. A small route smoke
 * test mirrors the tier1 mock-pool pattern to confirm the endpoint is wired.
 */
// ADR-014 Phase 3F: the collection routes below now carry `requireProjectScope`,
// which refuses a malformed project id WITHOUT issuing SQL (fail closed). These
// ids are real uuids so the request still reaches the handler and this stays a
// response-shape smoke test; `nope` became a uuid that simply does not exist.
import { describe, it, expect, beforeEach, vi } from 'vitest'

// ─── Mock DB pool (used only by the route smoke test) ─────────────────────────
// ADR-014 Phase 2B-3: The project focus briefing requires assistant.use AND
// project.view AND construction.view AND risk.view AND quality.view AND
// cost.view, because it selects budget, committed, actual and forecast cost
// alongside RFI, submittal, risk, inspection and punch data. cost.view has
// exactly one holder, so the owner is not a convenience here — it is the
// only role that satisfies the expression.
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

import {
  synthesizeFocus,
  type FocusInputs,
} from '../services/copilot/projectCopilotService'

const NOW = new Date('2026-06-22T12:00:00Z')

function emptyInputs(over: Partial<FocusInputs> = {}): FocusInputs {
  return {
    project: { id: 'p1', code: 'PRJ-1', name: 'Denver Data Center', status: 'active' },
    rfis: [], submittals: [], risks: [], inspections: [], punchItems: [], actions: [],
    ...over,
  }
}

describe('synthesizeFocus — empty project', () => {
  it('returns a clear headline and zero items when nothing is actionable', () => {
    const b = synthesizeFocus(emptyInputs(), NOW)
    expect(b.items).toHaveLength(0)
    expect(b.summary.total).toBe(0)
    expect(b.headline).toMatch(/clear/i)
    expect(b.generatedAt).toBe(NOW.toISOString())
    expect(b.project.name).toBe('Denver Data Center')
  })
})

describe('synthesizeFocus — RFI scoring', () => {
  it('an overdue critical unassigned RFI ranks critical with a why + action', () => {
    const b = synthesizeFocus(emptyInputs({
      rfis: [{ id: 'r1', rfi_number: '014', title: 'Beam clash Area B', status: 'open', priority: 'critical', assigned_to: null, due_date: '2026-06-12' }],
    }), NOW)
    expect(b.items).toHaveLength(1)
    const it = b.items[0]
    expect(it.source).toBe('rfi')
    expect(it.severity).toBe('critical')
    expect(it.daysOverdue).toBe(10)
    expect(it.why).toContain('10 days overdue')
    expect(it.recommendedAction).toMatch(/assign a responder/i)
    expect(it.impacts).toContain('schedule')
  })

  it('a low-priority RFI due in the future scores below an overdue one', () => {
    const b = synthesizeFocus(emptyInputs({
      rfis: [
        { id: 'a', rfi_number: '1', title: 'future', status: 'open', priority: 'low', assigned_to: 'u9', due_date: '2026-07-30' },
        { id: 'b', rfi_number: '2', title: 'overdue', status: 'pending', priority: 'high', assigned_to: 'u9', due_date: '2026-06-01' },
      ],
    }), NOW)
    expect(b.items[0].reference).toBe('RFI 2')   // overdue high sorts first
    expect(b.items[0].score).toBeGreaterThan(b.items[1].score)
  })
})

describe('synthesizeFocus — risk scoring', () => {
  it('scales score with risk_score and flags overdue mitigation target', () => {
    const b = synthesizeFocus(emptyInputs({
      risks: [{ id: 'k1', risk_number: 3, title: 'Switchgear lead time', status: 'open', category: 'procurement', probability: 5, impact: 5, risk_score: 25, cost_exposure: 250000, target_date: '2026-06-10', mitigation_plan: null }],
    }), NOW)
    const it = b.items[0]
    expect(it.source).toBe('risk')
    expect(it.severity).toBe('critical')
    expect(it.impacts).toEqual(['procurement'])
    expect(it.why).toContain('5×5=25')
    expect(it.why).toContain('$250,000')
    expect(it.recommendedAction).toMatch(/define a mitigation plan/i)
  })
})

describe('synthesizeFocus — inspections & punch filtering', () => {
  it('surfaces failed inspections and overdue scheduled ones, ignores passed', () => {
    const b = synthesizeFocus(emptyInputs({
      inspections: [
        { id: 'i1', inspection_number: 'C-1', title: 'Concrete pour', status: 'completed', overall_result: 'fail', location: 'Grid A' },
        { id: 'i2', inspection_number: 'C-2', title: 'Firestop', status: 'scheduled', scheduled_date: '2026-06-15', overall_result: null },
        { id: 'i3', inspection_number: 'C-3', title: 'Passed one', status: 'completed', overall_result: 'pass' },
      ],
    }), NOW)
    const refs = b.items.map(i => i.reference)
    expect(refs).toContain('INSP C-1')
    expect(refs).toContain('INSP C-2')
    expect(refs).not.toContain('INSP C-3')
  })

  it('only surfaces punch items that are high priority or overdue, carrying the list id', () => {
    const b = synthesizeFocus(emptyInputs({
      punchItems: [
        { id: 'p1', item_number: 1, title: 'critical', priority: 'critical', status: 'open', due_date: null, punch_list_id: 'list-9' },
        { id: 'p2', item_number: 2, title: 'overdue medium', priority: 'medium', status: 'open', due_date: '2026-06-01' },
        { id: 'p3', item_number: 3, title: 'quiet medium', priority: 'medium', status: 'open', due_date: null },
      ],
    }), NOW)
    const refs = b.items.map(i => i.reference)
    expect(refs).toContain('Punch #1')
    expect(refs).toContain('Punch #2')
    expect(refs).not.toContain('Punch #3')
    // parentId carries the punch list so the UI can deep-link straight to the item
    expect(b.items.find(i => i.reference === 'Punch #1')?.parentId).toBe('list-9')
  })
})

describe('synthesizeFocus — project-level cost & schedule', () => {
  it('flags a budget overrun with a cost impact', () => {
    const b = synthesizeFocus(emptyInputs({
      project: { id: 'p1', code: 'PRJ-1', name: 'X', status: 'active', budget: 1000000, forecast_cost: 1200000, committed_cost: 0, actual_cost: 0 },
    }), NOW)
    const it = b.items.find(i => i.source === 'budget')!
    expect(it).toBeTruthy()
    expect(it.impacts).toEqual(['cost'])
    expect(it.why).toContain('20.0%')
  })

  it('flags a project past its planned finish, but not a completed one', () => {
    const overrun = synthesizeFocus(emptyInputs({
      project: { id: 'p1', name: 'Late', status: 'active', planned_finish: '2026-05-01', progress_pct: 70 },
    }), NOW)
    expect(overrun.items.some(i => i.source === 'schedule')).toBe(true)

    const done = synthesizeFocus(emptyInputs({
      project: { id: 'p1', name: 'Done', status: 'completed', planned_finish: '2026-05-01', progress_pct: 100 },
    }), NOW)
    expect(done.items.some(i => i.source === 'schedule')).toBe(false)
  })
})

describe('synthesizeFocus — ranking, dedup of mirrored actions, summary', () => {
  it('sorts by score desc and respects the limit', () => {
    const b = synthesizeFocus(emptyInputs({
      rfis: Array.from({ length: 5 }, (_, i) => ({
        id: `r${i}`, rfi_number: String(i), title: `t${i}`, status: 'open', priority: 'medium', assigned_to: 'u', due_date: `2026-06-0${i + 1}`,
      })),
    }), NOW, 3)
    expect(b.items).toHaveLength(3)
    for (let i = 1; i < b.items.length; i++) {
      expect(b.items[i - 1].score).toBeGreaterThanOrEqual(b.items[i].score)
    }
    expect(b.summary.total).toBe(5)  // summary counts everything, items are capped
  })

  it('counts severities in the summary', () => {
    const b = synthesizeFocus(emptyInputs({
      rfis: [{ id: 'r1', rfi_number: '1', title: 'crit', status: 'open', priority: 'critical', assigned_to: null, due_date: '2026-05-01' }],
      risks: [{ id: 'k1', risk_number: 1, title: 'low risk', status: 'open', category: 'cost', probability: 3, impact: 4, risk_score: 12, target_date: null }],
    }), NOW)
    expect(b.summary.critical).toBeGreaterThanOrEqual(1)
    expect(b.summary.total).toBe(2)
  })
})

// ─── Route smoke test ─────────────────────────────────────────────────────────
import express from 'express'
import request from 'supertest'
import { copilotRouter } from '../routes/copilot'

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1', copilotRouter as any)
  return app
}

describe('Copilot route smoke', () => {
  beforeEach(() => vi.clearAllMocks())

  it('GET /copilot/projects/:id/focus returns a briefing', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'p1', code: 'PRJ-1', name: 'DC', status: 'active', budget: 0 }], rowCount: 1 }) // project
      .mockResolvedValueOnce({ rows: [{ id: 'r1', rfi_number: '9', title: 'late', status: 'open', priority: 'high', assigned_to: null, due_date: '2026-06-01' }] }) // rfis
      .mockResolvedValueOnce({ rows: [] }) // submittals
      .mockResolvedValueOnce({ rows: [] }) // risks
      .mockResolvedValueOnce({ rows: [] }) // inspections
      .mockResolvedValueOnce({ rows: [] }) // punch
      .mockResolvedValueOnce({ rows: [] }) // actions
    const res = await request(makeApp()).get('/api/v1/copilot/projects/30000000-0000-4000-8000-000000000001/focus')
    expect(res.status).toBe(200)
    expect(res.body.data.items.length).toBeGreaterThan(0)
    expect(res.body.data.headline).toBeTruthy()
  })

  it('GET /copilot/projects/:id/focus 404s for an unknown project', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 })
    const res = await request(makeApp()).get('/api/v1/copilot/projects/30000000-0000-4000-8000-0000000000ff/focus')
    expect(res.status).toBe(404)
  })

  it('GET /copilot/focus rolls up the portfolio', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }) // active projects → none
    const res = await request(makeApp()).get('/api/v1/copilot/focus')
    expect(res.status).toBe(200)
    expect(res.body.data.summary.projects).toBe(0)
    expect(res.body.data.headline).toMatch(/clear/i)
  })
})
