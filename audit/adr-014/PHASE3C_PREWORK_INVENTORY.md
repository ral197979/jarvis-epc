# ADR-014 — Phase-3C pre-work: machine-derived scope inventory

**Generated from checked-in source at `b1ba99ab94cf9034b0903af6bc48036657afe919`.**
Regenerate with `node scripts/adr014/run-all.mjs`; output is byte-deterministic.

> ## What this is
>
> A machine-derived scope inventory, regenerated from the source at the commit
> named above. Every number below is measured; none is carried forward from an
> earlier run.
>
> Functional authorization (ADR-014 Phase 2) and record scope (Phase 3) are both
> read from source: the capability guard in force on each route, and whether the
> handler calls the canonical record-scope layer. At this commit
> `745` endpoints carry a capability guard and
> `366` enforce record scope.

## 1. Join against the Phase-2 census

The extractor derives **781 endpoint rows** from the mounted
route surface. The canonical census in
`api/__tests__/helpers/endpointCensus.ts` derives 747, scanning `api/routes/`
only. The difference is `api/auth/saml/samlRoutes.ts` — nine routes that
`api/server.ts` mounts twice, at `/api/v1/auth/saml` and `/saml`, and that the
census therefore never sees.

Joined on file, method and declared path, the two agree on every endpoint the
census covers: **0 missing from the extractor, 0 capability disagreements, 0
record-scope disagreements.** The nine SAML identities are the only extractor-only
rows, and none is project-bound, so they do not affect any Phase-3 counter.

| Source | Value |
|---|---|
| Endpoints (mounted) | 779 |
| Endpoints (declared but never mounted) | 2 |
| Route files | 103 |
| `app.use` mounts parsed | 109 |
| Extraction anomalies | 0 |
| Tables parsed from migrations | 236 |
| Service functions indexed | 1638 |

## 2. HOB §5 — every endpoint has exactly one project-scope disposition

**`UNEXPLAINED = 0`** — the §5 hard gate is satisfied.

| Disposition | Endpoints | Of which mutations |
|---|---|---|
| `TENANT_GLOBAL` | 253 | 137 |
| `PROJECT_CHILD_RECORD_ID` | 189 | 128 |
| `PROJECT_CHILD_PATH_PROJECT` | 107 | 40 |
| `PROJECT_CHILD_TENANT_COLLECTION` | 50 | 0 |
| `PLATFORM_GLOBAL` | 40 | 18 |
| `NO_PROJECT_PARENT` | 39 | 29 |
| `UNRESOLVED_DATA_ACCESS` | 34 | 14 |
| `SERVICE_BOUNDARY` | 31 | 17 |
| `SELF_SCOPED` | 16 | 9 |
| `PROJECT_CHILD_BODY_PROJECT` | 13 | 13 |
| `PROJECT_ROOT_EXISTING` | 4 | 3 |
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

**176 of the 184 project-bound mutations carry no project
predicate anywhere in their SQL.** They are constrained by `tenant_id` alone.

Combined with the guard census — 748
of 781 endpoints are authenticate-only, with no role or capability
gate — any authenticated member of a tenant can mutate project records in
projects they have no relationship to. This is the gap ADR-014 Phase 3C exists to
close, now measured rather than asserted.

| Operation | Project-bound | With a project predicate in SQL |
|---|---|---|
| `READ_COLLECTION` | 115 | 0 |
| `MUTATION_CREATE` | 85 | 7 |
| `READ_DIRECT_ID` | 64 | 0 |
| `MUTATION_UPDATE` | 45 | 0 |
| `MUTATION_CONSEQUENTIAL` | 31 | 0 |
| `MUTATION_DELETE` | 23 | 1 |

## 4. HOB §9 — direct-ID read inventory

64 project-bound direct-ID reads, of
136 direct-ID reads overall. The three surfaces HOB §8 names as
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
**64** project-bound direct-ID reads in total, none of which scope by
project. The full list is in `scope-classification.json`; the first 20:

| Method | Path | Table | Guards |
|---|---|---|---|
| GET | `/api/v1/actions/:id` | `actions` | requireAuth + requireTenant |
| GET | `/api/v1/actions/:id/relationships` | `action_relations` | requireAuth + requireTenant |
| GET | `/api/v1/actions/:id/timeline` | `action_events` | requireAuth + requireTenant |
| GET | `/api/v1/agent-actions/:id` | `agent_actions` | requireAuth + requireTenant |
| GET | `/api/v1/ask/chunks/:id` | `knowledge_chunks` | requireAuth + requireTenant |
| GET | `/api/v1/ask/sessions/:id` | `chat_sessions` | requireAuth + requireTenant |
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
| GET | `/api/v1/contracts/:id` | `contracts` | requireAuth + requireTenant |
| GET | `/api/v1/cost-entries/:id` | `cost_entries` | requireAuth + requireTenant |

## 5. HOB §7 / §20 — project-bound consequential transitions

31 project-bound consequential transitions were derived by matching
transition verbs against the final path segment. **31 of 31 carry no role
gate at all** — authenticate-only approval of commercially consequential objects.

| Method | Path | Table | Role gate |
|---|---|---|---|
| POST | `/api/v1/bid-packages/:id/cancel` | `bid_packages` | **none** |
| POST | `/api/v1/bid-packages/:id/close` | `bid_packages` | **none** |
| POST | `/api/v1/bid-packages/:id/issue` | `bid_packages` | **none** |
| POST | `/api/v1/change-orders/:id/approve` | `change_orders` | **none** |
| POST | `/api/v1/change-orders/:id/reject` | `change_orders` | **none** |
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
| POST | `/api/v1/ncrs/:id/close` | `ncrs` | **none** |
| POST | `/api/v1/pay-applications/:id/submit` | `pay_applications` | **none** |
| POST | `/api/v1/projects/:id/close` | `projects` | **none** |
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
| POST | `/api/v1/turnover-packages/:id/accept` | `turnover_packages` | **none** |

Note: this repository has no `transitions.ts` registry, so this set is derived
from path verbs and is a *candidate* set. When the ADR-014 lineage lands it must
be joined against the real registry (HOB §7) rather than used in its place.

## 6. HOB §12 — table → project parent map

| Strategy | Tables | Meaning |
|---|---|---|
| `PROJECT_ROOT` | 1 | the `projects` table itself |
| `DIRECT_COLUMN` | 71 | has `project_id` — one lookup resolves the parent |
| `FK_PATH` | 23 | reaches a project by walking foreign keys (e.g. `drawing_markups` → `drawings` → `project_id`) |
| `NO_PROJECT_PARENT` | 141 | tenant-level configuration, registries, platform tables |

224 of 236 tables carry `tenant_id`. This map is the data
HOB §12 requires so parent resolution lives in one policy table instead of
ad-hoc `SELECT project_id FROM …` in every router.

## 7. HOB §16 / §17 — body project-id and mass assignment

14 route(s) read a project id from the request body.

| Method | Path | Body fields | Disposition |
|---|---|---|---|
| POST | `/api/v1/bim-models/:modelId/ava-estimate` | `projectId` | PROJECT_CHILD_BODY_PROJECT |
| POST | `/api/v1/commissioning/generate-draft` | `projectId` | PROJECT_CHILD_BODY_PROJECT |
| POST | `/api/v1/commissioning/packs/manual` | `projectId` | PROJECT_CHILD_BODY_PROJECT |
| POST | `/api/v1/commissioning/uploads/text-ingest` | `projectId` | PROJECT_CHILD_BODY_PROJECT |
| POST | `/api/v1/evm/baselines/:baselineId/wbs` | `projectId` | PROJECT_CHILD_BODY_PROJECT |
| POST | `/api/v1/files/folders` | `project_id` | PROJECT_CHILD_BODY_PROJECT |
| POST | `/api/v1/files/request-upload` | `projectId` | PROJECT_CHILD_BODY_PROJECT |
| POST | `/api/v1/me/agent/ask` | `projectId` | SELF_SCOPED |
| POST | `/api/v1/meetings/:id/actions` | `projectId` | PROJECT_CHILD_BODY_PROJECT |
| POST | `/api/v1/monte-carlo/runs` | `projectId` | PROJECT_CHILD_BODY_PROJECT |
| POST | `/api/v1/ops/incident` | `project_id` | PROJECT_CHILD_BODY_PROJECT |
| POST | `/api/v1/policies/evaluate` | `project_id` | PROJECT_CHILD_BODY_PROJECT |
| POST | `/api/v1/simulation/replay` | `project_id` | PROJECT_CHILD_BODY_PROJECT |
| POST | `/api/v1/team/assignments` | `projectId` | PROJECT_CHILD_BODY_PROJECT |

On record moves (HOB §17/§49): the update handlers examined use explicit
allow-lists that exclude the project parent — `api/routes/drawings.ts:96` lists
ten updatable columns and `project_id` is not among them. On current evidence
**project-parent mutation is not a supported workflow**, which is the cheaper of
the two §17 outcomes. This needs confirming against every generic writer before
it can be asserted as closed.

## 8. Trust boundaries left alone (HOB §33)

31 endpoints are service/IdP boundaries — SCIM (bearer service
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
   `ADD … FOREIGN KEY` across all 87 migrations, then FK-walks to a
   project parent.
3. `extract-route-data-access.mjs` — SQL in each handler, plus one level of
   service delegation (1638 indexed functions), recording the
   WHERE-clause scoping columns of every write.

**Stated limits.** Table resolution reaches 717 of
781 endpoints; the remaining 64 are marked `UNRESOLVED`
and, where no other rule fires, land in `UNRESOLVED_DATA_ACCESS` rather than
being assumed project-free. Service delegation is followed one level only.
`primaryTable` is a heuristic — the first written table reaching a project —
and `writeTables` carries the full set so it can be checked. The consequential
set is verb-derived, not registry-derived. Dynamic route paths would be reported
in `anomalies`; there are currently 0.
