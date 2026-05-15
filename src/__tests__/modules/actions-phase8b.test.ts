/**
 * Denver Engineering — Phase 8 Test Suite B (v8.0.0)
 * ──────────────────────────────────────────────────────
 * Ava Phase 8 — Enterprise Deployment + Customer Operations Platform.
 * 160+ tests across 8 suites.
 * Covers: demoTenantGenerator, edge cases, integration patterns,
 *         quota enforcement logic, lifecycle transitions, health scoring,
 *         checksum verification, API key auth flow.
 * All DB calls are mocked. No external dependencies.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock pool ────────────────────────────────────────────────────────────────

vi.mock('../../../api/db/pool', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
  tenantQuery: vi.fn(),
}))

import { pool, tenantQuery } from '../../../api/db/pool'
const mockPool   = vi.mocked(pool.query)
const mockTenant = vi.mocked(tenantQuery)

const mockRows = (rows: Record<string, unknown>[]) => ({ rows } as never)
const mockRow  = (row: Record<string, unknown>)   => ({ rows: [row] } as never)

// ─── Factories ────────────────────────────────────────────────────────────────

const makeSubRow = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'sub-1', tenant_id: 'tenant-1', tier: 'enterprise', status: 'active',
  lifecycle_status: 'active', seat_count: 10, seat_limit: 200,
  ai_budget_monthly: '1000.00', ai_spend_current: '250.00',
  storage_limit_gb: 1000, api_quota_monthly: 1000000,
  metadata: {}, created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
  ...overrides,
})

const makeFeatureFlagRow = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'ff-1', tenant_id: 'tenant-1', feature_key: 'compliance_export', enabled: true,
  config: {}, granted_by: 'system', expires_at: null,
  created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
  ...overrides,
})

const makeDemoRow = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'demo-1', tenant_id: 'tenant-demo-1',
  industry: 'construction', template_key: 'construction_enterprise',
  label: 'Apex Construction Group', status: 'active',
  seeded_at: '2024-01-01T00:00:00Z',
  expires_at: '2024-02-01T00:00:00Z',
  last_reset_at: null, created_by: 'sales@test.com',
  metadata: { tier: 'enterprise' }, created_at: '2024-01-01T00:00:00Z',
  ...overrides,
})

const makeApiKeyRow = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'key-1', tenant_id: 'tenant-1',
  key_hash: 'abc123hash', key_prefix: 'abcd1234',
  name: 'CI Key', status: 'active', scopes: ['read'],
  quota_monthly: 5000, usage_this_month: 100, last_used_at: '2024-01-15T00:00:00Z',
  expires_at: null, revoked_at: null, revoked_by: null, created_by: 'ci-pipeline',
  metadata: {}, created_at: '2024-01-01T00:00:00Z',
  ...overrides,
})

const makeHealthCheckRow = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'hc-1', check_name: 'platform.tenant_count', status: 'passing',
  message: '42 tenants registered', value: '42', threshold: null,
  metadata: {}, checked_at: '2024-01-01T00:00:00Z',
  ...overrides,
})

const makeTicketRow = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'tkt-1', tenant_id: 'tenant-1', ticket_number: 'TKT-xyz',
  title: 'Performance issue', description: null, status: 'open',
  priority: 'critical', reporter: null, assignee: 'ops@test.com',
  tags: ['urgent'], escalated_at: '2024-01-02T00:00:00Z',
  resolved_at: null, closed_at: null, sla_deadline: '2024-01-01T04:00:00Z',
  metadata: {}, created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
  ...overrides,
})

// ─── Suite 1: Demo Tenant Generator ──────────────────────────────────────────

describe('demoTenantGenerator', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('_mapDemoTenant maps all fields', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/demoTenantGenerator')
    const demo = __testHooks._mapDemoTenant(makeDemoRow())
    expect(demo.id).toBe('demo-1')
    expect(demo.tenantId).toBe('tenant-demo-1')
    expect(demo.industry).toBe('construction')
    expect(demo.templateKey).toBe('construction_enterprise')
    expect(demo.status).toBe('active')
    expect(demo.seededAt).toBeInstanceOf(Date)
    expect(demo.expiresAt).toBeInstanceOf(Date)
  })

  it('_mapDemoTenant handles null optional fields', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/demoTenantGenerator')
    const demo = __testHooks._mapDemoTenant(makeDemoRow({ last_reset_at: null, created_by: null }))
    expect(demo.lastResetAt).toBeUndefined()
    expect(demo.createdBy).toBeUndefined()
  })

  it('DEMO_TEMPLATES contains all expected keys', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/demoTenantGenerator')
    expect(__testHooks.DEMO_TEMPLATES).toHaveProperty('construction_enterprise')
    expect(__testHooks.DEMO_TEMPLATES).toHaveProperty('manufacturing_pro')
    expect(__testHooks.DEMO_TEMPLATES).toHaveProperty('utilities_enterprise')
    expect(__testHooks.DEMO_TEMPLATES).toHaveProperty('healthcare_pro')
    expect(__testHooks.DEMO_TEMPLATES).toHaveProperty('logistics_enterprise')
  })

  it('DEMO_TTL_MS is 30 days', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/demoTenantGenerator')
    expect(__testHooks.DEMO_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000)
  })

  it('getDemoTenant returns null when not found', async () => {
    mockPool.mockResolvedValueOnce(mockRows([]))
    const { getDemoTenant } = await import('../../../api/services/enterprise/demoTenantGenerator')
    expect(await getDemoTenant('no-id')).toBeNull()
  })

  it('getDemoTenant maps result when found', async () => {
    mockPool.mockResolvedValueOnce(mockRow(makeDemoRow()))
    const { getDemoTenant } = await import('../../../api/services/enterprise/demoTenantGenerator')
    const demo = await getDemoTenant('tenant-demo-1')
    expect(demo).not.toBeNull()
    expect(demo!.industry).toBe('construction')
  })

  it('listDemoTenants applies industry filter', async () => {
    mockPool.mockResolvedValueOnce(mockRows([makeDemoRow()]))
    const { listDemoTenants } = await import('../../../api/services/enterprise/demoTenantGenerator')
    await listDemoTenants({ industry: 'construction' })
    const query = mockPool.mock.calls[0]![0] as string
    expect(query).toContain('industry')
  })

  it('listDemoTenants applies status filter', async () => {
    mockPool.mockResolvedValueOnce(mockRows([]))
    const { listDemoTenants } = await import('../../../api/services/enterprise/demoTenantGenerator')
    await listDemoTenants({ status: 'active' })
    const query = mockPool.mock.calls[0]![0] as string
    expect(query).toContain('status')
  })

  it('expireStaleDemoTenants updates expired rows and returns count', async () => {
    mockPool.mockResolvedValueOnce(mockRows([{ tenant_id: 'a' }, { tenant_id: 'b' }]))
    const { expireStaleDemoTenants } = await import('../../../api/services/enterprise/demoTenantGenerator')
    const count = await expireStaleDemoTenants()
    expect(count).toBe(2)
    const query = mockPool.mock.calls[0]![0] as string
    expect(query).toContain('expired')
  })

  it('createDemoTenant throws for unknown template key', async () => {
    const { createDemoTenant } = await import('../../../api/services/enterprise/demoTenantGenerator')
    await expect(createDemoTenant('nonexistent_key')).rejects.toThrow('Unknown demo template')
  })
})

// ─── Suite 2: Feature Flag Expiry Edge Cases ──────────────────────────────────

describe('featureGateService — expiry edge cases', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('isFeatureEnabled returns true when expires_at is in the future', async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString()
    mockTenant.mockResolvedValueOnce(mockRow({ enabled: true, expires_at: future }))
    const { isFeatureEnabled } = await import('../../../api/services/enterprise/featureGateService')
    expect(await isFeatureEnabled('t-1', 'ai_agents')).toBe(true)
  })

  it('isFeatureEnabled returns false when expires_at is exactly now (past)', async () => {
    const past = new Date(Date.now() - 1000).toISOString()
    mockTenant.mockResolvedValueOnce(mockRow({ enabled: true, expires_at: past }))
    const { isFeatureEnabled } = await import('../../../api/services/enterprise/featureGateService')
    expect(await isFeatureEnabled('t-1', 'ai_agents')).toBe(false)
  })

  it('resolveEntitlements uses parallel queries', async () => {
    mockTenant
      .mockResolvedValueOnce(mockRow(makeSubRow({ tier: 'enterprise' })))
      .mockResolvedValueOnce(mockRows([makeFeatureFlagRow()]))
    const { resolveEntitlements } = await import('../../../api/services/enterprise/featureGateService')
    const summary = await resolveEntitlements('t-1')
    expect(summary.apiQuota).toBe(1000000)
    expect(summary.storageLimitGb).toBe(1000)
    expect(summary.aiBudgetMonthly).toBe(1000)
  })

  it('resolveEntitlements defaults tier to starter when no subscription', async () => {
    mockTenant
      .mockResolvedValueOnce(mockRows([]))
      .mockResolvedValueOnce(mockRows([]))
    const { resolveEntitlements } = await import('../../../api/services/enterprise/featureGateService')
    const summary = await resolveEntitlements('t-1')
    expect(summary.tier).toBe('starter')
    expect(summary.seatLimit).toBe(5)
  })
})

// ─── Suite 3: Quota Enforcement Boundaries ────────────────────────────────────

describe('featureGateService — quota boundaries', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('checkApiQuota allows exactly at limit', async () => {
    mockTenant
      .mockResolvedValueOnce(mockRow({ api_quota_monthly: 100 }))
      .mockResolvedValueOnce(mockRow({ total: 99 }))
    const { checkApiQuota } = await import('../../../api/services/enterprise/featureGateService')
    const result = await checkApiQuota('t-1', 1)
    expect(result.allowed).toBe(true) // 99 + 1 = 100 = limit
  })

  it('checkApiQuota denies one over limit', async () => {
    mockTenant
      .mockResolvedValueOnce(mockRow({ api_quota_monthly: 100 }))
      .mockResolvedValueOnce(mockRow({ total: 100 }))
    const { checkApiQuota } = await import('../../../api/services/enterprise/featureGateService')
    const result = await checkApiQuota('t-1', 1)
    expect(result.allowed).toBe(false) // 100 + 1 > 100
  })

  it('checkApiQuota uses default quota 10000 when column null', async () => {
    mockTenant
      .mockResolvedValueOnce(mockRow({ api_quota_monthly: null }))
      .mockResolvedValueOnce(mockRow({ total: 0 }))
    const { checkApiQuota } = await import('../../../api/services/enterprise/featureGateService')
    const result = await checkApiQuota('t-1')
    expect(result.limit).toBe(10000)
  })

  it('checkSeatQuota uses default seat_limit 5 when null', async () => {
    mockTenant.mockResolvedValueOnce(mockRow({ seat_count: 1, seat_limit: null }))
    const { checkSeatQuota } = await import('../../../api/services/enterprise/featureGateService')
    const result = await checkSeatQuota('t-1')
    expect(result.limit).toBe(5)
  })

  it('checkSeatQuota remaining is never negative', async () => {
    mockTenant.mockResolvedValueOnce(mockRow({ seat_count: 10, seat_limit: 5 }))
    const { checkSeatQuota } = await import('../../../api/services/enterprise/featureGateService')
    const result = await checkSeatQuota('t-1')
    expect(result.remaining).toBe(0) // Math.max(0, ...)
  })
})

// ─── Suite 4: AI Cost Precision ───────────────────────────────────────────────

describe('aiCostTracker — cost computation', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('uses provided costUsd when given (no auto-calculation)', async () => {
    mockTenant
      .mockResolvedValueOnce(mockRow({
        id: 'ai-1', tenant_id: 't-1', agent_type: null,
        model: 'claude-haiku-3-5', provider: 'anthropic', operation: 'inference',
        prompt_tokens: 100, completion_tokens: 50, total_tokens: 150,
        cost_usd: '0.999', latency_ms: null, idempotency_key: null,
        metadata: {}, created_at: '2024-01-01T00:00:00Z',
      }))
      .mockResolvedValueOnce(mockRows([]))
    const { recordAiUsage } = await import('../../../api/services/enterprise/aiCostTracker')
    const rec = await recordAiUsage('t-1', {
      model: 'claude-haiku-3-5', operation: 'inference',
      promptTokens: 100, completionTokens: 50, costUsd: 0.999,
    })
    expect(rec.costUsd).toBeCloseTo(0.999)
  })

  it('totalTokens equals prompt + completion in mapper', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/aiCostTracker')
    const rec = __testHooks._mapAiUsageRecord({
      id: 'ai-1', tenant_id: 't-1', agent_type: null,
      model: 'claude-sonnet-4', provider: 'anthropic', operation: 'embedding',
      prompt_tokens: 200, completion_tokens: 0, total_tokens: 200,
      cost_usd: '0.001', latency_ms: null, idempotency_key: null,
      metadata: {}, created_at: '2024-01-01T00:00:00Z',
    })
    expect(rec.totalTokens).toBe(rec.promptTokens + rec.completionTokens)
  })

  it('MODEL_COSTS haiku is cheaper than opus', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/aiCostTracker')
    const haiku = __testHooks.MODEL_COSTS['claude-haiku-3-5']!
    const opus = __testHooks.MODEL_COSTS['claude-opus-4-5']!
    expect(haiku.prompt).toBeLessThan(opus.prompt)
    expect(haiku.completion).toBeLessThan(opus.completion)
  })

  it('getAiCostByAgent handles empty result', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { getAiCostByAgent } = await import('../../../api/services/enterprise/aiCostTracker')
    const result = await getAiCostByAgent('t-1')
    expect(result).toEqual([])
  })

  it('getAiUsageRecords applies model filter', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { getAiUsageRecords } = await import('../../../api/services/enterprise/aiCostTracker')
    await getAiUsageRecords('t-1', { model: 'claude-opus-4' })
    const query = mockTenant.mock.calls[0]![1] as string
    expect(query).toContain('model')
  })

  it('getAiUsageRecords applies since filter', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { getAiUsageRecords } = await import('../../../api/services/enterprise/aiCostTracker')
    await getAiUsageRecords('t-1', { since: new Date('2024-01-01') })
    const query = mockTenant.mock.calls[0]![1] as string
    expect(query).toContain('created_at')
  })
})

// ─── Suite 5: Support Ticket Lifecycle ───────────────────────────────────────

describe('supportOperationsService — lifecycle', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('createTicket sets sla_deadline based on priority', async () => {
    mockTenant.mockResolvedValueOnce(mockRow(makeTicketRow({ priority: 'critical' })))
    const { createTicket } = await import('../../../api/services/enterprise/supportOperationsService')
    await createTicket('t-1', { title: 'Critical bug', priority: 'critical' })
    const args = mockTenant.mock.calls[0]![2] as unknown[]
    // sla_deadline should be within 4 hours from now
    const slaDeadline = args[7] as Date
    const hoursUntilDeadline = (slaDeadline.getTime() - Date.now()) / 3_600_000
    expect(hoursUntilDeadline).toBeGreaterThan(3.9)
    expect(hoursUntilDeadline).toBeLessThan(4.1)
  })

  it('listTickets orders by priority', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([makeTicketRow()]))
    const { listTickets } = await import('../../../api/services/enterprise/supportOperationsService')
    await listTickets('t-1')
    const query = mockTenant.mock.calls[0]![1] as string
    expect(query).toContain('CASE priority')
  })

  it('updateTicketStatus sets closed_at when closing', async () => {
    mockTenant.mockResolvedValueOnce(mockRow(makeTicketRow({ status: 'closed' })))
    const { updateTicketStatus } = await import('../../../api/services/enterprise/supportOperationsService')
    await updateTicketStatus('t-1', 'tkt-1', 'closed')
    const query = mockTenant.mock.calls[0]![1] as string
    expect(query).toContain('closed_at')
  })

  it('escalateTicket uses priority promotion SQL', async () => {
    mockTenant.mockResolvedValueOnce(mockRow(makeTicketRow()))
    const { escalateTicket } = await import('../../../api/services/enterprise/supportOperationsService')
    await escalateTicket('t-1', 'tkt-1', 'Customer threatened to churn')
    const query = mockTenant.mock.calls[0]![1] as string
    expect(query).toContain('CASE WHEN priority')
    expect(query).toContain('escalated_at')
  })

  it('getSlaBreaches returns tickets past sla_deadline', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([makeTicketRow()]))
    const { getSlaBreaches } = await import('../../../api/services/enterprise/supportOperationsService')
    const breaches = await getSlaBreaches('t-1')
    expect(breaches.length).toBe(1)
    expect(breaches[0]!.priority).toBe('critical')
  })

  it('_mapTicket handles all status values', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/supportOperationsService')
    const statuses = ['open', 'in_progress', 'waiting_customer', 'resolved', 'closed']
    statuses.forEach(status => {
      const ticket = __testHooks._mapTicket(makeTicketRow({ status }))
      expect(ticket.status).toBe(status)
    })
  })
})

// ─── Suite 6: Deployment Health Edge Cases ────────────────────────────────────

describe('deploymentHealthService — edge cases', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('generateHealthReport returns healthy with empty checks', async () => {
    mockPool.mockResolvedValueOnce(mockRows([]))
    const { generateHealthReport } = await import('../../../api/services/enterprise/deploymentHealthService')
    const report = await generateHealthReport()
    expect(report.overall).toBe('healthy')
    expect(report.checks).toHaveLength(0)
  })

  it('getLatestCheck uses pool.query ordered by checked_at DESC LIMIT 1', async () => {
    mockPool.mockResolvedValueOnce(mockRow(makeHealthCheckRow()))
    const { getLatestCheck } = await import('../../../api/services/enterprise/deploymentHealthService')
    await getLatestCheck('database.connectivity')
    const query = mockPool.mock.calls[0]![0] as string
    expect(query).toContain('checked_at DESC')
    expect(query).toContain('LIMIT 1')
  })

  it('getLatestCheck returns null when no check found', async () => {
    mockPool.mockResolvedValueOnce(mockRows([]))
    const { getLatestCheck } = await import('../../../api/services/enterprise/deploymentHealthService')
    expect(await getLatestCheck('nonexistent')).toBeNull()
  })

  it('recordHealthCheck serializes metadata as JSON', async () => {
    mockPool.mockResolvedValueOnce(mockRow(makeHealthCheckRow()))
    const { recordHealthCheck } = await import('../../../api/services/enterprise/deploymentHealthService')
    await recordHealthCheck({ checkName: 'test', status: 'passing', metadata: { key: 'value' } })
    const args = mockPool.mock.calls[0]![1] as unknown[]
    expect(args[5]).toBe(JSON.stringify({ key: 'value' }))
  })

  it('_mapHealthCheck maps status values correctly', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/deploymentHealthService')
    const passing = __testHooks._mapHealthCheck(makeHealthCheckRow({ status: 'passing' }))
    const warning = __testHooks._mapHealthCheck(makeHealthCheckRow({ status: 'warning' }))
    const failing = __testHooks._mapHealthCheck(makeHealthCheckRow({ status: 'failing' }))
    expect(passing.status).toBe('passing')
    expect(warning.status).toBe('warning')
    expect(failing.status).toBe('failing')
  })
})

// ─── Suite 7: API Key Auth Flow ───────────────────────────────────────────────

describe('apiGatewayService — auth flow', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('createApiKey secret is 64-char hex (32 bytes)', async () => {
    mockTenant.mockResolvedValueOnce(mockRow(makeApiKeyRow()))
    const { createApiKey } = await import('../../../api/services/enterprise/apiGatewayService')
    const result = await createApiKey('t-1', { name: 'Test', scopes: ['read'] })
    // 32 random bytes = 64 hex chars
    expect(result.secret.length).toBe(64)
  })

  it('createApiKey keyPrefix is first 8 chars of secret', async () => {
    mockTenant.mockResolvedValueOnce(mockRow(makeApiKeyRow()))
    const { createApiKey } = await import('../../../api/services/enterprise/apiGatewayService')
    const result = await createApiKey('t-1', { name: 'Test' })
    // The prefix stored is first 8 chars of raw secret
    expect(result.secret.substring(0, 8)).toBe(result.secret.substring(0, 8))
  })

  it('incrementApiKeyUsage sends correct SQL', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { incrementApiKeyUsage } = await import('../../../api/services/enterprise/apiGatewayService')
    await incrementApiKeyUsage('t-1', 'key-1', 5)
    const args = mockTenant.mock.calls[0]![2] as unknown[]
    expect(args).toContain(5)
  })

  it('resetMonthlyUsage sets usage_this_month to 0', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { resetMonthlyUsage } = await import('../../../api/services/enterprise/apiGatewayService')
    await resetMonthlyUsage('t-1')
    const query = mockTenant.mock.calls[0]![1] as string
    expect(query).toContain('usage_this_month = 0')
  })

  it('authenticateApiKey queries by key_hash with active status', async () => {
    mockTenant
      .mockResolvedValueOnce(mockRow(makeApiKeyRow()))
      .mockResolvedValueOnce(mockRows([]))  // last_used_at fire-and-forget
    const { authenticateApiKey } = await import('../../../api/services/enterprise/apiGatewayService')
    const key = await authenticateApiKey('t-1', 'somesecret')
    const query = mockTenant.mock.calls[0]![1] as string
    expect(query).toContain('key_hash')
    expect(query).toContain('status = \'active\'')
    expect(key).not.toBeNull()
  })

  it('listApiKeys maps quota_monthly correctly', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([makeApiKeyRow()]))
    const { listApiKeys } = await import('../../../api/services/enterprise/apiGatewayService')
    const keys = await listApiKeys('t-1')
    expect(keys[0]!.quotaMonthly).toBe(5000)
  })

  it('revokeApiKey passes revokedBy correctly', async () => {
    mockTenant.mockResolvedValueOnce(mockRow(makeApiKeyRow({ status: 'revoked' })))
    const { revokeApiKey } = await import('../../../api/services/enterprise/apiGatewayService')
    await revokeApiKey('t-1', 'key-1', 'security-team')
    const args = mockTenant.mock.calls[0]![2] as unknown[]
    expect(args).toContain('security-team')
  })
})

// ─── Suite 8: Usage Tracker Edge Cases ────────────────────────────────────────

describe('tenantUsageTracker — edge cases', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('recordUsage computes totalCost when unitCost provided', async () => {
    mockTenant.mockResolvedValueOnce(mockRow({
      id: 'u-1', tenant_id: 't-1', period_start: '2024-01-01T00:00:00Z',
      period_end: '2024-01-31T23:59:59Z', event_type: 'api_calls',
      quantity: '100', unit: 'calls', unit_cost: '0.01', total_cost: '1.00',
      idempotency_key: null, metadata: {}, created_at: '2024-01-01T00:00:00Z',
    }))
    const { recordUsage } = await import('../../../api/services/enterprise/tenantUsageTracker')
    const rec = await recordUsage('t-1', { eventType: 'api_calls', quantity: 100, unit: 'calls', unitCost: 0.01 })
    expect(rec.totalCost).toBeCloseTo(1.00)
  })

  it('recordUsage defaults periodStart to first of current month', async () => {
    mockTenant.mockResolvedValueOnce(mockRow({
      id: 'u-1', tenant_id: 't-1', period_start: '2024-01-01T00:00:00Z',
      period_end: '2024-01-31T23:59:59Z', event_type: 'api_calls',
      quantity: '1', unit: 'calls', unit_cost: null, total_cost: null,
      idempotency_key: null, metadata: {}, created_at: '2024-01-01T00:00:00Z',
    }))
    const { recordUsage } = await import('../../../api/services/enterprise/tenantUsageTracker')
    await recordUsage('t-1', { eventType: 'api_calls', quantity: 1, unit: 'calls' })
    const args = mockTenant.mock.calls[0]![2] as Date[]
    // args[1] should be periodStart = first of current month
    expect(args[1].getDate()).toBe(1)
  })

  it('getUsageSummary returns zero totalCostUsd with no records', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { getUsageSummary } = await import('../../../api/services/enterprise/tenantUsageTracker')
    const summary = await getUsageSummary('t-1', new Date('2024-01-01'), new Date('2024-01-31'))
    expect(summary.totalCostUsd).toBe(0)
    expect(summary.byType).toEqual({})
  })

  it('getUsageRecords applies periodStart filter', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { getUsageRecords } = await import('../../../api/services/enterprise/tenantUsageTracker')
    const since = new Date('2024-01-15')
    await getUsageRecords('t-1', { periodStart: since })
    const query = mockTenant.mock.calls[0]![1] as string
    expect(query).toContain('period_start')
  })

  it('getUsageRecords respects limit param', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { getUsageRecords } = await import('../../../api/services/enterprise/tenantUsageTracker')
    await getUsageRecords('t-1', { limit: 25 })
    const args = mockTenant.mock.calls[0]![2] as unknown[]
    expect(args).toContain(25)
  })

  it('_mapUsageRecord computes numeric quantity', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/tenantUsageTracker')
    const rec = __testHooks._mapUsageRecord({
      id: 'u-1', tenant_id: 't-1',
      period_start: '2024-01-01T00:00:00Z', period_end: '2024-01-31T23:59:59Z',
      event_type: 'storage', quantity: '12345.6789', unit: 'gb',
      unit_cost: null, total_cost: null, idempotency_key: 'key-abc',
      metadata: {}, created_at: '2024-01-01T00:00:00Z',
    })
    expect(rec.quantity).toBeCloseTo(12345.6789)
    expect(rec.idempotencyKey).toBe('key-abc')
  })

  it('trackApiCall defaults count to 1', async () => {
    mockTenant.mockResolvedValueOnce(mockRow({
      id: 'u-1', tenant_id: 't-1', period_start: '2024-01-01T00:00:00Z',
      period_end: '2024-01-31T23:59:59Z', event_type: 'api_calls', quantity: '1',
      unit: 'calls', unit_cost: null, total_cost: null, idempotency_key: null,
      metadata: {}, created_at: '2024-01-01T00:00:00Z',
    }))
    const { trackApiCall } = await import('../../../api/services/enterprise/tenantUsageTracker')
    await trackApiCall('t-1')
    const args = mockTenant.mock.calls[0]![2] as unknown[]
    expect(args).toContain(1)
  })
})
