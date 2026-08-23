# BUILDER COMPLETION REPORT — jarvis-epc — ADR-014 PHASE 3I

## A. Verdict

```text
ADR-014 PHASE 3I: COMPLETE

AI.GOVERN EFFECTIVE ROUTE INVENTORY ............. CLOSED
PLATFORM-ADMIN ADMISSION SET .................... RECONCILED  (48/48)

ADMIN SAFE GOVERNANCE METADATA .................. PROVED
AI PROJECT-DATA RECORD SCOPE .................... PROVED
AI POLYMORPHIC SCOPE ............................ PROVED
AI SELF-SCOPED AUTHORIZATION .................... N/A — no SELF route in the set
AI BUSINESS-CAPABILITY CONJUNCTION .............. N/A — see W

AGENT-ACTIONS ADMIN CROSS-PROJECT LEAK .......... REMAINS CLOSED
AI COLLECTION AGGREGATE SIDE-CHANNEL ............ CLOSED
AI MIXED-PAYLOAD ADMIN LEAKAGE .................. CLOSED
AI ACTOR IDENTITY ............................... LIVE-PRINCIPAL / PROVED
AI SIDE-EFFECT ORDERING ......................... PROVED

ADMIN ≠ OWNER BUSINESS AUTHORITY ................ PRESERVED
CAPABILITY HOLDER DELTA ......................... 0
AI.GOVERN HOLDER DELTA .......................... 0
CROSSDOMAIN HOLDER DELTA ........................ 0

PENDING_PHASE2 .................................. 0
UNCLASSIFIED .................................... 0
AI_GOVERN_ADMIN_ROUTE_UNEXPLAINED ............... 0
AI_GOVERN_ADMIN_UNRESOLVED_DATA_ACCESS .......... 0
RECORD_SCOPE_UNEXPLAINED ........................ 0

INVENTORY DETERMINISM ........................... PROVED (3/3 entry and exit)
PROMOTION ....................................... NOT AUTHORIZED
```

Separately:

```text
FULL-REPO DETERMINISM:
NOT IN SCOPE — SEPARATE QUALIFICATION GATE
```

**Six live exposures found and closed.** The question this slice asked — "are
there any more?" — has an answer, and it is yes: `/agent-actions/_stats` was not
the only one. It was the only *aggregate* one.

## B. Timestamps

```text
HOB GENERATED        2026-08-23 10:45:00 CAT   /  2026-08-23 08:45:00 UTC
EXECUTION STARTED    2026-08-23 10:52:45 CAT   /  2026-08-23 08:52:45 UTC
EXECUTION COMPLETED  2026-08-23 11:17:45 CAT   /  2026-08-23 09:17:45 UTC
FINAL SHA CREATED    2026-08-23 11:18 CAT      /  2026-08-23 09:18 UTC
REMOTE PUSHED        see AS / end state
```

## C. Repository provenance

```text
repository root ...... /Users/rommelaguillon/Local Documents/Claude/Production/Denver Engineering
remote ............... https://github.com/ral197979/jarvis-epc.git
owner / repo ......... ral197979 / jarvis-epc

certified parent ..... cec252f89acef4ef6f48b633a3d83d896b358d72
  git cat-file -t .... commit                              VERIFIED
  remote contains .... origin/security/adr-014-phase3h-polymorphic-scope

branch ............... security/adr-014-phase3i-ai-govern-exposure
product commit ....... 973c6ba09e9463cb0c1b2898799259fd88b45354
evidence commit ...... this commit (branch tip)
origin/main .......... untouched

tracked tree ......... clean at final SHA
stashes .............. 2, both preserved, neither touched
worktrees ............ 1
unrelated evidence ... 27 pre-existing untracked audit/evidence/*.md preserved,
                       plus the Phase-3H verification note from this session
```

## D. Entry baseline

Reproduced the certified Phase-3H state exactly, 3/3 byte-identical
(`3e47b22f…`), and it reconciles against §8 line for line:

```text
ROWS 765            PROJECT-BOUND 350
COLLECTIONS 108 protected  82      DIRECT-ID 60 protected 56  open 4
MUTATIONS   182 record-scoped 174  CONSEQUENTIAL 31/31
RECORD_SCOPE 350 / 312 / 38 / 0    ENDPOINTS ENFORCING SCOPE 321
ENTRY FULL SUITE 221 files, 7940 tests
```

## E. `ai.govern` holder matrix

Machine-derived from `SERVER_ROLE_CAPS`, not from the prior report:

```text
ai.govern holders = { owner, admin }          (unchanged at exit)
```

The whole threat model is one fact, and it is worth stating exactly:

```text
admin holds 7 capabilities:
  ai.govern  audit.view  platform.admin  platform.automation
  platform.export  platform.identity  platform.integrations

owner holds 60.

admin does NOT hold:
  crossdomain.read   crossdomain.write   project.view   project.list.all
  portfolio.view     personal.admin      cost.view      engineering.view
  quality.view       construction.view   docs.view      procurement.view
  …and 41 others
```

So on any route where `ai.govern` is the whole guard, the platform
administrator is admitted holding **no** project scope and **no** business
domain. Whatever that route returns, `ai.govern` is the authority returning it.

## F. `ai.govern` referenced-route inventory

```text
AI_GOVERN_REFERENCED_ENDPOINTS ........... 48   (all mounted)
```

| File | n |
|---|---|
| `adaptive.ts` | 15 |
| `ecosystem.ts` | 9 |
| `aiGovernance.ts` | 6 |
| `agents.ts` | 5 |
| `agentApprovals.ts` | 5 |
| `agentActionsRoutes.ts` | 2 |
| `autoCoordination.ts` | 2 |
| `optimization.ts` | 2 |
| `agentReadiness.ts` | 1 |
| `projects.ts` | 1 |

## G. Effective Admin admission set

§9 asks for the effective set, not the string-match set, so the guard formula on
every one was evaluated against the live Admin role:

```text
AI_GOVERN_ADMIN_ADMITTED_ENDPOINTS ....... 48
AI_GOVERN_ADMIN_NOT_ADMITTED_ENDPOINTS ... 0
```

**Every one of the 48 is a bare `requireCapability('ai.govern')`.** Not one uses
`requireAllCapabilities`, and `requireAnyCapability` has zero route call sites
anywhere in the repository. The single `requireRole('owner','admin')` conjunction
(`ecosystem.ts:96`) admits exactly the `ai.govern` holders, so it excludes nobody.

There is therefore no conjunction anywhere keeping Admin out of an AI route —
the §10 distinction exists in the helper library but is unused on this surface.
That is the finding behind the finding: the protection §10 anticipated was
simply never applied here.

Routes that DO exclude Admin sit next door and prove the intent existed:
`GET /ai/recommendations/:id/preview`, `GET /agents/readiness/plan/:scope/:id`
and `GET /optimization/proposals/summary` are all `crossdomain.read`.

## H. Route classification ledger

```text
ADMIN-ADMITTED ............................ 48
  safe governance metadata (tenant) ....... 24
  platform/federated governance metadata ... 9
  AI model telemetry (tenant) ............. 7
  project scoped .......................... 4
  polymorphic scoped ...................... 3
  collection scoped (Phase 3G) ............ 1
  mixed payload, now field-gated .......... 1
  SELF scoped ............................. 0
  deferred ................................ 0
  unexplained ............................. 0

AI_GOVERN_ADMIN_ROUTE_UNEXPLAINED ......... 0
AI_GOVERN_ADMIN_UNRESOLVED_DATA_ACCESS .... 0
```

The 8 routes now carrying an enforced scope call, machine-listed from the
regenerated inventory:

| Route | Scope call |
|---|---|
| `GET /agent-actions/_stats` | `collectionScopeSql` (Phase 3G) |
| `POST /agent-actions/:id/review` | `requireRecordScope` |
| `PATCH /projects/:id/agent-mode` | `requireRecordScope` |
| `POST /coordination/recommendations/:id/dismiss` | `requireRecordScope` |
| **`POST /coordination/recommendations/:id/approve`** | `requireRecordScope` **(new)** |
| **`POST /agents/plan`** | `requireBodyPolymorphicScope` **(new)** |
| **`POST /agents/execute`** | `requireBodyPolymorphicScope` **(new)** |
| **`POST /agents/readiness/coordinate`** | `requireBodyPolymorphicScope` **(new)** |

## I. Governance metadata surfaces (§13, §27, §33)

Kept Admin-wide, deliberately, after inspecting payloads rather than paths:

- **`adaptive.ts` (15)** — `learning_feedback`, `forecast_accuracy`,
  `anomaly_patterns`, `simulation_outcomes`. These are model-quality telemetry.
  `learning_feedback.source_id` is polymorphic but its `source_type` values are
  *other AI records* (recommendation, forecast, anomaly), not business entities.
- **`ecosystem.ts` federated (9)** — opt-in state, pattern publication, model
  versions, external agent registration. `createModelVersion` and
  `activateModelVersion` take no tenant at all: they are genuinely
  platform-level, which is the platform administrator's actual remit.
- **`agents.ts` GET /, /capabilities, /objectives** — the agent registry.
- **`agentApprovals.ts` list/detail/expire** — the approval queue itself.

§27 was live guidance, not a footnote: over-correcting these into
project-membership routes would have made `ai.govern` unusable for the role that
holds it. Mutant B exists to keep that honest.

## J. Project-scoped AI surfaces (§17)

`POST /coordination/recommendations/:id/approve` was the clean defect. Its
`/dismiss` sibling — same table, same router, adjacent line — already carried
`requireRecordScope('coordination_recommendations')`, and
`coordination_recommendations` is registered `PROJECT_REQUIRED` with a
`DIRECT_COLUMN` derivation. Approve had nothing.

It is also the more consequential half: `approveRecommendation` calls
`createAction(...)` with the recommendation's `project_id`, so an `ai.govern`
holder could create a real action on any project in the tenant. Now it routes
through the same canonical machinery as dismiss.

## K. Polymorphic AI surfaces (§16, §41)

`POST /agents/plan`, `POST /agents/execute` and
`POST /agents/readiness/coordinate` all take a caller-chosen `{scope, scopeId}`
(or `{scopeType, scopeId}`) pair. `OrchestratorInput` types both as bare
`string`. Nothing validated or authorized them; `orchestrate` wrote them into
the task payload, and the agent worker then resolved the named record through
`agentContextBuilder._fetchScopeMetadata` — `SELECT * FROM projects WHERE id=$1`
— with no membership test anywhere in the chain.

Closed with `requireBodyPolymorphicScope`, the body-selector twin of the
Phase-3H path guard. §41 forbids an AI-specific parent rule, so it delegates to
the **same** `twinScopePolicy` registry and the **same**
`resolvePolymorphicScope`: `project` is PROJECT_SCOPED through
`canAccessProject`, `workflow` is TENANT_GLOBAL, `action` is SELF_SCOPED.

`global` — the agent system's own catch-all `MemoryScopeType` — is deliberately
**not** a registry kind, so it denies. Verified before choosing this: no caller,
test or client sends `scope: 'global'` to any of the three routes.

The `tableMap` in `agentContextBuilder` was audited for §11 and is a trusted
literal allowlist returning `{}` on a miss — no caller-controlled table name.

## L. SELF-scoped AI surfaces

None. No route in the admission set targets a personal action, chat session or
user memory. `POST /agents/memory` and `POST /agents/risk/mitigate` take
`scopeType`/`scopeId` but are `crossdomain.write`, not `ai.govern`, so Admin is
not admitted and they are outside this slice. Reported N/A rather than
manufactured (§57).

## M. Mixed / business payload audit (§14, §29)

The headline finding.

`GET /ai/recommendations` ran `SELECT * FROM ai_recommendation_queue` tenant-wide
under `ai.govern`. `ai_recommendation_queue` has **no project column**, so
nothing about the row constrained it — and the row carries:

```text
reason             text   free-text rationale, names projects, dates, costs
data_signals       jsonb  the operational metrics that triggered it
affected_entities  jsonb  [{entity_type, entity_id, impact}] — real record ids
rollback_plan      jsonb  how to undo the effect on real rows
preview_data       jsonb  "projected outcome data"
```

`GET /ai/recommendations/:id/preview` returns `recommended_action,
affected_entities, rollback_plan, confidence, impact, urgency, reason,
data_signals` — and requires **`crossdomain.read`**.

So the list was a **strict superset of the preview, at lower authority**. The
gate above the preview was bypassable by listing, and the platform
administrator — who holds no `crossdomain.read` — received all of it for every
pending recommendation in the tenant.

## N. Field-level projection (§30)

Two literal column lists in the service; the route picks one:

```text
RECOMMENDATION_GOVERNANCE_COLUMNS   19 columns — id, action_id, category,
                                    status, all three scores, thresholds,
                                    approval_required, generated_by/at,
                                    expires_at, reviewer/approver/executor ids
                                    and timestamps, rejection_reason

RECOMMENDATION_BUSINESS_COLUMNS      5 columns — exactly the five above,
                                    matching the /preview contract
```

Keys are **omitted, not nulled** (§30) — a null would still confirm the field
and invite it to be read as "no data" rather than "not shown".

Two things worth stating plainly:

1. **The decision is made on the LIVE role.** My first implementation read
   `req.auth.role` — the JWT claim — which would have reintroduced exactly the
   stale-capability path §36 forbids: a demoted principal would keep the payload
   until their token expired. It now calls `resolveCurrentUser`, which re-reads
   `users.role` per request. There is a behavioural test for the demotion.
2. **The UI was updated because my change would have crashed it.**
   `AIApprovalCenter.tsx` called `rec.data_signals.map(...)` and
   `rec.affected_entities.length` unguarded. It now renders an explicit
   "requires cross-domain read access" affordance instead of silently rendering
   nothing — the administrator is told the payload is withheld, not shown an
   empty card.

## O. AI collections and aggregates (§21, §54, §55)

`GET /agent-actions/_stats` is the only Admin-admitted aggregate. Phase 3G
applied `collectionScopeSql` to the shared WHERE clause, so all five rollups
move together and the counts describe visible rows. Re-proved here by mutation
(§48), and the assertion was strengthened — see AI.

No other Admin-admitted route returns a `COUNT`/`SUM`/`GROUP BY` over
project-bound rows. `/adaptive/*/stats` aggregate model telemetry, which has no
project dimension to leak.

## P. Direct-ID AI routes (§22)

`POST /agent-actions/:id/review` and `PATCH /projects/:id/agent-mode` already
carried `requireRecordScope`. `agentApprovals` `:id` routes address
`agent_approvals`, whose `task_id → agent_tasks` has no project column — the
task's scope lives in `payload` jsonb, written by the orchestrator. Closing the
orchestrator entry point (K) is what makes that chain sound: a task can now only
carry a scope its creator was authorized for. Recorded as the reason this is not
a deferral.

## Q. AI task creation / enqueue (§23)

`POST /agents/execute` reaches `orchestrate()` with no `dryRun`, which runs
`checkGovernance`, then `enqueueTask` plus `openExecution` per task. Authorization
is now middleware, so it precedes all of it. Proved behaviourally: a refused
caller produces `orchestrate` **not called** and `enqueueTask` **not called** —
zero tasks, zero queue messages, zero external calls.

## R. Caller-supplied target / scope audit (§24)

| Field | Route(s) | Disposition |
|---|---|---|
| `scope` + `scopeId` | `/agents/plan`, `/agents/execute` | now authorized (K) |
| `scopeType` + `scopeId` | `/agents/readiness/coordinate` | now authorized (K) |
| `reviewedBy` | `/agents/approvals/:id/approve`, `/reject` | now the live principal (S) |
| `approvedBy` | `/optimization/proposals/:id/approve` | now the live principal (S) |
| `requestedBy` | `/agents/plan`, `/agents/execute` | already `r.auth.sub` — correct |
| `tenantId` | — | always the live principal; no route reads it from the body |

## S. Actor identity audit (§25)

`POST /agents/approvals/:id/approve` and `/reject` destructured `reviewedBy` from
`req.body`, required it, and passed it to `approveAction`, which writes
`agent_approvals.reviewed_by`. The live principal was never consulted.

That column is the human-in-the-loop record of record for an autonomous AI
action. Any `ai.govern` holder could file their verdict under another user's id.
Both now use `r.auth?.sub`; `optimization/proposals/:id/approve` likewise.

The prior agentRisk/agents actor-forgery gates (`authzAgentRiskActorBehaviour`,
`authzAgentReadSemantics`) were re-run and pass unmodified. No whole-repo actor
sweep was performed (§25).

## T. Known agent-actions regression proof (§20, §48)

Positive control planted: the scope predicate replaced with `''` at the call
site. Phase 3G's `authzCollectionRemainderRatchet` went **RED**. Reverted; green.

## U / V. Admin vs Owner, and Admin with project membership

| Case | Admin | Owner |
|---|---|---|
| `GET /ai/recommendations` — governance columns | ✅ | ✅ |
| `GET /ai/recommendations` — business columns | ❌ omitted | ✅ |
| coordination approve, project they are a member of | ✅ | ✅ |
| coordination approve, project they are not | ❌ 404 | ✅ (tenant-wide) |
| `/agents/execute` on a member project | ✅ 202 | ✅ |
| `/agents/execute` on a non-member project | ❌ 404, nothing started | ✅ |
| `scope: 'global'` | ❌ 400 | ❌ 400 |
| a principal without `ai.govern` | ❌ 403, zero AI reads | — |

The fixture gives ADMIN_A a real membership in PROJECT_A precisely to make §58's
point visible: membership answered *which records*, and it still did not hand
them the business payload in M — that is gated on `crossdomain.read`, which
membership does not confer.

## W. Functional capability proof (§40)

Capability and scope stay independent in both directions: an engineer gets
**403** and zero AI records are read; an Admin with the capability but without
the project gets **404**. Every route kept the exact capability it had.

**Business-capability conjunction: N/A.** §57 asks for a route where AI
governance touches business data and a domain capability is additionally
required. No such route exists in the admission set today — the repository's
answer to that shape is to gate the whole route at `crossdomain.read` instead
(`/preview`, `/plan/:scope/:id`, `/proposals/summary`). Reported rather than
invented.

## X / Y / Z. Query, cache and side-effect analysis

```text
recommendations list, admitted   principal 1 + one projected SELECT
recommendations list, refused    principal 1 + STOP — 0 AI reads
coordination approve, admitted   principal 1 + parent projection 1 + membership 1 + work
coordination approve, refused    the same 3, then STOP — no action created
agents/execute, refused          principal 1 + scope resolution — orchestrate never called
```

No cache sits on any Admin-admitted AI route. `previewRecommendation` writes an
audit row on a GET (`_appendAuditEvent`) — classified **DERIVED_CACHE**-adjacent
audit, not a workflow mutation, and it is `crossdomain.read` so outside the
admission set. Recorded rather than changed.

**GET side-effect audit (§52):** every Admin-admitted GET is `SELECT_ONLY`. No
`WORKFLOW_MUTATION` on a GET was found in the set.

## AA. Machine counters

```text
AI.GOVERN
  referenced endpoints ........... 48
  Admin-admitted ................. 48
  Admin-not-admitted .............. 0
  routes now enforcing scope ....... 8   (4 added this slice)
  unexplained ...................... 0
  unresolved data access ........... 0

PHASE-3
  TOTAL EXTRACTOR ROWS ........... 765     anomalies ......... 0
  PROJECT-BOUND ENDPOINTS ........ 350
  COLLECTIONS  108 / protected  82
  DIRECT-ID     60 / protected  56
  MUTATIONS    182 / record-scoped 174
  CONSEQUENTIAL 31 / record-scoped  31
  RECORD_SCOPE 350 / 312 / deferred 38 / unexplained 0
  ENDPOINTS ENFORCING SCOPE ...... 325     (321 → 325)
  UNRESOLVED_DATA_ACCESS .......... 31     (unchanged; none in this set)
```

`RECORD_SCOPE.protected` stays 312 because the three agent routes are not
project-bound *candidates* under the classifier — they are polymorphic-selector
mutations. The adoption counter that moves is the honest one: endpoints
enforcing scope, 321 → 325.

## AB. Phase-2 census

```text
PENDING_PHASE2 0   UNCLASSIFIED 0   UNEXPLAINED 0   anomalies 0
```

## AC. Holder comparison

```text
git diff cec252f HEAD -- api/authz/capabilities.ts  →  empty

CAPABILITY HOLDER DELTA ..... 0
ai.govern holders ........... { owner, admin }  unchanged
crossdomain.read ............ unchanged
crossdomain.write ........... unchanged
```

## AD. Regression suites

```text
ENTRY   221 files, 7940 tests
EXIT    223 files, 7975 tests, 0 failed, 0 skipped, 34.96s
        Phase-3I ratchet     16 tests
        Phase-3I behaviour   19 tests
```

All prior phases pass unmodified except two adoption pins that exist to be
moved (321 → 325) and one ratchet that was **extended rather than relaxed** —
see AE.

## AE. The ratchet that had to grow a door

`authzRecordScopeRatchet` asserted that **exactly one** exported function in
`recordScope.ts` may read `req.body`, and that it is `requireBodyProjectScope`.
`requireBodyPolymorphicScope` is a second.

The invariant under test was never "exactly one function" — it is "every
function that reads the body VERIFIES what it read". So the assertion was
generalised, not weakened: the count is pinned to the two known readers, the
project guard must still call `canAccessProject`, the polymorphic guard must
call **both** `twinScopePolicy` (the kind resolves through the trusted registry,
so a caller cannot name a table) and `resolvePolymorphicScope` (the identifier
is resolved against the database), and **both** are now checked for
caller-supplied authority claims — a list extended from
`memberOf/authorized/allowedProjects` to include `tenantId` and `role`.

## AF. Mutation proof

Each planted independently and reverted; all seven source files verified
byte-identical to their pre-mutation copies afterwards, and
`api/authz/capabilities.ts` verified byte-unchanged against the parent.

| Mutant | Change | Result |
|---|---|---|
| **A** | record scope removed from coordination approve | **RED** — 3 failed |
| **B** | governance columns stripped (over-restriction) | **RED** — 2 failed |
| **C** | `reason` leaked into the governance column list | **RED** — 4 failed |
| **D** | `crossdomain.read` ignored, full payload always sent | **RED** — 3 failed |
| **E** | polymorphic guard replaced with a tenant-only check | **RED** — 5 failed |
| **F** | unmodelled kind admits instead of failing closed | **RED** — 2 failed |
| **G** | body-supplied `reviewedBy` restored | **RED** — 2 failed |
| **§48** | scope predicate dropped from `/agent-actions/_stats` | **RED** — Phase 3G ratchet |

**Two things went wrong here and both are worth recording.**

*Mutant F survived its first planting* — and the mutant was wrong, not the test.
The `perl` pattern anchored on a trailing comment that belongs to
`requirePolymorphicScope`, the **path** variant, so it mutated a function these
tests never exercise. Re-planted inside `requireBodyPolymorphicScope`, it fails.
A surviving mutant is only evidence once you have confirmed you mutated the
thing you meant to.

*Mutant §48 exposed a weak assertion of my own.* Phase 3G's ratchet went red as
expected, but my new Phase-3I assertion — `expect(stats).toMatch(/collectionScopeSql/)`
— stayed **green**, because the identifier still appeared on the import line
after the call site had been gutted. It now matches the call itself, with its
arguments, and its parameter twin. Re-run against the same mutant: red.

## AG. Extractor regression

Phase-3C→3H hardening intact; anomalies 0, no silent drops. One addition:
`requireBodyPolymorphicScope` added to the record-scope call list in **both** the
extractor and its test-side census twin, so the two cannot diverge — the same
discipline Phase 3H used.

## AH. Three-run inventory determinism

```text
entry (cec252f)  3e47b22f…  ×3
exit  (973c6ba)  6c7b32ad…  ×3
3/3 BYTE-IDENTICAL
```

Generated evidence is stamped at the immutable **product** SHA. No hand edits.

## AI. One final full-suite result

```text
Test Files  223 passed (223)
     Tests  7975 passed (7975)
    Failed  0     Skipped  0     Duration  34.96s
```

Two intermediate full-suite runs during this session each showed **one**
`socket hang up` failure — `authzDeliveryMutationBehaviour` and
`authzAiReadSweep` — and both passed in isolation immediately after (75/75 and
32/32). Neither touches this slice. This is the flake class the separate
full-repo determinism gate exists for; recorded rather than retried away.

## AJ. Static / build / security / lint

```text
tsc --noEmit 0 errors   typecheck:modules 0 errors   build ✓ 434ms   diff --check clean
security gate: scan_secrets CLEAN, validate_claude_agents PASS (105) — HOLD CLEAR 🟢
eslint over 13 changed/new files: 0 errors, 0 warnings
package-lock.json unchanged
```

## AK. Migration status

No migration written or applied; 085 and 086 untouched. **No new persistent
authorization state was required** (§74): every AI scope resolved against an
existing table through the existing registry.

## AL / AM / AN / AO. Carried forward, unchanged

SAML (9 declarations / 18 mounted rows / project-bound 0). The
`GET /files/download/:token` one-hour post-revocation window. The realtime
`readiness` scope, still `DENY_UNSUPPORTED` — no Admin exposure in this slice
relies on those events. The sub-collection parent-guard consistency sweep.

## AP. Residual risks

1. **No conjunction guard is used anywhere on the AI surface.** All 48 routes
   are single-capability. `requireAllCapabilities` exists and is used elsewhere
   (`readiness.ts`, `autoCoordination` scan). If AI governance ever needs to
   expose real business data, the pattern to reach for already exists — but
   nothing currently forces that choice, and the next AI route added will
   default to a bare `ai.govern` unless someone remembers.

2. **`agent_approvals` and `agent_tasks` carry `payload`/`description`/`context`
   jsonb with no project column.** Admin can read the approval queue tenant-wide.
   Closing the orchestrator entry point means a task can only carry a scope its
   creator was authorized for, which is why this is not a deferral — but it is a
   *chain* argument, not a column-level one, and it would break if another
   producer wrote tasks without going through `/agents/*`.

3. **`aiGovernanceRouter` is mounted without `requireTenant`.** Pre-existing and
   outside this slice, but noted while auditing: the router calls `r.tenantId!`
   and the mount at `server.ts:595` supplies only `requireAuth`. It fails closed
   (an undefined tenant matches no rows) rather than leaking, so it is a
   correctness smell rather than an exposure — worth a separate look.

4. **`ecosystem.ts` federated model-version routes take no tenant at all.**
   Genuinely platform-level and correctly Admin's remit, but they are the widest
   authority in the set and have no ratchet asserting they stay platform-level.

5. **`contributeData(tenantId, req.body)`** accepts a caller-shaped contribution
   into the federated pool. Tenant-scoped and governance-classed, but the body
   is unvalidated at the route.

6. Unchanged: the download-token window; the temporary Owner-only `crossdomain`
   policy; the SAML census gap; full-repo determinism; migrations 085/086.

## AQ. Recommendation

```text
NEXT: ADR-014 PHASE 3J — SUB-COLLECTION PARENT-GUARD CONSISTENCY SWEEP
```

Chosen on live risk, and the evidence for it is this slice's own shape. The
defect pattern Phase 3I actually found was not "AI is special" — it was
**sibling asymmetry**: `/approve` unguarded beside a guarded `/dismiss`; a list
returning more than the `/preview` above it; a POST at `ai.govern` beside a GET
at `crossdomain.read` over the same data. Three of the six findings are that one
shape. The sub-collection sweep is the systematic search for exactly that shape
across the rest of the API, and it is now backed by a found-defect rate rather
than by "cheap insurance".

The `ai.govern` sweep itself is done, so the two remaining carried items are the
download-token revocation window and the realtime `readiness` product decision —
both narrower, and the readiness one needs an owner ruling rather than
engineering.

```text
Sequence: (a) sub-collection parent-guard sweep
          (b) download-token live-revocation hardening
          (c) realtime readiness scope-model repair — needs an owner decision
          (—) full-repo determinism qualification, now with two observed flakes
```

---

*Phase-3I completion evidence. A pushed branch and this report are not promotion
authorization. No PR was opened, nothing was merged, tagged, released or
deployed, and no owner database migration was applied.*
