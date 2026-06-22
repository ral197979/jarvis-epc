/**
 * Denver Engineering — Prometheus Metrics (v1.0.0)
 * ─────────────────────────────────────────────────
 * Exposes a Prometheus-compatible /metrics endpoint.
 *
 * Metrics collected:
 *   - Default Node.js metrics (heap, CPU, event loop lag, GC) via collectDefaultMetrics
 *   - HTTP request count + duration histogram, labelled by method/route/status
 *   - Auth events: login success/failure, token refresh, SAML login
 *   - Background job count + duration, labelled by job_type and status
 *   - Active tenant session gauge (approximate)
 *
 * Endpoint security:
 *   GET /metrics requires Authorization: Bearer <METRICS_TOKEN>
 *   when METRICS_TOKEN env var is set. Without the env var the endpoint
 *   is open — suitable for private internal networks only.
 *
 * Prometheus scrape config example:
 *   scrape_configs:
 *     - job_name: 'denver-engineering'
 *       static_configs:
 *         - targets: ['api.example.com:443']
 *       scheme: https
 *       authorization:
 *         credentials: '<METRICS_TOKEN>'
 */

import client from 'prom-client'
import type { Request, Response, NextFunction } from 'express'

// ─── Registry ─────────────────────────────────────────────────────────────────

export const registry = new client.Registry()
registry.setDefaultLabels({ service: 'denver-engineering-api' })

// Collect default Node.js metrics: heap, CPU, event loop lag, GC pauses, etc.
client.collectDefaultMetrics({ register: registry })

// ─── HTTP metrics ─────────────────────────────────────────────────────────────

export const httpRequestTotal = new client.Counter({
  name:    'http_requests_total',
  help:    'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'] as const,
  registers: [registry],
})

export const httpRequestDurationMs = new client.Histogram({
  name:    'http_request_duration_ms',
  help:    'HTTP request duration in milliseconds',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
  registers: [registry],
})

// ─── Auth metrics ─────────────────────────────────────────────────────────────

export const authLoginTotal = new client.Counter({
  name:    'auth_login_total',
  help:    'Total login attempts by result',
  labelNames: ['result'] as const,  // 'success' | 'invalid_credentials' | 'account_locked' | 'unknown_email'
  registers: [registry],
})

export const authTokenRefreshTotal = new client.Counter({
  name:    'auth_token_refresh_total',
  help:    'Total token refresh attempts by result',
  labelNames: ['result'] as const,  // 'success' | 'invalid' | 'revoked'
  registers: [registry],
})

export const authSamlLoginTotal = new client.Counter({
  name:    'auth_saml_login_total',
  help:    'Total SAML SSO logins by result',
  labelNames: ['result', 'provider'] as const,
  registers: [registry],
})

// ─── Background job metrics ───────────────────────────────────────────────────

export const jobTotal = new client.Counter({
  name:    'background_job_total',
  help:    'Total background jobs by type and status',
  labelNames: ['job_type', 'status'] as const,  // status: 'success' | 'failed' | 'exhausted'
  registers: [registry],
})

export const jobDurationMs = new client.Histogram({
  name:    'background_job_duration_ms',
  help:    'Background job duration in milliseconds',
  labelNames: ['job_type'] as const,
  buckets: [50, 100, 500, 1000, 5000, 15000, 30000, 60000],
  registers: [registry],
})

// ─── SCIM provisioning metrics ────────────────────────────────────────────────

export const scimOperationTotal = new client.Counter({
  name:    'scim_operation_total',
  help:    'Total SCIM provisioning operations',
  labelNames: ['operation', 'result'] as const,  // operation: 'create'|'update'|'deactivate'; result: 'success'|'error'
  registers: [registry],
})

// ─── HTTP middleware ───────────────────────────────────────────────────────────
//
// Mount BEFORE routes. Normalises paths so /api/v1/projects/uuid/...
// becomes /api/v1/projects/:id/... to avoid high-cardinality label explosion.

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

function normalisePath(path: string): string {
  // Replace UUIDs with :id
  return path.replace(UUID_RE, ':id')
}

export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now()
  res.on('finish', () => {
    const route  = normalisePath(req.path)
    const method = req.method
    const status = String(res.statusCode)
    const durationMs = Date.now() - start
    httpRequestTotal.inc({ method, route, status_code: status })
    httpRequestDurationMs.observe({ method, route, status_code: status }, durationMs)
  })
  next()
}

// ─── /metrics endpoint handler ────────────────────────────────────────────────
//
// Add to server.ts:
//   app.get('/metrics', metricsHandler)

export async function metricsHandler(req: Request, res: Response): Promise<void> {
  // Token auth when METRICS_TOKEN is configured.
  // NOTE: base/pre-audit behavior. OPS-004 (fail-closed) is applied in PR #1.
  const token = process.env['METRICS_TOKEN']
  if (token) {
    const authHeader = req.headers['authorization'] ?? ''
    if (authHeader !== `Bearer ${token}`) {
      res.status(401).set('WWW-Authenticate', 'Bearer').end()
      return
    }
  }

  try {
    const output = await registry.metrics()
    res.set('Content-Type', registry.contentType)
    res.end(output)
  } catch {
    res.status(500).end()
  }
}
