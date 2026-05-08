# Enterprise Tenant Lifecycle

**Denver Engineering — Ava Phase 8 (v8.0.0)**

## Overview

Every customer organization (tenant) progresses through a defined lifecycle from initial provisioning through active usage to eventual archival. The lifecycle is immutably logged for compliance and operational replay.

## Lifecycle States

```
trial → onboarding → active → suspended → cancelled → archived
                              ↑                      ↑
                              └── (reactivation) ───┘ (recovery only)
```

| Status | Billing Status | Description |
|--------|---------------|-------------|
| `trial` | `trialing` | New tenant in free trial period |
| `onboarding` | `trialing` | Actively completing setup tasks |
| `active` | `active` | Fully operational, invoiced |
| `suspended` | `paused` | Temporarily blocked (e.g., non-payment) |
| `cancelled` | `cancelled` | Voluntarily cancelled |
| `archived` | `cancelled` | Administratively closed; data preserved |

## Provisioning Flow

`provisionTenant()` executes three steps atomically:
1. **Subscription insert** — Creates `tenant_subscriptions` row with tier defaults
2. **Lifecycle event** — Records `provisioned → trial` in `tenant_lifecycle_events`
3. **Feature seeding** — Inserts tier-appropriate feature flags

The subscription insert uses `ON CONFLICT (tenant_id) DO UPDATE` so re-provisioning a tenant is idempotent — the tier is updated but existing data is preserved.

## Lifecycle Events (Immutable Audit)

`tenant_lifecycle_events` is an append-only audit table. It is intentionally **not** protected by Row-Level Security — lifecycle events are internal administrative records, not tenant-facing data. This means:
- No event can be deleted or modified through the application layer
- Complete audit replay is always possible
- Billing status is always derivable from the event log

## Tier Defaults

| Tier | Seats | API Quota/Month | Storage | AI Budget/Month |
|------|-------|-----------------|---------|-----------------|
| Starter | 5 | 10,000 | 10 GB | $50 |
| Professional | 25 | 100,000 | 100 GB | $200 |
| Enterprise | 200 | 1,000,000 | 1,000 GB | $1,000 |
| Custom | 1,000 | 10,000,000 | 10,000 GB | Unlimited |

## Default Features by Tier

- **Starter**: API Access only (webhooks disabled)
- **Professional**: API + Webhooks + Digital Twin + AI Agents (limit: 3) + Scenario Simulation (limit: 50)
- **Enterprise/Custom**: All features enabled, including Adaptive Intelligence, Compliance Export, Multi-Agent, Predictive Maintenance, Advanced Analytics

## Suspension and Archival

- **Suspend**: Blocks active access; all feature flags remain but API key access is effectively revoked at the route level
- **Archive**: Revokes all API keys, disables all feature flags, transitions to `archived` state. Data is preserved — permanent deletion is out of scope
- **Reactivate**: Suspended tenants can be reactivated to `active`. Archived tenants cannot be reactivated through the standard flow (requires manual recovery)
