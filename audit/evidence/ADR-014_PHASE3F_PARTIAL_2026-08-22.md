# BUILDER COMPLETION REPORT — jarvis-epc — ADR-014 PHASE 3F

## A. Verdict

```text
ADR-014 PHASE 3F: PARTIAL

DERIVABLE PROJECT-BOUND COLLECTIONS ........ CLOSED
DEFERRED_SCOPE_MODEL ....................... 3
HOLDER-NEUTRAL AGGREGATES (§70) ............ 19
SELF-SCOPED COLLECTIONS (§28) .............. 7
COLLECTION_UNEXPLAINED ..................... 0
RECORD_SCOPE_UNEXPLAINED ................... 0
PROMOTION .................................. NOT AUTHORIZED
```

Sub-verdicts:

```text
PROJECT-BOUND COLLECTION INVENTORY ............ CLOSED (108/108 dispositioned)
PROJECT-PATH COLLECTION ISOLATION ............. PROVED
TENANT-WIDE COLLECTION ISOLATION .............. PROVED
DUAL PROJECT / TENANT COLLECTION POLICY ....... PROVED
COLLECTION AGGREGATE SIDE-CHANNEL ............. CLOSED where scoped; 19 holder-neutral
COUNT / DATA SCOPE CONSISTENCY ................ PROVED
AUTHORIZATION-BEFORE-PAGINATION ............... PROVED
QUERY PROJECT FILTER CANNOT WIDEN SCOPE ....... PROVED
SEARCH RESULT SCOPE ........................... N/A (no search endpoint in the set)
MEMBER-KEYED PROJECT-ROW FILTERING ............ NOT DONE — see AL.2
LIVE MEMBERSHIP REVOCATION — COLLECTIONS ...... PROVED
LIVE FUNCTIONAL CAPABILITY REVOCATION ......... PROVED
SELF-SCOPED COLLECTIONS ....................... PRESERVED
PHASE-3D MUTATION CONTROLS .................... PRESERVED
PHASE-3E DIRECT-ID CONTROLS ................... PRESERVED
PHASE-3E-R DUAL SEMANTICS ..................... PRESERVED
CAPABILITY HOLDER DELTA ....................... 0
PENDING_PHASE2 ................................ 0
UNCLASSIFIED .................................. 0
INVENTORY DETERMINISM ......................... PROVED (3/3, entry and exit)
```

Separately:

```text
FULL-REPO DETERMINISM:
NOT IN SCOPE — SEPARATE QUALIFICATION GATE
```

**The verdict is PARTIAL for two reasons, and they are different in kind.**
Three collections have no derivable scope model — the §95 condition. The
member-keyed routes §19–§21 made mandatory were **not implemented**; that is
scope I did not complete, not a model gap, and it is stated as such in AL.2
rather than folded into the deferral count.

## B. Repository provenance

```text
repository root ...... /Users/rommelaguillon/Local Documents/Claude/Production/Denver Engineering
remote ............... https://github.com/ral197979/jarvis-epc.git
owner/repo ........... ral197979/jarvis-epc

certified parent ..... 8a107ef9abe94cdcd4f29b8afaf56e4f71bd8d07
  git cat-file -t .... commit
  remote contains .... origin/security/adr-014-phase3er-nullable-project-scope

branch ............... security/adr-014-phase3f-collection-scope
product commit ....... 3eee4e5cd7f5542ddd57551fd457c1ff0acf1d89
evidence commit ...... this commit (a commit cannot carry its own hash;
                       resolve with `git rev-parse HEAD` on the branch below)
final SHA ............ = the evidence commit = branch tip of
                       security/adr-014-phase3f-collection-scope
origin/main .......... f5883c31c1205a113ec4909437449d0a84381d34  (untouched)

tracked tree ......... clean at final SHA
stashes .............. 2, both preserved, neither touched
worktrees ............ 1
unrelated evidence ... 27 pre-existing untracked audit/evidence/*.md preserved
```

## C. Entry collection inventory

The certified parent reproduced its stated numbers exactly, and entry
determinism was 3/3 (`70c2bc30…`):

```text
TOTAL EXTRACTOR ROWS .... 765     PROJECT-BOUND ......... 302
COLLECTIONS ............. 58      protected .............. 7      deferred ... 51
DIRECT-ID protected ..... 53      MUTATIONS scoped ...... 171
RECORD_SCOPE_UNEXPLAINED . 0      UNRESOLVED ............. 33
```

So the §3 entry gate passed. **The 51 were not the whole problem**, which §3
anticipated by forbidding me to force the number if a demonstrated correction
changed the denominator. It did:

```text
collection candidates ....  58 → 108
project-bound endpoints .. 302 → 353
```

## D. Collection classifier methodology

§4 says the returned rows decide, not the path shape. The extractor could not
express that: `reads` was a flat set merging `FROM` and `JOIN`, so
`GET /vendors` — which joins `projects` for a display name — was
indistinguishable from a project collection.

Three defects were fixed in the canonical extractor (§56), each pinned by the
Phase-3F ratchet so it cannot silently return:

| # | Defect | Effect | Fix |
|---|---|---|---|
| 1 | No rule for a collection with **no path parameter** whose rows reach a project | 49 collections fell into a `NO_PROJECT_PARENT` catch-all whose stated reason — "tables resolved, and none of them reaches a project" — was **false** for them | New ordered rule `PROJECT_CHILD_TENANT_COLLECTION`, above `TENANT_GLOBAL`, reads-only so Phase-3D mutation counters cannot shift |
| 2 | `handlersFor` keyed by `METHOD routePath` | `procurement.ts` declares four routers each serving `GET /`; the last parsed won, so `GET /vendors` was reported as reading `submittals` | Keyed by **declaration line** (`stripComments` preserves newlines), with the old map kept as a fallback |
| 3 | Path-project rule anchored to `/projects/:projectId/` | The four `/schedule/:projectId/*` collections — and three sibling mutations — were never project-bound | Rule now matches a `projectId` path parameter wherever it appears |

`primaryReadTable` is the outer query's `FROM`, in source order, with nested
FROMs excluded by **paren depth from the enclosing SQL literal**. Two earlier
heuristics were tried and rejected against real queries:

```sql
SELECT t.*, (SELECT count(*) FROM transmittal_items …) FROM transmittals t
SELECT v.*, (SELECT count(*) FROM purchase_orders …)   FROM vendors v
```

"First FROM wins" reports `transmittal_items` and `purchase_orders`; "nearest
preceding SELECT is parenthesised" fixes vendors and breaks transmittals. Only
depth gets both right, and the ratchet asserts both by name.

## E. Collection shape ledger

All 108 carry exactly one disposition, in `COLLECTION_SCOPE_ADOPTION`.

```text
PATH_PROJECT_COLLECTION ............... 63
TENANT_COLLECTION_PROJECT_ROWS ........ 45
                                       ───
                                       108

PROTECTED_PHASE3B ......................  3   (projects, rfis, submittals)
PROTECTED_PHASE3F ...................... 76
SELF_SCOPED_COLLECTION .................  7
PROJECT_AGGREGATE (holder-neutral) ..... 19
DEFERRED_SCOPE_MODEL ...................  3
                                        ───
                                        108
COLLECTION_UNEXPLAINED .................  0
```

### Closed — 79

- **63 path-project** (`/projects/:projectId/*`, `/copilot/projects/:projectId/*`,
  `/schedule/:projectId/*`): `requireProjectScope()` beside the existing
  capability.
- **13 tenant-wide**: `collectionScopeSql` — documents, compliance tasks,
  knowledge sources, knowledge fixes, the symptoms facet, the embed-status
  aggregate, purchase orders, transmittals (list + overdue), commissioning
  baselines, autosign rules and packs, MCP sessions.
- **3 already closed by Phase 3B**: `/projects`, `/rfis`, `/submittals`.

### SELF_SCOPED_COLLECTION — 7 (§28)

`/actions`, `/actions/my`, `/actions/summary`, `/actions/overdue`,
`/actions/analytics/overview`, `/actions/analytics/workload`, `/ask/sessions`.

The `action` resource is `SELF_SCOPED` in the registry — Phase 2C-4A made an
action a personal record owned by its assignee. Filtering by project membership
would show a peer's queue to anyone sharing a project with them, which is why
`collectionScopeSql` returns `AND FALSE` for a SELF resource rather than
trusting call sites (mutants F and I).

### PROJECT_AGGREGATE — 19 (§70)

Six `/executive/*`, four `/copilot/*` portfolio rollups, four `/ops/*`,
`/portfolio/bottlenecks`, `/predict/portfolio`, `/agent-actions`, `/estimates`,
`/monte-carlo/runs`.

Every declared capability on these is Owner-only — `portfolio.view`,
`crossdomain.read`, `personal.admin`, `cost.view` — and the Owner is tenant-wide
by `project.list.all`. **The predicate would change no caller's result today.**
Recorded rather than skipped, and the ratchet asserts the claim: if any of these
is granted to a second role, the holder-neutrality test fails rather than the gap
staying quietly open.

### DEFERRED_SCOPE_MODEL — 3 (§95)

| Endpoint | Rows | Capability | Why not derivable | Next requirement |
|---|---|---|---|---|
| `GET /commissioning/uploads` | `source_uploads` | `commissioning.view` | No record-scope policy; the table's project relationship is undecided | A policy for the upload staging table |
| `GET /files/folders` | `document_folders` | `docs.view` | No policy; folders may be tenant-level containers, project containers, or both — the same dual question Phase 3E-R answered for documents | A folder scope policy, most likely `DUAL_PROJECT_OR_TENANT` |
| `GET /ops/readiness` | `action_relations` | `project.view` + `quality.view` | No policy for the relation graph, and unlike its four `/ops` siblings this route **is** reachable by more than the Owner, so a guessed predicate would really change results | A scope policy for `action_relations` |

Neither defaults open: all three remain tenant-bounded and capability-gated.

## F. `UNRESOLVED_DATA_ACCESS`

```text
total ................................ 31   (was 33 — the multi-router fix resolved 2)
collection intersections ............. 13
resolved by this slice ................ 2
deferred ............................. 13
```

Thirteen collections resolve **no table at all**, so their project relationship
is unknown rather than absent; they are not in the project-bound set and are not
counted as closed. The two resolved are the vendor routes the router-collision
fix repaired.

## G. Canonical collection-scope implementation

One helper, in the canonical module — no parallel membership truth (§38):

```ts
collectionScopeSql(principal, resource, projectColumn, userParam): string
collectionScopeParams(principal, resource): unknown[]
```

Driven by the resource's own `projectSemantics` (§39):

```text
PROJECT_REQUIRED        AND EXISTS (active member of <col>)
DUAL_PROJECT_OR_TENANT  AND (<col> IS NULL OR EXISTS (…))
TENANT_GLOBAL           ''
SELF_SCOPED             AND FALSE
no policy               AND FALSE
tenant-wide principal   ''
```

Two design points worth stating:

- **Correlated on the child's own `project_id`, not on `projects.p`.** The
  Phase-3B predicate correlates on a joined `projects` row, which a DUAL
  collection cannot use: an inner join drops exactly the tenant-global rows
  Phase 3E-R restored, and an outer join would need adding just to authorize.
- **`collectionScopeParams` probes before binding.** The empty predicate binds
  nothing and so does `AND FALSE`; binding a principal id for a fail-closed
  resource would shift every later placeholder by one.

`projectColumn` is always a literal from the route's own query; caller input
never reaches statement text, and ids stay bound parameters (§40).

## H. Path-project collections

`requireProjectScope()` on all 63, beside the capability that was already there.

**The guard alone is not enough (§10/§11)**, and the ratchet enforces both
halves separately: the guard proves the caller can reach project A and says
nothing about which project the handler then selects. Of the 63, **13** carry a
SQL `project_id = $n` predicate and **49** pass `:projectId` into the service
that builds the query.

One exception is named rather than hidden:
`GET /projects/:projectId/inspection-templates` returns **tenant-level**
templates — `inspection_templates` is `NO_PROJECT_PARENT` — so the path project
is context, and there is nothing to constrain the rows to. The guard is still
correct; the row assertion is skipped by name.

The first version of that assertion matched the bare string `project_id` and
**mutant G survived it**, because every one of these routes has `:projectId` in
its declared path. It now requires a SQL comparison or a service argument, and
mutant G fails.

## I. Tenant-wide project collections

Thirteen collections take the predicate **in SQL**, before serialization (§12,
§13). No route filters in application memory, and none filters in the client.

## J. Dual project/tenant collections

Nine of the thirteen return a `DUAL_PROJECT_OR_TENANT` resource, so a
project-less row is tenant-global and stays visible while a project row needs
membership. Proved end to end for `compliance_tasks`:

| Caller | Result |
|---|---|
| member of A | `a1, a2, g1` |
| member of B | `b1, b2, b3, g1` |
| Owner, no membership row | all six tenant rows |
| holder with no memberships at all | `g1` only |

The mirror-image pair is what proves the filter is per-caller rather than a
constant, and the global row appearing for all four is what proves Phase 3E-R
was not undone.

## K. Member-keyed assignments — NOT DONE

## L. Member-keyed timesheets — NOT DONE

`GET /team/members/:id/assignments` and `GET /team/members/:memberId/timesheets`
were **not implemented**, and §19–§21 made them mandatory. Stated plainly rather
than reclassified: this is unfinished scope, not a model gap.

Why they are hard, and what remains true meanwhile: the path id is a
`team_members` id, which is `NO_PROJECT_PARENT`, so — exactly as §19 says —
`requireRecordScope('team_members')` must not be added to make a counter green.
The rows must be filtered instead, and the outer record must stay visible while
its project-bound rows are filtered (§22). Both routes remain behind `team.view`
(owner, project_manager) and the tenant boundary. A `team.view` holder can still
enumerate one member's assignments and timesheets across projects they are not
in. The helper this needs now exists; the work is applying it to two service
queries and their totals.

## M. FK-parent collections

`GET /knowledge/embed-status` aggregates `knowledge_chunks`, whose project comes
through `source_id`. Scoped by a **single JOIN** to `knowledge_sources` with the
predicate on `s.project_id` — not a lookup per row (§37) — and the DUAL
semantics keep chunks of the tenant corpus counted.

## N. Aggregates

`GET /knowledge/embed-status` and `GET /knowledge-fixes/_meta/symptoms` are
scoped inside the aggregate query, so `total`/`embedded`/`pending` and the facet
options describe only visible rows (§16, §52). The remaining 19 aggregates are
the holder-neutral set in E.

## O. Counts and pagination

Every scoped route with a separate COUNT applies the **same** predicate to it,
asserted per statement rather than per COUNT (an aggregate query may carry three
COUNTs under one predicate):

| Caller | rows | total |
|---|---|---|
| member of A | 3 | **3** |
| member of B | 4 | **4** |

Pagination is proved with hidden rows **interleaved in sort order**
(`b1, a1, b2, g1, a2, b3`). A caller scoped to A asking for `limit=2` gets
`a1, g1` — a full page — where post-filtering a tenant page would have returned
one row. Page 2 returns `a2`.

## P. Project query filters

| Request (caller is a member of A only) | Result |
|---|---|
| no filter | `a1, a2, g1` |
| `?project_id=A` | `a1, a2` |
| `?project_id=B` | `200` with **zero rows**, `total: 0` |
| `?project_id=C` (other tenant) | zero rows |

The predicate is ANDed **outside** the caller's filters, so a project filter
intersects with authorization and can only narrow (§30). Asking for a foreign
project returns an empty page rather than a 403 that would confirm it exists.

## Q. Search / ranking

```text
SEARCH: N/A
```

No search endpoint appears in the project-bound collection set. `?search=`
parameters on `/files/documents` and `/purchase-orders` are ordinary filters
inside the authorization envelope, not a separate ranked surface.

## R / S. Same-tenant and cross-tenant isolation

Same-tenant isolation is the table in J. Cross-tenant: a tenant-A caller never
receives `c1`; a tenant-B caller receives `c1` and nothing else — the
non-vacuity check that the first result is about the tenant and not about the
row being unreachable by everyone.

## T. Membership revocation

| Step | Result |
|---|---|
| member of A lists | `a1, a2, g1` |
| membership closed, **same token** | `g1` |
| reopened | `a1, a2, g1` |

The project rows go and the tenant-global row stays — load-bearing for the dual
model, because that row never depended on a membership.

## U. Functional capability revocation

`project_manager` lists; the stored role changes to `engineer` (no `safety.view`)
and the next request with the same token is **403** — the functional dimension,
before any row scope. `field_ops`, which does hold `safety.view`, is admitted and
still scoped to `a1, a2, g1`, so membership never grants the capability and the
capability never grants the rows (§69).

## V. SELF / non-project corrections

Seven SELF collections preserved (E). `GET /vendors` is now correctly non-project
— it selects FROM `vendors` — and the vendor **mutations** are non-project too,
which makes the extractor agree mechanically with a correction Phase 3D had to
record as prose.

## W. Query, cache and performance

```text
CACHE: N/A
```

None of the affected families uses an HTTP, Redis or in-process response cache,
so §46/§47 do not arise; scope is re-resolved per request from live state.

```text
path-project collection    principal 1 + membership 1 + data 1              = 3
tenant collection (dual)   principal 1 + data 1 + count 1                   = 3
FK-parent aggregate        principal 1 + aggregate 1 (single JOIN)          = 2
tenant-wide principal      predicate is '' — no membership round trip
```

**No per-row authorization anywhere**: the predicate is one `EXISTS` inside the
collection query, so cost is independent of page size (§48).

## X. Collection side-effect audit

No collection GET in the closed set performs a durable write. The two
derived-cache upserts Phase 3E found (`readiness_scores`,
`operational_forecasts`) are on direct-ID and twin routes, not collections, and
are unchanged.

## Y. Final Phase-3 counters

```text
TOTAL EXTRACTOR ROWS ......... 765     CANONICAL ENDPOINT TOTAL ..... 747
EXTRACTOR-ONLY SAML ............. 9     extraction anomalies ........... 0

PROJECT-BOUND ENDPOINTS ....... 353    (was 302)

COLLECTIONS   candidates 108   protected 79   deferred 29
              SELF 7   aggregate 19   deferred-model 3   unexplained 0
  by shape    path-project 63          tenant-collection 45

DIRECT-ID     candidates  63   protected 53   model-deferred 2
MUTATIONS     candidates 182   record-scoped 174
CONSEQUENTIAL             31   record-scoped  31   explained 0

UNRESOLVED_DATA_ACCESS  total 31   collection intersections 13   resolved 2

RECORD_SCOPE  candidates 353   protected 306   deferred 47   unexplained 0
RECORD_SCOPE_PROTECTED_AT_THIS_COMMIT ......................... 308
```

Movement against the certified parent:

```text
collections protected ....... 7 → 79    (+72)
endpoints enforcing scope . 236 → 308   (+72)
mutations record-scoped ... 171 → 174   (+3, the hidden schedule mutations)
consequential explained ..... 1 → 0     (the vendor transition is no longer project-bound)
```

`COLLECTION_UNEXPLAINED = 0`, `RECORD_SCOPE_UNEXPLAINED = 0`.

## Z. Phase-2 census non-regression

```text
PENDING_PHASE2 0   UNCLASSIFIED 0   anomalies 0
SAML: 9 declarations / 18 mounted rows / project-bound 0 — unchanged
```

## AA. Holder comparison

```text
HOLDER DELTA = 0   (byte-identical to 8a107ef)
```

## AB. Regression suites

```text
ENTRY   tsc / typecheck:modules pass; full suite 215 files, 7792 tests, 0 failed
EXIT    full suite 217 files, 7837 tests, 0 failed
        Phase-3F ratchet    21 tests
        Phase-3F behaviour  23 tests
```

Phase-3D, 3E and 3E-R suites pass **unmodified**. Two adoption pins moved
(236 → 308), which is what they exist to force. Nineteen pre-existing suites
needed the project-scope lookup modelled or a real UUID — the same class of
fixture coupling Phase 3E found, and fixed at the source rather than by
loosening assertions. Two authorization suites were **strengthened**: a
cross-tenant project id used to reach the handler and be rebuilt in the caller's
tenant; it is now refused outright and the service never runs.

## AC. Product mutation tests

Each planted independently and reverted; all target files verified afterwards.

| Mutant | Change | Result |
|---|---|---|
| **A** tenant collection scope removed | predicate dropped from `compliance_tasks` | **RED** — 13 failed |
| **B** dual global branch removed | `IS NULL OR` dropped | **RED** — 10 failed |
| **C** dual branch opens all tenant rows | predicate emptied | **RED** — 11 failed |
| **D** count query unscoped | rows scoped, COUNT not | **RED** — 5 failed |
| **E** post-pagination filtering | predicate moved after LIMIT | **RED** — 11 failed |
| **F** SELF guard disabled | `case 'SELF_SCOPED'` renamed | **RED** — 1 failed |
| **G** path-project predicate broken | `project_id` → `tenant_id` in a handler | **RED** — 1 failed *(after the assertion was strengthened; it survived the first version)* |
| **H** capability bypass | `requireCapability` removed | **RED** — 2 failed |
| **I** SELF resource reclassified | `action` → `DUAL_PROJECT_OR_TENANT` | **RED** — 1 failed |

Mutant G is recorded honestly: it **survived** the first ratchet and exposed a
real weakness — the assertion matched the `:projectId` in the path rather than a
predicate. No mutant state is committed.

## AD. Extractor regression

Phase-3C/3D hardening intact — balanced route parsing, multi-router attribution,
intra-file sub-routers, indirect guards, capability detection, record-scope
detection, body-project detection, `UNRESOLVED_DATA_ACCESS`. Anomalies 0, no
silent drops. The census twin in `helpers/endpointCensus.ts` was updated in step
so the test-side and extractor-side scope-call lists cannot diverge.

## AE. Three-run inventory determinism

```text
entry (8a107ef)  70c2bc30…  ×3
exit  (3eee4e5)  a6dba8b3…  ×3
INVENTORY DETERMINISM: 3/3 BYTE-IDENTICAL
```

## AF. One final full-suite result

```text
Test Files  217 passed (217)
     Tests  7837 passed (7837)
    Failed  0     Skipped  0     Duration  21.85s
```

No host pollution in this run. No five-run campaign; none claimed.

## AG. Static / build / security / lint

```text
tsc --noEmit 0 errors   typecheck:modules 0 errors   build ✓ 391ms   diff --check clean
security gate: scan_secrets CLEAN, validate_claude_agents PASS — HOLD CLEAR 🟢
eslint over 72 changed/new files: 0 errors, 0 warnings
```

`package-lock.json` unchanged.

## AH. Migration status

No migration written or applied. 085 and 086 untouched; Phase 3F depends on
Phase-3B membership data, so the deployment dependency stands and now covers 72
more endpoints:

```text
086 MUST APPLY BEFORE OR ATOMICALLY WITH PHASE-3B+ RUNTIME CODE
```

Shipping runtime ahead of the migration fails closed — non-Owners get empty
collections rather than foreign rows. Safe direction, but an availability
outage.

## AI / AJ / AK. SAML, twin model, download token — unchanged

SAML untouched (Z). The four `operational_twins` routes are carried forward
exactly as Phase 3E-R left them. `GET /files/download/:token` still honours a
minted token for up to an hour after revocation; issuance stays scope-protected.

## AL. Residual risks

1. **Three collections remain unscoped for want of a policy** (E). Tenant-bounded
   and capability-gated; `/ops/readiness` is the one that matters most, being the
   only one of the three reachable by more than the Owner.

2. **The two member-keyed routes were not done** (K/L). This is the gap I would
   fix first: it is unfinished scope rather than an open question, the helper it
   needs now exists, and §19–§21 asked for it explicitly.

3. **Nineteen aggregates rest on Owner-only capabilities.** The claim is
   ratchet-checked, so widening a grant breaks the build rather than the
   boundary — but it is a claim about grants, not a predicate.

4. **The direct-ID rule still uses `reads`, not `primaryReadTable`.** Fixed here
   for collections only, because changing it would move Phase-3E counters that
   are not this slice's to move. `GET /vendors/:id` is still flagged
   project-bound because the vendor detail JOINs purchase orders; Phase 3E
   already classified it `NON_PROJECT_RESOURCE` by hand, so the ledger is right
   and the classifier is not. Worth one bounded pass.

5. **Thirteen collections resolve no table at all** (F) and sit outside the
   project-bound set. Their project relationship is unknown, not absent.

6. Unchanged: the twin scope model; the download-token window; the temporary
   Owner-only `crossdomain` policy; the SAML census gap; full-repo determinism;
   migrations 085/086 unapplied.

## AM. Recommendation

```text
NEXT:
ADR-014 PHASE 3G — MEMBER-KEYED AND UNPOLICIED COLLECTION CLOSURE
```

Not the twin model, and the final evidence is why. §97 predicted 3G would be the
twins because they would be the clearest remaining gap. They are not: this slice
left **five** collections that a non-Owner can use to read across projects — the
two member-keyed routes and the three unpolicied ones — against **four**
twin-keyed reads whose capabilities are Owner-only and therefore
holder-neutral today. The larger live exposure is the collection remainder, and
it is also the cheaper work: three scope policies, two service queries, and the
helper already exists.

Sequence: (a) the member-keyed routes, (b) policies for `document_folders`,
`source_uploads` and `action_relations`, (c) the direct-ID `primaryReadTable`
pass from AL.4, which is a correctness question about work already shipped.
Then the twin model as a separate bounded policy slice.

---

*Phase-3F completion evidence. A pushed branch and this report are not promotion
authorization. No PR was opened, nothing was merged, tagged, released or
deployed, and no owner database migration was applied.*
