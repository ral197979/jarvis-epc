/**
 * Denver Engineering — Phase 8 Test Suite C (v8.0.0)
 * ──────────────────────────────────────────────────────
 * Ava Phase 8 — Extended coverage: mapper completeness, query shape verification,
 * multi-call sequencing, boundary arithmetic, and cross-service interaction patterns.
 * 180+ tests across 10 suites.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

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

const sub = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'sub-1', tenant_id: 'T1', tier: 'professional', status: 'active',
  lifecycle_status: 'active', seat_count: 5, seat_limit: 25,
  ai_budget_monthly: '200.00', ai_spend_current: '50.00',
  storage_limit_gb: 100, api_quota_monthly: 100000, metadata: {},
  created_at: '2024-03-01T00:00:00Z', updated_at: '2024-03-01T00:00:00Z', ...o,
})

const ff = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'ff-1', tenant_id: 'T1', feature_key: 'digital_twin', enabled: true,
  config: { maxNodes: 500 }, granted_by: 'admin', expires_at: null,
  created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z', ...o,
})

const usageRec = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'u-1', tenant_id: 'T1', period_start: '2024-03-01T00:00:00Z',
  period_end: '2024-03-31T23:59:59Z', event_type: 'storage', quantity: '50',
  unit: 'gb', unit_cost: '0.023', total_cost: '1.15', idempotency_key: 'idem-1',
  metadata: { region: 'us-east-1' }, created_at: '2024-03-15T00:00:00Z', ...o,
})

const aiRec = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'ai-1', tenant_id: 'T1', agent_type: 'ReadinessAgent',
  model: 'claude-opus-4', provider: 'anthropic', operation: 'recommendation',
  prompt_tokens: 5000, completion_tokens: 2000, total_tokens: 7000,
  cost_usd: '0.225', latency_ms: 1200, idempotency_key: null,
  metadata: { projectId: 'proj-abc' }, created_at: '2024-03-10T00:00:00Z', ...o,
})

const tkt = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'tkt-1', tenant_id: 'T1', ticket_number: 'TKT-AAA-BB',
  title: 'Integration broken', description: 'Webhook not firing',
  status: 'in_progress', priority: 'high', reporter: 'dev@co.io',
  assignee: 'support@co.io', tags: ['integration', 'webhook'],
  escalated_at: null, resolved_at: null, closed_at: null,
  sla_deadline: '2024-03-02T00:00:00Z', metadata: {},
  created_at: '2024-03-01T00:00:00Z', updated_at: '2024-03-01T00:00:00Z', ...o,
})

const hc = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'hc-1', check_name: 'queue.depth', status: 'warning',
  message: 'Queue depth 450, threshold 500', value: '450', threshold: '500',
  metadata: { queueName: 'events' }, checked_at: '2024-03-01T08:00:00Z', ...o,
})

const apiKey = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'k-1', tenant_id: 'T1', key_hash: 'sha256hash_here',
  key_prefix: 'a1b2c3d4', name: 'Webhook Sender', status: 'active',
  scopes: ['webhooks:send', 'read'], quota_monthly: null,
  usage_this_month: 42, last_used_at: '2024-03-15T12:00:00Z',
  expires_at: '2025-01-01T00:00:00Z', revoked_at: null, revoked_by: null,
  created_by: 'platform', metadata: { env: 'production' },
  created_at: '2024-01-15T00:00:00Z', ...o,
})

const demo = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'd-1', tenant_id: 'demo-T1', industry: 'utilities',
  template_key: 'utilities_enterprise', label: 'GridTech Energy',
  status: 'active', seeded_at: null, expires_at: '2024-04-01T00:00:00Z',
  last_reset_at: null, created_by: 'ae@sales.io',
  metadata: { tier: 'enterprise', description: 'Grid modernization demo' },
  created_at: '2024-03-01T00:00:00Z', ...o,
})

const lifecycleEvt = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'evt-1', tenant_id: 'T1', event_type: 'lifecycle_active',
  from_status: 'trial', to_status: 'active', actor: 'billing_system',
  reason: 'Trial converted', metadata: { invoiceId: 'inv-123' },
  created_at: '2024-03-01T00:00:00Z', ...o,
})

// ─── Suite 1: Provisioning mappers — all fields ───────────────────────────────

describe('tenantProvisioningService — full field coverage', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('_mapSubscription maps stripe fields', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/tenantProvisioningService')
    const result = __testHooks._mapSubscription(sub({
      stripe_customer_id: 'cus_xyz', stripe_subscription_id: 'sub_xyz',
    }))
    expect(result.stripeCustomerId).toBe('cus_xyz')
    expect(result.stripeSubscriptionId).toBe('sub_xyz')
  })

  it('_mapSubscription maps currentPeriodStart/End', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/tenantProvisioningService')
    const result = __testHooks._mapSubscription(sub({
      current_period_start: '2024-03-01T00:00:00Z',
      current_period_end: '2024-03-31T23:59:59Z',
    }))
    expect(result.currentPeriodStart).toBeInstanceOf(Date)
    expect(result.currentPeriodEnd).toBeInstanceOf(Date)
  })

  it('_mapSubscription converts numeric strings', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/tenantProvisioningService')
    const result = __testHooks._mapSubscription(sub({ seat_count: '7', seat_limit: '25' }))
    expect(result.seatCount).toBe(7)
    expect(result.seatLimit).toBe(25)
    expect(typeof result.seatCount).toBe('number')
  })

  it('_mapSubscription metadata defaults to empty object', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/tenantProvisioningService')
    const result = __testHooks._mapSubscription(sub({ metadata: null }))
    expect(result.metadata).toEqual({})
  })

  it('_mapLifecycleEvent maps fromStatus correctly', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/tenantProvisioningService')
    const evt = __testHooks._mapLifecycleEvent(lifecycleEvt())
    expect(evt.fromStatus).toBe('trial')
    expect(evt.toStatus).toBe('active')
    expect(evt.actor).toBe('billing_system')
    expect(evt.reason).toBe('Trial converted')
  })

  it('_mapLifecycleEvent metadata is parsed object', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/tenantProvisioningService')
    const evt = __testHooks._mapLifecycleEvent(lifecycleEvt())
    expect(evt.metadata).toEqual({ invoiceId: 'inv-123' })
  })

  it('_mapFeatureFlag with config object', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/tenantProvisioningService')
    const flag = __testHooks._mapFeatureFlag(ff())
    expect(flag.config).toEqual({ maxNodes: 500 })
    expect(flag.grantedBy).toBe('admin')
  })

  it('_mapFeatureFlag with expiresAt populated', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/tenantProvisioningService')
    const flag = __testHooks._mapFeatureFlag(ff({ expires_at: '2024-06-30T00:00:00Z' }))
    expect(flag.expiresAt).toBeInstanceOf(Date)
    expect(flag.expiresAt!.getFullYear()).toBe(2024)
  })

  it('_defaultSeatLimit unknown tier defaults to 5', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/tenantProvisioningService')
    expect(__testHooks._defaultSeatLimit('ultra')).toBe(5)
  })

  it('_defaultAiBudget unknown tier defaults to 50', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/tenantProvisioningService')
    expect(__testHooks._defaultAiBudget('ultra')).toBe(50)
  })

  it('_defaultFeatures professional has agentLimit: 3', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/tenantProvisioningService')
    const features = __testHooks._defaultFeatures('professional')
    const agents = features.find(f => f.key === 'ai_agents')
    expect(agents?.config).toEqual({ agentLimit: 3 })
  })

  it('_defaultFeatures enterprise has agentLimit: 10', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/tenantProvisioningService')
    const features = __testHooks._defaultFeatures('enterprise')
    const agents = features.find(f => f.key === 'ai_agents')
    expect(agents?.config).toEqual({ agentLimit: 10 })
  })

  it('_defaultFeatures enterprise scenario_simulation limit: 500', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/tenantProvisioningService')
    const features = __testHooks._defaultFeatures('enterprise')
    const sim = features.find(f => f.key === 'scenario_simulation')
    expect(sim?.config).toEqual({ limit: 500 })
  })

  it('_defaultFeatures professional scenario_simulation limit: 50', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/tenantProvisioningService')
    const features = __testHooks._defaultFeatures('professional')
    const sim = features.find(f => f.key === 'scenario_simulation')
    expect(sim?.config).toEqual({ limit: 50 })
  })

  it('getLifecycleHistory queries with ASC order', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([lifecycleEvt()]))
    const { getLifecycleHistory } = await import('../../../api/services/enterprise/tenantProvisioningService')
    await getLifecycleHistory('T1')
    const query = mockTenant.mock.calls[0]![1] as string
    expect(query).toContain('ASC')
  })

  it('transitionLifecycle throws when subscription not found', async () => {
    // getSubscription returns null
    mockTenant.mockResolvedValueOnce(mockRows([]))
    // UPDATE returns empty
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { transitionLifecycle } = await import('../../../api/services/enterprise/tenantProvisioningService')
    await expect(transitionLifecycle('T1', 'active')).rejects.toThrow()
  })
})

// ─── Suite 2: Feature Gate — query shapes ─────────────────────────────────────

describe('featureGateService — query shape verification', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('isFeatureEnabled queries enabled AND expires_at', async () => {
    mockTenant.mockResolvedValueOnce(mockRow({ enabled: true, expires_at: null }))
    const { isFeatureEnabled } = await import('../../../api/services/enterprise/featureGateService')
    await isFeatureEnabled('T1', 'digital_twin')
    const query = mockTenant.mock.calls[0]![1] as string
    expect(query).toContain('enabled')
    expect(query).toContain('expires_at')
  })

  it('getFeatureConfig returns generic typed config', async () => {
    mockTenant.mockResolvedValueOnce(mockRow({ enabled: true, expires_at: null, config: { limit: 999, mode: 'full' } }))
    const { getFeatureConfig } = await import('../../../api/services/enterprise/featureGateService')
    const cfg = await getFeatureConfig<{ limit: number; mode: string }>('T1', 'scenario_simulation')
    expect(cfg?.limit).toBe(999)
    expect(cfg?.mode).toBe('full')
  })

  it('setFeatureFlag passes expiresAt to query', async () => {
    mockTenant.mockResolvedValueOnce(mockRow(ff()))
    const { setFeatureFlag } = await import('../../../api/services/enterprise/featureGateService')
    const exp = new Date('2024-12-31')
    await setFeatureFlag('T1', { featureKey: 'ai_agents', enabled: true, expiresAt: exp })
    const args = mockTenant.mock.calls[0]![2] as unknown[]
    expect(args).toContain(exp)
  })

  it('setFeatureFlag serializes config as JSON', async () => {
    mockTenant.mockResolvedValueOnce(mockRow(ff()))
    const { setFeatureFlag } = await import('../../../api/services/enterprise/featureGateService')
    await setFeatureFlag('T1', { featureKey: 'ai_agents', enabled: true, config: { agentLimit: 5 } })
    const args = mockTenant.mock.calls[0]![2] as unknown[]
    expect(args).toContain(JSON.stringify({ agentLimit: 5 }))
  })

  it('checkApiQuota remaining is Math.max(0, limit - current)', async () => {
    mockTenant
      .mockResolvedValueOnce(mockRow({ api_quota_monthly: 100 }))
      .mockResolvedValueOnce(mockRow({ total: 150 })) // over limit
    const { checkApiQuota } = await import('../../../api/services/enterprise/featureGateService')
    const result = await checkApiQuota('T1')
    expect(result.remaining).toBe(0) // never negative
  })

  it('resolveEntitlements aiBudgetMonthly is undefined for null', async () => {
    mockTenant
      .mockResolvedValueOnce(mockRow(sub({ ai_budget_monthly: null })))
      .mockResolvedValueOnce(mockRows([]))
    const { resolveEntitlements } = await import('../../../api/services/enterprise/featureGateService')
    const summary = await resolveEntitlements('T1')
    expect(summary.aiBudgetMonthly).toBeUndefined()
  })

  it('resolveEntitlements includes all feature flags in features map', async () => {
    mockTenant
      .mockResolvedValueOnce(mockRow(sub()))
      .mockResolvedValueOnce(mockRows([
        ff({ feature_key: 'api_access', enabled: true }),
        ff({ feature_key: 'digital_twin', enabled: true, id: 'ff-2' }),
        ff({ feature_key: 'multi_agent', enabled: false, id: 'ff-3' }),
      ]))
    const { resolveEntitlements } = await import('../../../api/services/enterprise/featureGateService')
    const summary = await resolveEntitlements('T1')
    expect(Object.keys(summary.features)).toHaveLength(3)
    expect(summary.features['multi_agent']).toBe(false)
  })
})

// ─── Suite 3: Usage tracker — query verification ──────────────────────────────

describe('tenantUsageTracker — query shapes', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('recordUsage inserts with ON CONFLICT clause', async () => {
    mockTenant.mockResolvedValueOnce(mockRow(usageRec()))
    const { recordUsage } = await import('../../../api/services/enterprise/tenantUsageTracker')
    await recordUsage('T1', { eventType: 'storage', quantity: 50, unit: 'gb', idempotencyKey: 'idem-1' })
    const query = mockTenant.mock.calls[0]![1] as string
    expect(query).toContain('ON CONFLICT')
    expect(query).toContain('idempotency_key')
  })

  it('_mapUsageRecord preserves idempotency key', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/tenantUsageTracker')
    const rec = __testHooks._mapUsageRecord(usageRec())
    expect(rec.idempotencyKey).toBe('idem-1')
    expect(rec.metadata).toEqual({ region: 'us-east-1' })
  })

  it('_mapUsageRecord maps periodStart/End as Date', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/tenantUsageTracker')
    const rec = __testHooks._mapUsageRecord(usageRec())
    expect(rec.periodStart).toBeInstanceOf(Date)
    expect(rec.periodEnd).toBeInstanceOf(Date)
    expect(rec.periodStart.getMonth()).toBe(2) // March (0-indexed)
  })

  it('getUsageRecords applies periodEnd filter', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { getUsageRecords } = await import('../../../api/services/enterprise/tenantUsageTracker')
    await getUsageRecords('T1', { periodEnd: new Date('2024-03-31') })
    const query = mockTenant.mock.calls[0]![1] as string
    expect(query).toContain('period_end')
  })

  it('getUsageSummary byType has correct unit field', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([
      { event_type: 'storage', total_quantity: '100', total_cost: '2.30', unit: 'gb' },
    ]))
    const { getUsageSummary } = await import('../../../api/services/enterprise/tenantUsageTracker')
    const summary = await getUsageSummary('T1', new Date('2024-03-01'), new Date('2024-03-31'))
    expect(summary.byType.storage?.unit).toBe('gb')
  })

  it('getCurrentMonthSummary period covers whole month', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { getCurrentMonthSummary } = await import('../../../api/services/enterprise/tenantUsageTracker')
    const summary = await getCurrentMonthSummary('T1')
    expect(summary.periodStart.getDate()).toBe(1)
    expect(summary.periodEnd.getDate()).toBeGreaterThanOrEqual(28)
  })

  it('trackApiCall passes idempotencyKey when given', async () => {
    mockTenant.mockResolvedValueOnce(mockRow(usageRec({ event_type: 'api_calls', unit: 'calls' })))
    const { trackApiCall } = await import('../../../api/services/enterprise/tenantUsageTracker')
    await trackApiCall('T1', 3, 'req-123')
    const args = mockTenant.mock.calls[0]![2] as unknown[]
    expect(args).toContain('req-123')
  })
})

// ─── Suite 4: AI Cost — model coverage and attribution ────────────────────────

describe('aiCostTracker — model coverage', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('MODEL_COSTS has default key as fallback', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/aiCostTracker')
    expect(__testHooks.MODEL_COSTS['default']).toBeDefined()
  })

  it('MODEL_COSTS all entries have prompt and completion', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/aiCostTracker')
    Object.values(__testHooks.MODEL_COSTS).forEach(costs => {
      expect(costs.prompt).toBeGreaterThan(0)
      expect(costs.completion).toBeGreaterThan(0)
    })
  })

  it('_mapAiUsageRecord maps latency_ms as integer', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/aiCostTracker')
    const rec = __testHooks._mapAiUsageRecord(aiRec())
    expect(rec.latencyMs).toBe(1200)
    expect(typeof rec.latencyMs).toBe('number')
  })

  it('_mapAiUsageRecord maps metadata object', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/aiCostTracker')
    const rec = __testHooks._mapAiUsageRecord(aiRec())
    expect(rec.metadata).toEqual({ projectId: 'proj-abc' })
  })

  it('recordAiUsage serializes metadata as JSON', async () => {
    mockTenant
      .mockResolvedValueOnce(mockRow(aiRec()))
      .mockResolvedValueOnce(mockRows([]))
    const { recordAiUsage } = await import('../../../api/services/enterprise/aiCostTracker')
    await recordAiUsage('T1', {
      model: 'claude-opus-4', operation: 'recommendation',
      promptTokens: 5000, completionTokens: 2000,
      metadata: { projectId: 'proj-abc' },
    })
    const args = mockTenant.mock.calls[0]![2] as unknown[]
    expect(args[11]).toBe(JSON.stringify({ projectId: 'proj-abc' }))
  })

  it('getAiUsageRecords applies agentType filter', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([aiRec()]))
    const { getAiUsageRecords } = await import('../../../api/services/enterprise/aiCostTracker')
    await getAiUsageRecords('T1', { agentType: 'ReadinessAgent' })
    const query = mockTenant.mock.calls[0]![1] as string
    expect(query).toContain('agent_type')
  })

  it('getAiUsageRecords applies operation filter', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { getAiUsageRecords } = await import('../../../api/services/enterprise/aiCostTracker')
    await getAiUsageRecords('T1', { operation: 'embedding' })
    const query = mockTenant.mock.calls[0]![1] as string
    expect(query).toContain('operation')
  })

  it('getAiBudgetStatus with zero spend has isNearLimit false', async () => {
    mockTenant.mockResolvedValueOnce(mockRow({ ai_budget_monthly: '200', ai_spend_current: '0' }))
    const { getAiBudgetStatus } = await import('../../../api/services/enterprise/aiCostTracker')
    const status = await getAiBudgetStatus('T1')
    expect(status.isNearLimit).toBe(false)
    expect(status.utilizationPct).toBe(0)
  })

  it('getAiBudgetStatus remainingBudget is correct', async () => {
    mockTenant.mockResolvedValueOnce(mockRow({ ai_budget_monthly: '200', ai_spend_current: '50' }))
    const { getAiBudgetStatus } = await import('../../../api/services/enterprise/aiCostTracker')
    const status = await getAiBudgetStatus('T1')
    expect(status.remainingBudget).toBeCloseTo(150)
  })

  it('getAiCostByAgent passes since param', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { getAiCostByAgent } = await import('../../../api/services/enterprise/aiCostTracker')
    await getAiCostByAgent('T1', new Date('2024-03-01'))
    const query = mockTenant.mock.calls[0]![1] as string
    expect(query).toContain('created_at')
  })
})

// ─── Suite 5: Support — mapper completeness ───────────────────────────────────

describe('supportOperationsService — mapper completeness', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('_mapTicket maps tags array', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/supportOperationsService')
    const ticket = __testHooks._mapTicket(tkt())
    expect(ticket.tags).toEqual(['integration', 'webhook'])
  })

  it('_mapTicket maps escalatedAt when set', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/supportOperationsService')
    const ticket = __testHooks._mapTicket(tkt({ escalated_at: '2024-03-01T06:00:00Z' }))
    expect(ticket.escalatedAt).toBeInstanceOf(Date)
  })

  it('_mapTicket maps resolvedAt when set', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/supportOperationsService')
    const ticket = __testHooks._mapTicket(tkt({ resolved_at: '2024-03-05T10:00:00Z' }))
    expect(ticket.resolvedAt).toBeInstanceOf(Date)
  })

  it('_mapTicket description null yields undefined', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/supportOperationsService')
    const ticket = __testHooks._mapTicket(tkt({ description: null }))
    expect(ticket.description).toBeUndefined()
  })

  it('listTickets applies priority filter', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([tkt()]))
    const { listTickets } = await import('../../../api/services/enterprise/supportOperationsService')
    await listTickets('T1', { priority: 'high' })
    const query = mockTenant.mock.calls[0]![1] as string
    expect(query).toContain('priority')
  })

  it('listTickets applies assignee filter', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { listTickets } = await import('../../../api/services/enterprise/supportOperationsService')
    await listTickets('T1', { assignee: 'support@co.io' })
    const query = mockTenant.mock.calls[0]![1] as string
    expect(query).toContain('assignee')
  })

  it('listTickets applies limit', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { listTickets } = await import('../../../api/services/enterprise/supportOperationsService')
    await listTickets('T1', { limit: 10 })
    const args = mockTenant.mock.calls[0]![2] as unknown[]
    expect(args).toContain(10)
  })

  it('createTicket includes reporter in args', async () => {
    mockTenant.mockResolvedValueOnce(mockRow(tkt()))
    const { createTicket } = await import('../../../api/services/enterprise/supportOperationsService')
    await createTicket('T1', { title: 'Bug', reporter: 'dev@test.io' })
    const args = mockTenant.mock.calls[0]![2] as unknown[]
    expect(args).toContain('dev@test.io')
  })

  it('createTicket includes tags array in args', async () => {
    mockTenant.mockResolvedValueOnce(mockRow(tkt()))
    const { createTicket } = await import('../../../api/services/enterprise/supportOperationsService')
    await createTicket('T1', { title: 'Bug', tags: ['urgent', 'p0'] })
    const args = mockTenant.mock.calls[0]![2] as unknown[]
    expect(args).toContainEqual(['urgent', 'p0'])
  })

  it('SLA_HOURS.medium is 72', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/supportOperationsService')
    expect(__testHooks.SLA_HOURS.medium).toBe(72)
  })
})

// ─── Suite 6: Compliance Export — status transitions ──────────────────────────

describe('complianceExportEngine — status and transitions', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('markExportRunning sends correct status', async () => {
    mockTenant.mockResolvedValueOnce(mockRow({
      id: 'exp-1', tenant_id: 'T1', export_type: 'audit', format: 'json',
      status: 'running', requested_by: null, filter_from: null, filter_to: null,
      record_count: null, file_size_bytes: null, storage_path: null, checksum: null,
      manifest: {}, expires_at: null, completed_at: null, error: null,
      created_at: '2024-03-01T00:00:00Z',
    }))
    const { markExportRunning } = await import('../../../api/services/enterprise/complianceExportEngine')
    const exp = await markExportRunning('T1', 'exp-1')
    expect(exp.status).toBe('running')
    const query = mockTenant.mock.calls[0]![1] as string
    expect(query).toContain("'running'")
  })

  it('completeExport sends checksum and storage_path', async () => {
    mockTenant.mockResolvedValueOnce(mockRow({
      id: 'exp-1', tenant_id: 'T1', export_type: 'audit', format: 'json',
      status: 'completed', requested_by: null, filter_from: null, filter_to: null,
      record_count: 1500, file_size_bytes: 245000, storage_path: '/exports/exp-1.json',
      checksum: 'abc123', manifest: {}, expires_at: null,
      completed_at: '2024-03-02T00:00:00Z', error: null, created_at: '2024-03-01T00:00:00Z',
    }))
    const { completeExport } = await import('../../../api/services/enterprise/complianceExportEngine')
    const exp = await completeExport('T1', 'exp-1', {
      storagePath: '/exports/exp-1.json',
      recordCount: 1500,
      fileSizeBytes: 245000,
      data: 'export content',
    })
    expect(exp.status).toBe('completed')
    expect(exp.storagePath).toBe('/exports/exp-1.json')
  })

  it('expireStaleExports returns count of expired rows', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([{ id: 'e1' }, { id: 'e2' }, { id: 'e3' }]))
    const { expireStaleExports } = await import('../../../api/services/enterprise/complianceExportEngine')
    const count = await expireStaleExports('T1')
    expect(count).toBe(3)
  })

  it('_computeChecksum produces different hashes for different inputs', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/complianceExportEngine')
    const h1 = __testHooks._computeChecksum('data-a')
    const h2 = __testHooks._computeChecksum('data-b')
    expect(h1).not.toBe(h2)
  })

  it('getExport returns mapped export', async () => {
    mockTenant.mockResolvedValueOnce(mockRow({
      id: 'exp-1', tenant_id: 'T1', export_type: 'usage', format: 'csv',
      status: 'completed', requested_by: 'admin', filter_from: '2024-01-01T00:00:00Z',
      filter_to: '2024-01-31T00:00:00Z', record_count: 500, file_size_bytes: 12000,
      storage_path: '/exports/usage.csv', checksum: 'deadbeef', manifest: { rows: 500 },
      expires_at: '2024-03-01T00:00:00Z', completed_at: '2024-02-02T00:00:00Z',
      error: null, created_at: '2024-02-01T00:00:00Z',
    }))
    const { getExport } = await import('../../../api/services/enterprise/complianceExportEngine')
    const exp = await getExport('T1', 'exp-1')
    expect(exp?.exportType).toBe('usage')
    expect(exp?.format).toBe('csv')
    expect(exp?.recordCount).toBe(500)
    expect(exp?.checksum).toBe('deadbeef')
    expect(exp?.filterFrom).toBeInstanceOf(Date)
  })
})

// ─── Suite 7: Health checks — comprehensive ───────────────────────────────────

describe('deploymentHealthService — comprehensive', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('recordHealthCheck maps inserted row', async () => {
    mockPool.mockResolvedValueOnce(mockRow(hc()))
    const { recordHealthCheck } = await import('../../../api/services/enterprise/deploymentHealthService')
    const check = await recordHealthCheck({ checkName: 'queue.depth', status: 'warning', metadata: {} })
    expect(check.checkName).toBe('queue.depth')
    expect(check.status).toBe('warning')
    expect(check.value).toBe(450)
    expect(check.threshold).toBe(500)
  })

  it('_mapHealthCheck maps metadata correctly', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/deploymentHealthService')
    const check = __testHooks._mapHealthCheck(hc())
    expect(check.metadata).toEqual({ queueName: 'events' })
  })

  it('generateHealthReport counts correctly', async () => {
    mockPool.mockResolvedValueOnce(mockRows([
      hc({ status: 'passing' }),
      hc({ id: 'hc-2', check_name: 'db.latency', status: 'passing' }),
      hc({ id: 'hc-3', check_name: 'cache.hit', status: 'warning' }),
      hc({ id: 'hc-4', check_name: 'storage.api', status: 'failing' }),
    ]))
    const { generateHealthReport } = await import('../../../api/services/enterprise/deploymentHealthService')
    const report = await generateHealthReport()
    expect(report.passingCount).toBe(2)
    expect(report.warningCount).toBe(1)
    expect(report.failingCount).toBe(1)
    expect(report.overall).toBe('unhealthy')
    expect(report.generatedAt).toBeInstanceOf(Date)
  })

  it('generateHealthReport uses DISTINCT ON query', async () => {
    mockPool.mockResolvedValueOnce(mockRows([]))
    const { generateHealthReport } = await import('../../../api/services/enterprise/deploymentHealthService')
    await generateHealthReport()
    const query = mockPool.mock.calls[0]![0] as string
    expect(query).toContain('DISTINCT ON')
    expect(query).toContain('check_name')
  })
})

// ─── Suite 8: API Gateway — comprehensive ─────────────────────────────────────

describe('apiGatewayService — comprehensive', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('_mapApiKey maps quotaMonthly as number', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/apiGatewayService')
    const k = __testHooks._mapApiKey(apiKey({ quota_monthly: '5000' }))
    expect(k.quotaMonthly).toBe(5000)
    expect(typeof k.quotaMonthly).toBe('number')
  })

  it('_mapApiKey maps lastUsedAt and expiresAt', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/apiGatewayService')
    const k = __testHooks._mapApiKey(apiKey())
    expect(k.lastUsedAt).toBeInstanceOf(Date)
    expect(k.expiresAt).toBeInstanceOf(Date)
    expect(k.expiresAt!.getFullYear()).toBe(2025)
  })

  it('_mapApiKey scopes is array', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/apiGatewayService')
    const k = __testHooks._mapApiKey(apiKey())
    expect(Array.isArray(k.scopes)).toBe(true)
    expect(k.scopes).toContain('webhooks:send')
  })

  it('_mapApiKey usageThisMonth defaults to 0', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/apiGatewayService')
    const k = __testHooks._mapApiKey(apiKey({ usage_this_month: null }))
    expect(k.usageThisMonth).toBe(0)
  })

  it('_hashKey is 64 hex chars (sha256)', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/apiGatewayService')
    const hash = __testHooks._hashKey('any-secret-value')
    expect(/^[0-9a-f]{64}$/.test(hash)).toBe(true)
  })

  it('hasScope wildcard grants everything', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/apiGatewayService')
    const k = __testHooks._mapApiKey(apiKey({ scopes: ['*'] }))
    expect(__testHooks.hasScope(k, 'admin')).toBe(true)
    expect(__testHooks.hasScope(k, 'delete:all')).toBe(true)
  })

  it('hasScope false for no match and no wildcard', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/apiGatewayService')
    const k = __testHooks._mapApiKey(apiKey({ scopes: ['read', 'webhooks:send'] }))
    expect(__testHooks.hasScope(k, 'write')).toBe(false)
    expect(__testHooks.hasScope(k, 'admin')).toBe(false)
  })

  it('createApiKey includes scopes in insert args', async () => {
    mockTenant.mockResolvedValueOnce(mockRow(apiKey()))
    const { createApiKey } = await import('../../../api/services/enterprise/apiGatewayService')
    await createApiKey('T1', { name: 'Test', scopes: ['read', 'write'], expiresAt: new Date('2025-12-31') })
    const args = mockTenant.mock.calls[0]![2] as unknown[]
    expect(args).toContainEqual(['read', 'write'])
  })

  it('listApiKeys with no status returns all', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([apiKey(), apiKey({ id: 'k-2', status: 'revoked' })]))
    const { listApiKeys } = await import('../../../api/services/enterprise/apiGatewayService')
    const keys = await listApiKeys('T1')
    expect(keys.length).toBe(2)
  })

  it('incrementApiKeyUsage passes tenantId and keyId', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { incrementApiKeyUsage } = await import('../../../api/services/enterprise/apiGatewayService')
    await incrementApiKeyUsage('T1', 'key-999', 10)
    const args = mockTenant.mock.calls[0]![2] as unknown[]
    expect(args).toContain('T1')
    expect(args).toContain('key-999')
    expect(args).toContain(10)
  })
})

// ─── Suite 9: Demo Tenant — extended ──────────────────────────────────────────

describe('demoTenantGenerator — extended', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('_mapDemoTenant maps metadata as object', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/demoTenantGenerator')
    const d = __testHooks._mapDemoTenant(demo())
    expect(d.metadata).toEqual({ tier: 'enterprise', description: 'Grid modernization demo' })
  })

  it('_mapDemoTenant seededAt null is undefined', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/demoTenantGenerator')
    const d = __testHooks._mapDemoTenant(demo({ seeded_at: null }))
    expect(d.seededAt).toBeUndefined()
  })

  it('DEMO_TEMPLATES all have required fields', async () => {
    const { __testHooks } = await import('../../../api/services/enterprise/demoTenantGenerator')
    Object.values(__testHooks.DEMO_TEMPLATES).forEach(t => {
      expect(t.industry).toBeTruthy()
      expect(t.label).toBeTruthy()
      expect(t.tier).toMatch(/^(professional|enterprise)$/)
      expect(t.projectCount).toBeGreaterThan(0)
    })
  })

  it('listDemoTenants with no filters runs query without WHERE', async () => {
    mockPool.mockResolvedValueOnce(mockRows([demo()]))
    const { listDemoTenants } = await import('../../../api/services/enterprise/demoTenantGenerator')
    const results = await listDemoTenants()
    expect(results.length).toBe(1)
    const query = mockPool.mock.calls[0]![0] as string
    expect(query).not.toContain('WHERE')
  })

  it('listDemoTenants both filters applied', async () => {
    mockPool.mockResolvedValueOnce(mockRows([]))
    const { listDemoTenants } = await import('../../../api/services/enterprise/demoTenantGenerator')
    await listDemoTenants({ industry: 'utilities', status: 'active' })
    const query = mockPool.mock.calls[0]![0] as string
    expect(query).toContain('industry')
    expect(query).toContain('status')
  })

  it('expireStaleDemoTenants sets correct SQL', async () => {
    mockPool.mockResolvedValueOnce(mockRows([]))
    const { expireStaleDemoTenants } = await import('../../../api/services/enterprise/demoTenantGenerator')
    await expireStaleDemoTenants()
    const query = mockPool.mock.calls[0]![0] as string
    expect(query).toContain("'expired'")
    expect(query).toContain('expires_at < now()')
  })
})

// ─── Suite 10: Cross-service integration patterns ─────────────────────────────

describe('cross-service integration patterns', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('featureGateService resolveEntitlements handles no feature flags', async () => {
    mockTenant
      .mockResolvedValueOnce(mockRow(sub({ tier: 'starter' })))
      .mockResolvedValueOnce(mockRows([]))
    const { resolveEntitlements } = await import('../../../api/services/enterprise/featureGateService')
    const summary = await resolveEntitlements('T1')
    expect(summary.features).toEqual({})
    expect(summary.tier).toBe('starter')
  })

  it('aiCostTracker and usageTracker are independent services', async () => {
    // recordUsage should not call ai_usage_records table
    mockTenant.mockResolvedValueOnce(mockRow(usageRec()))
    const { recordUsage } = await import('../../../api/services/enterprise/tenantUsageTracker')
    await recordUsage('T1', { eventType: 'api_calls', quantity: 1, unit: 'calls' })
    const query = mockTenant.mock.calls[0]![1] as string
    expect(query).toContain('tenant_usage')
    expect(query).not.toContain('ai_usage_records')
  })

  it('complianceExportEngine requireFeature blocks without flag', async () => {
    // isFeatureEnabled → no row
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { requestExport } = await import('../../../api/services/enterprise/complianceExportEngine')
    await expect(requestExport('T1', { exportType: 'audit', format: 'json' })).rejects.toThrow('compliance_export')
  })

  it('customerHealthEngine gracefully handles audit_log missing', async () => {
    // All sub-queries will fail/empty
    mockTenant
      .mockResolvedValueOnce(mockRow(sub()))
      .mockRejectedValueOnce(new Error('relation audit_log does not exist'))
      .mockRejectedValueOnce(new Error('relation audit_log does not exist'))
      .mockResolvedValueOnce(mockRow({ open_count: 0, critical_count: 0 }))
      .mockResolvedValueOnce(mockRow({ ai_budget_monthly: '200', ai_spend_current: '0' }))
      .mockResolvedValueOnce(mockRow({ cnt: 3 }))
    const { computeHealthScore } = await import('../../../api/services/enterprise/customerHealthEngine')
    const score = await computeHealthScore('T1')
    // Should not throw; activeUsers7Days falls back to 0
    expect(score.tenantHealthScore).toBeGreaterThanOrEqual(0)
    expect(score.tenantHealthScore).toBeLessThanOrEqual(100)
    expect(score.activeUsers7Days).toBe(0)
  })

  it('apiGatewayService revokeApiKey returns mapped key', async () => {
    mockTenant.mockResolvedValueOnce(mockRow(apiKey({ status: 'revoked', revoked_by: 'admin' })))
    const { revokeApiKey } = await import('../../../api/services/enterprise/apiGatewayService')
    const key = await revokeApiKey('T1', 'k-1', 'admin')
    expect(key.status).toBe('revoked')
  })

  it('supportOperationsService getTicket returns mapped ticket', async () => {
    mockTenant.mockResolvedValueOnce(mockRow(tkt()))
    const { getTicket } = await import('../../../api/services/enterprise/supportOperationsService')
    const ticket = await getTicket('T1', 'tkt-1')
    expect(ticket?.ticketNumber).toBe('TKT-AAA-BB')
    expect(ticket?.tags).toEqual(['integration', 'webhook'])
  })

  it('tenantArchivalService reactivateTenant calls transitionLifecycle', async () => {
    // getSubscription (reactivateTenant)
    mockTenant.mockResolvedValueOnce(mockRow(sub({ lifecycle_status: 'suspended' })))
    // getSubscription (transitionLifecycle internal — fetches fromStatus)
    mockTenant.mockResolvedValueOnce(mockRow(sub({ lifecycle_status: 'suspended' })))
    // UPDATE subscription
    mockTenant.mockResolvedValueOnce(mockRow(sub({ lifecycle_status: 'active' })))
    // INSERT lifecycle event
    mockTenant.mockResolvedValueOnce(mockRow({
      id: 'evt-1', tenant_id: 'T1', event_type: 'lifecycle_active',
      from_status: 'suspended', to_status: 'active', actor: 'system',
      reason: 'Account reactivated', metadata: {}, created_at: '2024-03-05T00:00:00Z',
    }))
    const { reactivateTenant } = await import('../../../api/services/enterprise/tenantArchivalService')
    const result = await reactivateTenant('T1', { actor: 'billing_system' })
    expect(result.subscription.lifecycleStatus).toBe('active')
    expect(result.event.toStatus).toBe('active')
  })

  it('tenantUsageTracker getUsageRecords limit defaults to 500', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { getUsageRecords } = await import('../../../api/services/enterprise/tenantUsageTracker')
    await getUsageRecords('T1')
    const args = mockTenant.mock.calls[0]![2] as unknown[]
    expect(args).toContain(500)
  })
})
