/**
 * Autonomous Coordination — mapping + route tests (v4.49.0)
 *
 * The issue→recommendation mapping is pure. The execute-with-approval loop is
 * route-tested with the Coordination engine and createAction mocked.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const CALLER = vi.hoisted(() => ({ role: 'admin' }))

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
  tenantQuery: (...__a: unknown[]) => _recordScopeAnswer(__a[1], __a[2]) ?? (((t: string, sql: string, p: unknown[]) => mockQuery(t, sql, p)) as (...z: unknown[]) => unknown)(...__a),
  // ADR-014 Phase 2A: the current-user authorization lookup is answered here
  // rather than through mockQuery, so a test rescripting mockQuery for its own
  // rows cannot accidentally starve authorization and turn a 200 into a 401.
  query: async (sql: string, p: unknown[]) =>
    /FROM\s+users\s+WHERE\s+id/i.test(String(sql))
      ? { rows: [{ id: 'user-1', tenant_id: 'tenant-1', role: CALLER.role, is_active: true }], rowCount: 1 }
      : mockQuery(null, sql, p),
}))
// ADR-014 Phase 2A: coordination recommendation approve/dismiss is an AI
// governance transition (`ai.govern`). The caller is the platform administrator,
// which is the role that owns AI governance (§22) — not an implicit owner.
//
// ADR-014 Phase 2B-3: the READ is a different question. Coordination
// recommendations carry `source` values of rfi, submittal, action, schedule,
// bim or change_order and a `commercial_gate` category, so listing them
// requires the source domains too — including cost.view, whose only holder is
// the owner. Governing AI and reading what AI produced are separate
// authorities, so the two are exercised as different callers.
vi.mock('../auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.auth = { sub: 'user-1', tid: 'tenant-1', role: CALLER.role }
    next()
  },
}))
vi.mock('../middleware/tenant', () => ({ requireTenant: () => (req: any, _res: any, next: any) => { req.tenantId = 'tenant-1'; next() } }))

const { mockBuildCoord } = vi.hoisted(() => ({ mockBuildCoord: vi.fn() }))
vi.mock('../services/copilot/coordinationService', () => ({ buildProjectCoordination: mockBuildCoord }))
const { mockCreateAction } = vi.hoisted(() => ({ mockCreateAction: vi.fn() }))
vi.mock('../services/actionService', () => ({ createAction: mockCreateAction }))

import { issuesToRecommendations } from '../services/coordination/autoCoordinationService'

function briefing(issues: any[]) {
  return { project: { id: 'p1', code: null, name: 'X', status: 'active' }, generatedAt: '', headline: '', summary: {} as any, issues } as any
}
const ISSUES = [
  { category: 'blocker', source: 'action', sourceId: 'a1', reference: 'WORK_ORDER', title: 'Pour slab', why: 'blocked by rebar', recommendedAction: 'Clear the blocker', owner: 'u3', severity: 'high' },
  { category: 'commercial_gate', source: 'change_order', sourceId: 'co1', reference: 'CO-14', title: 'Upgrade', why: 'awaiting approval', recommendedAction: 'Route CO-14 for approval', owner: null, severity: 'critical' },
  { category: 'missing_approval', source: 'rfi', sourceId: 'r1', reference: 'RFI 5', title: 'beam', why: 'overdue', recommendedAction: 'Expedite', owner: 'u9', severity: 'low' },
]

describe('issuesToRecommendations', () => {
  it('keeps only high/critical, builds stable dedupe keys, maps owner & priority', () => {
    const drafts = issuesToRecommendations(briefing(ISSUES))
    expect(drafts).toHaveLength(2)
    const co = drafts.find(d => d.sourceRef === 'CO-14')!
    expect(co.dedupeKey).toBe('commercial_gate:change_order:co1')
    expect(co.priority).toBe('critical')
    expect(co.suggestedOwner).toBeNull()
    const wo = drafts.find(d => d.sourceRef === 'WORK_ORDER')!
    expect(wo.suggestedOwner).toBe('u3')
    expect(drafts.map(d => d.sourceRef)).not.toContain('RFI 5') // low excluded
  })
})

// ─── Route smoke ──────────────────────────────────────────────────────────────
import express from 'express'
import request from 'supertest'
import { autoCoordinationRouter } from '../routes/autoCoordination'

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1', autoCoordinationRouter as any)
  return app
}

describe('Autonomous coordination routes', () => {
  beforeEach(() => { vi.clearAllMocks(); CALLER.role = 'admin' })

  it('POST /scan generates recommendations from the Coordination engine', async () => {
    // ADR-014 Phase 2C-3: the scan is not an AI-governance action either. It
    // reads the same six domains the GET does — projects, rfis/submittals,
    // bim_issues, schedule and change_orders — and writes what it synthesises,
    // so it carries the identical conjunction. Admin holds ai.govern but none of
    // those domains, so the caller here is the owner, as it is for the GET.
    CALLER.role = 'owner'
    mockBuildCoord.mockResolvedValue(briefing(ISSUES))
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 }) // upserts
    const res = await request(makeApp()).post('/api/v1/projects/30000000-0000-4000-8000-000000000001/coordination/scan')
    expect(res.status).toBe(200)
    expect(res.body.data.generated).toBe(2)
    expect(mockQuery).toHaveBeenCalledTimes(2) // one upsert per draft
  })

  it('GET recommendations lists them', async () => {
    // The read needs the source domains, not ai.govern — see the header note.
    CALLER.role = 'owner'
    mockQuery.mockResolvedValue({ rows: [{ id: 'rec1', status: 'proposed', title: 'x' }], rowCount: 1 })
    const res = await request(makeApp()).get('/api/v1/projects/30000000-0000-4000-8000-000000000001/coordination/recommendations?status=proposed')
    expect(res.status).toBe(200)
    expect(res.body.data.length).toBe(1)
  })

  it('POST approve executes by creating an action and marks executed', async () => {
    mockQuery.mockImplementation(async (_t: string, sql: string) => {
      if (/SELECT[\s\S]*FROM coordination_recommendations WHERE tenant_id=\$1 AND id=\$2/.test(sql)) {
        return { rows: [{ id: 'rec1', project_id: 'p1', title: 'CO-14: Upgrade', recommended_action: 'Route CO-14', rationale: 'awaiting approval', suggested_owner: null, priority: 'critical', status: 'proposed' }], rowCount: 1 }
      }
      if (/UPDATE coordination_recommendations/.test(sql)) return { rows: [{ id: 'rec1', status: 'executed', executed_action_id: 'act-9' }], rowCount: 1 }
      return { rows: [] }
    })
    mockCreateAction.mockResolvedValue({ id: 'act-9', title: 'CO-14: Upgrade', status: 'open' })
    const res = await request(makeApp()).post('/api/v1/coordination/recommendations/497c121a-37e6-44a6-8cbe-874f9b0afb22/approve')
    expect(res.status).toBe(200)
    expect(res.body.data.action.id).toBe('act-9')
    expect(res.body.data.recommendation.status).toBe('executed')
    expect(mockCreateAction).toHaveBeenCalledOnce()
  })

  it('POST approve 409s if already decided', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 'rec1', status: 'executed' }], rowCount: 1 })
    const res = await request(makeApp()).post('/api/v1/coordination/recommendations/497c121a-37e6-44a6-8cbe-874f9b0afb22/approve')
    expect(res.status).toBe(409)
    expect(mockCreateAction).not.toHaveBeenCalled()
  })

  it('POST approve 404s for an unknown recommendation', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 })
    const res = await request(makeApp()).post('/api/v1/coordination/recommendations/nope/approve')
    expect(res.status).toBe(404)
  })

  it('POST dismiss marks dismissed', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 'rec1', status: 'dismissed' }], rowCount: 1 })
    const res = await request(makeApp()).post('/api/v1/coordination/recommendations/497c121a-37e6-44a6-8cbe-874f9b0afb22/dismiss')
    expect(res.status).toBe(200)
    expect(res.body.data.recommendation.status).toBe('dismissed')
  })
})
