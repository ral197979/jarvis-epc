/**
 * ADR-014 Phase 2B-1 §19–§20, §35–§36 — authorization runs *before* data access.
 *
 * The sweep proves the status code. This proves the thing the status code is
 * supposed to imply: that a denied caller never causes a query, an aggregation
 * or a service lookup against the sensitive domain — so authorization cannot
 * become an existence oracle, and a denial costs nothing downstream.
 *
 * Unlike the sweep, these mount the REAL routers with their real middleware
 * chains, one representative per protected family.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

const h = vi.hoisted(() => ({
  query:            vi.fn(),
  listAnomalies:    vi.fn(),
  summarizeAnomalies: vi.fn(),
  costSnapshot:     vi.fn(),
  listProposals:    vi.fn(),
}))

vi.mock('../db/pool', () => ({
  query:             (...a: unknown[]) => h.query(...a),
  tenantQuery:       (...a: unknown[]) => h.query(...a),
  tenantTransaction: vi.fn(),
}))

import { principal, principalQuery, authMiddlewareFor, tenantMiddlewareFor, type TestPrincipal } from './helpers/testPrincipal'

let current: TestPrincipal

vi.mock('../auth', async () => {
  const actual = await vi.importActual<typeof import('../auth')>('../auth')
  return { ...actual, requireAuth: authMiddlewareFor(() => current), requireRole: () => (_r: unknown, _s: unknown, n: () => void) => n() }
})
vi.mock('../middleware/tenant', () => ({ requireTenant: () => tenantMiddlewareFor(() => current) }))

vi.mock('../services/twin/anomalyDetectionEngine', () => ({
  listAnomalies: h.listAnomalies, detectAnomalies: vi.fn(),
  resolveAnomaly: vi.fn(), markFalsePositive: vi.fn(),
}))
vi.mock('../services/twin/anomalyClassificationService', () => ({ summarizeAnomalies: h.summarizeAnomalies }))
vi.mock('../services/twin/predictiveCoordinationEngine', () => ({
  computePortfolioReadiness: vi.fn(), detectPortfolioConflicts: vi.fn(), forecastBottlenecks: vi.fn(),
}))
vi.mock('../services/twin/operationalForecastEngine', () => ({ getOrComputeForecast: vi.fn() }))
vi.mock('../services/twin/maintenanceForecastEngine', () => ({
  generateMaintenanceRecommendations: vi.fn(), computeAssetHealth: vi.fn(),
}))
vi.mock('../services/costControl/costControlService', () => ({ getCostControlSnapshot: h.costSnapshot }))
vi.mock('../services/proposals/proposalService', () => ({
  createProposal: vi.fn(), listProposals: h.listProposals, getProposal: vi.fn(),
  updateProposal: vi.fn(), submitProposal: vi.fn(), markWon: vi.fn(), markLost: vi.fn(),
  markNoBid: vi.fn(), listProposalItems: vi.fn(), addProposalItem: vi.fn(),
  updateProposalItem: vi.fn(), deleteProposalItem: vi.fn(), getProposalSummary: vi.fn(),
}))

import portfolioRouter from '../routes/portfolio'
import { costControlRouter } from '../routes/costControl'
import { proposalsRouter } from '../routes/proposals'
import { auditRouter } from '../routes/audit'
import { integrationsRouter } from '../routes/integrations'

/** Mounted exactly as server.ts mounts them. */
function app() {
  const a = express()
  a.use(express.json())
  a.use('/api/v1/portfolio', authMiddlewareFor(() => current), tenantMiddlewareFor(() => current), portfolioRouter as never)
  a.use('/api/v1', costControlRouter as never)
  a.use('/api/v1', proposalsRouter as never)
  a.use('/api/v1/audit', auditRouter as never)
  a.use('/api/v1/integrations', integrationsRouter as never)
  return a
}

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset()
  h.query.mockImplementation(principalQuery(() => current))
  h.listAnomalies.mockResolvedValue([])
  h.summarizeAnomalies.mockReturnValue({})
  h.costSnapshot.mockResolvedValue({})
  h.listProposals.mockResolvedValue([])
})

/** Queries that are not the current-user authorization lookup. */
function domainQueries() {
  return h.query.mock.calls.filter(args =>
    !args.some(a => typeof a === 'string' && /FROM\s+users\s+WHERE\s+id/i.test(a)))
}

const FAMILIES = [
  { family: 'portfolio', path: '/api/v1/portfolio/anomalies',           service: () => h.listAnomalies },
  { family: 'cost',      path: '/api/v1/projects/p1/cost-control',      service: () => h.costSnapshot  },
  { family: 'crm',       path: '/api/v1/proposals',                     service: () => h.listProposals },
  { family: 'audit',     path: '/api/v1/audit',                         service: null                  },
  { family: 'platform',  path: '/api/v1/integrations',                  service: null                  },
] as const

// ─── §19 — a denied read never touches the data ───────────────────────────────
describe.each(FAMILIES)('$family: an unauthorized read stops before data access', ({ path, service }) => {
  it('returns 403 and invokes no sensitive service or query', async () => {
    current = principal({ role: 'viewer' })
    const res = await request(app()).get(path)

    expect(res.status).toBe(403)
    expect(res.body).toEqual({ error: 'forbidden' })
    if (service) expect(service(), 'the domain service ran for a denied caller').not.toHaveBeenCalled()
    expect(domainQueries(),
      `a denied caller caused ${domainQueries().length} domain quer(ies)`).toEqual([])
  })

  it('reaches the data for a caller who holds the capability', async () => {
    current = principal({ role: 'owner' })
    const res = await request(app()).get(path)
    expect(res.status, 'owner must cross the gate').toBeLessThan(400)
  })
})

// ─── §20 — no existence oracle ────────────────────────────────────────────────
describe('a denial discloses nothing about what exists', () => {
  it('answers identically whether or not the record exists', async () => {
    current = principal({ role: 'viewer' })

    h.listAnomalies.mockResolvedValue([{ id: 'a1', severity: 'critical' }])
    const withData = await request(app()).get('/api/v1/portfolio/anomalies')

    h.listAnomalies.mockResolvedValue([])
    const withoutData = await request(app()).get('/api/v1/portfolio/anomalies')

    expect(withData.status).toBe(withoutData.status)
    expect(withData.body).toEqual(withoutData.body)
    expect(withData.body).toEqual({ error: 'forbidden' })
    expect(h.listAnomalies).not.toHaveBeenCalled()
  })

  it('does not echo the required capability or the caller role in the denial', async () => {
    current = principal({ role: 'project_manager' })
    const res = await request(app()).get('/api/v1/projects/p1/cost-control')
    expect(res.status).toBe(403)
    expect(JSON.stringify(res.body)).not.toMatch(/cost\.view|project_manager|capability/i)
  })
})

// ─── §35 — the stale-token proof on a real high-sensitivity route ─────────────
describe('a stale token cannot read a high-sensitivity domain', () => {
  it('denies cost data when the token says owner and the database says viewer', async () => {
    current = principal({ role: 'viewer', jwtRole: 'owner' })
    const res = await request(app()).get('/api/v1/projects/p1/cost-control')
    expect(res.status).toBe(403)
    expect(h.costSnapshot).not.toHaveBeenCalled()
  })

  it('denies the audit trail when the token says admin and the database says engineer', async () => {
    current = principal({ role: 'engineer', jwtRole: 'admin' })
    const res = await request(app()).get('/api/v1/audit')
    expect(res.status).toBe(403)
    expect(domainQueries()).toEqual([])
  })

  it('denies portfolio data to a demoted owner whose account is now inactive', async () => {
    current = principal({ role: 'owner', active: false, jwtRole: 'owner' })
    const res = await request(app()).get('/api/v1/portfolio/anomalies')
    expect(res.status).toBe(401)
    expect(h.listAnomalies).not.toHaveBeenCalled()
  })
})

// ─── §36 — capability authorization does not weaken tenant isolation ──────────
describe('tenant isolation survives the new read guards', () => {
  it('scopes an authorized cross-tenant read to the caller tenant, not the requested one', async () => {
    // Tenant A owner, holding cost.view, asking for a project that lives in
    // tenant B: the capability opens the domain, the tenant context still
    // decides the rows, and the route keeps whatever existence-hiding it had.
    current = principal({ role: 'owner', tenantId: 'tenant-a', jwtTenantId: 'tenant-a' })
    await request(app()).get('/api/v1/projects/tenant-b-project/cost-control')
    expect(h.costSnapshot).toHaveBeenCalledWith('tenant-a', 'tenant-b-project')
  })

  it('resolves the current user once per request, not once per guard', async () => {
    current = principal({ role: 'owner' })
    await request(app()).get('/api/v1/audit')
    const lookups = h.query.mock.calls.filter(args =>
      args.some(a => typeof a === 'string' && /FROM\s+users\s+WHERE\s+id/i.test(a)))
    expect(lookups.length, 'the current-role lookup must not repeat per guard').toBe(1)
  })
})
