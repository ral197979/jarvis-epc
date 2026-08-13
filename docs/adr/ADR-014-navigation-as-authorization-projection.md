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
2. **One decision function.** `canSee(navId, session): boolean` reads that registry. It is the only
   authorization predicate on the client.
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
- `procurement` and `field_ops` — currently unhandled — become first-class.
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
| 1 | `capabilities.ts`, `canSee`, `ContentRouter` guard + 403 state, fail-closed, delete `PERSONAS.tabs` and the domain filter, completeness + fail-closed tests | Client-only, reversible | Security review before merge |
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

**Not verified at runtime.** The local dev database is empty (0 tenants, 0 users), as recorded in
`DENVER_FEATURE_TRUTH.md` §"Verification-limit disclosure", so the fail-open paths were established
by source reading, not by signing in as a `procurement` user and observing the sidebar. Verification
tier: **`code`**, not `runtime`. A live reproduction should be part of the Phase 1 test evidence.
