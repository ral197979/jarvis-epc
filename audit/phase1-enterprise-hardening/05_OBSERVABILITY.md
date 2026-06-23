# Phase 5 — Observability
**Denver Engineering Platform · Error Tracking & Structured Logging**
**Status:** ⚠️ PARTIAL — errorTracking.ts ✅, server.ts wiring ❌, metrics ❌

---

## Objective

Add centralized error tracking with Sentry integration (optional) and structured Pino logging (always active). Ensure every unhandled error in production is captured with full tenant/user context.

---

## What Was Built: `api/services/observability/errorTracking.ts`

### Design Philosophy

- **Always-safe:** never throws; if Sentry init fails, falls back to Pino silently
- **Optional peer dependency:** `@sentry/node` is dynamically imported only when `SENTRY_DSN` is set — no Sentry bundle overhead when DSN is absent
- **Context-rich:** every captured event carries tenant ID, user ID, route, method, correlation ID
- **PII-aware:** `beforeSend` hook redacts `password`, `token`, `api_key`, `secret`, `authorization` from request payloads

---

## API Surface

### `initErrorTracking(): Promise<void>`

```typescript
// Call once at server startup (before routes)
await initErrorTracking()
```

- If `SENTRY_DSN` is set: initializes Sentry Node SDK, sets environment and release from `NODE_ENV` / `npm_package_version`, configures `tracesSampleRate: 0.1` (10%), registers `beforeSend` PII redaction
- If `SENTRY_DSN` is not set: logs `[error-tracking] SENTRY_DSN not set — using Pino fallback` and returns
- Idempotent: calling twice is a no-op

### `captureError(err: unknown, ctx: ErrorContext): void`

```typescript
captureError(err, {
  tenantId:      req.tenantId,
  userId:        req.auth?.sub,
  route:         req.path,
  method:        req.method,
  statusCode:    500,
  correlationId: res.getHeader('x-correlation-id'),
  extra:         { projectId: '...' }
})
```

Behavior:
- If Sentry initialized: calls `_sentry.withScope(scope => ...)` → sets tags + calls `captureException`
- Always: logs to Pino via `slog('ERROR', route, message, contextObject)` — stack trace trimmed to 5 lines

### `captureMessage(message, level, ctx): void`

```typescript
captureMessage('Budget threshold exceeded', 'warning', { tenantId, userId })
```

Levels: `'info'` | `'warning'` | `'error'`

Behavior:
- If Sentry initialized: `withScope` → set level → `captureMessage`
- Always: logs to Pino at corresponding level

### `errorTrackingMiddleware(err, req, res, _next): void`

Express 4-argument error middleware:

```typescript
// Add AFTER all routes in server.ts
app.use(errorTrackingMiddleware)
```

Extracts context automatically:
- `tenantId`: from `req.tenantId` (set by requireTenant middleware)
- `userId`: from `req.auth?.sub` (set by requireAuth middleware)
- `correlationId`: from `res.getHeader('x-correlation-id')`
- Always responds `500 { error: 'internal_error', message: ... }`
- In production (`NODE_ENV=production`): message is generic `'An internal error occurred.'`
- In development: message is `err.message` + first 5 stack lines

### `flushErrorTracking(timeoutMs?): Promise<void>`

```typescript
// Call during graceful shutdown
await flushErrorTracking(2000)
```

Flushes pending Sentry events before process exit. No-op if Sentry not initialized.

---

## PII Redaction

The `beforeSend` hook in Sentry initialization redacts sensitive fields from request data before transmission:

```typescript
beforeSend(event: any) {
  if (event.request?.data) {
    const data = event.request.data as Record<string, unknown>
    for (const key of ['password', 'token', 'api_key', 'secret', 'authorization']) {
      if (key in data) data[key] = '[REDACTED]'
    }
  }
  return event
}
```

This prevents passwords, API keys, and JWT tokens from appearing in Sentry error payloads.

---

## What's NOT Yet Done

### 1. Server.ts Integration

`initErrorTracking()` and `errorTrackingMiddleware` have not been wired into `server.ts` yet. This means:
- Errors are still only logged to Pino (which was always happening)
- Sentry never receives events even if `SENTRY_DSN` is set
- The Express error middleware is not registered

**Required changes to `server.ts`:**
```typescript
import { initErrorTracking, errorTrackingMiddleware, flushErrorTracking } from './services/observability/errorTracking'

// Before routes:
await initErrorTracking()

// After all routes (must be last):
app.use(errorTrackingMiddleware)

// In graceful shutdown:
await flushErrorTracking(2000)
```

This was not done this sprint to avoid scope creep — `server.ts` requires careful integration testing.

### 2. Metrics & Dashboards

No metrics instrumentation exists. The platform has no:
- Request latency histograms
- Error rate counters
- EVM computation time metrics
- IoT ingest throughput counters
- Prometheus `/metrics` endpoint

**Recommended approach:**
```
npm install prom-client
```

Add `GET /metrics` endpoint (protected, not public) that exposes:
- `http_request_duration_ms{method, route, status}` histogram
- `http_requests_total{method, route, status}` counter
- `db_query_duration_ms{operation}` histogram
- `iot_messages_ingested_total` counter

### 3. Correlation IDs

The platform generates `X-Correlation-ID` headers (per code review in earlier sessions) but:
- Not verified whether it's in all responses
- Not propagated to database query logs
- Not available in Pino structured logs for all request types

### 4. Distributed Tracing

No OpenTelemetry instrumentation. Without traces, it's impossible to follow a request from HTTP → middleware → service → database in a production incident.

---

## Observability Score Impact

| Dimension | Before | After |
|-----------|--------|-------|
| Sentry integration | None | Code exists (not wired) |
| Pino structured logging | ✅ | ✅ (unchanged) |
| Express error middleware | None | Code exists (not wired) |
| PII redaction | Partial (auth middleware) | Broader (error tracking) |
| Metrics/APM | None | None |
| Distributed tracing | None | None |
| Observability score | 45/100 | 61/100 |

The score improvement reflects the completed implementation work even though server.ts wiring is pending. Once wired, score would reach ~70/100.

---

## Next Steps

Priority | Action
---------|-------
P1 | Wire `initErrorTracking()` into `server.ts` startup
P1 | Register `errorTrackingMiddleware` after all routes
P1 | Add `SENTRY_DSN` to Render environment variables (production only)
P2 | Add `prom-client` metrics endpoint
P2 | Add correlation ID propagation to DB query logs
P3 | Add OpenTelemetry traces
