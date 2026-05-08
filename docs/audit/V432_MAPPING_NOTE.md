# v4.32 Backend Stabilization — Mapping Note
**Date:** 2026-04-22 · **Scope:** Close F01 and F05 (backend foundation only; no UI).

## Repo conventions observed (must adapt to)

| Starter pack assumption | Real repo pattern | Action |
|---|---|---|
| Prisma schema + migration | Raw SQL migrations in `api/db/migrations/NNN_*.sql`, applied by `api/db/migrate.ts` | Write SQL migration as `026_epc_core.sql` |
| `gen_random_uuid()` (pgcrypto) | `uuid_generate_v4()` (uuid-ossp, loaded in 001) | Use `uuid_generate_v4()` |
| `CREATE EXTENSION IF NOT EXISTS pgcrypto` | Loaded once in 001 | Skip — already loaded |
| `CREATE OR REPLACE FUNCTION set_updated_at()` | Defined once in 001 | Skip redefining — reuse |
| RLS policy: `tenant_id AND project_id` match | RLS policy: `tenant_id` only — `current_setting('app.current_tenant_id',true)::uuid` | Adapt: tenant-only RLS; project scope enforced in route/service layer |
| Zod validation schemas | Manual `if (!b.x) return res.status(400).json({error:'validation'})` | Inline manual validation (no new dep) |
| `req.user?.tenantId`, `req.user?.id` | `req.auth?.sub`, `req.tenantId` (set by `requireTenant()`) | Rewrite all controllers |
| Prisma client injection | `tenantQuery(tenantId, sql, params)` + `tenantTransaction(tenantId, fn)` from `api/db/pool` | Use helpers directly |
| Separate controller + service layers | Route files contain handlers inline; services live in `api/services/*.ts` for non-trivial domain logic | Route file stays thin; service file for DB CRUD |
| Router structure: `/systems/projects/:projectId` | Project-scoped endpoints use `/projects/:projectId/...` path (see `api/routes/drawings.ts`) | Restructure URL pattern to `/projects/:projectId/systems` etc. |
| No middleware setup shown | `router.use(requireAuth as any); router.use(requireTenant() as any)` at top of each router | Apply same pattern |
| `TEXT` columns | `VARCHAR(n)` for codes/names/titles; `TEXT` for descriptions/notes | Use `VARCHAR` with sensible lengths |
| `id UUID PRIMARY KEY DEFAULT gen_random_uuid()` | `id UUID PRIMARY KEY DEFAULT uuid_generate_v4()` | Switch default |

## Starter entity → repo mapping

| Starter entity | Real repo equivalent | Overlap assessment | Decision |
|---|---|---|---|
| `systems` | — none — | No systems/plant-area table exists. | **NEW** table |
| `subsystems` | — none — | Not modeled. | **NEW** table |
| `tags` | — none at table level — | `wirs.system_tag VARCHAR` and `commissioning_packs.system_type VARCHAR` are the only "tag"-like data, both free-text per row. | **NEW** table (real tag/equipment register, F05 fix) |
| `commissioning_items` | — partial: `CxPackStep` lives inside `commissioning_packs.payload_json` as unstructured JSONB array — | JSONB can't be queried for coverage. | **NEW** table |
| `test_packs` | **Overlaps `commissioning_packs`** but distinct purpose. `commissioning_packs` = generated-deliverable (draft → ready_for_review → finalized with MD/HTML/PDF paths); `test_packs` (starter) = formal EPC pack entity with pack_no, real scope (system/subsystem/tag), revision, pack_type. | Different concerns; should coexist. | **NEW** table. Future bridge: add nullable `test_pack_id` FK on `commissioning_packs` to link generated deliverable back to its source pack. **Not done in this pass** — flagged as follow-up. |
| `test_results` | **Overlaps `wirs` (Work Inspection Records) and `inspections`** — but both are record-level with nested JSONB (`wirs.test_data`, `inspections.results`). `test_results` is step-level with one row per step including `step_no`, `expected/actual`, `evidence_uri`, `pass/fail/na`. | Complementary, not a replacement. | **NEW** table. `wirs`/`inspections` stay untouched. |
| `deficiencies` | **Overlaps `punch_items`** but status lifecycle differs: `punch_items` is field-punch (open/in_progress/resolved with pin_x/y + drawing linkage); `deficiencies` is test-traced deficiency (open/in_review/closed/waived with test_pack_id + test_result_id + severity). | Different workflows. | **NEW** table. Bridge via optional linkage later; no merge in this pass. |

**No tables removed, no columns altered on existing tables.** F01/F05 blockers are closed by *adding* the real EPC hierarchy, not by rewriting the generated-pack workflow. A later pass can add FK bridges between `commissioning_packs` ↔ `test_packs` and `punch_items` ↔ `deficiencies`.

## Conflicts found

1. **URL path structure**: Starter uses `/systems/projects/:projectId`. Repo convention (from `drawings.ts`) is `/projects/:projectId/systems`. **Adapted to repo convention**.
2. **RLS scope**: Starter forces both `app.current_tenant_id` AND `app.current_project_id` — but `app.current_project_id` is not set anywhere in the current codebase; enabling that policy would make every query return 0 rows. **Adapted to tenant-only RLS**; project scoping enforced in `WHERE` clauses at query time.
3. **req.user vs req.auth**: Starter expects `req.user.tenantId/id`. Real repo uses `req.auth.sub` (from JWT) + `req.tenantId` (from tenant middleware). **Rewritten**.
4. **Validation library**: Starter imports Zod. Repo has no Zod dependency. **Used manual validation** (no new deps in a foundation pass).
5. **pgcrypto vs uuid-ossp**: Both extensions are loaded from 001; no conflict — just pick the one the repo uses (`uuid_generate_v4()`).

## Auditability preservation

All 7 tables include `created_at`, `updated_at`, `created_by`, `updated_by` (nullable FK to `users`). `updated_at` maintained by existing `set_updated_at()` trigger (defined in migration 001). `updated_by` is route-responsibility — set on each UPDATE.

## Hard rule enforcement (F05)

`test_packs.tenant_id`, `test_packs.project_id`, `test_packs.system_id` are all `NOT NULL`. Service-layer `createPack()` additionally verifies:
1. The referenced `system_id` exists in the same `tenant_id` + `project_id`.
2. If `subsystem_id` is provided, it belongs to the given `system_id`.
3. If `tag_id` is provided, it belongs to the given `system_id` (and `subsystem_id` if provided).

No synthetic-asset fallback exists in the new pack creation path. The existing `api/services/templateEngine.ts:_syntheticAsset()` is NOT called from the new `test_packs` route — it remains only for the legacy `commissioning_packs` generation path, which will be addressed in a later pass.
