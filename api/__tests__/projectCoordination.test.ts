/**
 * Coordination Copilot — synthesis + route tests (v4.42.0)
 *
 * `synthesizeCoordination` is pure/deterministic given a fixed `now`, so most
 * coverage is plain unit tests with no DB. A small route smoke test mirrors the
 * tier1 mock-pool pattern.
 */
// ADR-014 Phase 3F: the collection routes below now carry `requireProjectScope`,
// which refuses a malformed project id WITHOUT issuing SQL (fail closed). These
// ids are real uuids so the request still reaches the handler and this stays a
// response-shape smoke test; `nope` became a uuid that simply does not exist.
import { describe, it, expect, beforeEach, vi } from 'vitest'

// ADR-014 Phase 2B-3: Coordination synthesis reads change orders including
// cost_impact alongside BIM issues, RFIs, submittals and schedule
// dependencies, so it requires cost.view among five other capabilities. The
// owner is the only role holding all of them.
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

import { synthesizeCoordination, type CoordinationInputs } from '../services/copilot/coordinationService'

const NOW = new Date('2026-06-22T12:00:00Z')

function inputs(over: Partial<CoordinationInputs> = {}): CoordinationInputs {
  return {
    project: { id: 'p1', code: 'PRJ-1', name: 'Denver DC', status: 'active' },
    rfis: [], submittals: [], blockedActions: [], scheduleClashes: [], bimIssues: [], changeOrders: [],
    ...over,
  }
}

describe('synthesizeCoordination — empty', () => {
  it('returns an in-sync headline and zero issues', () => {
    const b = synthesizeCoordination(inputs(), NOW)
    expect(b.issues).toHaveLength(0)
    expect(b.summary.total).toBe(0)
    expect(b.headline).toMatch(/in sync/i)
    expect(b.summary.byCategory.blocker).toBe(0)
  })
})

describe('synthesizeCoordination — missing approvals', () => {
  it('flags an overdue unanswered RFI and an unassigned one', () => {
    const b = synthesizeCoordination(inputs({
      rfis: [
        { id: 'r1', rfi_number: '5', title: 'overdue', status: 'open', priority: 'high', assigned_to: 'u9', due_date: '2026-06-10' },
        { id: 'r2', rfi_number: '6', title: 'unassigned', status: 'pending', priority: 'medium', assigned_to: null, due_date: '2026-07-30' },
      ],
    }), NOW)
    const refs = b.issues.map(i => i.reference)
    expect(refs).toContain('RFI 5')
    expect(refs).toContain('RFI 6')
    expect(b.issues.every(i => i.category === 'missing_approval')).toBe(true)
    expect(b.issues.find(i => i.reference === 'RFI 5')!.why).toContain('overdue')
  })

  it('ignores an assigned RFI that is not overdue', () => {
    const b = synthesizeCoordination(inputs({
      rfis: [{ id: 'r1', rfi_number: '9', title: 'fine', status: 'open', priority: 'low', assigned_to: 'u9', due_date: '2026-08-01' }],
    }), NOW)
    expect(b.issues).toHaveLength(0)
  })

  it('flags a submittal with no reviewer with procurement impact', () => {
    const b = synthesizeCoordination(inputs({
      submittals: [{ id: 's1', submittal_number: 'M-1', title: 'pump', status: 'under_review', reviewed_by: null, due_date: '2026-07-30' }],
    }), NOW)
    expect(b.issues[0].source).toBe('submittal')
    expect(b.issues[0].impacts).toContain('procurement')
  })
})

describe('synthesizeCoordination — blockers', () => {
  it('ranks a blocked action high with the blocker named', () => {
    const b = synthesizeCoordination(inputs({
      blockedActions: [{ id: 'a1', title: 'Pour slab', action_type: 'WORK_ORDER', priority: 'high', status: 'open', due_at: '2026-06-15', assigned_to_user_id: 'u3', blocker_title: 'Rebar inspection', blocker_status: 'open' }],
    }), NOW)
    const it = b.issues[0]
    expect(it.category).toBe('blocker')
    expect(['critical', 'high']).toContain(it.severity)
    expect(it.why).toContain('Rebar inspection')
    expect(it.recommendedAction).toContain('Rebar inspection')
    expect(it.owner).toBe('u3')
  })
})

describe('synthesizeCoordination — schedule clashes', () => {
  it('flags an in-progress successor whose predecessor is incomplete', () => {
    const b = synthesizeCoordination(inputs({
      scheduleClashes: [{ succ_id: 'task-aaaaaaaa', succ_name: 'Drywall', succ_status: 'in_progress', pred_id: 't2', pred_name: 'Rough-in', pred_status: 'in_progress' }],
    }), NOW)
    const it = b.issues[0]
    expect(it.category).toBe('schedule_clash')
    expect(it.why).toMatch(/out of sequence/i)
    expect(it.impacts).toEqual(['schedule'])
  })
})

describe('synthesizeCoordination — BIM clashes', () => {
  it('scores a critical open clash above a minor one', () => {
    const b = synthesizeCoordination(inputs({
      bimIssues: [
        { id: 'b-critical', title: 'duct vs beam', severity: 'critical', status: 'open', assigned_to: null },
        { id: 'b-minor', title: 'label', severity: 'minor', status: 'open', assigned_to: 'u1' },
      ],
    }), NOW)
    expect(b.issues[0].title).toBe('duct vs beam')
    expect(b.issues[0].severity).toBe('critical')
    expect(b.issues[0].score).toBeGreaterThan(b.issues[1].score)
  })
})

describe('synthesizeCoordination — commercial gates', () => {
  it('flags a submitted change order with cost (and schedule) impact', () => {
    const b = synthesizeCoordination(inputs({
      changeOrders: [{ id: 'co1', co_number: 14, title: 'Switchgear upgrade', status: 'submitted', cost_impact: 850000, schedule_impact_days: 12 }],
    }), NOW)
    const it = b.issues[0]
    expect(it.category).toBe('commercial_gate')
    expect(it.reference).toBe('CO-14')
    expect(it.impacts).toEqual(['cost', 'schedule'])
    expect(it.why).toContain('$850,000')
  })
})

describe('synthesizeCoordination — ranking & summary', () => {
  it('sorts by score, caps with limit, and counts by category', () => {
    const b = synthesizeCoordination(inputs({
      rfis: [{ id: 'r1', rfi_number: '1', title: 'late', status: 'open', priority: 'critical', assigned_to: null, due_date: '2026-05-01' }],
      blockedActions: [{ id: 'a1', title: 'x', action_type: 'RFI', priority: 'critical', status: 'open', due_at: '2026-05-01', assigned_to_user_id: null, blocker_title: 'y', blocker_status: 'open' }],
      bimIssues: [{ id: 'b1', title: 'clash', severity: 'critical', status: 'open', assigned_to: null }],
    }), NOW, 2)
    expect(b.issues).toHaveLength(2)            // capped
    expect(b.summary.total).toBe(3)             // counts everything
    expect(b.summary.byCategory.blocker).toBe(1)
    expect(b.summary.byCategory.bim_clash).toBe(1)
    for (let i = 1; i < b.issues.length; i++) {
      expect(b.issues[i - 1].score).toBeGreaterThanOrEqual(b.issues[i].score)
    }
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

describe('Coordination route smoke', () => {
  beforeEach(() => vi.clearAllMocks())

  it('GET /copilot/projects/:id/coordination returns a briefing', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'p1', code: 'PRJ-1', name: 'DC', status: 'active' }], rowCount: 1 }) // project
      .mockResolvedValueOnce({ rows: [{ id: 'r1', rfi_number: '9', title: 'late', status: 'open', priority: 'high', assigned_to: null, due_date: '2026-06-01' }] }) // rfis
      .mockResolvedValueOnce({ rows: [] }) // submittals
      .mockResolvedValueOnce({ rows: [] }) // blocked actions
      .mockResolvedValueOnce({ rows: [] }) // schedule clashes
      .mockResolvedValueOnce({ rows: [] }) // bim
      .mockResolvedValueOnce({ rows: [] }) // change orders
    const res = await request(makeApp()).get('/api/v1/copilot/projects/30000000-0000-4000-8000-000000000001/coordination')
    expect(res.status).toBe(200)
    expect(res.body.data.issues.length).toBeGreaterThan(0)
    expect(res.body.data.summary.byCategory).toBeTruthy()
  })

  it('404s for an unknown project', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 })
    const res = await request(makeApp()).get('/api/v1/copilot/projects/30000000-0000-4000-8000-0000000000ff/coordination')
    expect(res.status).toBe(404)
  })

  it('GET /copilot/coordination rolls up the portfolio', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }) // active projects → none
    const res = await request(makeApp()).get('/api/v1/copilot/coordination')
    expect(res.status).toBe(200)
    expect(res.body.data.summary.projects).toBe(0)
    expect(res.body.data.headline).toMatch(/in sync/i)
  })
})
