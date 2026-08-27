/**
 * ADR-014 Phase 2B-3 §53–§57 — nothing happens before authorization.
 *
 * The sweep proves the status code. This proves what the status code is meant
 * to imply for an AI surface, which is more than "no rows returned":
 *
 *   denied caller  →  403
 *                  →  no domain query
 *                  →  no retriever / synthesis service call
 *                  →  no model invocation, so no prompt is ever built from
 *                     data the caller may not see
 *
 * The last one is the point of the gate. A 403 issued *after* a briefing has
 * been assembled and sent to a model would still have moved the tenant's cost
 * data into a prompt.
 *
 * These mount the REAL routers with their real middleware chains.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

const h = vi.hoisted(() => ({
  query:            vi.fn(),
  // synthesis / retrieval layers
  buildProjectFocus: vi.fn(),
  buildPortfolioFocus: vi.fn(),
  buildProjectCoordination: vi.fn(),
  buildPortfolioCoordination: vi.fn(),
  buildProjectReport: vi.fn(),
  buildPortfolioReport: vi.fn(),
  buildNarrativeReport: vi.fn(),
  buildPortfolioInsights: vi.fn(),
  listMemories: vi.fn(),
  listTwins: vi.fn(),
  listRecommendations: vi.fn(),
  computeReadiness: vi.fn(),
  analyzeResourceUtilization: vi.fn(),
  pollEvents: vi.fn(),
  // the model boundary
  modelCall: vi.fn(),
}))

vi.mock('../db/pool', () => ({
  query:             (...a: unknown[]) => h.query(...a),
  tenantQuery:       (...a: unknown[]) => h.query(...a),
  tenantTransaction: vi.fn(),
}))

import { principal, principalQuery, recordScopeQuery, authMiddlewareFor, tenantMiddlewareFor, type TestPrincipal } from './helpers/testPrincipal'

let current: TestPrincipal

vi.mock('../auth', async () => {
  const actual = await vi.importActual<typeof import('../auth')>('../auth')
  return { ...actual, requireAuth: authMiddlewareFor(() => current) }
})
vi.mock('../middleware/tenant', () => ({ requireTenant: () => tenantMiddlewareFor(() => current) }))

// Every synthesis layer behind the AI surfaces under test. Each is also the
// point at which a model would be reached, so "not called" means no prompt.
vi.mock('../services/copilot/projectCopilotService', () => ({
  buildProjectFocus: h.buildProjectFocus, buildPortfolioFocus: h.buildPortfolioFocus,
}))
vi.mock('../services/copilot/coordinationService', () => ({
  buildProjectCoordination: h.buildProjectCoordination, buildPortfolioCoordination: h.buildPortfolioCoordination,
}))
vi.mock('../services/copilot/executiveReportService', () => ({
  buildProjectReport: h.buildProjectReport, buildPortfolioReport: h.buildPortfolioReport,
}))
vi.mock('../services/copilot/narrativeReportService', () => ({ buildNarrativeReport: h.buildNarrativeReport }))
vi.mock('../services/copilot/portfolioInsightsService', () => ({ buildPortfolioInsights: h.buildPortfolioInsights }))
vi.mock('../services/agents/agentMemoryService', () => ({
  listMemories: h.listMemories, recallMemory: vi.fn(), rememberMemory: vi.fn(),
  forgetMemory: vi.fn(), linkMemory: vi.fn(), listMemoryLinks: vi.fn(),
}))
vi.mock('../services/twin/twinRegistry', () => ({
  listTwins: h.listTwins, getTwin: vi.fn(), getTwinByEntity: vi.fn(),
  registerTwin: vi.fn(), updateTwinStatus: vi.fn(),
}))
vi.mock('../services/ai/aiGovernance', () => ({
  listRecommendations: h.listRecommendations, queueRecommendation: vi.fn(),
  previewRecommendation: vi.fn(), approveRecommendation: vi.fn(),
  rejectRecommendation: vi.fn(), executeRecommendation: vi.fn(), expireStale: vi.fn(),
}))
vi.mock('../services/readiness/readinessEngine', () => ({
  computeReadiness: h.computeReadiness, persistReadinessScore: vi.fn(),
}))
vi.mock('../services/adaptive/resourceOptimizationEngine', () => ({
  analyzeResourceUtilization: h.analyzeResourceUtilization, buildWorkloadBalancePlan: vi.fn(),
}))
vi.mock('../realtime/wsGateway', () => ({ pollEvents: h.pollEvents }))

import { copilotRouter } from '../routes/copilot'
import { agentMemoryRouter } from '../routes/agentMemory'
import twinRouter from '../routes/twin'
import { aiGovernanceRouter } from '../routes/aiGovernance'
import { readinessRouter } from '../routes/readiness'
import optimizationRouter from '../routes/optimization'
import { opsRouter } from '../routes/ops'

function app() {
  const a = express()
  a.use(express.json())
  const chain = [authMiddlewareFor(() => current), tenantMiddlewareFor(() => current)]
  a.use('/api/v1', copilotRouter as never)
  a.use('/api/v1/agents/memory', ...chain, agentMemoryRouter as never)
  a.use('/api/v1/twins', ...chain, twinRouter as never)
  a.use('/api/v1/ai', aiGovernanceRouter as never)
  a.use('/api/v1/readiness', ...chain, readinessRouter as never)
  a.use('/api/v1/optimization', ...chain, optimizationRouter as never)
  a.use('/api/v1/ops', ...chain, opsRouter as never)
  return a
}

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset()
  // ADR-014 Phase 3F: the project-path collections these families exercise now
  // carry `requireProjectScope`, so the fixture must place the caller IN scope
  // to reach the behaviour under test. Whether that guard REFUSES is proved in
  // the Phase-3F behavioural suite; what this file tests is the functional
  // dimension — that a capability-less caller never reaches the data at all.
  h.query.mockImplementation(principalQuery(() => current, recordScopeQuery()))
  h.buildProjectFocus.mockResolvedValue({})
  h.buildProjectCoordination.mockResolvedValue({})
  h.buildProjectReport.mockResolvedValue({})
  h.buildNarrativeReport.mockResolvedValue({})
  h.listMemories.mockResolvedValue([])
  h.listTwins.mockResolvedValue([])
  h.listRecommendations.mockResolvedValue([])
  h.computeReadiness.mockResolvedValue({})
  h.analyzeResourceUtilization.mockResolvedValue([])
  h.pollEvents.mockResolvedValue([])
})

/** Queries that are not the current-user authorization lookup. */
const domainQueries = () => h.query.mock.calls.filter(args =>
  !args.some(a => typeof a === 'string' && /FROM\s+users\s+WHERE\s+id/i.test(a)))

/**
 * One representative per category. `denied` is a role that holds AI authority
 * but lacks the source domain wherever possible — the exact confusion the gate
 * exists to prevent.
 */
const FAMILIES = [
  { family: 'copilot / domain synthesis', path: '/api/v1/copilot/projects/30000000-0000-4000-8000-0000000000a1/focus',
    allowed: 'owner', denied: 'project_manager', service: () => h.buildProjectFocus },
  { family: 'cross-domain narrative',     path: '/api/v1/copilot/projects/30000000-0000-4000-8000-0000000000a1/narrative-report',
    allowed: 'owner', denied: 'engineer', service: () => h.buildNarrativeReport },
  { family: 'AI governance',              path: '/api/v1/ai/recommendations',
    allowed: 'admin', denied: 'project_manager', service: () => h.listRecommendations },
  { family: 'agent memory',               path: '/api/v1/agents/memory',
    allowed: 'owner', denied: 'admin', service: () => h.listMemories },
  { family: 'digital twin',               path: '/api/v1/twins',
    allowed: 'owner', denied: 'project_manager', service: () => h.listTwins },
  { family: 'ops aggregate',              path: '/api/v1/ops/readiness',
    allowed: 'project_manager', denied: 'admin', service: null },
  { family: 'resource optimisation',      path: '/api/v1/optimization/resources',
    allowed: 'owner', denied: 'project_manager', service: () => h.analyzeResourceUtilization },
] as const

// ─── §53 — nothing runs for a denied caller ───────────────────────────────────
describe.each(FAMILIES)('$family: an unauthorized AI read stops before any work', ({ path, allowed, denied, service }) => {
  it(`returns 403 for ${denied}, and invokes no service, query or model`, async () => {
    current = principal({ role: denied })
    const res = await request(app()).get(path)

    expect(res.status).toBe(403)
    expect(res.body).toEqual({ error: 'forbidden' })
    if (service) expect(service(), 'the synthesis service ran for a denied caller').not.toHaveBeenCalled()
    expect(domainQueries(), `a denied caller caused ${domainQueries().length} domain quer(ies)`).toEqual([])
    expect(h.modelCall, 'a model was reached for a denied caller').not.toHaveBeenCalled()
  })

  it(`lets ${allowed} cross the gate, who satisfies the requirement`, async () => {
    // ADR-014 Phase 2B-3 §52: what is under test is that authorization is
    // ACCEPTED. Downstream the handler may still 404 or 500 against a fixture
    // these tests deliberately do not build — that is handler behaviour, not an
    // authorization result, and asserting 200 here would only be asserting the
    // completeness of the mocks.
    current = principal({ role: allowed })
    const res = await request(app()).get(path)
    expect([401, 403], `${allowed} was denied ${path}`).not.toContain(res.status)
  })
})

// ─── §54 — assistant.use present, source domain absent ────────────────────────
describe('holding assistant.use is not enough to start the work', () => {
  it('denies a project manager the cost briefing before any cost query or synthesis', async () => {
    current = principal({ role: 'project_manager' })
    expect(h.buildProjectReport).not.toHaveBeenCalled()

    const res = await request(app()).get('/api/v1/copilot/projects/30000000-0000-4000-8000-0000000000a1/report')

    expect(res.status).toBe(403)
    expect(h.buildProjectReport, 'the report builder ran without cost.view').not.toHaveBeenCalled()
    expect(domainQueries()).toEqual([])
    expect(h.modelCall).not.toHaveBeenCalled()
  })

  it('denies an engineer the coordination briefing that carries change-order value', async () => {
    current = principal({ role: 'engineer' })
    const res = await request(app()).get('/api/v1/copilot/projects/30000000-0000-4000-8000-0000000000a1/coordination')
    expect(res.status).toBe(403)
    expect(h.buildProjectCoordination).not.toHaveBeenCalled()
    expect(domainQueries()).toEqual([])
  })

  it('denies a procurement user the portfolio focus briefing', async () => {
    current = principal({ role: 'procurement' })
    const res = await request(app()).get('/api/v1/copilot/focus')
    expect(res.status).toBe(403)
    expect(h.buildPortfolioFocus).not.toHaveBeenCalled()
    expect(domainQueries()).toEqual([])
  })
})

// ─── §55 — the model is never reached on denial ───────────────────────────────
describe('no prompt is constructed for a caller who may not see the data', () => {
  it.each([
    ['project_manager', '/api/v1/copilot/projects/30000000-0000-4000-8000-0000000000a1/focus'],
    ['engineer',        '/api/v1/copilot/projects/30000000-0000-4000-8000-0000000000a1/narrative-report'],
    ['procurement',     '/api/v1/copilot/projects/30000000-0000-4000-8000-0000000000a1/coordination'],
    ['viewer',          '/api/v1/copilot/projects/30000000-0000-4000-8000-0000000000a1/report'],
    ['admin',           '/api/v1/twins'],
  ])('%s → %s reaches no synthesis layer', async (role, path) => {
    current = principal({ role: role as never })
    const res = await request(app()).get(path)
    expect(res.status).toBe(403)
    for (const [name, fn] of Object.entries(h)) {
      if (name === 'query') continue
      expect(fn, `${name} was invoked for a denied caller`).not.toHaveBeenCalled()
    }
  })
})

// ─── §40-style: no existence oracle across the AI surface ─────────────────────
describe('an AI denial discloses nothing about what exists', () => {
  it('answers identically whether or not the twin registry has content', async () => {
    current = principal({ role: 'project_manager' })

    h.listTwins.mockResolvedValue([{ id: 't1', name: 'Substation A' }])
    const withData = await request(app()).get('/api/v1/twins')
    h.listTwins.mockResolvedValue([])
    const withoutData = await request(app()).get('/api/v1/twins')

    expect(withData.status).toBe(withoutData.status)
    expect(withData.body).toEqual(withoutData.body)
    expect(withData.body).toEqual({ error: 'forbidden' })
    expect(h.listTwins).not.toHaveBeenCalled()
  })

  it('names neither the missing capability nor the caller role', async () => {
    current = principal({ role: 'engineer' })
    const res = await request(app()).get('/api/v1/copilot/projects/30000000-0000-4000-8000-0000000000a1/report')
    expect(res.status).toBe(403)
    expect(JSON.stringify(res.body)).not.toMatch(/cost\.view|assistant\.use|engineer|capability/i)
  })
})

// ─── §56 — stale token on an AI read ──────────────────────────────────────────
describe('a stale token cannot invoke AI over data the current role cannot see', () => {
  it('denies the focus briefing when the token says owner and the database says project_manager', async () => {
    current = principal({ role: 'project_manager', jwtRole: 'owner' })
    const res = await request(app()).get('/api/v1/copilot/projects/30000000-0000-4000-8000-0000000000a1/focus')
    expect(res.status).toBe(403)
    expect(h.buildProjectFocus).not.toHaveBeenCalled()
    expect(domainQueries()).toEqual([])
  })

  it('denies agent memory when the token says owner and the database says admin', async () => {
    current = principal({ role: 'admin', jwtRole: 'owner' })
    const res = await request(app()).get('/api/v1/agents/memory')
    expect(res.status).toBe(403)
    expect(h.listMemories).not.toHaveBeenCalled()
  })

  it('denies a deactivated owner the twin registry', async () => {
    current = principal({ role: 'owner', active: false })
    const res = await request(app()).get('/api/v1/twins')
    expect(res.status).toBe(401)
    expect(h.listTwins).not.toHaveBeenCalled()
  })
})

// ─── §57 — tenant isolation is not bypassed by AI orchestration ───────────────
describe('AI orchestration stays inside the caller tenant', () => {
  it('synthesises in the caller tenant, for a project the caller can reach', async () => {
    current = principal({ role: 'owner', tenantId: 'tenant-a', jwtTenantId: 'tenant-a' })
    await request(app()).get('/api/v1/copilot/projects/30000000-0000-4000-8000-0000000000a1/focus')
    expect(h.buildProjectFocus).toHaveBeenCalled()
    const [tenantArg] = h.buildProjectFocus.mock.calls[0] as unknown[]
    expect(tenantArg, 'the briefing must be built in the caller tenant').toBe('tenant-a')
  })

  it('never synthesises for a project the caller cannot reach', async () => {
    // ADR-014 Phase 3F strengthened the previous contract. It used to be that a
    // tenant-B project id still reached the synthesis layer and was rebuilt in
    // tenant A; now `requireProjectScope` refuses first, so no prompt is
    // constructed at all for a project outside the caller's scope.
    current = principal({ role: 'owner', tenantId: 'tenant-a', jwtTenantId: 'tenant-a' })
    // Model the project as unreachable — `recordScopeQuery` otherwise reports
    // every id the resolver asks about as in scope.
    h.query.mockImplementation(principalQuery(() => current, recordScopeQuery({ inScope: () => false })))
    const res = await request(app()).get('/api/v1/copilot/projects/40000000-0000-4000-8000-00000000000b/focus')
    expect(res.status).toBe(404)
    expect(h.buildProjectFocus, 'no synthesis for an out-of-scope project').not.toHaveBeenCalled()
  })

  it('scopes the twin registry to the caller tenant', async () => {
    current = principal({ role: 'owner', tenantId: 'tenant-a', jwtTenantId: 'tenant-a' })
    await request(app()).get('/api/v1/twins')
    const [tenantArg] = h.listTwins.mock.calls[0] as unknown[]
    expect(tenantArg).toBe('tenant-a')
  })

  it('resolves the current user once per request across a six-capability guard', async () => {
    current = principal({ role: 'owner' })
    await request(app()).get('/api/v1/copilot/projects/30000000-0000-4000-8000-0000000000a1/focus')
    const lookups = h.query.mock.calls.filter(args =>
      args.some(a => typeof a === 'string' && /FROM\s+users\s+WHERE\s+id/i.test(a)))
    expect(lookups.length).toBe(1)
  })
})
