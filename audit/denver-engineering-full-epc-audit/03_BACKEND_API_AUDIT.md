# 03 — Backend API Audit

## Architecture
- Express v5 + TypeScript (tsx runtime, no transpile step in prod)
- Single `api/server.ts` entry point mounting ~75 routers
- PostgreSQL via `pg` pool (`api/db/pool.ts`)
- JWT auth via `jsonwebtoken` + bcrypt
- Pino structured logging
- WebSocket gateway (`api/realtime/wsGateway.ts`)

---

## Security Middleware Stack

```
globalLimiter        → all /api/ routes
authLimiter          → /api/v1/auth/ routes
helmet               → security headers
cors                 → allowedOrigins from env
express.json 2mb     → request body limit
cookieParser         → httpOnly cookie parsing
audit logger         → all requests logged
requireAuth          → per-router or per-mount
requireTenant        → per-router or per-mount
```

**helmet configuration:**
- `contentSecurityPolicy: false` in server.ts — CSP disabled. **Risk P2**: enables XSS via inline scripts if any untrusted content is rendered.

---

## Route Mount Analysis

### Routes Without Explicit Global requireAuth (Server-Level)
These routes apply `requireAuth` internally at the router level — equivalent protection:

| Route | Auth Applied | Where |
|---|---|---|
| `/api/v1/runbooks` | ✅ `runbooksRouter.use(auth)` | inside router |
| `/api/v1/ai` (governance) | ✅ `aiGovernanceRouter.use(auth)` | inside router |
| `/api/v1/simulation` | ✅ `simulationRouter.use(auth)` | inside router |
| `/api/v1/policies` | ✅ `policiesRouter.use(auth)` | inside router |
| `/api/v1/executive` | ✅ inside router | inside router |
| `/api/v1/agents` | ✅ `agentsRouter.use(requireAuth, requireTenant)` | inside router |
| `/api/v1/knowledge` | ✅ `router.use(requireAuth, requireTenant)` | inside router |
| `/api/v1/ask` | ✅ `router.use(requireAuth, requireTenant)` | inside router |
| `/api/v1/admin/automation` | ✅ + requireAdmin role check | inside router |

### Routes Confirmed Auth at Server Mount Level
```
/api/v1/ops           → requireAuth + requireTenant ✅
/api/v1/readiness     → requireAuth + requireTenant ✅
/api/v1/sync          → requireAuth + requireTenant ✅
/api/v1/evidence      → requireAuth + requireTenant ✅
/api/v1/twins         → requireAuth + requireTenant ✅
/api/v1/portfolio     → requireAuth + requireTenant ✅
/api/v1/scenarios     → requireAuth + requireTenant ✅
/api/v1/adaptive      → requireAuth + requireTenant ✅
/api/v1/optimization  → requireAuth + requireTenant ✅
/api/v1/enterprise    → requireAuth + requireTenant ✅
/api/v1/ecosystem     → requireAuth + requireTenant ✅
```

### Public Routes (By Design)
```
GET  /api/v1/health          → no auth (health probe)
POST /api/v1/auth/login      → no auth (login endpoint)
POST /api/v1/auth/refresh    → no auth (token refresh)
POST /api/v1/tenants         → no auth (tenant registration)
```

### Unverified Auth Status
The following routers need per-file verification:
- `/api/v1/projects`, `/api/v1/vendors`, `/api/v1/rfis`, `/api/v1/submittals` — mounted without explicit requireAuth at server level; must apply auth internally
- `/api/v1/calculations` — mounted with `app.use('/api/v1', calculationsRouter)` — no explicit auth at mount

**Risk P1:** If any of the above routers don't apply `requireAuth` internally, unauthenticated access to project data is possible.

---

## RBAC Analysis

### Role Hierarchy
Defined in `auth.ts`:
- `owner` — tenant owner
- `admin` — tenant admin
- `project_manager` — PM role
- `engineer` — engineering role
- `viewer` — read-only

### Role Enforcement Found
- `/api/v1/admin/sessions` — checks `['owner','admin'].includes(role)` ✅
- `/api/v1/admin/automation` — `_requireAdmin` checks `['owner','admin'].includes(role)` ✅
- `/api/v1/tenants` (user management) — role checks present ✅

### Missing Role Enforcement
- Most GET endpoints allow any authenticated tenant user to read all project data — no `project_manager` or `engineer` scope filtering.
- Risk Register, Change Orders, EVM — sensitive financial data readable by `viewer` role (P2).

---

## Rate Limiting

```javascript
globalLimiter: 200 req/min per IP      // all /api/
authLimiter:   20 req/min per IP       // /api/v1/auth/
aiLimiter:     30 req/min per IP       // /api/v1/gateway + AI endpoints
agentLimiter:  configured on agents    // /api/v1/agents
```

**Assessment:** Rate limiting is present and layered. Values are reasonable for enterprise use.

---

## Input Validation

- `validateUuidParams` middleware (`api/middleware/validateUuidParams.ts`) applied at `app.use('/api/v1', validateUuidQueryParams)` ✅
- `registerUuidParamGuards` applied for path params ✅
- Request body limit: 2MB (`express.json({ limit: '2mb' })`)
- Ask Jarvis: 4000 char question limit ✅
- **Missing:** No schema validation library (Zod/Joi) for request bodies — each route validates manually or not at all (P2)

---

## Error Handling

- Global error handler present in `api/server.ts`
- Pino structured logging on all requests
- `slog` utility used throughout services
- Previous audit fixed "error detail leak" (v10.6.0) — error messages no longer returned raw
- **Risk:** `simulationRouter` returns raw `err.message` in some catch blocks (not fully verified)

---

## WebSocket Gateway

- `api/realtime/wsGateway.ts` — WebSocket upgrade handler
- `api/realtime/subscriptionManager.ts` — pub/sub management
- `api/realtime/eventBroadcaster.ts` — event fanout
- **Finding:** WebSocket auth not independently verified — if WS connections don't validate JWT on upgrade, tenants could cross-subscribe (P1)

---

## Background Workers

| Worker | File | Status |
|---|---|---|
| Pack Worker | `api/services/packWorker.ts` | ✅ started on boot |
| Scheduler | `api/services/scheduler.ts` | ✅ started on boot |
| SLA Engine | `api/services/slaEngine.ts` | ✅ registered |
| Notification Worker | `api/services/notifications/notificationWorker.ts` | ✅ registered |
| KPI Snapshot | `api/services/kpiSnapshot.ts` | ✅ registered |
| Knowledge Ingest | `api/services/knowledgeIngest.ts` | ✅ registered |
| Fix Extractor | `api/services/fixExtractor.ts` | ✅ registered |
| Knowledge Embed | `api/services/knowledgeEmbed.ts` | ✅ registered |
| IFC Parse Worker | `api/services/bim/ifcParseWorker.ts` | ✅ started on boot |
| Compliance Watcher | `api/services/complianceWatcher.ts` | ✅ registered |
| Audit Retention | `api/services/auditRetention.ts` | ✅ registered |
| Readiness Snapshots | `api/services/readiness/readinessSnapshots.ts` | ✅ registered |
| Analytics Snapshot | `api/services/actions/actionAnalyticsService.ts` | ✅ registered |

**Finding:** 13 background workers start on boot. On Render free tier (single dyno, sleeps), these workers are killed on sleep and restart from scratch. No persistent queue (Redis/BullMQ) for durability — jobs lost on crash/restart.

---

## Graceful Shutdown

- `SIGTERM` / `SIGINT` handlers in `server.ts`
- Calls `stopScheduler()`, `stopPackWorker()`, `stopIfcParseWorker()` ✅
- Pool `end()` called on shutdown ✅

---

## Risk Summary

| Finding | Severity |
|---|---|
| WebSocket auth not independently verified | P1 |
| Unverified auth on projects/rfis/submittals/calculations routers | P1 |
| No persistent job queue — workers lose state on restart | P1 |
| CSP disabled in Helmet | P2 |
| No request body schema validation (no Zod/Joi) | P2 |
| Viewer role can read financial data | P2 |
| 13 workers start on same dyno as HTTP server | P2 |
| No OpenAPI spec | P2 |
