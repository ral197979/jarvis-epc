/**
 * AUD-001 regression — enterprise tenant-lifecycle authorization.
 *
 * Before the fix, lifecycle routes had only `requireAuth` and read the target
 * tenant from the URL, so ANY authenticated user could suspend/archive ANY
 * tenant. These tests assert that:
 *   - a non-privileged user cannot act on another tenant (403)
 *   - an owner/admin cannot act on a DIFFERENT tenant (403)
 *   - an owner/admin CAN act on their OWN tenant (passes guard → service runs)
 *   - the cross-tenant /subscriptions list is platform-admin only (403)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// Hoisted state + mock fns (vi.mock is hoisted above normal consts).
const h = vi.hoisted(() => ({
  identity: { sub: undefined, role: undefined, tid: undefined } as { sub?: string; role?: string; tid?: string },
  suspendTenant:    vi.fn().mockResolvedValue({ ok: true, status: 'suspended' }),
  archiveTenant:    vi.fn().mockResolvedValue({ ok: true, status: 'archived' }),
  reactivateTenant: vi.fn().mockResolvedValue({ ok: true }),
  provisionTenant:    vi.fn().mockResolvedValue({ ok: true }),
  transitionLifecycle: vi.fn().mockResolvedValue({ ok: true }),
  getLifecycleHistory: vi.fn().mockResolvedValue([]),
  getSubscription:    vi.fn().mockResolvedValue({ id: 's1' }),
  listSubscriptions:  vi.fn().mockResolvedValue([{ id: 's1' }, { id: 's2' }]),
  generateHealthReport: vi.fn().mockResolvedValue({ ok: true }),
  createDemoTenant:     vi.fn().mockResolvedValue({ ok: true }),
  listDemoTenants:      vi.fn().mockResolvedValue([]),
  resetDemoTenant:      vi.fn().mockResolvedValue({ ok: true }),
}))

// ADR-014 Phase 2A: authorization re-resolves the caller's role from the
// database, so the pool answers that lookup using the identity under test.
vi.mock('../db/pool', () => ({
  query: async (sql: string) =>
    /FROM\s+users\s+WHERE\s+id/i.test(String(sql))
      ? { rows: [{ id: h.identity.sub ?? 'u1', tenant_id: h.identity.tid, role: h.identity.role, is_active: true }], rowCount: 1 }
      : { rows: [], rowCount: 0 },
  tenantQuery: vi.fn(),
  tenantTransaction: vi.fn(),
}))

vi.mock('../auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.auth = h.identity; next() },
  AuthenticatedRequest: class {},
}))

vi.mock('../middleware/tenant', () => ({
  requireTenant: () => (req: any, _res: any, next: any) => { req.tenantId = h.identity.tid; next() },
}))

// Service layer is stubbed — we are testing the route guard, not the services.
vi.mock('../services/enterprise/tenantArchivalService', () => ({
  suspendTenant: h.suspendTenant, archiveTenant: h.archiveTenant, reactivateTenant: h.reactivateTenant,
}))
vi.mock('../services/enterprise/tenantProvisioningService', () => ({
  provisionTenant: h.provisionTenant, transitionLifecycle: h.transitionLifecycle,
  getLifecycleHistory: h.getLifecycleHistory, getSubscription: h.getSubscription,
  listSubscriptions: h.listSubscriptions,
}))

// Remaining service modules the router imports — stubbed so the real
// implementations (and their DB/side-effects) don't load during the guard test.
vi.mock('../services/enterprise/featureGateService', () => ({
  isFeatureEnabled: vi.fn(), getFeatureConfig: vi.fn(), setFeatureFlag: vi.fn(),
  listFeatureFlags: vi.fn(), checkApiQuota: vi.fn(), checkSeatQuota: vi.fn(),
  resolveEntitlements: vi.fn(),
  requireFeature: () => (_req: any, _res: any, next: any) => next(),
}))
vi.mock('../services/enterprise/tenantUsageTracker', () => ({
  recordUsage: vi.fn(), getUsageRecords: vi.fn(), getUsageSummary: vi.fn(), getCurrentMonthSummary: vi.fn(),
}))
vi.mock('../services/enterprise/aiCostTracker', () => ({
  recordAiUsage: vi.fn(), getAiUsageRecords: vi.fn(), getAiBudgetStatus: vi.fn(), getAiCostByAgent: vi.fn(),
}))
vi.mock('../services/enterprise/customerHealthEngine', () => ({ computeHealthScore: vi.fn() }))
vi.mock('../services/enterprise/supportOperationsService', () => ({
  createTicket: vi.fn(), getTicket: vi.fn(), listTickets: vi.fn(),
  updateTicketStatus: vi.fn(), escalateTicket: vi.fn(), getSlaBreaches: vi.fn(),
}))
vi.mock('../services/enterprise/complianceExportEngine', () => ({
  requestExport: vi.fn(), getExport: vi.fn(), listExports: vi.fn(),
}))
vi.mock('../services/enterprise/deploymentHealthService', () => ({
  generateHealthReport: h.generateHealthReport, runPlatformChecks: vi.fn(), recordHealthCheck: vi.fn(),
}))
vi.mock('../services/enterprise/demoTenantGenerator', () => ({
  createDemoTenant: h.createDemoTenant, getDemoTenant: vi.fn(),
  listDemoTenants: h.listDemoTenants, resetDemoTenant: h.resetDemoTenant,
}))
vi.mock('../services/enterprise/apiGatewayService', () => ({
  createApiKey: vi.fn(), listApiKeys: vi.fn(), revokeApiKey: vi.fn(),
}))

const { suspendTenant, archiveTenant, listSubscriptions, generateHealthReport, createDemoTenant, listDemoTenants, resetDemoTenant } = h

import express from 'express'
import request from 'supertest'
import enterpriseRouter from '../routes/enterprise'

const TENANT_A = '11111111-1111-1111-1111-111111111111'
const TENANT_B = '22222222-2222-2222-2222-222222222222'

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/enterprise', enterpriseRouter)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
  h.identity = {}
  delete process.env['PLATFORM_ADMIN_USER_IDS']
})

describe('AUD-001 — tenant lifecycle authorization', () => {
  it('blocks a non-privileged user from suspending ANOTHER tenant (403)', async () => {
    h.identity = { sub: 'u1', role: 'engineer', tid: TENANT_A }
    const res = await request(makeApp())
      .post(`/api/v1/enterprise/tenants/${TENANT_B}/suspend`).send({})
    expect(res.status).toBe(403)
    expect(suspendTenant).not.toHaveBeenCalled()
  })

  it('blocks an OWNER from archiving a DIFFERENT tenant (403)', async () => {
    h.identity = { sub: 'u1', role: 'owner', tid: TENANT_A }
    const res = await request(makeApp())
      .post(`/api/v1/enterprise/tenants/${TENANT_B}/archive`).send({})
    expect(res.status).toBe(403)
    expect(archiveTenant).not.toHaveBeenCalled()
  })

  it('allows an OWNER to suspend their OWN tenant (guard passes → service runs)', async () => {
    h.identity = { sub: 'u1', role: 'owner', tid: TENANT_A }
    const res = await request(makeApp())
      .post(`/api/v1/enterprise/tenants/${TENANT_A}/suspend`).send({})
    expect(res.status).toBe(200)
    expect(suspendTenant).toHaveBeenCalledWith(TENANT_A, expect.any(Object))
  })

  // BEHAVIOUR CHANGE (ADR-014 Phase 2A). The PLATFORM_ADMIN_USER_IDS allowlist
  // used to grant authority as well as cross-tenant scope, so an operator with
  // an `engineer` role could archive any tenant. Authority is now
  // `platform.identity`, and the allowlist only widens SCOPE — a platform
  // operator must still hold the capability. This fixture therefore carries the
  // platform-administrator role, which is what such an operator has in practice.
  it('allows an explicit PLATFORM admin to act on any tenant', async () => {
    h.identity = { sub: 'platform-op', role: 'admin', tid: TENANT_A }
    process.env['PLATFORM_ADMIN_USER_IDS'] = 'platform-op'
    // Router reads the env at module load; re-import in isolation.
    vi.resetModules()
    const mod = await import('../routes/enterprise')
    const app = express(); app.use(express.json()); app.use('/api/v1/enterprise', mod.default)
    const res = await request(app)
      .post(`/api/v1/enterprise/tenants/${TENANT_B}/archive`).send({})
    expect(res.status).toBe(200)
  })

  it('rejects unauthenticated callers (401)', async () => {
    h.identity = {}  // no sub
    const res = await request(makeApp())
      .post(`/api/v1/enterprise/tenants/${TENANT_B}/suspend`).send({})
    expect(res.status).toBe(401)
  })

  it('restricts the cross-tenant /subscriptions list to platform admins (403)', async () => {
    h.identity = { sub: 'u1', role: 'owner', tid: TENANT_A }
    const res = await request(makeApp()).get('/api/v1/enterprise/subscriptions')
    expect(res.status).toBe(403)
    expect(listSubscriptions).not.toHaveBeenCalled()
  })
})

/**
 * AUDIT-P1-01 regression — deployment health + demo tenant routes.
 * Before the fix these had only requireAuth — any authenticated user of ANY
 * tenant could trigger platform-wide health checks or provision/reset demo
 * tenants. Same bug class as AUD-001 above; requirePlatformAdmin already
 * existed for the lifecycle routes but these were missed in that pass.
 */
describe('AUDIT-P1-01 — deployment health + demo tenant authorization', () => {
  it('blocks a non-platform-admin owner from running platform health checks (403)', async () => {
    h.identity = { sub: 'u1', role: 'owner', tid: TENANT_A }
    const res = await request(makeApp()).get('/api/v1/enterprise/deployment/health')
    expect(res.status).toBe(403)
    expect(generateHealthReport).not.toHaveBeenCalled()
  })

  it('blocks a non-platform-admin owner from creating a demo tenant (403)', async () => {
    h.identity = { sub: 'u1', role: 'owner', tid: TENANT_A }
    const res = await request(makeApp())
      .post('/api/v1/enterprise/demo').send({ templateKey: 'x' })
    expect(res.status).toBe(403)
    expect(createDemoTenant).not.toHaveBeenCalled()
  })

  it('blocks a non-platform-admin owner from listing demo tenants (403)', async () => {
    h.identity = { sub: 'u1', role: 'owner', tid: TENANT_A }
    const res = await request(makeApp()).get('/api/v1/enterprise/demo')
    expect(res.status).toBe(403)
    expect(listDemoTenants).not.toHaveBeenCalled()
  })

  it('blocks a non-platform-admin owner from resetting a demo tenant (403)', async () => {
    h.identity = { sub: 'u1', role: 'owner', tid: TENANT_A }
    const res = await request(makeApp()).post(`/api/v1/enterprise/demo/${TENANT_B}/reset`)
    expect(res.status).toBe(403)
    expect(resetDemoTenant).not.toHaveBeenCalled()
  })

  it('allows an explicit PLATFORM admin to run health checks and manage demo tenants', async () => {
    // ADR-014 Phase 2B-1: the operator allowlist and the capability model are
    // separate axes and both must pass — the allowlist decides *which tenant* a
    // platform operator may act on, `platform.admin` decides whether the caller
    // may read platform configuration at all. An allowlisted account whose
    // database role is `engineer` is now denied the deployment-health read, which
    // is the §15 boundary. The operator here therefore holds the platform role.
    h.identity = { sub: 'platform-op', role: 'admin', tid: TENANT_A }
    process.env['PLATFORM_ADMIN_USER_IDS'] = 'platform-op'
    vi.resetModules()
    const mod = await import('../routes/enterprise')
    const app = express(); app.use(express.json()); app.use('/api/v1/enterprise', mod.default)

    const health = await request(app).get('/api/v1/enterprise/deployment/health')
    expect(health.status).toBe(200)

    const demo = await request(app).post('/api/v1/enterprise/demo').send({ templateKey: 'x' })
    expect(demo.status).toBe(201)
  })
})
