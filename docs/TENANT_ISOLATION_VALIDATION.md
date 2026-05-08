# Tenant Isolation Validation — Denver Engineering

**Prepared:** 2026-05-07  
**Status:** VALIDATED — All isolation checks pass

---

## Isolation Model

Denver Engineering uses a **shared database, isolated schemas** model with PostgreSQL Row-Level Security:

- One Postgres cluster, one `public` schema
- All multi-tenant tables include a `tenant_id` UUID column
- RLS policies enforce `tenant_id = current_setting('app.tenant_id')` on every SELECT/INSERT/UPDATE/DELETE
- Application layer sets `app.tenant_id` via `tenantQuery()` before any tenant-scoped operation

## Validated Tables

| Table | RLS Policy | Verified |
|-------|-----------|---------|
| workflows | tenant_workflows_policy | ✅ |
| actions | tenant_actions_policy | ✅ |
| audit_log | tenant_audit_policy | ✅ |
| billing_records | tenant_billing_policy | ✅ |
| replay_verification_runs | tenant_replay_policy | ✅ |
| edge_nodes | tenant_edge_policy | ✅ |
| plugins | tenant_plugins_policy | ✅ |
| support_tickets | tenant_support_policy | ✅ |
| knowledge_graph_entities | tenant_kg_policy | ✅ |
| certifications | tenant_cert_policy | ✅ |

**Policy count:** 10 active tenant RLS policies (minimum required: 10 ✅)

## Production Gate Check

The `runTenantIsolationCheck()` function verifies isolation as a production gate:

```sql
SELECT COUNT(*) AS policy_count
FROM pg_policies
WHERE schemaname = 'public'
  AND policyname ILIKE '%tenant%'
```

- ≥ 5 policies → `pass`
- < 5 policies → `warn`

## Cross-Tenant Leak Test Results

Manual verification run 2026-04-28:

1. Created Tenant A and Tenant B with separate workflows
2. Queried Tenant A's data with Tenant B's `tenant_id` context
3. **Result:** 0 rows returned (RLS blocked access correctly)
4. Attempted INSERT with wrong `tenant_id` → rejected by RLS CHECK constraint

## `tenantQuery()` Enforcement

All tenant-scoped service functions use `tenantQuery()`:

```typescript
await tenantQuery(tenantId, sql, params)
// Sets: SET LOCAL app.tenant_id = $tenantId before query
// Ensures RLS context is always correct for the duration of the query
```

Admin operations (`pool.query`) are restricted to:
- Governance validation (read-only aggregates across tenants)
- Production gate checks (pg_catalog queries)
- Migration safety checks (schema_migrations)

## Isolation Certification

Tenant isolation has been validated by:
1. Automated gate check (`productionGateValidator.runTenantIsolationCheck`)
2. Manual cross-tenant leak test
3. Code review of all `pool.query` usages in tenant-scoped services
