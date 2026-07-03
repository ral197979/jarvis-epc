# Denver Engineering — Independent End-to-End Audit
**Date:** 2026-07-02 · **Auditor:** Claude (independent review, audit-only, no remediation performed)
**Scope:** Full codebase at git HEAD `b8d37e9` (branch `main`), plus uncommitted working-tree changes to `api/services/schedule/mspParser.ts` / `xerParser.ts` and untracked `api/__tests__/scheduleParsers.test.ts`.
**Method:** Runtime reproduction (live dev server + Postgres), direct source reads, executed test/lint/typecheck/audit commands, and 6 parallel independent evidence-gathering passes across backend, frontend, security, AI/data-model, and CI/deployment. Prior audit documents in `audit/` and `docs/audit/` were treated as **unverified claims**, not ground truth — every finding below was independently re-derived from current source or live command output. Where this audit contradicts a prior report, that is called out explicitly.

---

## 0. Executive Summary

Denver Engineering is a large (2,400+ module), ambitiously-scoped EPC platform with a real Postgres/RLS/JWT backend, a genuinely substantial test suite (5,268 tests, currently 100% green), and working core CRUD across projects/RFIs/submittals/EVM/IoT. It is not a fake demo. But it carries the signature pattern of a codebase that has been audited many times and patched reactively rather than systemically: **the same bug class recurs** (silent RLS bypass, missing authz on new routes, schema drift between migrations and application code, fatal logs lost on crash, stub logic dressed as real logic) even in areas prior audits marked "GO."

The reported symptom — **My Work page shows "Couldn't load your work"** — was reproduced live and has **two independent, compounding root causes**, neither related to the feature's own logic:

1. `vite.config.js` has no dev-server proxy for `/api/*`. Every frontend fetch to the API silently receives Vite's `index.html` back with a `200 OK`, which fails JSON parsing and triggers the view's generic error state. **This breaks every API-backed view in local dev identically** (confirmed on both "Focus" and "My Work").
2. Independently, the local `.env`'s `DATABASE_URL` references a Postgres role (`jarvis`) and database (`jarvis_epc`) that do not exist on this machine — confirmed via direct connection test (`role "jarvis" does not exist`). The API server's own startup code (`api/server.ts:753-757`) calls `process.exit(1)` when this happens, so **the backend never boots at all**.

Beneath that reproduction, deeper backend audit found the My Work feature's *own* SQL is also currently broken: a **duplicate, incompatible `change_orders` table definition** across two migrations (007 and 058) means the columns `myWork` queries (`reviewed_by`) don't exist on the table that actually gets created — so even with the proxy and DB fixed, `/api/v1/my-work` would 500 on a real deployment.

A **third, structurally distinct** failure mode was found affecting a much larger share of the app than My Work: roughly **50 components** (CRM, Finance/Feed, Projects, ActionItems, and more) read from a global Zustand store that **no code path anywhere ever hydrates from the backend** — these views show silent, error-free empty states on every fresh session, which is a worse failure mode than My Work's because it produces zero diagnostic signal (no failed request, no console error, no error boundary trigger).

Beyond the reported bug, this audit found **11 P0-severity issues**, including a tenant-isolation control that is silently a no-op unless a specific environment variable is set (a repeat of a bug class a prior audit claimed was fixed), an unguarded SSRF vector on the SAML metadata-import endpoint, a notification system that reports successful delivery while sending nothing on every channel, an EVM cost-adjustment write path that fails on every change order with a cost impact due to more schema drift, and a page (Directory) whose data props are never wired by the router at all.

**What must be fixed first** (in dependency order): the two My Work/dev-environment root causes → the `change_orders` schema collision → the RLS/`DATABASE_URL_APP` enforcement gap → the SAML SSRF → the notification-stub reporting-false-success issue. Full roadmap in §6.

---

## 1. Root Cause: "Couldn't load your work"

### FINDING P0-01: No Vite dev-server proxy for `/api/*` — every API-backed view fails identically in local dev

**Severity:** P0 · **Status:** Confirmed · **Area:** Frontend/DevOps
**User Impact:** Every module that fetches from the backend (Focus, My Work, Actions, Projects, ...) shows a generic "Couldn't load X" error on a clean local checkout.
**Business Impact:** Blocks local development and evaluation entirely; anyone following the README's `npm run dev:full` quick start hits this on first run.
**Why it matters:** This is the literal, reproduced cause of the reported symptom, and it means the bug is not in the My Work feature at all — a narrower fix (e.g. patching `MyWorkView.tsx`) would not have resolved it.
**Evidence:**
- `vite.config.js:50-55` — `server: { port: 3000, open: true, cors: true }` — no `proxy` key.
- Live reproduction: `GET http://localhost:5180/api/v1/my-work` → `200 OK`, body starts with `<!DOCTYPE html>...<script type="module">import { injectIntoGlobalHook } from "/@react-refresh">` — i.e. Vite's own `index.html`, not JSON.
- `src/components/myWork/MyWorkView.tsx:120-132` — `fetch('/api/v1/my-work')` → `res.json()` throws on HTML → caught → `setError(true)` → renders "Couldn't load your work."
- Same failure mode reproduced on `src/components/FocusView` equivalent ("Couldn't load the focus briefing.").
**Reproduction:**
1. `npx vite --port 5180` (or via `.claude/launch.json` config `denver-eng`).
2. Log in (PIN `0000` — see P2-09), navigate to My Work or Focus.
3. Network tab shows `GET /api/v1/my-work → 200`, but the response body is HTML.
**Root cause:** Missing `server.proxy['/api']` (or equivalent) target pointing at the Express backend port in `vite.config.js`.
**Recommended remediation:** Add a Vite dev-server proxy for `/api` to the Express port (whichever port is authoritative — see P2-08 for the port-number confusion itself), or document that `vite preview`/dev requires a separate reverse proxy.
**Verification steps:** With the proxy added and the API server actually running, `GET /api/v1/my-work` should return real JSON or a real HTTP error code, and `MyWorkView` should render data or a *specific* error, not the generic fallback.
**Residual risk:** None once fixed — this is a pure dev-environment configuration gap; production builds serve the SPA and API from the same origin (`api/server.ts:664-672`) and are not affected by this specific bug.
**Files/routes:** `vite.config.js`, `src/components/myWork/MyWorkView.tsx`, `src/components/ContentRouter.tsx`.

### FINDING P0-02: `.env`'s `DATABASE_URL` references a nonexistent role/database — API server cannot boot

**Severity:** P0 · **Status:** Confirmed · **Area:** Backend/DevOps
**User Impact:** With this `.env`, the API process exits immediately; no endpoint works, not just My Work.
**Business Impact:** Any environment provisioned from this `.env.example`/`.env` pattern without an exactly-matching local Postgres role will fail to boot — a fragile onboarding path.
**Why it matters:** Independent of P0-01 — even with the proxy fixed, the backend itself won't start with these credentials.
**Evidence:**
- `.env:2` — `DATABASE_URL=postgresql://jarvis:...@localhost:5432/jarvis_epc`.
- Direct connection test: `role "jarvis" does not exist` (confirmed via raw `pg.Pool` connect). Local Postgres only has roles `app_rw, farmconnect, jarvis_app, luna, postgres, procurementos, rommelaguillon` — no `jarvis`, and no `jarvis_epc` database exists (`\l` returns nothing matching).
- `api/db/pool.ts:82-99` (`initPool`) — on failure, logs then `if (NODE_ENV==='production') process.exit(1); throw err`.
- `api/server.ts:753-757` — `start().catch(err => { log.fatal(...); process.exit(1) })` — re-thrown error from dev-mode `initPool()` still terminates the process.
- Live reproduction: `node --env-file=.env -e "new Pool({connectionString: process.env.DATABASE_URL}).query('SELECT NOW()')"` → `ERR role "jarvis" does not exist`.
**Reproduction:** `npx tsx --env-file=.env api/server.ts` from repo root → process exits with no listening port (confirmed via `curl` connection-refused on port 4001).
**Root cause:** Stale/mismatched local dev credentials — the comment `# Local dev bootstrap — generated 2026-04-19` suggests this `.env` predates a role rename (`jarvis` → `jarvis_app`, matching the `AUD-002` non-owner-role migration referenced in `pool.ts:32`) and was never regenerated.
**Recommended remediation:** Regenerate `.env` from `.env.example` against the actual local Postgres, or document a `docker-compose` / seed-script path that provisions the exact role+db the app expects.
**Verification steps:** `npm run db:migrate` followed by `npm run api:dev` should reach `[startup] ... listening on port ...` without error.
**Residual risk:** Low once fixed; this is local-machine state, not a shipped defect — but see P0-03/P0-04/P0-05 for defects that *would* still surface once the DB is reachable.
**Files/routes:** `.env`, `api/db/pool.ts`, `api/server.ts`.

### FINDING P0-03: Duplicate, incompatible `change_orders` schema across migrations 007 and 058 — breaks My Work's real query

**Severity:** P0 · **Status:** Confirmed · **Area:** Database/Backend
**User Impact:** Once P0-01/P0-02 are fixed, `/api/v1/my-work` (and other change-order consumers) still 500s on any database built from these migrations in order.
**Business Impact:** The "approvals" lane of My Work — arguably the most important lane for an approver-facing platform — is unreachable; change-order approval workflows relying on this schema are broken.
**Why it matters:** This shows the reported bug is not purely environmental — the feature has its own latent defect that only a real database would surface.
**Evidence:**
- `api/db/migrations/007_pm_modules.sql:219` — `CREATE TABLE change_orders (... co_number VARCHAR(40), amount NUMERIC, status VARCHAR(20), approved_by UUID, approved_at TIMESTAMPTZ ...)`.
- `api/db/migrations/058_change_orders.sql:25` — `CREATE TABLE IF NOT EXISTS change_orders (... co_number INTEGER, cost_impact NUMERIC, status co_status, reviewed_by UUID, reviewed_at TIMESTAMPTZ ...)` — a *different* schema.
- `api/db/migrate.ts:47-49` runs migrations via `fs.readdirSync(...).sort()` (lexicographic) — `007` always runs first, so `058`'s `CREATE TABLE IF NOT EXISTS` is a guaranteed no-op; no `ALTER TABLE` reconciles the two.
- `api/services/myWork/myWorkService.ts:174-176` queries `WHERE ... AND reviewed_by=$2` — a column that only exists in 058's (never-applied) definition.
- `api/services/changeOrders/changeOrderService.ts` uses `cost_impact` and the `co_status` enum — also from 058, also absent from the real table.
**Reproduction:** `grep -n "CREATE TABLE change_orders" api/db/migrations/007_pm_modules.sql api/db/migrations/058_change_orders.sql` and diff column lists; run migrations in order and query `\d change_orders`.
**Root cause:** A later feature (058) was built against an assumed schema that duplicates an earlier table name without checking it already existed, and `IF NOT EXISTS` masked the collision at migration-apply time instead of erroring.
**Recommended remediation:** Write a reconciling migration (`ALTER TABLE change_orders ADD COLUMN reviewed_by ..., ADD COLUMN cost_impact ..., ...` or a full rename/backfill), then audit every service for which schema version it assumes before deploying to any environment that has already run migration 007.
**Verification steps:** After reconciliation, `buildMyWork()` (`myWorkService.ts`) should execute against a freshly-migrated DB without a column-not-found error; add a regression test that runs the full migration chain and asserts `change_orders` has both `reviewed_by` and `cost_impact`.
**Residual risk:** If this is already deployed to a live environment, existing production `change_orders` rows are on the 007 schema — the fix migration must be additive/backfilled, not destructive.
**Files/routes:** `api/db/migrations/007_pm_modules.sql`, `api/db/migrations/058_change_orders.sql`, `api/services/myWork/myWorkService.ts`, `api/services/changeOrders/changeOrderService.ts`.

---

## 2. P0 — Additional Findings Beyond the Reported Bug

### FINDING P0-04: EVM cost-adjustment INSERT on change-order approval targets four nonexistent columns

**Severity:** P0 · **Status:** Confirmed · **Area:** Database/Finance
**User Impact:** Approving any change order with a nonzero cost impact throws instead of recording the BAC adjustment.
**Business Impact:** Cost control / EVM reporting silently diverges from reality for every approved change order with cost impact — a core financial-integrity feature.
**Evidence:** `api/services/changeOrders/changeOrderService.ts:365-372`:
```sql
INSERT INTO evm_actuals
   (tenant_id, project_id, baseline_id, wbs_code, period_start, period_end, actual_cost, description)
 VALUES ($1,$2,$3,'CO-ADJUSTMENT',$4,$4,$5,$6)
```
Real `evm_actuals` columns per `api/db/migrations/053_evm.sql:76-87`: `id, tenant_id, project_id, wbs_entry_id, period_date, amount, description, reference, recorded_by, created_at`. `baseline_id`, `wbs_code`, `period_start`, `period_end`, `actual_cost` do not exist. Contrast with the *correct* pattern in `api/services/timesheets/timesheetService.ts:229-231`, which inserts into the same table using real column names.
**Reproduction:** `grep -n "INSERT INTO evm_actuals" api/services/changeOrders/changeOrderService.ts` vs. `sed -n '76,87p' api/db/migrations/053_evm.sql`.
**Root cause:** Copy-paste from a different table's naming convention (`period_start`/`period_end`/`actual_cost` resembles `cost_entries`, not `evm_actuals`).
**Recommended remediation:** Rewrite the insert against real columns (`wbs_entry_id`, `period_date`, `amount`), resolving an actual WBS entry rather than a literal `'CO-ADJUSTMENT'` string.
**Verification steps:** Approve a change order with nonzero `cost_impact` against a real DB; assert a row lands in `evm_actuals` and BAC reporting reflects it.
**Files/routes:** `api/services/changeOrders/changeOrderService.ts:355-375`, `api/db/migrations/053_evm.sql`.

### FINDING P0-05: `evm_baselines.status` queried but the real column is `is_active` — breaks budget alerts, prediction, and cost-control dashboard

**Severity:** P0 · **Status:** Confirmed · **Area:** Database/Finance
**User Impact:** Budget-threshold alerts, project-health prediction's BAC lookup, and the cost-control dashboard's BAC figure all query a nonexistent column.
**Evidence:** `api/db/migrations/053_evm.sql:29-43` defines `is_active BOOLEAN`, no `status` column. Three call sites query `status='active'` regardless:
- `api/services/notifications2/notificationService.ts:93`
- `api/services/predict/predictService.ts:235`
- `api/services/costControl/costControlService.ts:69`
**Reproduction:** `grep -n "evm_baselines" -A2 api/services/notifications2/notificationService.ts api/services/predict/predictService.ts api/services/costControl/costControlService.ts | grep status`.
**Root cause:** Same class of drift as P0-04 — application code assumes a schema shape the migrations don't actually provide.
**Recommended remediation:** Change all three call sites to `is_active = true`.
**Verification steps:** Each affected feature (budget alert, predict, cost-control dashboard) should return non-error results against a seeded baseline.
**Files/routes:** as listed above; `api/db/migrations/053_evm.sql`.

### FINDING P0-06: Tenant isolation (RLS) is a no-op unless `DATABASE_URL_APP` is explicitly configured

**Severity:** P0 · **Status:** Confirmed · **Area:** Security/Multi-tenancy
**User Impact:** None visible to users — this is a silent security control gap.
**Business Impact:** If `DATABASE_URL_APP` isn't set in a real deployment, the database-level tenant isolation backstop that a prior audit (`GO_NO_GO_DECISION.md`) treated as a cleared control is actually disarmed, leaving app-layer `WHERE tenant_id=...` clauses as the *only* control.
**Why it matters:** This is exactly the bug class a prior remediation pass (referenced in-code as "AUD-002") was meant to close — the code comment itself documents the risk precisely, but the safe default was never enforced (it silently falls back to the unsafe mode rather than failing loud).
**Evidence:** `api/db/pool.ts:28-36`:
> "PostgreSQL exempts a table's OWNER from RLS unless FORCE is set, so connecting tenant traffic as the owner silently disarms every tenant_isolation policy... Unset → falls back to the main pool (prior behavior; app-layer WHERE clauses remain the only control)."

`pool.ts:68-70`: `_appPool = DATABASE_URL_APP ? new Pool(...) : _pool` — i.e. `tenantQuery()`/`tenantTransaction()` silently use the RLS-bypassing owner connection whenever the app-role env var is absent. `.env.example` does not define `DATABASE_URL_APP` at all, and it is **not set** in the local `.env`.

**This is confirmed at the deployment-guidance level, not just theoretical:** `docs/deploy/fly-neon-upstash.md:92` explicitly instructs operators to *"skip it first"* when setting up `DATABASE_URL_APP` — directly contradicting `PRODUCT_REQUIREMENTS_DOCUMENT.md:210`, which describes the same variable as **mandatory**. The shipped deployment runbook actively tells whoever stands up a production environment to leave the RLS backstop disabled.

Separately: only 4 of 81 migration files (`072_rls_hardening.sql`, `073_saml_sso.sql`, `074_scim_tokens.sql`, `075_rls_app_role_grants.sql`, covering ~10 tables) apply `FORCE ROW LEVEL SECURITY`, versus 71 files that merely `ENABLE` it — so even a correctly-configured `DATABASE_URL_APP` provides no defense-in-depth backstop for the overwhelming majority of tenant tables if the app role is ever misconfigured or a query path reverts to the owner connection.

**A full, methodical repo-wide sweep confirms this is a systemic code pattern, not an edge case.** Every file under `api/routes/**` and `api/services/**` importing the bare `query` symbol was identified (26 files), every real call site of `query(`/`query<T>(` in those files was enumerated and cross-checked against migrations for a `tenant_id` column (91 tenant-table call sites total), and each was classified against whether tenant context (`tenantId` param, `req.tenantId`, or a claimed job's `tenant_id`) was actually in scope at the call site. Result: **76 of 91 are confirmed SUSPECT** — tenant context was available but plain `query()` was used instead of `tenantQuery()`, meaning these writes/reads never route through the RLS-enforcing pool regardless of `DATABASE_URL_APP` configuration. The other 15 are legitimate (pre-tenant-context bootstrapping, or background workers' cross-tenant "claim next job" step using `FOR UPDATE SKIP LOCKED`, which correctly has no single-tenant filter by design).

The 76 SUSPECT sites concentrate in three areas: (a) **the entire Action Center/SLA subsystem** (`api/services/actionService.ts`, `api/services/actions/*.ts` — actionAnalyticsService, actionDependencyGraph, actionEventPublisher, actionRecommendationService, actionRelationshipService — and `api/services/sla/slaPolicyEngine.ts`) is almost entirely SUSPECT: nearly every function takes an explicit `tenantId` parameter yet queries with a hand-written `WHERE tenant_id=$N` instead of routing through `tenantQuery`; (b) **background workers correctly use plain `query()` for the cross-tenant "claim next job" step, then incorrectly continue using plain `query()` for the subsequent per-tenant work** using the claimed job's own `tenant_id` (`scheduler.ts`, `packWorker.ts`, `notificationWorker.ts`, `integrationSync.ts`, `knowledgeEmbed.ts`, `knowledgeIngest.ts`, `kpiSnapshot.ts`, `auditRetention.ts`) — the RLS backstop is never engaged for any worker-driven write in this codebase; (c) **`api/routes/scim.ts` is internally inconsistent** — its `/scim/audit` GET route correctly uses `tenantQuery`, while `/scim/tokens` POST/GET/DELETE (same file, same middleware stack, `req.tenantId!` in scope) use plain `query()` on `scim_tokens`, a tenant-scoped credentials table. `api/services/ciArbiter.ts` shows the same internal inconsistency (`_commitNumeric` uses `tenantTransaction`; `_lookupRule`/`_lookupBaseline` don't).

**Several sites are worse than a missing RLS backstop — they have no tenant filter in the SQL at all**, relying entirely on an easy-to-forget manual application-code check or on the caller having already scoped an ID correctly: `api/services/packWorker.ts:197,256`, `api/services/fixExtractor.ts:254`, `api/services/integrationSync.ts:138,151,161,169`, `api/services/notifications/notificationWorker.ts:132,141,164`, and `api/services/knowledgeIngest.ts:87,149` all update/delete by bare `id` with zero tenant predicate anywhere in the query.

**A fourth independent verification pass narrowed the blast radius usefully and added two important pieces of context.** First, **zero violations exist in the routing layer** — every file under `api/routes/**` uses `tenantQuery`/`tenantTransaction` exclusively; this bug class is entirely confined to background workers/services (`api/services/**`), several of which (`fixExtractor.ts`, `knowledgeIngest.ts`, `knowledgeEmbed.ts`, `packWorker.ts`) mix the safe and unsafe pattern within the same file — proof of inconsistent enforcement discipline rather than one missed spot. Second, and more important: **this exact gap has already been flagged as an open finding in at least three prior audit passes** (`PRODUCT_REQUIREMENTS_DOCUMENT.md:110`, `SYSTEM_ARCHITECTURE.md:157`, `audit/INDEPENDENT_ENTERPRISE_AUDIT_2026-06-20.md:286,322`), each recording its status as **"FIXED (runtime-verify pending)"** — never marked closed — and no enforcement mechanism has been added since. Independent passes converge on the same systemic finding with the exact call-site count varying by scope/methodology (22–76 sites depending on how strictly "tenant-adjacent" tables are counted); the count is secondary to the finding itself, which is unambiguous and has now survived four independent audits without being fixed: **`DATABASE_URL_APP` is silently optional everywhere it's referenced (code, `.env.example` omits it entirely, deploy runbook says skip it, `RELEASE_SIGNOFF.md` has it as an unchecked box, CI never checks it), and even when set, a meaningful number of background-worker writes never engage it at all.**
**Reproduction:** `grep DATABASE_URL_APP .env .env.example docs/deploy/fly-neon-upstash.md PRODUCT_REQUIREMENTS_DOCUMENT.md`; read `api/db/pool.ts:25-70`; `grep -c "ENABLE ROW LEVEL SECURITY\|FORCE ROW LEVEL SECURITY" api/db/migrations/*.sql`.
**Root cause:** A defense-in-depth control was implemented as opt-in rather than fail-closed.
**Recommended remediation:** Make `tenantQuery()` refuse to run (or loudly warn on every call) when `DATABASE_URL_APP` is unset in any non-development `NODE_ENV`, rather than silently degrading to the owner pool. Confirm and document that the real deployment target has this variable set to a `NOBYPASSRLS` role per migration 075.
**Verification steps:** Attempt a tenant-scoped query as tenant A against tenant B's data with RLS active and `DATABASE_URL_APP` set to a non-owner role; confirm zero rows returned. Repeat with the variable unset in a non-dev environment; the app should refuse to start rather than silently degrade.
**Residual risk:** Unknown until production environment variables are confirmed — flagged as the single highest-priority item to verify operationally.
**Files/routes:** `api/db/pool.ts`.

### FINDING P0-07: Unguarded SSRF on SAML IdP metadata-import endpoint

**Severity:** P0 · **Status:** Confirmed · **Area:** Security
**User Impact:** None directly visible; exploitable by a malicious or compromised tenant owner/admin account.
**Business Impact:** Cloud metadata endpoint (`169.254.169.254`) and internal network access from an authenticated tenant admin — potential for credential theft or internal service enumeration/pivoting.
**Why it matters:** Every *other* outbound-fetch-from-user-input call site in this codebase (webhook dispatch, integration health-check, the MCP `http_fetch` AI tool) is correctly routed through a shared SSRF guard (`api/lib/ssrfGuard.ts`, which blocks private/loopback/link-local/CGNAT IPs including cloud metadata, plus DNS-rebinding). This one was missed.
**Evidence:** `api/auth/saml/samlProvider.ts:367` — `importIdpMetadataFromUrl(tenantId, metadataUrl)` calls `fetch(metadataUrl, {...})` with **no `assertSafeUrl` call, no protocol/host/private-IP check of any kind**. Called from `api/auth/saml/samlRoutes.ts:356` (`POST /:tenantSlug/config/metadata`), gated only by `requireAuth` + `requireRole('owner','admin')` — i.e. reachable by any tenant owner/admin, not a platform-level restriction. `metadataUrl` comes directly from `req.body.metadataUrl` (line 330). On failure, the error message echoes the target URL back to the caller (`` `Failed to fetch IdP metadata from ${metadataUrl}: ${err...}` ``, line 374); on success, the fetched content is parsed and written into the tenant's SSO config.
**Reproduction:** As an authenticated tenant owner/admin: `POST /api/v1/saml/:tenantSlug/config/metadata { "metadataUrl": "http://169.254.169.254/latest/meta-data/iam/security-credentials/" }` → server-side fetch executes unguarded.
**Root cause:** This call site was not updated when the shared `ssrfGuard` was introduced elsewhere (the guard's own code comments reference "AUD-005" as the effort that added it to the other call sites — this one was missed).
**Recommended remediation:** Call `assertSafeUrl(metadataUrl)` before the `fetch()`, identical to the pattern already used in `api/routes/integrations.ts:118` and `api/routes/mcp.ts:323`.
**Verification steps:** Add a test asserting `importIdpMetadataFromUrl` rejects `http://169.254.169.254/...`, `http://localhost/...`, and RFC1918 targets.
**Residual risk:** None once patched — the guard is proven effective elsewhere in this same codebase.
**Files/routes:** `api/auth/saml/samlProvider.ts:367`, `api/auth/saml/samlRoutes.ts:330-356`, `api/lib/ssrfGuard.ts`.

### FINDING P0-08: Notification delivery is fully stubbed for in-app, email, and Slack channels — but reports success

**Severity:** P0 · **Status:** Confirmed · **Area:** Backend/Reliability
**User Impact:** Users configured to receive SLA-breach, approval, or alert notifications receive **nothing**, with no error surfaced anywhere.
**Business Impact:** For an EPC platform where SLA/approval timeliness matters, a notification system that silently no-ops while marking itself "delivered" is a trust-destroying defect once discovered — and it explicitly defeats the SLA escalation logic that depends on delivery success/failure to decide whether to escalate.
**Evidence:** `api/services/notifications/notificationWorker.ts:48-73`:
```
// _deliverInApp
// TODO Phase 2 Sprint 4: write to user_notifications table / push via SSE
slog('INFO', ..., '[in_app] stub delivery', ...)
return { success: true, responseCode: 200, durationMs: 0 }

// _deliverEmail
// TODO Phase 2 Sprint 4: SES / SendGrid integration
... return { success: true, ... }

// _deliverSlack
// TODO Phase 2 Sprint 5: Slack SDK integration
... return { success: true, ... }
```
File header (lines 11-16) self-documents all three as stubs. `api/services/slaEngine.ts:197` — `// TODO Phase 1 Sprint 4: emit in-app notification to notifiedUsers` confirms the SLA engine's escalation path depends on this same broken delivery layer.
**Reproduction:** Trigger any code path that queues a notification job (SLA breach, approval request); observe `[in_app] stub delivery` / `[email] stub delivery` / `[slack] stub delivery` INFO logs and a `success: true` result with zero actual delivery.
**Root cause:** Incomplete feature — delivery integrations (SES/SendGrid, Slack SDK, SSE push) were never built, but the stub's return shape is indistinguishable from success to any caller.
**Recommended remediation:** At minimum, change stub handlers to return `success: false` (or a distinct `not_implemented` status) so the dead-letter/escalation logic actually engages instead of marking fake-delivered jobs complete. Prioritize real implementation for at least the in-app channel (write-through to a `user_notifications` table is the smallest lift).
**Verification steps:** A test asserting that a queued notification job for an unimplemented channel results in an escalation or a visible failure state, not a silent `success: true`.
**Files/routes:** `api/services/notifications/notificationWorker.ts`, `api/services/slaEngine.ts`.

### FINDING P0-09: Fatal-error `process.exit()` paths never flush logs — crash diagnostics are routinely lost

**Severity:** P0 · **Status:** Confirmed (reproduced live) · **Area:** Observability
**User Impact:** None directly; this is an operability/incident-response gap.
**Business Impact:** When the API fails to start (e.g. exactly the DB-connection failure in P0-02), the log line explaining *why* is the one most likely to be silently dropped — directly observed in this audit: three separate attempts to boot the server with a bad DB connection produced **zero log output** beyond a punycode deprecation warning, despite the code path including `log.fatal(...)` immediately before `process.exit(1)`.
**Evidence:**
- `api/server.ts:753-757` — `start().catch(err => { log.fatal({err: err.message}, '[startup] Fatal error — exiting'); process.exit(1) })` — no flush, no await.
- `api/worker.ts:126-129` — identical pattern.
- `api/db/pool.ts:92-97` — `slog('ERROR', ...); if (NODE_ENV==='production') process.exit(1)` — also no flush (though `slog` here is a synchronous `console.error` wrapper, lower risk than the pino sites).
- `api/auth.ts:33-36` — missing-`JWT_SECRET` fatal path uses raw `console.error` + `process.exit(1)`, bypassing the structured pino/Sentry pipeline entirely (so this failure mode is invisible to whatever log aggregation is built on the structured pipeline).
- Contrast: the **graceful** SIGTERM/SIGINT shutdown path (`api/server.ts:736-750`, `api/worker.ts:107-116`) *does* `await flushErrorTracking(2000-3000)` before exiting — but even that only flushes Sentry, never pino's own transport.
- pino is `^10.3.1` (`package.json`), async by default; in development it uses a `pino-pretty` worker-thread transport (`api/server.ts:186-188`), which is especially vulnerable to being cut off by an immediate `process.exit()`.
- Live reproduction (this audit): running `npx tsx --env-file=.env api/server.ts` against the broken DB connection (P0-02) produced no fatal log line in captured stdout at all, consistent with this exact failure mode.
**Root cause:** No shared "fail fatally" helper exists; every crash site independently calls `process.exit()` immediately after logging, with no coordination with pino's async write or Sentry's flush.
**Recommended remediation:** Introduce a single `fatalExit(err)` helper that awaits `flushErrorTracking()` **and** pino's own flush/drain (or a short fixed delay) before calling `process.exit(1)`, and use it at every fatal call site (`server.ts`, `worker.ts`, `pool.ts`, `auth.ts`).
**Verification steps:** Force a startup failure and confirm the fatal log line is present in captured output 100% of the time across repeated runs.
**Files/routes:** `api/server.ts`, `api/worker.ts`, `api/db/pool.ts`, `api/auth.ts`.

### FINDING P0-10: ~50 components read from a global store that nothing ever hydrates from the backend — fails silently, with no error state at all

**Severity:** P0 · **Status:** Confirmed · **Area:** Frontend/State management
**User Impact:** CRM, Finance/Feed, Projects, ActionItems, Engineering, and ~45 more views show zero data on a fresh session — worse than the reported My Work bug, because there is no fetch attempt, no loading state, and no error message. It is visually indistinguishable from "this tenant genuinely has no data yet."
**Business Impact:** This is arguably the single largest functional gap in the platform — a large fraction of the nav surface silently shows nothing, and unlike My Work, this failure mode produces **no diagnostic signal whatsoever** (no failed network request, no console error, no error boundary trigger).
**Why it matters:** This was not anticipated in the audit brief and represents a second, structurally distinct root cause of "the app looks broken" beyond the reported symptom — the codebase has two entirely separate, uncoordinated data pipelines: (A) per-view `fetch('/api/v1/...')` + local `useState` (used by BudgetView, DailyLogsView, MyWorkView, and ~12 others), and (B) a global Zustand `useBizStore` that ~50 components read from but that **no code path anywhere calls to hydrate from the backend**.
**Evidence:**
- `src/modules/biz/store.ts:75` — `biz: emptyBizState()`, and `emptyBizState()` (`src/modules/biz/reducer.ts:101-134`) initializes every collection to `[]`.
- `src/hooks/useJarvis.ts` (240 lines, the app's typed access layer to this store) — contains no fetch call anywhere; `JarvisProvider`/`useJarvisStandalone` never call `dispatch`/`restore` from an API response.
- `grep -rln "useBizStore\b" src` → 51 files, none of which hydrate the store from `/api/*`.
- The only way data enters this store is a user manually submitting a form (e.g. `src/components/FeedView.tsx:41` — `dispatch({ type: JARVIS_ACTIONS.ADD_JOURNAL, ... })`).
**Reproduction:** Load `CRMView` or `FeedView` on a fresh session — pipeline/leads/invoices are all zero with no loading or error state; compare network tab (empty — no request was even attempted) against My Work's failed-request pattern.
**Root cause:** An incomplete migration between two state-management approaches — the newer per-view live-fetch pattern was adopted for some views but never backfilled into the older global-store views, and no hydration bridge was ever built between them.
**Recommended remediation:** Add a hydration effect (on login or app mount) that fetches each `useBizStore` collection from its corresponding API endpoint and calls `restore(...)`, or migrate these ~50 views to the same live-fetch pattern already used by `BudgetView`/`DrawingsView`/`MyWorkView`.
**Verification steps:** After hydration is added, a fresh login should populate CRM/Feed/Projects/ActionItems with real backend data without requiring any manual form submission first.
**Residual risk:** High until fixed — this affects roughly half of the sampled nav surface (~50 of ~62 nav items depend on `useBizStore` in some form).
**Files/routes:** `src/modules/biz/store.ts`, `src/modules/biz/reducer.ts`, `src/hooks/useJarvis.ts`, and the ~50 consuming components (e.g. `src/components/CRMView.tsx`, `src/components/FeedView.tsx`, `src/components/ProjectsView.tsx`, `src/components/ActionItemsView.tsx`).

### FINDING P0-11: `DirectoryView` never receives its data props — permanently empty regardless of backend health

**Severity:** P0 · **Status:** Confirmed · **Area:** Frontend/Procurement
**User Impact:** The Directory page (vendors/customers/POs/contracts/invoices) is permanently empty, independent of P0-10 or any backend fix.
**Evidence:** `src/components/DirectoryView.tsx:340-343` destructures `vendors = [], customers = [], purchaseOrders = [], contracts = [], invoices = []` from its props. `src/components/ContentRouter.tsx:239-245` defines `sharedProps` passed to every routed view as only `{ policy, biz, onNavigate, onAudit, onToast }` — none of the five props `DirectoryView` needs are ever supplied, so all five destructure to their empty-array defaults unconditionally.
**Reproduction:** Navigate to Directory (Procurement section) — Vendor/Customer tabs are empty even with a fully healthy, fully-seeded backend, because the component's props are structurally never wired, not because of a fetch failure.
**Root cause:** Prop-wiring gap introduced when `DirectoryView` was built expecting explicit props rather than reading from `useBizStore` directly like sibling views.
**Recommended remediation:** Have `DirectoryView` read from `useBizStore` directly (matching `ProjectsView`/`CRMView`), or have `ContentRouter` pass the five props explicitly for the `directory` tab.
**Verification steps:** After the fix, Directory should show real vendor/customer/PO/contract/invoice data sourced from the same place other views get it.
**Files/routes:** `src/components/DirectoryView.tsx:340-343`, `src/components/ContentRouter.tsx:239-245`.

---

## 3. P1 Findings

| ID | Title | Area | Evidence (file:line) |
|---|---|---|---|
| P1-01 | `/enterprise/demo/*` and `/enterprise/deployment/health*` have no platform-admin authz — any authenticated user (any tenant) can provision/reset demo tenants or trigger health checks. This is the *same bug class* a comment in the same file (`AUD-001`) says was already fixed for the neighboring lifecycle routes — the demo/health routes were simply missed in that pass. | AuthZ | `api/routes/enterprise.ts:428,438,448,460,474,485` (only `requireAuth`, no `requireTenantAdmin`/`requirePlatformAdmin`); contrast with the fixed pattern at lines 59-127 and the explanatory comment at lines 24-30. |
| P1-02 | `POST /api/v1/ecosystem/federated/patterns` is commented "(admin)" but has no role check — any authenticated tenant user can publish arbitrary "federated patterns" by supplying a fabricated `contributorCount`, bypassing the real k-anonymity aggregation worker (which independently counts real contributions). | Security/AI | `api/routes/ecosystem.ts:90-96`; `api/services/ecosystem/federatedIntelligenceEngine.ts:119-125` trusts `req.body.contributorCount` verbatim. |
| P1-03 | `DocumentationAgent` fabricates a random word count via `Math.random()` and reports `status: 'generated'` with no document ever produced and no LLM call made — recorded with a hardcoded `confidence: 100`. Reachable via the live agent-dispatch path. | AI/Correctness | `api/services/agents/agents.ts:121-141`; dispatch confirmed via `agentOrchestrator`→`agentWorker`→`agents.ts`. |
| P1-04 | `GET /api/v1/ops/recommendations` (live, authenticated) returns `ai_generated: true` with fabricated confidence scores (0.85/0.70/0.90) on output that is 100% deterministic rule-based logic — no LLM call anywhere in the code path. | AI/Trust | `api/services/actions/actionRecommendationService.ts:32,44-88`; route `api/routes/ops.ts:332-340`. |
| P1-05 | Access tokens are never checked against the server-side revocation blocklist during normal request auth — only signature/expiry. A "logged out" access token remains valid for up to its 15-minute TTL. | Auth | `api/auth.ts:296-320` (`requireAuth`/`verifyToken`) never calls `isRevoked`; contrast with `handleLogout` (`api/auth.ts:250-277`), which does correctly revoke both jtis server-side. |
| P1-06 | No refresh-token reuse-detection/family revocation — presenting an already-revoked refresh jti returns a plain 401 with no cascading revocation of sibling sessions, weakening theft detection. | Auth | `api/auth.ts:199-246`. |
| P1-07 | SAML JIT-provisioned users get a fabricated string that only *looks like* a bcrypt hash (`$2b$12$` prefix + SHA-256/base64) instead of a real `bcrypt.hash()` call — the exact anti-pattern a comment elsewhere in the codebase (`scim.ts:323-325`) says was already fixed. | Auth | `api/auth/saml/samlProvider.ts:406-409`. |
| P1-08 | No process-level `uncaughtException`/`unhandledRejection` handlers exist anywhere in `api/` — an exception outside Express's request-handling path (e.g. inside a bare `setInterval` callback) bypasses all structured logging/Sentry capture and hits Node's default crash behavior. | Observability | `grep -rn "uncaughtException\|unhandledRejection" api` → zero matches. |
| P1-09 | `/api/v1/gateway` (general-purpose Anthropic proxy) has rate limiting but **no budget enforcement** — only the newer `/ask` and `/me/agent/ask` paths (commit `ff79110`) got budget checks wired in. A tenant over budget can still spend unmetered through this route. | AI/Cost control | `api/server.ts:624-661` (no `getAiBudgetStatus`/`recordAiUsage` calls). |
| P1-10 | The budget-enforcement feature from the most recent merged commit (`ff79110`) has **zero direct test coverage** on its core paths (over-budget → 402, budget-lookup-error → fail-open, success → usage recorded) — the commit's "874/874 passing" claim reflects no regressions, not new coverage. | Testing/AI | `api/__tests__/askBuilder.test.ts` contains no calls to `askJarvis`; grep for budget-related assertions across `api/__tests__/` finds none. |
| P1-11 | `federatedAggregationWorker.ts` — the actual Laplace-noise/k-anonymity DP engine that is wired into a live 5-minute background job — has **0% test coverage** (confirmed via the coverage report itself: `coverage/api/services/ecosystem/federatedAggregationWorker.ts.html` shows 0/80 statements). A boundary regression (e.g. off-by-one on `K_ANONYMITY_MIN`) would ship silently. | Testing/AI/Privacy | `api/services/ecosystem/federatedAggregationWorker.ts`; `api/server.ts:722`, `api/worker.ts:86` (registration). |
| P1-12 | Change-order approve/reject endpoints have `requireAuth`+`requireTenant` but **no role gate** — any authenticated tenant member, including a `viewer`-role user, can approve or reject a change order (a budget/contract-impacting action). | RBAC | `api/routes/changeOrders.ts:38-39,132,144` — no `requireRole(...)` on the approve/reject handlers. |
| P1-13 | Bulk data-export route (`api/routes/exports.ts`) imports `requireAuth` but never applies `requireTenant()` — `req.tenantId` (only ever set by that middleware) is used non-null-asserted (`r.tenantId!`) and passed into `tenantQuery()`, meaning the tenant context is undefined at runtime for every export request. Needs a live-DB check to fully rule out cross-tenant read risk, but at minimum the tenant boundary is broken on this feature as shipped. | RBAC/Tenant isolation | `api/routes/exports.ts:8-16,30,38,46`; `api/services/export/dataWarehouse.ts:115,240`; `api/middleware/tenant.ts:157,179`. |

---

## 4. P2 Findings

| ID | Title | Area | Evidence |
|---|---|---|---|
| P2-01 | `SchedulingAgent` is an explicit no-op stub, always returns `optimized: true` with empty conflict list regardless of real schedule state. | AI | `api/services/agents/agents.ts:179-183`; registered as a real capability (`requiresApproval: true`) in `agentRegistry.ts:116-133`. |
| P2-02 | `integrationSync` silently no-ops for every unimplemented connector type (Procore, SAP, Primavera, MS Project, Aconex, BIM360) — honestly logged (`[stub]` INFO), but every advertised third-party integration is currently inert if enabled. | Integrations | `api/services/integrationSync.ts:182-204`. |
| P2-03 | MCP "43 tools" catalog: the 43-entry count is real (confirmed by direct array parse) and not hardcoded in the UI badge (computed via `.length`), but only **~6-9 of the 43 are natively implemented** (`http_fetch`, `audit_log/query`, `model_call`, plus the real `knowledge.*`/`ask_domain` RAG tools, which do genuine DB + Anthropic calls). The other ~34 (`bash`, `vision_*`, `face_recognize`, `agi_evolve`, `agi_reason`, `browser_*`, `cron_*`, etc.) depend entirely on an external "Ava" MCP server via `AVA_MCP_URL`, which is blank in `.env.example` and has no implementation anywhere in this repo — every one of those 34 returns `503 ava_not_configured` by default. No actual MCP-protocol SDK (`@modelcontextprotocol`) is used anywhere; "MCP" here is hand-rolled REST branding, not the real protocol. The catalog also embeds fabricated static resource stats (hardcoded `uptime: '45d 12h'`, `episodes: 1247`) and several entries with no plausible connection to an EPC/construction platform (face recognition, AGI self-improvement). | AI/Trust | `src/constants/mcpTools.ts`; `api/routes/mcp.ts:79-115,245-250`; `api/services/mcp/denverMcpServer.ts` (separate, unmounted provider-side stub). |
| P2-04 | Two independent, non-synchronized frontend "auth" state stores (`useAppStore().auth.isAuthenticated`, actually used by `LoginScreen`; `useAuthStore().isAuthenticated`, referenced only by tests and orphaned module code) — updating one does not update the other. | Frontend/State | `src/modules/store/appSlice.ts:47-53`; `src/modules/store/zustand.ts:139-146`. |
| P2-05 | Role typing drift: strict union type in `appSlice.ts`/backend `PlatformRole`, but a loose `string` for the same concept in `pinUtils.ts`'s `OwnerCfg` and in `AuthState.role` — a role value could pass one type check and fail another silently. | Frontend/Types | `src/modules/store/appSlice.ts:44,51`; `src/modules/utils/pinUtils.ts:10-19`; `api/auth/saml/roleMapping.ts:21`. |
| P2-06 | PDF generation in the commissioning pack worker is an explicit unimplemented placeholder. | Backend | `api/services/packWorker.ts:216`. |
| P2-07 | Evidence pipeline returns a placeholder URL rather than a real evidence artifact link. | Backend | `api/services/evidence/evidencePipeline.ts:75`. |
| P2-08 | Version-string chaos: **7+ distinct, disagreeing "current version" values ship simultaneously** — `package.json` (`4.32.0`), same file's own `description` (`v4.26.0`), pino logger base + `/api/v1/health` response + worker logger (`9.0.0`, polled by uptime/Datadog/PagerDuty), startup log line (`v4.40.0`), OpenAPI spec `info.version` (`1.0.0`), diagnostics-export bundle (`v4.3`), login screen (`v4.30`), and dozens of per-file header comments ranging v1.0.0–v10.7.0 with no coherent scheme. None derive programmatically from `package.json`. | Docs/Release hygiene | `package.json:3,5`; `api/server.ts:189,400,730`; `api/worker.ts:49`; `api/services/openapi/openapiSpec.ts:57`; `src/modules/observability/index.ts:305`; `src/components/LoginScreen.tsx:246`. |
| P2-09 | README claims default PIN `1234` and RBAC roles `owner→exec→pm→engineer→viewer`; actual source default PIN is `0000` (`pinUtils.ts:26,90`; also shown in the live login screen) and actual roles are `owner/admin/project_manager/engineer/viewer`. A user following the README enters the wrong PIN and looks for the wrong role names. | Docs | `README.md:91`; `src/components/LoginScreen.tsx:114,121,240`; `src/modules/utils/pinUtils.ts:26,90`. |
| P2-10 | `npm run lint` fails locally (32 warnings, all "unused eslint-disable directive," one systemic pattern across 26 files) but CI's lint job (`--max-warnings 250`, `continue-on-error: true`) can never fail on this. This also contradicts the (already-superseded) `BUILD_VERIFICATION_REPORT.md` claim of "7 pre-existing warnings" — the real count has grown ~4.5x since that report. | CI/CD | Live `npm run lint` output; `.github/workflows/ci.yml` lint job config. |
| P2-11 | `npm run check:monolith` (the JarvisCore.jsx size gate the project's own docs treat as load-bearing) is never invoked by any CI workflow — only reachable via the `npm run ci` composite script, which itself isn't called from `.github/workflows/`. | CI/CD | `grep -rn "check:monolith" .github/workflows/` → no matches. |
| P2-12 | Three competing deployment targets are configured (Render, Fly.io, Vercel); only Render has an active auto-deploy trigger (`on: push: branches: [main]`). Fly is manual-only (`workflow_dispatch`). `vercel.json` has no corresponding workflow and no recent commit history — likely dead config, risk of accidental stale deploy if ever triggered. | DevOps | `.github/workflows/render-deploy.yml`, `fly-deploy.yml`; `git log -- vercel.json` (no dedicated commits). |
| P2-13 | `KNOWLEDGE_INGEST_ROOTS` is unrestricted-by-design when unset ("dev default" per code comment) — if unset in production, an authenticated admin could point document ingest at any filesystem path readable by the server process. | Security/Ops | `api/services/knowledgeBulkIngest.ts:14-16,83-102`. |
| P2-14 | Slack and Teams integration connectors fetch a config-supplied webhook URL with **no SSRF guard** — currently dead code (no live callers found anywhere), but a latent risk if wired to a user-editable config field later, following the pattern that's already correctly guarded elsewhere (`integrations.ts`, `mcp.ts`). | Security (latent) | `api/services/integration/slackConnector.ts:102`; `api/services/integration/teamsConnector.ts:134`. |
| P2-15 | `budgets.ts`/`changeOrders.ts` mutating endpoints have no value-level (type/range) validation on request bodies — column-name allowlisting prevents SQL injection, but a negative `original_total` or wrong-typed value would still be written. | Backend/Validation | `api/routes/budgets.ts:43-77`; no `zod`/`express-validator` usage found in sampled route files. |
| P2-16 | `/api/v1/ask` (RAG chat) and `/api/v1/agents/personal/*` have no dedicated rate limiter, unlike `/api/v1/gateway` (`aiLimiter`, 30/min) and `/api/v1/agents*` (`agentLimiter`, 20/min) — only the generic 600/min global limiter applies to these LLM-cost-bearing endpoints. | Security/Cost abuse | `api/server.ts:288-291,512,549,592-595,624`; no `rateLimit` usage found in `api/routes/ask.ts` or `api/routes/personalAgent.ts`. |
| P2-17 | Non-parameterized SQL string interpolation of a JWT claim (`auth.sub`) into an UPDATE statement in `budgets.ts`, breaking from the parameterized pattern used one line above and elsewhere in the codebase. Not directly exploitable today (claim is server-derived), but a real anti-pattern that would become exploitable if the claim source ever changes (e.g. future SCIM external-ID mapping). | Injection | `api/routes/budgets.ts:219-220` — string-interpolates `auth?.sub` into the SQL text instead of using a `$N` parameter. |
| P2-18 | Refresh-token reuse detection revokes only the single reused jti, with no session-family cascade — a leaked-and-reused refresh token doesn't trigger revocation of the user's other active sessions. | Auth | `api/auth.ts:199-246`; no `revokeAll`/`revokeUser`/family-based cascade found anywhere in `api/auth.ts` or the token store. |
| P2-19 | Duplicate, independently-fragile `JWT_SECRET` read in the SAML token bridge — currently non-exploitable (the guarded `auth.ts` read happens first and would already have exited on a missing secret), but a second, unguarded copy of the same insecure-fallback literal exists and would fail open if that module were ever imported standalone. | Auth | `api/auth/saml/samlTokenBridge.ts:17` vs. the guarded read in `api/auth.ts:30-41`. |

---

## 5. P3 Findings (lower severity / process hygiene)

- **P3-01** — ADR-012 (PersonalAgent) status is "Proposed," but Phase 1 was merged to `main` the same day (`docs/adr/ADR-012-per-user-agents.md:3`; commit `7880b45`/PR #15).
- **P3-02** — ADR-012's "no writes" claim for PersonalAgent is imprecise: it does write to its own memory store (`rememberForUser`/`forgetUserMemory`) and to `chat_sessions`/`chat_messages` — narrow, sandboxed, but not literally zero writes.
- **P3-03** — `PERSONAL_AGENT` flag correctly defaults off and gates before auth (no info leak), but has no HTTP-level integration test proving cross-user memory isolation, despite the ADR explicitly calling this out as required.
- **P3-04** — Migration numbering collision: both `077_coordination_recommendations.sql` and `077_safety.sql` use the number 077 (committed a day apart); not currently fatal due to defensive DDL, but an ordering-ambiguity hygiene defect.
- **P3-05** — `DOMAIN_MODEL.md` documents only migrations 001–075 and is stale by 7 migrations (076–082, including `082_personal_agent.sql`).
- **P3-06** — `api/routes/tenants.ts`'s `/me` GET/PATCH handlers lack the `try/catch` pattern used elsewhere in the same file (low risk — Express 5 auto-forwards async rejections to the error middleware).
- **P3-07** — Three independent `ErrorBoundary` implementations exist (`ViewErrorBoundary` in `ErrorBoundary.tsx`, `RootErrorBoundary` in `main.jsx`, `_JarvisErrorBoundary` in `JarvisCore.jsx`), none sharing a telemetry sink — all three still just `console.error` despite "a real observability sink would go here" comments.
- **P3-08** — The new (uncommitted) `scheduleParsers.test.ts`'s "malformed XML" test passes for an unrelated reason (empty-task fallback, not XML-parse failure), and the new `isNaN(uid)` guard it was written to cover has zero fixture actually triggering it (`Number('')` is `0`, not `NaN`) — the guard is real and harmless, but currently untested.

---

## 6. What's Actually Working (verified, not assumed)

- **Test suite:** `npx vitest run` → **5,268/5,268 passing, 0 failed** (151 test files) on current HEAD + uncommitted changes. This contradicts `BUILD_VERIFICATION_REPORT.md`'s claim of "2 pre-existing failures" — that report is stale and should be retired or updated.
- **Typecheck:** `npm run typecheck:all` → clean, 0 errors. The one CI gate that's identically wired locally and in CI.
- **Dependency audit:** `npm audit --audit-level=high` → 0 high/critical; 1 low-severity, dev-only (esbuild, not shipped in the production image).
- **Accessibility testing:** Real, substantive — `jest-axe`/`axe-core` wired into two test files with 16 total `toHaveNoViolations()` assertions against real rendered components, not just a doc claim.
- **SSRF guard (everywhere except P0-07):** webhook dispatch, integration health-check, and the AI `http_fetch` MCP tool are all correctly double-guarded (domain allowlist + private-IP/DNS-rebinding check).
- **Budget enforcement on `/ask` paths:** genuinely wired into the request path, fails open only on lookup errors, correctly blocks (402) on real over-budget — traced end to end (though see P1-10 for its test-coverage gap).
- **Federated DP k-anonymity gate:** the real Laplace-noise aggregation worker does enforce `K_ANONYMITY_MIN=5` correctly (though see P1-02 for a separate route that bypasses it, and P1-11 for its lack of tests).
- **Core schema (projects, RFIs, submittals, sensors):** spot-checked against migrations and consuming code — no drift found (in contrast to the EVM/change-order findings above).
- **New schedule-parser fix (uncommitted):** small, surgical, well-targeted at a real bug (XER's blank-string vs. `undefined` convention); all 17 new tests pass; safe to commit (see P3-08 for one minor test-quality note).

---

## 7. Recommended Remediation Roadmap (priority order, not yet authorized — audit only)

**Immediate (blocks any real usage):**
1. P0-01 — Add Vite dev-server `/api` proxy.
2. P0-02 — Regenerate local `.env` against real Postgres credentials; consider a seed/docker-compose path that guarantees this can't drift again.
3. P0-10 — Wire a hydration path from the backend into `useBizStore` (or migrate its ~50 consumers to live-fetch) — this affects more of the app's visible surface than the reported bug itself.
4. P0-11 — Fix `DirectoryView`'s unwired props in `ContentRouter.tsx`.
5. P0-03 — Reconcile the duplicate `change_orders` schema (007 vs 058) with a proper `ALTER TABLE` migration.
6. P0-04, P0-05 — Fix the two EVM column-name mismatches (`evm_actuals` insert, `evm_baselines.status`→`is_active`).

**Before any expanded/production tenant access:**
7. P0-06 — Enforce (fail-closed) `DATABASE_URL_APP` for RLS in non-dev environments; confirm production has it set.
8. P0-07 — Add `assertSafeUrl` to the SAML metadata-import fetch.
9. P0-08 — Make notification-delivery stubs fail loudly (or implement real delivery for at least the in-app channel).
10. P1-01 — Add platform-admin authz to `/enterprise/demo/*` and `/enterprise/deployment/health*`.
11. P1-02 — Add role check + server-side contributor-count computation to the federated-patterns publish route.

**Within the next sprint:**
12. P0-09 — Shared `fatalExit()` helper with proper log/Sentry flush.
13. P1-03/P1-04 — Either implement real AI generation for `DocumentationAgent` or clearly mark it non-functional; strip `ai_generated: true` from purely rule-based recommendation output (or make it genuinely AI-derived).
14. P1-05/P1-06/P1-07 — Auth hardening: check revocation blocklist on access tokens, add refresh-reuse detection, fix the fake-bcrypt-hash SAML JIT path.
15. P1-08 — Add process-level `uncaughtException`/`unhandledRejection` handlers.
16. P1-09/P1-10/P1-11 — Extend budget enforcement to `/api/v1/gateway`; add test coverage for budget paths and the federated-aggregation DP worker.

**Housekeeping (P2/P3, batchable):**
17. Single source of truth for version strings, injected at build time (P2-08).
18. Fix README PIN/RBAC drift (P2-09).
19. Reconcile lint threshold between local (0) and CI (250); bulk-remove the 32 dead `eslint-disable` directives (P2-10).
20. Wire `check:monolith` into CI or retire it (P2-11).
21. Decide on one deployment target; retire dead Vercel config (P2-12).
22. Confirm `KNOWLEDGE_INGEST_ROOTS` is set in production (P2-13).
23. Remaining P2/P3 items as capacity allows, including the frontend cross-cutting error-handling anti-pattern (bare `catch` blocks with no `console.error`, found across ~10+ views beyond MyWorkView) and the three mutually-inconsistent version strings shown directly to end users (login screen v4.30, Settings v4.23.0, package.json 4.32.0).

---

## 8. Notes on Audit Methodology

This audit used 6 independent evidence-gathering passes (backend, frontend, security/auth, security/SSRF, AI-layer/data-model, tests/CI/deployment) plus direct runtime reproduction of the reported symptom, rather than trusting the extensive pre-existing `audit/` and `docs/audit/` documentation, which this review found to be materially stale in several places (test-failure counts, lint-warning counts, DP-001 status, DOMAIN_MODEL.md's migration coverage). Where two independent passes reached conflicting conclusions about the same code (e.g. the `change_orders` schema), this report reflects direct re-verification, not either original claim in isolation. All findings above are backed by a specific file:line citation and, where feasible, a live reproduction step — per the evidence-hierarchy requirement (runtime > source > tests > build > docs).
