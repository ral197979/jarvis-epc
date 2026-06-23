# 19 — Implementation Plan for Claude

This document provides concrete, executable instructions for Claude to implement all P0 and P1 fixes identified in this audit.

---

## Task 1: Fix Federated Anonymization Bug (P0 SECURITY)

**Context:** `_anonymize()` in `federatedIntelligenceEngine.ts` adds random noise to values instead of stripping identifying fields. Tests fail with wrong numeric values.

**Steps:**
1. Read `api/services/ecosystem/federatedIntelligenceEngine.ts`
2. Find the `_anonymize` function (internal/exported)
3. Replace the noise-addition logic with field-stripping logic:
   - Strip all keys matching: `tenant_id`, `tenantId`, `user_id`, `userId`, `email`, `name`, `project_id`, `projectId`
   - Preserve all other key-value pairs unchanged
4. Run `npm test -- --reporter=verbose src/__tests__/modules/actions-phase9b.test.ts`
5. Run `npm test -- --reporter=verbose src/__tests__/modules/actions-phase9c.test.ts`
6. Both should pass

---

## Task 2: Add RLS to Missing Tables (P1 SECURITY)

**Context:** 8 table groups from migrations 058–065 likely lack RLS policies.

**Steps:**
1. Create `api/db/migrations/070_rls_missing_tables.sql`
2. For each table: check if `tenant_id` column exists, then add:
```sql
ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS <table>_tenant ON <table>;
CREATE POLICY <table>_tenant ON <table>
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
```
3. Tables to cover: change_orders, subcontracts, bid_packages, meeting_minutes, meeting_agenda_items, cost_entries, proposals, proposal_line_items, team_members, notifications, notification_preferences, timesheets, timesheet_entries
4. Run `npx tsx api/db/migrate.ts` locally with test DB
5. Verify each table has RLS: `SELECT * FROM pg_policies WHERE tablename = '<table>';`

---

## Task 3: Fix render.yaml for Production (P0 INFRA)

**Context:** Render free plan sleeps. Database too small. Redis missing. API keys missing.

**Steps:**
1. Read `render.yaml`
2. Change `plan: free` → `plan: standard` on web service
3. Change `plan: basic-256mb` → `plan: standard-4gb` on database  
   *(or use Neon/Supabase external DB for better value)*
4. Add Redis service block (see P0-2 in fix plan)
5. Add missing env vars: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `ALLOWED_ORIGINS`, `STORAGE_BACKEND`, `EMBED_PROVIDER`, `EMBED_DIMENSIONS`, `REDIS_URL`
6. Mark sensitive keys as `sync: false` (set in Render dashboard)
7. Validate YAML structure

---

## Task 4: Add Test Gate to CI/CD (P1)

**Context:** `buildCommand` in render.yaml doesn't run tests. Broken code auto-deploys.

**Steps:**
1. Update `render.yaml` buildCommand:
```yaml
buildCommand: npm install --include=dev && npm run typecheck && npm test -- --run && npm run build
```
2. Alternative: Add GitHub Actions workflow at `.github/workflows/ci.yml`:
```yaml
name: CI
on: [push, pull_request]
jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npm run typecheck
      - run: npm test -- --run
      - run: npm run build
```

---

## Task 5: Fix Navigation Test (P1)

**Context:** `src/__tests__/config/config.test.ts` fails on `NAVIGATION_ITEMS has a stable non-empty list`. File `navigation.ts` was recently modified.

**Steps:**
1. Read `src/__tests__/config/config.test.ts`
2. Read `src/config/navigation.ts`
3. Identify what the test expects vs. what navigation.ts now exports
4. Update either the test (if the change is intentional) or navigation.ts (if it broke something)
5. Run `npm test -- src/__tests__/config/config.test.ts`

---

## Task 6: File Upload MIME Validation (P1)

**Steps:**
1. `npm install file-type`
2. Read `api/routes/files.ts` to find the upload handler
3. Add MIME type detection after multer processes the file
4. Reject files whose magic bytes don't match declared type
5. Add allowed MIME types constant: `['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'text/plain']`
6. Return 422 with `{ error: 'invalid_file_type' }` for disallowed types
7. Write a test for the validation

---

## Task 7: IFC File Size Limit (P1)

**Steps:**
1. Read `api/routes/bim.ts` to find IFC upload handler
2. Find the multer configuration for BIM uploads
3. Add `limits: { fileSize: 100 * 1024 * 1024 }` (100MB)
4. Return 413 with helpful error message if exceeded
5. Also add in `api/services/bim/ifcParseWorker.ts` a file size check before parsing

---

## Task 8: Add ErrorBoundary to ContentRouter (P1)

**Steps:**
1. Create `src/components/ViewErrorBoundary.tsx`:
```typescript
import React from 'react'
class ViewErrorBoundary extends React.Component<{children: React.ReactNode}, {hasError: boolean}> {
  state = { hasError: false }
  static getDerivedStateFromError() { return { hasError: true } }
  render() {
    if (this.state.hasError) return <div>Something went wrong loading this view.</div>
    return this.props.children
  }
}
export default ViewErrorBoundary
```
2. Read `src/components/ContentRouter.tsx`
3. Wrap each `<Suspense>` block with `<ViewErrorBoundary>`
4. Verify build passes

---

## Task 9: Verify WebSocket Auth (P1)

**Steps:**
1. Read `api/realtime/wsGateway.ts`
2. Check if JWT validation occurs on WebSocket upgrade
3. If missing, add JWT verification on the `upgrade` event
4. Ensure `tenantId` is attached to each WS connection for event broadcasting isolation
5. Verify `subscriptionManager.ts` uses `tenantId` to scope subscriptions

---

## Task 10: Backend Prompt Injection Sanitization (P1)

**Steps:**
1. Create `api/lib/promptSanitizer.ts`:
```typescript
const INJECTION_PATTERNS = [/ignore.{0,20}previous.{0,20}instructions?/i, ...]
export function sanitizePrompt(input: string): string { ... }
```
2. Read `api/routes/ask.ts`
3. Call `sanitizePrompt(question)` before passing to `askJarvis()`
4. Return 422 with `{ error: 'invalid_input' }` for detected injection attempts
5. Write a test for the sanitizer

---

## Task 11: Fix ESLint Warnings (P2 — in priority order)

**Steps:**
1. Run `npm run lint 2>&1 | grep "warning" | sort | uniq -c | sort -rn | head -20`
2. Work through top warning types:
   - Unused vars: remove imports/variables
   - Missing useEffect deps: add deps or use `// eslint-disable-next-line` with comment
   - `any` types: replace with proper interface types
3. Target: get to 0 warnings
4. Add `npm run lint` to the `ci` script in `package.json`

---

## Task 12: Enable CSP (P2)

**Steps:**
1. Read `api/server.ts` Helmet configuration
2. Enable CSP with restrictive policy:
```typescript
contentSecurityPolicy: {
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", "data:", "blob:", "https:"],
    connectSrc: ["'self'", "wss:", "https://api.anthropic.com"],
    fontSrc: ["'self'"],
    objectSrc: ["'none'"],
    upgradeInsecureRequests: [],
  }
}
```
3. Test in browser — check for CSP violations in console
4. Adjust policy for any blocked resources

---

## Task 13: Investigate Digital Twin Migration Gap (P1)

**Steps:**
1. `ls api/db/migrations/ | grep 046` — confirm 046 is missing
2. Read `api/routes/twin.ts` to identify required tables
3. Check if tables exist in any other migration
4. If not: create `api/db/migrations/046_digital_twin.sql` with required DDL + RLS
5. Test migration runner with `npm run db:migrate`

---

## Task Order (Optimized for Claude Sessions)

```
Session 1 (Security Critical):
  Task 1: Anonymization fix
  Task 9: WebSocket auth
  Task 10: Prompt injection

Session 2 (Database Security):
  Task 2: RLS missing tables
  Task 13: Digital twin migration

Session 3 (Infrastructure):
  Task 3: render.yaml
  Task 4: CI/CD gate

Session 4 (Quality):
  Task 5: Navigation test
  Task 6: MIME validation
  Task 7: IFC size limit
  Task 8: ErrorBoundary

Session 5 (Polish):
  Task 11: ESLint
  Task 12: CSP
```
