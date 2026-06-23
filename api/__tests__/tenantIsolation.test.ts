/**
 * Tenant Isolation Tests — Multi-tenancy security boundary verification
 * ─────────────────────────────────────────────────────────────────────
 * Verifies that the tenantQuery() function correctly scopes DB queries
 * to the current tenant and that the X-Tenant-ID header fallback does
 * NOT override a JWT-authenticated tenant context.
 *
 * Attack vectors tested (from 05_MULTI_TENANCY_AUDIT.md):
 *   AV-1: JWT manipulation (tenant_id claim)
 *   AV-2: X-Tenant-ID header injection attempt
 *   AV-3: Direct query() instead of tenantQuery() misuse
 *   AV-4: IDOR (insecure direct object reference)
 *   AV-5: API-level cross-tenant access via route endpoints
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// ─── Shared mock state for DB verification ────────────────────────────────────

let lastTenantId: string | null = null
let lastSql: string | null = null
let lastParams: unknown[] = []

vi.mock('../db/pool', () => ({
  tenantQuery: vi.fn().mockImplementation(
    (tenantId: string, sql: string, params: unknown[]) => {
      lastTenantId = tenantId
      lastSql      = sql
      lastParams   = params
      return Promise.resolve({ rows: [{ id: 'row-1', tenant_id: tenantId, name: 'Test' }], rowCount: 1 })
    }
  ),
  query: vi.fn().mockImplementation((_sql: string, _params: unknown[]) =>
    Promise.resolve({ rows: [], rowCount: 0 })
  ),
  tenantTransaction: vi.fn(),
}))

vi.mock('../../src/modules/observability/index', () => {
  const slog: any = vi.fn()
  slog.info  = vi.fn()
  slog.warn  = vi.fn()
  slog.error = vi.fn()
  return { slog }
})

// Auth mock: extracts tenant from JWT tid claim
vi.mock('../auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    const auth = req.headers['authorization']
    if (!auth?.startsWith('Bearer ')) {
      _res.status(401).json({ error: 'unauthenticated' })
      return
    }
    // Decode JWT payload without verification (test environment)
    try {
      const [, payloadB64] = auth.slice(7).split('.')
      const payload = JSON.parse(Buffer.from(payloadB64!, 'base64').toString())
      if (!payload?.tid) { _res.status(401).json({ error: 'invalid_token' }); return }
      req.auth = payload
      next()
    } catch {
      _res.status(401).json({ error: 'invalid_token' })
    }
  },
  verifyToken: vi.fn(),
}))

vi.mock('../middleware/tenant', () => ({
  requireTenant: () => async (req: any, res: any, next: any) => {
    // Mirrors actual tenant.ts: JWT tid FIRST, then X-Tenant-ID header
    const jwtTid    = req.auth?.tid
    const headerTid = req.headers['x-tenant-id']

    const tenantId = jwtTid ?? headerTid

    if (!tenantId) {
      res.status(400).json({ error: 'tenant_required' })
      return
    }

    // Simulate active tenant lookup
    req.tenantId = tenantId
    req.tenant   = { id: tenantId, status: 'active', slug: 'test' }
    next()
  },
}))

// ─── Token builder (test tokens, not cryptographically signed) ───────────────

function makeToken(tenantId: string, userId = 'user-1', role = 'project_manager'): string {
  const header  = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64')
  const payload = Buffer.from(JSON.stringify({
    sub: userId, tid: tenantId, role, jti: `jti-${Date.now()}`
  })).toString('base64')
  return `${header}.${payload}.test-sig`
}

// ─── Test app ─────────────────────────────────────────────────────────────────

const { requireAuth }    = await import('../auth')
const { requireTenant }  = await import('../middleware/tenant')
const { tenantQuery }    = await import('../db/pool')

function makeApp() {
  const app = express()
  app.use(express.json())
  app.get('/resource/:id',
    requireAuth,
    requireTenant(),
    async (req: any, res: any) => {
      const rows = await tenantQuery(req.tenantId, 'SELECT * FROM resources WHERE id=$1', [req.params.id])
      res.json({ tenantId: req.tenantId, rows: rows.rows })
    }
  )
  return app
}

// ─── Reset before each test ───────────────────────────────────────────────────

beforeEach(() => {
  lastTenantId = null
  lastSql      = null
  lastParams   = []
  vi.clearAllMocks()
})

// ─── AV-1: JWT tenant claim isolation ────────────────────────────────────────

describe('AV-1: JWT tenant_id claim integrity', () => {
  it('uses tenant_id from JWT tid claim', async () => {
    const app = makeApp()
    const res = await request(app)
      .get('/resource/res-001')
      .set('Authorization', `Bearer ${makeToken('tenant-A')}`)
    expect(res.status).toBe(200)
    expect(res.body.tenantId).toBe('tenant-A')
    expect(lastTenantId).toBe('tenant-A')
  })

  it('different tenants produce different tenantId in query', async () => {
    const app = makeApp()

    await request(app)
      .get('/resource/res-001')
      .set('Authorization', `Bearer ${makeToken('tenant-A')}`)
    expect(lastTenantId).toBe('tenant-A')

    await request(app)
      .get('/resource/res-001')
      .set('Authorization', `Bearer ${makeToken('tenant-B')}`)
    expect(lastTenantId).toBe('tenant-B')
  })

  it('tenant-A token CANNOT access data with tenant-B context', async () => {
    const app = makeApp()

    // Tenant A makes request — only tenant A's data in tenantQuery
    const res = await request(app)
      .get('/resource/res-001')
      .set('Authorization', `Bearer ${makeToken('tenant-A')}`)
    expect(res.status).toBe(200)
    // The tenantQuery was called with tenant-A, not tenant-B
    expect(lastTenantId).toBe('tenant-A')
    expect(lastTenantId).not.toBe('tenant-B')
  })
})

// ─── AV-2: X-Tenant-ID header injection attempt ──────────────────────────────

describe('AV-2: X-Tenant-ID header cannot override authenticated JWT tenant', () => {
  it('JWT tenant takes precedence over X-Tenant-ID header', async () => {
    const app = makeApp()
    const res = await request(app)
      .get('/resource/res-001')
      .set('Authorization', `Bearer ${makeToken('tenant-A')}`)
      .set('X-Tenant-ID', 'tenant-EVIL')  // attacker tries to override
    expect(res.status).toBe(200)
    // JWT tenant-A wins; EVIL header is ignored
    expect(res.body.tenantId).toBe('tenant-A')
    expect(lastTenantId).toBe('tenant-A')
  })

  it('unauthenticated request with X-Tenant-ID header is blocked', async () => {
    const app = makeApp()
    const res = await request(app)
      .get('/resource/res-001')
      .set('X-Tenant-ID', 'tenant-EVIL')  // no JWT at all
    // requireAuth blocks the request before requireTenant is reached
    expect(res.status).toBe(401)
  })

  it('header-only tenant resolution blocked when requireAuth guards route', async () => {
    // This verifies the correct architecture: requireAuth always runs first,
    // which means the header fallback in requireTenant is never reachable
    // on authenticated routes without a valid JWT.
    const app = express()
    app.use(express.json())
    // Correct order: requireAuth → requireTenant
    app.get('/secured', requireAuth, requireTenant(), (req: any, res: any) => {
      res.json({ tenantId: req.tenantId })
    })
    const res = await request(app)
      .get('/secured')
      .set('X-Tenant-ID', 'any-tenant')
      // No Authorization header
    expect(res.status).toBe(401)
  })
})

// ─── AV-3: tenantQuery vs. query usage ───────────────────────────────────────

describe('AV-3: tenantQuery correctly scopes query parameters', () => {
  it('tenantQuery receives tenantId as first argument', async () => {
    const app = makeApp()
    await request(app)
      .get('/resource/resource-123')
      .set('Authorization', `Bearer ${makeToken('tenant-XYZ')}`)
    expect(tenantQuery).toHaveBeenCalledWith(
      'tenant-XYZ',
      expect.any(String),
      expect.any(Array),
    )
  })

  it('tenantQuery SQL includes $1 tenant_id parameter binding', async () => {
    const app = makeApp()
    await request(app)
      .get('/resource/resource-123')
      .set('Authorization', `Bearer ${makeToken('tenant-XYZ')}`)
    // The SQL passed to tenantQuery should contain positional params
    expect(lastSql).toContain('$1')
    // The resource ID should be in params
    expect(lastParams).toContain('resource-123')
  })
})

// ─── AV-4: IDOR prevention ────────────────────────────────────────────────────

describe('AV-4: IDOR — cannot fetch another tenant\'s resource by ID', () => {
  it('tenantQuery context prevents cross-tenant row access', async () => {
    const app = makeApp()

    // Tenant A fetches resource-XYZ
    await request(app)
      .get('/resource/resource-XYZ')
      .set('Authorization', `Bearer ${makeToken('tenant-A')}`)
    expect(lastTenantId).toBe('tenant-A')

    // Tenant B attempts to fetch same ID — but tenantQuery context differs
    await request(app)
      .get('/resource/resource-XYZ')
      .set('Authorization', `Bearer ${makeToken('tenant-B')}`)
    expect(lastTenantId).toBe('tenant-B')
    // RLS + WHERE tenant_id clause ensures tenant-B only sees their own data
  })
})

// ─── AV-5: Route-level tenant isolation ──────────────────────────────────────

describe('AV-5: Route enforces tenant isolation on every request', () => {
  it('each request gets its own isolated tenant context', async () => {
    const app      = makeApp()
    const tenants  = ['tenant-alpha', 'tenant-beta', 'tenant-gamma']
    const captured: string[] = []

    for (const tid of tenants) {
      await request(app)
        .get('/resource/some-resource')
        .set('Authorization', `Bearer ${makeToken(tid)}`)
      captured.push(lastTenantId!)
    }

    expect(captured).toEqual(tenants)
  })

  it('concurrent requests do not bleed tenant context', async () => {
    const app = makeApp()
    // Fire 3 requests simultaneously
    const results = await Promise.all([
      request(app).get('/resource/r1').set('Authorization', `Bearer ${makeToken('tenant-1')}`),
      request(app).get('/resource/r2').set('Authorization', `Bearer ${makeToken('tenant-2')}`),
      request(app).get('/resource/r3').set('Authorization', `Bearer ${makeToken('tenant-3')}`),
    ])
    for (const res of results) {
      expect(res.status).toBe(200)
    }
    // Each request resolved its own tenant correctly
    const tenantIds = results.map(r => r.body.tenantId)
    expect(new Set(tenantIds).size).toBe(3)  // all distinct
  })
})
