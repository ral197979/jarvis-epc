# 04 — Database, RLS & Multi-Tenancy Audit

## Database Architecture
- **PostgreSQL 16** (Render basic-256mb in production)
- **69 migrations** (sequential SQL files, gap at 020)
- **`tenantQuery` wrapper** — sets `app.current_tenant_id` session variable before every query, enabling RLS filtering
- **`tenantTransaction` wrapper** — same, within a transaction
- **Migration runner** — `api/db/migrate.ts` applies files in sorted order

---

## Tenant Isolation Architecture

### Application Layer
```typescript
// api/db/pool.ts — tenantQuery pattern
export async function tenantQuery<T>(
  tenantId: string,
  sql: string,
  params: unknown[] = []
): Promise<QueryResult<T>> {
  const client = await pool.connect()
  await client.query("SET app.current_tenant_id = $1", [tenantId])
  const result = await client.query<T>(sql, params)
  client.release()
  return result
}
```

This sets the PostgreSQL session variable `app.current_tenant_id` before each query, which RLS policies read via `current_setting('app.current_tenant_id', true)::uuid`.

**Strength:** Consistent pattern. All protected routes use `tenantQuery` after `requireTenant` middleware validates the tenant.

**Risk:** If any route uses the raw `query()` pool function instead of `tenantQuery`, RLS is bypassed. Previous audit (v10.6.0) fixed some `pool.query` bypasses; residual bypasses may remain.

---

## RLS Coverage Matrix

### Tables with RLS Enabled (confirmed from migrations)

| Migration | Tables |
|---|---|
| 002_epc_core | projects, vendors, contracts, purchase_orders, rfis, submittals, wirs |
| 007_pm_modules | daily_logs, drawings, drawing_revisions, drawing_markups, bim_models, bim_issues, budgets, budget_items, change_orders |
| 013_field_sync | field_sync_operations |
| 017_agent_actions | agent_actions |
| 040_runbook_engine | operational_runbooks, runbook_versions, runbook_executions, runbook_steps, runbook_step_results |
| 041_ai_governance | ai_recommendation_queue, ai_approval_events |
| 050_bim_estimating | bim_elements, bim_element_links, ifc_parse_jobs, cost_items, takeoff_items, estimates, estimate_lines |
| 053_evm | evm_baselines, evm_wbs_entries, evm_actuals, evm_progress, evm_snapshots |
| 056_rls_backfill | tenant_subscriptions, tenant_lifecycle_events, external_agent_executions |
| 067_risks_schema_fix | risks |

### Tables WITHOUT Confirmed RLS (need verification)

The following tables from later migrations were not confirmed to have RLS policies in the migration files reviewed:

| Migration | Table | Risk |
|---|---|---|
| 058_change_orders | change_orders (reimplemented) | P1 |
| 059_subcontracts | subcontracts, bid_packages | P1 |
| 060_meetings | meeting_minutes, meeting_agenda_items | P1 |
| 061_cost_entries | cost_entries | P1 |
| 062_proposals | proposals, proposal_line_items | P1 |
| 063_team | team_members | P1 |
| 064_notifications | notifications, notification_preferences | P1 |
| 065_timesheets | timesheets, timesheet_entries | P1 |
| 066_risk_register | risk_register (pre-fix) | see 067 |
| 068_add_missing_fk_constraints | various | P2 |
| 069_rls_transmittal_counters | transmittal_counters | check |

**Critical gap:** Subcontracts, meetings, timesheets, cost entries, proposals, notifications, and team tables may lack RLS. Financial data across these tables could leak between tenants if the application layer `tenantQuery` is bypassed (or if direct DB access occurs).

---

## RLS Policy Pattern

Where present, policies follow the standard pattern:
```sql
CREATE POLICY table_tenant ON table_name
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
```

This is correct. The `true` argument to `current_setting` means it returns NULL instead of throwing if the variable isn't set, preventing accidental access when tenant context is missing.

**Issue:** If `app.current_tenant_id` is not set (e.g., raw `query()` called), the policy evaluates to `tenant_id = NULL`, which returns FALSE — effectively blocking all rows. This is safe by default (fail-closed). ✅

---

## Pool Configuration

```
DB_POOL_MIN: configured via env
DB_POOL_MAX: configured via env
DB_SSL: configured via env
```

**Finding:** Pool uses SSL flag from env. In production (Render), `DATABASE_URL` from `fromDatabase` property includes SSL by default. However, `DB_SSL` env var must be set explicitly in other deployments.

---

## Migration Runner

`api/db/migrate.ts` — applies migrations in alphabetical order. Uses a `schema_migrations` table to track applied migrations.

**Gap at 020:** Migration filenames jump from `019_commissioning_baselines.sql` to `021_knowledge_fixes.sql`. If `020` was deleted after being applied to a production DB, the runner is consistent. If `020` was never applied to production, dependent tables may be missing. **Must verify against production schema_migrations table.**

---

## pgvector / Embeddings

Migration `025_vector_embeddings.sql` exists. Review needed to confirm whether `pgvector` extension is installed (`CREATE EXTENSION IF NOT EXISTS vector`) or whether embeddings use TEXT storage with manual cosine similarity.

**Package.json:** No `pgvector` npm package. `api/services/embed.ts` likely uses `pgvector` SQL extension directly.

**Risk P2:** If pgvector extension isn't enabled on the Render PostgreSQL instance, migration 025 fails silently or errors out.

---

## Tenant Registration Flow

```
POST /api/v1/tenants (public — no auth)
  → creates tenant + owner user
  → no email verification required
  → returns JWT immediately
```

**Finding:** Tenant registration is open (no invite code, no admin approval). Anyone can create a tenant. This is acceptable for SaaS self-serve but creates risk of abuse. Rate limiting on this endpoint should be confirmed (currently uses `authLimiter` — 20 req/min). **P2.**

---

## Risk Summary

| Finding | Severity |
|---|---|
| Subcontracts, timesheets, meetings, cost_entries lack confirmed RLS | P1 |
| Migration gap at 020 — unknown state | P1 |
| pgvector extension availability unconfirmed | P2 |
| Render basic-256mb DB — insufficient for production | P0 |
| Open tenant registration (no invite gate) | P2 |
| Raw `query()` bypasses RLS if used in protected routes | P1 |
