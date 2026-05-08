// Denver Engineering — Tenant Provisioning Service (v8.0.0)
// Enterprise tenant provisioning: subscription creation, feature seeding, lifecycle audit.

import { tenantQuery } from '../../db/pool'
import {
  TenantSubscription, CreateSubscriptionInput,
  TenantLifecycleEvent, TenantLifecycleStatus,
  TenantFeatureFlag, FEATURE_KEYS,
} from './enterpriseTypes'

// ─── Provision a new tenant ───────────────────────────────────────────────────

export interface ProvisionResult {
  subscription: TenantSubscription
  lifecycleEvent: TenantLifecycleEvent
  featuresSeeded: TenantFeatureFlag[]
}

export async function provisionTenant(
  tenantId: string,
  input: CreateSubscriptionInput,
): Promise<ProvisionResult> {
  const {
    tier = 'starter',
    seatLimit = _defaultSeatLimit(tier),
    aiBudgetMonthly = _defaultAiBudget(tier),
    storageLimitGb = _defaultStorage(tier),
    apiQuotaMonthly = _defaultApiQuota(tier),
    trialDays = 14,
  } = input

  const trialEndsAt = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000)

  const subRes = await tenantQuery(
    tenantId,
    `INSERT INTO tenant_subscriptions
      (tenant_id, tier, status, lifecycle_status,
       seat_limit, ai_budget_monthly, storage_limit_gb, api_quota_monthly, trial_ends_at)
     VALUES ($1,$2,'trialing','trial',$3,$4,$5,$6,$7)
     ON CONFLICT (tenant_id) DO UPDATE SET
       tier = EXCLUDED.tier,
       updated_at = now()
     RETURNING *`,
    [tenantId, tier, seatLimit, aiBudgetMonthly, storageLimitGb, apiQuotaMonthly, trialEndsAt],
  )
  const subscription = _mapSubscription(subRes.rows[0])

  // Record lifecycle event (immutable)
  const eventRes = await tenantQuery(
    tenantId,
    `INSERT INTO tenant_lifecycle_events
      (tenant_id, event_type, to_status, actor, reason, metadata)
     VALUES ($1, 'provisioned', 'trial', 'system', 'New tenant provisioned', $2)
     RETURNING *`,
    [tenantId, JSON.stringify({ tier, trialDays })],
  )
  const lifecycleEvent = _mapLifecycleEvent(eventRes.rows[0])

  // Seed default features for tier
  const featuresSeeded = await _seedDefaultFeatures(tenantId, tier)

  return { subscription, lifecycleEvent, featuresSeeded }
}

// ─── Get subscription ─────────────────────────────────────────────────────────

export async function getSubscription(tenantId: string): Promise<TenantSubscription | null> {
  const res = await tenantQuery(
    tenantId,
    `SELECT * FROM tenant_subscriptions WHERE tenant_id = $1`,
    [tenantId],
  )
  return res.rows.length > 0 ? _mapSubscription(res.rows[0]) : null
}

// ─── Update lifecycle status ──────────────────────────────────────────────────

export async function transitionLifecycle(
  tenantId: string,
  toStatus: TenantLifecycleStatus,
  opts: { actor?: string; reason?: string; metadata?: Record<string, unknown> } = {},
): Promise<{ subscription: TenantSubscription; event: TenantLifecycleEvent }> {
  // Fetch current status
  const current = await getSubscription(tenantId)
  const fromStatus = current?.lifecycleStatus

  const subRes = await tenantQuery(
    tenantId,
    `UPDATE tenant_subscriptions
     SET lifecycle_status = $2,
         status = $3,
         updated_at = now()
     WHERE tenant_id = $1
     RETURNING *`,
    [tenantId, toStatus, _billingStatusFor(toStatus)],
  )
  if (subRes.rows.length === 0) throw new Error(`Subscription for ${tenantId} not found`)

  const eventRes = await tenantQuery(
    tenantId,
    `INSERT INTO tenant_lifecycle_events
      (tenant_id, event_type, from_status, to_status, actor, reason, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      tenantId,
      `lifecycle_${toStatus}`,
      fromStatus ?? null,
      toStatus,
      opts.actor ?? 'system',
      opts.reason ?? null,
      JSON.stringify(opts.metadata ?? {}),
    ],
  )

  return {
    subscription: _mapSubscription(subRes.rows[0]),
    event: _mapLifecycleEvent(eventRes.rows[0]),
  }
}

// ─── Get lifecycle history ────────────────────────────────────────────────────

export async function getLifecycleHistory(tenantId: string): Promise<TenantLifecycleEvent[]> {
  const res = await tenantQuery(
    tenantId,
    `SELECT * FROM tenant_lifecycle_events WHERE tenant_id = $1 ORDER BY created_at ASC`,
    [tenantId],
  )
  return res.rows.map(_mapLifecycleEvent)
}

// ─── List subscriptions (admin) ───────────────────────────────────────────────

export async function listSubscriptions(opts: {
  lifecycleStatus?: TenantLifecycleStatus
  tier?: string
  limit?: number
} = {}): Promise<TenantSubscription[]> {
  const { lifecycleStatus, tier, limit = 100 } = opts
  const params: unknown[] = []
  const clauses: string[] = []

  if (lifecycleStatus != null) { params.push(lifecycleStatus); clauses.push(`lifecycle_status = $${params.length}`) }
  if (tier != null)            { params.push(tier);            clauses.push(`tier = $${params.length}`) }

  params.push(limit)
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''

  // Admin query — not tenant-scoped
  const { default: pool } = await import('../../db/pool')
  const res = await pool.query(
    `SELECT * FROM tenant_subscriptions ${where} ORDER BY created_at DESC LIMIT $${params.length}`,
    params,
  )
  return res.rows.map(_mapSubscription)
}

// ─── Seed default features ────────────────────────────────────────────────────

async function _seedDefaultFeatures(
  tenantId: string,
  tier: string,
): Promise<TenantFeatureFlag[]> {
  const features = _defaultFeatures(tier)
  const results: TenantFeatureFlag[] = []

  for (const { key, enabled, config } of features) {
    const res = await tenantQuery(
      tenantId,
      `INSERT INTO tenant_feature_flags (tenant_id, feature_key, enabled, config, granted_by)
       VALUES ($1, $2, $3, $4, 'system')
       ON CONFLICT (tenant_id, feature_key) DO UPDATE SET
         enabled = EXCLUDED.enabled,
         config = EXCLUDED.config,
         updated_at = now()
       RETURNING *`,
      [tenantId, key, enabled, JSON.stringify(config)],
    )
    results.push(_mapFeatureFlag(res.rows[0]))
  }

  return results
}

// ─── Tier defaults ────────────────────────────────────────────────────────────

function _defaultSeatLimit(tier: string): number {
  return { starter: 5, professional: 25, enterprise: 200, custom: 1000 }[tier] ?? 5
}

function _defaultAiBudget(tier: string): number | null {
  const budgets: Record<string, number | null> = { starter: 50, professional: 200, enterprise: 1000, custom: null }
  const val = budgets[tier]
  return val !== undefined ? val : 50
}

function _defaultStorage(tier: string): number {
  return { starter: 10, professional: 100, enterprise: 1000, custom: 10000 }[tier] ?? 10
}

function _defaultApiQuota(tier: string): number {
  return { starter: 10000, professional: 100000, enterprise: 1000000, custom: 10000000 }[tier] ?? 10000
}

function _defaultFeatures(tier: string): Array<{ key: string; enabled: boolean; config: Record<string, unknown> }> {
  const base = [
    { key: FEATURE_KEYS.API_ACCESS, enabled: true, config: {} },
    { key: FEATURE_KEYS.WEBHOOK_DELIVERY, enabled: tier !== 'starter', config: {} },
  ]
  if (tier === 'starter') return base
  if (tier === 'professional') {
    return [
      ...base,
      { key: FEATURE_KEYS.DIGITAL_TWIN, enabled: true, config: {} },
      { key: FEATURE_KEYS.AI_AGENTS, enabled: true, config: { agentLimit: 3 } },
      { key: FEATURE_KEYS.SCENARIO_SIMULATION, enabled: true, config: { limit: 50 } },
    ]
  }
  // enterprise + custom
  return [
    ...base,
    { key: FEATURE_KEYS.DIGITAL_TWIN, enabled: true, config: {} },
    { key: FEATURE_KEYS.AI_AGENTS, enabled: true, config: { agentLimit: 10 } },
    { key: FEATURE_KEYS.SCENARIO_SIMULATION, enabled: true, config: { limit: 500 } },
    { key: FEATURE_KEYS.ADAPTIVE_INTELLIGENCE, enabled: true, config: {} },
    { key: FEATURE_KEYS.COMPLIANCE_EXPORT, enabled: true, config: {} },
    { key: FEATURE_KEYS.MULTI_AGENT, enabled: true, config: {} },
    { key: FEATURE_KEYS.PREDICTIVE_MAINTENANCE, enabled: true, config: {} },
    { key: FEATURE_KEYS.ADVANCED_ANALYTICS, enabled: true, config: {} },
  ]
}

function _billingStatusFor(lifecycle: TenantLifecycleStatus): string {
  const map: Record<TenantLifecycleStatus, string> = {
    trial: 'trialing',
    onboarding: 'trialing',
    active: 'active',
    suspended: 'paused',
    cancelled: 'cancelled',
    archived: 'cancelled',
  }
  return map[lifecycle] ?? 'active'
}

// ─── Mappers ──────────────────────────────────────────────────────────────────

export function _mapSubscription(row: Record<string, unknown>): TenantSubscription {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    tier: row.tier as TenantSubscription['tier'],
    status: row.status as TenantSubscription['status'],
    lifecycleStatus: row.lifecycle_status as TenantLifecycleStatus,
    stripeCustomerId: row.stripe_customer_id != null ? String(row.stripe_customer_id) : undefined,
    stripeSubscriptionId: row.stripe_subscription_id != null ? String(row.stripe_subscription_id) : undefined,
    trialEndsAt: row.trial_ends_at != null ? new Date(row.trial_ends_at as string) : undefined,
    currentPeriodStart: row.current_period_start != null ? new Date(row.current_period_start as string) : undefined,
    currentPeriodEnd: row.current_period_end != null ? new Date(row.current_period_end as string) : undefined,
    seatCount: Number(row.seat_count ?? 1),
    seatLimit: Number(row.seat_limit ?? 5),
    aiBudgetMonthly: row.ai_budget_monthly != null ? Number(row.ai_budget_monthly) : undefined,
    aiSpendCurrent: Number(row.ai_spend_current ?? 0),
    storageLimitGb: Number(row.storage_limit_gb ?? 10),
    apiQuotaMonthly: Number(row.api_quota_monthly ?? 10000),
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  }
}

export function _mapLifecycleEvent(row: Record<string, unknown>): TenantLifecycleEvent {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    eventType: row.event_type as string,
    fromStatus: row.from_status != null ? row.from_status as TenantLifecycleStatus : undefined,
    toStatus: row.to_status as TenantLifecycleStatus,
    actor: row.actor != null ? String(row.actor) : undefined,
    reason: row.reason != null ? String(row.reason) : undefined,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: new Date(row.created_at as string),
  }
}

export function _mapFeatureFlag(row: Record<string, unknown>): TenantFeatureFlag {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    featureKey: row.feature_key as string,
    enabled: Boolean(row.enabled),
    config: (row.config ?? {}) as Record<string, unknown>,
    grantedBy: row.granted_by != null ? String(row.granted_by) : undefined,
    expiresAt: row.expires_at != null ? new Date(row.expires_at as string) : undefined,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  }
}

export const __testHooks = {
  _mapSubscription,
  _mapLifecycleEvent,
  _mapFeatureFlag,
  _defaultSeatLimit,
  _defaultAiBudget,
  _defaultFeatures,
  _billingStatusFor,
}
