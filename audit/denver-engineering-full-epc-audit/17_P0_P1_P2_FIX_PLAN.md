# 17 — P0 / P1 / P2 Fix Plan

## P0 Fixes (Block Production Launch)

---

### P0-1: Fix Federated Data Anonymization (SECURITY)
**File:** `api/services/ecosystem/federatedIntelligenceEngine.ts`  
**Tests:** `src/__tests__/modules/actions-phase9b.test.ts`, `actions-phase9c.test.ts`

**Current behavior:** `_anonymize()` adds random Laplacian noise to numeric values AND fails to strip `tenant_id`.

**Fix:**
```typescript
function _anonymize(data: Record<string, unknown>): Record<string, unknown> {
  const STRIP_KEYS = ['tenant_id', 'userId', 'user_id', 'tenantId', 'email', 'name']
  const result: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(data)) {
    if (STRIP_KEYS.includes(k)) continue  // strip identifying fields
    result[k] = v                          // preserve values intact
  }
  return result
}
```

**Verification:** Both anonymization tests should pass after fix.

---

### P0-2: Upgrade Render Plan
**File:** `render.yaml`

**Fix:**
```yaml
services:
  - type: web
    name: jarvis-epc
    plan: standard         # was: free — standard = $25/mo, no sleep, 512MB→2GB RAM
    
databases:
  - name: jarvis-epc-db
    plan: standard-4gb     # was: basic-256mb — standard-4gb = $97/mo, proper for EPC
```

**Add Redis:**
```yaml
  - type: redis
    name: jarvis-epc-redis
    plan: free             # 25MB — sufficient for token revocation
    envVars:
      - key: REDIS_URL
        fromService:
          name: jarvis-epc-redis
          property: connectionString
```

---

### P0-3: Fix Failing Tests
**Priority order:**

1. **Fix anonymization tests** (P0-1 above)
2. **Fix navigation test** — update `src/config/navigation.ts` to match test expectation, or update test
3. **Fix telemetry engine mocks** — update `actions-phase11.test.ts` mocks to match new `tenantQuery` signature
4. **Fix Phase 9 ON CONFLICT test** — update mock to expect correct number of DB calls
5. **Mark ecosystem tests as known failures** or fix implementation

---

### P0-4: Add Missing Env Vars to render.yaml
**File:** `render.yaml`

```yaml
envVars:
  - key: ANTHROPIC_API_KEY
    sync: false            # set in Render dashboard
  - key: OPENAI_API_KEY
    sync: false
  - key: ALLOWED_ORIGINS
    value: 'https://your-domain.com'
  - key: STORAGE_BACKEND
    value: 's3'
  - key: EMBED_PROVIDER
    value: 'openai'
  - key: EMBED_DIMENSIONS
    value: '1536'
  - key: KNOWLEDGE_INGEST_ROOTS
    value: ''
```

---

## P1 Fixes (Required Before Scaling)

---

### P1-1: Add Redis Token Store to Production
**Files:** `api/tokenStore.ts` (or wherever `getTokenStore` is implemented)

Ensure `REDIS_URL` env var connects Redis token store. On Render, use the Redis service added in P0-2.

---

### P1-2: Add Test Gate to CI/CD
**File:** `render.yaml`

```yaml
buildCommand: npm install --include=dev && npm run typecheck:all && npm test -- --run && npm run build
```

This ensures deploy fails if tests fail.

---

### P1-3: Verify RLS on Missing Tables
**Files:** Check migrations 058, 059, 060, 061, 062, 063, 064, 065

For each table missing confirmed RLS, add:
```sql
ALTER TABLE <table_name> ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS <table>_tenant ON <table_name>;
CREATE POLICY <table>_tenant ON <table_name>
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
```

Create migration `070_rls_missing_tables.sql` with:
- `change_orders` (from 058)
- `subcontracts`, `bid_packages` (from 059)
- `meeting_minutes`, `meeting_agenda_items` (from 060)
- `cost_entries` (from 061)
- `proposals`, `proposal_line_items` (from 062)
- `team_members` (from 063)
- `notifications`, `notification_preferences` (from 064)
- `timesheets`, `timesheet_entries` (from 065)

---

### P1-4: Verify Digital Twin Migration
**Issue:** `046_digital_twin.sql` missing from `api/db/migrations/`

```bash
ls api/db/migrations/ | grep 046
# If missing, create the migration from twin route DDL
```

---

### P1-5: File Upload MIME Validation
**File:** `api/routes/files.ts` or `api/files/storage.ts`

```typescript
import { fileTypeFromBuffer } from 'file-type'

const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 
                       'application/octet-stream']

// In multer handler:
const detected = await fileTypeFromBuffer(file.buffer)
if (detected && !ALLOWED_TYPES.includes(detected.mime)) {
  throw new Error(`File type ${detected.mime} not allowed`)
}
```

Install: `npm install file-type`

---

### P1-6: Add IFC Upload Size Limit
**File:** `api/routes/bim.ts` or multer config

```typescript
const bimUpload = multer({
  limits: { fileSize: 100 * 1024 * 1024 }  // 100MB max for IFC files
})
```

---

### P1-7: Implement Transmittals Frontend View
**Issue:** Transmittals backend exists but no frontend view.

Create `src/components/transmittals/TransmittalsView.tsx` or wire existing component.  
Add `transmittals` to `NAVIGATION_ITEMS` and `TAB_MAP`.

---

### P1-8: Fix WebSocket Auth
**File:** `api/realtime/wsGateway.ts`

Verify JWT validation on WebSocket upgrade:
```typescript
server.on('upgrade', (req, socket, head) => {
  const token = parseTokenFromUpgradeRequest(req)
  if (!verifyToken(token)) {
    socket.destroy()
    return
  }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req))
})
```

---

### P1-9: Add Backend Prompt Injection Sanitization
**File:** `api/routes/ask.ts` or `api/services/askBuilder.ts`

```typescript
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions?/i,
  /you\s+are\s+now\s+a/i,
  /disregard\s+(your\s+)?system\s+prompt/i,
]

function sanitizeQuestion(question: string): string {
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(question)) {
      throw new Error('Question contains disallowed content')
    }
  }
  return question.trim()
}
```

---

## P2 Fixes (Quality & Polish)

### P2-1: Enable CSP in Helmet
```typescript
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'", "wss:", "https:"],
    }
  }
}))
```

### P2-2: Add ErrorBoundary to ContentRouter Views
```typescript
// Wrap each Suspense fallback with ErrorBoundary
<ErrorBoundary fallback={<ViewError />}>
  <Suspense fallback={<ViewLoader />}>
    <Component {...props} />
  </Suspense>
</ErrorBoundary>
```

### P2-3: Fix 596 ESLint Warnings
Work through warnings by category:
1. Remove unused imports/variables
2. Fix `useEffect` dependency arrays
3. Replace `any` with proper types

### P2-4: Add lint to CI script
```json
"ci": "npm audit --audit-level=high && npm run lint && npm run typecheck:all && npm run check:monolith && npm test -- --run"
```

### P2-5: Confirm pgvector Extension
Add to migration or startup check:
```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

### P2-6: Real Integrations View
Replace `ComingSoonView` stub with actual integrations management interface connected to `integrationHubRouter`.

### P2-7: Loading Skeleton
Replace plain "Loading…" text in `ViewLoader` with a skeleton component matching the view structure.

### P2-8: Add CSRF Token for Non-Cookie API Clients
For API clients using Bearer tokens (not cookies), ensure they're properly handled. Cookie-based auth is CSRF-protected via SameSite=strict.

---

## Fix Priority Order

```
Week 1 (P0):
  Day 1: Fix anonymization bug (P0-1)
  Day 1: Fix failing tests (P0-3)
  Day 2: Upgrade Render plan (P0-2)
  Day 2: Add missing env vars to render.yaml (P0-4)

Week 2 (P1):
  Day 1: Add Redis, verify token store (P1-1)
  Day 1: Add test gate to CI/CD (P1-2)
  Day 2-3: Add RLS to missing tables (P1-3)
  Day 4: Verify digital twin migration (P1-4)
  Day 5: File upload MIME validation (P1-5)

Week 3 (P1 continued):
  Day 1-2: IFC size limit (P1-6)
  Day 3: Transmittals frontend (P1-7)
  Day 4: WebSocket auth (P1-8)
  Day 5: Prompt injection guard (P1-9)

Week 4 (P2):
  Enable CSP, ErrorBoundary, fix ESLint, pgvector, integrations view
```
