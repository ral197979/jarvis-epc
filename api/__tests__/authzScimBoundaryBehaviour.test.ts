/**
 * ADR-014 Phase 2C-5 §10 — the SCIM provisioning boundary, exercised.
 *
 * Real `scimRouter`, real `requireScimToken`, real handlers. Nothing injects a
 * tenant onto the request: every request carries only an `Authorization` header,
 * and the tenant the handlers use is whatever `requireScimToken` resolved from
 * the token row. That is the property under test — a SCIM credential must select
 * its own tenant, and nothing the caller sends may change it.
 *
 * The fixture models two tenants, each with a live credential, plus a revoked
 * credential and an expired one:
 *
 *   TENANT_A   token "tok-a"        user USER_A
 *   TENANT_B   token "tok-b"        user USER_B
 *              token "tok-revoked"  is_active = false
 *              token "tok-expired"  expires_at in the past
 *
 * Every refusal additionally asserts that no write reached the database.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { createHash } from 'node:crypto'

const mockQuery       = vi.fn()
const mockTenantQuery = vi.fn()
vi.mock('../db/pool', () => ({
  query:             (...a: unknown[]) => mockQuery(...a),
  tenantQuery:       (...a: unknown[]) => mockTenantQuery(...a),
  tenantTransaction: async (_t: string, fn: (c: unknown) => unknown) =>
    fn({ query: (...a: unknown[]) => mockTenantQuery(...a) }),
  pool:              { query: (...a: unknown[]) => mockQuery(...a), connect: vi.fn() },
}))
// bcrypt at 12 rounds is ~300ms per call and proves nothing here.
vi.mock('bcrypt', () => ({ default: { hash: vi.fn(async () => '$2b$12$stub') } }))

import { scimRouter } from '../routes/scim'

const TENANT_A = 'tenant-aaaa'
const TENANT_B = 'tenant-bbbb'
const USER_A   = 'user-in-tenant-a'
const USER_B   = 'user-in-tenant-b'

const sha = (t: string) => createHash('sha256').update(t).digest('hex')

/** token → the row `requireScimToken` would find, or undefined for "no row". */
const TOKENS: Record<string, { id: string; tenant_id: string } | undefined> = {
  [sha('tok-a')]: { id: 'tk-a', tenant_id: TENANT_A },
  [sha('tok-b')]: { id: 'tk-b', tenant_id: TENANT_B },
  // Revoked and expired tokens are filtered out by the SQL predicate, so the
  // store models them the way the database would: no row comes back.
  [sha('tok-revoked')]: undefined,
  [sha('tok-expired')]: undefined,
}

/** Identities, by tenant. A tenant only ever sees its own. */
const USERS: Record<string, Array<Record<string, unknown>>> = {
  [TENANT_A]: [{ id: USER_A, email: 'a@x.com', display_name: 'A', role: 'viewer', is_active: true, created_at: '2026-01-01', updated_at: '2026-01-01' }],
  [TENANT_B]: [{ id: USER_B, email: 'b@x.com', display_name: 'B', role: 'viewer', is_active: true, created_at: '2026-01-01', updated_at: '2026-01-01' }],
}

const makeApp = () => {
  const app = express()
  app.use(express.json())
  app.use('/scim/v2', scimRouter as never)
  return app
}

/** Writes the handlers attempted, so a refusal can be proved inert. */
const writes = () => mockTenantQuery.mock.calls
  .map(c => String(c[1] ?? ''))
  .filter(s => /\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i.test(s))

/** Every tenant id the handlers scoped a query to. */
const tenantsUsed = () => [...new Set(mockTenantQuery.mock.calls.map(c => String(c[0])))]

beforeEach(() => {
  mockQuery.mockReset()
  mockTenantQuery.mockReset()

  mockQuery.mockImplementation(async (sql: string, params: unknown[]) => {
    if (/FROM scim_tokens/i.test(sql)) {
      const row = TOKENS[String(params?.[0])]
      return { rows: row ? [row] : [] }
    }
    if (/FROM tenants/i.test(sql)) return { rows: [{ max_users: 50 }] }
    return { rows: [] }
  })

  mockTenantQuery.mockImplementation(async (tenantId: string, sql: string, params: unknown[]) => {
    const rows = USERS[tenantId] ?? []
    if (/COUNT\(\*\)/i.test(sql)) return { rows: [{ count: String(rows.length) }] }
    if (/^\s*INSERT INTO users/im.test(sql)) {
      return { rows: [{ id: 'new-user', email: params[0], display_name: params[1], role: params[2], is_active: params[4], created_at: 'now', updated_at: 'now' }] }
    }
    if (/^\s*UPDATE users SET/im.test(sql)) {
      // The predicate is `id=$n AND tenant_id=current_setting(...)`, so a target
      // outside this tenant updates zero rows — modelled here as no RETURNING row.
      const targetId = params[params.length - 1]
      const hit = rows.find(r => r['id'] === targetId)
      return { rows: hit ? [{ ...hit, is_active: false }] : [] }
    }
    if (/FROM users/i.test(sql)) {
      // GET /Users/:id passes the id first.
      if (/WHERE id=\$1/i.test(sql)) {
        const hit = rows.find(r => r['id'] === params?.[0])
        return { rows: hit ? [hit] : [] }
      }
      // GET /Users builds `u.email=$1` / `u.is_active=$n` from the SCIM filter,
      // ANDed with the tenant predicate. Apply them here too, or the isolation
      // assertion would pass for the wrong reason.
      let out = rows
      if (/u\.email=\$/.test(sql))     out = out.filter(r => r['email'] === params?.[0])
      if (/u\.is_active=\$/.test(sql)) out = out.filter(r => r['is_active'] === params?.[params.length - 1])
      return { rows: out }
    }
    return { rows: [] }
  })
})

// ─── 1. Credential required, and fails closed ─────────────────────────────────
describe('the SCIM credential is required and fails closed', () => {
  const PROTECTED: Array<[string, () => request.Test]> = [
    ['GET  /ServiceProviderConfig', () => request(makeApp()).get('/scim/v2/ServiceProviderConfig')],
    ['GET  /Schemas',               () => request(makeApp()).get('/scim/v2/Schemas')],
    ['GET  /Users',                 () => request(makeApp()).get('/scim/v2/Users')],
    ['GET  /Users/:id',             () => request(makeApp()).get(`/scim/v2/Users/${USER_A}`)],
    ['POST /Users',                 () => request(makeApp()).post('/scim/v2/Users').send({ userName: 'x@y.com' })],
    ['PUT  /Users/:id',             () => request(makeApp()).put(`/scim/v2/Users/${USER_A}`).send({ displayName: 'X' })],
    ['PATCH /Users/:id',            () => request(makeApp()).patch(`/scim/v2/Users/${USER_A}`).send({ Operations: [{ op: 'replace', path: 'active', value: false }] })],
    ['DELETE /Users/:id',           () => request(makeApp()).delete(`/scim/v2/Users/${USER_A}`)],
  ]

  it.each(PROTECTED)('%s refuses a missing credential', async (_label, send) => {
    const res = await send()
    expect(res.status).toBe(401)
    expect(writes(), 'a refused request must write nothing').toEqual([])
  })

  it.each(PROTECTED)('%s refuses an unknown credential', async (_label, send) => {
    const res = await send().set('Authorization', 'Bearer not-a-real-token')
    expect(res.status).toBe(401)
    expect(writes()).toEqual([])
  })

  it.each(PROTECTED)('%s refuses a revoked credential', async (_label, send) => {
    const res = await send().set('Authorization', 'Bearer tok-revoked')
    expect(res.status).toBe(401)
    expect(writes()).toEqual([])
  })

  it.each(PROTECTED)('%s refuses an expired credential', async (_label, send) => {
    const res = await send().set('Authorization', 'Bearer tok-expired')
    expect(res.status).toBe(401)
    expect(writes()).toEqual([])
  })

  it('refuses a non-Bearer scheme and advertises the challenge', async () => {
    const res = await request(makeApp()).get('/scim/v2/Users').set('Authorization', 'Basic abc')
    expect(res.status).toBe(401)
    expect(res.headers['www-authenticate']).toMatch(/Bearer/)
  })

  it('refuses an ordinary user session — a JWT is not a provisioning credential', async () => {
    // The point of §10: holding any tenant role, viewer included, provisions
    // nothing. There is no session path into /scim/v2 at all.
    const res = await request(makeApp())
      .post('/scim/v2/Users')
      .set('Authorization', 'Bearer eyJhbGciOiJIUzI1NiJ9.fake.jwt')
      .send({ userName: 'intruder@x.com' })
    expect(res.status).toBe(401)
    expect(writes()).toEqual([])
  })
})

// ─── 2. A valid credential reads its own tenant ───────────────────────────────
describe('a valid credential reads exactly its own tenant', () => {
  it('admits discovery endpoints', async () => {
    const cfg = await request(makeApp()).get('/scim/v2/ServiceProviderConfig').set('Authorization', 'Bearer tok-a')
    expect(cfg.status).toBe(200)
    expect(cfg.body.schemas[0]).toMatch(/ServiceProviderConfig/)

    const sch = await request(makeApp()).get('/scim/v2/Schemas').set('Authorization', 'Bearer tok-a')
    expect(sch.status).toBe(200)
  })

  it('lists only the credential tenant, scoped by the token row', async () => {
    const res = await request(makeApp()).get('/scim/v2/Users').set('Authorization', 'Bearer tok-a')
    expect(res.status).toBe(200)
    expect(res.body.Resources.map((r: { id: string }) => r.id)).toEqual([USER_A])
    expect(tenantsUsed(), 'queries must be scoped to the credential tenant').toEqual([TENANT_A])
  })

  it('reads one identity in its own tenant', async () => {
    const res = await request(makeApp()).get(`/scim/v2/Users/${USER_A}`).set('Authorization', 'Bearer tok-a')
    expect(res.status).toBe(200)
    expect(res.body.id).toBe(USER_A)
  })
})

// ─── 3. Cross-tenant isolation (§10, §32) ─────────────────────────────────────
describe('a credential cannot reach another tenant', () => {
  it('does not disclose that a foreign identity exists', async () => {
    const res = await request(makeApp()).get(`/scim/v2/Users/${USER_B}`).set('Authorization', 'Bearer tok-a')
    expect(res.status, 'a foreign target is indistinguishable from a missing one').toBe(404)
    expect(res.body.detail).toBe('User not found')
    expect(tenantsUsed()).toEqual([TENANT_A])
  })

  it('answers the same 404 for an id that exists nowhere', async () => {
    const res = await request(makeApp()).get('/scim/v2/Users/no-such-user').set('Authorization', 'Bearer tok-a')
    expect(res.status).toBe(404)
    expect(res.body.detail, 'the two cases must be indistinguishable').toBe('User not found')
  })

  const MUTATIONS: Array<[string, () => request.Test]> = [
    ['PUT',    () => request(makeApp()).put(`/scim/v2/Users/${USER_B}`).send({ displayName: 'seized' })],
    ['PATCH',  () => request(makeApp()).patch(`/scim/v2/Users/${USER_B}`).send({ Operations: [{ op: 'replace', path: 'active', value: false }] })],
    ['DELETE', () => request(makeApp()).delete(`/scim/v2/Users/${USER_B}`)],
  ]

  it.each(MUTATIONS)('%s cannot change a foreign identity', async (_m, send) => {
    const res = await send().set('Authorization', 'Bearer tok-a')
    expect(res.status).toBe(404)
    // The statement ran, but under tenant A's scope, so it matched no row.
    expect(tenantsUsed(), 'the write was scoped to the credential tenant').toEqual([TENANT_A])
    expect(USERS[TENANT_B][0]['is_active'], 'tenant B state is unchanged').toBe(true)
  })

  it('ignores a tenant id supplied by the caller', async () => {
    // Nothing in the body or query may select a tenant. The credential does.
    const res = await request(makeApp())
      .get('/scim/v2/Users?tenantId=' + TENANT_B)
      .set('Authorization', 'Bearer tok-a')
    expect(res.status).toBe(200)
    expect(res.body.Resources.map((r: { id: string }) => r.id)).toEqual([USER_A])
    expect(tenantsUsed()).toEqual([TENANT_A])
  })

  it('cannot escape tenant scope through the SCIM filter', async () => {
    const res = await request(makeApp())
      .get(`/scim/v2/Users?filter=${encodeURIComponent('userName eq "b@x.com"')}`)
      .set('Authorization', 'Bearer tok-a')
    expect(res.status).toBe(200)
    expect(res.body.Resources, 'a filter naming a foreign user returns nothing').toEqual([])
    expect(tenantsUsed()).toEqual([TENANT_A])
  })
})

// ─── 4. Identity-lifecycle authority is bounded (ADR-014 D7) ──────────────────
describe('provisioning cannot escalate privilege', () => {
  it('creates a user in the credential tenant', async () => {
    const res = await request(makeApp()).post('/scim/v2/Users')
      .set('Authorization', 'Bearer tok-a')
      .send({ userName: 'new@x.com', roles: [{ value: 'engineer' }] })
    expect(res.status).toBe(201)
    expect(tenantsUsed()).toEqual([TENANT_A])
  })

  it('refuses to provision the owner role', async () => {
    const res = await request(makeApp()).post('/scim/v2/Users')
      .set('Authorization', 'Bearer tok-a')
      .send({ userName: 'esc@x.com', roles: [{ value: 'owner' }] })
    expect(res.status).toBe(400)
    expect(res.body.detail).toMatch(/owner/)
    expect(writes(), 'no user row may be created by a refused request').toEqual([])
  })

  it('refuses to promote an existing user to owner through PUT', async () => {
    const res = await request(makeApp()).put(`/scim/v2/Users/${USER_A}`)
      .set('Authorization', 'Bearer tok-a')
      .send({ displayName: 'A', roles: [{ value: 'owner' }] })
    expect(res.status).toBe(400)
    expect(writes()).toEqual([])
  })

  it('refuses the whole PatchOp when it names owner, applying nothing', async () => {
    const res = await request(makeApp()).patch(`/scim/v2/Users/${USER_A}`)
      .set('Authorization', 'Bearer tok-a')
      .send({ Operations: [
        { op: 'replace', path: 'displayName', value: 'Renamed' },
        { op: 'replace', path: 'roles', value: [{ value: 'owner' }] },
      ] })
    expect(res.status).toBe(400)
    expect(writes(), 'the display-name half must not be applied either').toEqual([])
  })

  it('refuses a role outside the registry', async () => {
    const res = await request(makeApp()).post('/scim/v2/Users')
      .set('Authorization', 'Bearer tok-a')
      .send({ userName: 'x@x.com', roles: [{ value: 'superuser' }] })
    expect(res.status).toBe(400)
    expect(res.body.detail).toMatch(/unknown role/)
    expect(writes()).toEqual([])
  })

  it('deactivates rather than deleting, in its own tenant only', async () => {
    const res = await request(makeApp()).delete(`/scim/v2/Users/${USER_A}`)
      .set('Authorization', 'Bearer tok-a')
    expect(res.status).toBe(204)
    expect(writes().join('\n'), 'SCIM deprovisioning is a soft deactivate')
      .toMatch(/UPDATE users SET is_active=false/)
    expect(writes().join('\n')).not.toMatch(/DELETE FROM users/)
  })
})
