/**
 * SCIM 2.0 Provisioning Routes — Integration Tests
 * ──────────────────────────────────────────────────
 * Tests /scim/v2 endpoints via HTTP (supertest).
 * All DB calls are mocked — no real database required.
 *
 * Coverage:
 *   Bearer token authentication (missing, invalid, valid)
 *   GET  /ServiceProviderConfig
 *   GET  /Schemas
 *   GET  /Users            — list + email/active filters
 *   GET  /Users/:id        — found + 404
 *   POST /Users            — create, missing userName, invalid email, idempotent 409→200
 *   PUT  /Users/:id        — full replace
 *   PATCH /Users/:id       — Azure AD path-based + Okta value-object patterns
 *   DELETE /Users/:id      — deactivate + 404
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// ─── Hoisted mocks (vi.mock factories are hoisted before const declarations) ──
// Use vi.hoisted() so references to these fns are available when vi.mock runs.

const { mockQuery, mockTenantQuery } = vi.hoisted(() => ({
  mockQuery:       vi.fn(),
  mockTenantQuery: vi.fn(),
}))

vi.mock('../db/pool', () => ({
  query:             mockQuery,
  tenantQuery:       mockTenantQuery,
  tenantTransaction: vi.fn(),
}))

vi.mock('../../src/modules/observability/index', () => {
  const slog: any = vi.fn()
  slog.info  = vi.fn()
  slog.warn  = vi.fn()
  slog.error = vi.fn()
  return { slog }
})

vi.mock('../auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.auth = { sub: 'admin-user-id', tid: 'tenant-1', role: 'admin', jti: 'jti-aaa' }
    next()
  },
  requireRole: (..._roles: string[]) => (_req: any, _res: any, next: any) => next(),
}))

vi.mock('../middleware/tenant', () => ({
  requireTenant: () => (req: any, _res: any, next: any) => {
    req.tenantId = 'tenant-1'
    next()
  },
}))

// ─── Router import (AFTER mocks) ──────────────────────────────────────────────

import { scimRouter } from '../routes/scim'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/scim/v2', scimRouter)
  return app
}

const AUTH = { Authorization: 'Bearer scim_some_valid_token_value' }

// Token rows returned for auth lookup
const TOKEN_ROW = { id: 'tok-uuid-1', tenant_id: 'tenant-1' }

// Representative DB user row
const DB_USER = {
  id:           'user-uuid-abc',
  email:        'jane.doe@example.com',
  display_name: 'Jane Doe',
  role:         'engineer',
  is_active:    true,
  created_at:   '2025-01-01T00:00:00.000Z',
  updated_at:   '2025-06-01T00:00:00.000Z',
}

/**
 * Sets up mockQuery to:
 *  - Return TOKEN_ROW on SELECT from scim_tokens (token auth)
 *  - Return max_users: 10 on tenant max_users query
 *  - Return empty rows for all other queries (fire-and-forget inserts)
 */
function setupDefaultMocks({ tokenValid = true, maxUsers = 10 }: { tokenValid?: boolean; maxUsers?: number } = {}) {
  mockQuery.mockImplementation(async (sql: string) => {
    if (typeof sql !== 'string') return { rows: [], rowCount: 0 }
    if (sql.includes('scim_tokens') && sql.includes('SELECT')) {
      return tokenValid
        ? { rows: [TOKEN_ROW], rowCount: 1 }
        : { rows: [],         rowCount: 0 }
    }
    if (sql.includes('max_users')) return { rows: [{ max_users: maxUsers }], rowCount: 1 }
    return { rows: [], rowCount: 0 }  // fire-and-forget audit inserts, etc.
  })
}

// ══════════════════════════════════════════════════════════════════════════════
// Bearer token authentication
// ══════════════════════════════════════════════════════════════════════════════

describe('SCIM — Bearer token authentication', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupDefaultMocks()
  })

  it('returns 401 when Authorization header is absent', async () => {
    const res = await request(makeApp()).get('/scim/v2/ServiceProviderConfig')
    expect(res.status).toBe(401)
    expect(res.body.schemas?.[0]).toContain('Error')
  })

  it('returns 401 for non-Bearer scheme', async () => {
    const res = await request(makeApp())
      .get('/scim/v2/ServiceProviderConfig')
      .set('Authorization', 'Basic dXNlcjpwYXNz')
    expect(res.status).toBe(401)
  })

  it('returns 401 for invalid or expired token', async () => {
    setupDefaultMocks({ tokenValid: false })
    const res = await request(makeApp())
      .get('/scim/v2/ServiceProviderConfig')
      .set(AUTH)
    expect(res.status).toBe(401)
    expect(res.body.detail).toMatch(/invalid or expired/i)
  })

  it('passes through with a valid token', async () => {
    const res = await request(makeApp())
      .get('/scim/v2/ServiceProviderConfig')
      .set(AUTH)
    expect(res.status).toBe(200)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// GET /ServiceProviderConfig
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /scim/v2/ServiceProviderConfig', () => {
  beforeEach(() => { vi.clearAllMocks(); setupDefaultMocks() })

  it('returns 200 with ServiceProviderConfig schema', async () => {
    const res = await request(makeApp())
      .get('/scim/v2/ServiceProviderConfig')
      .set(AUTH)
    expect(res.status).toBe(200)
    expect(res.body.schemas?.[0]).toContain('ServiceProviderConfig')
  })

  it('declares PATCH support', async () => {
    const res = await request(makeApp())
      .get('/scim/v2/ServiceProviderConfig')
      .set(AUTH)
    expect(res.body.patch?.supported).toBe(true)
  })

  it('declares filter support', async () => {
    const res = await request(makeApp())
      .get('/scim/v2/ServiceProviderConfig')
      .set(AUTH)
    expect(res.body.filter?.supported).toBe(true)
    expect(res.body.filter?.maxResults).toBeGreaterThan(0)
  })

  it('declares Bearer token authentication scheme', async () => {
    const res = await request(makeApp())
      .get('/scim/v2/ServiceProviderConfig')
      .set(AUTH)
    const scheme = res.body.authenticationSchemes?.[0]
    expect(scheme?.type).toBe('oauthbearertoken')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// GET /Schemas
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /scim/v2/Schemas', () => {
  beforeEach(() => { vi.clearAllMocks(); setupDefaultMocks() })

  it('returns ListResponse with User schema', async () => {
    const res = await request(makeApp())
      .get('/scim/v2/Schemas')
      .set(AUTH)
    expect(res.status).toBe(200)
    expect(res.body.Resources?.[0]?.name).toBe('User')
    expect(res.body.Resources?.[0]?.id).toContain('core:2.0:User')
  })

  it('schema includes userName attribute marked required', async () => {
    const res = await request(makeApp())
      .get('/scim/v2/Schemas')
      .set(AUTH)
    const userNameAttr = res.body.Resources?.[0]?.attributes?.find(
      (a: Record<string,unknown>) => a.name === 'userName'
    )
    expect(userNameAttr?.required).toBe(true)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// GET /Users (list)
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /scim/v2/Users', () => {
  beforeEach(() => { vi.clearAllMocks(); setupDefaultMocks() })

  it('returns ListResponse with Resources array', async () => {
    mockTenantQuery
      .mockResolvedValueOnce({ rows: [DB_USER], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ count: '1' }], rowCount: 1 })

    const res = await request(makeApp())
      .get('/scim/v2/Users')
      .set(AUTH)

    expect(res.status).toBe(200)
    expect(res.body.schemas?.[0]).toContain('ListResponse')
    expect(res.body.totalResults).toBe(1)
    expect(res.body.Resources).toHaveLength(1)
    expect(res.body.Resources[0].userName).toBe('jane.doe@example.com')
  })

  it('formats SCIM User correctly (schema, emails, meta)', async () => {
    mockTenantQuery
      .mockResolvedValueOnce({ rows: [DB_USER], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ count: '1' }], rowCount: 1 })

    const res = await request(makeApp())
      .get('/scim/v2/Users')
      .set(AUTH)

    const user = res.body.Resources[0]
    expect(user.schemas?.[0]).toContain('core:2.0:User')
    expect(user.id).toBe('user-uuid-abc')
    expect(user.displayName).toBe('Jane Doe')
    expect(user.emails?.[0]?.value).toBe('jane.doe@example.com')
    expect(user.emails?.[0]?.primary).toBe(true)
    expect(user.active).toBe(true)
    expect(user.meta?.resourceType).toBe('User')
  })

  it('passes email filter value to tenantQuery', async () => {
    mockTenantQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ count: '0' }], rowCount: 1 })

    await request(makeApp())
      .get('/scim/v2/Users?filter=userName eq "jane.doe@example.com"')
      .set(AUTH)

    const firstCallParams: unknown[] = mockTenantQuery.mock.calls[0]?.[2] ?? []
    expect(firstCallParams).toContain('jane.doe@example.com')
  })

  it('passes active=false filter to tenantQuery', async () => {
    mockTenantQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ count: '0' }], rowCount: 1 })

    await request(makeApp())
      .get('/scim/v2/Users?filter=active eq false')
      .set(AUTH)

    const firstCallParams: unknown[] = mockTenantQuery.mock.calls[0]?.[2] ?? []
    expect(firstCallParams).toContain(false)
  })

  it('returns empty Resources array when no users match', async () => {
    mockTenantQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ count: '0' }], rowCount: 1 })

    const res = await request(makeApp())
      .get('/scim/v2/Users')
      .set(AUTH)

    expect(res.status).toBe(200)
    expect(res.body.totalResults).toBe(0)
    expect(res.body.Resources).toHaveLength(0)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// GET /Users/:id
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /scim/v2/Users/:id', () => {
  beforeEach(() => { vi.clearAllMocks(); setupDefaultMocks() })

  it('returns 200 with SCIM User object', async () => {
    mockTenantQuery.mockResolvedValue({ rows: [DB_USER], rowCount: 1 })

    const res = await request(makeApp())
      .get('/scim/v2/Users/user-uuid-abc')
      .set(AUTH)

    expect(res.status).toBe(200)
    expect(res.body.id).toBe('user-uuid-abc')
    expect(res.body.userName).toBe('jane.doe@example.com')
  })

  it('returns 404 when user not found', async () => {
    mockTenantQuery.mockResolvedValue({ rows: [], rowCount: 0 })

    const res = await request(makeApp())
      .get('/scim/v2/Users/does-not-exist')
      .set(AUTH)

    expect(res.status).toBe(404)
    expect(res.body.schemas?.[0]).toContain('Error')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// POST /Users
// ══════════════════════════════════════════════════════════════════════════════

describe('POST /scim/v2/Users', () => {
  beforeEach(() => { vi.clearAllMocks(); setupDefaultMocks() })

  it('creates user and returns 201 with SCIM User', async () => {
    mockTenantQuery
      .mockResolvedValueOnce({ rows: [{ count: '3' }], rowCount: 1 })  // count check
      .mockResolvedValueOnce({ rows: [DB_USER], rowCount: 1 })           // INSERT result

    const res = await request(makeApp())
      .post('/scim/v2/Users')
      .set(AUTH)
      .send({
        schemas:     ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName:    'jane.doe@example.com',
        displayName: 'Jane Doe',
        active:      true,
      })

    expect(res.status).toBe(201)
    expect(res.body.userName).toBe('jane.doe@example.com')
  })

  it('defaults active to true when not specified', async () => {
    mockTenantQuery
      .mockResolvedValueOnce({ rows: [{ count: '0' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [DB_USER], rowCount: 1 })

    const res = await request(makeApp())
      .post('/scim/v2/Users')
      .set(AUTH)
      .send({ userName: 'newuser@example.com' })

    expect(res.status).toBe(201)
    expect(res.body.active).toBe(true)
  })

  it('returns 400 when userName is missing', async () => {
    const res = await request(makeApp())
      .post('/scim/v2/Users')
      .set(AUTH)
      .send({ displayName: 'No Email Provided' })

    expect(res.status).toBe(400)
    expect(res.body.schemas?.[0]).toContain('Error')
  })

  it('returns 400 when userName is not a valid email', async () => {
    const res = await request(makeApp())
      .post('/scim/v2/Users')
      .set(AUTH)
      .send({ userName: 'not-an-email' })

    expect(res.status).toBe(400)
  })

  it('returns 400 when tenant is at max_users limit', async () => {
    setupDefaultMocks({ maxUsers: 5 })
    mockTenantQuery.mockResolvedValueOnce({ rows: [{ count: '5' }], rowCount: 1 })

    const res = await request(makeApp())
      .post('/scim/v2/Users')
      .set(AUTH)
      .send({ userName: 'overflow@example.com' })

    expect(res.status).toBe(400)
    expect(res.body.detail).toMatch(/limit/i)
  })

  it('returns 200 (idempotent) when user already exists (unique constraint)', async () => {
    mockTenantQuery
      .mockResolvedValueOnce({ rows: [{ count: '2' }], rowCount: 1 })          // count OK
      .mockRejectedValueOnce(Object.assign(new Error('duplicate'), { code: '23505' })) // INSERT throws 23505
      .mockResolvedValueOnce({ rows: [DB_USER], rowCount: 1 })                  // SELECT existing

    const res = await request(makeApp())
      .post('/scim/v2/Users')
      .set(AUTH)
      .send({ userName: 'jane.doe@example.com' })

    expect(res.status).toBe(200)
    expect(res.body.id).toBe('user-uuid-abc')
  })

  it('extracts userName from emails array when userName key is absent', async () => {
    mockTenantQuery
      .mockResolvedValueOnce({ rows: [{ count: '0' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [DB_USER], rowCount: 1 })

    const res = await request(makeApp())
      .post('/scim/v2/Users')
      .set(AUTH)
      .send({
        emails: [{ value: 'fromemails@example.com', primary: true }],
        displayName: 'Email Only User',
      })

    expect(res.status).toBe(201)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// PUT /Users/:id (full replace)
// ══════════════════════════════════════════════════════════════════════════════

describe('PUT /scim/v2/Users/:id', () => {
  beforeEach(() => { vi.clearAllMocks(); setupDefaultMocks() })

  it('updates user and returns 200', async () => {
    const updated = { ...DB_USER, display_name: 'Jane Updated', role: 'admin' }
    mockTenantQuery.mockResolvedValue({ rows: [updated], rowCount: 1 })

    const res = await request(makeApp())
      .put('/scim/v2/Users/user-uuid-abc')
      .set(AUTH)
      .send({
        displayName: 'Jane Updated',
        active: true,
        roles: [{ value: 'admin', display: 'admin', primary: true }],
      })

    expect(res.status).toBe(200)
    expect(res.body.displayName).toBe('Jane Updated')
  })

  it('returns 404 when user not found', async () => {
    mockTenantQuery.mockResolvedValue({ rows: [], rowCount: 0 })

    const res = await request(makeApp())
      .put('/scim/v2/Users/does-not-exist')
      .set(AUTH)
      .send({ displayName: 'Ghost' })

    expect(res.status).toBe(404)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// PATCH /Users/:id — Azure AD path-based + Okta value-object
// ══════════════════════════════════════════════════════════════════════════════

describe('PATCH /scim/v2/Users/:id', () => {
  beforeEach(() => { vi.clearAllMocks(); setupDefaultMocks() })

  // ── Azure AD pattern: { op: 'replace', path: 'active', value: false } ──────

  it('Azure AD pattern — deactivates user via path="active"', async () => {
    const deactivated = { ...DB_USER, is_active: false }
    mockTenantQuery.mockResolvedValue({ rows: [deactivated], rowCount: 1 })

    const res = await request(makeApp())
      .patch('/scim/v2/Users/user-uuid-abc')
      .set(AUTH)
      .send({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'replace', path: 'active', value: false }],
      })

    expect(res.status).toBe(200)
    expect(res.body.active).toBe(false)
  })

  it('Azure AD pattern — updates displayName via path="displayName"', async () => {
    const updated = { ...DB_USER, display_name: 'Jane Renamed' }
    mockTenantQuery.mockResolvedValue({ rows: [updated], rowCount: 1 })

    const res = await request(makeApp())
      .patch('/scim/v2/Users/user-uuid-abc')
      .set(AUTH)
      .send({
        Operations: [{ op: 'replace', path: 'displayName', value: 'Jane Renamed' }],
      })

    expect(res.status).toBe(200)
    expect(res.body.displayName).toBe('Jane Renamed')
  })

  // ── Okta pattern: { op: 'replace', value: { active: false, displayName: 'x' } }

  it('Okta pattern — deactivates user via value object', async () => {
    const deactivated = { ...DB_USER, is_active: false }
    mockTenantQuery.mockResolvedValue({ rows: [deactivated], rowCount: 1 })

    const res = await request(makeApp())
      .patch('/scim/v2/Users/user-uuid-abc')
      .set(AUTH)
      .send({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'replace', value: { active: false } }],
      })

    expect(res.status).toBe(200)
    expect(res.body.active).toBe(false)
  })

  it('Okta pattern — updates displayName via value object', async () => {
    const updated = { ...DB_USER, display_name: 'Okta Updated' }
    mockTenantQuery.mockResolvedValue({ rows: [updated], rowCount: 1 })

    const res = await request(makeApp())
      .patch('/scim/v2/Users/user-uuid-abc')
      .set(AUTH)
      .send({
        Operations: [{ op: 'replace', value: { active: true, displayName: 'Okta Updated' } }],
      })

    expect(res.status).toBe(200)
    expect(res.body.displayName).toBe('Okta Updated')
  })

  it('returns current state when Operations array is empty / no recognized ops', async () => {
    mockTenantQuery.mockResolvedValue({ rows: [DB_USER], rowCount: 1 })

    const res = await request(makeApp())
      .patch('/scim/v2/Users/user-uuid-abc')
      .set(AUTH)
      .send({ Operations: [{ op: 'replace', path: 'unknownAttribute', value: 'x' }] })

    expect(res.status).toBe(200)
    expect(res.body.id).toBe('user-uuid-abc')
  })

  it('returns 400 when Operations is missing entirely', async () => {
    const res = await request(makeApp())
      .patch('/scim/v2/Users/user-uuid-abc')
      .set(AUTH)
      .send({ notOperations: true })

    expect(res.status).toBe(400)
  })

  it('returns 404 when user not found', async () => {
    mockTenantQuery.mockResolvedValue({ rows: [], rowCount: 0 })

    const res = await request(makeApp())
      .patch('/scim/v2/Users/missing-user')
      .set(AUTH)
      .send({ Operations: [{ op: 'replace', path: 'active', value: false }] })

    expect(res.status).toBe(404)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// DELETE /Users/:id
// ══════════════════════════════════════════════════════════════════════════════

describe('DELETE /scim/v2/Users/:id', () => {
  beforeEach(() => { vi.clearAllMocks(); setupDefaultMocks() })

  it('deactivates user (soft-delete) and returns 204', async () => {
    mockTenantQuery.mockResolvedValue({
      rows: [{ id: 'user-uuid-abc', email: 'jane.doe@example.com' }],
      rowCount: 1,
    })

    const res = await request(makeApp())
      .delete('/scim/v2/Users/user-uuid-abc')
      .set(AUTH)

    expect(res.status).toBe(204)
    expect(res.text).toBe('')
  })

  it('returns 404 when user does not exist', async () => {
    mockTenantQuery.mockResolvedValue({ rows: [], rowCount: 0 })

    const res = await request(makeApp())
      .delete('/scim/v2/Users/ghost-user')
      .set(AUTH)

    expect(res.status).toBe(404)
    expect(res.body.schemas?.[0]).toContain('Error')
  })
})
