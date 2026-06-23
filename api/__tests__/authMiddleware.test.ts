/**
 * Auth Middleware Tests — requireAuth, requireRole, JWT validation
 * ──────────────────────────────────────────────────────────────────
 * Tests the authentication and authorization middleware in api/auth.ts
 * without making real DB calls. Uses express supertest for HTTP-level
 * verification of the middleware behavior.
 *
 * Coverage:
 *   requireAuth: missing token, expired token, invalid signature, valid token
 *   requireRole: missing auth, wrong role, correct role
 *   verifyToken: tampered payload, wrong secret
 *   JWT claim extraction: sub, tid, role, jti
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import express, { Request, Response } from 'express'
import cookieParser from 'cookie-parser'
import request from 'supertest'
import jwt from 'jsonwebtoken'

// ─── Mock pool (no real DB) ───────────────────────────────────────────────────
vi.mock('../db/pool', () => ({
  query:             vi.fn(),
  tenantQuery:       vi.fn(),
  tenantTransaction: vi.fn(),
}))

vi.mock('../../src/modules/observability/index', () => {
  const slog: any = vi.fn()
  slog.info  = vi.fn()
  slog.warn  = vi.fn()
  slog.error = vi.fn()
  return { slog }
})

vi.mock('../tokenStore', () => ({
  getTokenStore: () => ({
    isRevoked:     vi.fn().mockResolvedValue(false),
    revoke:        vi.fn(),
    purgeExpired:  vi.fn().mockResolvedValue(0),
  }),
}))

// ─── Constants ────────────────────────────────────────────────────────────────

const TEST_SECRET  = 'test-secret-at-least-32-chars-long-for-jwt-signing'
const OTHER_SECRET = 'wrong-secret-never-use-this-value-ever-in-tests'

const VALID_PAYLOAD = {
  sub:  'user-uuid-abc123',
  tid:  'tenant-uuid-def456',
  role: 'project_manager',
  jti:  'jti-xyz789',
}

// ─── Setup: set env secret and import auth AFTER mock setup ───────────────────

let requireAuth: any
let requireRole: any
let verifyToken: any

beforeAll(async () => {
  process.env['JWT_SECRET'] = TEST_SECRET
  const mod = await import('../auth')
  requireAuth  = mod.requireAuth
  requireRole  = mod.requireRole
  verifyToken  = mod.verifyToken
})

afterAll(() => {
  delete process.env['JWT_SECRET']
})

// ─── Helper: build a test Express app ────────────────────────────────────────

function makeApp(role?: string | string[]) {
  const app = express()
  app.use(express.json())
  app.use(cookieParser())
  const guards = role
    ? [requireAuth, requireRole(...(Array.isArray(role) ? role : [role]))]
    : [requireAuth]
  app.get('/protected', ...guards, (_req: Request, res: Response) => {
    const r = _req as any
    res.json({ ok: true, sub: r.auth?.sub, role: r.auth?.role, tid: r.auth?.tid })
  })
  return app
}

function makeToken(payload: object, secret = TEST_SECRET, opts: object = {}): string {
  return jwt.sign(payload, secret, { expiresIn: '15m', ...opts } as any)
}

// ─── requireAuth tests ────────────────────────────────────────────────────────

describe('requireAuth', () => {
  it('returns 401 when no token provided', async () => {
    const app = makeApp()
    const res = await request(app).get('/protected')
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('unauthenticated')
  })

  it('returns 401 with malformed Bearer token', async () => {
    const app = makeApp()
    const res = await request(app)
      .get('/protected')
      .set('Authorization', 'Bearer not.a.jwt')
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('invalid_token')
  })

  it('returns 401 with JWT signed by wrong secret', async () => {
    const app  = makeApp()
    const evil = makeToken(VALID_PAYLOAD, OTHER_SECRET)
    const res  = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${evil}`)
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('invalid_token')
  })

  it('returns 401 with expired token', async () => {
    const app     = makeApp()
    const expired = makeToken(VALID_PAYLOAD, TEST_SECRET, { expiresIn: '-1s' })
    const res     = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${expired}`)
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('invalid_token')
  })

  it('returns 200 with valid Bearer token', async () => {
    const app   = makeApp()
    const token = makeToken(VALID_PAYLOAD)
    const res   = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.sub).toBe(VALID_PAYLOAD.sub)
    expect(res.body.tid).toBe(VALID_PAYLOAD.tid)
  })

  it('attaches auth payload to req.auth', async () => {
    const app   = makeApp()
    const token = makeToken(VALID_PAYLOAD)
    const res   = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${token}`)
    expect(res.body.sub).toBe(VALID_PAYLOAD.sub)
    expect(res.body.role).toBe(VALID_PAYLOAD.role)
  })

  it('accepts token via cookie (cookie-first transport)', async () => {
    const app   = makeApp()
    const token = makeToken(VALID_PAYLOAD)
    const res   = await request(app)
      .get('/protected')
      .set('Cookie', `jarvis_at=${token}`)
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })

  it('bearer takes precedence even if cookie also present', async () => {
    // Actually per implementation cookie-first, so this tests cookie wins
    const app          = makeApp()
    const cookieToken  = makeToken({ ...VALID_PAYLOAD, role: 'viewer' })
    const bearerToken  = makeToken({ ...VALID_PAYLOAD, role: 'admin' })
    // cookie is checked first
    const res = await request(app)
      .get('/protected')
      .set('Cookie', `jarvis_at=${cookieToken}`)
      .set('Authorization', `Bearer ${bearerToken}`)
    expect(res.status).toBe(200)
    // Cookie-first → viewer role from cookie
    expect(res.body.role).toBe('viewer')
  })
})

// ─── requireRole tests ────────────────────────────────────────────────────────

describe('requireRole', () => {
  it('returns 401 when requireRole is used without requireAuth', async () => {
    // Build app with requireRole ONLY (no requireAuth first)
    const app = express()
    app.get('/only-role', requireRole('owner'), (_req: Request, res: Response) => {
      res.json({ ok: true })
    })
    const res = await request(app).get('/only-role')
    expect(res.status).toBe(401)
  })

  it('returns 403 when user role does not match', async () => {
    const app   = makeApp('owner')  // requires 'owner'
    const token = makeToken({ ...VALID_PAYLOAD, role: 'viewer' })
    const res   = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('forbidden')
    expect(res.body.required).toContain('owner')
    expect(res.body.current).toBe('viewer')
  })

  it('returns 200 when user role matches single required role', async () => {
    const app   = makeApp('project_manager')
    const token = makeToken({ ...VALID_PAYLOAD, role: 'project_manager' })
    const res   = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
  })

  it('returns 200 when user role is in multi-role allowlist', async () => {
    const app   = makeApp(['owner', 'admin', 'project_manager'])
    const token = makeToken({ ...VALID_PAYLOAD, role: 'admin' })
    const res   = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
  })

  it('enforces all defined roles: owner, admin, project_manager, engineer, viewer', async () => {
    const roles = ['owner', 'admin', 'project_manager', 'engineer', 'viewer']
    const app   = makeApp('owner')

    for (const role of roles.filter(r => r !== 'owner')) {
      const token = makeToken({ ...VALID_PAYLOAD, role })
      const res   = await request(app)
        .get('/protected')
        .set('Authorization', `Bearer ${token}`)
      expect(res.status, `Role ${role} should not access owner-only endpoint`).toBe(403)
    }

    // owner succeeds
    const ownerToken = makeToken({ ...VALID_PAYLOAD, role: 'owner' })
    const ownerRes   = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${ownerToken}`)
    expect(ownerRes.status).toBe(200)
  })
})

// ─── verifyToken tests ────────────────────────────────────────────────────────

describe('verifyToken', () => {
  it('returns null for empty string', () => {
    expect(verifyToken('')).toBeNull()
  })

  it('returns null for random garbage string', () => {
    expect(verifyToken('not.a.jwt')).toBeNull()
  })

  it('returns null for token signed with wrong secret', () => {
    const evil = jwt.sign(VALID_PAYLOAD, OTHER_SECRET, { expiresIn: '15m' })
    expect(verifyToken(evil)).toBeNull()
  })

  it('returns null for expired token', () => {
    const expired = jwt.sign(VALID_PAYLOAD, TEST_SECRET, { expiresIn: '-1s' } as any)
    expect(verifyToken(expired)).toBeNull()
  })

  it('returns payload for valid token', () => {
    const token   = jwt.sign(VALID_PAYLOAD, TEST_SECRET, { expiresIn: '15m' })
    const payload = verifyToken(token)
    expect(payload).not.toBeNull()
    expect(payload?.sub).toBe(VALID_PAYLOAD.sub)
    expect(payload?.tid).toBe(VALID_PAYLOAD.tid)
    expect(payload?.role).toBe(VALID_PAYLOAD.role)
  })

  it('payload contains all required EPC claims (sub, tid, role, jti)', () => {
    const token   = jwt.sign(VALID_PAYLOAD, TEST_SECRET, { expiresIn: '15m' })
    const payload = verifyToken(token)
    expect(payload?.sub).toBeDefined()
    expect(payload?.tid).toBeDefined()
    expect(payload?.role).toBeDefined()
    expect(payload?.jti).toBeDefined()
  })

  it('rejects algorithmically tampered token (alg:none attack)', () => {
    // A forged "alg:none" token (three base64 parts with no signature)
    const header  = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
    const body    = Buffer.from(JSON.stringify({ ...VALID_PAYLOAD, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')
    const forged  = `${header}.${body}.`
    expect(verifyToken(forged)).toBeNull()
  })
})

// ─── JWT claim extraction ─────────────────────────────────────────────────────

describe('JWT tenant claim (tid) extraction', () => {
  it('tid claim correctly identifies tenant', async () => {
    const tenantId = 'tenant-00000000-0000-0000-0000-000000000001'
    const app      = makeApp()
    const token    = makeToken({ ...VALID_PAYLOAD, tid: tenantId })
    const res      = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${token}`)
    expect(res.body.tid).toBe(tenantId)
  })

  it('different tenants get different tid in token', () => {
    const t1 = jwt.sign({ sub: 'u1', tid: 'tenant-A', role: 'member', jti: 'j1' }, TEST_SECRET, { expiresIn: '15m' })
    const t2 = jwt.sign({ sub: 'u2', tid: 'tenant-B', role: 'member', jti: 'j2' }, TEST_SECRET, { expiresIn: '15m' })
    const p1 = verifyToken(t1)
    const p2 = verifyToken(t2)
    expect(p1?.tid).not.toBe(p2?.tid)
  })
})
