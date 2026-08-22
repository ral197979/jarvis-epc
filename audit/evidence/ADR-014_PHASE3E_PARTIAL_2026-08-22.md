# BUILDER COMPLETION REPORT — jarvis-epc — ADR-014 PHASE 3E

## A. Verdict

```text
ADR-014 PHASE 3E: PARTIAL

DERIVABLE DIRECT-ID READS ................. CLOSED
DEFERRED_PHASE3_SCOPE_MODEL ............... 2
DIRECT_ID_READ_UNEXPLAINED ................ 0
RECORD_SCOPE_UNEXPLAINED .................. 0
PROMOTION ................................. NOT AUTHORIZED
```

Sub-verdicts:

```text
PROJECT-BOUND DIRECT-ID READ INVENTORY ........ CLOSED (54/54 dispositioned)
PROJECT-BOUND DIRECT-ID READS RECORD-SCOPED ... 44/44 derivable
DIRECT-ID SAME-TENANT CROSS-PROJECT ISOLATION . PROVED
DIRECT-ID CROSS-TENANT ISOLATION .............. PROVED
LIVE MEMBERSHIP REVOCATION — READS ............ PROVED
FUNCTIONAL CAPABILITY + RECORD SCOPE .......... PROVED
PAYLOAD-BEFORE-SCOPE EXPOSURE ................. CLOSED
FK-PATH RECORD-SCOPE RESOLUTION ............... PROVED
MIXED-PAYLOAD EXISTING CONTROLS ............... PRESERVED
READ SIDE EFFECT AUDIT ........................ CLOSED (2 findings, both derived-cache)
SELF-SCOPED AUTHORIZATION ..................... PRESERVED
CAPABILITY HOLDER DELTA ....................... 0
PENDING_PHASE2 ................................ 0
UNCLASSIFIED .................................. 0
INVENTORY DETERMINISM ......................... PROVED (3/3, entry and exit)
```

Separately:

```text
FULL-REPO DETERMINISM:
NOT IN SCOPE FOR PHASE 3E — SEPARATE QUALIFICATION GATE
```

The slice is PARTIAL, not COMPLETE, for one reason: two of the 54 candidate
reads are keyed on `operational_twins`, a table with no foreign key to
`projects`, so no guard can be written for them without a policy decision that
is not mine to make. Everything else in the candidate set is either closed or
classified with source evidence.

## B. Repository provenance

```text
repository root ...... /Users/rommelaguillon/Local Documents/Claude/Production/Denver Engineering
remote ............... https://github.com/ral197979/jarvis-epc.git
owner/repo ........... ral197979/jarvis-epc

certified parent ..... dedf6e0efb469e8b2355d1ccd58dde98aaebb93d
  git cat-file -t .... commit
  remote contains .... origin/security/adr-014-phase3d-mutation-scope

branch ............... security/adr-014-phase3e-direct-id-reads
product commit ....... a8d6a4fe7019a2435ae620aa5887eb4568f2a0ae
evidence commit ...... this commit (a commit cannot carry its own hash;
                       resolve with `git rev-parse HEAD` on the branch below)
final SHA ............ = the evidence commit = branch tip of
                       security/adr-014-phase3e-direct-id-reads
origin/main .......... f5883c31c1205a113ec4909437449d0a84381d34

tracked tree ......... clean at final SHA
stashes .............. 2, both preserved, neither touched
  stash@{0} On main: wip: untracked files that exist on origin
  stash@{1} WIP on main: d3b97d4 fix(jarvis-epc): import backendUrl ...
worktrees ............ 1 (the primary checkout)
unrelated evidence ... 27 pre-existing untracked audit/evidence/*.md preserved
```

The remote parent hard gate (§1) passed before any branch was created: the
certified SHA resolves to a commit and is contained by
`origin/security/adr-014-phase3d-mutation-scope`.

## C. Entry direct-ID inventory

Regenerated from source at the certified parent. Every Phase-3D exit number
reproduced exactly:

```text
canonical endpoint total .......... 747
extractor rows .................... 765
extractor-only SAML identities ...... 9  (18 mounted rows)
project-bound endpoints ........... 302

DIRECT-ID READS
  candidates ....................... 63
  protected .......................... 9
  deferred .......................... 54

COLLECTIONS
  protected .......................... 7
  deferred .......................... 51

RECORD_SCOPE_UNEXPLAINED ............ 0
UNRESOLVED_DATA_ACCESS ............. 33
```

The 54-route deferred set reproduced with 0 duplicates and 0 unexplained, so
the §3 entry gate is satisfied and no delta needs reporting.

## D. Inventory methodology

Identity key, as the extractor emits it: `file`, `router`, HTTP `method`,
declared `path`, `effective` (mounted) path. The candidate set is
`registry.filter(projectBound && operationType === 'READ_DIRECT_ID' &&
!enforcesRecordScope)` over `audit/adr-014/scope-classification.json`, which is
itself joined from `endpoint-inventory.json` (mounts × router declarations ×
guards), `route-data-access.json` (handler SQL plus one level of service
delegation) and `schema-project-parent-map.json` (CREATE TABLE / ALTER TABLE /
FOREIGN KEY across all migrations).

Regenerate with `node scripts/adr014/run-all.mjs`. No extractor logic was
changed in this slice.

## E. Direct-ID classification ledger

All 54 carry exactly one disposition, recorded in `DIRECT_ID_ADOPTION` in
`api/authz/recordScopePolicies.ts` and asserted by the Phase-3E ratchet.

```text
PROTECT_PHASE3E ............. 44
SELF_SCOPED .................. 4
NON_PROJECT_RESOURCE ......... 4
DEFERRED_PHASE3_SCOPE_MODEL .. 2
                              ──
                              54
DIRECT_ID_READ_UNEXPLAINED ... 0
```

### PROTECT_PHASE3E — 44 routes

| Endpoint | Router | Record table | Scope |
|---|---|---|---|
| `GET /agent-actions/:id` | router | agent_actions | `requireRecordScope('agent_actions')` |
| `GET /ask/chunks/:id` | router | knowledge_chunks | `requireRecordScope('knowledge_chunks')` |
| `GET /bid-packages/:id` | subcontractsRouter | bid_packages | `requireRecordScope('bid_packages')` |
| `GET /bid-packages/:id/submissions` | subcontractsRouter | bid_packages | `requireRecordScope('bid_packages')` |
| `GET /bim-models/:id` | router | bim_models | `requireRecordScope('bim_models')` |
| `GET /bim-models/:id/viewer-token` | router | bim_models | `requireRecordScope('bim_models')` |
| `GET /budgets/:id/items` | router | budgets | `requireRecordScope('budgets')` |
| `GET /calc-sessions/:id` | router | calc_sessions | `requireRecordScope('calc_sessions')` |
| `GET /change-orders/:id` | changeOrdersRouter | change_orders | `requireRecordScope('changeorder')` |
| `GET /change-orders/:id/tasks` | changeOrdersRouter | change_orders | `requireRecordScope('changeorder')` |
| `GET /commissioning/baselines/:id` | router | commissioning_baselines | `requireRecordScope('commissioning_baselines')` |
| `GET /commissioning/packs/:id` | router | commissioning_packs | `requireRecordScope('commissioning_packs')` |
| `GET /commissioning/packs/:id/download/:format` | router | commissioning_packs | `requireRecordScope('commissioning_packs')` |
| `GET /compliance-tasks/:id` | router | compliance_tasks | `requireRecordScope('compliance_tasks')` |
| `GET /cost-entries/:id` | costEntryRouter | cost_entries | `requireRecordScope('cost_entries')` |
| `GET /daily-logs/:id` | router | daily_logs | `requireRecordScope('daily_logs')` |
| `GET /estimates/:id` | router | estimates | `requireRecordScope('estimates')` |
| `GET /evm/baselines/:baselineId/wbs` | evmRouter | evm_baselines | `requireRecordScope('evm_baselines','baselineId')` |
| `GET /files/documents/:id` | router | documents | `requireRecordScope('documents')` |
| `GET /files/presign/:versionId` | router | document_versions | `requireRecordScope('document_versions','versionId')` |
| `GET /knowledge-fixes/:id` | router | knowledge_fixes | `requireRecordScope('knowledge_fixes')` |
| `GET /knowledge/sources/:id` | router | knowledge_sources | `requireRecordScope('knowledge_sources')` |
| `GET /knowledge/sources/:id/chunks` | router | knowledge_sources | `requireRecordScope('knowledge_sources')` |
| `GET /meetings/:id` | meetingsRouter | meetings | `requireRecordScope('meetings')` |
| `GET /meetings/:id/actions` | meetingsRouter | meetings | `requireRecordScope('meetings')` |
| `GET /meetings/:id/agenda` | meetingsRouter | meetings | `requireRecordScope('meetings')` |
| `GET /monte-carlo/runs/:id` | router | monte_carlo_runs | `requireRecordScope('monte_carlo_runs')` |
| `GET /ncrs/:id/capas` | router | ncrs | `requireRecordScope('ncr')` |
| `GET /pay-applications/:id` | router | pay_applications | `requireRecordScope('pay_applications')` |
| `GET /predict/projects/:id` | predictRouter | projects | `requireProjectScope('id')` |
| `GET /projects/:id/summary` | router | projects | `requireProjectScope('id')` |
| `GET /purchase-orders/:id` | purchaseOrdersRouter | purchase_orders | `requireRecordScope('purchase_orders')` |
| `GET /readiness/project/:id` | readinessRouter | projects | `requireProjectScope('id')` |
| `GET /readiness/subsystem/:id` | readinessRouter | subsystems | `requireRecordScope('subsystems')` |
| `GET /readiness/system/:id` | readinessRouter | systems | `requireRecordScope('systems')` |
| `GET /rfis/:id/copilot` | router | rfis | `requireRecordScope('rfi')` |
| `GET /risks/:id` | riskRegisterRouter | risks | `requireRecordScope('risks')` |
| `GET /sensors/:id` | authRouter | sensors | `requireRecordScope('sensors')` |
| `GET /sensors/:id/readings` | authRouter | sensors | `requireRecordScope('sensors')` |
| `GET /subcontracts/:id` | subcontractsRouter | subcontracts | `requireRecordScope('subcontracts')` |
| `GET /subcontracts/:id/invoices` | subcontractsRouter | subcontracts | `requireRecordScope('subcontracts')` |
| `GET /submittals/:id/review` | router | submittals | `requireRecordScope('submittal')` |
| `GET /test-packs/:packId` | testPacksRouter | test_packs | `requireRecordScope('test_packs','packId')` |
| `GET /transmittals/:id` | router | transmittals | `requireRecordScope('transmittals')` |

### SELF_SCOPED — 4 routes (§29, deliberately NOT converted)

| Endpoint | Ownership rule | Why project scope would be wrong |
|---|---|---|
| `GET /actions/:id` | `requireActionAccess` — `assigned_to_user_id = live principal`, or `personal.admin` | Project membership would let any member of the action's project read a peer's queue |
| `GET /actions/:id/relationships` | same, on the parent action | Extractor named `action_relations`; the id addresses the action |
| `GET /actions/:id/timeline` | same, on the parent action | Extractor named `action_events`; the id addresses the action |
| `GET /ask/sessions/:id` | `WHERE id=$1 AND user_id=$2` | Extractor named `chat_messages`; the session query is already owner-bound |

SELF is strictly narrower than project membership. Converting these would have
widened four closed surfaces while appearing, in the counters, to be progress.

### NON_PROJECT_RESOURCE — 4 routes (§15/§30 classification corrections)

| Endpoint | Extractor `primaryTable` | Actual record table | Evidence |
|---|---|---|---|
| `GET /vendors/:id` | vendors | vendors | `NO_PROJECT_PARENT`; tenant vendor register. Phase 3D made the same correction for vendor mutations |
| `GET /team/members/:id` | project_assignments | **team_members** | `getMember` reads `FROM team_members m WHERE m.id = $2`; `project_assignments` is only LEFT JOINed to count allocations. `team_members` is the HR roster `recordScope.ts` already rejected as an authorization source |
| `GET /team/members/:id/assignments` | project_assignments | **team_members** | `:id` is a member id; the assignments are a project-bound COLLECTION |
| `GET /team/members/:memberId/timesheets` | timesheets | **team_members** | `:memberId` is a member id; the timesheets are a project-bound COLLECTION |

The last two are honest partial coverage: the record the caller names has no
project parent, so `requireRecordScope` is structurally inapplicable, but the
rows they return are project-bound. Filtering those is collection scope, which
§31 puts in the next slice. This is stated as a residual risk in AF rather than
counted as closed.

### DEFERRED_PHASE3_SCOPE_MODEL — 2 routes (§61)

| Endpoint | Resource / table | Read capability | Tenant boundary | Why the parent cannot be derived | Next requirement |
|---|---|---|---|---|---|
| `GET /portfolio/readiness/:scopeType/:scopeId` | `operational_twins` | `portfolio.view` | `tenantQuery` on every statement | `_forecastReadiness` looks up `operational_twins(entity_type, entity_id)` where **`scopeType` is chosen by the caller**. `entity_id` is `text` with no FK, spanning 14 `twin_entity_type` values — `project, system, subsystem, equipment, tag, workflow, action, inspection, deficiency, permit, vendor, workforce, site, region` — several of which have no project at all | A per-entity-type project-parent policy, plus a decision on what a `vendor`/`region`/`site` twin inherits |
| `GET /scenarios/projection/:twinId` | `operational_twins` | `crossdomain.read` | `tenantQuery` on every statement | `projectTwinTimeline` keys on `operational_twins.id`; migration 046 gives that table no foreign key to `projects` | Same policy; both must be closed together |

Neither defaults open: both remain tenant-bounded and capability-gated exactly
as before, and both are pinned by name in the membership ratchet so a third
model deferral cannot appear silently.

## F. `UNRESOLVED_DATA_ACCESS`

```text
UNRESOLVED_DATA_ACCESS total ................... 33  (unchanged)
intersection with the 54 candidate reads ........ 0
resolved by this slice .......................... 0  (none needed resolving)
deferred ....................................... 33
```

No project-bound direct-ID read carries the `UNRESOLVED_DATA_ACCESS`
disposition, so §10 required no resolution work. Five *non*-project-bound
direct-ID reads are unresolved; inspected anyway for honesty:

| Endpoint | Finding |
|---|---|
| `GET /actions/:id/dependencies` | Personal Inbox family; `requireActionAccess` decides the record. SELF, consistent with the four above |
| `GET /files/download/:token` | Keyed on a single-use, 1-hour bearer token. Its **only** issuer is `GET /files/presign/:versionId`, which this slice record-scoped — so the download path is now gated at issuance. Residual noted in AF |
| `GET /scenarios/temporal/:twinId/diff` | Same `operational_twins` model gap as the two deferrals; must be closed with them |
| `GET /adaptive/calibrate/drift/:type` | Platform/telemetry surface, no project relationship |
| `GET /ecosystem/external-agents/:id/capabilities` | Ecosystem registry, no project relationship |

## G. Resource-policy extensions

Two policies added to `RECORD_SCOPE_POLICIES`; the other 42 routes reuse
policies Phase 3C/3D already certified.

| Resource | Table | Capabilities | Derivation | Evidence |
|---|---|---|---|---|
| `knowledge_chunks` | knowledge_chunks | `assistant.use` | `FK_PATH` via `source_id` → `knowledge_sources.id` → `project_id` | migration 022; matches `schema-project-parent-map.json` |
| `monte_carlo_runs` | monte_carlo_runs | `cost.view` | `DIRECT_COLUMN` `project_id` | matches `schema-project-parent-map.json` |

Capabilities are the ones the binding routes already declare. **No capability
was invented, moved, or granted** — see W.

Derivation shapes exercised across the 44: `DIRECT_COLUMN` (majority),
`FK_PATH` (`knowledge_chunks`, `document_versions`), `PROJECT_ROOT` (three
routes where the path id *is* the project, guarded with `requireProjectScope`).

**The §15 trap, and how it was avoided.** For twelve routes the extractor's
`primaryTable` is the *child* table but the path id addresses the *parent*:

```text
/ncrs/:id/capas                 corrective_actions  → scope ncrs
/budgets/:id/items              budget_items        → scope budgets
/subcontracts/:id/invoices      subcontract_invoices→ scope subcontracts
/bid-packages/:id/submissions   bid_submissions     → scope bid_packages
/change-orders/:id/tasks        change_order_tasks  → scope change_orders
/evm/baselines/:baselineId/wbs  evm_wbs_entries     → scope evm_baselines
/knowledge/sources/:id/chunks   knowledge_chunks    → scope knowledge_sources
/meetings/:id/agenda            meeting_agenda_items→ scope meetings
/meetings/:id/actions           action_items        → scope meetings
/sensors/:id/readings           sensor_readings     → scope sensors
/rfis/:id/copilot               action_relations    → scope rfis
/readiness/subsystem/:id        action_relations    → scope subsystems
```

Scoping the child would have resolved the parent of a record the caller never
named and refused **everyone**, including legitimate members — a silent
availability failure that still looks like a security win in the counters. Each
`recordTable` was read off the handler's own `FROM`/`WHERE` and is asserted by
name in the ratchet.

The last two are pure extractor artefacts: `buildRfiCopilot` opens with
`SELECT … FROM rfis WHERE tenant_id=$1 AND id=$2` and reaches
`action_relations` only in a blocking-count subquery; `/readiness/subsystem/:id`
passes its id to `computeReadiness` as a subsystem and reaches
`action_relations` one service level down.

## H. Authorization order

```text
authenticate (requireAuth)
  → live principal (resolveCurrentUser: users row, is_active, tenant claim agreement)
  → tenant (requireTenant + tenantQuery on every statement)
  → functional read capability (requireCapability / requireAllCapabilities)  → 403
  → resolve parent project (resolveParentProjectId, from the policy registry) → 404
  → verify project scope (canAccessProject, live project_members)             → 404
  → handler loads payload
```

Both scope guards are Express **middleware**, so a refusal happens before the
handler runs — before any payload query, and before any side effect. Measured,
not asserted: for an out-of-scope caller the payload-query count is **0** on
every one of the seven representative routes (see N).

## I. Same-tenant cross-project isolation

Fixture: Tenant A with `USER_A` → `PROJECT_A`, `USER_B` → `PROJECT_B`,
`FIELD_A` → `PROJECT_A`; Tenant B with `PROJECT_C`.

| Case | Result |
|---|---|
| Member reads own project's record — 7 routes, all derivation shapes | 200 |
| Same-capability non-member reads it — 7 routes | 404 |
| `USER_A` → daily log in `PROJECT_A` | 200 |
| `USER_A` → daily log in `PROJECT_B` | 404 |
| `USER_A` → chunk whose source is in `PROJECT_A` | 200 |
| `USER_A` → chunk whose source is in `PROJECT_B` | 404 (FK hop resolves the *right* project, not merely some project) |

Domains exercised: construction, risk, cost, commissioning, quality, assistant,
project.

## J. Cross-tenant isolation

| Case | Result |
|---|---|
| Tenant-A member → Tenant-B record | 404 |
| **Owner of Tenant B** → Tenant-A record | 404 |
| Owner of Tenant A → Tenant-A record, no `project_members` row | 200 |

Owner is tenant-wide, never global, and reaches its own tenant without a
membership row — the §20 policy, unchanged.

## K. Live membership revocation

| Step | Result |
|---|---|
| `USER_A` reads `/risks/:id`, active member | 200 |
| Membership closed in the fixture, **same token, no refresh** | 404 |
| Membership reopened, same token | 200 |
| Principal deactivated (`is_active=false`), same token | 401 |

The fixture reads the active-membership window (`active_from <= NOW()`,
`active_to IS NULL OR > NOW()`) **off the statement the product issued**, so
removing that predicate makes closed memberships reachable again — which is
what mutant C proves.

## L. Functional-vs-record proof

| Case | Expected dimension | Result |
|---|---|---|
| `risk.view` holder, no membership | record | **404** |
| Active member, no `risk.view` (`field_ops`) | functional | **403** |
| Active member, no `commissioning.view` (`field_ops`) | functional | **403** |
| Active member with `construction.view` (`field_ops`) | both hold | **200** |

Roles are real, taken from `SERVER_ROLE_CAPS`; no capability is injected.

## M. Non-disclosure proof

| Comparison | Result |
|---|---|
| Out-of-scope existing record vs. random non-existent id | identical status **and** identical body |
| Refusal body scanned for project id, tenant id, record id | none present |
| Refusal body scanned for the parent project id, all 7 routes | none present |

A caller who may not reach a record learns only that it is not there.

## N. Payload-query suppression

For each of the seven representative routes, an out-of-scope caller produces:

```text
status ....................... 404
payload queries executed ....... 0
```

and, for `GET /readiness/project/:id` specifically, **zero writes** — which
matters because that handler upserts `readiness_scores` when it does run.

## O. Mixed-payload audit

| Family | Classification |
|---|---|
| `GET /projects/:id/summary` | **EXISTING_FIELD_GATING** — the route is `cost.view`, and the project detail route's separate commercial-field projection is untouched |
| `GET /change-orders/:id`, `/cost-entries/:id`, `/pay-applications/:id`, `/estimates/:id`, `/subcontracts/:id/invoices`, `/budgets/:id/items`, `/monte-carlo/runs/:id`, `/evm/baselines/:baselineId/wbs` | **SINGLE_DOMAIN_PAYLOAD** — commercial objects under `cost.view`, which is owner-only |
| `GET /daily-logs/:id`, `/risks/:id`, `/compliance-tasks/:id`, `/bim-models/:id`, `/calc-sessions/:id`, `/sensors/:id`, `/meetings/:id`, `/transmittals/:id`, `/purchase-orders/:id`, `/subcontracts/:id`, `/bid-packages/:id`, `/test-packs/:packId`, `/commissioning/*`, `/knowledge*`, `/ask/chunks/:id`, `/agent-actions/:id`, `/documents/:id` | **SINGLE_DOMAIN_PAYLOAD** |
| `GET /readiness/system/:id`, `/readiness/subsystem/:id`, `/readiness/project/:id` | **SINGLE_DOMAIN_PAYLOAD** — `requireAllCapabilities` already demands the conjunction (`project.view`+`quality.view`, or `commissioning.view`+`quality.view`) |
| `GET /rfis/:id/copilot`, `/submittals/:id/review` | **EXISTING_FIELD_GATING** — copilot demands `assistant.use` **and** `construction.view`; both conjunctions preserved verbatim |

No field filter was removed, weakened, or bypassed. Phase 3E adds a dimension
beside the existing ones; it levels none of them. Note `GET
/subcontracts/:id/invoices` declares `cost.view` while its parent detail route
declares `procurement.view` — that asymmetry is pre-existing and was preserved,
not normalised.

## P. Nested-data audit

Sub-collection routes return child rows of the parent whose id was supplied.
In every one of the twelve, the child inherits the same project **and** is
served under the same capability as before, so nested visibility is unchanged
except that it is now additionally bounded by membership. Phase 3E broadens
nothing: every guard is conjunctive with what was already there.

Counts and aggregates (`linked_task_count` on the change order, `active_projects`
and `total_allocation` on the team member, chunk `pagination.total`) are reached
only after the scope guard admits, so a wholly out-of-scope root record returns
no payload at all rather than a 404 carrying useful counts (§27).

## Q. Read-side-effect audit (§28)

Two of the 54 handlers perform a durable write on a `GET`:

| Endpoint | Write | Classification |
|---|---|---|
| `GET /readiness/project\|system\|subsystem/:id` | `INSERT INTO readiness_scores … ON CONFLICT DO UPDATE` via `persistReadinessScore` | **DERIVED-CACHE UPSERT** — writes only a recomputation of the score for the entity being read, keyed on that entity. Not a workflow mutation |
| `GET /portfolio/readiness/:scopeType/:scopeId` | `INSERT INTO operational_forecasts … ON CONFLICT DO UPDATE` via `getOrComputeForecast` | **DERIVED-CACHE UPSERT**, same shape, 1-hour validity |

Neither is a semantic classification defect of the kind Phase 2C-5 found: no
business state transitions, nothing is enqueued, no notification or AI job is
created, and no external integration fires. Both are memoised score caches.

Because both guards are middleware, the three readiness routes now perform the
upsert **only** for callers who are in scope — proved by the "writes nothing on
a refused read" assertion in N. The portfolio forecast route is one of the two
deferrals, so its upsert is still reachable by any `portfolio.view` holder in
the tenant; recorded in AF.

The other 52 handlers issue `SELECT` only.

## R. SELF / non-project corrections

Eight of the 54 were reclassified rather than guarded — four SELF (§29), four
non-project (§15/§30). Full evidence in E. Each correction is asserted
structurally by the ratchet, which proves both that the route has **no**
`requireRecordScope` **and** that it still carries its own ownership rule, so a
correction cannot become an accidental hole.

## S. Query and cache analysis

Measured through the real routers:

```text
DIRECT_COLUMN detail, in-scope member
  principal lookup .... 1
  parent lookup ....... 1
  membership lookup ... 1
  payload ............. 1
  total ............... 4

FK_PATH detail, in-scope member
  principal lookup .... 1
  parent lookup ....... 1   (single JOIN — the FK hop is not an extra round trip)
  membership lookup ... 1
  payload ............. 1
  total ............... 4

PROJECT_ROOT detail, in-scope member
  principal lookup .... 1
  parent lookup ....... 0   (the path id IS the project)
  membership lookup ... 1
  payload ............. 4   (the readiness handler's own queries)
  total ............... 7

DIRECT_COLUMN detail, owner (tenant-wide)
  total ............... 4   (same shape; the membership query takes its tenant-wide branch)

DIRECT_COLUMN detail, refused non-member
  payload ............. 0
  total ............... 3
```

Authorization overhead is a flat **+2 queries** (+1 for `PROJECT_ROOT`),
independent of payload size. No N+1 was introduced: sub-collection routes
resolve the parent **once**, not per child row.

```text
CACHE: N/A
```

None of the affected route families uses a cross-request HTTP or in-process
response cache; no `Cache-Control`, no memoisation layer, no Redis. Scope is
therefore re-resolved from live database state on every request, and membership
revocation takes effect on the next one (K). The two derived-cache tables in Q
are not response caches — they are re-read only through separately-guarded
routes.

## T. Client impact

The mounted client reaches these detail routes from project-scoped lists that
Phase 3B already filters by membership, so ordinary navigation agrees with the
new rule: a link is shown only where the collection behind it was already
membership-filtered.

One path is worth flagging rather than changing: **global/cross-project search
and "related record" surfaces** can still present a link to a record whose
project the caller is not a member of, and that link now answers 404 instead of
200. That is the correct authorization outcome; the UI consequence is a dead
link rather than a leak. No client redesign was performed (out of scope), and
no mechanical alignment was required to keep an existing workflow working.

## U. Final Phase-3 counters

Machine-derived at the final SHA:

```text
TOTAL EXTRACTOR ROWS .............. 765
CANONICAL ENDPOINT TOTAL .......... 747
EXTRACTOR-ONLY SAML ................. 9  (18 mounted rows)

PROJECT-BOUND ENDPOINTS ........... 302

DIRECT-ID READS
  candidates ....................... 63
  protected ........................ 53
  deferred ......................... 10
  corrected non-project ............. 4
  SELF scoped ....................... 4
  deferred scope model .............. 2
  unexplained ....................... 0

COLLECTIONS
  candidates ....................... 58
  protected ......................... 7
  deferred ......................... 51

MUTATIONS
  candidates ...................... 181
  record-scoped ................... 171
  explained non-project/self/service  10

CONSEQUENTIAL
  functional protected .............. 32
  record scoped ..................... 31
  explained non-project .............. 1

UNRESOLVED_DATA_ACCESS
  total ............................ 33
  direct-ID intersections ............ 0
  resolved ........................... 0
  deferred .......................... 33

RECORD_SCOPE
  candidates ...................... 302
  protected ....................... 231
  deferred ......................... 71
  unexplained ....................... 0

RECORD_SCOPE_PROTECTED_AT_THIS_COMMIT  236
```

Movement against the certified parent:

```text
direct-ID reads protected ....  9 → 53   (+44)
record scope protected ...... 187 → 231  (+44)
record scope deferred ....... 115 → 71   (−44)
endpoints enforcing scope ... 190 → 236  (+46)
```

The +46 against +44 is the two sibling reads described in AF: `GET
/monte-carlo/runs/:id/distribution` and `GET /readiness/project/:id/history`.

`§59` predicted `protected 187 → 241` and `deferred 115 → 61` on the assumption
all 54 would close. 44 closed and 10 were classified, so the actual figures are
231 and 71. The reconciliation gap is exactly the 10 classified routes.

## V. Phase-2 census non-regression

```text
PENDING_PHASE2 ...... 0
UNCLASSIFIED ........ 0
UNEXPLAINED ......... 0
extraction anomalies  0
```

The taxonomy still balances: every endpoint carries exactly one disposition and
the class counts sum to the census total.

SAML is unchanged and remains **outside** the canonical census:

```text
distinct SAML declarations ..... 9
mounted rows ................... 18  (mounted twice: /api/v1/auth/saml and /saml)
SAML project-bound ............. 0
```

No SAML authentication, holder policy, capability, or census membership was
touched. The §4 assumption holds.

## W. Holder comparison

Machine-compared `SERVER_ROLE_CAPS`, `USER_ROLES` and `SERVER_CAPABILITIES`
between the certified parent and the candidate, serialised and diffed:

```text
HOLDER DELTA = 0   (3571 bytes, byte-identical)
```

No capability was added, removed, or reassigned. Every guard added in this slice
reuses an authority the route already declared. Inspected families all
unchanged: `project.*`, `construction.*`, `engineering.*`, `quality.*`,
`cost.*`, `schedule.*`, `procurement.*`, `commissioning.*`, `safety.*`,
`personal.*`, `crossdomain.*`.

## X. Regression suites

Entry, at the certified parent, before any product change:

```text
npx tsc --noEmit ............... pass
npm run typecheck:modules ...... pass
authz suites ................... 42 files, 2200 tests, 0 failed
FULL SUITE (baseline) .......... 211 files, 7685 tests, 0 failed, 21.71s
```

Named suites at the final SHA:

```text
Phase 3A/3B/3C/3D + related + collections + mutations + taxonomy + AI cross-domain
                                10 files, 457 tests, 0 failed
IoT / Notifications / SCIM / transition sweep / tenant isolation / notification worker
                                 7 files, 370 tests, 0 failed
Phase 3E direct-ID ratchet ..... 18 tests, 0 failed
Phase 3E direct-ID behaviour ... 38 tests, 0 failed
```

Transition registry (§34) unchanged: `ENFORCED_TRANSITIONS.length === 88`,
88 protected, 0 pending. Collections (§32) unchanged at 7 protected. Mutations
(§33) unchanged at 171 record-scoped / 10 explained.

Four pre-existing suites needed truthful updates, none of them a weakening:

| Suite | Change | Why |
|---|---|---|
| `authzRecordScopeRatchet` | `scoped` 190 → 236, `plain` 540 → 494 | The anti-overclaim pin. `plain + scoped === 730` conservation held unchanged |
| `authzProjectMembershipRatchet` | `scoped` 190 → 236 | Same pin |
| `authzProjectMembershipRatchet` | "no surface deferred for want of a scope model" → "defers **exactly** these two" | Phase 3E genuinely has two model deferrals. Rewritten to pin them **by name** so a third cannot appear silently, rather than deleted |
| `rfiCopilot`, `submittalReview` | real UUIDs + the scope lookups modelled; **two new §18 tests added each** | Both used non-UUID ids (`'rfi1'`, `'sub1'`), so the new guard correctly refused before any SQL |
| `tier1` | two smoke ids made real UUIDs | Same cause — see below |

**The `tier1` failure is worth recording precisely.** `GET /audit/:id` began
returning 200 instead of 404 despite `audit.ts` being untouched. Root cause:
`/calc-sessions/cs-1` and `/daily-logs/row-1` used non-UUID ids, so the new
guard failed closed **without issuing SQL** (which is §45 behaving correctly).
Their scripted `mockResolvedValueOnce` entries were therefore never consumed and
leaked down the file's shared mock queue into the audit block, shifting every
later response by one. Fixed at the source — real UUIDs, matching every other
detail smoke test in the file — rather than by loosening the audit assertion.

## Y. Product mutation tests (§47)

Each planted independently and reverted completely; `recordScope.ts` and
`personalScope.ts` verified byte-unchanged afterwards.

| Mutant | Change | Suite | Result |
|---|---|---|---|
| **A** scope removed | dropped `requireRecordScope('daily_logs')` from the detail read | 3E behaviour + ratchet | **RED** — 10 failed |
| **B** FK hop broken | `knowledge_chunks.via` `source_id` → `id` | 3E behaviour + ratchet | **RED** — 4 failed |
| **C** membership window ignored | removed `active_from`/`active_to` predicate | 3E + 3C behaviour | **RED** — 4 failed |
| **D** owner tenant bound removed | dropped tenant predicate from the tenant-wide branch | 3E + 3C behaviour | **RED** — 1 failed |
| **E** payload before scope | `next()` moved ahead of the scope decision | 3E behaviour | **RED** — 22 failed |
| **F** capability removed | dropped `requireCapability('risk.view')`, kept scope | 3E behaviour + ratchet | **RED** — 2 failed |
| **G** SELF weakened | ownership test reduced to "assigned to anyone" | `authzPersonalInboxBehaviour` | **RED** — 7 failed |

Mutant G is recorded honestly: it does **not** fail the Personal Inbox
*ratchet* (structural), only the Personal Inbox *behaviour* suite. The ratchet
proves the guard is called; only the behaviour suite proves it discriminates.

Mutants A, B and E are the ones that matter for fixture honesty (§48): they
prove the fixture is reading the product's real SQL rather than restating
intended behaviour. B in particular passes a ratchet-only check and is caught
only because the fixture follows the statement's actual `JOIN`.

**No mutant state is committed.**

## Z. Extractor regression

No extractor source was modified in this slice. Phase-3C/3D hardening intact:

```text
balanced route parsing ......... intact
multi-router attribution ....... intact (procurement.ts still yields 4 routers)
intra-file sub-router mounting . intact
indirect auth guards ........... intact
capability detection ........... intact (729 guarded / 36 unguarded, unchanged)
record-scope detection ......... intact (190 → 236 detected, tracking the source)
body project detection ......... intact
UNRESOLVED_DATA_ACCESS ......... intact (33, unchanged)

extraction anomalies ........... 0
silent route drops ............. 0
```

One extractor **limitation** was newly identified (not a regression, and not
fixed here): a direct-ID read is classified `projectBound` from its *payload*
tables, so a route whose path id addresses a project-bound record but whose
payload table has no project parent is classed `TENANT_GLOBAL`. That is how
`GET /monte-carlo/runs/:id/distribution` and `GET /readiness/project/:id/history`
escaped the 54. Recorded in AF.

## AA. Three-run inventory determinism

Entry, at `dedf6e0`:

```text
run1: 06ac74744e5fd8ce22dd71e56a230e70444954374fbf636fcca99adbdc1c72ab
run2: 06ac74744e5fd8ce22dd71e56a230e70444954374fbf636fcca99adbdc1c72ab
run3: 06ac74744e5fd8ce22dd71e56a230e70444954374fbf636fcca99adbdc1c72ab
```

Exit, at `a8d6a4f`:

```text
run1: 67d6477c45b2fa3aff65e74a13cbd7e13a5cfcd685cf4b71b1e1a90ac9aa459e
run2: 67d6477c45b2fa3aff65e74a13cbd7e13a5cfcd685cf4b71b1e1a90ac9aa459e
run3: 67d6477c45b2fa3aff65e74a13cbd7e13a5cfcd685cf4b71b1e1a90ac9aa459e
```

```text
INVENTORY DETERMINISM: 3/3 BYTE-IDENTICAL, ENTRY AND EXIT
```

Hash is over all four JSON inventories plus the rendered Markdown. No generated
evidence was hand-edited.

Note on stamping: `PHASE3C_PREWORK_INVENTORY.md` embeds `git rev-parse HEAD` at
generation time, so it names `a8d6a4f` — the commit containing every product and
test change. The evidence commit that carries the regenerated inventory is its
child and changes no product source. This is the same convention the Phase-3D
evidence used.

## AB. Final full-suite result

One default run at the final state:

```text
npx vitest run

  Test Files  213 passed (213)
       Tests  7743 passed (7743)
      Failed  0
     Skipped  0
    Duration  16.78s
```

No cross-file host pollution occurred in this run. The entry baseline was
211 files / 7685 tests; the delta is the two new Phase-3E suites (+2 files,
+56 tests) and two added assertions each in `rfiCopilot` and `submittalReview`.

```text
FULL-REPO DETERMINISM:
NOT IN SCOPE FOR PHASE 3E — SEPARATE QUALIFICATION GATE
```

No five-run determinism campaign was performed and none is claimed. No Vitest
concurrency, timeout, worker-count, supertest or serialisation setting was
modified.

## AC. Static / build / security / lint

```text
npx tsc --noEmit ............... 0 errors
npm run typecheck:modules ...... 0 errors
npm run build .................. ✓ built in 411ms
git diff --check ............... clean

python3 scripts/security_gate.py
  scan_secrets ................. exit=0 CLEAN
  validate_claude_agents ....... exit=0 PASS (105 checks)
  SECURITY HOLD ................ CLEAR 🟢

npx eslint <39 changed/new files>
  errors ....................... 0
  warnings ..................... 0
```

No unrelated lint debt was cleaned. `package-lock.json` unchanged.

## AD. Migration 086 status

```text
MIGRATION 086 LOCAL REVALIDATION: NOT EXECUTED
```

Stated precisely rather than as blanket unavailability: the Docker daemon is
**not running**, so no genuinely throwaway PostgreSQL instance was available. A
local PostgreSQL is reachable on `/tmp:5432`, but it is the developer's own
instance, not a throwaway, and §53 makes this revalidation useful rather than
required — Phase 3B already validated the migration. Creating or migrating a
database in the owner's environment was therefore not performed.

`086_project_members.sql` was **not** applied to any owner, staging or
production environment.

Deployment dependency, unchanged and now broader:

```text
086 MUST APPLY BEFORE OR ATOMICALLY WITH PHASE-3B+ RUNTIME CODE
```

Phase 3E widens the blast radius of getting this wrong: 44 additional read
routes now resolve scope through `project_members`. If the runtime ships ahead
of the migration, those reads fail closed — every non-Owner receives 404. That
is the safe direction, but it is an availability outage, not a silent
degradation. There is **no legacy authorization fallback**.

`085_notification_deliveries.sql` was not applied or modified; no incidental
notification work was performed.

## AE. SAML census gap — unchanged

```text
distinct SAML declarations outside the canonical census ..... 9
mounted rows ................................................ 18
project-bound ............................................... 0
```

Unchanged by this slice, and still the only extractor-only identities. §4
assumption holds; no `STOP` condition triggered.

## AF. Residual risks

1. **Two twin-keyed reads remain open** (`/portfolio/readiness/:scopeType/:scopeId`,
   `/scenarios/projection/:twinId`). A `portfolio.view` or `crossdomain.read`
   holder can still obtain a readiness forecast for any twin in their tenant.
   Both remain tenant-bounded and capability-gated. **This is why the slice is
   PARTIAL.** `/scenarios/temporal/:twinId/diff` and
   `/scenarios/temporal/:twinId/at` share the model gap.

2. **Two member-keyed collections remain unfiltered**
   (`/team/members/:id/assignments`, `/team/members/:memberId/timesheets`). The
   id addresses a non-project record, so record scope cannot apply, but the rows
   returned are project-bound. A `team.view` holder can enumerate a member's
   project assignments and timesheets across projects they are not in. This
   belongs to the collection slice and should be treated as **in scope for
   Phase 3F**, not as closed here.

3. **The extractor's project-boundness test uses payload tables, not the path
   id.** Two routes escaped the 54 this way and were closed alongside their
   siblings; there may be more of this class among the 132 direct-ID reads.
   A targeted re-classification pass would quantify it. Until then the "63
   project-bound direct-ID reads" figure should be read as a **lower bound**.

4. **`GET /files/download/:token` honours an already-minted token for up to one
   hour after membership revocation.** Issuance is now scoped (the presign route
   is the only issuer), but the bearer token itself carries no membership check.
   Live-revocation semantics therefore hold for every route in this slice
   *except* an in-flight download token.

5. **`GET /portfolio/readiness/:scopeType/:scopeId` still upserts
   `operational_forecasts` on a GET** for any tenant `portfolio.view` holder,
   because it is one of the two deferrals. Derived-cache only.

6. **NULL-parent reads are refused.** `requireRecordScope` denies a record whose
   `project_id` is NULL, and 9 of the newly-scoped tables have a nullable
   `project_id` — notably `documents` (the upload path explicitly supports a
   project-less `_global` document), `knowledge_sources` and `knowledge_fixes`
   (project is documented as a retrieval tag), `commissioning_packs`,
   `commissioning_baselines`, `calc_sessions`, `estimates`, `transmittals`,
   `agent_actions`. Phase 3D already established deny-on-NULL as the live
   contract for the **mutations** on these same tables, so Phase 3E makes the
   reads consistent with an already-certified decision rather than inventing a
   new one. **No existing test covers a tenant-global read of these types**, so
   the full suite passing is evidence but not proof that no legitimate workflow
   regressed. If the product intends genuine tenant-global documents or
   knowledge sources, that needs an explicit dual-semantics policy (§19) and
   both paths tested — recommended as a follow-up.

7. Unchanged from Phase 3D: 51 project-bound collections; 33
   `UNRESOLVED_DATA_ACCESS` endpoints; 10 explained non-project/self/service
   mutation classifications; the temporary Owner-only `crossdomain` policy; the
   SAML census gap; full-repo determinism host qualification; migrations 085 and
   086 unapplied.

## AG. Recommendation

```text
ADR-014 PHASE 3F — PROJECT-BOUND COLLECTION RECORD-SCOPE ROLLOUT
```

The final inventory confirms this is the largest coherent remaining gap: **51
project-bound collections deferred against 7 protected** — the only remaining
operation class with a majority still open, and the one that governs
enumeration rather than single-record access. Residual risks 2 and 3 above fold
naturally into it: the two member-keyed collections are collection filtering,
and the payload-table classification gap is best re-measured while working the
collection surface.

Two smaller items are worth pricing before committing to 3F, because both are
cheap and both currently sit as known-open:

- the `operational_twins` scope model (4 routes: 2 deferred here plus the 2
  temporal scenario reads) — a bounded policy decision, not a rollout;
- the dual-semantics decision for nullable project parents (residual 6), which
  is a correctness question about Phase 3D/3E behaviour already shipped, and is
  the only item on this list that could be a live workflow regression rather
  than a remaining gap.

If forced to sequence: **resolve residual 6 first** (it questions work already
done), then Phase 3F, then the twin model.

---

*Phase-3E completion evidence. A pushed branch and this report are not promotion
authorization. No PR was opened, nothing was merged, tagged, released or
deployed, and no owner database migration was applied.*
