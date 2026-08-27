# BUILDER COMPLETION REPORT — jarvis-epc — ADR-014 PHASE 3H

## A. Verdict

```text
ADR-014 PHASE 3H: PARTIAL

DERIVABLE POLYMORPHIC SCOPE TYPES ........ CLOSED
POLICY MODEL REQUIRED .................... 1  (realtime `readiness`)
POLYMORPHIC_SCOPE_TYPE_UNEXPLAINED ....... 0
PHASE3H_ROUTE_UNEXPLAINED ................ 0
RECORD_SCOPE_UNEXPLAINED ................. 0
PROMOTION ................................ NOT AUTHORIZED
```

Sub-verdicts:

```text
POLYMORPHIC SCOPE POLICY REGISTRY .............. CLOSED
TWIN ENTITY-TYPE POLICY ........................ CLOSED (14/14)
REALTIME EVENT SCOPE POLICY .................... CLOSED (7/7 dispositioned)

PROJECT-SCOPED TWIN AUTHORIZATION .............. PROVED
TENANT-GLOBAL TWIN AUTHORIZATION ............... PROVED
SELF-SCOPED TWIN AUTHORIZATION ................. PROVED

PORTFOLIO READINESS SCOPE ...................... CLOSED
SCENARIO PROJECTION SCOPE ...................... CLOSED
SCENARIO TEMPORAL DIFF SCOPE ................... CLOSED
SCENARIO TEMPORAL AT SCOPE ..................... CLOSED
SCENARIO TEMPORAL REPLAY SCOPE ................. CLOSED (sibling, beyond the five)
OPS LIVE-FEED SCOPE ............................ CLOSED

LIVE-FEED AUTHORIZATION-BEFORE-PAGINATION ...... PROVED (structurally — see P)
CROSS-TENANT POLYMORPHIC ISOLATION ............. PROVED
READINESS DERIVED-CACHE AUTHORIZATION .......... PROVED
FORECAST CACHE KEY SAFETY ...................... VERIFIED, no change needed
UNKNOWN SCOPE TYPE FAIL-CLOSED ................. PROVED
TYPE/ID COLLISION ISOLATION .................... PROVED
LIVE MEMBERSHIP REVOCATION ..................... PROVED
FUNCTIONAL CAPABILITY + SCOPE .................. PROVED

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

**PARTIAL for one reason.** All six routes are closed and every declared kind
has a policy. One realtime scope — `readiness` — has two producers writing
different identifier kinds into the same column, so its meaning is not
decidable from source. It fails closed rather than being guessed (§5, §84).

## B. Repository provenance

```text
repository root ...... /Users/rommelaguillon/Local Documents/Claude/Production/Denver Engineering
remote ............... https://github.com/ral197979/jarvis-epc.git

certified parent ..... 233e0d747640ae76237d98945f8fb0b91af4bc24
  git cat-file -t .... commit
  remote contains .... origin/security/adr-014-phase3g-collection-remainder

branch ............... security/adr-014-phase3h-polymorphic-scope
product commit ....... 4f559b4ccab46d838b608cff2f2f4afa37eb3377
evidence commit ...... this commit (a commit cannot carry its own hash;
                       resolve with `git rev-parse HEAD` on the branch below)
final SHA ............ = the evidence commit = branch tip of
                       security/adr-014-phase3h-polymorphic-scope
origin/main .......... f5883c31c1205a113ec4909437449d0a84381d34  (untouched)

tracked tree ......... clean at final SHA
stashes .............. 2, both preserved, neither touched
worktrees ............ 1
unrelated evidence ... 27 pre-existing untracked audit/evidence/*.md preserved
```

## C. Entry baseline

Reproduced the certified Phase-3G state exactly, 3/3 byte-identical
(`94f93d52…`):

```text
ROWS 765   PROJECT-BOUND 350
COLLECTIONS 108 protected 82      DIRECT-ID 60 protected 55
MUTATIONS 182 record-scoped 174   RECORD_SCOPE 350/311/39/0   AT_COMMIT 315
ENTRY FULL SUITE 219 files, 7886 tests, 0 failed
```

## D. Twin entity-type inventory

Derived from the enum in migration 046, not from the prior report (§6):

```text
TWIN ENTITY TYPES ......... 14
  PROJECT_SCOPED ...........  6
  TENANT_GLOBAL ............  3
  SELF_SCOPED ..............  1
  PLATFORM_GLOBAL ..........  0
  DENY_UNSUPPORTED .........  4
  unexplained ..............  0
```

| Kind | Class | Entity | Evidence |
|---|---|---|---|
| `project` | PROJECT_SCOPED | `projects` | the identifier IS the project; no parent lookup |
| `system` | PROJECT_SCOPED | `systems` | migration 026 `project_id NOT NULL REFERENCES projects` |
| `subsystem` | PROJECT_SCOPED | `subsystems` | migration 026, same shape — FK, not an assumed hierarchy (§22) |
| `tag` | PROJECT_SCOPED | `tags` | direct `project_id`, PROJECT_REQUIRED since Phase 3A |
| `inspection` | PROJECT_SCOPED | `inspections` | direct `project_id` |
| `deficiency` | PROJECT_SCOPED | `deficiencies` | direct `project_id` |
| `action` | **SELF_SCOPED** | `actions` | Phase 2C-4A made an action a personal record (§24) |
| `vendor` | TENANT_GLOBAL | `vendors` | NO_PROJECT_PARENT; Phase 3D/3G already corrected vendor routes (§26) |
| `workforce` | TENANT_GLOBAL | `team_members` | Phase 3A rejected `project_assignments` as authority (§27) |
| `workflow` | TENANT_GLOBAL | `workflows` | migration 049: `tenant_id NOT NULL`, no project column |
| `equipment` | **DENY_UNSUPPORTED** | — | **no table exists** |
| `permit` | **DENY_UNSUPPORTED** | — | **no table exists** |
| `site` | **DENY_UNSUPPORTED** | — | **no table exists** |
| `region` | **DENY_UNSUPPORTED** | — | **no table exists** |

The four denials are the finding I would most want reviewed: `equipment`,
`permit`, `site` and `region` are declared in `twin_entity_type` and **no
migration creates a table for any of them**. The parsed schema contains only
`asset_scan_events` and `evidence_assets`, neither an equipment register. There
is no entity to authorize, so §28's warning about geographic entities never
arises — there is not even a topology to reason from.

## E. Live-feed scope inventory

Derived from the eight `broadcastEvent` producers, not from rows or fixtures
(§7), because what `scope_id` MEANS is decided by whoever writes it:

```text
LIVE-FEED SCOPE TYPES ......  7
  PROJECT_SCOPED ...........  0
  TENANT_GLOBAL ............  1
  SELF_SCOPED ..............  2
  PLATFORM_GLOBAL ..........  0
  DENY_UNSUPPORTED .........  4
  unexplained ..............  0
```

| Scope | `scope_id` | Producers | Class |
|---|---|---|---|
| `tenant` | **none** | ops.ts:346, runbookEngine ×3 | TENANT_GLOBAL |
| `action` | an action id | ops.ts:220 | SELF_SCOPED |
| `escalation` | an action id | ops.ts:258 | SELF_SCOPED |
| `readiness` | **project_id OR handoff_id** | universalEvents:117, commissioningWebhook:60 | **DENY_UNSUPPORTED** |
| `project` | — | **none** | DENY_UNSUPPORTED |
| `module` | — | **none** | DENY_UNSUPPORTED |
| `assignee` | — | **none** | DENY_UNSUPPORTED |

`escalation` is classed with `action` deliberately: it is a different event type
over the *same subject*, and classing it separately would let an escalation
disclose an action its own scope hides.

## F. Canonical polymorphic policy registry

`api/authz/polymorphicScopePolicies.ts` — one mapping from kind → class →
resolver. Nothing in `portfolio`, `scenarios`, `ops`, the twin service or the
live-feed service carries its own (§8).

Every entry declares: kind, class, identifier shape, resolver (table, id
column, tenant column, and either the record-scope resource, the
`identifierIsProject` flag, or the owning column), the capability that already
governs it, and evidence.

Three exports drive everything: `twinScopePolicy`, `realtimeScopePolicy` — both
returning `null` (= deny) for an unregistered kind — and
`polymorphicScopeCounters`.

## G. Identifier validation

Every supported kind declares `idShape`. All the real entities have `uuid`
primary keys, so all are `UUID`; the realtime `tenant` scope is `NONE` because
it carries no subject.

Validation happens **before any query** — the ratchet asserts the shape check
precedes the first `tenantQuery`/`resolveParentProjectId` by source position —
and a malformed identifier returns `INVALID_IDENTIFIER` without issuing SQL,
proved by a behavioural assertion that `mockQuery` was never called.

§11 is held structurally: every `${…}` inside the three polymorphic functions is
asserted not to reference `req`, `params`, `query`, `body`, `scopeType` or
`entity_type`. The identifier appears only as `[identifier]` in a params array,
and never as `${identifier}`. The free-text scope key is compared on `::text`,
so a malformed value fails to match rather than raising.

## H. Project-scoped policies

All six route through the canonical machinery — `resolveParentProjectId` then
`canAccessProject` — so they inherit one definition of "active member" and one
live active window (§21). The ratchet asserts the resolver contains no
`FROM project_members` of its own, and that every declared `recordResource`
exists in the record-scope registry, points at the same table, and is
`PROJECT_REQUIRED`.

## I. Tenant-global policies

`vendor`, `workforce`, `workflow`, and the realtime `tenant` scope. Each was
**verified against the parsed schema** rather than inherited from its name — the
ratchet asserts all three tables are `NO_PROJECT_PARENT`, and that the
`workforce` evidence specifically mentions `project_assignments`, since §27's
whole point is that assignments are filterable data and not authority.

Tenant-bounded, never application-global: the ratchet asserts the branch carries
`current_setting('app.current_tenant_id', true)::uuid`, and the behavioural
suite proves the same vendor id resolves in its own tenant and not in another.

## J. SELF policies

`action` as a twin kind, and `action`/`escalation` as realtime scopes. The
resolver's SELF branch is asserted to contain no `canAccessProject`,
`project_members` or `resolveParentProjectId` — project membership is never
consulted — and to fall back to `personal.admin`, the same tenant-wide personal
authority the Personal Inbox uses.

Proved behaviourally: `ACTION_B` is assigned to `USER_B` and lives in
`PROJECT_A`, which `USER_A` is a member of. `USER_A` is refused; `USER_B` is
admitted. Sharing a project is not enough.

## K. Unsupported / fail-closed policies

Eight kinds deny: four twin types with no table, and four realtime scopes —
three with no producer and one with two contradictory ones.

There is no default branch anywhere. The ratchet holds all three doors:
`resolvePolymorphicScope` refuses a null policy, its `switch` ends in
`return 'UNSUPPORTED_KIND'` rather than a permissive default, and
`polymorphicCollectionScopeSql` returns `'AND FALSE'` — not `''`, which would
mean "no restriction".

The registry is compared against the DECLARED enum and union **as a set**, not a
count (§31), so swapping one value for another fails rather than letting the new
one inherit the old one's class.

## L. `GET /portfolio/readiness/:scopeType/:scopeId`

`requirePolymorphicScope('scopeType', 'scopeId')` beside the existing
`portfolio.view`. Two refusals, deliberately different (§14):

| Case | Response |
|---|---|
| unsupported `scopeType` | **400** `unsupported_scope_type`, and zero queries |
| malformed `scopeId` | 404, and the id never reaches statement text |
| valid kind, unreachable object | **404**, indistinguishable from absent |
| reachable object | 200 |

The 400 discloses nothing: the set of supported kinds is a published enum, not
tenant data.

## M / N / O. `GET /scenarios/projection|temporal/:twinId/…`

`requireTwinScope()` on all four — projection, `at`, `diff`, and **`replay`**,
which is not in the HOB's list of five. It is the same table, the same id and
the same payload family as `diff` and `at`; leaving it open beside three closed
siblings would have been a knowingly-kept hole.

The twin lookup selects **only** `entity_type, entity_id` — never the payload —
so the decision is made before any scenario, timeline, diff or historian query
(§46). A same-tenant twin alone does not authorize; the ratchet asserts the
guard calls `resolvePolymorphicScope`.

Refusals are indistinguishable: absent twin, wrong tenant, unsupported kind and
out-of-scope entity all answer 404 with the same body, asserted by comparing an
absent twin against a `site` twin.

## P. `GET /ops/live-feed`

The caller chooses `scope`, so the selector is validated against the registry
before anything is read, and the class it names decides the predicate:

```text
tenant                 ''            the tenant boundary is the whole scope
action / escalation    one EXISTS    against the owning action
project / module /
assignee / readiness   400           unsupported_scope_type
```

One predicate per class, applied once inside the query — **no lookup per event**
(§51). Measured query shape: one principal lookup, one event query; the
authorization cost does not scale with the number of events.

## Q. Live-feed pagination and counts

The predicate is interpolated into the replay query **before** `ORDER BY
sequence_number` and `LIMIT $5`, asserted by source position (§19). A page is
therefore the newest *authorized* events, not the newest tenant events with the
unauthorized ones removed afterwards — which would both shorten pages and reveal
how many events the caller cannot see. `meta.count` is asserted to describe the
rows actually returned.

**Held structurally rather than behaviourally, and the reason matters.**
`crossdomain.read` is Owner-only and the Owner holds `personal.admin`, so the
SELF branch emits `''` for the only caller who can reach the route. Mutants H
and J both survived their first run for exactly that reason. The predicate's
presence and its ordering are now asserted on the source, and the ownership
clause is asserted on the emitted SQL for a non-admin principal — see AD.

## R. Same-tenant cross-project proof

Every target route is Owner-only, and the Owner is tenant-wide by
`project.list.all`. A cross-project test **cannot** be constructed through these
routes without inventing a role that does not exist, which §43 and §70 forbid.
§43 also requires the policy to exist anyway, so a later holder change cannot
expose data silently.

So the class behaviour is proved directly against the canonical resolver with a
non-tenant-wide principal — the caller a widened grant would create:

| Case | Result |
|---|---|
| `project` the principal is a member of | ADMIT |
| `project` they are not | DENIED |
| `system` whose project they cannot reach | DENIED |
| the same system, from a member of its project | ADMIT |
| `vendor` with **no** membership at all | ADMIT |
| `action` owned by a project peer | DENIED |
| the same action, to its assignee | ADMIT |

## S / T. Cross-tenant and type/id collision

| Case | Result |
|---|---|
| the same twin id from another tenant | 404 |
| the same vendor id from another tenant | DENIED |
| `SHARED_ID` under `scopeType=system` (system → PROJECT_B, caller a member) | 200 |
| `SHARED_ID` under `scopeType=project` (the id IS a project, caller not a member) | 404 |

The last pair is §34: one identifier, two kinds, two different tables. The KIND
chooses what is resolved — never the id.

## U. Membership revocation

```text
member of PROJECT_B → twin projection ADMIT
membership closed in the fixture
same principal      → DENIED
```

No token involved: scope is resolved from live state on every call.

## V. SELF proof

See J. Additionally the Personal Inbox suites pass unmodified, and mutant D
(reclassifying the action twin as `PROJECT_SCOPED`) fails.

## W. Functional capability proof

A `project_manager` — who holds the project but not `crossdomain.read` — gets
**403** on a twin route, and the twin is never looked up: the functional gate
refuses first, asserted by scanning the issued statements for
`operational_twins`.

Capability and scope remain independent in both directions: 403 for the missing
function, 404 for the missing scope.

## X. Query and performance analysis

```text
twin route, admitted     principal 1 + twin selector 1 + entity/parent 1 + membership 1
twin route, refused      the same, then STOP — no payload query at all
readiness, admitted      principal 1 + scope resolution + cache read (+ upsert on miss)
readiness, refused       principal 1 + scope resolution — 0 cache reads, 0 writes
live-feed                principal 1 + ONE event query, whatever the event count
```

The twin selector lookup is deliberately the narrowest possible query — two
columns — because everything downstream of it is sensitive.

## Y. Cache analysis

`operational_forecasts` is the only cache in the set. The guard is middleware,
so authorization precedes both the cache read and the upsert — never
`cache hit → return` (§52). Proved: a refused caller produces zero forecast
writes **and** zero cache reads.

**Cache key safety (§16) — verified, no change needed.** The read predicate is
`tenant_id, forecast_type, scope_type, scope_id, horizon_days` and the upsert's
`ON CONFLICT` names the same five. Tenant A/Project X cannot collide with
Tenant B/Project X, and `project/123` cannot collide with `system/123`, because
both `tenant_id` and `scope_type` are already part of the key. Reported as
inspected rather than altered.

## Z. Phase-3 counters

```text
TOTAL EXTRACTOR ROWS ......... 765     CANONICAL ENDPOINT TOTAL ..... 747
EXTRACTOR-ONLY SAML ............. 9     extraction anomalies ........... 0

PROJECT-BOUND ENDPOINTS ....... 350    (unchanged — this slice adds a policy
                                        layer beside record scope, not new
                                        project-bound classifications)

COLLECTIONS   candidates 108   protected 82
DIRECT-ID     candidates  60   protected 56   open 4
MUTATIONS     candidates 182   record-scoped 174
CONSEQUENTIAL             31   record-scoped  31

RECORD_SCOPE  candidates 350   protected 312   deferred 38   unexplained 0
RECORD_SCOPE_PROTECTED_AT_THIS_COMMIT ......................... 321

TARGET ROUTES  total 6 (5 named + 1 sibling)   protected 6   deferred 0
POLYMORPHIC_SCOPE_TYPE_UNEXPLAINED ............................. 0
PHASE3H_ROUTE_UNEXPLAINED ...................................... 0
```

Movement against the certified parent:

```text
endpoints enforcing scope . 315 → 321   (+6, the six target routes)
direct-ID protected ......... 55 → 56   (the twin projection route)
direct-ID open ............... 5 → 4    (only SELF surfaces remain)
```

**Every project-bound direct-ID read that was open for a MODEL reason is now
closed.** The four that remain are personal records whose ownership rule is
strictly narrower than project membership — deliberately open, not unclosed.

## AA. Phase-2 census non-regression

```text
PENDING_PHASE2 0   UNCLASSIFIED 0   anomalies 0
SAML: 9 declarations / 18 mounted rows / project-bound 0 — unchanged
```

## AB. Holder comparison

```text
HOLDER DELTA = 0   (byte-identical to 233e0d7)
```

`crossdomain.read` and `crossdomain.write` holders unchanged; the temporary
Owner-only policy is untouched (§42). Every target route keeps the exact
capability it had, asserted by name.

## AC. Regression suites

```text
ENTRY   tsc / typecheck:modules pass; 219 files, 7886 tests, 0 failed
EXIT    221 files, 7940 tests, 0 failed
        Phase-3H ratchet     28 tests
        Phase-3H behaviour   26 tests
```

All prior phases pass **unmodified** except pins that exist to be moved: the
adoption count (315 → 321) and the Phase-3G direct-ID pins (55 → 56 protected,
5 → 4 open), because Phase 3H closed the twin route Phase 3G had carried
forward. The Phase-3G assertion that no `operational_twins` entry exists in the
RECORD-scope registry was reworded rather than deleted — it is still true, and
still worth holding: the twins got a policy in the POLYMORPHIC registry, and an
entry in the record-scope one would still be an invention.

## AD. Mutation proof

Each planted independently and reverted; `api/authz/capabilities.ts` verified
byte-unchanged.

| Mutant | Change | Result |
|---|---|---|
| **A** | project scope bypass (`canAccessProject` result discarded) | **RED** — 7 failed |
| **B** | unknown kind returns `ADMIT` | **RED** — 6 failed |
| **C** | tenant predicate removed from the TENANT_GLOBAL branch | **RED** — 2 failed |
| **D** | action twin reclassified `PROJECT_SCOPED` | **RED** — 4 failed |
| **E** | `system` resolver pointed at `projects` | **RED** — 2 failed |
| **F** | readiness cache reached before authorization (guard removed) | **RED** — 5 failed |
| **G** | live-feed policy branch removed | **RED** — 1 failed |
| **H** | pagination before authorization (predicate dropped from the query) | **RED** — 1 failed |
| **I** | capability bypass on a twin route | **RED** — 3 failed |
| **J** | SELF ownership clause weakened in the collection predicate | **RED** — 1 failed |

**Two survived their first run, and that is the most useful thing in this
report.** Mutants H and J both stayed green because `crossdomain.read` is
Owner-only and the Owner holds `personal.admin` — so the live-feed SELF branch
emits nothing for the only caller who can reach the route, and a behavioural
suite cannot distinguish a correct predicate from an absent one. Two structural
assertions were added: the predicate's presence and its position before
`ORDER BY`/`LIMIT` in the replay query, and the emitted ownership clause for a
non-admin principal. Both mutants now fail.

Recorded rather than quietly fixed, because it is a general lesson: on an
Owner-only surface, behavioural tests cannot prove a scope predicate, and the
proof has to move to the source.

## AE. Extractor regression

Phase-3C through 3G hardening intact — balanced route parsing, multi-router
attribution, intra-file sub-routers, indirect guards, capability detection,
record-scope detection, `readsFrom`/`primaryReadTable` paren-depth parsing,
`UNRESOLVED_DATA_ACCESS`. Anomalies 0, no silent drops.

One addition: `requireTwinScope`, `requirePolymorphicScope` and
`polymorphicCollectionScopeSql` were added to the record-scope call list, in
both the extractor and its test-side census twin, so the two cannot diverge.

## AF. Three-run inventory determinism

```text
entry (233e0d7)  94f93d52…  ×3
exit  (4f559b4)  c0a5a179…  ×3
3/3 BYTE-IDENTICAL
```

No generated evidence was hand-edited.

## AG. One final full-suite result

```text
Test Files  221 passed (221)
     Tests  7940 passed (7940)
    Failed  0     Skipped  0     Duration  19.38s
```

No host pollution. No five-run campaign; none claimed.

## AH. Static / build / security / lint

```text
tsc --noEmit 0 errors   typecheck:modules 0 errors   build ✓ 397ms   diff --check clean
security gate: scan_secrets CLEAN, validate_claude_agents PASS — HOLD CLEAR 🟢
eslint over changed/new files: 0 errors, 0 warnings
```

One warning appeared and was fixed at source: threading the predicate through
`pollEvents` made a file-level `eslint-disable @typescript-eslint/no-unused-vars`
in `wsGateway.ts` stale, so the directive was removed rather than left
suppressing nothing. `package-lock.json` unchanged.

## AI. Migration status

No migration written or applied; 085 and 086 untouched. **No persistent scope
mapping table was needed** (§80): every supported kind resolved against an
existing table, and the four that did not have no table to map to. Deployment
dependency unchanged.

## AJ / AK / AL / AM. Carried forward, unchanged

SAML (9 declarations / 18 rows / project-bound 0). `GET /files/download/:token`
and its one-hour post-revocation window. The `ai.govern` administrator-exposure
sweep. The sub-collection parent-guard consistency sweep.

## AN. Residual risks

1. **The realtime `readiness` scope is refused, not modelled.** Two producers
   write different identifier kinds. Refusing is the safe direction, but it is a
   **behaviour change**: commissioning readiness events that previously appeared
   in `/ops/live-feed?scope=readiness` no longer do, for anyone. Only the Owner
   could see them, and they were unauthorizable as written — but this is the one
   place where closing the model removed something a caller used to receive, and
   it should be a deliberate product decision rather than a silent consequence.

2. **Four twin kinds are declared with no table.** `equipment`, `permit`,
   `site`, `region` refuse. If any is a planned feature, its policy must be
   written when the table is — the set-comparison ratchet forces that, but it
   forces it as a build failure, which is a blunt way to learn.

3. **Three realtime scopes have no producer.** `project`, `module`, `assignee`
   match no rows today. The entries exist so a producer added later cannot
   inherit tenant-wide visibility.

4. **The live-feed SELF branch is holder-neutral today** and its proof is
   structural (Q, AD). Correct now, but a source assertion is weaker evidence
   than a behavioural one — if `crossdomain.read` is ever widened, that surface
   deserves real behavioural tests immediately.

5. **`PLATFORM_GLOBAL` is declared and unused.** Asserted empty so it cannot
   become a hiding place, but an unused branch is untested code.

6. Unchanged: the download-token window; the temporary Owner-only `crossdomain`
   policy; the SAML census gap; full-repo determinism; migrations 085/086
   unapplied.

## AO. Recommendation

```text
NEXT:
ADR-014 PHASE 3I — AI.GOVERN ADMINISTRATOR EXPOSURE SWEEP
```

Chosen over the sub-collection guard sweep on live risk, and the evidence for
that is Phase 3G's own finding: `GET /agent-actions/_stats` was aggregating
across every project in the tenant **for the platform administrator**, because
`ai.govern` reaches admin as well as owner and admin holds no tenant-wide
project scope. That was one route found by accident while auditing something
else. The capability sits on other AI-governance routes that have never been
examined for the same asymmetry, and the administrator/owner split is precisely
the shape that hides this class of defect.

The sub-collection sweep (Phase 3F AL.5, Phase 3G AL.5) remains worth doing and
is cheap insurance, but it is checking that something already believed correct
*is* correct — a lower-yield use of a slice than looking where a real leak was
already found.

Sequence: (a) the `ai.govern` sweep, (b) the sub-collection guard sweep,
(c) the download-token revocation window. The authorization rollout is close to
done: every project-bound surface is now scoped, holder-neutral on an
enforced ratchet, or SELF.

---

*Phase-3H completion evidence. A pushed branch and this report are not promotion
authorization. No PR was opened, nothing was merged, tagged, released or
deployed, and no owner database migration was applied.*
