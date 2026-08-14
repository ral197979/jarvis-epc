# ADR-014 — Navigation Is a Projection of Effective Authorization

- **Status:** Proposed (2026-08-13)
- **Decider:** Repository owner (pending)
- **Related:** `NAVIGATION.md`, `DENVER_FEATURE_TRUTH.md` §7, `PRODUCT_REQUIREMENTS_DOCUMENT.md` P0-1,
  `src/config/navigation.ts`, `src/components/NavSidebar.tsx`, `src/modules/auth/index.ts`, `api/auth.ts`
- **Origin:** A Claude Design prototype of Denver's UI/UX (`Denver Engineering.dc.html`) modelled the
  rule below. Reviewing it against this repository surfaced that the rule is not merely a UX
  preference — Denver's shipped client currently uses navigation *as* its access-control mechanism.

## Context

Denver's tenant isolation is genuinely enforced in the database: every tenant-scoped table carries
RLS `USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)`, and request-path
traffic runs as the non-owner `jarvis_app` role so RLS cannot be bypassed (migrations `072`, `075`).
**That axis is not in question and this ADR does not touch it.**

The *module* authorization axis — which of Denver's ~62 screens a given user may open — is a
different story. Today it is client-side only, expressed in three tables that disagree with each
other and with the database.

### Finding 1 — The sidebar filter is the only client gate, and it fails open

`src/components/NavSidebar.tsx:46-59` is the entire client-side authorization surface:

```ts
const _filtered = orderedItems.filter(item => {
  if (navHidden[item.id]) return false
  if (cfg.activeRole === 'owner' || !cfg.activeRole) return true
  if (cfg.activeRole === 'admin') return true
  if (cfg.activeRole === 'engineer' || cfg.activeRole === 'project_manager') {
    return ['operations','engineering','construction','documents','field'].includes(item.domain ?? '')
  }
  if (cfg.activeRole === 'viewer') {
    return ['operations','documents'].includes(item.domain ?? '')
  }
  return true
})
// Safety: if filter wipes everything (bad persisted state or unknown role), show full nav
const visibleItems = _filtered.length ? _filtered : orderedItems
```

Two fail-open paths:

1. **The trailing `return true` (L56).** The `user_role` enum in
   `api/db/migrations/001_tenants_and_users.sql:17-25` defines seven roles — `owner`, `admin`,
   `project_manager`, `engineer`, `procurement`, `field_ops`, `viewer`. The filter branches on five.
   **A `procurement` or `field_ops` user therefore matches no branch and is shown the entire
   sidebar**, including Cost Control, EVM, Billing, Portfolio and Administration.
2. **The explicit safety net (L58-59).** If the filter returns empty for any reason — unknown role,
   stale persisted `navOrder`, a `navHidden` map that hides everything — the full navigation is
   restored. A degraded auth state widens access rather than narrowing it.

### Finding 2 — There is no route guard at all

`src/components/ContentRouter.tsx` contains no authorization logic. Grepping it for
`role|allowed|guard|Restricted|403|canSee` returns exactly one hit: `role="main"`, an ARIA
attribute (L250). The router maps a tab id to a lazy component and renders it.

Consequently a restricted screen is reachable by any path that sets the active tab without going
through the sidebar: a deep link, a persisted `ui.tab` from a prior session or role, a
`useDeepLink` jump from a Focus card, or a cross-link from a KPI. **Hiding the item is the only
thing standing between a viewer and the Cost Control screen.**

### Finding 3 — Three client tables, two role vocabularies

| Table | Location | Shape | Role keys |
|---|---|---|---|
| Sidebar domain filter | `NavSidebar.tsx:46-57` | nav `domain` → allowed | `owner`, `admin`, `engineer`, `project_manager`, `viewer` |
| `PERSONAS[].tabs` | `src/modules/auth/index.ts:75-81` | explicit tab allowlist | `owner`, `exec`, `pm`, `engineer`, `viewer` |
| `POLICY_ACTIONS` | `src/modules/auth/index.ts:86-97` | action verb → allowed | same as `PERSONAS` |

`PERSONAS` uses `exec` and `pm`, which **do not exist in the `user_role` enum**, and omits `admin`,
`procurement` and `field_ops`, which do. `PERSONAS.pm.tabs` grants nine tabs; the sidebar filter
grants `project_manager` five whole domains — a far larger set. The two tables cannot both be
right, and `NAVIGATION.md` documents only the sidebar one, so the drift is undocumented.

### Finding 4 — Server-side module authorization is essentially absent

`requireAuth` is applied 252 times across `api/` (non-test) — authentication is thorough.
`requireRole` (`api/auth.ts:330`) exists and works, but is applied only on administrative
endpoints: `auth/saml/samlRoutes.ts`, `routes/scim.ts`, `routes/ecosystem.ts`, plus local
`_requireRole` helpers in `routes/novaIntegrationStatus.ts` and `routes/commissioning.ts`.

**No cost, budget, EVM, portfolio, change-order, risk or document route requires a role.** An
authenticated `viewer` or `field_ops` JWT can call those endpoints directly. Client-side hiding is
therefore not a defence in depth over a server gate — it is the only gate that exists.

### What the prototype demonstrated

The design prototype implements the rule this ADR adopts: one `SCREEN_CAP` registry mapping every
destination to the capability that opens it, a single `canSee()` consumed by *both* the sidebar
projection and the route guard, position→capability grants rather than position→screen lists,
scope (`assignedProjects`) modelled separately from position, and `portfolio.view` distinct from
`project.view`. Blocked routes resolve to a 403 that names the missing capability. It is
client-only and unpersisted, so it is a specification, not an implementation.

## Decision

**Adopt the rule: navigation is a projection of effective authorization, never the enforcement.**

Concretely:

1. **One capability registry.** A new `src/config/capabilities.ts` defines `Capability` (e.g.
   `cost.view`, `portfolio.view`, `project.list.all`, `project.list.assigned`), `SCREEN_CAP:
   Record<NavId, Capability>` covering every id in `NAVIGATION_ITEMS` *and* every hidden
   `TAB_MAP`-only route, and `ROLE_CAPS: Record<UserRole, Capability[]>` keyed on the **seven
   `user_role` enum values** — no invented roles.
2. **One decision function.** `canSee(navId, authRole, previewRole?)` reads that registry. It is the
   only authorization predicate on the client, and its subject is the **authenticated** role
   (`auth.role`, from the JWT). Any client-owned preview is a second argument that can only narrow
   the result by set intersection.
3. **Two consumers, no third table.** `NavSidebar` filters with `canSee`. `ContentRouter` gains a
   guard that calls the same `canSee` and renders a 403 state naming the missing capability. The
   sidebar filter's `domain` branching and `PERSONAS[].tabs` are both deleted.
4. **Fail closed.** An unknown role, a missing `SCREEN_CAP` entry, or an empty filter result denies.
   The `_filtered.length ? _filtered : orderedItems` fallback is removed.
5. **Server enforcement is mandatory, not optional.** A `requireCapability(cap)` middleware in
   `api/auth.ts` derives capabilities from the JWT `role` claim using a server copy of `ROLE_CAPS`,
   and is applied to every module router. A CI test asserts client and server registries are
   identical, so they cannot drift the way the three current tables have.
6. **Scope is separate from position.** `portfolio.view` (cross-project totals) and `project.view`
   (depth on assignments) are distinct capabilities. Project-scoped queries filter by the user's
   assigned projects server-side.

## Consequences

**Positive**

- Closes a real authorization gap rather than restyling one: no fail-open, no unguarded routes,
  no undocumented drift, and module access enforced where it can't be bypassed.
- Deleting two of three tables removes the drift surface permanently.
- `procurement` and `field_ops` — currently unhandled — become first-class. (This required widening
  `OwnerConfig['activeRole']` from five values to all seven; the registry alone was not enough.)
- Makes the honest 403 state possible, which the shipped app has no equivalent of.

**Negative / cost**

- Touching authorization is Class-3 work under `CLAUDE.md` §8 and requires independent security
  review before implementation.
- Every module router needs a middleware line; roughly 60 route files.
- Any user whose role currently benefits from a fail-open will lose screens. This is the point, but
  it is a visible behaviour change that needs release notes.
- A capability registry is a second thing to keep in step with `navigation.ts`; mitigated by a
  completeness test asserting every nav id and every `TAB_MAP` key has a `SCREEN_CAP` entry.

## Implementation phases

| Phase | Scope | Risk | Gate |
|---|---|---|---|
| 1 | `capabilities.ts`, `canSee`, `ContentRouter` guard + 403 state, fail-closed, delete `PERSONAS.tabs` and the domain filter, completeness + fail-closed tests | Client-only, reversible | **Implemented — see below.** Security review before merge |
| 2 | `requireCapability` middleware, JWT-derived caps, applied to all module routers, client/server parity test | **Class 3** | Independent security review; owner merge authorization |
| 3 | Assigned-project scoping in project-scoped queries; `My Projects` vs org-wide registry split | Class 3 (data exposure) | Independent review |
| 4 | Access-request → approval → grant workflow | Deferred | Only if explicitly commissioned |

Phase 4 is **not** authorized by this ADR. Per the prototype's own framing, a "Request access"
button with no approval queue behind it is a fake affordance; it ships only if the queue ships.

## Explicitly out of scope

- **Tenant isolation / RLS.** Unchanged. This ADR adds a module axis above it, not a replacement.
- **The prototype's visual design.** Not adopted here. This ADR takes the authorization model only.
- **The prototype's 14 "positions."** Denver's authorization unit stays the seven-value `user_role`
  enum. Positions are a UI label; introducing them is a separate schema decision.
- **Field-level scoping** (hiding rows or filters inside a module a user may open). Unmodelled in
  the prototype and unmodelled here.

## Verification performed (2026-08-13)

Evidence for the four findings, gathered by reading source on `origin/main` @ `f5883c3`:

- `NavSidebar.tsx:46-59` read in full — fail-open branches confirmed at L56 and L58-59.
- `ContentRouter.tsx` grepped for `role|allowed|guard|Restricted|403|canSee` — single hit,
  `role="main"` at L250. No guard exists.
- `src/modules/auth/index.ts:75-81` and `:86-97` read — `PERSONAS` and `POLICY_ACTIONS` confirmed as
  independent tables using `exec`/`pm`.
- `api/db/migrations/001_tenants_and_users.sql:17-25` read — seven-value `user_role` enum confirmed;
  `procurement` and `field_ops` are unhandled by the sidebar filter.
- `requireAuth` — 252 non-test occurrences in `api/`. `requireRole` — administrative routers only
  (`samlRoutes.ts`, `scim.ts`, `ecosystem.ts`, `novaIntegrationStatus.ts`, `commissioning.ts`).

**Not verified against a live database.** The local dev database is empty (0 tenants, 0 users), as
recorded in `DENVER_FEATURE_TRUTH.md` §"Verification-limit disclosure", so the fail-open paths were
established by source reading, not by signing in over SSO as a `procurement` user. Verification tier
for the *findings*: **`code`**, not `runtime`.

The Phase 1 *fix* is proven behaviourally — see below.

## Phase 1 implementation status (2026-08-14, after remediation)

Implemented on `docs/adr-014-authorization-projection`. **Not reviewed, not merged, not deployed.**

### What Phase 1 is

A **client authorization projection** driven by the authenticated role:

- the sidebar shows only destinations the effective capabilities permit — unauthorized entries
  disappear entirely (no greyed-out items, no locks, no empty section headings);
- the route guard independently denies direct URLs, stale bookmarks, persisted tabs, hand-edited
  `?tab=` values, programmatic `setTab` and localStorage manipulation;
- the OwnerPanel position picker is a **preview**, applied by set intersection, so it can only ever
  show a user less than they already have.

### What Phase 1 is not

**It is not the security boundary.** It runs in the browser and can be bypassed by calling the API
directly. Server functional authorization is Phase 2 and is **not implemented** — approximately
406 of 438 endpoints remain authentication-only. Until Phase 2 lands, a valid tenant JWT is
sufficient to invoke nearly every business function regardless of what this registry says.

### The Phase 1 defect this remediation closed

The first Phase 1 implementation (`ed9dbcf`) built the registry correctly but wired it to the wrong
subject: both consumers read `ownerConfig.activeRole` — a UI picker, persisted to localStorage,
defaulting to `owner` — while `auth.role`, the role the server issues at login, was written by
`LoginScreen` and **read by nothing**. Runtime proof of the resulting fail-open, captured before the
fix:

```text
auth.role = viewer   ownerConfig.activeRole = owner
sidebar rendered      = 62 / 62
visible to that viewer: costcontrol, budget, evm, billing, system, mcp, integrations
direct costcontrol deep link -> no 403
```

The registry was never the problem; the binding was. Two supporting defects made it invisible:
`OwnerConfig['activeRole']` was a five-value union, so `procurement` and `field_ops` were not
representable and their tests had to cast through `as never`; and every behavioural test set the
preview value directly, so the suite proved the registry agreed with itself and never exercised the
authenticated path.

### Model

| Input | Meaning |
|---|---|
| `auth.role` | The authenticated position, from the JWT. **The subject of every decision.** |
| `ownerConfig.activeRole` | The OwnerPanel preview. Client-owned, therefore never authoritative. |

```text
no valid authenticated role     → ∅
valid auth, no/invalid preview  → the authenticated capabilities
valid auth + valid preview      → auth ∩ preview
```

Intersection is deliberate: roles are **not** a hierarchy and are not subsets of one another. An
engineer previewing procurement gets `engineer ∩ procurement` — it must not acquire
`procurement.view` merely because procurement holds fewer capabilities in total. Nothing in the
implementation ranks, counts or orders roles. `effectiveWriteRole()` applies the same rule to write
affordances, so an authenticated viewer cannot regain write controls by previewing an owner.

**Local PIN mode limitation.** Only proxied (multi-tenant) mode has a server-issued role. In local
PIN mode `LoginScreen` seeds `auth.role` from stored config, because there is no server to consult
and the PIN is the gate. That is a property of local mode, not a fallback for proxied mode.

### Role model changes

- **Platform Administrator is no longer a second owner.** `admin` aliased `ALL_CAPS`. It now holds
  `platform.admin` + `audit.view` — a four-destination rail (system, automation, integrations, MCP)
  plus the hidden audit reader. It receives no portfolio, org-wide registry, project delivery,
  engineering, construction, commissioning, commercial, procurement-delivery or CRM capability.
  *Known consequence:* `personal.view` bundles the project-delivery queues (`focus`, `mywork`,
  `actions`) with `notifications`, so withholding it leaves an admin without a personal inbox.
  Splitting `notifications` out is a product decision, not an authorization one.
- **Project Manager is not a portfolio role.** `project.list.all` removed (it never held
  `portfolio.view`). A PM manages assigned projects, not the organisation-wide registry.
- **Procurement still has no schedule visibility — a known capability-design gap.** Required-on-site
  dates sit behind `schedule.view`, which also opens `forecast` (Monte Carlo simulation). Granting it
  would over-grant, so it is withheld. The fix is to split `schedule.view` into dated-milestone read
  vs forecast/simulation. Recorded for Phase 2, not worked around here.
- **Engineer** keeps engineering and project depth and does **not** get the org-wide registry back.
  It therefore has no listing surface from which to enter a project. That dead end is real; it
  belongs to Phase 3 record scope (`My Projects`), not to a wider grant.

### Hidden destinations

Eight `TAB_MAP` destinations are absent from `NAVIGATION_ITEMS`, so a stale bookmark is the only way
in. Five previously shared the generic `project.view`, which **every** role holds — so a viewer could
deep-link the procurement and engineering module hubs, the labour register and the jobs register.
Each is now mapped to the capability matching what it actually renders:

| Destination | Renders | Capability | Roles |
|---|---|---|---|
| `commissioning` | CommissioningView | `commissioning.view` | owner, project_manager |
| `procurement` | ProcurementView — vendors, POs, bids | `procurement.view` | owner, project_manager, procurement |
| `engineering` | EngineeringView — deliverables, transmittals, calc | `engineering.view` | owner, project_manager, engineer |
| `plan` | PlannerView — logistics + bid items | `procurement.view` | owner, project_manager, procurement |
| `resources` | ResourcesView → LiView — labour items, rates | `team.view` | owner, project_manager |
| `jobs` | JobsView — org-wide contracts/jobs register | `project.list.all` | owner |
| `overview` | DashboardMainView — portfolio roll-up | `portfolio.view` | owner |
| `audit` | AuditLogView — tenant audit reader | `audit.view` | owner, admin |

No hidden destination is open to every role.

### Resulting projections

Machine-generated from the final commit. Sidebar = of 62 `NAVIGATION_ITEMS`; total = of 70
registered destinations.

| Role | Capabilities | Sidebar | Total |
|---|---:|---:|---:|
| owner | 20 | 62 | 70 |
| project_manager | 14 | 43 | 48 |
| engineer | 9 | 33 | 34 |
| field_ops | 7 | 24 | 24 |
| procurement | 5 | 19 | 21 |
| viewer | 3 | 12 | 12 |
| admin | 2 | 4 | 5 |

Registry completeness at the same commit: 62 nav ids, 70 `TAB_MAP` destinations, 70 `SCREEN_CAP`
registrations, 0 unregistered, 0 unreachable, 0 empty mappings. Elevation violations across all 49
ordered (authenticated, preview) role pairs: **0**.

### Residual gaps — open security issues, not future enhancements

1. ~406 of 438 API endpoints are authentication-only; ~30 approval/state-transition endpoints
   (timesheets, AI governance, subcontract invoices, punch verification, estimates, runbooks) have
   no functional authorization. **Phase 2.**
2. No user↔project membership model exists. `project_assignments.member_id` references the
   `team_members` HR roster, which has no foreign key to `users`. No project-scoped RLS exists.
   **Phase 3.**
3. Jarvis / knowledge retrieval is not capability-filtered: `POST /api/v1/ask` needs only a valid
   tenant JWT, so a route denial is bypassable via RAG. **Phase 3.**
4. JWT roles go stale — `requireAuth` trusts `payload.role` and never re-resolves against
   `users.role`, so a demotion does not take effect until the token expires. No token versioning or
   session invalidation on role change. **Phase 2 decision.**
5. Client write authority still fails open for four roles: `PERSONAS` is keyed `owner`/`exec`/`pm`/
   `engineer`/`viewer`, so `admin`, `project_manager`, `procurement` and `field_ops` resolve through
   `PERSONAS[role] ?? PERSONAS.owner` to owner-like write authority. `effectiveWriteRole()` closes
   the *preview* elevation but not this; closing it requires deciding which roles may write, which
   is product semantics.
6. `checkPolicyServer()` falls back to client-side policy on network failure — currently inert, as it
   is imported by `JarvisCore.jsx` but never called, and `/api/v1/policy/check` does not exist.
7. No field-level authorization anywhere; endpoints return whole records.

### Behaviour changes to call out in review

Grants are stated by function rather than by the nav `domain` tag, so access moves. Every role except
`owner` loses destinations relative to `ed9dbcf`, because the five generic-`project.view` hidden hubs
are now properly gated. `admin` drops from 62 sidebar destinations to 4. This is the point of the
change, and it is a visible behaviour change that needs release notes.
