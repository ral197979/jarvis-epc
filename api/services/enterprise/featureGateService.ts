// Denver Engineering — Feature Gate Service (v8.0.0)
// Middleware-compatible feature gating, quota enforcement, and entitlement resolution.

import { tenantQuery } from '../../db/pool'
import { TenantFeatureFlag, SetFeatureFlagInput, FEATURE_KEYS } from './enterpriseTypes'
import { _mapFeatureFlag } from './tenantProvisioningService'

// ─── Check if feature is enabled ─────────────────────────────────────────────

export async function isFeatureEnabled(
  tenantId: string,
  featureKey: string,
): Promise<boolean> {
  try {
    const res = await tenantQuery(
      tenantId,
      `SELECT enabled, expires_at FROM tenant_feature_flags
       WHERE tenant_id = $1 AND feature_key = $2`,
      [tenantId, featureKey],
    )
    if (res.rows.length === 0) return false
    const row = res.rows[0]!
    if (!row.enabled) return false
    if (row.expires_at != null && new Date(row.expires_at as string) < new Date()) return false
    return true
  } catch {
    return false
  }
}

// ─── Get feature config ───────────────────────────────────────────────────────

export async function getFeatureConfig<T = Record<string, unknown>>(
  tenantId: string,
  featureKey: string,
): Promise<T | null> {
  try {
    const res = await tenantQuery(
      tenantId,
      `SELECT config, enabled, expires_at FROM tenant_feature_flags
       WHERE tenant_id = $1 AND feature_key = $2`,
      [tenantId, featureKey],
    )
    if (res.rows.length === 0) return null
    const row = res.rows[0]!
    if (!row.enabled) return null
    if (row.expires_at != null && new Date(row.expires_at as string) < new Date()) return null
    return (row.config ?? {}) as T
  } catch {
    return null
  }
}

// ─── Set feature flag ─────────────────────────────────────────────────────────

export async function setFeatureFlag(
  tenantId: string,
  input: SetFeatureFlagInput,
): Promise<TenantFeatureFlag> {
  const { featureKey, enabled, config = {}, grantedBy, expiresAt } = input

  const res = await tenantQuery(
    tenantId,
    `INSERT INTO tenant_feature_flags
      (tenant_id, feature_key, enabled, config, granted_by, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (tenant_id, feature_key) DO UPDATE SET
       enabled = EXCLUDED.enabled,
       config = EXCLUDED.config,
       granted_by = COALESCE(EXCLUDED.granted_by, tenant_feature_flags.granted_by),
       expires_at = EXCLUDED.expires_at,
       updated_at = now()
     RETURNING *`,
    [tenantId, featureKey, enabled, JSON.stringify(config), grantedBy ?? null, expiresAt ?? null],
  )
  return _mapFeatureFlag(res.rows[0])
}

// ─── List features ────────────────────────────────────────────────────────────

export async function listFeatureFlags(tenantId: string): Promise<TenantFeatureFlag[]> {
  const res = await tenantQuery(
    tenantId,
    `SELECT * FROM tenant_feature_flags WHERE tenant_id = $1 ORDER BY feature_key`,
    [tenantId],
  )
  return res.rows.map(_mapFeatureFlag)
}

// ─── Require feature (throws if not enabled) ──────────────────────────────────

export class FeatureGateError extends Error {
  constructor(featureKey: string) {
    super(`Feature '${featureKey}' is not enabled for this tenant`)
    this.name = 'FeatureGateError'
  }
}

export async function requireFeature(tenantId: string, featureKey: string): Promise<void> {
  const enabled = await isFeatureEnabled(tenantId, featureKey)
  if (!enabled) throw new FeatureGateError(featureKey)
}

// ─── Check quota ──────────────────────────────────────────────────────────────

export interface QuotaCheckResult {
  allowed: boolean
  current: number
  limit: number
  remaining: number
  reason?: string
}

export async function checkApiQuota(
  tenantId: string,
  increment = 1,
): Promise<QuotaCheckResult> {
  const res = await tenantQuery(
    tenantId,
    `SELECT api_quota_monthly FROM tenant_subscriptions WHERE tenant_id = $1`,
    [tenantId],
  )
  if (res.rows.length === 0) {
    return { allowed: false, current: 0, limit: 0, remaining: 0, reason: 'No subscription found' }
  }
  const limit = Number(res.rows[0]!.api_quota_monthly ?? 10000)

  // Count this month's API calls
  const usageRes = await tenantQuery(
    tenantId,
    `SELECT COALESCE(SUM(quantity), 0)::int AS total
     FROM tenant_usage
     WHERE tenant_id = $1
       AND event_type = 'api_calls'
       AND period_start >= date_trunc('month', now())`,
    [tenantId],
  )
  const current = Number(usageRes.rows[0]?.total ?? 0)
  const remaining = Math.max(0, limit - current)

  return {
    allowed: current + increment <= limit,
    current,
    limit,
    remaining,
    reason: current + increment > limit ? `Monthly API quota of ${limit} calls exceeded` : undefined,
  }
}

export async function checkSeatQuota(
  tenantId: string,
  requestedSeats = 1,
): Promise<QuotaCheckResult> {
  const res = await tenantQuery(
    tenantId,
    `SELECT seat_count, seat_limit FROM tenant_subscriptions WHERE tenant_id = $1`,
    [tenantId],
  )
  if (res.rows.length === 0) {
    return { allowed: false, current: 0, limit: 0, remaining: 0, reason: 'No subscription found' }
  }
  const row = res.rows[0]!
  const current = Number(row.seat_count ?? 1)
  const limit = Number(row.seat_limit ?? 5)
  const remaining = Math.max(0, limit - current)
  return {
    allowed: current + requestedSeats <= limit,
    current,
    limit,
    remaining,
    reason: current + requestedSeats > limit ? `Seat limit of ${limit} reached` : undefined,
  }
}

// ─── Resolve all entitlements ─────────────────────────────────────────────────

export interface EntitlementSummary {
  tenantId: string
  tier: string
  features: Record<string, boolean>
  seatLimit: number
  seatCount: number
  apiQuota: number
  storageLimitGb: number
  aiBudgetMonthly?: number
}

export async function resolveEntitlements(tenantId: string): Promise<EntitlementSummary> {
  const [subRes, flagRes] = await Promise.all([
    tenantQuery(tenantId, `SELECT * FROM tenant_subscriptions WHERE tenant_id = $1`, [tenantId]),
    tenantQuery(tenantId, `SELECT feature_key, enabled, expires_at FROM tenant_feature_flags WHERE tenant_id = $1`, [tenantId]),
  ])

  const sub = subRes.rows[0]
  const features: Record<string, boolean> = {}
  const now = new Date()
  for (const row of flagRes.rows) {
    const expired = row.expires_at != null && new Date(row.expires_at as string) < now
    features[row.feature_key as string] = Boolean(row.enabled) && !expired
  }

  return {
    tenantId,
    tier: sub != null ? String(sub.tier) : 'starter',
    features,
    seatLimit: Number(sub?.seat_limit ?? 5),
    seatCount: Number(sub?.seat_count ?? 1),
    apiQuota: Number(sub?.api_quota_monthly ?? 10000),
    storageLimitGb: Number(sub?.storage_limit_gb ?? 10),
    aiBudgetMonthly: sub?.ai_budget_monthly != null ? Number(sub.ai_budget_monthly) : undefined,
  }
}

export const __testHooks = { _mapFeatureFlag }
