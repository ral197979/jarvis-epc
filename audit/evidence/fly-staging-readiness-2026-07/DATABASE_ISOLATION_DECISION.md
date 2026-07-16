# Staging Database Isolation — Decision Record

**Status:** Decided (documentation only — no database or credential was provisioned in this task)
**Date:** 2026-07-16 · **Task:** `infra/fly-staging-readiness`

## Options considered

### Option A — Separate Neon project or database (RECOMMENDED)
A dedicated Neon **branch** (or, if cost allows, a fully separate Neon project) created from the production schema, with its own connection strings and its own `jarvis_app` role instance.
- Strongest isolation: separate data, separate connection limits, separate migration lifecycle, separate credentials.
- Neon natively supports point-in-time/branch-restore (already referenced in `docs/deploy/fly-neon-upstash.md:133`), making a schema-only staging branch cheap to create and reset.
- Cost: Neon's branching model is designed for exactly this use case (low marginal cost per branch on most plans); operational overhead is one extra set of two connection strings (`DATABASE_URL`, `DATABASE_URL_APP`) to manage per environment, consistent with the pattern the app already uses in production.
- **This is the recommended option.**

### Option B — Separate database in the same managed Postgres project
Acceptable only if database-level isolation is airtight (distinct `CREATE DATABASE`, distinct roles scoped via `GRANT ... ON DATABASE`, connection strings that differ in the database-name segment, not just a query parameter). Weaker than Option A because it shares the underlying Postgres instance's connection-limit pool and blast radius (a runaway staging query can still starve production's shared instance resources). Acceptable as a fallback if Neon branching is unavailable on the current plan.

### Option C — Separate schema in the production database
**Rejected as too risky to approve in this slice.** Would require proving the entire application query layer is schema-aware (search_path discipline), that migrations can't cross the boundary, and that RLS/tenant isolation can't leak across schemas — none of which is proven anywhere in this codebase today. The independent audit (`audit/INDEPENDENT_AUDIT_2026-07-02.md`) already found 76 of 91 direct `query()` call sites bypass the RLS-enforcing pool even for tenant isolation *within* a single schema; adding a second schema boundary on top of that unproven foundation is not something this task will approve.

### Option D — Reuse the production database
**Rejected.** Staging must not use production data or share write access with production for routine testing. Explicitly disallowed by this task's scope regardless of convenience.

## Recommendation
**Option A — a dedicated Neon branch for staging**, mirroring production's role model exactly:
- `jarvis` (or equivalent owner role) for migrations/admin — staging-specific credential, never shared with production.
- `jarvis_app` (NOBYPASSRLS, per migration `075_rls_app_role_grants.sql`) for the application runtime — staging-specific credential, never shared with production.

## Required infrastructure (not provisioned by this task)
- One Neon branch (or project) for staging, migrated to the current schema via the existing `api/db/migrate.ts` path (same mechanism production uses — no new migration tooling needed).
- Two new secret **names** on `denver-epc-staging` (values out of scope for this task): `DATABASE_URL`, `DATABASE_URL_APP`.

## Migration boundary
Migrations run automatically at process startup (`api/server.ts` → `initPool()` → `runMigrations()`), the same mechanism as production. Because staging points at its own Neon branch, running migrations against staging can never reach production's database — the boundary is enforced by the connection string, not by application logic.

## Seed-data policy
Not defined in this task. Recommended follow-up: seed staging via the application's real workflows/APIs (per this repo's own `CLAUDE.md` seed-data convention — no direct DB inserts except bootstrap/config rows), not by copying production data.

## Cleanup policy
Not defined in this task. Recommended follow-up: since Neon branches are cheap to reset, the simplest policy is periodic branch reset-from-parent rather than ad hoc row deletion.

## Backup expectations
Staging is disposable by design (reset from a Neon branch reset, not backed up independently). Production backup policy is unaffected and out of scope here.

## Cost implications
One additional Neon branch/project and one additional low-cost Fly machine (`shared-cpu-1x:1024MB`, matching production's smallest tier — see `fly.staging.toml`). Not quantified further; a billing decision for the account owner.

## Remaining approvals before staging can be deployed
1. Owner decision: Neon branch vs. separate project (both fit Option A; branch is cheaper and recommended as the default unless there's a reason to isolate further).
2. Provisioning the branch/project and running migrations against it once (out of scope for this task).
3. Supplying `DATABASE_URL` and `DATABASE_URL_APP` for the staging branch through a secure out-of-band channel (out of scope for this task — no credential rotation or creation was performed).
