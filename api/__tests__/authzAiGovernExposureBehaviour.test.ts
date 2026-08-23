/**
 * ADR-014 Phase 3I — `ai.govern` exposure, exercised through the real routers.
 *
 * The condition this slice removes:
 *
 *     ai.govern
 *   + a tenant
 *   = the tenant's AI records, and the business payload inside them
 *
 * `ai.govern` reaches the PLATFORM administrator, who holds no project scope
 * and no business-domain capability at all. So wherever an AI record carried a
 * project's data, or named a project as its target, that authority was standing
 * in for one Admin does not have.
 *
 * Fixture (§50), modelled rather than mocked per call: the membership predicate,
 * the tenant predicate and the parent-project projection are read OFF the
 * statement the product issued, so deleting any of them changes what these
 * return — which is what makes the mutation tests mean something.
 *
 *   Tenant A   ADMIN_A    (admin)  → member of PROJECT_A only
 *              OWNER_A    (owner)  → tenant-wide by project.list.all
 *              ENGINEER_A (engineer)→ no ai.govern at all
 *   Tenant B   OWNER_B    (owner)
 *
 * ADMIN_A is deliberately given a membership: §58's point is that membership
 * answers WHICH records and never WHICH domains, so the Admin has to be a
 * legitimate member somewhere for the distinction to be visible.
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

const orchestrate = vi.fn(async () => ({ planId: 'plan-1', tasksCreated: 0 }))
vi.mock('../services/agents/agentOrchestrator', () => ({
  orchestrate: (...a: unknown[]) => orchestrate(...(a as [])),
}))
const enqueueTask       = vi.fn(async () => ({ id: 'task-1' }))
const resumeFromApproval = vi.fn(async () => undefined)
vi.mock('../services/agents/agentTaskQueue', () => ({
  enqueueTask:        (...a: unknown[]) => enqueueTask(...(a as [])),
  resumeFromApproval: (...a: unknown[]) => resumeFromApproval(...(a as [])),
  latestTaskForScope: vi.fn(async () => null),
}))

import type { UserRole } from '../authz/capabilities'

const TENANT_A  = 'aaaaaaaa-0000-4000-8000-000000000001'
const TENANT_B  = 'bbbbbbbb-0000-4000-8000-000000000002'
const ADMIN_A   = '10000000-0000-4000-8000-0000000000a1'
const OWNER_A   = '10000000-0000-4000-8000-0000000000a2'
const ENGINEER_A= '10000000-0000-4000-8000-0000000000a3'
const PROJECT_A = '30000000-0000-4000-8000-00000000000a'
const PROJECT_B = '30000000-0000-4000-8000-00000000000b'

const REC_ON_A  = '40000000-0000-4000-8000-00000000000a'
const REC_ON_B  = '40000000-0000-4000-8000-00000000000b'
const APPROVAL  = '40000000-0000-4000-8000-0000000000ap'

/** coordination_recommendations, as rows. */
const COORD: Record<string, { project: string; tenant: string }> = {
  [REC_ON_A]: { project: PROJECT_A, tenant: TENANT_A },
  [REC_ON_B]: { project: PROJECT_B, tenant: TENANT_A },
}

/** One pending AI recommendation, carrying both governance and business fields. */
const RECOMMENDATION: Record<string, unknown> = {
  id: 'rec-1', action_id: 'act-1', recommended_action: 'escalate', category: 'schedule',
  status: 'pending', confidence_score: 91, impact_score: 80, urgency_score: 70,
  min_confidence_threshold: 70, approval_required: true, generated_by: 'rule_engine',
  generated_at: '2026-01-01', expires_at: '2099-01-01',
  reviewed_by: null, approved_by: null, executed_by: null, rejection_reason: null,
  reviewed_at: null, executed_at: null,
  // business payload
  reason: 'Chiller CH-01 commissioning slipped 9 days against the Acme baseline',
  data_signals: ['schedule_variance=9d', 'cost_exposure=142000'],
  affected_entities: [{ entity_type: 'project', entity_id: PROJECT_B, impact: 'high' }],
  rollback_plan: { undo: 'revert milestone' },
  preview_data: { projected_delay_days: 9 },
}
const BUSINESS_FIELDS = ['reason', 'data_signals', 'affected_entities', 'rollback_plan', 'preview_data']

interface MemberRow { projectId: string; userId: string; active: boolean }
let MEMBERS: MemberRow[]
interface Caller { id: string; tenantId: string; role: UserRole }
let caller: Caller
const setCaller = (c: Caller) => { caller = c; (globalThis as Record<string, unknown>)['__p3i'] = c }

vi.mock('../auth', () => ({
  requireAuth: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    const c = (globalThis as Record<string, unknown>)['__p3i'] as Caller
    req['auth'] = { sub: c.id, tid: c.tenantId, role: c.role, jti: 'jti' }
    next()
  },
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}))
vi.mock('../middleware/tenant', () => ({
  requireTenant: () => (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req['tenantId'] = ((globalThis as Record<string, unknown>)['__p3i'] as Caller).tenantId
    next()
  },
}))

import { requireAuth }   from '../auth'
import { requireTenant } from '../middleware/tenant'
import { aiGovernanceRouter }    from '../routes/aiGovernance'
import { autoCoordinationRouter } from '../routes/autoCoordination'
import { agentsRouter }          from '../routes/agents'
import { agentReadinessRouter }  from '../routes/agentReadiness'
import { agentApprovalsRouter }  from '../routes/agentApprovals'

function makeApp() {
  const app = express()
  app.use(express.json())
  const auth = [requireAuth as never, requireTenant() as never]
  // Mounted as api/server.ts mounts them. aiGovernance and autoCoordination
  // carry their own requireAuth; the tenant middleware is supplied here so
  // `tenantId` is set the way a request in production has it.
  app.use('/api/v1/ai',               ...auth, aiGovernanceRouter as never)
  app.use('/api/v1',                  ...auth, autoCoordinationRouter as never)
  app.use('/api/v1/agents/approvals', ...auth, agentApprovalsRouter as never)
  app.use('/api/v1/agents/readiness', ...auth, agentReadinessRouter as never)
  app.use('/api/v1/agents',           ...auth, agentsRouter as never)
  return app
}
const app = makeApp()

const SQLRE = /\b(SELECT|INSERT|UPDATE|DELETE)\b/i
const sqlOf = (a: unknown[]): string =>
  a.find((x): x is string => typeof x === 'string' && SQLRE.test(x)) ?? ''
const paramsOf = (a: unknown[]): unknown[] =>
  (a.find(x => Array.isArray(x)) as unknown[] | undefined) ?? []
const statements = () => mockQuery.mock.calls.map(c => sqlOf(c)).filter(Boolean)
const businessQueries = () => statements().filter(s =>
  /ai_recommendation_queue|agent_approvals|coordination_recommendations/i.test(s))

beforeEach(() => {
  MEMBERS = [
    { projectId: PROJECT_A, userId: ADMIN_A, active: true },
  ]
  setCaller({ id: ADMIN_A, tenantId: TENANT_A, role: 'admin' })
  orchestrate.mockClear(); enqueueTask.mockClear(); resumeFromApproval.mockClear()

  mockQuery.mockReset()
  mockQuery.mockImplementation(async (...args: unknown[]) => {
    const sql = sqlOf(args)
    const params = paramsOf(args)
    const empty = { rows: [], rowCount: 0 }

    if (/FROM\s+users\s+WHERE\s+id/i.test(sql)) {
      return { rows: [{ id: caller.id, tenant_id: caller.tenantId, role: caller.role, is_active: true }], rowCount: 1 }
    }

    // resolveParentProjectId for coordination_recommendations — the parent
    // projection. The tenant predicate is read off the SQL, not assumed.
    if (/FROM coordination_recommendations r/i.test(sql)) {
      const row = COORD[params[0] as string]
      const honoursTenant = /r\.tenant_id = current_setting/i.test(sql)
      if (!row || (honoursTenant && row.tenant !== caller.tenantId)) return empty
      return { rows: [{ project_id: row.project }], rowCount: 1 }
    }

    // filterAccessibleProjectIds. Which branch the product chose is visible in
    // the statement: a tenant-wide principal gets no membership clause, and a
    // scoped one does. Honour whichever it actually issued.
    if (/FROM projects/i.test(sql) && /ANY\(\$1::uuid\[\]\)/i.test(sql)) {
      const candidates = (params[0] as string[]) ?? []
      const needsMembership = /project_members/i.test(sql)
      const honoursTenant   = /tenant_id = current_setting/i.test(sql)
      const visible = candidates.filter(id => {
        if (honoursTenant && caller.tenantId !== TENANT_A) return false
        if (!needsMembership) return true
        return MEMBERS.some(m => m.projectId === id && m.userId === caller.id && m.active)
      })
      return { rows: visible.map(id => ({ id })), rowCount: visible.length }
    }

    // The recommendation queue. The projection is the point: return exactly the
    // columns the product asked for, so an over-broad SELECT is observable.
    if (/FROM ai_recommendation_queue/i.test(sql)) {
      const cols = /SELECT ([\s\S]*?) FROM ai_recommendation_queue/i.exec(sql)?.[1] ?? ''
      if (cols.trim() === '*') return { rows: [{ ...RECOMMENDATION }], rowCount: 1 }
      const names = cols.split(',').map(c => c.trim())
      const row: Record<string, unknown> = {}
      for (const n of names) if (n in RECOMMENDATION) row[n] = RECOMMENDATION[n]
      return { rows: [row], rowCount: 1 }
    }

    if (/UPDATE agent_approvals/i.test(sql)) {
      return { rows: [{ id: APPROVAL, task_id: 'task-1', tenant_id: caller.tenantId,
                        reviewed_by: params[2], status: 'approved' }], rowCount: 1 }
    }
    // approveRecommendation's own read: `WHERE tenant_id=$1 AND id=$2`, so the
    // id is the SECOND parameter here, unlike the scope projection above.
    if (/SELECT id, project_id, title[\s\S]*FROM coordination_recommendations/i.test(sql)) {
      const row = COORD[params[1] as string]
      if (!row || row.tenant !== caller.tenantId) return empty
      return { rows: [{ id: params[1], project_id: row.project, title: 'Coordinate chiller handover',
                        recommended_action: 'assign owner', rationale: 'schedule conflict',
                        suggested_owner: null, priority: 'high', status: 'proposed' }], rowCount: 1 }
    }
    if (/UPDATE coordination_recommendations/i.test(sql)) {
      return { rows: [{ id: params[1], status: 'executed', executed_action_id: null }], rowCount: 1 }
    }
    return empty
  })
})

// ─── §56 the administrator keeps the governance workflow ─────────────────────

describe('ai.govern remains usable for governance (§27, §56)', () => {
  it('admits the platform administrator to the approval queue', async () => {
    const res = await request(app).get('/api/v1/ai/recommendations')
    expect(res.status).toBe(200)
    const rec = res.body.data[0]
    // Everything needed to triage and decide.
    for (const f of ['id', 'category', 'status', 'urgency_score', 'approval_required', 'recommended_action']) {
      expect(rec, `admin needs ${f} to run the queue`).toHaveProperty(f)
    }
  })

  it('admits the owner too', async () => {
    setCaller({ id: OWNER_A, tenantId: TENANT_A, role: 'owner' })
    expect((await request(app).get('/api/v1/ai/recommendations')).status).toBe(200)
  })

  it('refuses a principal without ai.govern', async () => {
    setCaller({ id: ENGINEER_A, tenantId: TENANT_A, role: 'engineer' })
    const res = await request(app).get('/api/v1/ai/recommendations')
    expect(res.status).toBe(403)
    // §46 — the functional gate refuses before any AI record is read.
    expect(businessQueries()).toHaveLength(0)
  })
})

// ─── §14 / §29 / §30 the payload inside a governance record ──────────────────

describe('a governance record does not smuggle business payload (§14, §29, §30)', () => {
  it('withholds the business columns from the administrator', async () => {
    const res = await request(app).get('/api/v1/ai/recommendations')
    const rec = res.body.data[0]
    for (const f of BUSINESS_FIELDS) {
      expect(rec, `${f} is business payload, not governance metadata`).not.toHaveProperty(f)
    }
    // Omitted, not nulled: a null would still confirm the field exists and
    // invite the reader to treat it as "no data" rather than "not shown".
    expect(Object.keys(rec)).not.toContain('reason')
  })

  it('never lets the values reach the response at all', async () => {
    const res = await request(app).get('/api/v1/ai/recommendations')
    const body = JSON.stringify(res.body)
    expect(body).not.toContain('Acme')          // the project name in `reason`
    expect(body).not.toContain('cost_exposure')  // a signal
    expect(body).not.toContain(PROJECT_B)        // an affected entity id
  })

  it('gives them to a caller that holds crossdomain.read', async () => {
    setCaller({ id: OWNER_A, tenantId: TENANT_A, role: 'owner' })
    const rec = (await request(app).get('/api/v1/ai/recommendations')).body.data[0]
    for (const f of BUSINESS_FIELDS) {
      expect(rec, `the owner holds crossdomain.read and keeps ${f}`).toHaveProperty(f)
    }
  })

  it('decides on the live role, so a demotion takes effect without a new token (§36)', async () => {
    setCaller({ id: OWNER_A, tenantId: TENANT_A, role: 'owner' })
    expect((await request(app).get('/api/v1/ai/recommendations')).body.data[0]).toHaveProperty('reason')

    // Same principal, same token; the DB role changes underneath it.
    setCaller({ id: OWNER_A, tenantId: TENANT_A, role: 'admin' })
    const after = (await request(app).get('/api/v1/ai/recommendations')).body.data[0]
    expect(after).not.toHaveProperty('reason')
  })
})

// ─── §17 / §26 project-scoped AI operations ──────────────────────────────────

describe('an AI operation on a project asks the project (§17, §26)', () => {
  it('admits the administrator on a project they are a member of', async () => {
    const res = await request(app).post(`/api/v1/coordination/recommendations/${REC_ON_A}/approve`)
    expect(res.status).toBe(200)
  })

  it('refuses the same operation on a project they are not', async () => {
    const res = await request(app).post(`/api/v1/coordination/recommendations/${REC_ON_B}/approve`)
    expect(res.status).toBe(404)
  })

  it('still admits the tenant-wide owner on both', async () => {
    setCaller({ id: OWNER_A, tenantId: TENANT_A, role: 'owner' })
    for (const id of [REC_ON_A, REC_ON_B]) {
      expect((await request(app).post(`/api/v1/coordination/recommendations/${id}/approve`)).status).toBe(200)
    }
  })

  it('refuses once membership is revoked, with no new token (§37)', async () => {
    expect((await request(app).post(`/api/v1/coordination/recommendations/${REC_ON_A}/approve`)).status).toBe(200)
    MEMBERS = MEMBERS.map(m => ({ ...m, active: false }))
    expect((await request(app).post(`/api/v1/coordination/recommendations/${REC_ON_A}/approve`)).status).toBe(404)
  })

  it('refuses across tenants (§38)', async () => {
    setCaller({ id: OWNER_A, tenantId: TENANT_B, role: 'owner' })
    expect((await request(app).post(`/api/v1/coordination/recommendations/${REC_ON_A}/approve`)).status).toBe(404)
  })
})

// ─── §15 / §16 / §23 the target an agent is pointed at ───────────────────────

describe('an agent is not pointed at a project the caller cannot reach (§15, §16, §23)', () => {
  const exec = (scope: string, scopeId: string) =>
    request(app).post('/api/v1/agents/execute')
      .send({ objective: 'assess_readiness', scope, scopeId })

  it('admits a project the administrator is a member of', async () => {
    const res = await exec('project', PROJECT_A)
    expect(res.status).toBe(202)
    expect(orchestrate).toHaveBeenCalledTimes(1)
  })

  it('refuses a project they are not, and starts nothing', async () => {
    const res = await exec('project', PROJECT_B)
    expect(res.status).toBe(404)
    // §23 — zero side effects on refusal. Not "an execution that fails later".
    expect(orchestrate).not.toHaveBeenCalled()
    expect(enqueueTask).not.toHaveBeenCalled()
  })

  it('fails closed on a scope kind the registry does not model (§5)', async () => {
    const res = await exec('global', PROJECT_A)
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('unsupported_scope_type')
    expect(orchestrate).not.toHaveBeenCalled()
  })

  it('applies the same rule to the dry run, which is the same selector', async () => {
    const res = await request(app).post('/api/v1/agents/plan')
      .send({ objective: 'assess_readiness', scope: 'project', scopeId: PROJECT_B })
    expect(res.status).toBe(404)
    expect(orchestrate).not.toHaveBeenCalled()
  })

  it('applies it to readiness coordination, which names the target the same way', async () => {
    const res = await request(app).post('/api/v1/agents/readiness/coordinate')
      .send({ scopeType: 'project', scopeId: PROJECT_B })
    expect(res.status).toBe(404)
    expect(orchestrate).not.toHaveBeenCalled()
  })
})

// ─── §24 / §25 the author of an AI decision ──────────────────────────────────

describe('the AI decision of record names its real author (§24, §25)', () => {
  it('records the live principal, not the body', async () => {
    const IMPERSONATED = '10000000-0000-4000-8000-0000000000ff'
    const res = await request(app)
      .post(`/api/v1/agents/approvals/${APPROVAL}/approve`)
      .send({ reviewedBy: IMPERSONATED, notes: 'ok' })
    expect(res.status).toBe(200)

    const update = mockQuery.mock.calls.find(c => /UPDATE agent_approvals/i.test(sqlOf(c)))
    expect(update, 'the verdict was written').toBeTruthy()
    const reviewedBy = paramsOf(update as unknown[])[2]
    expect(reviewedBy, 'the reviewer is the caller').toBe(ADMIN_A)
    expect(reviewedBy, 'and never the body value').not.toBe(IMPERSONATED)
  })

  it('does not require the caller to name themselves', async () => {
    const res = await request(app)
      .post(`/api/v1/agents/approvals/${APPROVAL}/approve`).send({ notes: 'ok' })
    expect(res.status).toBe(200)
  })
})
