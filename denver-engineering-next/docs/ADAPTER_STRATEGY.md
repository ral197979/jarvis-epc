# Adapter Strategy

The new UI must **reuse**, not rebuild, Denver Engineering's business logic
(auth, RBAC, EPC workflows, CRM, procurement, commissioning, EVM, documents,
actions, AI gateway). The adapter layer is the single seam that makes this safe.

## Principles

1. **Screens never call `fetch` and never import mock data.** They call React
   Query hooks (`useProjects`, `useCompletionMatrix`, …) from `@adapters`.
2. **One adapter function per endpoint.** Each documents the real `/api/v1`
   route it maps to and contains the mock ↔ live seam.
3. **Types are the contract.** `backend-adapters/src/types.ts` mirrors the
   response shapes of the existing API. If the live shape differs, adapt it
   *inside* the adapter — screens stay untouched.

## The mock ↔ live seam

```ts
export const portfolioAdapter = {
  // GET /api/v1/projects  ·  LIVE-WIRED
  projects: (): Promise<Project[]> =>
    USE_MOCKS ? mock(db.projects) : fetchProjectsLive(),
}
```

## Reference implementation — Projects (live)

The **Projects/Portfolio** module is wired end-to-end as the template. See
[`backend-adapters/src/live/projectsLive.ts`](../backend-adapters/src/live/projectsLive.ts):

- `fetchProjectsLive()` → `GET /api/v1/projects?limit=100`, unwraps `{ data }`.
- `fetchProjectLive(id)` → `GET /api/v1/projects/:id`.
- `mapProject(raw)` converts the DB row (snake_case, `client_name`,
  `current_phase`, `budget`, `actual_cost`, `progress_pct`, `metadata`, …) into
  the UI `Project` type — deriving `health`, `budgetStatus`, `scheduleStatus`,
  and compact `contractValue`. **All impedance mismatch lives in the mapper**, so
  `ProjectsPage`, `ProjectWorkspace`, and the dashboard need zero changes.
- The mapper is pure and unit-tested (`__tests__/projectsLive.test.ts`).

To wire another module, copy this pattern: add a `live/<module>Live.ts` with a
mapper + fetchers, then swap the `Promise.reject('x')` branch in `adapters.ts`.

## Project-scoped resources

Commissioning's **Deficiencies** and **Equipment** are also live-wired
(`live/commissioningLive.ts`). Their endpoints are project-scoped, so the active
project id is threaded from the UI store (`useUi().activeProjectId`) into
`useDeficiencies(projectId)` / `useEquipment(projectId)`; it's part of the React
Query key, so switching projects refetches. Mock mode ignores the argument.

### Known gap — Completion Matrix

The matrix needs **per-lifecycle-stage** status per system (DESIGN → TURNOVER),
but `GET /projects/:id/systems` returns only a single flat `status` per system.
We deliberately keep the matrix on mock rather than fabricate stage cells. To
wire it for real, the backend should expose stage-level completion, e.g.:

```
GET /api/v1/projects/:id/systems/completion
→ { items: [{ id, tag, name, category, stages: { DESIGN: 'complete', PROCURE: 'in-progress', … } }] }
```

Then add `fetchMatrixLive()` to `live/commissioningLive.ts` and flip
`commissioningAdapter.matrix`.

Flip the whole app with env vars:

| Var              | Default     | Effect                                   |
| ---------------- | ----------- | ---------------------------------------- |
| `VITE_USE_MOCKS` | `true`      | Resolve fixtures; no backend required.   |
| `VITE_API_BASE`  | `/api/v1`   | Base URL for the existing Denver API.    |

## Auth & CSRF

`http.ts` sends `credentials: 'include'` (httpOnly session cookie) and an
`X-CSRF-Token` header read from the `csrf_token` cookie — matching
`api/server.ts` (`requireCsrf`, `requireAuth`, `requireTenant`). Tenant scoping
is honored via the server's active-tenant cookie, with an optional
`X-Tenant-Id` override.

## Endpoint map (existing Denver API → adapter)

| Adapter                          | Existing route(s)                                  |
| -------------------------------- | -------------------------------------------------- |
| `portfolioAdapter.projects`      | `GET /api/v1/projects` · **LIVE-WIRED** (+ `createProject` POST) |
| `portfolioAdapter.kpis`          | client-side aggregate over `GET /api/v1/projects` · **LIVE-WIRED** |
| `portfolioAdapter.insights`      | `POST /api/v1/ask` (grounded RAG) — _mock only_    |
| `projectAdapter.*`               | `GET /api/v1/projects/:id` (+ sub-resources)       |
| `commissioningAdapter.matrix`    | `GET /api/v1/projects/:id/systems` (⚠ see gap below) |
| `commissioningAdapter.equipment` | `GET /api/v1/projects/:id/tags` · **LIVE-WIRED**   |
| `commissioningAdapter.deficiencies` | `GET /api/v1/projects/:id/deficiencies` · **LIVE-WIRED** |
| `commissioningAdapter.testPacks` | `GET /api/v1/projects/:id/test-packs` · **LIVE-WIRED** |
| `procurementAdapter.pos`         | `GET /api/v1/purchase-orders` · **LIVE-WIRED**     |
| `procurementAdapter.vendors`     | `GET /api/v1/vendors` · **LIVE-WIRED**            |
| `procurementAdapter.longLead`    | _(mock only — see "endpoints that don't cleanly map")_ |
| `financeAdapter.summary`         | `GET /api/v1/projects/:id/evm/metrics` · **LIVE-WIRED** |
| `financeAdapter.trend`           | `GET /api/v1/projects/:id/evm/scurve` · **LIVE-WIRED**  |
| `financeAdapter.wbs`             | _(mock only — see "endpoints that don't cleanly map")_ |
| `crmAdapter.leads`               | `GET /api/v1/proposals` · **LIVE-WIRED**           |
| `crmAdapter.funnel`              | `GET /api/v1/proposals/summary` · **LIVE-WIRED**   |
| `engineeringAdapter.drawings`    | `GET /api/v1/projects/:id/drawings` · **LIVE-WIRED** (RFIs/submittals separate) |
| `documentsAdapter.list`          | `GET /api/v1/files/documents` · **LIVE-WIRED**     |
| `actionsAdapter.list`            | `GET /api/v1/actions` · **LIVE-WIRED**             |
| `contractsAdapter.list`          | `GET /api/v1/projects/:id/subcontracts` · **LIVE-WIRED** |
| `contractsAdapter.changeOrders`  | `GET /api/v1/projects/:id/change-orders` · **LIVE-WIRED** |
| `twinAdapter.assets`             | `GET /api/v1/twins` · **LIVE-WIRED** (list only; telemetry stream still mock) |
| `adminAdapter.users`             | `GET /api/v1/team/members` · **LIVE-WIRED**       |
| `adminAdapter.featureGates`      | `GET /api/v1/enterprise/features` · **LIVE-WIRED** |

### Endpoints that don't cleanly map (kept on mock, deliberately)

These were evaluated against the real API and found to lack a faithful backing
endpoint — wiring them would require fabricating data, so they stay on mock until
the backend gains the right shape:

- **`portfolioAdapter.insights`** — `POST /ask` is grounded **Q&A** (one question →
  one structured answer), not a "list portfolio insights" feed. Needs a dedicated
  insights/recommendations endpoint (or a curated fixed-prompt batch).
- **`financeAdapter.wbs`** — the WBS-entry endpoint stores baseline **BAC only**;
  per-line EV/AC/CPI/SPI (what the table shows) are computed at the aggregate
  level by `computeEvmMetrics`, not stored per line. Needs a per-line metrics endpoint.
- **`procurementAdapter.longLead`** — `purchase_orders` has no expediting/long-lead
  flag or filter and no per-item `progressPct`; the long-lead tracker is a curated
  view, not a PO query. Needs an expediting/long-lead model.

Plus the backend-first items with no route at all: PFC, IST, turnover, and Twin
telemetry (`/iot` stream).

### Stitch-B modules (added later, mock-backed)

New functional areas built from the second Stitch drop (latest/2026 versions;
duplicates collapsed to the most-refined screen). All mock-backed today, each
ready to wire via the same `live/*Live.ts` pattern when a route exists:

- **Inventory & Materials** (`inventoryAdapter`) — materials registry,
  requisitions, receiving. Live targets: a materials/warehouse service.
- **Schedule / Gantt** (`scheduleAdapter`) — master schedule. Live target:
  existing `/api/v1/schedule` (CPM + tasks) mapped to `GanttTask`.
- **Vendor Performance** (`procurementAdapter.vendorScores`) — would extend
  `/vendors` with KPI columns (on-time, quality, tier).
- **Scenario Modeler** (`scenarioAdapter`) — simulation/stress-test; no route yet.
- **Contract Compliance** (`contractsAdapter.compliance`) — clause/LD tracking;
  would map to a compliance endpoint.
- **Safety** (`safetyAdapter.incidents`/`.training`) — incident registry + training
  compliance. Live targets: an HSE/incidents service + training records.
- **Project Closeout** (`closeoutAdapter.ledger`) — closeout checklist + final
  handover certificate. Live target: a closeout/handover service.
- **Reports Center** (`reportsAdapter.templates`/`.recent`) — template gallery,
  generated-report log, custom builder. Live target: existing `/exports` + a
  report-generation service.
- **AI Mitigation Hub** (`mitigationAdapter.plans`/`.shifts`) — disruption
  mitigation plans + resource reallocation/shift execution. Live target: an
  optimization/recommendation engine + the existing `/agent-actions` log.
- **Mobile field track** (`mobileAdapter.assignments`/`.syncQueue`) — separate
  `/m/*` shell (Home, Site Arrival, FPT, Scan, Sync). Live targets: a field
  work-order service + the existing `/api/v1/field-sync` offline-replay endpoint.

### Stitch-C modules (Primavera P6 theme, mock-backed)

- **Schedule / P6 bridge** (`scheduleAdapter.activities`/`.wbs`/`.baselines`/`.resourceLoad`)
  — Gantt, Activities, WBS, Critical Path, Baselines, Resource loading, P6 Bridge
  (import/sync). Live targets: existing `/api/v1/schedule` (CPM) + `/scheduleImport` (XER/XML).
- **Risk** (`riskAdapter.entries`/`.contingency`) — 5×5 matrix, register, contingency
  reserves. Live target: existing `/api/v1/riskRegister`.
- **Maintenance** (`maintenanceAdapter.tasks`/`.assets`/`.lifecycle`) — planning,
  asset register, lifecycle forecast. Live target: an O&M/asset service.
- **Finance deep-dive** (`financeAdapter.cashFlow`/`.drawdowns`) — cash-flow
  forecast + drawdown requests/approvals (Finance tabs). Live target: `/budgets` + a cash/drawdown service.
- **Safety LMS/compliance** (`safetyAdapter.audits`/`.siteAccess`) — safety audits
  + site-access authorization (Safety tabs). Live target: an HSE audit + access-control service.

> Mutations (create/update) follow the same pattern via React Query
> `useMutation`; add them per module as screens gain write capability.

### Wired writes

| Mutation hook                  | Endpoint                              | UI entry point                  |
| ------------------------------ | ------------------------------------- | ------------------------------- |
| `useCreateProject`             | `POST /api/v1/projects`               | Projects → "New Project" dialog |
| `useCreateDeficiency`          | `POST /api/v1/deficiencies`           | Commissioning → "Log Deficiency"|
| `useUpdateDeficiencyStatus`    | `PATCH /api/v1/deficiencies/:id`      | Deficiency drawer → Approve/Reopen |

**Mock-write invariant (learned the hard way, verified in-browser):** mock writes
must be **immutable** — return a fresh array (`.slice()`) and replace changed rows
with new objects (`{...row, ...}`), never mutate in place. React Query's
`replaceEqualDeep` + TanStack Table memoize on reference identity, so in-place
mutation leaves the table stale even while derived KPIs (which read live object
props) update — an inconsistent UI. Live mode is immune (the API returns fresh
data each fetch). For PATCH, the row's raw UUID is carried on the domain object
(e.g. `Deficiency.uuid`) since the display id is the human code.
