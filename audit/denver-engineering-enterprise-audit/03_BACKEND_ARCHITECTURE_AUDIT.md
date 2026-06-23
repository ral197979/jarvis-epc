# 03 — BACKEND ARCHITECTURE AUDIT

---

## Architecture Overview

**Runtime:** Node.js 20, TypeScript (ESM)  
**Framework:** Express.js  
**Database:** PostgreSQL 16 via `pg` driver (no ORM)  
**Cache/Token Store:** Redis (ioredis)  
**Background Jobs:** Custom scheduler (`api/services/scheduler.ts`)  
**Logging:** Pino (structured JSON)  
**Process Model:** Single process, multi-worker via setInterval pollers  

---

## Route Count Verification

**Claimed:** 70+ routes  
**Verified:** 74 route files in `api/routes/`  
**Actual endpoint count:** ~340+ individual REST endpoints across all routers  

**Largest route files by line count:**
```
702  routes/actions.ts
534  routes/mcp.ts
524  routes/enterprise.ts
518  routes/ecosystem.ts
468  routes/knowledge.ts
463  routes/procurement.ts
454  routes/files.ts
450  routes/commissioning.ts
395  routes/integrations.ts
352  routes/automation.ts
```

---

## Service Count Verification

**Claimed:** 67 services  
**Verified:** 238 `.ts` files in `api/services/` (counting subdirectories)

The "67 services" refers to 67 named background service workers/handlers, not total service files. The actual service layer is larger.

---

## Architecture Patterns

### Good Patterns Found:
1. **No ORM** — raw SQL via `pg` pool. Complete control over queries. No N+1 from ORM magic.
2. **Tenant isolation via `tenantQuery()`** — wraps every query with `SET app.current_tenant_id` before execution, enabling PostgreSQL RLS
3. **Correlation ID middleware** — every request gets `X-Correlation-ID` for tracing
4. **Graceful shutdown** — SIGTERM/SIGINT handlers drain connections before exit
5. **Rate limiting** — global (600/min), auth (200/15min), AI (30/min), agent (20/min)
6. **Auth via JWT + httpOnly cookies** — dual transport (Bearer header OR cookie)

### Architecture Concerns:

#### 1. God File: `api/server.ts` (572 lines)
The server file imports 100+ modules and registers 70+ routers inline. At this size it's a maintenance burden and makes testing difficult.

```typescript
// server.ts lines 57-152: 96 import statements
import twinRouter from './routes/twin'
import portfolioRouter from './routes/portfolio'
// ... 94 more
```

**Remediation:** Split into router groups (`coreRoutes.ts`, `constructionRoutes.ts`, `financeRoutes.ts`).

#### 2. Error Handling Inconsistency
Routes use three different error patterns:
```typescript
// Pattern A (most routes): generic 500
} catch (e) { res.status(500).json({ error: 'Failed to list sensors' }) }

// Pattern B (auth routes): detailed error  
res.status(422).json({ error: 'validation', message: 'question required' })

// Pattern C (some routes): exposes internal error
res.status(500).json({ error: 'ask_failed', message: msg })
```
Pattern C can expose stack traces or internal state to clients.

#### 3. No Request Validation Middleware
No schema validation library (Joi, Zod, class-validator). Input validation is done inline:
```typescript
const b = req.body as Record<string, unknown>
if (!b['name'] || !b['type']) { ... }
```
This creates inconsistent validation depth across routes. Some fields are not validated at all.

#### 4. Unbounded `SELECT *` in 20 Routes
```
api/routes/dailyLogs.ts:104     SELECT * FROM daily_logs WHERE id=$1 AND tenant_id=$2
api/routes/budgets.ts:35        SELECT * FROM budgets WHERE tenant_id=$1 AND project_id=$2
api/routes/bim.ts:35            SELECT * FROM bim_models WHERE tenant_id=$1 AND project_id=$2
api/routes/compliance.ts:93     SELECT * FROM compliance_tasks
api/routes/punchLists.ts:171    SELECT * FROM punch_items
```
These are ID-scoped single-row lookups (mostly safe) or list queries without LIMIT on `compliance_tasks` (risky).

#### 5. Missing Database Transactions
Complex multi-step operations (create project + budget + RFI) are not wrapped in transactions:
```typescript
// No BEGIN/COMMIT around multi-step operations
await tenantQuery(tenantId, 'INSERT INTO projects ...')
await tenantQuery(tenantId, 'INSERT INTO budgets ...')  // orphan if this fails
```

#### 6. Synchronous File I/O in IFC Worker
```typescript
// api/services/bim/ifcParseWorker.ts
const buffer = readFileSync(localPath)  // BLOCKS EVENT LOOP
```
Using `readFileSync` in a worker polled by the scheduler will block the Node.js event loop during large IFC file reads.

---

## Worker Architecture

**Scheduler approach:** `api/services/scheduler.ts` uses `setInterval` pollers, not a proper job queue.

**Workers registered at startup:**
```
startScheduler()
registerWebhookDispatchHandler()
registerIntegrationSync()
registerKpiSnapshotHandler()
registerComplianceWatcher()
registerSlaEngine()
registerNotificationWorker()
registerAnalyticsSnapshotHandler()
registerReadinessSnapshotHandler()
registerAuditRetentionHandler()
registerKnowledgeIngestHandler()
registerFixExtractorHandler()
registerKnowledgeEmbedHandler()
startIfcParseWorker()
startFederatedAggregationWorker()
```

**Concern:** All workers run in the same Node.js process as the HTTP server. A misbehaving worker (e.g., IFC parse of a 100MB file) can starve HTTP request handling.

**Remediation:** Move IFC parse and knowledge embedding to separate worker processes or use BullMQ with a separate Redis queue.

---

## Business Logic Separation

**Good:** Most business logic lives in `api/services/` not in route handlers.  
**Gap:** Some routes contain direct SQL (no service layer abstraction):
```typescript
// api/routes/bim.ts:35 — SQL directly in route handler
const models = await tenantQuery(tenantId, 
  `SELECT * FROM bim_models WHERE tenant_id=$1 AND project_id=$2`, ...)
```

---

## WebSocket Gateway

**Implementation:** `api/realtime/wsGateway.ts`  
**Auth:** JWT verified on upgrade (P1-8 fix applied)  
**Subscription model:** Redis pub/sub via `api/realtime/subscriptionManager.ts`

**Concern:** No reconnection backoff in frontend WebSocket client (not verified — no WS client code found in `src/`). If WebSocket drops, clients may not reconnect.

---

## API Versioning

**Current:** All routes under `/api/v1/`  
**Issue:** No API versioning strategy for breaking changes. A change to a `v1` response shape will break all clients.  
**Recommendation:** Document breaking change policy; plan `v2` namespace before enterprise launch.

---

## Summary

| Area | Grade | Key Finding |
|------|-------|-------------|
| Route structure | B+ | 74 files, organized but large |
| Service separation | B | Good for 80% of routes |
| Error handling | C+ | Inconsistent; some leak internals |
| Input validation | C | No schema library; ad-hoc checks |
| Transactions | C | Missing on multi-step operations |
| Worker architecture | C+ | All in-process; IFC blocks event loop |
| Database access | A- | Raw SQL, tenant-scoped, no ORM magic |
| Authentication | A | JWT + bcrypt + Redis revocation |
| Logging | B+ | Pino structured; request IDs |
| Graceful shutdown | A | SIGTERM/SIGINT handled |
