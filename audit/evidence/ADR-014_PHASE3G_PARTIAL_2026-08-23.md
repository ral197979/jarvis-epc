# BUILDER COMPLETION REPORT — jarvis-epc — ADR-014 PHASE 3G

## A. Verdict

```text
ADR-014 PHASE 3G: PARTIAL

MEMBER-KEYED COLLECTIONS ................ CLOSED (2/2)
DERIVABLE UNPOLICIED COLLECTIONS ........ CLOSED (3/3)
COLLECTION DATA-ACCESS INVENTORY ........ RECONCILED (13/13)
DIRECT-ID CLASSIFIER .................... REPAIRED
DEFERRED_SCOPE_MODEL .................... 1  (GET /api/v1/ops/live-feed)
COLLECTION_UNEXPLAINED .................. 0
COLLECTION_DATA_ACCESS_UNEXPLAINED ...... 0
DIRECT_ID_CLASSIFICATION_UNEXPLAINED .... 0
RECORD_SCOPE_UNEXPLAINED ................ 0
PROMOTION ............................... NOT AUTHORIZED
```

Sub-verdicts:

```text
MEMBER-KEYED ASSIGNMENT FILTERING .............. PROVED
MEMBER-KEYED TIMESHEET FILTERING ............... PROVED
OUTER MEMBER / PROJECT-ROW AUTHORITY ........... SEPARATED
MEMBER-KEYED AGGREGATE SIDE-CHANNEL ............ CLOSED
DOCUMENT_FOLDERS SCOPE POLICY .................. CLOSED
SOURCE_UPLOADS SCOPE POLICY .................... CLOSED
ACTION_RELATIONS SCOPE POLICY .................. NOT REQUIRED — see J
UNPOLICIED COLLECTION ROUTES ................... 0
DIRECT-ID PRIMARY-RESOURCE CLASSIFIER .......... REPAIRED
DIRECT-ID INVENTORY ............................ RECONCILED (63 → 60)
NEWLY DISCOVERED DERIVABLE DIRECT-ID BYPASSES .. NONE FOUND
NEWLY DISCOVERED PROJECT COLLECTION ............ 1, CLOSED (agent-actions rollup)
HOLDER-NEUTRAL AGGREGATE RATCHET ............... PRESERVED AND STRENGTHENED
SELF-SCOPED AUTHORIZATION ...................... PRESERVED
PHASE-3D / 3E / 3E-R / 3F CONTROLS ............. PRESERVED
CAPABILITY HOLDER DELTA ........................ 0
PENDING_PHASE2 ................................. 0
UNCLASSIFIED ................................... 0
INVENTORY DETERMINISM .......................... PROVED (3/3, entry and exit)
```

Separately:

```text
FULL-REPO DETERMINISM:
NOT IN SCOPE — SEPARATE QUALIFICATION GATE
```

**PARTIAL for one reason, and it is a model gap, not unfinished work.**
All five live collection gaps closed and the classifier is repaired. One
*newly discovered* surface — `GET /api/v1/ops/live-feed` — keys on a
caller-chosen scope pair with no foreign key, and deriving a project parent
for it is a data-model decision. §73 forbids disguising unfinished
implementation as a model deferral; nothing here is disguised.

## B. Repository provenance

```text
repository root ...... /Users/rommelaguillon/Local Documents/Claude/Production/Denver Engineering
remote ............... https://github.com/ral197979/jarvis-epc.git
owner/repo ........... ral197979/jarvis-epc

certified parent ..... 04b2e6d7ab4439ccc0b21ec7493726d3b2670361
  git cat-file -t .... commit
  remote contains .... origin/security/adr-014-phase3f-collection-scope

branch ............... security/adr-014-phase3g-collection-remainder
product commit ....... dd734a627f517da21107adf2de97a7d62ea0b472
evidence commit ...... this commit (a commit cannot carry its own hash;
                       resolve with `git rev-parse HEAD` on the branch below)
final SHA ............ = the evidence commit = branch tip of
                       security/adr-014-phase3g-collection-remainder
origin/main .......... f5883c31c1205a113ec4909437449d0a84381d34  (untouched)

tracked tree ......... clean at final SHA
stashes .............. 2, both preserved, neither touched
worktrees ............ 1
unrelated evidence ... 27 pre-existing untracked audit/evidence/*.md preserved
```

## C. Entry inventories

Reproduced the certified Phase-3F state exactly, 3/3 byte-identical
(`6e105e62…`):

```text
TOTAL ROWS 765   PROJECT-BOUND 353
COLLECTIONS 108 protected 79      DIRECT-ID 63 protected 53
MUTATIONS 182 record-scoped 174   RECORD_SCOPE 353/306/47/0
UNRESOLVED 31, collection intersections 13
ENTRY FULL SUITE 217 files, 7837 tests, 0 failed
```

## D. Member-keyed route inventory

| Route | Path id addresses | Rows returned | Semantics |
|---|---|---|---|
| `GET /team/members/:id/assignments` | `team_members` (NO_PROJECT_PARENT) | `project_assignments` | PROJECT_REQUIRED |
| `GET /team/members/:memberId/timesheets` | `team_members` | `timesheets` | PROJECT_REQUIRED |
| `GET /team/members/:id` | `team_members` | the member, **plus two aggregates over assignments** | — |

The third was not in the mandate. It is here because §7 puts any aggregate
over project-bound rows in scope, and `active_projects` / `total_allocation`
were counted over **every** project the member touched.

Both row models are `PROJECT_REQUIRED` — `project_id` is NOT NULL in the
migrations — so neither gets a tenant-global branch it has no rows for.

## E. Assignment filtering

`requireRecordScope('team_members')` is **not** used, and the ratchet asserts
its absence (§9): the member is not the project authorization object, and
guarding on it would deny a caller knowledge that Jane exists because Jane
works on a project they cannot reach.

| Caller | Result |
|---|---|
| member of A | `asn-A` |
| member of B | `asn-B` (mirror image — the filter is per-caller, not a constant) |
| Owner, no membership row | `asn-A`, `asn-B` |
| `team.view` holder with no visible projects | `200` with `[]`, not 403 (§38) |
| tenant-B caller | `[]` (§39) |

## F. Timesheet filtering

| Caller | Result |
|---|---|
| member of A | `ts-A` only |
| member of A, response scanned | contains neither `ts-B` nor its 10 hours |
| Owner | `ts-A`, `ts-B` |

The hours assertion is separate from the row assertion on purpose: a filtered
list that still reported a total would leak the same fact more quietly.

## G. Member-keyed counts and aggregates

The predicate goes on the **LEFT JOIN**, not the WHERE — so an unauthorized
assignment fails to join while the member row survives (§4, §22):

| Caller | `activeProjects` | `totalAllocation` |
|---|---|---|
| member of A | **1** | **50** |
| Owner | **2** | 100 |

Jane remains visible at `200` to a caller who can see none of her projects.
`listMembers` carries the identical predicate, so the roster and the detail
cannot disagree.

## H. `document_folders` policy evidence

```text
DUAL_PROJECT_OR_TENANT
```

- migration 003: `project_id UUID REFERENCES projects(id) ON DELETE CASCADE` —
  nullable, and CASCADE, so a project folder dies with its project while a
  project-less folder does not belong to one at all;
- `files.ts:471` creates folders with `project_id ?? null`;
- the create route is guarded by `requireBodyProjectScope`, which Phase 3D
  documents as treating the field as OPTIONAL on purpose, naming *a
  tenant-level folder* as its example.

Same evidence shape that made `documents` dual in Phase 3E-R. The ratchet
requires the evidence string to point at the **creation path** (`?? null`),
not merely at column nullability — a column can be nullable by migration
history alone.

**The `doc_count` subquery carries the same predicate** (§19): a folder the
caller may see must not report how many documents it holds in a project they
may not.

## I. `source_uploads` policy evidence

```text
DUAL_PROJECT_OR_TENANT
```

- migration 006: `project_id UUID REFERENCES projects(id) ON DELETE SET NULL`
  — **SET NULL**, not CASCADE, so an upload *outlives* the project it was
  filed against;
- `commissioning.ts:90` inserts `projectId ?? null`, so an upload staged
  before a project is chosen is an intended state;
- the same file creates `commissioning_packs` with `projectId ?? null`, and
  Phase 3E-R already classified packs dual on that evidence — uploads are the
  staging input to that same workflow.

| Caller | Result |
|---|---|
| member of A | `up-G` (global) + `up-A` |
| member of B | `up-G` + `up-B` |
| tenant-A caller | never `up-C` |

Predicate applied before `LIMIT` (asserted, comments stripped first).

## J. `action_relations` — no policy required

**The premise was wrong, and this is the finding I would most want reviewed.**

§15–§18 assumed `/ops/readiness` returns `action_relations` rows and asked me
to derive a relation ownership model, with §17 standing by to declare a
contradiction if relations span two projects. Neither was necessary.

The handler's outer query is `SELECT id, name FROM projects … LIMIT 20`, and
it then computes a readiness score per project. Phase 3F reported
`action_relations` because `computeReadiness` reaches that table one service
level down, in `_fetchEntityMetrics`. **The caller receives projects.**

So the route takes the membership predicate `GET /projects` has carried since
Phase 3B, applied before the `LIMIT 20` — twenty *authorized* projects rather
than twenty tenant projects with holes cut in them. No `action_relations`
policy was invented, and the ratchet asserts `policyFor('action_relations')`
stays `null` so a later slice cannot quietly add one on this route's account.

For completeness, the DDL that would have governed such a model: both
`source_action_id` and `target_action_id` are `NOT NULL REFERENCES actions`,
and `actions` is `SELF_SCOPED` — so a relation's authority is the ownership
of its endpoint actions, not a project. That question is still open for any
route that genuinely returns relations; none in this slice does.

| Caller | `/ops/readiness` |
|---|---|
| member of A | project A only |
| Owner | A and B, never C |
| `procurement` (has `project.view`, lacks `quality.view`) | **403**, before any row scope |

## K. Collection unresolved-data audit

All thirteen traced to handler and one service level down; verdicts in
`UNRESOLVED_COLLECTION_AUDIT`.

```text
SERVICE_OR_PLATFORM ....... 8
PROJECT_BOUND_COLLECTION .. 2   (one closed here, one holder-neutral)
TENANT_GLOBAL ............. 1
NON_PROJECT ............... 1
DEFERRED_SCOPE_MODEL ...... 1
                           ──
                           13
COLLECTION_DATA_ACCESS_UNEXPLAINED = 0
```

The eight platform surfaces issue **no SQL at all** — `getAllAgents()` returns
`[...AGENT_REGISTRY]`, `listRegisteredHandlers()` returns
`Array.from(_handlers.keys())` — which is precisely why no table resolved.
The absence of a resolved table is the correct answer there, not an unknown.

`/api/v1/portfolio/conflicts` compares peak periods **across** projects, so it
is project-bound by construction; `portfolio.view` is Owner-only, so it is
holder-neutral and held to that by the assertion in V.

`/api/v1/ops/live-feed` is the deferral: `realtime_event_log` carries
`subscription_scope` plus a free-text `scope_id`, both caller-chosen, with no
foreign key — structurally the same gap as `operational_twins`.
`crossdomain.read` is Owner-only today, so nothing is presently exposed that
the Owner could not already reach; the deferral is about the model.

## L. Newly discovered project collections

**One, and it was a real leak.** `GET /api/v1/agent-actions/_stats` runs five
aggregates over `agent_actions` sharing one WHERE clause. The extractor missed
it because the service arrives through a renamed import
(`stats as actionStats`).

`ai.govern` is held by the **platform administrator** as well as the Owner,
and an administrator has no tenant-wide project scope (§42) — so those
rollups really were counting every project in the tenant for them. This is
*not* holder-neutral, and it is now scoped. The predicate goes on the shared
WHERE, so no aggregate can be left behind while its siblings move.

## M. Canonical collection helper changes

None. `collectionScopeSql` / `collectionScopeParams` were used exactly as
Phase 3F built them (§34); no member-keyed or unpolicied variant was created,
and no route runs its own membership SQL — the ratchet asserts the absence of
`FROM project_members` in all three member routes.

Two policies were added to the existing registry; no second registry exists.

## N. Direct-ID classifier defect and repair

Phase 3F recorded the defect as residual AL.4 and left it, because fixing it
would have moved Phase-3E counters mid-slice.

```text
before   projectBound = writeTables ∪ reads reaches a project
after    a READ  → primaryReadTable (outer FROM, paren depth 0)
         a WRITE → unchanged
```

`GET /vendors/:id` selects `FROM vendors` and JOINs purchase orders for a
count; merged `reads` let the JOIN decide, so a tenant vendor registry looked
like a project child. Writes keep the old test deliberately: a write has no
outer SELECT to read a primary entity from, and narrowing that branch would
silently move counters Phase 3D certified — asserted at **182/174**, unchanged.

The same repair corrects `primaryTable` for reads generally, which had
disagreed with the real outer FROM on **20 collections**.

One distinction the ratchet pins explicitly: for a sub-collection route such
as `GET /knowledge/sources/:id/chunks`, `primaryReadTable` is
`knowledge_chunks` — the honest description of the rows returned — while the
**guard** scopes `knowledge_sources`, the record the path names. Collapsing
the two would look up a source id in a table that has never seen it and refuse
every caller.

## O. Full direct-ID reconciliation

```text
direct-ID reads (all) ......... 132
  project-bound ................ 60   (63 before the repair)
    protected .................. 55
    open ........................ 5
  non-project / tenant-global .. 72
DIRECT_ID_CLASSIFICATION_UNEXPLAINED = 0
```

Two left the project-bound set as false positives — `GET /vendors/:id` and
`GET /portfolio/readiness/:scopeType/:scopeId` (its outer FROM is
`operational_forecasts`, `NO_PROJECT_PARENT`). Three more left because their
outer FROM is `team_members`; two of those re-entered at new line numbers
after being scoped, which is why the net is −3.

The five that stay open, pinned by name:

| Endpoint | Why |
|---|---|
| `GET /actions/:id` | `requireActionAccess` — assignee or `personal.admin`, narrower than membership |
| `GET /actions/:id/relationships` | same, on the parent action |
| `GET /actions/:id/timeline` | same |
| `GET /ask/sessions/:id` | query carries `user_id = $2` |
| `GET /scenarios/projection/:twinId` | `operational_twins`, carried forward (§32) |

## P. Newly discovered direct-ID closure

**None required.** §30 asks that a newly derivable known-id bypass be closed
in this slice; the re-audit found none. Every remaining open route is a
personal record with a narrower guard, or the twin gap. The ratchet asserts
each still carries its ownership rule, so "open" cannot decay into "unguarded".

## Q / R. Same-tenant and cross-tenant isolation

Same-tenant isolation is the mirror-image evidence in E, F, H, I and J. The
Owner reaches everything in their own tenant without a membership row and
nothing outside it: `/ops/readiness` returns A and B, never C; the uploads
list never returns `up-C` to a tenant-A caller; a tenant-B caller gets `[]`
from a tenant-A member id.

## S. Membership revocation

| Step | Result |
|---|---|
| Owner lists assignments | `asn-A`, `asn-B` |
| member of A lists | `asn-A` |
| Project-A membership closed, **same token** | `[]` |
| the member themself | still `200` — only the rows changed |
| folders before revocation | `fd-A`, `fd-G` |
| folders after revocation | **`fd-G`** |

The folder pair is the load-bearing dual assertion: the global folder never
depended on a membership, so revocation must not take it away.

## T. Functional capability revocation

`project_manager` lists assignments at `200`; the stored role changes to
`engineer` (no `team.view`) and the next request with the same token is
**403**. No stale role cache.

## U. SELF non-regression

Seven SELF collections keep no project predicate, `policyFor('action')`
remains `SELF_SCOPED`, and `collectionScopeSql` still returns `AND FALSE` for
a SELF resource rather than trusting call sites. Personal Inbox suites pass
unmodified.

## V. Holder-neutral aggregate non-regression

All 19 preserved — and the assertion was **strengthened**, because mutant J
proved the Phase-3F version too weak. It compared capability *names* against a
hard-coded list, so granting `portfolio.view` to the platform administrator
left it passing. It now computes
`holders(every declared capability) ⊆ holders(project.list.all)` from
`SERVER_ROLE_CAPS`, with a non-vacuity check on both sides. Mutant J now fails.

## W. Query, count, pagination and cache analysis

```text
CACHE: N/A
```

None of the five families uses an HTTP, Redis or in-process response cache, so
§46 does not arise.

```text
member assignments   principal 1 + data 1                        = 2
member detail        principal 1 + data 1 (predicate on the JOIN) = 2
member timesheets    principal 1 + data 1                        = 2
uploads / folders    principal 1 + data 1                        = 2
ops/readiness        principal 1 + projects 1 + per-project metrics
agent-action stats   principal 1 + 5 aggregates, one shared WHERE
tenant-wide caller   predicate is '' — no extra round trip
```

No per-row `canAccessProject()` anywhere (§36). Every predicate is one
`EXISTS` inside the query, so cost is independent of result size. Ordering is
asserted for the routes that paginate: predicate before `LIMIT`.

## X. Side-effect audit

All five are `GET`s and none performs a durable write. `/ops/readiness` calls
`computeReadiness`, which reads only — the `persistReadinessScore` upsert
Phase 3E found lives on the `/readiness/*` detail routes and is unchanged, and
those were already scoped in Phase 3E.

## Y. Phase-3 counters

```text
TOTAL EXTRACTOR ROWS ......... 765     CANONICAL ENDPOINT TOTAL ..... 747
EXTRACTOR-ONLY SAML ............. 9     extraction anomalies ........... 0

PROJECT-BOUND ENDPOINTS ....... 350    (353 before the classifier repair)

COLLECTIONS   candidates 108   protected 82   remaining 26
              SELF 7   holder-neutral aggregate 19   model-deferred 0
              unexplained 0
DIRECT-ID     candidates  60   protected 55   open 5   unexplained 0
MUTATIONS     candidates 182   record-scoped 174
CONSEQUENTIAL             31   record-scoped  31

UNRESOLVED_DATA_ACCESS  31   collection intersections 13 (all dispositioned)

RECORD_SCOPE  candidates 350   protected 311   deferred 39   unexplained 0
RECORD_SCOPE_PROTECTED_AT_THIS_COMMIT ......................... 315
```

Movement against the certified parent:

```text
collections protected ...... 79 → 82
endpoints enforcing scope . 308 → 315
direct-ID candidates ........ 63 → 60   (classifier repair)
direct-ID protected ......... 53 → 55
mutations ................. 182 / 174   unchanged
```

`MEMBER_KEYED_UNFINISHED = 0`. `UNPOLICIED_COLLECTIONS = 0`.

## Z. Phase-2 census non-regression

```text
PENDING_PHASE2 0   UNCLASSIFIED 0   anomalies 0
SAML: 9 declarations / 18 mounted rows / project-bound 0 — unchanged
```

## AA. Holder comparison

```text
HOLDER DELTA = 0   (byte-identical to 04b2e6d)
```

## AB. Regression suites

```text
ENTRY   tsc / typecheck:modules pass; 217 files, 7837 tests, 0 failed
EXIT    219 files, 7886 tests, 0 failed
        Phase-3G ratchet     29 tests
        Phase-3G behaviour   20 tests
```

Phase 3B/3C/3D/3E/3E-R/3F suites pass **unmodified** except for pins that
exist to be moved: the adoption count (308 → 315), the nullable-resource split
(15 → 17 dual, for the two policies added), and the Phase-3F collection
counters (79 → 82, deferred 3 → 0). Two Phase-3F assertions were corrected
rather than repinned — a COUNT-scope regex that matched only one spelling of a
predicate variable name, and the holder-neutrality check in V.

## AC. Mutation proof

Each planted independently and reverted; `api/authz/capabilities.ts` verified
byte-unchanged afterwards.

| Mutant | Change | Result |
|---|---|---|
| **A** | assignment row scope removed | **RED** — 4 failed |
| **B** | timesheet row scope removed | **RED** — 2 failed |
| **C** | member aggregate un-scoped (JOIN predicate dropped) | **RED** — 3 failed |
| **D** | `document_folders` forced `TENANT_GLOBAL` | **RED** — 1 failed |
| **E** | `source_uploads` scope removed | **RED** — 3 failed |
| **F** | `/ops/readiness` scope removed | **RED** — 2 failed |
| **G** | direct-ID classifier reverted to merged `reads` | **RED** — 1 failed |
| **H** | newly discovered agent-actions rollup un-scoped | **RED** — 1 failed |
| **I** | SELF guard disabled in `collectionScopeSql` | **RED** — 1 failed |
| **J** | `portfolio.view` granted to the platform administrator | **RED** — 1 failed |

**Two survived their first run and are recorded as such.** Mutant I was
initially paired with suites that do not hold that invariant — the Phase-3F
ratchet does, and it fails. Mutant J survived a genuinely weak assertion,
which is now computed rather than listed (V). A mutation test that only ever
confirms what you expected has not been run.

## AD. Extractor regression

Phase-3C/3D/3F hardening intact: balanced route parsing, multi-router
attribution, intra-file sub-routers, indirect guards, capability detection,
record-scope detection, body-project detection, `readsFrom` / `primaryReadTable`
paren-depth parsing, `UNRESOLVED_DATA_ACCESS`. Anomalies 0, no silent drops.
The census twin in `helpers/endpointCensus.ts` needed no change this slice.

## AE. Three-run inventory determinism

```text
entry (04b2e6d)  6e105e62…  ×3
exit  (dd734a6)  36c3c8a3…  ×3
3/3 BYTE-IDENTICAL
```

No generated evidence was hand-edited. The inventory stamps the product
commit; the evidence commit that carries it is its child and changes no
product source — the convention since Phase 3D.

## AF. One final full-suite result

```text
Test Files  219 passed (219)
     Tests  7886 passed (7886)
    Failed  0     Skipped  0     Duration  17.67s
```

No host pollution. No five-run campaign; none claimed.

## AG. Static / build / security / lint

```text
tsc --noEmit 0 errors   typecheck:modules 0 errors   build ✓ 409ms   diff --check clean
security gate: scan_secrets CLEAN, validate_claude_agents PASS — HOLD CLEAR 🟢
eslint over 17 changed/new files: 0 errors, 0 warnings
```

One warning appeared and was fixed at its source: scoping `listTimesheets`
made a file-level `eslint-disable @typescript-eslint/no-unused-vars` stale, so
the directive was removed rather than left suppressing nothing.
`package-lock.json` unchanged.

## AH. Migration status

No migration written or applied. 085 and 086 untouched. Deployment dependency
unchanged and now covering seven more endpoints:

```text
086 MUST APPLY BEFORE OR ATOMICALLY WITH PHASE-3B+ RUNTIME CODE
```

Shipping runtime ahead of the migration fails closed — non-Owners get empty
collections rather than foreign rows.

## AI / AJ / AK. SAML, twin model, download token — unchanged

SAML untouched. The four twin-keyed routes are carried forward; the classifier
is now *accurate* about one of them (`/portfolio/readiness/:scopeType/:scopeId`
reads `operational_forecasts`, `NO_PROJECT_PARENT`) but no twin parent was
invented, and `policyFor('operational_twins')` is asserted `null`.
`GET /files/download/:token` is unchanged.

## AL. Residual risks

1. **`GET /ops/live-feed` remains unscoped for want of a scope model.**
   Owner-only today, so nothing is exposed that the Owner could not already
   reach — but it is the same polymorphic-key gap as the twins, and the two
   should be solved together.

2. **Nineteen aggregates rest on Owner-only grants.** Now genuinely
   ratchet-enforced (V), so widening a grant breaks the build rather than the
   boundary. Still a claim about grants, not a predicate.

3. **`ai.govern` reaches the platform administrator.** `/agent-actions/_stats`
   is fixed, but that capability sits on other AI-governance routes; a targeted
   pass over everything `ai.govern` opens would be worth one bounded slice,
   since the administrator/Owner asymmetry is exactly what hid this leak.

4. **Thirteen collections still resolve no table** (K). Eight provably issue no
   SQL; the rest are dispositioned. `resolvedVia: 'UNRESOLVED'` remains a
   coarse signal — a service reached through a renamed import looks identical
   to one that queries nothing, which is how the agent-actions rollup hid.

5. **Sub-collection routes rely on the guard, not on `primaryReadTable`.** The
   two now describe different things by design (N). The ratchet pins the one
   case; a broader sweep confirming every sub-collection guard names the parent
   would be cheap insurance.

6. Unchanged: the twin scope model; the download-token window; the temporary
   Owner-only `crossdomain` policy; the SAML census gap; full-repo determinism;
   migrations 085/086 unapplied.

## AM. Recommendation

```text
NEXT:
ADR-014 PHASE 3H — POLYMORPHIC SCOPE-KEY POLICY
  operational_twins  +  realtime_event_log
```

§75 expected the twins, and the reconciled evidence now agrees — with one
correction: it is **five** routes, not four. `/ops/live-feed` joined the set
this slice, and it shares the exact structural gap: a caller-chosen scope kind
plus a free-text id, no foreign key, several entity kinds that have no project
at all. Solving them apart would mean deciding the same question twice.

That is also, on the final numbers, the largest coherent remaining risk. Every
other project-bound surface is either scoped or resting on an Owner-only grant
that the ratchet now enforces.

Sequence: (a) the polymorphic scope-key policy across both tables,
(b) the `ai.govern` sweep from AL.3, (c) the sub-collection guard sweep from
AL.5. None of these is large; the authorization rollout is close to done.

---

*Phase-3G completion evidence. A pushed branch and this report are not
promotion authorization. No PR was opened, nothing was merged, tagged,
released or deployed, and no owner database migration was applied.*
