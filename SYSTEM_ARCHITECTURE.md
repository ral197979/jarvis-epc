# System Architecture — Denver Engineering

> v1, grounded in the live repo (`api/server.ts`, `api/db/`, `src/`, `render.yaml`). Describes
> **what runs today** and the **target architecture** for the AI-native platform.

---

## 1. High-level topology (today)

```
┌──────────────────────────────────────────────────────────────┐
│ React 18 SPA  (Vite + TypeScript, src/)                      │
│  • ContentRouter lazy-loads 50+ view modules                 │
│  • Zustand store (src/modules/store/appSlice.ts)             │
│  • WebSocket client for real-time events                     │
│  • Project Copilot "Focus" view (src/components/copilot)     │
└───────────────┬──────────────────────────────────────────────┘
                │ REST /api/v1  +  WebSocket (JWT ws-ticket)
┌───────────────▼──────────────────────────────────────────────┐
│ Express API (Node 20, TypeScript, api/server.ts)            │
│  • ~70 route modules under /api/v1                           │
│  • ~67 services/workers (api/services/*)                     │
│  • Auth: JWT access + httpOnly refresh cookie; Redis revoke  │
│  • Tenant middleware sets RLS GUC (app.current_tenant_id)    │
│  • Helmet CSP, CORS allowlist, global + auth rate limiters   │
│  • CSRF on mutating /api/v1; SCIM + SAML mounted separately  │
│  • WebSocket gateway (realtime/wsGateway, eventBroadcaster)  │
└───────────────┬───────────────────────┬──────────────────────┘
                │                        │
        ┌───────▼────────┐      ┌────────▼─────────┐
        │ PostgreSQL 16  │      │ Redis            │
        │ + pgvector     │      │ token revoke,    │
        │ RLS per tenant │      │ queues/cache     │
        └───────┬────────┘      └──────────────────┘
                │
        ┌───────▼──────────────────────────────────┐
        │ Async workers (api/worker.ts, packWorker, │
        │ ifcParseWorker, notificationWorker, …)    │
        └───────────────────────────────────────────┘
   External: Anthropic Claude (RAG/Copilot), MCP bridge (AVA_MCP_URL),
   integration connectors (quickbooks/slack/teams today)
   Hosting: Render (Node 20, managed PG16, Redis) — render.yaml
```

## 2. Request lifecycle & security middleware (order matters)

From `api/server.ts`:
1. Helmet (CSP) → CORS → JSON/urlencoded body limits → cookie parser.
2. Metrics + request logging (health noise suppressed).
3. Rate limiting: global `/api/`, stricter `/api/v1/auth/`.
4. Auth endpoints (`/auth/login|refresh|logout|me`, `/auth/csrf`, ws-ticket).
5. SAML (`/saml`, `/api/v1/auth/saml`) and SCIM (`/scim/v2`) mounted with their own auth.
6. CSRF guard on `/api/v1` (safe methods exempt).
7. Tenant scoping (`/api/v1/tenants` + `requireTenant()`), UUID query validation.
8. Domain routers (projects, rfis, submittals, drawings, bim, budgets, evm, cost, procurement, inspections, punch, risks, schedule, ask, predict, copilot, executive, ops, agents, …).

## 3. Multi-tenancy & data isolation

- **Row-Level Security** on tenant tables; tenant id injected as a Postgres GUC per request, enforced in SQL via `tenant_id = current_setting('app.current_tenant_id')::uuid`.
- RLS hardening/backfill migrations: `056`, `070`, `072`, `075`.
- `tenantQuery(tenantId, sql, params)` / `tenantTransaction` are the only sanctioned data-access paths for tenant data; `query` for system tables.

## 4. AI subsystem

- **Retrieval:** pgvector (`071_pgvector`) over ingested knowledge; `knowledgeEmbed`, `knowledgeSearch`, `knowledgeIngest`; citations enforced in Ask Jarvis.
- **Ask Jarvis:** grounded RAG chat (Anthropic Claude) with prompt-injection guard and session persistence.
- **Predict:** statistical/ML forecasting (`predict/predictService`).
- **Project Copilot (new):** `api/services/copilot/projectCopilotService.ts` — a **pure deterministic ranking engine** over live cross-module rows (RFIs, submittals, risks, inspections, punch, actions, cost, schedule); DB wrappers `buildProjectFocus` / `buildPortfolioFocus`; exposed at `/api/v1/copilot/*`. Deterministic by design → testable, explainable, no hallucination in ranking.
- **Agents/governance:** `agents/*`, runbook engine, AI governance/approval queue — scaffolding for Phase 12 autonomy.
- **MCP bridge:** `/api/v1/mcp/execute` proxies non-native tools to `AVA_MCP_URL` (note: discipline calc engines are **not** implemented behind it — see `FEATURES.md`).

## 5. Real-time

WebSocket gateway authenticated via short-lived ws-ticket; `eventBroadcaster` publishes action/project/sensor events; clients subscribe per tenant/project.

## 6. Background processing

Dedicated workers for IFC parsing (`ifcParseWorker`), commissioning pack generation (`packWorker`), notifications (`notificationWorker`), webhooks (`webhookDispatch`), plus a general `api/worker.ts`. Heavy/slow work must never block request threads.

## 7. Target architecture additions (roadmap)

- **Event/decision log as first-class store** — immutable, append-only activity & decision stream feeding the Copilots (Phase 11/12) and audit (Phase 14).
- **Object graph for AI-connectedness** — every entity linked (RFI↔drawing↔spec↔system↔schedule task↔cost code) so AI can traverse impact; partially present via `geo_links`/knowledge graph services, needs unification.
- **Integration gateway** (Phase 13) — connector SDK + sync engine (`integrationSync`, `webhookDispatch` exist) extended to P6/MSP/Procore/ACC/Aconex/Unifier/SAP/Bluebeam/Power BI.
- **Deployment tiers** — managed SaaS (Render today) + air-gapped/on-prem package + FedRAMP-aligned GovCloud path (Phase 14).
- **Autonomy loop** — monitor→detect→recommend→execute-with-approval, every step persisted to the decision log.

## 8. Tech stack (verified)

React 18 · Vite · TypeScript · Zustand · Express · Node 20 · PostgreSQL 16 · pgvector · Redis · Pino · Helmet · jsonwebtoken · bcrypt · samlify (SAML) · SCIM 2.0 · Playwright/Vitest · Render.

## 9. Known architectural debt

- Engineering calc tools are front-end shells; no validated calc backend (`FEATURES.md`).
- Object-graph linking is fragmented across services; needs a unified graph for full AI-connectedness.
- Integration marketplace essentially unbuilt beyond a few connectors.
- Immutable-log / air-gap / FedRAMP are stated goals, not yet implemented.
