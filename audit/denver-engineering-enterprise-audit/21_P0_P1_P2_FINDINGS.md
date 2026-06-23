# 21 — CONSOLIDATED SECURITY & QUALITY FINDINGS

---

## P0 — Critical (Deploy-Blocking)

**None found.** No P0 security vulnerabilities identified in this audit.

The platform has no:
- SQL injection vulnerabilities (parameterized queries throughout)
- Hardcoded secrets
- Authentication bypass
- Unauthenticated access to tenant data

---

## P1 — High Severity (Fix Before Production)

### P1-A: ~11 Tables Missing Row-Level Security
**Files:** Multiple migration files (030–057 range)  
**Category:** Security — Data Isolation  
**Risk:** Without RLS, a query that omits a WHERE tenant_id clause leaks data across tenants.

**Verification query:**
```sql
SELECT tablename FROM pg_tables 
WHERE schemaname = 'public' 
  AND tablename NOT IN (
    SELECT relname FROM pg_class 
    JOIN pg_policies ON pg_class.oid = pg_policies.polrelid
  )
  AND tablename NOT IN ('tenants', 'schema_migrations');
```

**Suspects:** `sensor_readings`, `sensor_alerts`, `evm_actuals`, `evm_progress`, `agent_memory_entries`, and tables from migrations 030–057.

**Fix:** Add `ENABLE ROW LEVEL SECURITY` and policy to each identified table. Use migration 072 pattern.

---

### P1-B: X-Tenant-ID Header Fallback in requireTenant()
**File:** `api/middleware/tenant.ts`  
**Category:** Security — Tenant Isolation

```typescript
// Current (vulnerable to footgun):
const tenantId = req.auth?.tid ?? req.headers['x-tenant-id'] as string

// Required fix:
const tenantId = req.auth?.tid
if (!tenantId) { res.status(401).json({ error: 'unauthorized' }); return }
```

**Risk:** If any route applies `requireTenant()` without `requireAuth()`, an unauthenticated caller can supply any tenant ID. No such route found currently, but the footgun remains.

---

### P1-C: Open Tenant Registration (No Rate Limiting)
**File:** `api/routes/tenants.ts`  
**Category:** Security — Resource Abuse

```typescript
// POST / has only global rate limiter (600/min)
// An attacker can create ~600 tenants per minute
tenantsRouter.post('/', async (req, res) => {
```

**Fix:**
```typescript
import rateLimit from 'express-rate-limit'
const tenantCreateLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 5 })
tenantsRouter.post('/', tenantCreateLimiter, async (req, res) => {
```

---

### P1-D: Missing Database Transactions on Multi-Step Operations
**Files:** Multiple route files  
**Category:** Data Integrity

```typescript
// Current pattern (orphan risk):
await tenantQuery(tenantId, 'INSERT INTO projects ...')
await tenantQuery(tenantId, 'INSERT INTO budgets ...')  // if this fails, project exists without budget

// Required pattern:
await tenantTransaction(tenantId, async (client) => {
  await client.query('INSERT INTO projects ...')
  await client.query('INSERT INTO budgets ...')
})
```

**High-risk locations:**
- Project creation (projects + initial budget)
- Transmittal creation (transmittal + items)
- Commissioning pack finalization

---

### P1-E: IFC Parse Worker Blocks HTTP Event Loop
**File:** `api/services/bim/ifcParseWorker.ts`  
**Category:** Availability

```typescript
const buffer = readFileSync(localPath)  // BLOCKS EVENT LOOP
```

**Risk:** A 50MB IFC file takes 1–5 seconds to read synchronously. During this read, all HTTP requests queue behind it.

**Fix:** Use `readFile` (async) or move to `worker_threads`.

---

## P2 — Medium Severity (Fix Within 30 Days)

### P2-A: Login Brute Force — No IP-Level Block
**File:** `api/auth.ts`  
Per-user lockout after 5 attempts exists. Per-IP lockout does not.

**Fix:**
```typescript
// Redis counter: `login_attempts:${ip}`
// Block IP for 15 minutes after 20 attempts across any usernames
```

---

### P2-B: AI Gateway Error Response Leaks Internal State
**File:** `api/server.ts`

```typescript
// Current:
res.status(500).json({ error: 'gateway_unreachable', message: msg })
// msg = err.message (may include hostnames, partial API responses)

// Fix:
const safeMsg = process.env['NODE_ENV'] === 'production' 
  ? 'AI service unavailable' 
  : msg
res.status(500).json({ error: 'gateway_unreachable', message: safeMsg })
```

---

### P2-C: APS Error Body Could Log Client Secret
**File:** `api/services/bim/apsViewerService.ts`

```typescript
// Current:
throw new Error(`APS token request failed: ${resp.status} ${await resp.text()}`)

// Fix:
const body = (await resp.text()).slice(0, 200).replace(clientSecret, '[REDACTED]')
throw new Error(`APS token request failed: ${resp.status} ${body}`)
```

---

### P2-D: WebSocket Missing Origin Check
**File:** `api/realtime/wsGateway.ts`

The WebSocket upgrade validates JWT but does not verify the request Origin header.

**Fix:**
```typescript
wss.on('headers', (headers, req) => {
  const origin = req.headers['origin']
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    throw new Error('Origin not allowed')
  }
})
```

---

### P2-E: WebSocket Token in Query String
**File:** Frontend WS client  
`ws://host/ws?token=<jwt>` — token appears in access logs and browser history.

**Fix:** Exchange for a short-lived one-time token via REST before connecting.

---

### P2-F: No Redis Budget / Upgrade Plan
**Infrastructure:** `render.yaml`

Redis on free plan = 25MB. With JWT revocation, rate limiting, and WebSocket pub/sub, this limit will be hit under moderate load.

**Fix:** Upgrade to Render Redis `starter` ($10/month, 500MB) before any production launch.

---

### P2-G: No AI Cost Control
**Category:** Operational  
No monthly cap or alerting on Anthropic/OpenAI API spend.

**Fix:** Set `ANTHROPIC_MAX_MONTHLY_SPEND` env var; add webhook alert when 80% of budget consumed. Anthropic dashboard supports spend alerts.

---

### P2-H: No Query Result Caching for Expensive Endpoints
**Category:** Performance  
EVM metrics and cost control snapshots are recomputed on every request.

**Fix:** Cache with 5-minute TTL in Redis:
```typescript
const cacheKey = `evm:${tenantId}:${projectId}`
const cached = await redis.get(cacheKey)
if (cached) return JSON.parse(cached)
// ... compute ...
await redis.setex(cacheKey, 300, JSON.stringify(metrics))
```

---

## P3 — Low Severity (Fix in Next Sprint)

### P3-A: Missing Indexes on High-Traffic Queries
**Tables:** `sensor_readings`, `chat_messages`, `audit_log`, `actions`, `evm_actuals`  
See `04_DATABASE_AUDIT.md` for specific index SQL.

### P3-B: Stale TODO Comments in Production Code
**File:** `api/services/notifications/notificationWorker.ts`  
Email delivery TODOs suggest the notification email path is not implemented.  
**Action:** Either implement or remove the TODO comments to avoid false confidence.

### P3-C: No API Versioning Strategy
All routes under `/api/v1/`. No plan for breaking changes.  
**Action:** Document breaking change policy; plan v2 namespace.

### P3-D: Pagination Not Enforced on All List Endpoints
`SELECT * FROM compliance_tasks` with no LIMIT on some paths.  
**Fix:** Audit all list endpoints for LIMIT enforcement.

### P3-E: Notification Email Not Verified
TODO comments suggest email delivery via SendGrid/SES is not implemented.  
**Impact:** Users configured to receive email notifications will not receive them.

### P3-F: Mobile Frontend Not Verified
`api/services/mobile/` exists. No mobile-specific frontend views found in `src/components/`.

---

## Finding Count Summary

| Priority | Count | Status |
|----------|-------|--------|
| P0 | 0 | ✅ None |
| P1 | 5 | ❌ Fix before production |
| P2 | 8 | ⚠️ Fix within 30 days |
| P3 | 6 | 🔵 Next sprint |
| **Total** | **19** | |

---

## Previously Remediated (This Session)

The following P2 items were remediated before this audit was written:

| Item | Fix Applied |
|------|-------------|
| CSP headers (P2-1) | Helmet CSP configured in `api/server.ts` |
| ErrorBoundary (P2-2) | `src/components/ErrorBoundary.tsx` created |
| ESLint warnings (P2-3) | Already at 0 warnings |
| CI lint gate (P2-4) | Added to `render.yaml` buildCommand |
| pgvector migration (P2-5) | `071_pgvector.sql` created |
| Real Integrations view (P2-6) | `IntegrationsView.tsx` created |
| Loading skeletons (P2-7) | Shimmer skeleton in `ContentRouter.tsx` |
| CSRF tokens (P2-8) | `api/middleware/csrf.ts` created |
