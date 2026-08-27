/**
 * ADR-014 Phase 3A §31–§32 — the agent-risk audit actor cannot be forged.
 *
 * Both risk mutations recorded `created_by` from the request body
 * (`requestedBy`). Any caller authorized to run an analysis could therefore
 * attribute it to somebody else, which makes the durable job's audit trail
 * unreliable exactly where it matters: the record of who asked for a
 * cross-domain agent action.
 *
 * The persisted actor is now the authenticated subject. This file proves the
 * forgery attempt fails at the only place that counts — the row that gets
 * written — rather than merely proving the route still answers 202.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

interface Enqueued { tenantId: string; taskType: string; createdBy: string }
let enqueued: Enqueued[] = []

const enqueueTask = vi.fn(async (input: Record<string, unknown>) => {
  enqueued.push({
    tenantId: input['tenantId'] as string,
    taskType: input['taskType'] as string,
    createdBy: input['createdBy'] as string,
  })
  return { id: `task-${enqueued.length}`, status: 'queued' }
})

vi.mock('../services/agents/agentTaskQueue', () => ({
  enqueueTask:        (...a: unknown[]) => enqueueTask(...(a as [Record<string, unknown>])),
  latestTaskForScope: vi.fn(async () => null),
}))

const mockQuery = vi.fn()
vi.mock('../db/pool', () => ({
  query:       (...a: unknown[]) => mockQuery(...a),
  tenantQuery: (...a: unknown[]) => mockQuery(...a),
  tenantTransaction: async (_t: string, fn: (c: unknown) => unknown) => fn({ query: mockQuery }),
  pool: { query: (...a: unknown[]) => mockQuery(...a), connect: vi.fn() },
}))

import type { UserRole } from '../authz/capabilities'

const TENANT = 'aaaaaaaa-0000-4000-8000-000000000001'
const USER_A = '10000000-0000-4000-8000-00000000000a'
const USER_B = '10000000-0000-4000-8000-00000000000b'

interface Caller { id: string; tenantId: string; role: UserRole }
let caller: Caller
const setCaller = (c: Caller) => { caller = c; (globalThis as Record<string, unknown>)['__actor'] = c }

vi.mock('../auth', () => ({
  requireAuth: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    const c = (globalThis as Record<string, unknown>)['__actor'] as Caller
    req['auth'] = { sub: c.id, tid: c.tenantId, role: c.role, jti: 'jti' }
    next()
  },
  requireRole: () => (_r: unknown, _s: unknown, next: () => void) => next(),
}))
vi.mock('../middleware/tenant', () => {
  const mw = (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req['tenantId'] = ((globalThis as Record<string, unknown>)['__actor'] as Caller).tenantId
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

const makeApp = () => {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/agents/risk', agentRiskRouter as never)
  return app
}

beforeEach(() => {
  enqueued = []
  enqueueTask.mockClear()
  mockQuery.mockReset()
  mockQuery.mockImplementation(async (...a: unknown[]) => {
    const sql = a.find(x => typeof x === 'string' && /SELECT/i.test(x)) as string | undefined
    if (sql && /FROM users/i.test(sql)) {
      return { rows: [{ id: caller.id, tenant_id: caller.tenantId, role: caller.role, is_active: true }] }
    }
    return { rows: [] }
  })
  setCaller({ id: USER_A, tenantId: TENANT, role: 'owner' })
})

const ROUTES = ['/api/v1/agents/risk/analyze', '/api/v1/agents/risk/mitigate'] as const

describe('the persisted actor is the authenticated principal', () => {
  it.each(ROUTES)('%s records the session subject', async url => {
    const res = await request(makeApp()).post(url).send({ scopeType: 'project', scopeId: 'p1' })
    expect(res.status).toBe(202)
    expect(enqueued).toHaveLength(1)
    expect(enqueued[0]!.createdBy).toBe(USER_A)
  })

  it.each(ROUTES)('%s ignores a forged requestedBy naming another user', async url => {
    // The core §32 case: User A authenticated, body claims User B.
    const res = await request(makeApp()).post(url)
      .send({ scopeType: 'project', scopeId: 'p1', requestedBy: USER_B })

    // Either outcome is acceptable — what is forbidden is persisting User B.
    if (res.status === 202) {
      expect(enqueued).toHaveLength(1)
      expect(enqueued[0]!.createdBy, 'the forged actor must never be persisted').toBe(USER_A)
      expect(enqueued[0]!.createdBy).not.toBe(USER_B)
    } else {
      expect(enqueued, 'a rejected request must persist nothing').toEqual([])
    }
  })

  it.each(ROUTES)('%s ignores every alias a caller might try', async url => {
    const res = await request(makeApp()).post(url).send({
      scopeType: 'project', scopeId: 'p1',
      requestedBy: USER_B, createdBy: USER_B, created_by: USER_B, actor: USER_B, userId: USER_B,
    })
    expect(res.status).toBe(202)
    expect(enqueued[0]!.createdBy).toBe(USER_A)
  })

  it.each(ROUTES)('%s still works when no actor field is sent at all', async url => {
    // The field is no longer required, because the server no longer reads it.
    const res = await request(makeApp()).post(url).send({ scopeType: 'project', scopeId: 'p1' })
    expect(res.status, 'a missing requestedBy must not 400 any more').toBe(202)
    expect(enqueued[0]!.createdBy).toBe(USER_A)
  })

  it('attributes two different callers to themselves, not to each other', async () => {
    setCaller({ id: USER_A, tenantId: TENANT, role: 'owner' })
    await request(makeApp()).post(ROUTES[0]).send({ requestedBy: USER_B })
    setCaller({ id: USER_B, tenantId: TENANT, role: 'owner' })
    await request(makeApp()).post(ROUTES[0]).send({ requestedBy: USER_A })

    expect(enqueued.map(e => e.createdBy)).toEqual([USER_A, USER_B])
  })

  it.each(ROUTES)('%s binds the job to the session tenant, not a supplied one', async url => {
    await request(makeApp()).post(url).send({ scopeType: 'project', scopeId: 'p1', tenantId: 'other-tenant' })
    expect(enqueued[0]!.tenantId).toBe(TENANT)
  })
})

describe('the mutation still requires write authority', () => {
  const NON_HOLDERS: UserRole[] = ['admin', 'project_manager', 'engineer', 'procurement', 'field_ops', 'viewer']

  it.each(NON_HOLDERS)('refuses %s and persists nothing', async role => {
    setCaller({ id: USER_A, tenantId: TENANT, role })
    const res = await request(makeApp()).post(ROUTES[0])
      .send({ scopeType: 'project', scopeId: 'p1' })
    expect(res.status).toBe(403)
    expect(enqueued, 'a refused caller must create no durable job').toEqual([])
  })
})
