/**
 * ADR-014 Phase 2A §28–§30 — a denied transition must cause nothing.
 *
 * A 403 is not sufficient evidence on its own: the question is whether the
 * business action ran anyway. These drive the real routers and assert the
 * service layer was never reached, so authorization demonstrably precedes the
 * side effect rather than racing it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

const mockQuery = vi.fn()
vi.mock('../db/pool', () => ({
  query:             (...a: unknown[]) => mockQuery(...a),
  tenantQuery:       (...a: unknown[]) => mockQuery(...a),
  tenantTransaction: vi.fn(),
  pool:              { connect: vi.fn() },
}))

// Service layers whose invocation would BE the side effect.
const spies = vi.hoisted(() => ({
  executeRecommendation: vi.fn(async () => ({ id: 'rec-1', status: 'executed' })),
  executeRunbook:        vi.fn(async () => ({ id: 'run-1', status: 'running' })),
  publishMeeting:        vi.fn(async () => ({ id: 'm-1', status: 'published' })),
  suspendTenant:         vi.fn(async () => ({ id: 't-1', status: 'suspended' })),
}))

vi.mock('../services/ai/aiGovernance', () => ({
  listRecommendations: vi.fn(), createRecommendation: vi.fn(),
  approveRecommendation: vi.fn(), rejectRecommendation: vi.fn(),
  executeRecommendation: spies.executeRecommendation,
  expireRecommendations: vi.fn(), getGovernanceSummary: vi.fn(),
}))
vi.mock('../services/runbook/runbookEngine', () => ({
  listRunbooks: vi.fn(), getRunbook: vi.fn(), createRunbook: vi.fn(),
  executeRunbook: spies.executeRunbook, listExecutions: vi.fn(),
  getExecution: vi.fn(), approveStep: vi.fn(),
}))
vi.mock('../services/meetings/meetingService', () => ({
  listMeetings: vi.fn(), getMeeting: vi.fn(), createMeeting: vi.fn(),
  updateMeeting: vi.fn(), publishMeeting: spies.publishMeeting,
  archiveMeeting: vi.fn(), addAgendaItem: vi.fn(), updateAgendaItem: vi.fn(),
  deleteAgendaItem: vi.fn(), listActionItems: vi.fn(),
}))
vi.mock('../services/enterprise/tenantArchivalService', () => ({
  archiveTenant: vi.fn(), suspendTenant: spies.suspendTenant, reactivateTenant: vi.fn(),
}))

import { principal, principalQuery, authMiddlewareFor, tenantMiddlewareFor, type TestPrincipal } from './helpers/testPrincipal'

let current: TestPrincipal
beforeEach(() => {
  mockQuery.mockReset()
  mockQuery.mockImplementation(principalQuery(() => current))
  Object.values(spies).forEach(s => s.mockClear())
})

vi.mock('../auth', () => ({
  requireAuth: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    const p = (globalThis as Record<string, unknown>)['__f5_principal'] as TestPrincipal
    req['auth'] = { sub: p.id, tid: p.jwtTenantId, role: p.jwtRole, jti: 'jti' }
    next()
  },
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}))
vi.mock('../middleware/tenant', () => ({
  requireTenant: () => (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req['tenantId'] = ((globalThis as Record<string, unknown>)['__f5_principal'] as TestPrincipal).jwtTenantId
    next()
  },
}))

/** Keep the auth mock and the principal in step. */
function setCurrent(p: TestPrincipal) {
  current = p
  ;(globalThis as Record<string, unknown>)['__f5_principal'] = p
}

const aiRouter        = (await import('../routes/aiGovernance')).aiGovernanceRouter
const runbooksRouter  = (await import('../routes/runbooks')).runbooksRouter
const meetingsRouter  = (await import('../routes/meetings')).meetingsRouter

function mount(prefix: string, router: express.Router) {
  const app = express()
  app.use(express.json())
  app.use(authMiddlewareFor(() => current))
  app.use(tenantMiddlewareFor(() => current))
  app.use(prefix, router)
  return app
}

describe('§28 — a denied transition performs no business action', () => {
  it('AI recommendation execute: 403 and the execution service never runs', async () => {
    setCurrent(principal({ role: 'project_manager' }))   // holds no ai.govern
    const res = await request(mount('/api/v1/ai', aiRouter))
      .post('/api/v1/ai/recommendations/rec-1/execute').send({})
    expect(res.status).toBe(403)
    expect(res.body).toEqual({ error: 'forbidden' })
    expect(spies.executeRecommendation).not.toHaveBeenCalled()
  })

  it('runbook execute: 403 and no execution is started', async () => {
    setCurrent(principal({ role: 'engineer' }))          // holds no platform.automation
    const res = await request(mount('/api/v1/runbooks', runbooksRouter))
      .post('/api/v1/runbooks/rb-1/execute').send({})
    expect(res.status).toBe(403)
    expect(spies.executeRunbook).not.toHaveBeenCalled()
  })

  it('meeting publish: 403 and nothing is published', async () => {
    setCurrent(principal({ role: 'field_ops' }))         // holds no docs.publish
    const res = await request(mount('/api/v1', meetingsRouter))
      .post('/api/v1/meetings/m-1/publish').send({})
    expect(res.status).toBe(403)
    expect(spies.publishMeeting).not.toHaveBeenCalled()
  })

  it('permits the authorized caller through to the service', async () => {
    setCurrent(principal({ role: 'owner' }))
    await request(mount('/api/v1/ai', aiRouter)).post('/api/v1/ai/recommendations/rec-1/execute').send({})
    expect(spies.executeRecommendation).toHaveBeenCalled()
  })
})

describe('§29 — a newly protected transition enforces before its side effect', () => {
  it('tenant suspend: 403 for a project role, and the tenant is never suspended', async () => {
    const enterpriseRouter = (await import('../routes/enterprise')).default
    setCurrent(principal({ role: 'project_manager', tenantId: 'tenant-A', jwtTenantId: 'tenant-A' }))
    const res = await request(mount('/api/v1/enterprise', enterpriseRouter))
      .post('/api/v1/enterprise/tenants/tenant-A/suspend').send({})
    expect(res.status).toBe(403)
    expect(spies.suspendTenant).not.toHaveBeenCalled()
  })
})

describe('§30 — a stale token cannot drive a newly protected transition', () => {
  it('token minted as owner, database demoted to viewer: 403 and no execution', async () => {
    setCurrent(principal({ role: 'viewer', jwtRole: 'owner' }))
    const res = await request(mount('/api/v1/runbooks', runbooksRouter))
      .post('/api/v1/runbooks/rb-1/execute').send({})
    expect(res.status).toBe(403)
    expect(spies.executeRunbook).not.toHaveBeenCalled()
  })
})

describe('§27 — authorization precedes business validation', () => {
  it('denies an unauthorized caller before any transition-specific validation', async () => {
    // A viewer posting a body that would fail validation still gets 403, not 400:
    // the caller is not entitled to attempt the transition at all.
    setCurrent(principal({ role: 'viewer' }))
    const res = await request(mount('/api/v1/ai', aiRouter))
      .post('/api/v1/ai/recommendations/rec-1/execute').send({ nonsense: true })
    expect(res.status).toBe(403)
    expect(spies.executeRecommendation).not.toHaveBeenCalled()
  })
})
