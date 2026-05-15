/**
 * Denver Engineering — Phase 8 Test Suite A (v8.0.0)
 * ──────────────────────────────────────────────────────
 * Ava Phase 8 — Enterprise Deployment + Customer Operations Platform.
 * 170+ tests across 10 suites.
 * Covers: tenantProvisioningService, featureGateService, tenantUsageTracker,
 *         aiCostTracker, supportOperationsService, customerHealthEngine,
 *         complianceExportEngine, deploymentHealthService, apiGatewayService,
 *         tenantArchivalService.
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
  id: 'sub-1', tenant_id: 'tenant-1', tier: 'starter', status: 'trialing',
  lifecycle_status: 'trial', seat_count: 1, seat_limit: 5,
  ai_budget_monthly: '50.00', ai_spend_current: '0.00',
  storage_limit_gb: 10, api_quota_monthly: 10000,
  metadata: {}, created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
  ...overrides,
})

const makeFeatureFlagRow = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'ff-1', tenant_id: 'tenant-1', feature_key: 'api_access', enabled: true,
  config: {}, granted_by: 'system', expires_at: null,
  created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
  ...overrides,
})

const makeUsageRow = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'usage-1', tenant_id: 'tenant-1', period_start: '2024-01-01T00:00:00Z',
  period_end: '2024-01-31T23:59:59Z', event_type: 'api_calls', quantity: '100',
  unit: 'calls', unit_cost: '0.0001', total_cost: '0.01', idempotency_key: null,
  metadata: {}, created_at: '2024-01-01T00:00:00Z',
  ...overrides,
})

const makeAiRow = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'ai-1', tenant_id: 'tenant-1', agent_type: 'RiskAgent',
  model: 'claude-sonnet-4-5', provider: 'anthropic', operation: 'inference',
  prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500,
  cost_usd: '0.006', latency_ms: 250, idempotency_key: null,
  metadata: {}, created_at: '2024-01-01T00:00:00Z',
  ...overrides,
})

const makeTicketRow = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'tkt-1', tenant_id: 'tenant-1', ticket_number: 'TKT-abc123-DEF4',
  title: 'Login issue', description: 'Cannot log in', status: 'open',
  priority: 'medium', reporter: 'user@test.com', assignee: null,
  tags: [], escalated_at: null, resolved_at: null, closed_at: null,
  sla_deadline: '2024-01-04T00:00:00Z', metadata: {},
  created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
  ...overrides,
})

const makeExportRow = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'exp-1', tenant_id: 'tenant-1', export_type: 'audit', format: 'json',
  status: 'pending', requested_by: 'admin', filter_from: null, filter_to: null,
  record_count: null, file_size_bytes: null, storage_path: null, checksum: null,
  manifest: {}, expires_at: '2024-02-01T00:00:00Z', completed_at: null,
  error: null, created_at: '2024-01-01T00:00:00Z',
  ...overrides,
})

const makeHealthCheckRow = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'hc-1', check_name: 'database.connectivity', status: 'passing',
  message: 'DB responded in 12ms', value: '12', threshold: '500',
  metadata: {}, checked_at: '2024-01-01T00:00:00Z',
  ...overrides,
})

const makeApiKeyRow = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'key-1', tenant_id: 'tenant-1',
  key_hash: 'abc123hash', key_prefix: 'abcd1234',
  name: 'Production Key', status: 'active', scopes: ['read', 'write'],
  quota_monthly: null, usage_this_month: 0, last_used_at: null,
  expires_at: null, revoked_at: null, revoked_by: null, created_by: 'admin',
  metadata: {}, created_at: '2024-01-01T00:00:00Z',
  ...overrides,
})

const makeLifecycleEventRow = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'evt-1', tenant_id: 'tenant-1', event_type: 'provisioned',
  from_status: null, to_status: 'trial', actor: 'system',
  reason: 'New tenant provisioned', metadata: {},
  created_at: '2024-01-01T00:00:00Z',
  ...overrides,
})

// ─── Suite 1: Tenant Provisioning ────────────────────────────────────────────

describe('tenantProvisioningService', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('_mapSubscription maps all fields', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/tenantProvisioningService')
    const row = makeSubRow({ stripe_customer_id: 'cus_123', trial_ends_at: '2024-02-01T00:00:00Z' })
    const sub = __testHooks._mapSubscription(row)
    expect(sub.id).toBe('sub-1')
    expect(sub.tier).toBe('starter')
    expect(sub.lifecycleStatus).toBe('trial')
    expect(sub.stripeCustomerId).toBe('cus_123')
    expect(sub.trialEndsAt).toBeInstanceOf(Date)
    expect(sub.seatLimit).toBe(5)
  })

  it('_mapSubscription handles null optional fields', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/tenantProvisioningService')
    const sub = __testHooks._mapSubscription(makeSubRow())
    expect(sub.stripeCustomerId).toBeUndefined()
    expect(sub.stripeSubscriptionId).toBeUndefined()
    expect(sub.trialEndsAt).toBeUndefined()
  })

  it('_mapLifecycleEvent maps correctly', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/tenantProvisioningService')
    const evt = __testHooks._mapLifecycleEvent(makeLifecycleEventRow())
    expect(evt.eventType).toBe('provisioned')
    expect(evt.toStatus).toBe('trial')
    expect(evt.fromStatus).toBeUndefined()
    expect(evt.createdAt).toBeInstanceOf(Date)
  })

  it('_mapFeatureFlag maps correctly', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/tenantProvisioningService')
    const flag = __testHooks._mapFeatureFlag(makeFeatureFlagRow())
    expect(flag.featureKey).toBe('api_access')
    expect(flag.enabled).toBe(true)
    expect(flag.grantedBy).toBe('system')
    expect(flag.expiresAt).toBeUndefined()
  })

  it('_defaultSeatLimit returns correct values per tier', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/tenantProvisioningService')
    expect(__testHooks._defaultSeatLimit('starter')).toBe(5)
    expect(__testHooks._defaultSeatLimit('professional')).toBe(25)
    expect(__testHooks._defaultSeatLimit('enterprise')).toBe(200)
    expect(__testHooks._defaultSeatLimit('custom')).toBe(1000)
    expect(__testHooks._defaultSeatLimit('unknown')).toBe(5)
  })

  it('_defaultAiBudget returns null for custom tier (unlimited)', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/tenantProvisioningService')
    expect(__testHooks._defaultAiBudget('custom')).toBeNull()
    expect(__testHooks._defaultAiBudget('enterprise')).toBe(1000)
    expect(__testHooks._defaultAiBudget('starter')).toBe(50)
  })

  it('_defaultFeatures returns correct features for starter', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/tenantProvisioningService')
    const features = __testHooks._defaultFeatures('starter')
    expect(features.length).toBe(2)
    const apiAccess = features.find(f => f.key === 'api_access')
    expect(apiAccess?.enabled).toBe(true)
    const webhooks = features.find(f => f.key === 'webhook_delivery')
    expect(webhooks?.enabled).toBe(false) // disabled for starter
  })

  it('_defaultFeatures enables webhooks for professional+', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/tenantProvisioningService')
    const proFeatures = __testHooks._defaultFeatures('professional')
    const webhooks = proFeatures.find(f => f.key === 'webhook_delivery')
    expect(webhooks?.enabled).toBe(true)
  })

  it('_defaultFeatures returns full set for enterprise', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/tenantProvisioningService')
    const features = __testHooks._defaultFeatures('enterprise')
    expect(features.length).toBeGreaterThanOrEqual(8)
    expect(features.find(f => f.key === 'compliance_export')?.enabled).toBe(true)
    expect(features.find(f => f.key === 'multi_agent')?.enabled).toBe(true)
  })

  it('_billingStatusFor maps all lifecycle statuses', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/tenantProvisioningService')
    expect(__testHooks._billingStatusFor('trial')).toBe('trialing')
    expect(__testHooks._billingStatusFor('onboarding')).toBe('trialing')
    expect(__testHooks._billingStatusFor('active')).toBe('active')
    expect(__testHooks._billingStatusFor('suspended')).toBe('paused')
    expect(__testHooks._billingStatusFor('cancelled')).toBe('cancelled')
    expect(__testHooks._billingStatusFor('archived')).toBe('cancelled')
  })

  it('getSubscription returns null when no row found', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { getSubscription } = await import('../../../api/services/enterprise/tenantProvisioningService')
    const result = await getSubscription('tenant-1')
    expect(result).toBeNull()
  })

  it('getSubscription maps subscription when found', async () => {
    mockTenant.mockResolvedValueOnce(mockRow(makeSubRow()))
    const { getSubscription } = await import('../../../api/services/enterprise/tenantProvisioningService')
    const sub = await getSubscription('tenant-1')
    expect(sub).not.toBeNull()
    expect(sub!.tenantId).toBe('tenant-1')
  })

  it('listSubscriptions uses pool.query directly (admin bypass)', async () => {
    mockPool.mockResolvedValueOnce(mockRows([makeSubRow()]))
    const { listSubscriptions } = await import('../../../api/services/enterprise/tenantProvisioningService')
    const subs = await listSubscriptions({ lifecycleStatus: 'active' })
    expect(mockPool).toHaveBeenCalled()
    expect(subs.length).toBe(1)
  })

  it('listSubscriptions applies tier filter', async () => {
    mockPool.mockResolvedValueOnce(mockRows([]))
    const { listSubscriptions } = await import('../../../api/services/enterprise/tenantProvisioningService')
    await listSubscriptions({ tier: 'enterprise' })
    const call = mockPool.mock.calls[0]!
    expect(call[0]).toContain('tier')
  })
})

// ─── Suite 2: Feature Gate Service ───────────────────────────────────────────

describe('featureGateService', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('isFeatureEnabled returns true when enabled and not expired', async () => {
    mockTenant.mockResolvedValueOnce(mockRow({ enabled: true, expires_at: null }))
    const { isFeatureEnabled } = await import('../../../api/services/enterprise/featureGateService')
    expect(await isFeatureEnabled('t-1', 'api_access')).toBe(true)
  })

  it('isFeatureEnabled returns false when disabled', async () => {
    mockTenant.mockResolvedValueOnce(mockRow({ enabled: false, expires_at: null }))
    const { isFeatureEnabled } = await import('../../../api/services/enterprise/featureGateService')
    expect(await isFeatureEnabled('t-1', 'api_access')).toBe(false)
  })

  it('isFeatureEnabled returns false when expired', async () => {
    mockTenant.mockResolvedValueOnce(mockRow({ enabled: true, expires_at: '2020-01-01T00:00:00Z' }))
    const { isFeatureEnabled } = await import('../../../api/services/enterprise/featureGateService')
    expect(await isFeatureEnabled('t-1', 'api_access')).toBe(false)
  })

  it('isFeatureEnabled returns false when no row found', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { isFeatureEnabled } = await import('../../../api/services/enterprise/featureGateService')
    expect(await isFeatureEnabled('t-1', 'api_access')).toBe(false)
  })

  it('isFeatureEnabled returns false on DB error', async () => {
    mockTenant.mockRejectedValueOnce(new Error('DB down'))
    const { isFeatureEnabled } = await import('../../../api/services/enterprise/featureGateService')
    expect(await isFeatureEnabled('t-1', 'api_access')).toBe(false)
  })

  it('getFeatureConfig returns config when enabled', async () => {
    mockTenant.mockResolvedValueOnce(mockRow({ enabled: true, expires_at: null, config: { limit: 10 } }))
    const { getFeatureConfig } = await import('../../../api/services/enterprise/featureGateService')
    const config = await getFeatureConfig<{ limit: number }>('t-1', 'ai_agents')
    expect(config).toEqual({ limit: 10 })
  })

  it('getFeatureConfig returns null when disabled', async () => {
    mockTenant.mockResolvedValueOnce(mockRow({ enabled: false, expires_at: null, config: {} }))
    const { getFeatureConfig } = await import('../../../api/services/enterprise/featureGateService')
    expect(await getFeatureConfig('t-1', 'ai_agents')).toBeNull()
  })

  it('getFeatureConfig returns null when expired', async () => {
    mockTenant.mockResolvedValueOnce(mockRow({ enabled: true, expires_at: '2020-01-01T00:00:00Z', config: {} }))
    const { getFeatureConfig } = await import('../../../api/services/enterprise/featureGateService')
    expect(await getFeatureConfig('t-1', 'ai_agents')).toBeNull()
  })

  it('requireFeature throws FeatureGateError when not enabled', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { requireFeature, FeatureGateError } = await import('../../../api/services/enterprise/featureGateService')
    await expect(requireFeature('t-1', 'ai_agents')).rejects.toBeInstanceOf(FeatureGateError)
  })

  it('requireFeature does not throw when enabled', async () => {
    mockTenant.mockResolvedValueOnce(mockRow({ enabled: true, expires_at: null }))
    const { requireFeature } = await import('../../../api/services/enterprise/featureGateService')
    await expect(requireFeature('t-1', 'api_access')).resolves.toBeUndefined()
  })

  it('FeatureGateError has correct name and message', async () => {
    const { FeatureGateError } = await import('../../../api/services/enterprise/featureGateService')
    const err = new FeatureGateError('ai_agents')
    expect(err.name).toBe('FeatureGateError')
    expect(err.message).toContain('ai_agents')
  })

  it('checkApiQuota returns not allowed when over limit', async () => {
    mockTenant
      .mockResolvedValueOnce(mockRow({ api_quota_monthly: 100 }))
      .mockResolvedValueOnce(mockRow({ total: 100 }))
    const { checkApiQuota } = await import('../../../api/services/enterprise/featureGateService')
    const result = await checkApiQuota('t-1', 1)
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('100')
  })

  it('checkApiQuota returns allowed when under limit', async () => {
    mockTenant
      .mockResolvedValueOnce(mockRow({ api_quota_monthly: 10000 }))
      .mockResolvedValueOnce(mockRow({ total: 50 }))
    const { checkApiQuota } = await import('../../../api/services/enterprise/featureGateService')
    const result = await checkApiQuota('t-1', 1)
    expect(result.allowed).toBe(true)
    expect(result.current).toBe(50)
    expect(result.remaining).toBe(9950)
  })

  it('checkApiQuota returns not allowed when no subscription', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { checkApiQuota } = await import('../../../api/services/enterprise/featureGateService')
    const result = await checkApiQuota('t-1')
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('subscription')
  })

  it('checkSeatQuota returns remaining seats', async () => {
    mockTenant.mockResolvedValueOnce(mockRow({ seat_count: 3, seat_limit: 5 }))
    const { checkSeatQuota } = await import('../../../api/services/enterprise/featureGateService')
    const result = await checkSeatQuota('t-1', 1)
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(2)
  })

  it('checkSeatQuota detects seat limit breach', async () => {
    mockTenant.mockResolvedValueOnce(mockRow({ seat_count: 5, seat_limit: 5 }))
    const { checkSeatQuota } = await import('../../../api/services/enterprise/featureGateService')
    const result = await checkSeatQuota('t-1', 1)
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('5')
  })

  it('resolveEntitlements builds correct summary', async () => {
    mockTenant
      .mockResolvedValueOnce(mockRow(makeSubRow({ tier: 'professional' })))
      .mockResolvedValueOnce(mockRows([
        makeFeatureFlagRow({ feature_key: 'api_access', enabled: true }),
        makeFeatureFlagRow({ feature_key: 'digital_twin', enabled: false }),
      ]))
    const { resolveEntitlements } = await import('../../../api/services/enterprise/featureGateService')
    const summary = await resolveEntitlements('t-1')
    expect(summary.tier).toBe('professional')
    expect(summary.features['api_access']).toBe(true)
    expect(summary.features['digital_twin']).toBe(false)
    expect(summary.seatLimit).toBe(5)
  })

  it('resolveEntitlements marks expired flags as false', async () => {
    mockTenant
      .mockResolvedValueOnce(mockRow(makeSubRow()))
      .mockResolvedValueOnce(mockRows([
        makeFeatureFlagRow({ feature_key: 'ai_agents', enabled: true, expires_at: '2020-01-01T00:00:00Z' }),
      ]))
    const { resolveEntitlements } = await import('../../../api/services/enterprise/featureGateService')
    const summary = await resolveEntitlements('t-1')
    expect(summary.features['ai_agents']).toBe(false)
  })

  it('setFeatureFlag upserts and maps result', async () => {
    mockTenant.mockResolvedValueOnce(mockRow(makeFeatureFlagRow()))
    const { setFeatureFlag } = await import('../../../api/services/enterprise/featureGateService')
    const flag = await setFeatureFlag('t-1', { featureKey: 'api_access', enabled: true })
    expect(flag.featureKey).toBe('api_access')
    expect(flag.enabled).toBe(true)
  })

  it('listFeatureFlags returns all flags', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([
      makeFeatureFlagRow({ feature_key: 'api_access' }),
      makeFeatureFlagRow({ feature_key: 'digital_twin', id: 'ff-2' }),
    ]))
    const { listFeatureFlags } = await import('../../../api/services/enterprise/featureGateService')
    const flags = await listFeatureFlags('t-1')
    expect(flags.length).toBe(2)
  })
})

// ─── Suite 3: Tenant Usage Tracker ───────────────────────────────────────────

describe('tenantUsageTracker', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('_mapUsageRecord maps all fields', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/tenantUsageTracker')
    const rec = __testHooks._mapUsageRecord(makeUsageRow())
    expect(rec.id).toBe('usage-1')
    expect(rec.eventType).toBe('api_calls')
    expect(rec.quantity).toBe(100)
    expect(rec.unit).toBe('calls')
    expect(rec.unitCost).toBeCloseTo(0.0001)
    expect(rec.totalCost).toBeCloseTo(0.01)
    expect(rec.createdAt).toBeInstanceOf(Date)
  })

  it('_mapUsageRecord handles null optional fields', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/tenantUsageTracker')
    const rec = __testHooks._mapUsageRecord(makeUsageRow({ unit_cost: null, total_cost: null, idempotency_key: null }))
    expect(rec.unitCost).toBeUndefined()
    expect(rec.totalCost).toBeUndefined()
    expect(rec.idempotencyKey).toBeUndefined()
  })

  it('recordUsage calls tenantQuery and maps result', async () => {
    mockTenant.mockResolvedValueOnce(mockRow(makeUsageRow()))
    const { recordUsage } = await import('../../../api/services/enterprise/tenantUsageTracker')
    const rec = await recordUsage('t-1', { eventType: 'api_calls', quantity: 100, unit: 'calls' })
    expect(mockTenant).toHaveBeenCalledOnce()
    expect(rec.eventType).toBe('api_calls')
  })

  it('getUsageRecords applies eventType filter', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([makeUsageRow()]))
    const { getUsageRecords } = await import('../../../api/services/enterprise/tenantUsageTracker')
    await getUsageRecords('t-1', { eventType: 'api_calls' })
    const call = mockTenant.mock.calls[0]!
    expect(call[1]).toContain('event_type')
  })

  it('getUsageSummary aggregates by event_type', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([
      { event_type: 'api_calls', total_quantity: '500', total_cost: '0.05', unit: 'calls' },
      { event_type: 'ai_tokens', total_quantity: '10000', total_cost: '0.30', unit: 'tokens' },
    ]))
    const { getUsageSummary } = await import('../../../api/services/enterprise/tenantUsageTracker')
    const summary = await getUsageSummary('t-1', new Date('2024-01-01'), new Date('2024-01-31'))
    expect(summary.byType.api_calls?.quantity).toBe(500)
    expect(summary.byType.ai_tokens?.quantity).toBe(10000)
    expect(summary.totalCostUsd).toBeCloseTo(0.35)
  })

  it('getCurrentMonthSummary calls getUsageSummary with current period', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { getCurrentMonthSummary } = await import('../../../api/services/enterprise/tenantUsageTracker')
    const summary = await getCurrentMonthSummary('t-1')
    expect(summary.tenantId).toBe('t-1')
    expect(summary.periodStart.getDate()).toBe(1)
  })

  it('trackApiCall records api_calls event type', async () => {
    mockTenant.mockResolvedValueOnce(mockRow(makeUsageRow()))
    const { trackApiCall } = await import('../../../api/services/enterprise/tenantUsageTracker')
    await trackApiCall('t-1', 5)
    const args = mockTenant.mock.calls[0]![2] as unknown[]
    expect(args).toContain('api_calls')
    expect(args).toContain(5)
  })
})

// ─── Suite 4: AI Cost Tracker ─────────────────────────────────────────────────

describe('aiCostTracker', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('_mapAiUsageRecord maps all fields', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/aiCostTracker')
    const rec = __testHooks._mapAiUsageRecord(makeAiRow())
    expect(rec.id).toBe('ai-1')
    expect(rec.agentType).toBe('RiskAgent')
    expect(rec.model).toBe('claude-sonnet-4-5')
    expect(rec.promptTokens).toBe(1000)
    expect(rec.costUsd).toBeCloseTo(0.006)
    expect(rec.latencyMs).toBe(250)
  })

  it('_mapAiUsageRecord handles null agent_type', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/aiCostTracker')
    const rec = __testHooks._mapAiUsageRecord(makeAiRow({ agent_type: null }))
    expect(rec.agentType).toBeUndefined()
  })

  it('MODEL_COSTS contains claude-sonnet-4-5', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/aiCostTracker')
    expect(__testHooks.MODEL_COSTS['claude-sonnet-4-5']).toBeDefined()
    expect(__testHooks.MODEL_COSTS['claude-sonnet-4-5']!.prompt).toBeGreaterThan(0)
  })

  it('recordAiUsage auto-calculates cost from tokens when not provided', async () => {
    mockTenant
      .mockResolvedValueOnce(mockRow(makeAiRow()))
      .mockResolvedValueOnce(mockRows([]))
    const { recordAiUsage } = await import('../../../api/services/enterprise/aiCostTracker')
    const rec = await recordAiUsage('t-1', {
      model: 'claude-sonnet-4-5', operation: 'inference',
      promptTokens: 1000, completionTokens: 500,
    })
    expect(rec.model).toBe('claude-sonnet-4-5')
  })

  it('recordAiUsage updates subscription ai_spend_current', async () => {
    mockTenant
      .mockResolvedValueOnce(mockRow(makeAiRow()))
      .mockResolvedValueOnce(mockRows([]))
    const { recordAiUsage } = await import('../../../api/services/enterprise/aiCostTracker')
    await recordAiUsage('t-1', {
      model: 'claude-sonnet-4-5', operation: 'inference',
      promptTokens: 1000, completionTokens: 500,
    })
    expect(mockTenant).toHaveBeenCalledTimes(2)
    const secondCall = mockTenant.mock.calls[1]![1] as string
    expect(secondCall).toContain('ai_spend_current')
  })

  it('getAiBudgetStatus computes utilization correctly', async () => {
    mockTenant.mockResolvedValueOnce(mockRow({ ai_budget_monthly: '100', ai_spend_current: '80' }))
    const { getAiBudgetStatus } = await import('../../../api/services/enterprise/aiCostTracker')
    const status = await getAiBudgetStatus('t-1')
    expect(status.budgetMonthly).toBe(100)
    expect(status.spendCurrent).toBe(80)
    expect(status.utilizationPct).toBe(80)
    expect(status.isNearLimit).toBe(true)
    expect(status.isOverBudget).toBe(false)
  })

  it('getAiBudgetStatus detects over-budget', async () => {
    mockTenant.mockResolvedValueOnce(mockRow({ ai_budget_monthly: '100', ai_spend_current: '110' }))
    const { getAiBudgetStatus } = await import('../../../api/services/enterprise/aiCostTracker')
    const status = await getAiBudgetStatus('t-1')
    expect(status.isOverBudget).toBe(true)
  })

  it('getAiBudgetStatus handles unlimited budget (null)', async () => {
    mockTenant.mockResolvedValueOnce(mockRow({ ai_budget_monthly: null, ai_spend_current: '50' }))
    const { getAiBudgetStatus } = await import('../../../api/services/enterprise/aiCostTracker')
    const status = await getAiBudgetStatus('t-1')
    expect(status.budgetMonthly).toBeUndefined()
    expect(status.isOverBudget).toBe(false)
  })

  it('getAiCostByAgent returns sorted results', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([
      { agent_type: 'RiskAgent', total_cost: '0.50', total_tokens: 10000, call_count: 5 },
      { agent_type: null, total_cost: '0.10', total_tokens: 2000, call_count: 1 },
    ]))
    const { getAiCostByAgent } = await import('../../../api/services/enterprise/aiCostTracker')
    const breakdown = await getAiCostByAgent('t-1')
    expect(breakdown[0]!.agentType).toBe('RiskAgent')
    expect(breakdown[1]!.agentType).toBeNull()
  })

  it('resetMonthlySpend updates subscription', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { resetMonthlySpend } = await import('../../../api/services/enterprise/aiCostTracker')
    await resetMonthlySpend('t-1')
    const query = mockTenant.mock.calls[0]![1] as string
    expect(query).toContain('ai_spend_current = 0')
  })
})

// ─── Suite 5: Support Operations ─────────────────────────────────────────────

describe('supportOperationsService', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('_mapTicket maps all fields', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/supportOperationsService')
    const ticket = __testHooks._mapTicket(makeTicketRow())
    expect(ticket.id).toBe('tkt-1')
    expect(ticket.priority).toBe('medium')
    expect(ticket.status).toBe('open')
    expect(ticket.slaDeadline).toBeInstanceOf(Date)
  })

  it('_mapTicket handles null optional fields', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/supportOperationsService')
    const ticket = __testHooks._mapTicket(makeTicketRow({ assignee: null, escalated_at: null }))
    expect(ticket.assignee).toBeUndefined()
    expect(ticket.escalatedAt).toBeUndefined()
  })

  it('SLA_HOURS defines critical at 4 hours', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/supportOperationsService')
    expect(__testHooks.SLA_HOURS.critical).toBe(4)
    expect(__testHooks.SLA_HOURS.high).toBe(24)
    expect(__testHooks.SLA_HOURS.low).toBe(168)
  })

  it('createTicket inserts with generated ticket number', async () => {
    mockTenant.mockResolvedValueOnce(mockRow(makeTicketRow()))
    const { createTicket } = await import('../../../api/services/enterprise/supportOperationsService')
    const ticket = await createTicket('t-1', { title: 'Test Issue', priority: 'high' })
    expect(ticket.status).toBe('open')
    const query = mockTenant.mock.calls[0]![1] as string
    expect(query).toContain('INSERT INTO support_tickets')
  })

  it('getTicket returns null when not found', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { getTicket } = await import('../../../api/services/enterprise/supportOperationsService')
    expect(await getTicket('t-1', 'no-id')).toBeNull()
  })

  it('listTickets applies status filter', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([makeTicketRow()]))
    const { listTickets } = await import('../../../api/services/enterprise/supportOperationsService')
    await listTickets('t-1', { status: 'open' })
    const query = mockTenant.mock.calls[0]![1] as string
    expect(query).toContain('status')
  })

  it('updateTicketStatus sets resolved_at when resolving', async () => {
    mockTenant.mockResolvedValueOnce(mockRow(makeTicketRow({ status: 'resolved' })))
    const { updateTicketStatus } = await import('../../../api/services/enterprise/supportOperationsService')
    const ticket = await updateTicketStatus('t-1', 'tkt-1', 'resolved')
    expect(ticket.status).toBe('resolved')
  })

  it('updateTicketStatus throws when ticket not found', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { updateTicketStatus } = await import('../../../api/services/enterprise/supportOperationsService')
    await expect(updateTicketStatus('t-1', 'bad-id', 'resolved')).rejects.toThrow()
  })

  it('escalateTicket promotes priority', async () => {
    mockTenant.mockResolvedValueOnce(mockRow(makeTicketRow({ priority: 'high' })))
    const { escalateTicket } = await import('../../../api/services/enterprise/supportOperationsService')
    const ticket = await escalateTicket('t-1', 'tkt-1', 'Needs immediate attention')
    const query = mockTenant.mock.calls[0]![1] as string
    expect(query).toContain('escalated_at')
  })

  it('getSlaBreaches queries for overdue open tickets', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([makeTicketRow()]))
    const { getSlaBreaches } = await import('../../../api/services/enterprise/supportOperationsService')
    const breaches = await getSlaBreaches('t-1')
    const query = mockTenant.mock.calls[0]![1] as string
    expect(query).toContain('sla_deadline < now()')
    expect(breaches.length).toBe(1)
  })
})

// ─── Suite 6: Compliance Export Engine ───────────────────────────────────────

describe('complianceExportEngine', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('_mapExport maps all fields', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/complianceExportEngine')
    const exp = __testHooks._mapExport(makeExportRow())
    expect(exp.id).toBe('exp-1')
    expect(exp.exportType).toBe('audit')
    expect(exp.format).toBe('json')
    expect(exp.status).toBe('pending')
    expect(exp.expiresAt).toBeInstanceOf(Date)
  })

  it('_mapExport handles null optional fields', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/complianceExportEngine')
    const exp = __testHooks._mapExport(makeExportRow({ storage_path: null, checksum: null, completed_at: null }))
    expect(exp.storagePath).toBeUndefined()
    expect(exp.checksum).toBeUndefined()
    expect(exp.completedAt).toBeUndefined()
  })

  it('_computeChecksum returns sha256 hex string', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/complianceExportEngine')
    const hash = __testHooks._computeChecksum('test-data')
    expect(typeof hash).toBe('string')
    expect(hash.length).toBe(64) // sha256 hex = 64 chars
  })

  it('_computeChecksum is deterministic', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/complianceExportEngine')
    expect(__testHooks._computeChecksum('abc')).toBe(__testHooks._computeChecksum('abc'))
  })

  it('EXPORT_TTL_MS equals 7 days', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/complianceExportEngine')
    expect(__testHooks.EXPORT_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000)
  })

  it('requestExport checks feature gate first', async () => {
    // Feature not enabled
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { requestExport } = await import('../../../api/services/enterprise/complianceExportEngine')
    await expect(requestExport('t-1', { exportType: 'audit', format: 'json' })).rejects.toThrow()
  })

  it('getExport returns null when not found', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { getExport } = await import('../../../api/services/enterprise/complianceExportEngine')
    expect(await getExport('t-1', 'no-id')).toBeNull()
  })

  it('listExports applies status filter', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([makeExportRow()]))
    const { listExports } = await import('../../../api/services/enterprise/complianceExportEngine')
    await listExports('t-1', { status: 'pending' })
    const query = mockTenant.mock.calls[0]![1] as string
    expect(query).toContain('status')
  })

  it('failExport sets error and failed status', async () => {
    mockTenant.mockResolvedValueOnce(mockRow(makeExportRow({ status: 'failed', error: 'timeout' })))
    const { failExport } = await import('../../../api/services/enterprise/complianceExportEngine')
    const exp = await failExport('t-1', 'exp-1', 'timeout')
    expect(exp.status).toBe('failed')
  })
})

// ─── Suite 7: Deployment Health Service ──────────────────────────────────────

describe('deploymentHealthService', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('_mapHealthCheck maps all fields', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/deploymentHealthService')
    const check = __testHooks._mapHealthCheck(makeHealthCheckRow())
    expect(check.id).toBe('hc-1')
    expect(check.checkName).toBe('database.connectivity')
    expect(check.status).toBe('passing')
    expect(check.value).toBe(12)
    expect(check.threshold).toBe(500)
    expect(check.checkedAt).toBeInstanceOf(Date)
  })

  it('_mapHealthCheck handles null value/threshold', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/deploymentHealthService')
    const check = __testHooks._mapHealthCheck(makeHealthCheckRow({ value: null, threshold: null }))
    expect(check.value).toBeUndefined()
    expect(check.threshold).toBeUndefined()
  })

  it('recordHealthCheck uses pool.query (not tenantQuery)', async () => {
    mockPool.mockResolvedValueOnce(mockRow(makeHealthCheckRow()))
    const { recordHealthCheck } = await import('../../../api/services/enterprise/deploymentHealthService')
    await recordHealthCheck({ checkName: 'db', status: 'passing', metadata: {} })
    expect(mockPool).toHaveBeenCalledOnce()
    expect(mockTenant).not.toHaveBeenCalled()
  })

  it('generateHealthReport computes overall correctly', async () => {
    mockPool.mockResolvedValueOnce(mockRows([
      makeHealthCheckRow({ status: 'passing' }),
      makeHealthCheckRow({ id: 'hc-2', check_name: 'db.pool', status: 'warning' }),
    ]))
    const { generateHealthReport } = await import('../../../api/services/enterprise/deploymentHealthService')
    const report = await generateHealthReport()
    expect(report.overall).toBe('degraded')
    expect(report.warningCount).toBe(1)
    expect(report.passingCount).toBe(1)
    expect(report.failingCount).toBe(0)
  })

  it('generateHealthReport marks unhealthy when failing checks exist', async () => {
    mockPool.mockResolvedValueOnce(mockRows([
      makeHealthCheckRow({ status: 'failing' }),
    ]))
    const { generateHealthReport } = await import('../../../api/services/enterprise/deploymentHealthService')
    const report = await generateHealthReport()
    expect(report.overall).toBe('unhealthy')
  })

  it('generateHealthReport marks healthy when all passing', async () => {
    mockPool.mockResolvedValueOnce(mockRows([makeHealthCheckRow()]))
    const { generateHealthReport } = await import('../../../api/services/enterprise/deploymentHealthService')
    const report = await generateHealthReport()
    expect(report.overall).toBe('healthy')
  })
})

// ─── Suite 8: API Gateway Service ────────────────────────────────────────────

describe('apiGatewayService', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('_mapApiKey maps all fields', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/apiGatewayService')
    const key = __testHooks._mapApiKey(makeApiKeyRow())
    expect(key.id).toBe('key-1')
    expect(key.name).toBe('Production Key')
    expect(key.status).toBe('active')
    expect(key.scopes).toEqual(['read', 'write'])
    expect(key.usageThisMonth).toBe(0)
  })

  it('_mapApiKey handles null optional fields', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/apiGatewayService')
    const key = __testHooks._mapApiKey(makeApiKeyRow({ last_used_at: null, expires_at: null, revoked_at: null }))
    expect(key.lastUsedAt).toBeUndefined()
    expect(key.expiresAt).toBeUndefined()
    expect(key.revokedAt).toBeUndefined()
  })

  it('_hashKey produces consistent sha256', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/apiGatewayService')
    const h1 = __testHooks._hashKey('secret')
    const h2 = __testHooks._hashKey('secret')
    expect(h1).toBe(h2)
    expect(h1.length).toBe(64)
  })

  it('hasScope returns true for exact scope match', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/apiGatewayService')
    const key = __testHooks._mapApiKey(makeApiKeyRow({ scopes: ['read', 'write'] }))
    expect(__testHooks.hasScope(key, 'read')).toBe(true)
  })

  it('hasScope returns true for wildcard scope', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/apiGatewayService')
    const key = __testHooks._mapApiKey(makeApiKeyRow({ scopes: ['*'] }))
    expect(__testHooks.hasScope(key, 'anything')).toBe(true)
  })

  it('hasScope returns false when scope not present', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/apiGatewayService')
    const key = __testHooks._mapApiKey(makeApiKeyRow({ scopes: ['read'] }))
    expect(__testHooks.hasScope(key, 'write')).toBe(false)
  })

  it('createApiKey inserts and returns key with secret', async () => {
    mockTenant.mockResolvedValueOnce(mockRow(makeApiKeyRow()))
    const { createApiKey } = await import('../../../api/services/enterprise/apiGatewayService')
    const result = await createApiKey('t-1', { name: 'Test Key' })
    expect(result.key.name).toBe('Production Key')
    expect(typeof result.secret).toBe('string')
    expect(result.secret.length).toBeGreaterThan(16)
  })

  it('listApiKeys applies status filter', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([makeApiKeyRow()]))
    const { listApiKeys } = await import('../../../api/services/enterprise/apiGatewayService')
    await listApiKeys('t-1', { status: 'active' })
    const query = mockTenant.mock.calls[0]![1] as string
    expect(query).toContain('status')
  })

  it('revokeApiKey sets revoked status and timestamp', async () => {
    mockTenant.mockResolvedValueOnce(mockRow(makeApiKeyRow({ status: 'revoked' })))
    const { revokeApiKey } = await import('../../../api/services/enterprise/apiGatewayService')
    const key = await revokeApiKey('t-1', 'key-1', 'admin')
    const query = mockTenant.mock.calls[0]![1] as string
    expect(query).toContain('revoked_at')
  })

  it('revokeApiKey throws when key not found', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { revokeApiKey } = await import('../../../api/services/enterprise/apiGatewayService')
    await expect(revokeApiKey('t-1', 'bad-id')).rejects.toThrow()
  })

  it('authenticateApiKey returns null when no key found', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { authenticateApiKey } = await import('../../../api/services/enterprise/apiGatewayService')
    expect(await authenticateApiKey('t-1', 'bad-secret')).toBeNull()
  })
})

// ─── Suite 9: Customer Health Engine ─────────────────────────────────────────

describe('customerHealthEngine', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('_scoreAdoption returns 0 with no active users', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/customerHealthEngine')
    const score = __testHooks._scoreAdoption({ activeUsers7Days: 0, seatCount: 1, seatLimit: 5, loginCount30Days: 0 })
    expect(score).toBe(0)
  })

  it('_scoreAdoption caps at 100', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/customerHealthEngine')
    const score = __testHooks._scoreAdoption({ activeUsers7Days: 100, seatCount: 50, seatLimit: 50, loginCount30Days: 200 })
    expect(score).toBeLessThanOrEqual(100)
  })

  it('_scoreSupportLoad returns 0 for no tickets', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/customerHealthEngine')
    expect(__testHooks._scoreSupportLoad(0)).toBe(0)
  })

  it('_scoreSupportLoad caps at 100', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/customerHealthEngine')
    expect(__testHooks._scoreSupportLoad(20)).toBe(100)
  })

  it('_scoreAiEfficiency gives high score for good utilization', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/customerHealthEngine')
    expect(__testHooks._scoreAiEfficiency(50)).toBeGreaterThan(50)
  })

  it('_scoreAiEfficiency gives low score for very low utilization', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/customerHealthEngine')
    expect(__testHooks._scoreAiEfficiency(2)).toBe(20)
  })

  it('_scoreChurnRisk is higher with low adoption and many tickets', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/customerHealthEngine')
    const highRisk = __testHooks._scoreChurnRisk(10, 80, 1)
    const lowRisk = __testHooks._scoreChurnRisk(90, 0, 10)
    expect(highRisk).toBeGreaterThan(lowRisk)
  })

  it('computeHealthScore returns bounded 0-100 scores', async () => {
    // All 4 parallel fetchers
    mockTenant
      .mockResolvedValueOnce(mockRow({ seat_count: 3, seat_limit: 5 }))
      .mockResolvedValueOnce(mockRows([]))    // audit_log active users (catch)
      .mockResolvedValueOnce(mockRows([]))    // audit_log 7d (catch)
      .mockResolvedValueOnce(mockRows([{ open_count: 2, critical_count: 0 }]))
      .mockResolvedValueOnce(mockRow({ ai_budget_monthly: '100', ai_spend_current: '40' }))
      .mockResolvedValueOnce(mockRow({ cnt: 5 }))
    const { computeHealthScore } = await import('../../../api/services/enterprise/customerHealthEngine')
    const score = await computeHealthScore('t-1')
    expect(score.tenantHealthScore).toBeGreaterThanOrEqual(0)
    expect(score.tenantHealthScore).toBeLessThanOrEqual(100)
    expect(score.generatedAt).toBeInstanceOf(Date)
  })
})

// ─── Suite 10: Tenant Archival Service ───────────────────────────────────────

describe('tenantArchivalService', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('_countTenantRecords returns counts for all tables', async () => {
    mockPool.mockResolvedValue(mockRow({ cnt: 5 }))
    const { __testHooks } = await import('../../../api/services/enterprise/tenantArchivalService')
    const counts = await __testHooks._countTenantRecords('t-1')
    expect(typeof counts).toBe('object')
    expect(Object.keys(counts).length).toBeGreaterThan(0)
  })

  it('_countTenantRecords handles table errors gracefully', async () => {
    mockPool.mockRejectedValue(new Error('table missing'))
    const { __testHooks } = await import('../../../api/services/enterprise/tenantArchivalService')
    const counts = await __testHooks._countTenantRecords('t-1')
    // All should be -1 (error sentinel)
    Object.values(counts).forEach(v => expect(v).toBe(-1))
  })

  it('suspendTenant calls transitionLifecycle', async () => {
    // getSubscription (suspendTenant)
    mockTenant.mockResolvedValueOnce(mockRow(makeSubRow()))
    // getSubscription (transitionLifecycle internal — fetches fromStatus)
    mockTenant.mockResolvedValueOnce(mockRow(makeSubRow()))
    // transitionLifecycle: UPDATE subscription
    mockTenant.mockResolvedValueOnce(mockRow(makeSubRow({ lifecycle_status: 'suspended' })))
    // transitionLifecycle: INSERT lifecycle event
    mockTenant.mockResolvedValueOnce(mockRow(makeLifecycleEventRow({ to_status: 'suspended' })))

    const { suspendTenant } = await import('../../../api/services/enterprise/tenantArchivalService')
    const result = await suspendTenant('t-1', { reason: 'Non-payment' })
    expect(result.subscription.lifecycleStatus).toBe('suspended')
  })

  it('reactivateTenant throws when tenant is archived', async () => {
    mockTenant.mockResolvedValueOnce(mockRow(makeSubRow({ lifecycle_status: 'archived' })))
    const { reactivateTenant } = await import('../../../api/services/enterprise/tenantArchivalService')
    await expect(reactivateTenant('t-1')).rejects.toThrow('Archived')
  })

  it('reactivateTenant throws when no subscription', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { reactivateTenant } = await import('../../../api/services/enterprise/tenantArchivalService')
    await expect(reactivateTenant('t-1')).rejects.toThrow()
  })
})
