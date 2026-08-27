# Denver Engineering — System Architecture

> **Status:** Build-ready v2 · Grounded in `api/server.ts`, `api/db/pool.ts`, `api/auth.ts`, `api/middleware/tenant.ts`, the 75 SQL migrations, and `src/`.
> **Companion specs:** [Product Requirements](PRODUCT_REQUIREMENTS_DOCUMENT.md) · [Domain Model](DOMAIN_MODEL.md)
> **Honesty legend:** ✅ exists · 🟡 partial · ❌ missing · ⚠️ present-but-not-trustworthy. See [FEATURES.md](FEATURES.md).

---

## 1. Topology — today

Denver runs as a **monolithic Express API + React SPA**, deployed on Fly.io, in front of Neon-managed PostgreSQL 16 (pgvector) and optional Redis. The "AI agent orchestrator" (Ava) is an **external** service reached over an MCP bridge; it is not part of this deployable.

```
                         ┌──────────────────────────────────────────────┐
   Browser (HTTPS/WSS)   │  React 18 SPA  (Vite build → dist/)           │
  ───────────────────────▶  • Zustand store (appSlice.ts): auth, ui,     │
                         │    deepLink, gateway                         │
                         │  • ContentRouter lazy-loads ~50 view modules │
                         │  • CopilotView → /api/v1/copilot/focus       │
                         │  • WebSocket client (ticket-authenticated)   │
                         └───────────────┬──────────────────────────────┘
                          REST /api/v1   │  WSS /ws?ticket=…
                         ┌───────────────▼──────────────────────────────┐
                         │  Express API  (Node 20, TypeScript, ESM)     │
                         │  api/server.ts — single app, see §3 order    │
                         │  • 76 route modules  /api/v1/*               │
                         │  • requireAuth (JWT) + requireTenant (RLS)   │
                         │  • Helmet CSP · CORS · CSRF · rate limits    │
                         │  • WebSocket gateway (realtime/wsGateway)    │
                         │  • In-process background workers (§7)        │
                         │  • AI gateway proxy → api.anthropic.com      │
                         │  • MCP bridge → AVA_MCP_URL (external)       │
                         └───┬───────────────┬───────────────┬──────────┘
                  pg (pool)  │      redis     │     fetch     │
              ┌──────────────▼──┐  ┌──────────▼────┐  ┌───────▼────────────┐
              │ PostgreSQL 16   │  │ Redis         │  │ External services  │
              │ + pgvector      │  │ • token revoke│  │ • Anthropic Claude │
              │ • 2 pools:      │  │ • refresh jti │  │ • OpenAI embeddings│
              │   _pool (owner) │  │   store       │  │ • Ava MCP (skills) │
              │   _appPool      │  │ • health probe│  │ • S3 (presigned)   │
              │   (jarvis_app)  │  └───────────────┘  └────────────────────┘
              │ • ~224 RLS tables                                          
              └──────────────────┘
```

**Tech stack (verified):** React 18 · Vite · TypeScript · Zustand · Express · Node 20 · PostgreSQL 16 · pgvector · Redis · Pino · Helmet · `jsonwebtoken` · bcrypt · samlify (SAML) · `@anthropic-ai/sdk` · Fly.io + Neon hosting.

---

## 2. Topology — target

The shipped monolith is correct for the current stage. The target separates concerns to satisfy enterprise scale, deployment tiers, and the autonomy roadmap, **without** rewriting the data model:

```
        ┌─────────────┐   ┌──────────────────┐   ┌────────────────────┐
        │ Edge / CDN  │   │ Web (SPA static) │   │ Public API Gateway │
        └─────────────┘   └──────────────────┘   └─────────┬──────────┘
                                                            │ (authZ, rate, WAF)
        ┌───────────────────────────────────────────────────▼──────────────┐
        │  Stateless API tier (N replicas behind LB)                        │
        │   • request/tenant/auth pipeline (unchanged)                      │
        └───┬───────────────┬───────────────┬───────────────┬──────────────┘
            │               │               │               │
   ┌────────▼──────┐ ┌──────▼───────┐ ┌─────▼──────┐ ┌──────▼─────────────┐
   │ Worker tier   │ │ AI subsystem │ │ Realtime   │ │ Object-graph svc   │
   │ (lease-locked │ │ • RAG/Ask    │ │ WS gateway │ │ (impact traversal, │
   │  job runners) │ │ • Predict    │ │ + pub/sub  │ │  kg_entities)      │
   └───────┬───────┘ │ • Agents/MCP │ └────────────┘ └────────────────────┘
           │         └──────┬───────┘
   ┌───────▼─────────────────▼───────────────────────────────────────────┐
   │ PostgreSQL 16 (HA primary + read replicas) + pgvector                │
   │ Redis cluster · Object store (S3) · per-tenant region pin            │
   └──────────────────────────────────────────────────────────────────────┘

Deployment tiers (one codebase, three profiles): SaaS multi-tenant · Air-gapped
single-tenant (air_gap_licenses) · FedRAMP/gov (control overlay — ❌ planned).
```

Key target moves: (a) extract background workers into a leased worker tier (`worker_leases` table already exists for this); (b) split the AI subsystem onto its own scaling axis (LLM latency ≠ CRUD latency); (c) add an explicit **object-graph service** for cross-entity impact traversal (PRD §7).

---

## 3. Request lifecycle & security middleware order

The order in `api/server.ts` is load-bearing — each layer assumes the previous ran. Reproduced from source:

```
1.  helmet()                         CSP: script-src 'self'; style-src 'self' 'unsafe-inline';
                                     connect-src 'self' wss: https://api.anthropic.com;
                                     frame-ancestors 'none'; object-src 'none'
2.  cors({ origin: ALLOWED_ORIGINS, credentials:true })
3.  express.json({limit:'2mb'}) · urlencoded · cookieParser()
4.  Correlation-ID middleware        X-Correlation-ID ← header | X-Request-ID | random
5.  GET /metrics (Prometheus) + metricsMiddleware (per-request method/route/status/duration)
6.  Request-ID + Pino structured access log (health noise suppressed)
7.  app.set('trust proxy', 1)        (correct client IP for limiters)
8.  Rate limiters:  /api/ → 600/min ; /api/v1/auth/ → 200/15min
                    (AI 30/min and agent 20/min applied at their mounts)
9.  Audit middleware                 wraps res.json: on 2xx mutation →
                                     INSERT audit_log (redacted body) + emitEvent(webhook)
10. GET /api/v1/health               (DB ping + Redis ping + mem + pool stats)
11. Auth routes                      login / refresh / logout / me / csrf / ws-ticket
12. SAML (/api/v1/auth/saml, /saml) · SCIM (/scim/v2, /api/v1/scim)
13. DELETE /api/v1/auth/me           (GDPR erasure → data_deletion_requests)
14. requireCsrf  on ALL /api/v1      (double-submit; Bearer-token clients auto-exempt)
15. /api/v1/tenants                  (tenant registration/admin)
16. UUID param guards                registerUuidParamGuards + validateUuidQueryParams
17. Domain routers  (~70)            each: requireAuth → requireTenant() → handler
18. POST /api/v1/gateway             requireAuth + aiLimiter → proxy to api.anthropic.com
19. Static SPA (prod)                serve dist/, SPA fallback for non-/api routes
20. 404 → errorTrackingMiddleware    (Sentry capture, last middleware)
```

### Per-request authn → tenant → RLS chain
For a typical domain call (`GET /api/v1/rfis`):

```
requireAuth (api/auth.ts)
  ├─ token: cookie jarvis_at  → else  Authorization: Bearer <jwt>
  ├─ jwt.verify(JWT_SECRET) → payload { sub, tid, role, jti }
  └─ req.auth = payload
requireTenant() (api/middleware/tenant.ts)
  ├─ tenant ← lookupById(req.auth.tid)   [60s in-proc cache]
  │   (X-Tenant-ID header fallback REMOVED — P1-B hardening; tid must come from verified JWT)
  ├─ reject if status != 'active' (403)
  └─ req.tenantId / req.tenant set
handler → tenantQuery(tenantId, sql, params)  (api/db/pool.ts)
  ├─ client = _appPool.connect()              [jarvis_app non-owner role when DATABASE_URL_APP set]
  ├─ BEGIN
  ├─ SELECT set_config('app.current_tenant_id', tenantId, true)   ← sets the RLS GUC, txn-local
  ├─ <query>   → RLS policy filters: tenant_id = current_setting('app.current_tenant_id')::uuid
  └─ COMMIT (ROLLBACK on error)
```

---

## 4. Multi-tenancy & Row-Level Security

**Model:** shared-schema, shared-DB, RLS-isolated. One `tenants` row per customer; every tenant-scoped table carries `tenant_id UUID NOT NULL` and an RLS policy.

**Policy pattern (every tenant table):**
```sql
ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON <t>
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
```

**The owner-bypass footgun and its fix (AUD-002).** PostgreSQL **exempts a table's OWNER from RLS** unless `FORCE ROW LEVEL SECURITY` is set. The app historically connected as `jarvis` (the table owner), which silently disarmed every policy. Remediation, all in-repo:

- `075_rls_app_role_grants.sql` — creates role **`jarvis_app` with `NOBYPASSRLS`**, grants `SELECT/INSERT/UPDATE/DELETE` on all tables + sequences, and sets default privileges for future tables.
- `api/db/pool.ts` — `tenantQuery` / `tenantTransaction` connect via **`_appPool`** (built from `DATABASE_URL_APP`, the `jarvis_app` connection string) so request-path traffic is RLS-subject; `query()` (workers, migrations, admin) keeps the owner pool.
- `072_rls_hardening.sql` — adds `FORCE ROW LEVEL SECURITY` to sensitive tables (and `073/074` do the same for SAML/SCIM), so even an owner connection is filtered.
- `070_rls_missing_tables.sql`, `069_rls_transmittal_counters.sql`, `056_rls_backfill_*.sql` — backfill RLS on tables that shipped without it.

**Special policies.** `worker_leases` (system locks) uses `tenant_id IS NULL OR tenant_id = current_setting(...)`. `workflow_versions` has no `tenant_id`, so it isolates via subquery to its parent `workflows`. Truly global tables intentionally carry **no RLS**: `tenants` (the anchor), `cost_items` seed, `federated_patterns`/`benchmark_cohorts`/`marketplace_playbooks`/`plugins`/`external_agents` (cross-tenant registries).

> ⚠️ **Operational caveat (also a P0 in the PRD):** RLS only bites when `DATABASE_URL_APP` is configured. If unset, `_appPool === _pool` (owner) and the app-layer `WHERE tenant_id = $1` clauses are the sole isolation control. Every non-dev environment must set it; CI should prove cross-tenant reads return zero rows under `jarvis_app`.

---

## 5. The AI subsystem

Five layers, increasing autonomy. Layers 1–2 are ✅; 3 is the ✅ differentiator; 4–5 are 🟡 governed scaffolds.

### 5.1 Retrieval — pgvector RAG corpus
- Ingest: upload → `knowledge_sources` → chunk → `knowledge_chunks` (with `search_tsv` FTS column + `embedding`).
- Embeddings: `embedding vector(1536)` on `knowledge_chunks` (`071_pgvector.sql`), index **`ivfflat (embedding vector_cosine_ops)`**. Migration `025_vector_embeddings.sql` documents an HNSW alternative (online insert) and an `embedding_json` fallback column so dimensions can change without re-embedding. Embedding model is OpenAI `text-embedding-3-*` family (1536-dim); dimension asserted at write time (`api/services/knowledgeEmbed.ts`, `EMBED_DIMENSIONS`).
- Retrieval blends **pgvector cosine similarity + PostgreSQL FTS** for hybrid ranking.

### 5.2 Ask Jarvis — grounded chat
- `POST /api/v1/ask` (`api/routes/ask.ts` → `api/services/askBuilder.ts`). Persists to `chat_sessions` / `chat_messages`.
- **Guardrails:** 6-pattern prompt-injection regex (`/ignore previous instructions/i`, "DAN mode", etc.) rejects with 422 *before* any LLM call; question length cap 4000 chars; answers must carry citations to retrieved chunks (`GET /api/v1/ask/chunks/:id` powers citation hover).
- LLM calls go through the backend AI gateway (`POST /api/v1/gateway`) so the `ANTHROPIC_API_KEY` is never exposed to the browser. AI usage is metered to `ai_usage_records` (tokens, cost, latency).

### 5.3 Project Copilot — the deterministic decision engine (differentiator)
This is the heart of "DECIDE." `api/services/copilot/projectCopilotService.ts`:

```
buildProjectFocus(tenantId, projectId)
  └─ parallel tenantQuery: rfis | submittals | risks | inspections | punch_items | actions  (+ project row)
       (server-side filters: open/pending RFIs, under-review submittals, risk_score≥12,
        scheduled-or-failed inspections, open punch, open/in-progress actions not already surfaced)
  └─ synthesizeFocus(inputs, now, limit)   ← PURE, deterministic, fully unit-testable
       • per-source item builder scores each row 0–100:
           base + PRIORITY_WEIGHT(low0/med10/high22/crit38)
                + dueModifier(overdue +3/day cap30; due-soon +4)
                + source nuances (unassigned RFI +10; failed inspection +; budget overrun ∝ %;
                  schedule past planned_finish + progress<90 +8)
       • severity = score≥75 crit / ≥55 high / ≥40 med / else low
       • sort: score desc → most-overdue → source (stable)
       • headline + {total,critical,high,medium,low} summary
buildPortfolioFocus(tenantId)
  └─ top active projects (≤25) → buildProjectFocus each → merge → re-rank → top N
```

Output is a `FocusItem[]` each with `why` (plain-English explanation), `recommendedAction`, `impacts[]`, `sourceId`, and `severity`. The frontend (`CopilotView.tsx`) renders ranked cards and, on click, calls `openRecord` → sets a `deepLink` in the Zustand store → the destination view claims it via `useDeepLink(source)` and opens the exact record. **This closes the loop from "what matters" to "the record to act on."** Because `synthesizeFocus` is pure over already-fetched rows, the ranking is testable without a DB and trivially extensible to learned weights.

### 5.4 Predict & adaptive — 🟡
`predict` route + `adaptive` (`047_adaptive_intelligence.sql`): schedule-delay/cost-overrun probability, anomaly radar, and a forecast-accuracy/calibration loop. **Heuristic, not benchmarked** — surfaced as advisory, not authoritative.

### 5.5 Agents, governance & MCP bridge — 🟡 (governed)
- **Orchestration:** `api/services/agents/agentOrchestrator.ts` maps an *objective* (`assess_readiness`, `incident_response`, `optimize_operations`, `validate_and_document`) to a dependency-ordered task tree of routing hints, enqueues to `agent_tasks` (status machine: `queued→assigned→running→completed/failed/blocked/pending_approval`), and runs a governance check before execution. Per-decision rationale is written to `agent_actions` (`agent_name`, `decision`, `rationale`, `confidence`, `human_reviewable`).
- **Governance queue (human-in-the-loop):** `ai_recommendation_queue` (`041_ai_governance.sql`) — each recommendation carries `confidence_score`, `impact_score`, `urgency_score`, `reason`, `data_signals`, `affected_entities`, and a **`rollback_plan` JSONB**; status `pending→approved/rejected/executed/expired`. This is what makes autonomy defensible.
- **MCP bridge:** `api/routes/mcp.ts`. **Native tools** run in-process: `http_fetch` (SSRF-guarded by `ALLOWED_FETCH_DOMAINS` allowlist via `assertSafeUrl`), `audit_log`, `audit_query`, `model_call`, `embedding_create`, `session_create`. **Every other tool** is proxied to the external Ava orchestrator at `AVA_MCP_URL`; `bash`/`file_read`/`process_kill` are Ava-only and blocked if Ava is unreachable. ⚠️ The discipline calculators route through MCP but **no backend implements the process math** — see [FEATURES.md](FEATURES.md).

---

## 6. Real-time

WebSocket gateway (`api/realtime/wsGateway.ts`) registered on the HTTP server at startup. Auth uses **short-lived single-use tickets**, not query-string JWTs (AUD-010): client calls `GET /api/v1/realtime/ws-ticket` (authenticated) → `issueWsTicket(sub, tid)` → connects `wss://host/ws?ticket=<ticket>`. The notification worker (`registerNotificationWorker`) and event broadcaster push action/project/sensor updates to subscribers. The same mutation that writes `audit_log` also `emitEvent()`s, so webhooks and WS feeds stay consistent.

---

## 7. Background workers

All currently run **in-process** in the API (registered in `start()` in `api/server.ts`); the generic `scheduler` (`009_scheduler.sql`) is a DB-backed job runner with lazy handler registration. Workers:

| Worker | Cadence / trigger | Purpose |
|--------|-------------------|---------|
| `packWorker` | queue (`generation_jobs`) | Commissioning pack generation (draft/finalize) |
| `scheduler` | generic | Runs all registered job-type handlers |
| `slaEngine` | periodic | Escalate overdue actions, recompute operational risk |
| `notificationWorker` | queue (`notification_jobs`) | Deliver notifications to WS subscribers |
| `webhookDispatch` | event | Sign (HMAC) + deliver + retry outbound webhooks |
| `integrationSync` | scheduled | Run registered integration syncs |
| `kpiSnapshot` / `analyticsSnapshot` / `readinessSnapshots` | nightly | KPI / action-analytics / readiness aggregation |
| `complianceWatcher` | periodic | Flag overdue `compliance_tasks` |
| `auditRetention` | periodic | Purge `audit_log` past retention |
| `knowledgeIngest` / `knowledgeEmbed` / `fixExtractor` | queue | Chunk docs · call embeddings API · mine fix patterns |
| `ifcParseWorker` | every 15 s (`ifc_parse_jobs`) | Parse uploaded IFC → `bim_elements` |
| `federatedAggregationWorker` | every 5 min | Differential-privacy cross-tenant aggregation |
| token purge | hourly | Drop expired/revoked `refresh_tokens` |

**Target:** move these to a leased worker tier — `worker_leases` (lease_key, worker_id, expires_at, heartbeat) already exists so only one replica runs each singleton. Graceful shutdown drains workers + flushes Sentry on SIGTERM/SIGINT.

---

## 8. The unified object-graph target

The data already carries the edges (see [Domain Model](DOMAIN_MODEL.md) §“Object graph”): `actions.source_module/source_id` (polymorphic back-link to RFI/submittal/punch/inspection/BIM issue/daily log), `action_relations` (typed `blocks`/`caused_by`/`spawned_from`/`escalated_from` DAG), `bim_element_links` + geo soft-links (`bim_element_id`/`ifc_guid` on punch/deficiency/action), `evidence_links`, `transmittal_items`, the `systems→…→deficiencies` Cx chain, `evm_wbs_entries` ↔ `schedule_tasks`, and two purpose-built graph stores: **`kg_entities`/`kg_relationships`** (typed knowledge graph, source = inferred/explicit/federated) and **`operational_twins`** + twin edges (digital-twin mirror with `readiness_score`/`risk_score`/`health_score`).

What's **missing** (the headline P2 build) is a **traversal service** that answers cross-entity impact queries — "this open RFI touches drawing A-201 rev C → system MV-01 → test pack TP-014 → CPM activity 1240 (6 days float) → cost code 16-100." Today the Copilot scores each source independently. The target service materializes `kg_relationships` from the existing FK/soft-link edges and exposes bounded graph traversal so both the Copilot and the agents can reason about chains, not just rows.

---

## 9. Deployment tiers

| Tier | Audience | Mechanism | Status |
|------|----------|-----------|--------|
| **SaaS multi-tenant** | Commercial, primary markets | Shared-schema RLS on Fly.io + Neon; per-tenant SAML/SCIM | ✅ today |
| **Air-gapped single-tenant** | Embassies, secure gov, critical infra | One codebase, offline license (`air_gap_licenses`: license_key_hash, tier, seat_limit, feature_set, signature), edge nodes (`edge_nodes`, `edge_sync_sessions`) | 🟡 schema only |
| **FedRAMP / government cloud** | Federal, DoD | Control overlay (FIPS crypto, boundary, continuous monitoring), region pin, audit export (`compliance_exports`) | ❌ planned |

---

## 10. Tech stack reference

| Layer | Choice |
|-------|--------|
| Frontend | React 18, Vite, TypeScript, Zustand (`devtools` + `persist`) |
| API | Express, Node 20, TypeScript (ESM) |
| AuthN | `jsonwebtoken` (HS256), bcrypt(12), httpOnly cookies + Bearer |
| AuthZ | DB roles (`user_role` enum) + RLS GUC `app.current_tenant_id` |
| DB | PostgreSQL 16, `pg` pool (×2: owner + `jarvis_app`), pgvector |
| Cache/session | Redis (token revocation + refresh-jti store) |
| Search/AI | pgvector (ivfflat/HNSW cosine) + FTS; Anthropic Claude; OpenAI embeddings |
| SSO | samlify (SAML 2.0); SCIM 2.0 bearer tokens |
| Realtime | `ws` gateway, ticket auth |
| Security | Helmet CSP, CORS, CSRF double-submit, rate-limit, SSRF allowlist, UUID guards |
| Observability | Pino, Prometheus `/metrics`, Sentry |
| Storage | S3 presigned upload (local fallback) |
| Hosting | Fly.io (Node 20) + Neon PostgreSQL 16; Redis optional (Upstash) |

---

## 11. Architectural debt (called out honestly)

1. **RLS is opt-in at runtime** (§4 caveat) — must make `DATABASE_URL_APP` mandatory + CI-proven. *Highest priority.*
2. **Workers run in the API process** — a busy worker can starve request latency; needs the leased worker tier (`worker_leases` is ready).
3. **Single region, single primary PG** — no HA/read-replica/PITR strategy documented; DR is Neon defaults.
4. **Schedule engine is FS-only** — no SS/FF/SF, calendars, or resource leveling; limits P6 fidelity.
5. **Engineering calculators are ⚠️ shells** — must never ship to an enterprise eval as validated; bridge to real engines or hide.
6. **Object-graph traversal not yet a service** — the edges exist but cross-entity impact analysis is unbuilt (§8); it's the core differentiation gap.
7. **Agent autonomy not production-trusted** — governance + rollback exist; unattended execution needs the trust bar (PRD §8) before enabling.
8. **`emitEvent`/audit are fire-and-forget** — acceptable for now, but at scale need an outbox to avoid lost events.

---

*Grounded in the repository as of the `audit/enterprise-remediation` branch. Diagrams reflect actual mounts and middleware order in `api/server.ts`.*
