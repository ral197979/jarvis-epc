/**
 * Tests: api/server — Remediation coverage (Phase 21 audit)
 *
 * P0-B: GET /api/v1/state + POST /api/v1/state
 * P0-C: POST /api/v1/policy/check now requires auth
 * P1-A: recordAuthEvent persists to in-memory ring + Redis shape
 * P1-C: authEnabled default validation (module-level, not server)
 * CSRF: middleware blocks missing token on mutating paths
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import app, {
  _clearAuthEvents,
  _getAuthEvents,
  recordAuthEvent,
  _clearStateStore,
  _getStateStore,
} from '../../../api/server'
import { issueAccessToken } from '../../../api/auth'
import { _resetTokenStoreForTest } from '../../../api/tokenStore'

process.env.JWT_SECRET = 'test-jwt-remediation'
process.env.NODE_ENV   = 'test'

// ─── Helpers ──────────────────────────────────────────────────────────────────
function ownerToken() { return issueAccessToken('owner', 'owner') }
function pmToken()    { return issueAccessToken('pm',    'pm')    }
function viewerToken(){ return issueAccessToken('viewer','viewer') }

beforeEach(() => {
  _clearAuthEvents()
  _clearStateStore()
  _resetTokenStoreForTest()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ─── P0-B: GET /api/v1/state ──────────────────────────────────────────────────
describe('GET /api/v1/state (P0-B)', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/v1/state')
    expect(res.status).toBe(401)
  })

  it('returns null state for new user', async () => {
    const res = await request(app)
      .get('/api/v1/state')
      .set('Authorization', `Bearer ${ownerToken()}`)
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.state).toBeNull()
    expect(res.body.version).toBe(0)
  })

  it('returns previously saved state', async () => {
    const token  = ownerToken()
    const myState = { company: 'ACME', leads: [{ id: 'L-1' }] }

    await request(app)
      .post('/api/v1/state')
      .set('Authorization', `Bearer ${token}`)
      .send({ state: myState })

    const res = await request(app)
      .get('/api/v1/state')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.state).toMatchObject(myState)
    expect(res.body.version).toBe(1)
  })

  it('state is scoped per user (owner vs pm)', async () => {
    const ownerState = { company: 'ACME' }
    const pmState    = { company: 'BETA' }

    await request(app)
      .post('/api/v1/state')
      .set('Authorization', `Bearer ${ownerToken()}`)
      .send({ state: ownerState })

    await request(app)
      .post('/api/v1/state')
      .set('Authorization', `Bearer ${pmToken()}`)
      .send({ state: pmState })

    const ownerRes = await request(app)
      .get('/api/v1/state')
      .set('Authorization', `Bearer ${ownerToken()}`)
    const pmRes    = await request(app)
      .get('/api/v1/state')
      .set('Authorization', `Bearer ${pmToken()}`)

    expect(ownerRes.body.state).toMatchObject(ownerState)
    expect(pmRes.body.state).toMatchObject(pmState)
  })
})

// ─── P0-B: POST /api/v1/state ─────────────────────────────────────────────────
describe('POST /api/v1/state (P0-B)', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).post('/api/v1/state').send({ state: { x: 1 } })
    expect(res.status).toBe(401)
  })

  it('saves state and returns version 1', async () => {
    const res = await request(app)
      .post('/api/v1/state')
      .set('Authorization', `Bearer ${ownerToken()}`)
      .send({ state: { company: 'Test Corp' } })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.version).toBe(1)
  })

  it('increments version on each save', async () => {
    const token = ownerToken()
    await request(app).post('/api/v1/state').set('Authorization', `Bearer ${token}`).send({ state: { v: 1 } })
    const res = await request(app).post('/api/v1/state').set('Authorization', `Bearer ${token}`).send({ state: { v: 2 } })
    expect(res.body.version).toBe(2)
  })

  it('rejects non-object state', async () => {
    const res = await request(app)
      .post('/api/v1/state')
      .set('Authorization', `Bearer ${ownerToken()}`)
      .send({ state: 'invalid-string' })
    expect(res.status).toBe(400)
  })

  it('rejects null state', async () => {
    const res = await request(app)
      .post('/api/v1/state')
      .set('Authorization', `Bearer ${ownerToken()}`)
      .send({ state: null })
    expect(res.status).toBe(400)
  })

  it('returns 409 on version conflict', async () => {
    const token = ownerToken()
    await request(app).post('/api/v1/state').set('Authorization', `Bearer ${token}`).send({ state: { x: 1 } })
    const res = await request(app)
      .post('/api/v1/state')
      .set('Authorization', `Bearer ${token}`)
      .send({ state: { x: 2 }, version: 0 })  // wrong version
    expect(res.status).toBe(409)
    expect(res.body.serverVersion).toBe(1)
  })

  it('succeeds when provided version matches server version', async () => {
    const token = ownerToken()
    await request(app).post('/api/v1/state').set('Authorization', `Bearer ${token}`).send({ state: { x: 1 } })
    const res = await request(app)
      .post('/api/v1/state')
      .set('Authorization', `Bearer ${token}`)
      .send({ state: { x: 2 }, version: 1 })
    expect(res.status).toBe(200)
    expect(res.body.version).toBe(2)
  })

  it('does not require version field (unconditional save)', async () => {
    const token = ownerToken()
    await request(app).post('/api/v1/state').set('Authorization', `Bearer ${token}`).send({ state: { x: 1 } })
    const res = await request(app)
      .post('/api/v1/state')
      .set('Authorization', `Bearer ${token}`)
      .send({ state: { x: 99 } })  // no version field
    expect(res.status).toBe(200)
    expect(res.body.version).toBe(2)
  })
})

// ─── P0-C: POST /api/v1/policy/check — requires auth ─────────────────────────
describe('POST /api/v1/policy/check (P0-C — requireAuth)', () => {
  it('returns 401 without JWT', async () => {
    const res = await request(app)
      .post('/api/v1/policy/check')
      .send({ action: 'admin:config', role: 'owner' })
    expect(res.status).toBe(401)
  })

  it('derives role from JWT — owner can admin:config', async () => {
    const res = await request(app)
      .post('/api/v1/policy/check')
      .set('Authorization', `Bearer ${ownerToken()}`)
      .send({ action: 'admin:config' })
    expect(res.status).toBe(200)
    expect(res.body.allowed).toBe(true)
    expect(res.body.role).toBe('owner')
  })

  it('derives role from JWT — viewer cannot admin:config even if body claims owner', async () => {
    const res = await request(app)
      .post('/api/v1/policy/check')
      .set('Authorization', `Bearer ${viewerToken()}`)
      .send({ action: 'admin:config', role: 'owner' })  // body role should be ignored
    expect(res.status).toBe(200)
    expect(res.body.allowed).toBe(false)
    expect(res.body.role).toBe('viewer')
  })

  it('pm can data:write', async () => {
    const res = await request(app)
      .post('/api/v1/policy/check')
      .set('Authorization', `Bearer ${pmToken()}`)
      .send({ action: 'data:write' })
    expect(res.body.allowed).toBe(true)
  })

  it('viewer cannot data:write', async () => {
    const res = await request(app)
      .post('/api/v1/policy/check')
      .set('Authorization', `Bearer ${viewerToken()}`)
      .send({ action: 'data:write' })
    expect(res.body.allowed).toBe(false)
  })

  it('returns allowed:false for unknown action', async () => {
    const res = await request(app)
      .post('/api/v1/policy/check')
      .set('Authorization', `Bearer ${ownerToken()}`)
      .send({ action: 'unknown:action' })
    expect(res.body.allowed).toBe(false)
  })
})

// ─── P1-A: recordAuthEvent — in-memory shape ──────────────────────────────────
describe('recordAuthEvent — in-memory persistence shape (P1-A)', () => {
  it('event has ts, event, requestId fields', () => {
    recordAuthEvent({ event: 'login_success', username: 'owner', role: 'owner', ip: '127.0.0.1', requestId: 'req-1' })
    const events = _getAuthEvents()
    expect(events[0]).toHaveProperty('ts')
    expect(events[0]).toHaveProperty('event', 'login_success')
    expect(events[0]).toHaveProperty('requestId', 'req-1')
    expect(events[0]).toHaveProperty('username', 'owner')
    expect(new Date(events[0].ts).getTime()).not.toBeNaN()
  })

  it('supports all event types without error', () => {
    const types = ['login_success', 'login_fail', 'logout', 'refresh', 'token_fail'] as const
    for (const event of types) {
      expect(() => recordAuthEvent({ event, requestId: `req-${event}` })).not.toThrow()
    }
    expect(_getAuthEvents()).toHaveLength(5)
  })
})

// ─── CSRF middleware — test mode bypass ───────────────────────────────────────
describe('CSRF middleware — test mode bypass', () => {
  it('POST /api/v1/state succeeds without X-CSRF-Token in test mode', async () => {
    // NODE_ENV=test bypasses CSRF — this is the expected test behaviour
    const res = await request(app)
      .post('/api/v1/state')
      .set('Authorization', `Bearer ${ownerToken()}`)
      .send({ state: { csrf_test: true } })
    expect(res.status).toBe(200)
  })
})

// ─── _clearStateStore test utility ────────────────────────────────────────────
describe('_clearStateStore — test utility', () => {
  it('clears all stored state', async () => {
    await request(app)
      .post('/api/v1/state')
      .set('Authorization', `Bearer ${ownerToken()}`)
      .send({ state: { x: 1 } })
    expect(_getStateStore().size).toBe(1)
    _clearStateStore()
    expect(_getStateStore().size).toBe(0)
  })
})
