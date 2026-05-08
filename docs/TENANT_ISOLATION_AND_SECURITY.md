# Tenant Isolation and Security

**Denver Engineering — Ava Phase 8 (v8.0.0)**

## Multi-Tenant Isolation Model

All tenant data is isolated at multiple layers:

### 1. Row-Level Security (Primary)

Seven of the eleven Phase 8 tables have PostgreSQL RLS enabled with `tenant_isolation` policies:

```sql
CREATE POLICY tenant_isolation ON <table>
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
```

Tables with RLS: `tenant_usage`, `tenant_feature_flags`, `tenant_onboarding_tasks`, `support_tickets`, `ai_usage_records`, `compliance_exports`, `api_keys`

Tables without RLS (admin/global): `tenant_subscriptions`, `tenant_lifecycle_events`, `deployment_health_checks`, `demo_tenants`

### 2. Application-Layer Scoping

All tenant-facing service functions receive `tenantId` as the first parameter and pass it to `tenantQuery()`, which sets `app.current_tenant_id` on the DB connection. This ensures RLS policies evaluate correctly.

### 3. Admin Query Segregation

Admin functions that need cross-tenant visibility import `pool` directly and use `pool.query()` without tenant scoping:

```typescript
// Admin — cross-tenant visibility
const { default: pool } = await import('../../db/pool')
const res = await pool.query('SELECT * FROM tenant_subscriptions WHERE ...')

// Tenant-scoped — RLS enforced
const res = await tenantQuery(tenantId, 'SELECT * FROM api_keys WHERE tenant_id = $1', [tenantId])
```

## Secret Management

- **API key secrets**: Never stored. Only SHA-256 hash stored in `key_hash`
- **Session tokens**: Managed by JWT middleware (not Phase 8 scope)
- **Stripe keys**: Environment variable only; never written to DB

## Idempotency Keys

Both `tenant_usage` and `ai_usage_records` support idempotency keys:

```sql
CREATE UNIQUE INDEX ON tenant_usage (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
```

The `WHERE` clause ensures NULL idempotency keys don't conflict with each other. ON CONFLICT uses `DO UPDATE SET updated_at = now()` (a no-op for the data).

## Archival Security

When a tenant is archived:
1. All `api_keys` are revoked (status = 'revoked', timestamp recorded)
2. All `tenant_feature_flags` are disabled
3. Lifecycle event is recorded (immutable)
4. No data is deleted — archival is reversible at the data level

## Compliance Export Gate

Compliance exports require the `compliance_export` feature flag. This ensures only tenants on tiers that include this capability (enterprise+) can extract bulk data.

## Governance Invariants (Preserved from Phase 1–7)

All Phase 1–7 governance rules remain in force:
- Audit log is append-only
- All agent actions require human approval before execution
- No autonomous financial or destructive operations
- All AI reasoning is explainable and replayable
- Tenant data never crosses tenant boundaries at any layer
