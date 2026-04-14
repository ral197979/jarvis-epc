# JARVIS EPC — CHANGELOG

## v4.27.0 — NextActionsBar + MCPToolsPage Integration
**Date:** 2026-04-06
**Type:** Feature extraction (P1/P2 from jarvis-app.jsx delta analysis)

---

### Added — NextActionsBar (`src/components/NextActionsBar.tsx`)

- Cross-domain prioritized action widget rendered on **every page** above module content
- Surfaces top 3 high-priority open action items, top 2 critical/high service tickets,
  and top 2 unread high-priority notifications in a single consolidated bar
- Each item is clickable — delegates to `onOpen()` in JarvisCore for tab navigation
  and entity drawer activation
- Auto-hides when no high-priority items are present (zero-noise design)
- Reads from `useBizStore` via `selectActionItems`, `selectTickets`, `selectNotifications`
- "+ Action" and "Timeline" shortcuts accessible from any module
- Kind badges (Action / Ticket / Alert) with per-type accent colours
- Full keyboard accessibility; all buttons have `aria-label`

### Added — MCPToolsPage (`src/components/MCPToolsPage.tsx`)

- Replaces inline `Gn()` function on the `mcp` tab with a typed extracted component
- Categorized grid of all 43 registered MCP tools (System / Browser / Automation /
  Vision / AGI / Skills / MCP / Security / AI)
- Per-tool card: monospace name, description, parameter list
- Resources panel for 4 MCP resources (config, AGI, VBRD, skills) with expand/collapse
  showing live JSON data
- Live search filter narrows visible tools by name, description, category, or params
- Tool count in subtitle updates reactively as filter changes
- Zero backend dependency — read-only static data from typed constants

### Added — MCP Constants (`src/constants/mcpTools.ts`)

- New shared constants module: `JARVIS_MCP_TOOLS`, `JARVIS_MCP_RESOURCES`
- TypeScript types: `MCPTool`, `MCPResource`, `MCPToolCategory`
- Category ordering and accent colour map extracted for reuse
- Single source of truth — replaces runtime-scoped `oi` / `Ai` variables in JarvisCore

### Changed — JarvisCore.jsx

- Phase 20 imports added for `JarvisNextActionsBar` and `JarvisMCPToolsPage`
- `m === "mcp"` renderer now delegates to `JarvisMCPToolsPage` (was inline `Gn`)
- `JarvisNextActionsBar` injected into `<main>` before `Q` — visible on all tabs

### Tests Added

- `src/__tests__/components/NextActionsBar.test.tsx` — 18 tests
- `src/__tests__/components/MCPToolsPage.test.tsx` — 22 tests

---

## v4.26.0 — Production Infrastructure Release
**Date:** 2026-04-01
**Type:** Major backend upgrade

---

### Added — Real Database Layer

- **PostgreSQL integration** (`api/db/pool.ts`)
  - `pg` connection pool with configurable min/max connections
  - Tenant-aware query helpers: `tenantQuery()`, `tenantTransaction()`
  - Automatic `SET LOCAL app.current_tenant_id` injection for Row Level Security
  - Slow query logging (>500ms threshold)
  - Startup health check + graceful SIGTERM drain

- **Migration runner** (`api/db/migrate.ts`)
  - Sequential, idempotent SQL migrations tracked in `schema_migrations`
  - Runs automatically on server startup
  - Can be run standalone: `tsx api/db/migrate.ts`

- **Database schema** (4 migrations)
  - `001_tenants_and_users.sql` — Tenants, users, refresh_tokens, audit_log with RLS
  - `002_epc_core.sql` — Projects, vendors, contracts, purchase orders, RFIs, submittals, WIRs, risks, action items, CRM leads
  - `003_files.sql` — Document folders, documents, document versions, upload tokens, storage quota trigger
  - `004_integrations.sql` — Integrations registry, outbound webhooks, webhook delivery log, sync jobs

---

### Added — Multi-Tenancy

- **Tenant resolution middleware** (`api/middleware/tenant.ts`)
  - Resolves tenant from: JWT `tid` claim → `X-Tenant-ID` header → subdomain
  - 60-second in-process tenant cache
  - Validates tenant `status === 'active'` on every request
  - `invalidateTenantCache()` for plan/status changes

- **Tenant management routes** (`api/routes/tenants.ts`)
  - `POST /api/v1/tenants` — Public self-service registration (rate-limited: 10/hour)
  - `GET/PATCH /api/v1/tenants/me` — Tenant info + settings
  - Full user management: invite, update role/status, remove
  - Storage + user quota tracking: `GET /api/v1/tenants/me/usage`

- **Row Level Security** — All domain tables enforce `tenant_id` isolation at the database level. Application can never accidentally read cross-tenant data.

- **Multi-tenant JWT** (`api/auth.ts`)
  - Tokens include `tid` (tenant UUID) and `role` from PostgreSQL
  - Login validates user email/password against database (bcrypt 12 rounds)
  - Account lockout after 5 failed attempts (15-minute lockout)
  - Refresh tokens persisted to `refresh_tokens` table for cross-process revocation
  - Single-owner PIN mode removed

---

### Added — File Management

- **Storage abstraction** (`api/files/storage.ts`)
  - `local` backend: filesystem with secure path traversal prevention
  - `s3` backend: AWS S3 / MinIO / Cloudflare R2 / Tigris via `@aws-sdk/client-s3`
  - Switch via `STORAGE_BACKEND=local|s3`
  - Presigned upload URLs (1 hour TTL)
  - Presigned download URLs (configurable TTL)
  - `streamToKey()` for direct streaming uploads
  - SHA-256 checksum tracking

- **File routes** (`api/routes/files.ts`)
  - `POST /api/v1/files/request-upload` — Quota-checked presigned slot
  - `PUT /api/v1/files/upload/:token` — Local backend direct receive
  - `POST /api/v1/files/confirm/:versionId` — Mark upload complete
  - `GET /api/v1/files/presign/:versionId` — Presigned download URL
  - `GET /api/v1/files/download/:token` — Local backend streaming
  - Full document CRUD with versioning
  - Folder tree management (hierarchical paths)
  - Storage quota enforcement per tenant

- **Automatic storage quota tracking** — PostgreSQL trigger maintains `tenants.used_storage_gb` on every version activate/delete

---

### Added — External Integrations

- **Integrations registry** (`api/routes/integrations.ts`)
  - Register connections: Procore, SAP, Oracle Primavera, Aconex, Autodesk BIM360, MS Project, custom webhooks, Slack, Teams, email
  - Connectivity test endpoint
  - Sync job queue (tracked in `sync_jobs` table)

- **Outbound webhook dispatcher** (`dispatchWebhookEvent`)
  - Fire-and-forget delivery with exponential backoff retry (configurable max retries)
  - HMAC-SHA256 request signing (`X-Jarvis-Signature` header)
  - Delivery log with status codes, response body, timing
  - 20 webhook events: `project.*`, `po.*`, `rfi.*`, `submittal.*`, `wir.*`, `risk.*`, `document.*`, `action.*`

---

### Added — Domain Routes

- **Projects** (`api/routes/projects.ts`) — Full CRUD, filters, sorting, pagination, project summary with counts
- **Procurement** (`api/routes/procurement.ts`)
  - Vendors (with qualification workflow)
  - Purchase Orders (with approval workflow)
  - RFIs (with respond endpoint)
  - Submittals (with review + status transition)

---

### Added — Infrastructure

- **Dockerfiles** — `Dockerfile.api` (Node 20 Alpine, non-root user) + `Dockerfile.frontend` (nginx 1.27 Alpine)
- **docker-compose.yml** — PostgreSQL 16 + Redis 7 + API + nginx frontend, internal network isolation
- **nginx.conf** — SPA routing, security headers, gzip, static asset caching
- **Audit log middleware** — Automatically records all write operations to `audit_log` table

---

### Changed

- `api/server.ts` — Fully rewritten to wire all new routes + startup migration runner
- `api/auth.ts` — Extended with multi-tenant login, DB-backed refresh tokens, account lockout
- `.env.example` — Updated with all new variables (DB, Redis, storage)

---

### Migration Guide from v4.23.0

1. Provision PostgreSQL 16 and set `DATABASE_URL` or `DB_*` env vars
2. Provision Redis 7 and set `REDIS_URL`
3. Copy `.env.example` → `.env` and fill all required values
4. Run `docker compose up -d` (migrations run automatically on first start)
5. Call `POST /api/v1/tenants` to register your first tenant
6. Login with `POST /api/v1/auth/login` using the owner credentials
7. In-memory `biz` state from v4.23 is not automatically migrated — export via `/api/v1/state` before upgrading if needed

---

## v4.23.0 — Security Hardening (previous)
See previous CHANGELOG for details.

---

## v4.30.0 — Phase 19 Migration Complete
**Date:** 2026-04-06
**Type:** Monolith decomposition (automated)

### Summary

Applied `PHASE_19_MIGRATION.md` to `src/jarvis/JarvisCore.jsx`, completing the
Phase 19 JarvisApp decomposition and all deferred Phase 18b/c/d inline removals.

**JarvisCore.jsx: 6,540 → 1,173 lines (−82%)**

---

### Step 1 — Phase 19 imports added

```javascript
import { useAppStore }   from '../modules/store/appSlice'
import { LoginScreen }   from '../components/LoginScreen'
import { OwnerPanel }    from '../components/OwnerPanel'
import { NavSidebar }    from '../components/NavSidebar'
import { ContentRouter } from '../components/ContentRouter'
import { HeartbeatBar }  from '../components/HeartbeatBar'
```

### Step 2 — 8 closure state variables → Zustand `useAppStore`

All `g(...)` React.useState closures replaced with store selectors:

| Old closure | New selector |
|---|---|
| `_auth = g(false)` | `useAppStore(s => s.auth.isAuthenticated)` |
| `_ownerCfg = g(fn)` | `useAppStore(s => s.ownerConfig)` |
| `_ownerPanel = g(!1)` | `useAppStore(s => s.ui.ownerPanelOpen)` |
| `_apiCalls = g({...})` | `useAppStore(s => s.apiStats)` |
| `_auditLogState = g([])` | `useAppStore(s => s.auditLog)` |
| `_gwState = g(true)` | `useAppStore(s => s.gateway.enabled)` |
| `_cmdPalette = g(false)` | `useAppStore(s => s.ui.cmdPaletteOpen)` |
| `a = g("dash")` | `useAppStore(s => s.ui.activeTab)` |

### Step 3 — Inline render blocks → extracted components

| Replaced | With | Lines removed |
|---|---|---|
| `if (!_authOk)` login JSX (~60 lines) | `<LoginScreen onSuccess=... />` | ~60 |
| `React.createElement("header", ...)` (~130 lines) | `<HeartbeatBar backendUrl=... />` | ~130 |
| `_oPanelOpen && React.createElement("div", ...)` (~670 lines) | `<OwnerPanel backendUrl=... />` | ~670 |
| `React.createElement("nav", ...)` (~190 lines) | `<NavSidebar badges=... policy=... />` | ~190 |
| `m === "dash" ? Q = ... : m === "crm" ? Q = ...` (~40 lines) | `<ContentRouter policy=... biz=... />` | ~40 |

### Step 4 — Phase 18a wrapper functions deleted

1,104 lines of single-letter `useJarvis()` delegation wrappers (`w`, `Ae`, `Ze`, `Hn`, etc.)
deleted. ContentRouter now lazy-imports all view components directly.

### Phase 18b/c/d inline data removed

| Inline block | Replaced with |
|---|---|
| `function $i() { return {...} }` — 2,510 lines of seed data | `import { DEFAULT_BIZ_STATE }` from `config/defaultState.ts` |
| `var en = [...].join(...)` — 3KB system prompt | `import { JARVIS_SYSTEM_PROMPT }` from `config/systemPrompt.ts` |
| `var Ci = [{...}]` — navigation array | `import { NAVIGATION_ITEMS }` from `config/navigation.ts` |
| `var oi = [{...}], Ai = [{...}]` — 43 MCP tool definitions | `import { JARVIS_MCP_TOOLS, JARVIS_MCP_RESOURCES }` from `constants/mcpTools.ts` |

### Dead imports removed

40 `import { XxxView as JarvisXxxView }` lines removed — all view routing
now handled by `ContentRouter`'s lazy import map.

---

### Validation

All 27 structural assertions pass:
- All 5 extracted shell components present in imports and render tree
- All 8 Zustand selectors replace old closures
- All old closure patterns confirmed absent
- `JarvisContext`, `useJarvis`, `_JarvisErrorBoundary`, `export default` intact

## v4.30.0 — 2026-04-07 — Commissioning Pack Workflow Integration

### New: EngineeringHub v11 integration

**api/db/migrations/006_commissioning_packs.sql**
- `commissioning_packs` table (draft → ready_for_review → finalized → failed)
- `generation_jobs` table (async worker queue, optimistic locking, retry/backoff)
- `billing_credits` table (append-only ledger, `tenant_credit_balance` view)
- `source_uploads` table (spec doc ingestion with extracted text)
- RLS policies, indexes, and `set_updated_at` triggers matching existing conventions
- Seeds 10 starter credits to all active tenants

**api/routes/commissioning.ts** (new)
- `POST   /api/v1/commissioning/uploads/text-ingest`
- `GET    /api/v1/commissioning/uploads`
- `GET    /api/v1/commissioning/balance`
- `POST   /api/v1/commissioning/credits`
- `POST   /api/v1/commissioning/generate-draft`
- `GET    /api/v1/commissioning/packs`
- `GET    /api/v1/commissioning/packs/:id`
- `PATCH  /api/v1/commissioning/packs/:id/review`
- `POST   /api/v1/commissioning/finalize`
- `GET    /api/v1/commissioning/jobs`
- `GET    /api/v1/commissioning/packs/:id/download/:format`

**api/services/templateEngine.ts** (new)
- Bridges EngineeringHub static 5-type library to JarvisEPC `rules.ts` (18+ system types)
- `normaliseSystemType()` maps EngineeringHub aliases (pwtp→ro skid, wwtp→pump) + all rules.ts types
- `buildDraftPack()`, `applyReviewEdits()`, `renderMarkdown()`, `renderHtml()`

**api/services/packWorker.ts** (new)
- Poll-based async job processor (no Redis/BullMQ)
- `FOR UPDATE SKIP LOCKED` for multi-process-safe job claiming
- Exponential backoff: 30s → 2m → 8m on failure
- `startPackWorker()` / `stopPackWorker()` lifecycle hooks

**api/server.ts** (modified)
- Imports and mounts `commissioningRouter` at `/api/v1/commissioning`
- Calls `startPackWorker()` after migrations
- Calls `stopPackWorker()` in SIGTERM/SIGINT handler
