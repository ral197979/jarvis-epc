# Feature Gating System

**Denver Engineering — Ava Phase 8 (v8.0.0)**

## Overview

Feature gating controls which capabilities are available to each tenant. Gates can be time-bounded (expiring trials, promotional access) and carry per-feature configuration (e.g., agent limits, simulation counts).

## FEATURE_KEYS

```typescript
DIGITAL_TWIN            = 'digital_twin'
ADAPTIVE_INTELLIGENCE   = 'adaptive_intelligence'
SCENARIO_SIMULATION     = 'scenario_simulation'
MULTI_AGENT             = 'multi_agent'
COMPLIANCE_EXPORT       = 'compliance_export'
ADVANCED_ANALYTICS      = 'advanced_analytics'
API_ACCESS              = 'api_access'
WEBHOOK_DELIVERY        = 'webhook_delivery'
AI_AGENTS               = 'ai_agents'
PREDICTIVE_MAINTENANCE  = 'predictive_maintenance'
```

## Evaluation Logic

A feature flag is **effective** (truly enabled) when **all** of the following are true:
1. A row exists in `tenant_feature_flags` for `(tenant_id, feature_key)`
2. `enabled = true`
3. Either `expires_at IS NULL` or `expires_at > NOW()`

Any DB error during evaluation silently returns `false` — the feature gate fails closed, not open.

## API Surface

| Function | Returns | Use Case |
|----------|---------|----------|
| `isFeatureEnabled(tenantId, featureKey)` | `boolean` | Guard a code path |
| `getFeatureConfig<T>(tenantId, featureKey)` | `T \| null` | Get typed feature config |
| `requireFeature(tenantId, featureKey)` | `void \| throws` | Middleware enforcement |
| `setFeatureFlag(tenantId, input)` | `TenantFeatureFlag` | Admin: enable/disable |
| `listFeatureFlags(tenantId)` | `TenantFeatureFlag[]` | Entitlement view |
| `resolveEntitlements(tenantId)` | `EntitlementSummary` | Full entitlement snapshot |

## FeatureGateError

`requireFeature()` throws `FeatureGateError` (extends `Error`) with `name = 'FeatureGateError'` when the feature is not enabled. Route handlers catch this and return `403` with `{ error: 'feature_gate' }`.

## Quota Enforcement

Two separate quota dimensions, each with `QuotaCheckResult`:

```typescript
interface QuotaCheckResult {
  allowed: boolean   // true = request can proceed
  current: number    // current usage this period
  limit: number      // configured limit
  remaining: number  // Math.max(0, limit - current)
  reason?: string    // set when allowed = false
}
```

- **API Quota**: Counts `api_calls` usage events for the current calendar month
- **Seat Quota**: Reads `seat_count` / `seat_limit` from `tenant_subscriptions`

Both return `allowed: false` with `reason: 'No subscription found'` when the tenant has no subscription row.

## EntitlementSummary

`resolveEntitlements()` executes two parallel queries (subscription + all feature flags) and returns a single snapshot:

```typescript
interface EntitlementSummary {
  tenantId: string
  tier: string
  features: Record<string, boolean>  // all keys, respects expiry
  seatLimit: number
  seatCount: number
  apiQuota: number
  storageLimitGb: number
  aiBudgetMonthly?: number  // undefined = unlimited
}
```
