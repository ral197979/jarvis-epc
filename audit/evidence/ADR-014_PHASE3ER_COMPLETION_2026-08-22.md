# BUILDER COMPLETION REPORT — jarvis-epc — ADR-014 PHASE 3E-R

## A. Verdict

```text
ADR-014 PHASE 3E-R: COMPLETE

NULLABLE PROJECT-PARENT INVENTORY ............. CLOSED
TENANT-GLOBAL RESOURCE POLICY ................. PROVED
DUAL PROJECT / TENANT SCOPE ................... PROVED
PROJECT-REQUIRED NULL-PARENT DENIAL ........... PROVED
PROJECT→GLOBAL AUTHORIZATION ESCAPE ........... CLOSED
GLOBAL→PROJECT AUTHORIZATION ESCAPE ........... NOT SUPPORTED
SAME-TENANT PROJECT RECORD ISOLATION .......... PROVED
CROSS-TENANT GLOBAL RECORD ISOLATION .......... PROVED
LIVE MEMBERSHIP REVOCATION .................... PROVED
LIVE FUNCTIONAL-CAPABILITY REVOCATION ......... PROVED
PHASE-3D MUTATION CONTROLS .................... PRESERVED
PHASE-3E DIRECT-ID CONTROLS ................... PRESERVED
CAPABILITY HOLDER DELTA ....................... 0
PENDING_PHASE2 ................................ 0
UNCLASSIFIED .................................. 0
NULLABLE_PARENT_UNEXPLAINED ................... 0
RECORD_SCOPE_UNEXPLAINED ...................... 0
INVENTORY DETERMINISM ......................... PROVED
PROMOTION ..................................... NOT AUTHORIZED
```

Separately:

```text
FULL-REPO DETERMINISM:
NOT IN SCOPE — SEPARATE QUALIFICATION GATE
```

`OWNER_POLICY_REQUIRED = 0`. Every one of the 15 nullable resources was decided
from repository evidence; none needed a policy ruling, and no transfer workflow
exists to gate, so none of the §55 blocked verdicts applies.

## B. Repository provenance

```text
repository root ...... /Users/rommelaguillon/Local Documents/Claude/Production/Denver Engineering
remote ............... https://github.com/ral197979/jarvis-epc.git
owner/repo ........... ral197979/jarvis-epc

certified parent ..... 6049579e06426d40cefae6fe9b3c17abd360203f
  git cat-file -t .... commit
  remote contains .... origin/security/adr-014-phase3e-direct-id-reads

branch ............... security/adr-014-phase3er-nullable-project-scope
product commit ....... 59985e5c457fd82104ffa2c13d802787a4283b44
evidence commit ...... this commit (a commit cannot carry its own hash;
                       resolve with `git rev-parse HEAD` on the branch below)
final SHA ............ = the evidence commit = branch tip of
                       security/adr-014-phase3er-nullable-project-scope
origin/main .......... f5883c31c1205a113ec4909437449d0a84381d34  (untouched)

tracked tree ......... clean at final SHA
stashes .............. 2, both preserved, neither touched
  stash@{0} On main: wip: untracked files that exist on origin
  stash@{1} WIP on main: d3b97d4 fix(jarvis-epc): import backendUrl ...
worktrees ............ 1 (the primary checkout)
unrelated evidence ... 27 pre-existing untracked audit/evidence/*.md preserved
```

The §1 gate passed before the branch was created.

## C. Nullable resource inventory

Machine-derived from the migrations joined to the record-scope registry, not
from the nine names the Phase-3E report happened to list. Derivation is read
per policy object by brace-matching the registry array, so an adjacent entry
cannot bleed into its neighbour; for an `FK_PATH` resource the column inspected
is the **parent's**, since that is where its project actually lives.

```text
registry policy objects ........... 60
  project parent NOT NULL ......... 44
  project parent NULLABLE ......... 15
  no derivation (SELF) .............. 1
```

**The report's nine were a subset.** They were the tables Phase 3E happened to
touch on the direct-ID read surface. The true surface is 15; the six additional
resources are:

| Resource | Why the report missed it |
|---|---|
| `document_versions` | `FK_PATH`; inherits nullability from `documents`, which the report did name |
| `knowledge_chunks` | `FK_PATH`; inherits from `knowledge_sources` |
| `commissioning_autosign_rules` | Reached only by mutations, so no direct-ID read named it |
| `compliance_tasks` | Read was in the 54, but the report's nine listed only tables it flagged by nullability |
| `monte_carlo_runs` | Same |
| `chat_sessions` | Record scope is used by its DELETE, not by its SELF-guarded read |

```text
NULLABLE PROJECT-PARENT RESOURCE UNEXPLAINED = 0
```

## D. Source-evidence ledger

Every non-`PROJECT_REQUIRED` classification carries evidence in the registry
itself (`projectSemanticsEvidence`), which the ratchet requires and checks. The
asymmetry is deliberate: `PROJECT_REQUIRED` restates a `NOT NULL` constraint the
schema already enforces and needs no argument; a claim that NULL is a real
product state is exactly the claim that must be defensible.

| Resource | Schema NULL | Product global evidence | Final policy |
|---|---|---|---|
| `documents` | yes (`SET NULL`) | **explicit** — `files.ts:129` builds `${tenantId}/${projectId ?? '_global'}/…`; `POST /request-upload` and `POST /folders` guard with `requireBodyProjectScope`, which Phase 3D documents as optional on purpose, naming "a tenant-level folder" | `DUAL_PROJECT_OR_TENANT` |
| `document_versions` | inherits | **inherited** — no project column of its own; a version of a `_global` document is itself global | `DUAL_PROJECT_OR_TENANT` |
| `knowledge_sources` | yes (`SET NULL`) | **explicit** — migration 022 places `project_id` under "Classification tags used for retrieval filtering" beside `tags`/`asset_system`; `knowledgeBulkIngest.ts:182` omits the column from its INSERT entirely | `DUAL_PROJECT_OR_TENANT` |
| `knowledge_chunks` | inherits | **inherited** — via `source_id` | `DUAL_PROJECT_OR_TENANT` |
| `knowledge_fixes` | yes (`SET NULL`) | **explicit** — `fixExtractor.ts:379` omits `project_id` from its INSERT column list; `fixLibrary.ts:99` supplies one. Both states occur | `DUAL_PROJECT_OR_TENANT` |
| `commissioning_baselines` | yes (`CASCADE`) | **explicit** — migration 019 declares `scope VARCHAR(16) NOT NULL CHECK (scope IN ('global','client','project'))`, and its own constraint comment states "a global rule with NULL client_id/project_id has exactly one row" | `DUAL_PROJECT_OR_TENANT` |
| `commissioning_autosign_rules` | yes (`CASCADE`) | **explicit** — migration 016 declares the identical three-level `scope` check | `DUAL_PROJECT_OR_TENANT` |
| `commissioning_packs` | yes (`SET NULL`) | **explicit** — all three create routes validate only title/systemType and pass `projectId ?? null` behind `requireBodyProjectScope` | `DUAL_PROJECT_OR_TENANT` |
| `monte_carlo_runs` | yes (bare `UUID`) | **explicit** — `POST /runs` guards with `requireBodyProjectScope`; Phase 3D's note on that guard names "a portfolio simulation" | `DUAL_PROJECT_OR_TENANT` |
| `estimates` | yes (bare `UUID`) | route contract — `POST /estimates` validates only `name`; service passes `?? null`; `GET /estimates?project_id=` is a filter over a tenant set | `DUAL_PROJECT_OR_TENANT` |
| `transmittals` | yes (bare `UUID`) | route contract — create validates subject/purpose/parties/items, not project; list selects `FROM transmittals WHERE tenant_id=$1` | `DUAL_PROJECT_OR_TENANT` |
| `compliance_tasks` | yes (`CASCADE`) | route contract — create validates only title and due_date; the **list route is tenant-scoped and already returns project-less rows** | `DUAL_PROJECT_OR_TENANT` |
| `calc_sessions` | yes (`SET NULL`) | route contract — the product route takes project from the path, but the mounted MCP bridge (`mcp.ts:436 session_create`) persists `projectId ?? null` | `DUAL_PROJECT_OR_TENANT` |
| `agent_actions` | yes (`SET NULL`) | typed contract — `ActionRow.project_id: string \| null`; an AI-governance audit row about a non-project decision has none (§22 below) | `DUAL_PROJECT_OR_TENANT` |
| `chat_sessions` | yes (`SET NULL`) | `askBuilder.ts:338` writes whatever `a.projectId` holds, absent for a general ask (§21 below) | `DUAL_PROJECT_OR_TENANT` |
| `action` | n/a (SELF) | Phase 2C-4A: a personal record owned by its assignee, enforced by `requireActionAccess` | `SELF_SCOPED` |
| *44 others* | **NOT NULL** | the schema itself | `PROJECT_REQUIRED` |

**`PROJECT_REQUIRED` among the nullable set: 0.** §36 anticipated this
possibility and asked that it be reported rather than invented, so it is
reported. The 44 `PROJECT_REQUIRED` resources are exactly those whose column is
`NOT NULL`, where the branch is unreachable by construction — the strongest form
the classification can take. The finding is coherent rather than convenient: the
repository's create paths are permissive about `project_id` on precisely the
tables whose column is nullable, and strict on precisely those where it is not.

**Why the corroboration matters more than the nullability.** `ON DELETE SET NULL`
alone would only show that a row survives its project's deletion. What decides
these classifications is that a **mounted create or ingest path produces the NULL
row on purpose** — in five cases by omitting the column from the INSERT or
naming the global state in the DDL.

## E. Canonical resolver changes

One resolver, extended — no parallel implementation (§10).

`resolveParentProjectId` returned `Promise<string | null>`, which could not
distinguish:

```text
the record does not exist (or is another tenant's)   → null
the record exists and deliberately has no project    → null
```

Both were refused. Added `resolveRecordScope`, returning a discriminated result:

```ts
export type RecordScopeResolution =
  | { kind: 'PROJECT'; projectId: string }
  | { kind: 'TENANT_GLOBAL' }
  | { kind: 'NOT_FOUND' }
```

The load-bearing line is `if (res.rows.length === 0)` — reading
`rows[0]?.project_id` alone is what conflated the two. `resolveParentProjectId`
is retained as a thin wrapper for callers that legitimately treat both absences
alike; `requireRecordScope` deliberately does not use it.

A failed lookup returns `NOT_FOUND`, never `TENANT_GLOBAL`: a database error is
not evidence that a record has no project. Asserted by the ratchet, with
comments stripped so the assertion tests code rather than prose.

## F. Registry policy model

Two required fields on `RecordScopePolicy` — required, not optional, so a new
resource cannot acquire a NULL-parent meaning by saying nothing (§9):

```ts
projectSemantics:      'PROJECT_REQUIRED' | 'TENANT_GLOBAL'
                     | 'DUAL_PROJECT_OR_TENANT' | 'SELF_SCOPED'
projectParentMutation: 'IMMUTABLE' | 'PROMOTION_TO_GLOBAL_SUPPORTED'
                     | 'ASSIGN_TO_PROJECT_SUPPORTED' | 'BIDIRECTIONAL_TRANSFER_SUPPORTED'
```

plus `projectSemanticsEvidence?`, which the ratchet **requires** for every
non-`PROJECT_REQUIRED` resource and **forbids** for the rest.

The ratchet checks every declaration against the migrations in **both**
directions, which is what stops the registry drifting into either failure mode:

- `DUAL`/`TENANT_GLOBAL` over a `NOT NULL` column → fail (an unreachable branch
  advertising a state the data cannot hold);
- `PROJECT_REQUIRED` over a nullable column → fail (the bug this slice fixes).

## G. Project-bound branch

Unchanged. `project_id != NULL` still requires the route's existing functional
capability **and** live membership resolved from `project_members` on every
request. Proved by "still refuses a project-tagged record to a same-tenant
non-member" and by mutant C.

## H. Tenant-global branch

```text
live authenticated principal
+ same tenant
+ the route's EXISTING Phase-2 functional capability
```

No new capability, no membership requirement — because the record has no project
to be a member of. The alternative was not a stricter rule but an unsatisfiable
one: before this slice, a project-less row was refused to **every** principal
including the tenant Owner, since `!projectId` short-circuited ahead of the
tenant-wide branch.

## I. Dual-scope reads

| Case | Result |
|---|---|
| Project-tagged record, member of that project | 200 |
| Project-tagged record, same-tenant non-member | **404** (Phase-3E protection intact) |
| Project-**less** record, capability holder, member of nothing relevant | **200** (the fix) |
| Project-less record, Owner with no membership row | **200** |
| Absent id | 404 |

One caller, three outcomes, proving the branches are genuinely distinct (§25):
`USER_B` — a member of `PROJECT_B` only — gets 200 on their own project's
source, 404 on `PROJECT_A`'s, and 200 on the tenant-global one.

## J. Dual-scope creates

**No create path was changed, and none needed to be.** §13 warns against
enabling global creation merely because global reading is legitimate; the
inverse held here — global creation already existed and global reading did not.
Every project-less row this slice makes readable was already creatable through
a mounted route before it.

`requireBodyProjectScope` is untouched: supplying a project the caller cannot
reach is still refused, and omitting the field still creates an unparented
record exactly as before.

## K. Dual-scope mutations

Reconciled in the same change rather than left contradictory (§32), because the
**shared guard** changed rather than individual routes. All 43 affected routes
now read the same declaration:

```text
routes whose NULL-parent semantics this slice changes .... 43
  reads ................................................. 16
  mutations ............................................. 27
distinct dual resources bound to routes ................. 15 of 15
dual resources with no route ............................ 0
```

A project-less record is now mutable by a holder of the route's existing write
or approval capability within the tenant — the same authority that could always
mutate it before Phase 3D, and the same authority the read now admits. No
Phase-2 authority was broadened: `ai.govern` still gates the agent-action
review, `commissioning.approve` the baseline delete, `assistant.admin` the
corpus admin routes, `docs.publish` the transmittal send.

## L. Project-parent mutation / transfer audit

```text
IMMUTABLE ............................. 60 of 60 resources
unexplained project-parent mutation .... 0
```

Machine-proved, two independent ways:

1. **No `UPDATE … SET` in `api/routes` or `api/services` assigns `project_id`.**
   The ratchet parses every `UPDATE <table> SET …` up to its `WHERE` across all
   scanned files and asserts none contains `project_id =`. It asserts it scanned
   more than 50 files, so the check cannot pass by finding nothing.
2. **No column allow-list contains `project_id` or `projectId`.** The ratchet
   asserts it found more than five allow-lists, for the same reason.

So §16's default applies: project ↔ tenant-global transfer is **NOT SUPPORTED**,
and attempted `project_id` changes are refused because no writer reads the
field. §17 and §18 therefore do not arise, and no
`BLOCKED — PROJECT/GLOBAL TRANSFER POLICY REQUIRED` verdict is needed.

This closes §15's escape hatch. Were transfer ever added, the transfer-capable
enum values exist so that it becomes a deliberate, reviewable edit to this
registry — mutant F proves that declaring one without gating it turns the
ratchet red.

## M. Documents proof

| Surface | Behaviour |
|---|---|
| `GET /files/documents/:id`, project-bound | membership required — unchanged |
| `GET /files/documents/:id`, `_global` | admitted to `docs.view` within the tenant |
| `GET /files/presign/:versionId`, global document | admitted; `document_versions` inherits through `document_id` |
| `PATCH` / `DELETE /files/documents/:id` | same split, under `docs.write` |
| Project-A document | **still membership-scoped** |

`document_versions` is the reason FK inheritance had to be right: classifying it
`PROJECT_REQUIRED` would have left a `_global` document readable while its own
versions and download presign were not.

Download-token issuance stays scope-protected; token lifetime is out of scope
(§31, AH).

## N. Knowledge proof

The knowledge corpus was the most damaged surface, and the damage was total:
`knowledgeBulkIngest.ts` omits `project_id` from its INSERT column list
entirely, so **every bulk-ingested source was project-less and therefore
unreadable by every role**, Owner included, through `GET /knowledge/sources/:id`,
`GET /sources/:id/chunks` and `GET /ask/chunks/:id`. The same held for every
`knowledge_fixes` row produced by `fixExtractor.ts`, which likewise omits the
column.

| Case | Result |
|---|---|
| Project-tagged source, member | 200 |
| Project-tagged source, non-member | 404 |
| Tenant-global source, any `assistant.use` holder | 200 |
| Chunk of a project source, member / non-member | 200 / 404 |
| Chunk of a **global** source | 200 — the FK hop resolves to a real parent row whose `project_id` is null, not to "no parent" |
| Another tenant's global source | 404 |

The ratchet pins the evidence to the code: if either ingest ever starts setting
`project_id`, the assertion that its INSERT does **not** mention the column
fails, forcing the semantics to be re-derived rather than silently inherited.

## O. Remaining-resource qualification

| Resource | Verdict | Basis |
|---|---|---|
| `commissioning_packs` | `DUAL_PROJECT_OR_TENANT` | three mounted create routes pass `projectId ?? null` behind `requireBodyProjectScope` |
| `commissioning_baselines` | `DUAL_PROJECT_OR_TENANT` | explicit `scope IN ('global','client','project')` + DDL comment naming the global row |
| `calc_sessions` | `DUAL_PROJECT_OR_TENANT` | the MCP bridge is mounted at `/api/v1/mcp` and its `session_create` persists a project-less session |
| `estimates` | `DUAL_PROJECT_OR_TENANT` | create validates only `name`; project is a collection filter |
| `transmittals` | `DUAL_PROJECT_OR_TENANT` | create validates six other fields, not project; list is tenant-scoped |
| `agent_actions` | `DUAL_PROJECT_OR_TENANT` | see §22 treatment below |
| `chat_sessions` | `DUAL_PROJECT_OR_TENANT` | see §21 treatment below |

**`agent_actions` (§22).** Not classified global merely for lacking a project.
Its authority is untouched — `crossdomain.read` to read, `ai.govern` to review —
so the tenant-global branch admits exactly the holders the route already
admitted, and the stronger AI-governance authority is preserved rather than
displaced. What changed is only that a governance record about a non-project
decision is now reachable by those holders instead of by nobody.

**`chat_sessions` (§21).** Record scope is used here by **one** route,
`DELETE /ask/sessions/:id` under `assistant.admin`. The READ route is guarded
separately by `WHERE id=$1 AND user_id=$2` and does not use this guard, so the
SELF rule on reads is untouched by anything in this slice. Classifying the
resource `SELF_SCOPED` would have left project-less sessions — the common case
for a general ask — permanently undeletable even by an `assistant.admin`.

## P. Same-tenant project/global matrix

Fixture: Tenant A with `USER_A` → `PROJECT_A`, `USER_B` → `PROJECT_B`,
`OWNER_A` tenant-wide with no membership row.

| Caller | `SOURCE_PROJ` (→ A) | `SOURCE_OTHER` (→ B) | `SOURCE_GLOBAL` (NULL) |
|---|---|---|---|
| `USER_A` (engineer, member A) | **200** | 404 | **200** |
| `USER_B` (engineer, member B) | 404 | **200** | **200** |
| `OWNER_A` (owner, no membership) | 200 | 200 | **200** |

## Q. Cross-tenant proof

| Case | Result |
|---|---|
| Tenant-A engineer → Tenant-B **global** record | **404** |
| Tenant-A **Owner** → Tenant-B global record | **404** |
| Tenant-B engineer → Tenant-B global record | **200** (non-vacuity) |

`TENANT_GLOBAL` never means application-global. The tenant predicate sits on
`resolveRecordScope`'s own statement, so a foreign-tenant row resolves to
`NOT_FOUND` and never reaches the global branch at all — the classification
cannot be reached and then retracted. Mutant D removes that predicate and turns
six tests red.

## R. Membership revocation proof

| Step | Result |
|---|---|
| `USER_A` reads project-tagged source, active member | 200 |
| Membership closed, **same token, no refresh** | **404** |
| Same revocation, tenant-**global** source | **200** — remains available |

This pair is the load-bearing dual-semantics test §26 asks for: revocation must
close the project branch and leave the global branch open, because the global
record has no membership that could have been revoked.

## S. Functional capability revocation proof

| Case | Result |
|---|---|
| `field_ops` (no `assistant.use`) → global record | **403**, not 404 — the functional dimension |
| `engineer` → global record | 200 |
| Stored role changed to `field_ops`, **same token** | **403** on the next request |
| Principal deactivated, same token | **401** |

A tenant-global record does not bypass live capability resolution: the role is
re-read from the database on every request and nothing is cached. Mutant G
removes the router-level capability and turns two tests red.

## T. FK-path inheritance

`knowledge_chunks → knowledge_sources` and `document_versions → documents` both
resolve through an INNER JOIN, so:

- parent row present with a project → `PROJECT` (membership required);
- parent row present with `project_id IS NULL` → `TENANT_GLOBAL`;
- parent row absent (orphaned child) → `NOT_FOUND`.

All three distinguished, and the fixture models the join rather than
pattern-matching the child id — mutant B in the Phase-3E suite (a broken FK hop)
still turns red, so the hop is genuinely being followed.

## U. Side-effect ordering

Refusals are decided in middleware, before the handler runs. Asserted for four
distinct refusal reasons — foreign project, foreign tenant's global row,
unparented row on a `PROJECT_REQUIRED` resource, and absent id:

```text
payload queries executed ....... 0
INSERT / UPDATE / DELETE ....... 0
```

Including the specific ordering trap this slice could have introduced: finding
the row, seeing `project_id IS NULL`, admitting it as tenant-global, and only
then noticing the tenant. The tenant predicate is on the resolver's own
statement, so that sequence cannot occur.

## V. Query and performance analysis

Unchanged from Phase 3E — the resolver issues the **same single statement** and
now reads one more fact from the result it already had.

```text
project-bound record, in-scope member
  principal 1 + parent 1 + membership 1 + payload 1  = 4
tenant-global record
  principal 1 + parent 1 + membership 0 + payload 1  = 3   (one FEWER)
project-bound FK child
  principal 1 + parent 1 (single JOIN) + membership 1 + payload 1 = 4
tenant-global FK child
  principal 1 + parent 1 + membership 0 + payload 1  = 3
refused
  payload 0
```

The global branch is *cheaper*: it skips the membership round-trip because
there is no project to test. No per-row or N+1 authorization was introduced —
sub-collection routes still resolve the parent once.

## W. Phase-3D regression

```text
project-bound mutations record-scoped ......... 171   (unchanged)
explained non-project/self/service ............  10   (unchanged)
consequential functionally protected ..........  32   (unchanged)
consequential record-scoped ...................  31   (unchanged)
transition registry ........................... 88 confirmed / 88 protected / 0 pending
collections protected .........................   7   (unchanged)
```

## X. Phase-3E regression

```text
direct-ID reads protected ..................... 53   (unchanged)
Phase-3E protections .......................... 44   (unchanged)
SELF corrections .............................. preserved (4)
non-project corrections ....................... preserved (4)
twin-model deferrals .......................... 2, carried forward untouched
endpoints enforcing record scope .............. 236  (unchanged)
```

Coverage is identical because this slice changed what the guard *decides*, not
where it is applied. Both Phase-3E suites (18 ratchet + 38 behaviour) pass
unmodified.

## Y. Machine counters

```text
NULLABLE PROJECT-PARENT
  resources ....................... 15
  PROJECT_REQUIRED (nullable set) ... 0
  TENANT_GLOBAL ..................... 0
  DUAL_PROJECT_OR_TENANT ........... 15
  SELF_SCOPED ....................... 1   (action; parent not nullable — SELF by rule)
  OWNER_POLICY_REQUIRED ............. 0

REGISTRY (all 60 resources)
  PROJECT_REQUIRED ................. 44
  DUAL_PROJECT_OR_TENANT ........... 15
  SELF_SCOPED ....................... 1
  TENANT_GLOBAL ..................... 0

AFFECTED ROUTES
  total ............................ 43
  reads ............................ 16
  mutations ........................ 27
  transitions ...... included in mutations (approve/complete/waive/send/close/
                     respond/verify/review = 12 of the 27)

RECORD_SCOPE
  candidates ...................... 302
  protected ....................... 231
  dual-semantics protected ......... 43
  deferred ......................... 71
  unexplained ....................... 0

DIRECT-ID READS
  protected ........................ 53
  twin-model deferred ............... 2

COLLECTIONS
  protected ......................... 7
  deferred ......................... 51

NULLABLE_PARENT_UNEXPLAINED ......... 0
RECORD_SCOPE_UNEXPLAINED ............ 0
```

## Z. Holder comparison

```text
HOLDER DELTA = 0   (3571 bytes, byte-identical to the parent)
```

`SERVER_ROLE_CAPS`, `USER_ROLES` and `SERVER_CAPABILITIES` serialised and
diffed against `6049579`. No grant added, removed or reassigned; no role
normalised. Membership and global scope decide **which records**; the existing
capabilities decide **which functions**.

## AA. Mutation-test proof

Each planted independently and reverted completely; `recordScope.ts`,
`recordScopePolicies.ts`, `dailyLogs.ts`, `transmittalService.ts` and
`knowledge.ts` verified unchanged afterwards.

| Mutant | Change | Result |
|---|---|---|
| **A** blanket NULL deny restored | tenant-global branch always 404s | **RED** — 8 failed |
| **B** blanket NULL allow | declaration check removed; NULL admitted everywhere | **RED** — 4 failed |
| **C** project membership bypass | `canAccessProject` dropped on the project branch | **RED** — 25 failed |
| **D** cross-tenant global leak | tenant predicate dropped from the parent lookup | **RED** — 6 failed |
| **E1** project→global escape | `project_id` added to a route's column allow-list | **RED** — 1 failed |
| **E2** project→global escape | `project_id=NULL` added to a live `UPDATE … SET` | **RED** — 1 failed |
| **F** ungated transfer declaration | a policy switched to `ASSIGN_TO_PROJECT_SUPPORTED` | **RED** — 1 failed |
| **G** capability bypass | router-level `assistant.use` removed | **RED** — 2 failed |

Two notes, recorded rather than smoothed over:

- **§41's Mutant F as specified is not plantable.** It asks to allow assignment
  into a project without membership "where parent assignment exists" — no such
  workflow exists (L). The mutant above tests the property that actually
  guards that future: declaring a transfer capability without building the
  gating turns the ratchet red, so adding one cannot be silent.
- **E was split** because the escape has two distinct routes into the codebase —
  an allow-list and a hand-written `UPDATE` — and a ratchet that caught only one
  would leave the other open.

**No mutant state is committed.**

## AB. Three-run inventory determinism

At the product commit `59985e5`:

```text
run1: 7c7a89858df233de5e6d2965925eb8b533dc252be610cf75522b3f53ac77b5ff
run2: 7c7a89858df233de5e6d2965925eb8b533dc252be610cf75522b3f53ac77b5ff
run3: 7c7a89858df233de5e6d2965925eb8b533dc252be610cf75522b3f53ac77b5ff
```

```text
INVENTORY DETERMINISM: 3/3 BYTE-IDENTICAL
```

Hash covers all four JSON inventories plus the rendered Markdown. No generated
evidence was hand-edited. The Markdown embeds `git rev-parse HEAD`, so the
committed copy names `59985e5` — the commit carrying every product and test
change — and the evidence commit that carries it is its child, changing no
product source. Same convention as Phase 3D and 3E.

## AC. Regression suites

Entry, at the certified parent, before any product change:

```text
npx tsc --noEmit ............... pass
npm run typecheck:modules ...... pass
FULL SUITE (baseline) .......... 213 files, 7743 tests, 0 failed
```

At the final SHA:

```text
Phase 3A/3B/3C/3D/3E + membership + collections + mutations + related +
Personal Inbox + notification ownership + transition sweep + tenant isolation +
residual taxonomy ............................. 15 files, 731 tests, 0 failed
Phase 3E-R nullable ratchet ................... 22 tests, 0 failed
Phase 3E-R nullable behaviour ................. 27 tests, 0 failed
```

**No pre-existing suite required modification.** Unlike Phase 3E, this slice
changed no route declaration and no adoption counter, so no ratchet pin moved.

## AD. One full-suite result

```text
npx vitest run

  Test Files  215 passed (215)
       Tests  7792 passed (7792)
      Failed  0
     Skipped  0
    Duration  16.00s
```

No cross-file host pollution in this run. Delta from the 213/7743 baseline is
the two new Phase-3E-R suites (+2 files, +49 tests).

```text
FULL-REPO DETERMINISM:
NOT IN SCOPE — SEPARATE QUALIFICATION GATE
```

No five-run campaign was performed and none is claimed. No Vitest concurrency,
timeout, worker-count, supertest or serialisation setting was modified.

## AE. Static / build / security / lint

```text
npx tsc --noEmit ............... 0 errors
npm run typecheck:modules ...... 0 errors
npm run build .................. ✓ built in 398ms
git diff --check ............... clean

python3 scripts/security_gate.py
  scan_secrets ................. exit=0 CLEAN
  validate_claude_agents ....... exit=0 PASS (105 checks)
  SECURITY HOLD ................ CLEAR 🟢

npx eslint <4 changed/new files>
  errors ....................... 0
  warnings ..................... 0
```

`package-lock.json` unchanged. No migration was written or applied (§48): the
reconciliation is an authorization-policy change over the schema as it already
stands, and no nullability was widened — so no
`STOP — SCHEMA POLICY CHANGE REQUIRED` condition arose.

## AF. SAML gap — unchanged

```text
distinct SAML declarations outside the canonical census ..... 9
mounted rows ................................................ 18
project-bound ............................................... 0
PENDING_PHASE2 .............................................. 0
UNCLASSIFIED ................................................ 0
```

Untouched, and not solved here.

## AG. Twin model — unchanged

The four `operational_twins` routes are carried forward exactly as Phase 3E left
them (§30):

```text
GET /portfolio/readiness/:scopeType/:scopeId    DEFERRED_PHASE3_SCOPE_MODEL
GET /scenarios/projection/:twinId               DEFERRED_PHASE3_SCOPE_MODEL
GET /scenarios/temporal/:twinId/diff            UNRESOLVED_DATA_ACCESS
GET /scenarios/temporal/:twinId/at              UNRESOLVED_DATA_ACCESS
```

Note these are **not** the same problem this slice solved. A twin's parent is
underivable because `entity_id` is polymorphic `text` across fourteen entity
types with no foreign key — the record's project is *unknown*. A dual resource's
project is *known to be absent*. Deciding the first still needs a
per-entity-type policy.

## AH. Download token revocation gap — unchanged

`GET /files/download/:token` still honours an already-minted token for up to an
hour after membership revocation. Issuance remains scope-protected — the presign
route is the only issuer, and it is guarded — and token lifetime was not
redesigned (§31). Carried forward as a separate security follow-up.

## AI. Residual risks

1. **Fourteen resources are now tenant-readable that were unreadable, and were
   tenant-readable before Phase 3D.** This restores the pre-Phase-3D contract for
   project-less rows rather than inventing a looser one, but it is a real
   widening relative to the shipped state, and it is the intended effect. The
   floor is unchanged: the route's existing capability plus the tenant boundary.

2. **`compliance_tasks`, `estimates`, `transmittals` and `calc_sessions` rest on
   route-contract evidence, not on an explicit design statement.** Their create
   routes accept an omitted project and their collections are tenant-scoped, but
   no comment or column says "global" the way `documents`, the commissioning
   pair and the knowledge tables do. If the product intends these to be strictly
   project-bound, the correct fix is a `NOT NULL` constraint plus a backfill —
   at which point the ratchet's second direction forces the policy to follow.
   Flagged as the most likely place a future owner ruling would differ.

3. **`agent_actions` tenant-global rows are readable by any `crossdomain.read`
   holder in the tenant.** Preserved authority, not widened, but AI-governance
   records are sensitive and a narrower rule (creator, or `ai.govern` only) is
   defensible. Recorded as a policy question, not a defect.

4. **Collections still do not filter by the dual rule.** A future collection
   query for a dual resource must return `project_id IS NULL OR project_id IN
   caller_scope`, subject to capability. The per-resource semantics are now
   registered so Phase 3F can do this correctly (§29); the rollout is
   deliberately not started here. Until then, dual-resource collections remain
   tenant-wide — which is at least now *consistent* with their detail routes,
   where before a caller could see a row in a list and get 404 opening it.

5. Unchanged and carried forward: the twin scope model (AG); the download-token
   revocation window (AH); 51 project-bound collections; 33
   `UNRESOLVED_DATA_ACCESS` endpoints; the temporary Owner-only `crossdomain`
   policy; the SAML census gap; full-repo determinism host qualification;
   migrations 085 and 086 unapplied.

## AJ. Recommendation

```text
NEXT:
ADR-014 PHASE 3F — PROJECT-BOUND COLLECTION RECORD-SCOPE ROLLOUT
```

The final inventory still proves collections are the largest coherent remaining
gap — **51 deferred against 7 protected**, the only operation class where the
majority is open. This slice also removed the reason to sequence anything ahead
of it: Phase 3E's recommendation put the nullable-parent question first because
it questioned work already shipped, and that question is now closed.

3F should absorb two items from above: residual 4 (dual resources need the
`IS NULL OR IN scope` predicate, and the semantics to drive it now exist) and
Phase 3E's residual 2 (the two member-keyed collections, which are collection
filtering rather than record scope).

The `operational_twins` policy slice should follow as a separate bounded piece
of work — four routes, one decision, no rollout — unless final evidence changes
the ranking.

---

*Phase-3E-R completion evidence. A pushed branch and this report are not
promotion authorization. No PR was opened, nothing was merged, tagged, released
or deployed, and no owner database migration was applied.*
