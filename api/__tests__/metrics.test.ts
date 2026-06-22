/**
 * Denver Engineering — Prometheus Metrics Tests
 * ──────────────────────────────────────────────
 * Tests for api/services/observability/metrics.ts:
 *   - metricsHandler: unauthenticated access when no token, bearer token enforcement
 *   - metricsMiddleware: tracks method/route/status/duration counters
 *   - normalisePath: UUID replacement in label paths
 *   - Counter increments: authLoginTotal, authTokenRefreshTotal, jobTotal
 *   - Histogram observations: httpRequestDurationMs, jobDurationMs
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Request, Response, NextFunction } from 'express'

// ─── Mock prom-client ─────────────────────────────────────────────────────────
//
// prom-client registers metrics globally; we reset between tests by clearing
// the mocked registry. We don't actually create real Prometheus metrics in
// tests — we just verify increment/observe calls.
//
// vi.hoisted() is required because vi.mock factories are hoisted before const
// declarations — mocks that reference module-level consts need hoisted vars.

const { mockRegistryMetrics, mockCounterInc, mockHistObserve } = vi.hoisted(() => ({
  mockRegistryMetrics: vi.fn().mockResolvedValue('# HELP mock\n# TYPE mock counter\nmock 0\n'),
  mockCounterInc:      vi.fn(),
  mockHistObserve:     vi.fn(),
}))

vi.mock('prom-client', () => {
  class FakeCounter {
    inc = mockCounterInc
  }
  class FakeHistogram {
    observe = mockHistObserve
  }
  class FakeGauge {
    set = vi.fn()
    inc = vi.fn()
    dec = vi.fn()
  }
  class FakeRegistry {
    setDefaultLabels = vi.fn()
    contentType      = 'text/plain; version=0.0.4; charset=utf-8'
    metrics          = mockRegistryMetrics
  }
  return {
    default: {
      Counter:               FakeCounter,
      Histogram:             FakeHistogram,
      Gauge:                 FakeGauge,
      Registry:              FakeRegistry,
      collectDefaultMetrics: vi.fn(),
    },
    Counter:               FakeCounter,
    Histogram:             FakeHistogram,
    Gauge:                 FakeGauge,
    Registry:              FakeRegistry,
    collectDefaultMetrics: vi.fn(),
  }
})

// Import AFTER mocking
import {
  metricsHandler,
  metricsMiddleware,
  httpRequestTotal,
  httpRequestDurationMs,
  authLoginTotal,
  authTokenRefreshTotal,
  authSamlLoginTotal,
  jobTotal,
  jobDurationMs,
  scimOperationTotal,
} from '../services/observability/metrics'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    method:  'GET',
    path:    '/api/v1/health',
    headers: {},
    ...overrides,
  } as unknown as Request
}

function makeRes(overrides: Partial<Response & { _headers: Record<string, string> }> = {}): Response & {
  _status?: number
  _body?:   string | null
  _ended?:  boolean
  _headers: Record<string, string>
  _listeners: Record<string, (() => void)[]>
} {
  const res: any = {
    statusCode: 200,
    _status:    undefined,
    _body:      undefined,
    _ended:     false,
    _headers:   {},
    _listeners: {},
    status(code: number) { this._status = code; this.statusCode = code; return this },
    end(body?: string)   { this._ended = true; this._body = body ?? null; return this },
    json(body?: unknown)  { this._ended = true; this._body = body == null ? null : JSON.stringify(body); return this },
    set(key: string, val: string) { this._headers[key] = val; return this },
    on(event: string, cb: () => void) {
      this._listeners[event] ??= []
      this._listeners[event].push(cb)
      return this
    },
    emit(event: string) { (this._listeners[event] ?? []).forEach((cb: () => void) => cb()) },
    ...overrides,
  }
  return res
}

// ─── metricsHandler ───────────────────────────────────────────────────────────

describe('metricsHandler', () => {
  beforeEach(() => {
    vi.resetModules()
    delete process.env['METRICS_TOKEN']
    process.env['NODE_ENV'] = 'test'
    mockRegistryMetrics.mockClear()
    mockCounterInc.mockClear()
    mockHistObserve.mockClear()
  })

  // OPS-004: fail-closed when METRICS_TOKEN is not configured.
  it('returns 503 (fail-closed) for a remote request when no METRICS_TOKEN set', async () => {
    delete process.env['METRICS_TOKEN']
    process.env['NODE_ENV'] = 'production'
    const req = makeReq({ ip: '203.0.113.7' } as any)
    const res = makeRes()
    await metricsHandler(req, res as any)
    expect(res._status).toBe(503)
    expect(mockRegistryMetrics).not.toHaveBeenCalled()
  })

  it('denies in production even from localhost when no METRICS_TOKEN set', async () => {
    delete process.env['METRICS_TOKEN']
    process.env['NODE_ENV'] = 'production'
    const req = makeReq({ ip: '127.0.0.1' } as any)
    const res = makeRes()
    await metricsHandler(req, res as any)
    expect(res._status).toBe(503)
  })

  it('allows localhost in non-production when no METRICS_TOKEN set (dev convenience)', async () => {
    delete process.env['METRICS_TOKEN']
    process.env['NODE_ENV'] = 'development'
    const req = makeReq({ ip: '127.0.0.1' } as any)
    const res = makeRes()
    await metricsHandler(req, res as any)
    expect(res._ended).toBe(true)
    expect(res._headers['Content-Type']).toBe('text/plain; version=0.0.4; charset=utf-8')
    expect(mockRegistryMetrics).toHaveBeenCalledOnce()
  })

  it('returns 401 when METRICS_TOKEN set and Authorization header is missing', async () => {
    process.env['METRICS_TOKEN'] = 'secret-token'
    const req = makeReq({ headers: {} } as any)
    const res = makeRes()
    await metricsHandler(req, res as any)
    expect(res._status).toBe(401)
    expect(res._headers['WWW-Authenticate']).toBe('Bearer')
    expect(mockRegistryMetrics).not.toHaveBeenCalled()
  })

  it('returns 401 when METRICS_TOKEN set and wrong token is presented', async () => {
    process.env['METRICS_TOKEN'] = 'correct-token'
    const req = makeReq({ headers: { authorization: 'Bearer wrong-token' } } as any)
    const res = makeRes()
    await metricsHandler(req, res as any)
    expect(res._status).toBe(401)
    expect(mockRegistryMetrics).not.toHaveBeenCalled()
  })

  it('returns 200 when METRICS_TOKEN set and correct bearer token presented', async () => {
    process.env['METRICS_TOKEN'] = 'correct-token'
    const req = makeReq({ headers: { authorization: 'Bearer correct-token' } } as any)
    const res = makeRes()
    await metricsHandler(req, res as any)
    expect(res._ended).toBe(true)
    expect(res._status).not.toBe(401)
    expect(mockRegistryMetrics).toHaveBeenCalledOnce()
  })

  it('returns 500 if registry.metrics() throws', async () => {
    process.env['METRICS_TOKEN'] = 'tok'
    mockRegistryMetrics.mockRejectedValueOnce(new Error('registry error'))
    const req = makeReq({ headers: { authorization: 'Bearer tok' } } as any)
    const res = makeRes()
    await metricsHandler(req, res as any)
    expect(res._status).toBe(500)
  })
})

// ─── metricsMiddleware ────────────────────────────────────────────────────────

describe('metricsMiddleware', () => {
  beforeEach(() => {
    mockCounterInc.mockClear()
    mockHistObserve.mockClear()
  })

  it('calls next() immediately', () => {
    const next = vi.fn()
    const req  = makeReq({ method: 'GET', path: '/api/v1/health' } as any)
    const res  = makeRes()
    metricsMiddleware(req, res as any, next)
    expect(next).toHaveBeenCalledOnce()
  })

  it('records counter and histogram on response finish', () => {
    const next = vi.fn()
    const req  = makeReq({ method: 'POST', path: '/api/v1/projects' } as any)
    const res  = makeRes()
    metricsMiddleware(req, res as any, next)
    res.statusCode = 201
    res.emit('finish')
    expect(mockCounterInc).toHaveBeenCalledWith({
      method: 'POST', route: '/api/v1/projects', status_code: '201',
    })
    expect(mockHistObserve).toHaveBeenCalledWith(
      { method: 'POST', route: '/api/v1/projects', status_code: '201' },
      expect.any(Number),
    )
  })

  it('normalises UUID segments to :id in route label', () => {
    const next = vi.fn()
    const uuid = '550e8400-e29b-41d4-a716-446655440000'
    const req  = makeReq({ method: 'GET', path: `/api/v1/projects/${uuid}/evm` } as any)
    const res  = makeRes()
    metricsMiddleware(req, res as any, next)
    res.statusCode = 200
    res.emit('finish')
    expect(mockCounterInc).toHaveBeenCalledWith({
      method: 'GET', route: '/api/v1/projects/:id/evm', status_code: '200',
    })
  })

  it('normalises multiple UUIDs in a single path', () => {
    const next  = vi.fn()
    const uuid1 = '550e8400-e29b-41d4-a716-446655440000'
    const uuid2 = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
    const req   = makeReq({ method: 'DELETE', path: `/api/v1/tenants/${uuid1}/users/${uuid2}` } as any)
    const res   = makeRes()
    metricsMiddleware(req, res as any, next)
    res.statusCode = 204
    res.emit('finish')
    expect(mockCounterInc).toHaveBeenCalledWith({
      method: 'DELETE', route: '/api/v1/tenants/:id/users/:id', status_code: '204',
    })
  })

  it('records 4xx status correctly', () => {
    const next = vi.fn()
    const req  = makeReq({ method: 'GET', path: '/api/v1/missing' } as any)
    const res  = makeRes()
    metricsMiddleware(req, res as any, next)
    res.statusCode = 404
    res.emit('finish')
    expect(mockCounterInc).toHaveBeenCalledWith(
      expect.objectContaining({ status_code: '404' }),
    )
  })
})

// ─── Counter export shapes ────────────────────────────────────────────────────

describe('exported counters and histograms', () => {
  it('authLoginTotal has .inc method', () => {
    expect(typeof authLoginTotal.inc).toBe('function')
  })

  it('authTokenRefreshTotal has .inc method', () => {
    expect(typeof authTokenRefreshTotal.inc).toBe('function')
  })

  it('authSamlLoginTotal has .inc method', () => {
    expect(typeof authSamlLoginTotal.inc).toBe('function')
  })

  it('jobTotal has .inc method', () => {
    expect(typeof jobTotal.inc).toBe('function')
  })

  it('jobDurationMs has .observe method', () => {
    expect(typeof jobDurationMs.observe).toBe('function')
  })

  it('httpRequestTotal has .inc method', () => {
    expect(typeof httpRequestTotal.inc).toBe('function')
  })

  it('httpRequestDurationMs has .observe method', () => {
    expect(typeof httpRequestDurationMs.observe).toBe('function')
  })

  it('scimOperationTotal has .inc method', () => {
    expect(typeof scimOperationTotal.inc).toBe('function')
  })
})

// ─── Increment / observe call shapes ─────────────────────────────────────────

describe('counter increment label shapes', () => {
  beforeEach(() => {
    mockCounterInc.mockClear()
    mockHistObserve.mockClear()
  })

  it('authLoginTotal can be incremented with result label', () => {
    authLoginTotal.inc({ result: 'success' })
    expect(mockCounterInc).toHaveBeenCalledWith({ result: 'success' })
  })

  it('authTokenRefreshTotal can be incremented with result label', () => {
    authTokenRefreshTotal.inc({ result: 'revoked' })
    expect(mockCounterInc).toHaveBeenCalledWith({ result: 'revoked' })
  })

  it('authSamlLoginTotal can be incremented with result + provider labels', () => {
    authSamlLoginTotal.inc({ result: 'success', provider: 'okta' })
    expect(mockCounterInc).toHaveBeenCalledWith({ result: 'success', provider: 'okta' })
  })

  it('jobTotal can be incremented with job_type + status labels', () => {
    jobTotal.inc({ job_type: 'send_notification', status: 'success' })
    expect(mockCounterInc).toHaveBeenCalledWith({ job_type: 'send_notification', status: 'success' })
  })

  it('jobDurationMs can be observed with job_type label', () => {
    jobDurationMs.observe({ job_type: 'integration_sync' }, 350)
    expect(mockHistObserve).toHaveBeenCalledWith({ job_type: 'integration_sync' }, 350)
  })

  it('scimOperationTotal can be incremented with operation + result labels', () => {
    scimOperationTotal.inc({ operation: 'create', result: 'success' })
    expect(mockCounterInc).toHaveBeenCalledWith({ operation: 'create', result: 'success' })
  })
})
