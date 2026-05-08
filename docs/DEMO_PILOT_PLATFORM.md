# Demo and Pilot Platform

**Denver Engineering — Ava Phase 8 (v8.0.0)**

## Overview

The Demo Tenant Generator creates fully provisioned, industry-specific tenant environments for sales demos, pre-sales pilots, and internal testing. Demo tenants are self-contained, resettable, and time-limited.

## Demo Templates

| Template Key | Label | Industry | Tier |
|-------------|-------|----------|------|
| `construction_enterprise` | Apex Construction Group | Construction | Enterprise |
| `manufacturing_pro` | Precision Works Inc | Manufacturing | Professional |
| `utilities_enterprise` | GridTech Energy | Utilities | Enterprise |
| `healthcare_pro` | Meridian Health Systems | Healthcare | Professional |
| `logistics_enterprise` | FastFreight Logistics | Logistics | Enterprise |

## Demo Lifecycle

```
created → active → (reset → active) → expired
                              ↑
                     (can reset multiple times)
```

1. **Create** — `createDemoTenant(templateKey)` generates a UUID, calls `provisionTenant()`, registers in `demo_tenants`, and triggers async data seeding
2. **TTL** — Demos expire after 30 days (`DEMO_TTL_MS`) by default; custom `expiresAt` can be passed
3. **Reset** — `resetDemoTenant()` clears usage records, AI spend, support tickets, and seat count — restoring the tenant to a pristine demo state
4. **Expire** — `expireStaleDemoTenants()` transitions `active` demos past their `expires_at` to `expired`

## Data Seeding

`_seedDemoData()` is called asynchronously after tenant registration (fire-and-forget with `.catch(() => {})`). Seeding failures are non-fatal — the demo tenant is still usable. Industry-specific seeding (projects, systems, assets) is left to domain services to avoid circular dependencies.

## Reset Behavior

`resetDemoTenant()` executes in two phases:
1. **Mark reset_pending** — atomic status update
2. **Clear data** — parallel deletion of `tenant_usage`, `ai_usage_records`, `support_tickets`; reset `ai_spend_current = 0`, `seat_count = 1`
3. **Mark active** — restore status

All data-clearing operations use `.catch(() => {})` — individual table failures are non-fatal (tables may not exist in all deployment configurations).

## Admin Queries

All demo tenant operations use `pool.query` directly (not `tenantQuery`) because demo management is an admin function, not a tenant-scoped operation. The `demo_tenants` table has no RLS.

## Registration Tracking

Demo tenants are tracked in both:
- `demo_tenants` — demo-specific metadata (industry, template, label, status, expiry)
- `tenant_subscriptions` — standard subscription record created via `provisionTenant()`

This means demo tenants appear in admin subscription lists with their tier, but are also identifiable as demos via the `demo_tenants` registry.
