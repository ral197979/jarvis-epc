# Denver Engineering — Route Coverage

**Companion to** [`DENVER_FEATURE_TRUTH.md`](DENVER_FEATURE_TRUTH.md). Enforced by the `feature-truth-guard` CI job.

Derived programmatically from source — `src/config/navigation.ts` (`NAVIGATION_ITEMS`) and `src/components/ContentRouter.tsx` (`TAB_MAP`) — not from a hand-maintained list.

---

## 1. Census

| Metric | Count |
|---|---|
| Sidebar navigation routes | **62** |
| Routable tabs in `TAB_MAP` (incl. hidden) | **70** |
| Hidden/legacy routes (routable, absent from sidebar) | **8** |
| **Dead nav items** (sidebar entry with no route) | **0** ✅ |
| Capability-registry entries | **71** (70 routes + 1 routeless sub-tool) |
| Nav routes missing a registry entry | **0** ✅ |
| Phantom registry routes (registered but non-existent) | **0** ✅ |

**Registry coverage: 100%** of sidebar nav routes and all routable tabs.

## 2. Navigation sections (14)

`personal` · `setup` · `planning` · `engineering` · `procurement` · `construction` · `quality` · `safety` · `commercial` · `turnover` · `operations` · `ai` · `executive` · `admin`

## 3. Hidden / legacy routes

Reachable via `TAB_MAP` (deep-link / programmatic navigation) but **not** present in the sidebar. Each is registered in the capability registry with a `honestyIssue` noting it is hidden:

| Route | Component | Status | Note |
|---|---|---|---|
| `commissioning` | `CommissioningView` | `VERIFIED_NATIVE` | Real Cx workflow — arguably *should* be in the sidebar |
| `audit` | `AuditLogView` | `VERIFIED_NATIVE` | Real tenant-scoped audit reader + CSV export — arguably *should* be in the sidebar |
| `procurement` | `ProcurementView` | `PARTIAL` | Legacy JarvisCore hub; superseded by the newer procurement routes |
| `engineering` | `EngineeringView` | `PARTIAL` | Legacy store-backed hub |
| `plan` | `PlannerView` | `PARTIAL` | Legacy composite |
| `resources` | `ResourcesView` | `PARTIAL` | Legacy composite |
| `jobs` | `JobsView` | `PARTIAL` | Legacy store-backed |
| `overview` | `DashboardMainView` | `PARTIAL` | Wraps `HubView`; duplicates Eng Hub aggregation |

**Recommendation (deferred):** two of these (`commissioning`, `audit`) are genuinely useful `VERIFIED_NATIVE` features that users cannot reach from the sidebar — worth a product decision on surfacing them. The other six are legacy and are candidates for retirement.

## 4. Documented navigation inconsistency

The sidebar's **Engineering** section contains **9** items, while the Engineering guided-flow stepper (`src/config/workflows.ts`) contains **7**. This is *intentional*: `hub` (Eng Hub) and `fixlibrary` (Fix Library) are persistent reference tools, not sequential lifecycle stages. Pinned by a test in `src/__tests__/config/workflows.test.ts` so the gap cannot silently drift.

## 5. Feature-flagged / conditional surfaces

| Flag | Effect | Default |
|---|---|---|
| `PERSONAL_AGENT` | `/api/v1/me/agent/*` routes 404 when off | off |
| `COMMISSIONING_EXTERNAL` | External Cx workspace handoff | off |
| `AVA_MCP_URL` | ~34 MCP tools return 503 when unset | unset |
| `CAPABILITY_REGISTRY`, `UNIVERSAL_EVENTS`, `OBJECT_REGISTRY`, `KNOWLEDGE_GRAPH`, `IDEMPOTENCY`, `OPENAPI_ENABLED`, `DENVER_MCP_SERVER`, `EAP_ENABLED` | Federation features ship dormant | off |

## 6. How coverage is enforced

`scripts/validate-capability-registry.mjs` (CI job **`feature-truth-guard`**) parses the real source and fails the build when:

1. A sidebar nav route has no capability-registry entry (**new routes cannot silently bypass the truth registry**).
2. A registry route does not exist in nav or `TAB_MAP` (no phantom entries).
3. Capability ids or routes are duplicated.
4. A status is not a valid taxonomy value.

Semantic honesty invariants (evidence required for `VERIFIED_NATIVE`, `externalDependency` required for external statuses, deterministic features may not claim an LLM, unvalidated engineering calcs must require engineer review, etc.) are enforced by `src/__tests__/config/capabilityRegistry.test.ts`, which also contains negative cases proving the rules bite.
