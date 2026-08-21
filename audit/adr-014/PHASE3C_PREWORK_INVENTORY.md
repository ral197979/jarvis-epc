# ADR-014 — Phase-3C pre-work: machine-derived scope inventory

**Generated from checked-in source at `f5883c31c1205a113ec4909437449d0a84381d34`.**
Regenerate with `node scripts/adr014/run-all.mjs`; output is byte-deterministic.

> ## What this is, and what it is not
>
> This is the **input** to ADR-014 Phase 3C (HOB §5 first hard gate and §9), not
> Phase 3C itself. Phase 3C could not be executed at this commit: the certified
> base SHA `2273275…` is not in this repository's object database, and none of
> the Phase 1→3B authorization foundation it builds on exists here —
> no `api/authz/`, no capability gate, no `transitions.ts`, no
> `project_members` table (the migration chain ends at `084`).
>
> **No authorization code was written, and no endpoint is protected as a result
> of this work.** `RECORD_SCOPE_PROTECTED = 0`. These inventories were built so
> that when the ADR-014 lineage is published, Phase 3C starts with its two hard
> gates already satisfied and independently reproducible.

## 1. Corroboration of the Phase-2 census

The extractor independently derives **747 endpoints** — exactly the
`TOTAL API endpoints ... 747` recorded in the Phase-3B certified state. Two
independent parsers, two different commits, same total: strong evidence that the
route surface is unchanged between `f5883c3` and the certified SHA, and that these
inventories will join cleanly onto the existing census.

| Source | Value |
|---|---|
| Endpoints (mounted) | 745 |
| Endpoints (declared but never mounted) | 2 |
| Route files | 100 |
| `app.use` mounts parsed | 106 |
| Extraction anomalies | 0 |
| Tables parsed from migrations | 233 |
| Service functions indexed | 1610 |

## 2. HOB §5 — every endpoint has exactly one project-scope disposition

**`UNEXPLAINED = 0`** — the §5 hard gate is satisfied.

| Disposition | Endpoints | Of which mutations |
|---|---|---|
| `TENANT_GLOBAL` | 251 | 135 |
| `PROJECT_CHILD_RECORD_ID` | 183 | 125 |
| `NO_PROJECT_PARENT` | 95 | 39 |
| `PROJECT_CHILD_PATH_PROJECT` | 90 | 33 |
| `PLATFORM_GLOBAL` | 40 | 18 |
| `UNRESOLVED_DATA_ACCESS` | 34 | 15 |
| `SERVICE_BOUNDARY` | 30 | 16 |
| `SELF_SCOPED` | 16 | 9 |
| `PROJECT_ROOT_EXISTING` | 3 | 2 |
| `DEAD_OR_UNMOUNTED` | 2 | 1 |
| `CROSSDOMAIN` | 1 | 1 |
| `PROJECT_CREATE_NO_EXISTING_SCOPE` | 1 | 1 |
| `PUBLIC_UNAUTHENTICATED` | 1 | 0 |

Dispositions are assigned by an ordered rule list in
`scripts/adr014/classify-scope.mjs`; each registry entry records the rule that
fired in `dispositionReason`, so a verdict can be argued with.

`UNRESOLVED_DATA_ACCESS` (34) is deliberately **not**
folded into `NO_PROJECT_PARENT`: for these routes no table could be resolved, so
their project relationship is *unknown*, not *absent*. Per HOB §64 they are
deferred for a scope model, not closed.

## 3. The headline finding

**153 of the 160 project-bound mutations carry no project
predicate anywhere in their SQL.** They are constrained by `tenant_id` alone.

Combined with the guard census — 710
of 747 endpoints are authenticate-only, with no role or capability
gate — any authenticated member of a tenant can mutate project records in
projects they have no relationship to. This is the gap ADR-014 Phase 3C exists to
close, now measured rather than asserted.

| Operation | Project-bound | With a project predicate in SQL |
|---|---|---|
| `MUTATION_CREATE` | 67 | 7 |
| `READ_DIRECT_ID` | 60 | 0 |
| `READ_COLLECTION` | 56 | 0 |
| `MUTATION_UPDATE` | 44 | 0 |
| `MUTATION_CONSEQUENTIAL` | 27 | 0 |
| `MUTATION_DELETE` | 22 | 0 |

## 4. HOB §9 — direct-ID read inventory

60 project-bound direct-ID reads, of
129 direct-ID reads overall. The three surfaces HOB §8 names as
mandatory Phase-3C candidates are all present, and every method on those paths is
confirmed unscoped:

| Method | Path | Table | Project parent | Project predicate in SQL |
|---|---|---|---|---|
| DELETE | `/api/v1/drawings/:id` | `drawings` | DIRECT_COLUMN | **no** |
| GET | `/api/v1/drawings/:id` | `drawings` | DIRECT_COLUMN | **no** |
| PATCH | `/api/v1/drawings/:id` | `drawings` | DIRECT_COLUMN | **no** |
| GET | `/api/v1/inspections/:id` | `inspections` | DIRECT_COLUMN | **no** |
| PATCH | `/api/v1/inspections/:id` | `inspections` | DIRECT_COLUMN | **no** |
| GET | `/api/v1/punch-lists/:id/items` | `punch_items` | DIRECT_COLUMN | **no** |
| POST | `/api/v1/punch-lists/:id/items` | `actions` | DIRECT_COLUMN | **no** |

HOB §9 asks whether more identical bypasses exist beyond those three. They do:
**60** project-bound direct-ID reads in total, none of which scope by
project. The full list is in `scope-classification.json`; the first 20:

| Method | Path | Table | Guards |
|---|---|---|---|
| GET | `/api/v1/actions/:id` | `actions` | requireAuth + requireTenant |
| GET | `/api/v1/actions/:id/relationships` | `action_relations` | requireAuth + requireTenant |
| GET | `/api/v1/actions/:id/timeline` | `action_events` | requireAuth + requireTenant |
| GET | `/api/v1/agent-actions/:id` | `agent_actions` | requireAuth + requireTenant |
| GET | `/api/v1/ask/chunks/:id` | `knowledge_chunks` | requireAuth + requireTenant |
| GET | `/api/v1/ask/sessions/:id` | `chat_messages` | requireAuth + requireTenant |
| GET | `/api/v1/bid-packages/:id` | `bid_packages` | requireAuth + requireTenant |
| GET | `/api/v1/bid-packages/:id/submissions` | `bid_submissions` | requireAuth + requireTenant |
| GET | `/api/v1/bim-models/:id` | `bim_models` | requireAuth + requireTenant |
| GET | `/api/v1/bim-models/:id/viewer-token` | `bim_models` | requireAuth + requireTenant |
| GET | `/api/v1/budgets/:id/items` | `budget_items` | requireAuth + requireTenant |
| GET | `/api/v1/calc-sessions/:id` | `calc_sessions` | requireAuth + requireTenant |
| GET | `/api/v1/change-orders/:id` | `change_orders` | requireAuth + requireTenant |
| GET | `/api/v1/change-orders/:id/tasks` | `change_order_tasks` | requireAuth + requireTenant |
| GET | `/api/v1/commissioning/baselines/:id` | `commissioning_baselines` | requireAuth + requireTenant |
| GET | `/api/v1/commissioning/packs/:id` | `commissioning_packs` | requireAuth + requireTenant |
| GET | `/api/v1/commissioning/packs/:id/download/:format` | `commissioning_packs` | requireAuth + requireTenant |
| GET | `/api/v1/compliance-tasks/:id` | `compliance_tasks` | requireAuth + requireTenant |
| GET | `/api/v1/cost-entries/:id` | `cost_entries` | requireAuth + requireTenant |
| GET | `/api/v1/daily-logs/:id` | `daily_logs` | requireAuth + requireTenant |

## 5. HOB §7 / §20 — project-bound consequential transitions

27 project-bound consequential transitions were derived by matching
transition verbs against the final path segment. **25 of 27 carry no role
gate at all** — authenticate-only approval of commercially consequential objects.

| Method | Path | Table | Role gate |
|---|---|---|---|
| POST | `/api/v1/bid-packages/:id/cancel` | `bid_packages` | **none** |
| POST | `/api/v1/bid-packages/:id/close` | `bid_packages` | **none** |
| POST | `/api/v1/bid-packages/:id/issue` | `bid_packages` | **none** |
| POST | `/api/v1/change-orders/:id/approve` | `change_orders` | requireRole(owner|admin|project_manager) |
| POST | `/api/v1/change-orders/:id/reject` | `change_orders` | requireRole(owner|admin|project_manager) |
| POST | `/api/v1/change-orders/:id/submit` | `change_orders` | **none** |
| POST | `/api/v1/change-orders/:id/void` | `change_orders` | **none** |
| POST | `/api/v1/compliance-tasks/:id/complete` | `compliance_tasks` | **none** |
| POST | `/api/v1/compliance-tasks/:id/waive` | `compliance_tasks` | **none** |
| POST | `/api/v1/cost-entries/:id/post` | `cost_entries` | **none** |
| POST | `/api/v1/cost-entries/:id/void` | `cost_entries` | **none** |
| POST | `/api/v1/daily-logs/:id/approve` | `daily_logs` | **none** |
| POST | `/api/v1/daily-logs/:id/submit` | `daily_logs` | **none** |
| POST | `/api/v1/estimates/:id/approve` | `estimates` | **none** |
| POST | `/api/v1/inspections/:id/complete` | `inspections` | **none** |
| POST | `/api/v1/meetings/:id/archive` | `meetings` | **none** |
| POST | `/api/v1/meetings/:id/publish` | `meetings` | **none** |
| POST | `/api/v1/punch-items/:id/close` | `punch_items` | **none** |
| POST | `/api/v1/purchase-orders/:id/approve` | `purchase_orders` | **none** |
| POST | `/api/v1/risks/:id/close` | `risks` | **none** |
| POST | `/api/v1/sc-invoices/:id/approve` | `subcontract_invoices` | **none** |
| POST | `/api/v1/sc-invoices/:id/reject` | `subcontract_invoices` | **none** |
| POST | `/api/v1/sc-invoices/:id/submit` | `subcontract_invoices` | **none** |
| POST | `/api/v1/timesheets/:id/approve` | `cost_entries` | **none** |
| POST | `/api/v1/timesheets/:id/reject` | `timesheets` | **none** |
| POST | `/api/v1/timesheets/:id/submit` | `timesheets` | **none** |
| POST | `/api/v1/transmittals/:id/close` | `transmittals` | **none** |

Note: this repository has no `transitions.ts` registry, so this set is derived
from path verbs and is a *candidate* set. When the ADR-014 lineage lands it must
be joined against the real registry (HOB §7) rather than used in its place.

## 6. HOB §12 — table → project parent map

| Strategy | Tables | Meaning |
|---|---|---|
| `PROJECT_ROOT` | 1 | the `projects` table itself |
| `DIRECT_COLUMN` | 69 | has `project_id` — one lookup resolves the parent |
| `FK_PATH` | 23 | reaches a project by walking foreign keys (e.g. `drawing_markups` → `drawings` → `project_id`) |
| `NO_PROJECT_PARENT` | 140 | tenant-level configuration, registries, platform tables |

221 of 233 tables carry `tenant_id`. This map is the data
HOB §12 requires so parent resolution lives in one policy table instead of
ad-hoc `SELECT project_id FROM …` in every router.

## 7. HOB §16 / §17 — body project-id and mass assignment

0 route(s) read a project id from the request body.

_None found._

On record moves (HOB §17/§49): the update handlers examined use explicit
allow-lists that exclude the project parent — `api/routes/drawings.ts:96` lists
ten updatable columns and `project_id` is not among them. On current evidence
**project-parent mutation is not a supported workflow**, which is the cheaper of
the two §17 outcomes. This needs confirming against every generic writer before
it can be asserted as closed.

## 8. Trust boundaries left alone (HOB §33)

30 endpoints are service/IdP boundaries — SCIM (bearer service
token, `api/routes/scim.ts:111`), SAML (public IdP endpoints), and the
commissioning webhook (HMAC over the raw body). They authenticate by something
other than a user session and must not have project membership forced onto them.

16 endpoints are SELF-scoped and must keep SELF semantics (HOB §31).

2 endpoints are declared but never mounted from `api/server.ts`
(`api/routes/denverMcp.ts`) — reported rather than dropped.

## 9. Method and limits

Three extractors parse checked-in source only. Nothing imports the app, starts a
server, or contacts a database.

1. `extract-endpoint-inventory.mjs` — `app.use` mounts × router declarations,
   binding each mount to exactly one router variable (files such as
   `api/routes/procurement.ts` declare four), and resolving guards reached
   through local aliases and middleware factories.
2. `extract-schema-map.mjs` — `CREATE TABLE` / `ALTER TABLE … ADD COLUMN` /
   `ADD … FOREIGN KEY` across all 84 migrations, then FK-walks to a
   project parent.
3. `extract-route-data-access.mjs` — SQL in each handler, plus one level of
   service delegation (1610 indexed functions), recording the
   WHERE-clause scoping columns of every write.

**Stated limits.** Table resolution reaches 689 of
747 endpoints; the remaining 58 are marked `UNRESOLVED`
and, where no other rule fires, land in `UNRESOLVED_DATA_ACCESS` rather than
being assumed project-free. Service delegation is followed one level only.
`primaryTable` is a heuristic — the first written table reaching a project —
and `writeTables` carries the full set so it can be checked. The consequential
set is verb-derived, not registry-derived. Dynamic route paths would be reported
in `anomalies`; there are currently 0.
