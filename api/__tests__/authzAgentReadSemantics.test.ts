/**
 * ADR-014 Phase 2C-5 §19–§22 — a read-authorized GET creates no durable work.
 *
 * Two GETs used to call `enqueueTask`, so `crossdomain.read` was sufficient to
 * write a row to `agent_tasks`:
 *
 *   GET /agents/readiness/plan/:scope/:id  → generate_readiness_plan
 *   GET /agents/risk/overview              → analyze_risk
 *
 * Both now observe the newest task for the scope. The creation paths are
 * unchanged and already existed — `POST /agents/risk/analyze`
 * (`crossdomain.write`) and, for the readiness plan, the orchestrator behind
 * `POST /agents/readiness/coordinate` (`ai.govern`). No second creation route
 * was added.
 *
 * The central assertion is the durable-job COUNT: reading may not change it, and
 * the mutation route must change it by exactly one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

/** A stand-in for the durable queue, so "did a row appear" is directly countable. */
interface FakeTask {
  id: string; tenantId: string; taskType: string; status: string
  payload: Record<string, unknown>; result?: Record<string, unknown>; createdAt: Date
}
let queue: FakeTask[] = []
let seq = 0

const enqueueTask = vi.fn(async (input: Record<string, unknown>) => {
  const t: FakeTask = {
    id: `task-${++seq}`,
    tenantId: input['tenantId'] as string,
    taskType: input['taskType'] as string,
    status: 'queued',
    payload: input['payload'] as Record<string, unknown>,
    createdAt: new Date(0),
  }
  queue.push(t)
  return t
})

const latestTaskForScope = vi.fn(async (tenantId: string, taskType: string, scopeType: string, scopeId: string) => {
  const hits = queue.filter(t =>
    t.tenantId === tenantId && t.taskType === taskType &&
    String(t.payload['scopeType'] ?? '') === scopeType &&
    String(t.payload['scopeId'] ?? '') === scopeId)
  return hits.length ? hits[hits.length - 1]! : null
})

vi.mock('../services/agents/agentTaskQueue', () => ({
  enqueueTask:          (...a: unknown[]) => enqueueTask(...(a as [Record<string, unknown>])),
  latestTaskForScope:   (...a: unknown[]) => latestTaskForScope(...(a as [string, string, string, string])),
}))
vi.mock('../services/agents/agentOrchestrator', () => ({ orchestrate: vi.fn(async () => ({ ok: true })) }))

const mockQuery = vi.fn()
vi.mock('../db/pool', () => ({
  query:       (...a: unknown[]) => mockQuery(...(a as [])),
  tenantQuery: (...a: unknown[]) => mockQuery(...(a as [])),
  tenantTransaction: async (_t: string, fn: (c: unknown) => unknown) => fn({ query: mockQuery }),
  pool: { query: (...a: unknown[]) => mockQuery(...(a as [])), connect: vi.fn() },
}))

import type { UserRole } from '../authz/capabilities'

const TENANT_A = 'tenant-aaaa'
const TENANT_B = 'tenant-bbbb'

interface Caller { id: string; tenantId: string; role: UserRole }
let caller: Caller
const setCaller = (c: Caller) => { caller = c; (globalThis as Record<string, unknown>)['__ag'] = c }

vi.mock('../auth', () => ({
  requireAuth: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    const c = (globalThis as Record<string, unknown>)['__ag'] as Caller
    req['auth'] = { sub: c.id, tid: c.tenantId, role: c.role, jti: 'jti' }
    next()
  },
  requireRole: () => (_r: unknown, _s: unknown, next: () => void) => next(),
}))
vi.mock('../middleware/tenant', () => {
  const mw = (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req['tenantId'] = ((globalThis as Record<string, unknown>)['__ag'] as Caller).tenantId
    next()
  }
  return {
    requireTenant: (...args: unknown[]) =>
      typeof args[2] === 'function'
        ? mw(args[0] as Record<string, unknown>, args[1], args[2] as () => void)
        : mw,
    invalidateTenantCache: () => {},
  }
})

import { agentRiskRouter } from '../routes/agentRisk'
import { agentReadinessRouter } from '../routes/agentReadiness'

const makeApp = () => {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/agents/risk', agentRiskRouter as never)
  app.use('/api/v1/agents/readiness', agentReadinessRouter as never)
  return app
}

beforeEach(() => {
  queue = []; seq = 0
  enqueueTask.mockClear(); latestTaskForScope.mockClear(); mockQuery.mockReset()
  mockQuery.mockImplementation(async (...a: unknown[]) => {
    const sql = a.find(x => typeof x === 'string' && /SELECT/i.test(x)) as string | undefined
    if (sql && /FROM users/i.test(sql)) {
      return { rows: [{ id: caller.id, tenant_id: caller.tenantId, role: caller.role, is_active: true }] }
    }
    return { rows: [] }
  })
  setCaller({ id: 'u-owner', tenantId: TENANT_A, role: 'owner' })
})

// `crossdomain.read` and `crossdomain.write` are both owner-only, so the
// interesting negative role here is anyone else.
const NON_HOLDERS: UserRole[] = ['admin', 'project_manager', 'engineer', 'procurement', 'field_ops', 'viewer']

// ─── 1. The reads create nothing ──────────────────────────────────────────────
describe('GET /agents/risk/overview observes, and never enqueues', () => {
  it('returns an honest empty state when nothing has been analysed', async () => {
    const res = await request(makeApp()).get('/api/v1/agents/risk/overview?scopeType=project&scopeId=p1')
    expect(res.status).toBe(200)
    expect(res.body.task).toBeNull()
    expect(queue.length, 'reading an empty scope must not create a job').toBe(0)
    expect(enqueueTask).not.toHaveBeenCalled()
  })

  it('returns the newest analysis without changing the durable job count', async () => {
    await enqueueTask({ tenantId: TENANT_A, taskType: 'analyze_risk', payload: { scopeType: 'project', scopeId: 'p1' } })
    const before = queue.length
    const snapshot = JSON.stringify(queue)

    const res = await request(makeApp()).get('/api/v1/agents/risk/overview?scopeType=project&scopeId=p1')
    expect(res.status).toBe(200)
    expect(res.body.task.taskId).toBe('task-1')
    expect(queue.length, 'the job count must be unchanged by a read').toBe(before)
    expect(JSON.stringify(queue), 'no durable job state may be altered by a read').toBe(snapshot)
  })

  it('does not create a job however many times it is read', async () => {
    for (let i = 0; i < 5; i++) {
      await request(makeApp()).get('/api/v1/agents/risk/overview?scopeType=project&scopeId=p1')
    }
    expect(queue.length).toBe(0)
  })

  it('reads only within the caller tenant', async () => {
    await enqueueTask({ tenantId: TENANT_B, taskType: 'analyze_risk', payload: { scopeType: 'project', scopeId: 'p1' } })
    const res = await request(makeApp()).get('/api/v1/agents/risk/overview?scopeType=project&scopeId=p1')
    expect(res.status).toBe(200)
    expect(res.body.task, 'a tenant B analysis is invisible to tenant A').toBeNull()
  })

  it.each(NON_HOLDERS)('refuses %s and creates nothing', async role => {
    setCaller({ id: 'u', tenantId: TENANT_A, role })
    const res = await request(makeApp()).get('/api/v1/agents/risk/overview?scopeType=project&scopeId=p1')
    expect(res.status).toBe(403)
    expect(queue.length).toBe(0)
    expect(enqueueTask).not.toHaveBeenCalled()
  })
})

describe('GET /agents/readiness/plan/:scope/:id observes, and never enqueues', () => {
  it('returns an honest empty state', async () => {
    const res = await request(makeApp()).get('/api/v1/agents/readiness/plan/project/p1')
    expect(res.status).toBe(200)
    expect(res.body.task).toBeNull()
    expect(queue.length).toBe(0)
    expect(enqueueTask).not.toHaveBeenCalled()
  })

  it('returns the newest plan without changing the durable job count', async () => {
    await enqueueTask({ tenantId: TENANT_A, taskType: 'generate_readiness_plan', payload: { scopeType: 'project', scopeId: 'p1' } })
    const snapshot = JSON.stringify(queue)

    const res = await request(makeApp()).get('/api/v1/agents/readiness/plan/project/p1')
    expect(res.status).toBe(200)
    expect(res.body.task.taskId).toBe('task-1')
    expect(JSON.stringify(queue)).toBe(snapshot)
  })

  it.each(NON_HOLDERS)('refuses %s and creates nothing', async role => {
    setCaller({ id: 'u', tenantId: TENANT_A, role })
    const res = await request(makeApp()).get('/api/v1/agents/readiness/plan/project/p1')
    expect(res.status).toBe(403)
    expect(queue.length).toBe(0)
  })
})

// ─── 2. The mutation path still works, behind write authority ─────────────────
describe('creating the job needs write authority', () => {
  it('POST /agents/risk/analyze creates exactly one job for the owner', async () => {
    const res = await request(makeApp()).post('/api/v1/agents/risk/analyze')
      .send({ scopeType: 'project', scopeId: 'p1', requestedBy: 'u-owner' })
    expect(res.status).toBe(202)
    expect(queue.length, 'exactly one durable job').toBe(1)
    expect(queue[0]!.taskType).toBe('analyze_risk')
    expect(queue[0]!.tenantId).toBe(TENANT_A)
  })

  it.each(NON_HOLDERS)('POST /agents/risk/analyze refuses %s, creating nothing', async role => {
    setCaller({ id: 'u', tenantId: TENANT_A, role })
    const res = await request(makeApp()).post('/api/v1/agents/risk/analyze')
      .send({ scopeType: 'project', scopeId: 'p1', requestedBy: 'u' })
    expect(res.status).toBe(403)
    expect(queue.length, 'a refused mutation must create no job').toBe(0)
  })

  it('binds the job to the caller tenant, not a body-supplied one', async () => {
    await request(makeApp()).post('/api/v1/agents/risk/analyze')
      .send({ scopeType: 'project', scopeId: 'p1', requestedBy: 'u-owner', tenantId: TENANT_B })
    expect(queue[0]!.tenantId, 'a payload tenant must be ignored').toBe(TENANT_A)
  })

  it('leaves the read able to see what the mutation created — the loop closes', async () => {
    await request(makeApp()).post('/api/v1/agents/risk/analyze')
      .send({ scopeType: 'project', scopeId: 'p1', requestedBy: 'u-owner' })
    const res = await request(makeApp()).get('/api/v1/agents/risk/overview?scopeType=project&scopeId=p1')
    expect(res.status).toBe(200)
    expect(res.body.task.taskId).toBe(queue[0]!.id)
    expect(queue.length, 'and the read still added nothing').toBe(1)
  })
})
