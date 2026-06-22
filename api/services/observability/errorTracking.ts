/**
 * Denver Engineering — Error Tracking & Observability (v1.0.0)
 * ─────────────────────────────────────────────────────────────
 * Centralized error tracking with optional Sentry integration.
 *
 * Design:
 *   - When SENTRY_DSN is set: initializes Sentry Node SDK and reports
 *     errors with full context (tenant, user, request metadata).
 *   - When SENTRY_DSN is not set: logs to Pino (existing logger) as fallback.
 *   - Always safe to call — never throws.
 *
 * Usage:
 *   import { captureError, captureMessage, setRequestContext } from './errorTracking'
 *
 *   // In route handlers:
 *   try { ... } catch (err) {
 *     captureError(err, { tenantId, userId, route: '/api/v1/evm/metrics' })
 *     res.status(500).json({ error: 'internal_error' })
 *   }
 *
 * Express integration (add to server.ts AFTER all routes):
 *   import { errorTrackingMiddleware } from './services/observability/errorTracking'
 *   app.use(errorTrackingMiddleware)
 */

import { slog } from '../../../src/modules/observability/index'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ErrorContext {
  tenantId?:     string
  userId?:       string
  route?:        string
  method?:       string
  statusCode?:   number
  correlationId?: string
  extra?:        Record<string, unknown>
}

type SentryClient = {
  captureException: (err: unknown, opts?: object) => string
  captureMessage:   (msg: string, level?: string, opts?: object) => string
  setUser:          (user: object | null) => void
  setTag:           (key: string, value: string) => void
  withScope:        (cb: (scope: ScopeClient) => void) => void
  flush:            (timeout?: number) => Promise<boolean>
}

type ScopeClient = {
  setTag:   (key: string, value: string) => void
  setUser:  (user: object | null) => void
  setExtra: (key: string, value: unknown) => void
  setLevel: (level: string) => void
}

// ─── Singleton Sentry state ───────────────────────────────────────────────────

let _sentry: SentryClient | null = null
let _initialized                 = false

// ─── Initialize ───────────────────────────────────────────────────────────────

export async function initErrorTracking(): Promise<void> {
  if (_initialized) return
  _initialized = true

  const dsn = process.env['SENTRY_DSN']
  if (!dsn) {
    slog('INFO', 'observability', '[error-tracking] SENTRY_DSN not set — using Pino fallback')
    return
  }

  try {
    // Dynamic import to avoid bundling Sentry when DSN is not set
    // @ts-ignore — optional peer dep; only present when SENTRY_DSN is configured
    const Sentry = await import('@sentry/node')
    Sentry.init({
      dsn,
      environment:  process.env['NODE_ENV'] ?? 'development',
      release:      process.env['npm_package_version'],
      tracesSampleRate: 0.1,   // 10% transaction sampling — adjust for production
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      beforeSend(event: any) {
        // Redact sensitive fields from error payloads
        if (event.request?.data) {
          const data = event.request.data as Record<string, unknown>
          for (const key of ['password', 'token', 'api_key', 'secret', 'authorization', 'clientSecret', 'client_secret', 'clientId', 'client_id']) {
            if (key in data) data[key] = '[REDACTED]'
          }
        }
        return event
      },
    })
    _sentry = Sentry as unknown as SentryClient
    slog('INFO', 'observability', '[error-tracking] Sentry initialized', { dsn: dsn.slice(0, 30) + '...' })
  } catch (err) {
    slog('WARN', 'observability', '[error-tracking] Failed to initialize Sentry', {
      message: err instanceof Error ? err.message : String(err),
    })
  }
}

// ─── captureError ─────────────────────────────────────────────────────────────

export function captureError(err: unknown, ctx: ErrorContext = {}): void {
  const message = err instanceof Error ? err.message : String(err)

  if (_sentry) {
    _sentry.withScope(scope => {
      if (ctx.tenantId)     scope.setTag('tenant_id', ctx.tenantId)
      if (ctx.userId)       scope.setTag('user_id', ctx.userId)
      if (ctx.route)        scope.setTag('route', ctx.route)
      if (ctx.method)       scope.setTag('method', ctx.method)
      if (ctx.correlationId) scope.setTag('correlation_id', ctx.correlationId)
      if (ctx.statusCode)   scope.setExtra('status_code', ctx.statusCode)
      if (ctx.extra) {
        for (const [k, v] of Object.entries(ctx.extra)) {
          scope.setExtra(k, v)
        }
      }
      _sentry!.captureException(err)
    })
  }

  // Always log to Pino regardless of Sentry
  slog('ERROR', ctx.route ?? 'unhandled', `[error] ${message}`, {
    tenantId:     ctx.tenantId,
    userId:       ctx.userId,
    route:        ctx.route,
    method:       ctx.method,
    statusCode:   ctx.statusCode,
    correlationId: ctx.correlationId,
    stack:        err instanceof Error ? err.stack?.split('\n').slice(0, 5).join('\n') : undefined,
  })
}

// ─── captureMessage ───────────────────────────────────────────────────────────

export function captureMessage(
  message: string,
  level:   'info' | 'warning' | 'error' = 'info',
  ctx:     ErrorContext = {},
): void {
  if (_sentry) {
    _sentry.withScope(scope => {
      if (ctx.tenantId) scope.setTag('tenant_id', ctx.tenantId)
      if (ctx.userId)   scope.setTag('user_id', ctx.userId)
      scope.setLevel(level)
      _sentry!.captureMessage(message, level)
    })
  }
  slog(level === 'error' ? 'ERROR' : level === 'warning' ? 'WARN' : 'INFO',
    'observability', message, ctx)
}

// ─── Express error middleware ─────────────────────────────────────────────────

import type { Request, Response, NextFunction } from 'express'

export function errorTrackingMiddleware(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const correlationId = res.getHeader('x-correlation-id') as string | undefined
  const reqAny = req as unknown as Record<string, unknown>

  captureError(err, {
    tenantId:      (reqAny['tenantId'] as string | undefined),
    userId:        ((reqAny['auth'] as Record<string, unknown> | undefined)?.['sub'] as string | undefined),
    route:         req.path,
    method:        req.method,
    statusCode:    500,
    correlationId,
  })

  const isProd = process.env['NODE_ENV'] === 'production'
  res.status(500).json({
    error:   'internal_error',
    message: isProd ? 'An internal error occurred.' : err.message,
    ...(isProd ? {} : { stack: err.stack?.split('\n').slice(0, 5) }),
  })
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────

export async function flushErrorTracking(timeoutMs = 2000): Promise<void> {
  if (_sentry) {
    await _sentry.flush(timeoutMs)
  }
}
