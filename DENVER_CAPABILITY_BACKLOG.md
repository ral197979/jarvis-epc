# Denver Engineering — Capability Backlog

Deferred work identified by the feature-truth audit (`audit/denver-feature-truth`). **Nothing in this file was implemented** — this is the honest gap list, not a delivery record.

Ordered by user-visible impact.

---

## P1 — User-visible defects

### B-01 · Directory renders permanently empty (`BROKEN_OR_DEAD`)
`DirectoryView.tsx` destructures `vendors / customers / purchaseOrders / contracts / invoices` from props, but `ContentRouter.tsx`'s `sharedProps` passes only `{policy, biz, onNavigate, onAudit, onToast}`. The five data props are never supplied, so the page is empty regardless of backend health. Confirmed still open on `main`.
**Fix:** read from `useBizStore` directly (as sibling views do) **or** pass the props for the `directory` tab. Add a render test asserting non-empty with seeded data.

### B-02 · ~25 `useBizStore` collections never hydrated (`PARTIAL` ×~10 routes)
Only the `projects` collection is hydrated (`hydrateProjectsFromBackend`, PR #18). CRM, Safety, Hub, Dashboard, Documents, Portfolio/Finance, and the legacy hubs read collections nothing populates from the backend — they render empty with **no error**, indistinguishable from "no data".
**Fix:** extend the established hydration pattern per collection, verifying each endpoint's response shape. Per-collection tests.

### B-03 · "FEED" is a financial journal, not Front-End Engineering Design
The `feed` route is step ① of the Engineering lifecycle but renders Invoice/Expense/Journal + "+ Journal Entry".
**Fix:** product decision — rename the nav/lifecycle entry, or point step ① at the real FEED surface. Do not leave the label/content mismatch.

### B-04 · Two hidden `VERIFIED_NATIVE` features are unreachable from the sidebar
`commissioning` (full Cx workflow) and `audit` (tenant-scoped audit log + CSV export) are real, working, and only reachable by deep link.
**Fix:** product decision on surfacing them in navigation.

## P2 — Integration and platform honesty

### B-05 · MCP catalog: ~34 of 43 tools unreachable by default
`AVA_MCP_URL` is blank in `.env.example`; those tools return `503 ava_not_configured`. The catalog also carries fabricated static resource stats, and there is no `@modelcontextprotocol` SDK (hand-rolled REST).
**Fix:** either provision/document the Ava dependency as required infrastructure, or trim the advertised catalog to what is reachable. Surface per-tool availability in the UI.

### B-06 · All integration connector syncs are no-ops
`integrationSync.ts` logs and returns a clean zero-record result for every connector type (Procore, SAP, Primavera, MS Project, Aconex, BIM360).
**Fix:** implement per-connector sync, or mark connectors unavailable in the UI rather than enable-able.

### B-07 · Notification delivery not implemented
In-app / email / Slack channels are stubs. They now fail honestly (P0-08) instead of reporting fake success, so SLA escalation engages — but nothing is delivered.
**Fix:** implement at least the in-app channel (write-through to a `user_notifications` table + SSE push).

## P3 — Engineering calculation engines (largest effort; explicitly out of audit scope)

**Do not mark any of these `VERIFIED_EXTERNAL` until Denver can invoke them over a configured, tested runtime path.** Calculation code existing in another repository is *not* integration.

| ID | Discipline | Required work |
|---|---|---|
| B-08 | WWTP | Implement + test a runtime bridge to a validated WWTP calculation service |
| B-09 | Pump / hydraulics | Expose a validated pump-head calculator as a reachable MCP tool or HTTP endpoint |
| B-10 | PWTP | No backend exists — build or integrate |
| B-11 | Process equipment (separator, flash/VLE, reactor, mass balance, HX, pressure vessel) | No backend exists — build or integrate |
| B-12 | HVAC / MEP (ASHRAE load, duct/pipe) | No backend exists — build or integrate |
| B-13 | Electrical / NEC | No implementation — build or integrate |
| B-14 | Stormwater | No implementation — build or integrate |
| B-15 | Fire protection (NFPA hydraulics) | No implementation — build or integrate |
| B-16 | Oil & Gas | No backend exists — build or integrate |

Until then these remain `EXTERNAL_SHELL` and must carry design-assist / engineer-review language (see `DENVER_ENGINEERING_TOOLS_STATUS.md` §4).

## P4 — Observability / hygiene (carried from prior audits)

| ID | Item |
|---|---|
| B-17 | `slog()` discards its `data` argument on the console path — recurring `[scheduler] [promoter] Failed` errors are undiagnosable in production logs |
| B-18 | Version-string drift across ≥7 surfaces (package.json, health endpoint, startup log, login screen, Settings, OpenAPI, diagnostics) |
| B-19 | 76 of 91 `query()` call sites bypass `tenantQuery()` (RLS backstop) — prior audit finding, config path fixed but sweep incomplete |
| B-20 | `budgets.ts` interpolates a JWT claim into SQL instead of parameterizing (not currently exploitable) |
| B-21 | Frontend error-handling anti-pattern: bare `catch` with no `console.error` across ~10 views |
