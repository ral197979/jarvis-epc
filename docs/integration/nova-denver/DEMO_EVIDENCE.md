# Nova ↔ Denver Integration — Live E2E Demo Evidence

Date: 2026-07-20/21 (local) · Environment: both apps running locally, wired via the v1 integration.
Nova @ http://localhost:8090 (Postgres `nova_demo`) · Denver API @ http://localhost:3001 + worker (pgvector Postgres `denver_demo`, Redis). All flags on (`DENVER_ENABLED` / `NOVA_EXTERNAL`), fresh HMAC secret pair per direction.

## Setup (through real workflows)

| Step | How | Result |
|---|---|---|
| Nova platform bootstrap | `npm run seed:platform-bootstrap` | 4 plans, 8 flags, platform owner |
| Nova tenants + business data | `seed:platform-demo` + `seed:tenants` (drive real `/api/tenant/*` APIs) | 8 tenants; Embassy Water Co seeded with 4 customers, 4 opportunities (1 won), 1 project, POs, fabrication jobs |
| Denver tenant | `POST /api/v1/tenants` (public registration API) | Meridian EPC Contractors (`meridian-epc`), owner Dana Reyes |
| Connection binding | Documented bootstrap inserts both sides (`npm run integration:denver:connect` on Nova; SQL insert on Denver per migration-084 doc) | `conn-embassy-meridian-01`: Embassy Water Co (tenant_dbd73baa) ↔ Meridian EPC (9de0eb2d…) |

## Workflow proof table

| # | HOB requirement | Action performed | Evidence |
|---|---|---|---|
| 1 | Won opportunity → Nova project | `POST /opportunities/opp_643f992f/convert-to-project` as ops@embassywater.example ("Riverton WTP RO Train Expansion", $480k, stage=won) | 409 `{projectId: proj_92ae36e2}` — convert-once guard fired (seed had converted through the same API); project exists with customer City of Riverton |
| 2 | Authorized user creates Denver EPC project | `POST /api/tenant/projects/proj_92ae36e2/denver-link` (role-gated route) | 200 link row: `denver_project_id 5da0e53b…`, `denver_project_number PRJ-36E2`, `integration_status connected`, relative `denver_project_url` |
| 3 | Denver created it once, tenant-safe | Denver DB | `projects`: PRJ-36E2 "Riverton RO Train 3 Build-Out", client City of Riverton, tenant = Meridian only; `nova_inbound_commands`: 1 row, status created; `audit_log`: `integrate_pull / nova_project_create` |
| 4 | Repeat request → no duplicate | Same POST repeated | HTTP 409 "A Denver link already exists", returns existing link; Denver still has exactly 1 project |
| 5 | Denver progress → Nova | Dana (Denver owner) PATCHes project to `commissioning / 47%` via `/api/v1/projects/:id` | Snapshot-diff worker enqueued `denver.project.progress.updated`; outbox → delivered; Nova `denver_project_summaries`: `{overallStatus: commissioning, overallPercent: 47}` seq 3, timestamped |
| 6 | Honest partial data | Progress event payload | Discipline percents (engineering/procurement/construction/MC/commissioning) OMITTED (no honest source); Nova UI renders "Not reported", never 0 |
| 7 | Nova unavailable → visible failure | Killed Nova; Dana set progress 55% | Outbox row `queued, attempts=1, last_error="fetch failed"`; Denver integration API: `health: "degraded", failedCount: 1` |
| 8 | Permanent failure visible + manual audited retry | Row dead-lettered (simulated terminal state); `POST /projects/:id/nova-integration/retry` as Dana | Health showed `failed / deadCount 1`; retry → `{requeued: 1}`; `audit_log`: `integrate_push / nova_retry_requested / requeued=1` |
| 9 | Recovery | Nova restarted | Event redelivered (attempts reset, status delivered); Nova summary → 55%; no duplicate application (event ledger) |
| 10 | Tenant isolation | Nexus Industries ops user (2nd tenant) GET + POST on Embassy's `proj_92ae36e2` integration routes | Both 404 — cross-tenant invisible |
| 11 | Forged service call | Correctly HMAC-signed `project.create` with `connectionId=conn-embassy-meridian-01` but `novaTenantId=tenant_caf0548c` (mismatch) | HTTP 401 `{"error":"unauthorized"}` — tenant derived from connection row, payload mismatch rejected |
| 12 | UI truth (Nova Project 360, logged in via browser as Embassy ops) | Accessibility-tree walk of the live page | "Denver EPC Integration" panel: **Connected** chip, last-synchronized timestamp, Denver number PRJ-36E2, stage Commissioning, Overall 55%, five discipline metrics each "Not reported", turnover "Not started"/empty-state text, Open in Denver href `http://localhost:3001/projects/5da0e53b…`, Reconcile action, integration history listing all 6 audit events with actors (`Dana Whitfield`, `denver-integration@conn-embassy-meridian-01`) |

## Bug found and fixed by this demo

`nova_snapshot_diff` jobs were claimed by the API server's scheduler loop, which had **no Nova handlers registered** (only `api/worker.ts` registered them) → "No handler registered" failures burning retry attempts; on Fly (no separate worker) the outbox would never drain. Fixed in commit `cb6a320` (register handlers in `api/server.ts` startup, mirroring the existing `registerWebhookDispatchHandler` precedent). After the fix: snapshot jobs complete, events deliver.

## Deviations / honest notes

- Step 8's dead-letter state was reached by flipping the retrying row to `dead` via SQL — a simulation shortcut for the backoff ladder's terminal state (waiting out 5 backoff steps takes >20 min). The failure→visible→retry→redeliver path itself is fully real.
- Step 1's conversion 409 demonstrates the guard; the original conversion was performed by the seed **through the same real API**.
- Turnover-package events were not exercised live (no commissioning handoff data in the demo project yet); the path is covered by unit/contract tests on both sides.
- Browser-pane screenshots of the panel were unreliable (pane compositor artifact when scrolled); the UI evidence in step 12 is the accessibility-tree read of the live logged-in page, which reflects the exact rendered DOM.
