# BUILDER COMPLETION REPORT — jarvis-epc — ADR-014 PHASE 3J

## A. Verdict

```text
ADR-014 PHASE 3J: COMPLETE

NESTED / SUB-COLLECTION ROUTE INVENTORY ........ CLOSED  (314 routes, 92 families)
PARENT RESOURCE IDENTIFICATION ................. PROVED
PARENT AUTHORIZATION CONSISTENCY ............... PROVED
CHILD QUERY PARENT BINDING ..................... PROVED
CHILD / PARENT ID MISMATCH BYPASS .............. CLOSED

SIBLING RECORD-SCOPE ASYMMETRY ................. CLOSED  (0 mixed families)
SIBLING CONSEQUENTIAL-GUARD ASYMMETRY .......... CLOSED
WEAKER-SIBLING PAYLOAD SUPERSET ................ CLOSED  (none beyond Phase 3I)

CONTEXT-ONLY PARENT ROUTES ..................... EXPLICITLY CLASSIFIED
SELF-SCOPED CHILD AUTHORIZATION ................ PRESERVED
POLYMORPHIC CHILD AUTHORIZATION ................ PRESERVED

LIVE MEMBERSHIP REVOCATION ..................... PROVED
LIVE FUNCTIONAL CAPABILITY REVOCATION .......... PROVED
CROSS-TENANT PARENT/CHILD ISOLATION ............ PROVED

PHASE-3I AI.GOVERN FIXES ....................... PRESERVED
CAPABILITY HOLDER DELTA ........................ 0

PENDING_PHASE2 ................................. 0
UNCLASSIFIED ................................... 0
NESTED_ROUTE_UNEXPLAINED ....................... 0
PARENT_RESOURCE_UNEXPLAINED .................... 0
RECORD_SCOPE_UNEXPLAINED ....................... 0

INVENTORY DETERMINISM .......................... PROVED (3/3 entry and exit)
PROMOTION ...................................... NOT AUTHORIZED
```

Separately:

```text
FULL-REPO DETERMINISM:
NOT IN SCOPE — SEPARATE QUALIFICATION GATE
```

**Four unguarded parents found and closed, 29 routes in total.** The largest was
an entire router: `twin.ts` operates on `operational_twins` and carried no
`requireTwinScope` at all, while Phase 3H had closed the same table on the
scenarios router.

## B. Timestamps

```text
HOB GENERATED        2026-08-23 11:23:00 CAT   /  2026-08-23 09:23:00 UTC
EXECUTION STARTED    2026-08-23 11:26:40 CAT   /  2026-08-23 09:26:40 UTC
EXECUTION COMPLETED  2026-08-23 11:44:21 CAT   /  2026-08-23 09:44:21 UTC
FINAL SHA CREATED    2026-08-23 11:45:58 CAT   /  2026-08-23 09:45:58 UTC
REMOTE PUSHED        2026-08-23 11:46:22 CAT   /  2026-08-23 09:46:22 UTC
```

## C. Repository provenance

```text
repository root ...... /Users/rommelaguillon/Local Documents/Claude/Production/Denver Engineering
remote ............... https://github.com/ral197979/jarvis-epc.git
owner / repo ......... ral197979 / jarvis-epc

PHASE3I_REMOTE_PARENT  159173c598ddfdfc70c2c7c7df2fa3904735b175
  git cat-file -t .... commit                                   VERIFIED
  remote contains .... origin/security/adr-014-phase3i-ai-govern-exposure

branch ............... security/adr-014-phase3j-subcollection-guard-sweep
product commit ....... c9169ca4475450dfeb09f2a5cf2ce1e33f549a31
evidence commit ...... this commit (branch tip)
origin/main .......... untouched

tracked tree ......... clean at final SHA
stashes .............. 2, both preserved
worktrees ............ 1
```

§1 note, worth recording because the HOB anticipated it: the Phase-3I **product**
commit was `973c6ba`, and the branch tip was `159173c` — two commits later
(evidence, then the push timestamp). Branching from the product commit would
have silently dropped the Phase-3I evidence. The tip was resolved from origin,
not assumed.

## D. Entry baseline

```text
inventory 3/3 byte-identical .... 6c7b32ad…
tsc / typecheck:modules ......... 0 errors
ENTRY FULL SUITE ................ 223 files, 7975 tests, 0 failed
```

Reconciles exactly with the Phase-3I exit state. No drift.

## E. Nested-route inventory methodology

Machine-derived (§11): every **mounted** route whose effective path contains a
dynamic segment followed by at least one more segment. Never by parameter
spelling (§12) — what `:id` identifies was derived from the router variable, the
handler's service call, and the schema.

SAML excluded per §55 (16 routes, carried unchanged).

## F. Nested route counters

```text
NESTED_ROUTE_TOTAL (mounted) ...... 330
  SAML, out of scope (§55) ........  16
  IN SCOPE ........................ 314

  NESTED_READS ....................... 127
  NESTED_MUTATIONS ................... 187
  NESTED_CONSEQUENTIAL ................ 50

  enforcing record/twin/polymorphic scope   226   (was 197 at entry)
  not enforcing, by disposition ..........  88

SIBLING FAMILIES ................... 92
  mixed-guard asymmetries ........... 0   (was 4 at entry)
```

Disposition counters, from the registry itself:

```text
total ........................ 92
  PARENT_SCOPED_AND_BOUND .... 45
  TENANT_GLOBAL_CHILD ........ 19
  PLATFORM_GLOBAL ............ 19
  POLYMORPHIC_SCOPED .......... 5
  SELF_SCOPED ................. 2
  CHILD_STRONGER_SCOPE ........ 1
  SERVICE_BOUNDARY ............ 1
  CONTEXT_ONLY_PARENT ......... 0
  DEFERRED_SCOPE_MODEL ........ 0

NESTED_ROUTE_UNEXPLAINED ...... 0
PARENT_RESOURCE_UNEXPLAINED ... 0
```

## G / H. Parent and child resource ledgers

`api/authz/nestedRouteDispositions.ts` is the canonical record (§57): every
family declares its prefix, the resource the dynamic segment **actually**
identifies, its disposition, and the evidence. The ratchet fails the build if a
mounted nested route belongs to no family.

Parent and child are recorded separately where they differ — `/knowledge/sources/:id/chunks`
addresses `knowledge_sources` and returns `knowledge_chunks`; `/bim-models/:modelId/elements`
addresses `bim_models` and returns `bim_elements`.

## I. Sibling family ledger

92 families grouped by router, parent resource and prefix. The mixed-guard
detector — families where one sibling enforces scope and another does not — is
the single mechanical test that surfaced every finding below.

## J. Sibling-asymmetry findings

Four families were mixed at entry. All four are closed.

| Family | Guarded siblings | Unguarded siblings | Verdict |
|---|---|---|---|
| `/twins/:twinId` | 0 | **16** | MISSING_PARENT_GUARD |
| `/bim-models/:modelId` | 2 | **9** | MISSING_PARENT_GUARD |
| `/scenarios/temporal/:twinId` | 3 | **2** | MISSING_PARENT_GUARD |
| `/proposals/:id` | 0 | 2 (items) | UNBOUND_CHILD_QUERY |

## K. Parent-scope defects

**1. `twin.ts` — the whole router (16 routes).** `operational_twins` is the
Phase-3H polymorphic model: a twin row proves only that some object was mirrored
inside the tenant, and the authority belongs to the entity it mirrors. Phase 3H
applied `requireTwinScope` to the five routes its HOB listed, all on the
*scenarios* router. The *twin* router — `GET /:twinId`, `/state`, `/sync`,
`/events`, `/snapshots` ×4, `/relationships` ×3, `/traverse`, `/impact`,
`/risk-propagation`, `PATCH /status` — was never in that list and carried only
`crossdomain.read`/`crossdomain.write`.

All 15 `/:twinId` routes now carry `requireTwinScope()`. `GET /entity/:entityType/:entityId`
— where the caller supplies both halves of the selector — carries
`requirePolymorphicScope('entityType', 'entityId')` against the same registry.

`GET /:twinId` itself is a direct-ID route rather than a nested one, so it sits
just outside the strict sweep. It was included deliberately: leaving the parent
open beside fifteen closed children is the hole Phase 3H itself named when it
chose to close `replay`.

**2. `estimating.ts` — nine `/bim-models/:modelId` sub-routes.** `bim_models`
carries `project_id NOT NULL REFERENCES projects` (migration 007) and has a
registered `PROJECT_REQUIRED` policy. `bim.ts` guards `/bim-models/:id` with
`requireRecordScope('bim_models')`. `estimating.ts` **already imports
`requireRecordScope` and already uses it** on `/parse-elements` (line 71) and
`/ava-estimate` (line 285) — with nine unguarded sub-routes between them.

**3. `scenarios.ts` — `/temporal/:twinId/velocity` and `/trend/:field`.** Same
parent, same capability, same twin-state payload family as `/at`, `/replay` and
`/diff`, which are guarded. Phase 3H caught `replay` and missed these two.

## L. Child-query binding defects

Two of the nine bim routes were also unbound — the guard would have been
cosmetic without this:

```text
GET  /bim-models/:modelId/elements/:id        getElementById(tid, id)
POST /bim-models/:modelId/elements/:id/link   linkElementToEntity(tid, id, …)
```

`:modelId` was never read. So an authorized model laundered access to any
element in the tenant, including one belonging to a project the caller cannot
reach. `bim_elements.model_id` is `NOT NULL`, so the binding was mechanically
derivable (§59): the lookup now constrains on `model_id`, and the link INSERT
selects its element through the model rather than trusting the id.

## M. Parent/child ID mismatch audit

The §24 fixture is behavioural: `ELEM_B` belongs to `MODEL_B`, the caller is
authorized for `MODEL_A`, and `GET /bim-models/MODEL_A/elements/ELEM_B` answers
**404** — even though `MODEL_A` itself is authorized. The link mutation refuses
the same way, and writes nothing.

## N. Consequential sibling audit

50 nested consequential transitions (`approve`, `reject`, `dismiss`, `submit`,
`close`, `void`, `resolve`, …). Every one either enforces parent scope or is
dispositioned tenant-global/platform with evidence. No transition is scoped
while an adjacent transition over the same parent is not — that is what the
mixed-family assertion holds, and it is the assertion mutant E breaks. No
approval capability was downgraded to a write capability (§28).

## O. Payload-superset sibling audit

Checked for the Phase-3I shape — a lower-authority sibling returning a strict
superset of a higher-authority one. Beyond the recommendation list/preview pair
already closed in Phase 3I, none was found. `SELECT *` handlers were reviewed
against their siblings' capabilities; the remaining ones are tenant-global
resources whose siblings share the same capability.

## P. Context-only routes

**None.** `CONTEXT_ONLY_PARENT` is declared in the vocabulary and is
deliberately empty. Phase 3F's example — `/projects/:projectId/inspection-templates`
returning tenant-level templates — no longer matches the nested pattern in the
current inventory. The class is kept so a future one must be classified
explicitly rather than passing as an ordinary project child (§39).

## Q. SELF-scoped nested routes

`/actions/:id/*` (6 routes) is `CHILD_STRONGER_SCOPE`: every handler calls
`requireActionAccess` — personal ownership, strictly narrower than project
membership. Deliberately **not** converted to record scope (D29): a project peer
must not reach another user's action, its relationships, timeline, dependencies
or SLA clock. `/notifications/:id/*` and `/ask/sessions/:id/*` are `SELF_SCOPED`
by principal-bound service calls.

Mutants F and F2 both prove this is load-bearing in both directions — adding
project membership fails, and removing `requireActionAccess` fails.

## R. Polymorphic nested routes

Five families, all resolving through the **Phase-3H registry** with no second
resolver (§50): the twin router, the twin entity lookup, the temporal siblings,
portfolio readiness, and the `/related/:source` cross-link surface. Realtime
`readiness` remains `DENY_UNSUPPORTED`, untouched.

## S. Tenant-global child routes

19 families. Each was verified against the schema rather than assumed:
`proposals` (migration 062, no `project_id` — pre-award CRM precedes any
project), `vendors` (NO_PROJECT_PARENT master data), `operational_anomalies`,
`scenario_simulations` (only a nullable `base_snapshot_id`; Phase 3E-R settled
that a nullable parent means what the resource says), and the AI telemetry and
governance queues Phase 3I reconciled.

## T / U. Same-tenant cross-parent and cross-tenant proofs

| Case | Result |
|---|---|
| sub-route on a model in the caller's project | 200 |
| same sub-route on a model in another project | 404, zero child queries |
| every sibling sub-route on that model | 404 |
| refused mutation | 404, zero writes |
| tenant-wide Owner, both models | 200 |
| Owner of tenant A reaching a tenant-B model | 404 |

## V / W. Live revocation

```text
membership active  → 200
membership closed in the fixture, same JWT → 404

engineering.view present → 200
role demoted to viewer, same JWT → 403, and zero child queries
```

Scope and capability are both read live on every call, and the functional gate
refuses before the parent is even resolved.

## X. Query / count / pagination analysis

```text
nested read, admitted   principal 1 + parent projection 1 + membership 1 + child query 1
nested read, refused    the same 3, then STOP — 0 child queries
nested mutation, refused the same 3, then STOP — 0 writes
```

One parent lookup plus one bound child query (§63). Authorization is never per
child row — the parent is resolved once, and the child query carries the parent
predicate, so `COUNT`, `ORDER`, `LIMIT` and `OFFSET` all describe the authorized
set rather than a post-filtered page (§25, §26).

## Y. Cache audit

**CACHE: N/A** for every family touched. The only derived cache in the ADR-014
surface is `operational_forecasts` behind `/portfolio/readiness`, which Phase 3H
already proved authorizes before both the cache read and the upsert.

## Z. Read-side-effect audit

Every nested GET touched in this slice is `SELECT_ONLY`. No `WORKFLOW_MUTATION`
on a GET was found among them.

## AA. Phase-3I non-regression

`ai.govern` suites pass unmodified. The 48/48 admission set is unchanged and the
six Phase-3I fixes remain closed — the coordination approve/dismiss pair is now
also asserted by the Phase-3J family ratchet, so it is held by two independent
tests. Mutant E re-breaks it and both go red.

## AB. Phase-3 counters

```text
TOTAL EXTRACTOR ROWS ........... 765     anomalies ......... 0
PROJECT-BOUND ENDPOINTS ........ 350
COLLECTIONS  108 / protected  82
DIRECT-ID     60 / protected  56
MUTATIONS    182 / record-scoped 174
CONSEQUENTIAL 31 / record-scoped  31
RECORD_SCOPE 350 / 312 / deferred 38 / unexplained 0
ENDPOINTS ENFORCING SCOPE ...... 352     (325 → 352, +27)
UNRESOLVED_DATA_ACCESS .......... 31     (unchanged)
```

`RECORD_SCOPE.protected` stays 312: the twin, temporal and estimating routes are
not project-bound *candidates* under the classifier — twins are polymorphic and
the bim sub-routes hang off a direct-ID parent. The counter that moves honestly
is endpoints enforcing scope, 325 → 352.

## AC. Phase-2 census

```text
PENDING_PHASE2 0   UNCLASSIFIED 0   UNEXPLAINED 0
```

## AD. Holder comparison

```text
git diff 159173c HEAD -- api/authz/capabilities.ts  →  empty

CAPABILITY HOLDER DELTA = 0
```

## AE. Regression suites

```text
ENTRY   223 files, 7975 tests
EXIT    225 files, 8006 tests, 0 failed, 0 skipped
        Phase-3J ratchet     17 tests
        Phase-3J behaviour   14 tests
```

Every prior phase passes unmodified except the two adoption pins that exist to
be moved (325 → 336 → 352 as each finding closed). No ratchet was weakened.

## AF. Mutation proof

Each planted independently and reverted; all nine files verified byte-identical
to their pre-mutation copies afterwards, and `capabilities.ts` byte-unchanged.

| Mutant | Change | Result |
|---|---|---|
| **A** | parent guard removed from one bim sub-route | **RED** — 6 failed |
| **B** | guard pointed at the wrong parent resource | **RED** — 6 failed |
| **C** | child query unbound from `model_id` | **RED** — 2 failed |
| **D** | link INSERT accepts an element from another model | **RED** — 2 failed |
| **E** | coordination approve scope dropped (Phase-3I control) | **RED** — 2 failed |
| **F** | project membership added to a SELF action sub-route | **RED** — 2 failed |
| **F2** | `requireActionAccess` **removed** from that sub-route | **RED** — 1 failed |
| **G** | functional capability removed, scope kept | **RED** — 1 failed |
| **H** | twin router siblings reopened | **RED** — 1 failed |

**F and F2 are two mutants because the first one only half landed.** F added
`requireProjectScope` but its second `perl` hunk did not match, so
`requireActionAccess` was still present — the failure came from the added
membership, not the removed ownership. F2 removes `requireActionAccess` cleanly
(10 call sites → 9) and is red on its own. This is the Phase-3I lesson applied
rather than restated: a mutant's result means nothing until you have confirmed
the mutant landed where you aimed it.

## AG. Extractor regression

All prior hardening intact — balanced parser, multi-router identities,
intra-file sub-router mounts, indirect guards, capability detection,
`primaryReadTable`, body-project and polymorphic scope calls,
`UNRESOLVED_DATA_ACCESS`. Anomalies 0, no silent route drops. The extractor was
**not** modified this slice; the new guards are existing canonical calls it
already recognises.

The ratchet reads the census twin rather than the generated JSON, so the two
cannot drift.

## AH. Three-run inventory determinism

```text
entry (159173c)  6c7b32ad…  ×3
exit  (c9169ca)  c5d6be20…  ×3
3/3 BYTE-IDENTICAL
```

Stamped at the immutable product SHA. No hand edits.

## AI. One final full-suite result

```text
Test Files  225 passed (225)
     Tests  8006 passed (8006)
    Failed  0     Skipped  0     Duration  36.53s
```

Clean on this run. No five-run claim. (Both Phase-3H and 3I saw intermittent
`socket hang up` flakes under parallel load; none appeared in this run, which is
consistent with a flake rather than a fix.)

## AJ. Static / build / security / lint

```text
tsc --noEmit 0 errors   typecheck:modules 0 errors   build ✓ 610ms   diff --check clean
security gate: scan_secrets CLEAN, validate_claude_agents PASS (105) — HOLD CLEAR 🟢
eslint over 11 changed/new files: 0 errors, 0 warnings
package-lock.json unchanged
```

## AK. Migration status

No migration written or applied; 085 and 086 untouched. **No new persistent
state was required** (§73): every parent resolved through an existing table and
an existing foreign key.

## AL / AM / AN. Carried forward, unchanged

SAML (9 declarations / 18 mounted rows / project-bound 0; its 16 nested routes
excluded per §55). `GET /files/download/:token` and its one-hour post-revocation
window. The realtime `readiness` scope, still `DENY_UNSUPPORTED` with two
incompatible producers.

## AO. Residual risks

1. **`GET /twins/:twinId` was closed as part of the family, not the sweep.** It
   is a direct-ID route; the sweep's subject was its fifteen children. Including
   it was a judgement call — leaving the parent open beside closed children
   would be indefensible — but it is scope the HOB did not literally ask for,
   and it is recorded here rather than buried.

2. **The twin and temporal fixes are holder-neutral today.** `crossdomain.*` is
   Owner-only, so no caller's behaviour changed. That also means these guards
   have no behavioural test of their own — they are held by the family ratchet
   and mutant H. If `crossdomain.read` is ever widened, that surface needs real
   behavioural tests first.

3. **`scenario_simulations` has a nullable twin link.** `/scenarios/:scenarioId`
   and `/simulation/:id` are classed `TENANT_GLOBAL_CHILD` because the parent is
   optional. If the product intends every scenario to belong to a twin, that is
   a schema decision, not an authorization one.

4. **`requireActionAccess` is not in the extractor's record-scope call list.**
   The action sub-routes are correctly guarded, but the census counts them as
   unscoped, so the adoption number understates reality by six. Left unchanged
   to avoid disturbing prior pins for a cosmetic gain; the registry records the
   truth.

5. **`proposal_items` binding is preventive, not corrective.** Proposals are
   tenant-level, so no caller crossed a boundary. The value is that the route now
   means what its path says, and that it stays correct if proposals gain a
   project parent.

6. Unchanged: the download-token window; the temporary Owner-only `crossdomain`
   policy; the SAML census gap; full-repo determinism; migrations 085/086.

## AP. Recommendation

```text
NEXT: ADR-014 PHASE 3K — DOWNLOAD-TOKEN LIVE-REVOCATION HARDENING
```

Chosen on live risk over the realtime `readiness` repair, for two reasons.

First, it is the only remaining item that is **live and holder-neutral in the
wrong direction**: `GET /files/download/:token` honours a token for an hour
after the underlying access is revoked. Every other authorization surface in
ADR-014 now re-derives authority from the database on every call — membership
revocation, role demotion, tenant boundary — and this is the one place where a
stale credential still works. That is a real hour-long window on document
content, not a modelling gap.

Second, `readiness` needs an **owner product decision**, not engineering: two
producers write different identifier kinds into one column, and no amount of
source reading resolves which meaning is intended. It should be raised as a
question, not scheduled as a slice.

```text
Sequence: (a) download-token live-revocation hardening
          (b) realtime readiness scope-model repair — blocked on an owner ruling
          (—) full-repo determinism qualification, on clean infrastructure
```

The authorization rollout is close to done. After the download token, every
project-bound surface is scoped, SELF, holder-neutral on an enforced ratchet, or
explicitly deferred with evidence.

---

*Phase-3J completion evidence. A pushed branch and this report are not promotion
authorization. No PR was opened, nothing was merged, tagged, released or
deployed, and no owner database migration was applied.*
