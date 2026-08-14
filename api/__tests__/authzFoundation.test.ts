/**
 * ADR-014 Phase 2 — the server authorization foundation.
 *
 * Covers the capability registry, Phase 1 parity, current-role re-resolution
 * (the JWT staleness closure), and `requireCapability`'s fail-closed contract.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

const mockQuery = vi.fn()
vi.mock('../db/pool', () => ({
  query:             (...a: unknown[]) => mockQuery(...a),
  tenantQuery:       (...a: unknown[]) => mockQuery(...a),
  tenantTransaction: vi.fn(),
}))

import {
  SERVER_ROLE_CAPS, SERVER_CAPABILITIES, ACTION_CAPABILITIES, USER_ROLES,
  roleHasCapability, isServerCapability, isUserRole,
} from '../authz/capabilities'
import { requireCapability, requireAnyCapability } from '../authz/requireCapability'
import { resolveCurrentUser, type AuthorizedRequest } from '../authz/currentUser'
import { ROLE_CAPS as CLIENT_ROLE_CAPS } from '../../src/config/capabilities'

/** An app whose only auth state is what the test injects — no real JWT needed. */
function appWithRole(capability: string, auth: Record<string, unknown> | undefined) {
  const app = express()
  app.use((req, _res, next) => { (req as AuthorizedRequest).auth = auth as never; next() })
  app.get('/guarded', requireCapability(capability as never), (_req, res) => { res.json({ ok: true }) })
  return app
}

/** Script the current-user lookup `resolveCurrentUser` performs. */
function dbUser(row: Record<string, unknown> | null) {
  mockQuery.mockResolvedValue({ rows: row ? [row] : [], rowCount: row ? 1 : 0 })
}

beforeEach(() => { mockQuery.mockReset() })

// ─── Registry ─────────────────────────────────────────────────────────────────
describe('server capability registry', () => {
  it('is keyed on exactly the seven database roles', () => {
    expect(Object.keys(SERVER_ROLE_CAPS).sort()).toEqual([...USER_ROLES].sort())
    expect(USER_ROLES).toHaveLength(7)
  })

  it('preserves Phase 1 view authority exactly — the two models cannot drift', () => {
    // ADR-014 §10: server action capabilities may extend beyond the client, but
    // the two must never disagree about who may *see* a domain.
    for (const role of USER_ROLES) {
      // Everything that is not a server-only action capability is view authority.
      const actions = new Set<string>(ACTION_CAPABILITIES)
      const serverViews = SERVER_ROLE_CAPS[role].filter(c => !actions.has(c))
      const clientViews = [...CLIENT_ROLE_CAPS[role]]
      expect([...serverViews].sort(), `${role} view grants diverged from Phase 1`).toEqual(clientViews.sort())
    }
  })

  it('grants owner every capability and viewer no action capability', () => {
    expect([...SERVER_ROLE_CAPS.owner].sort()).toEqual([...SERVER_CAPABILITIES].sort())
    const viewerActions = SERVER_ROLE_CAPS.viewer.filter(c => (ACTION_CAPABILITIES as readonly string[]).includes(c))
    expect(viewerActions, 'ADR-014 D3: viewer is read-only').toEqual([])
  })

  it('keeps Platform Administrator out of business authority (D2)', () => {
    for (const cap of SERVER_ROLE_CAPS.admin) {
      expect(cap.startsWith('platform.') || cap === 'audit.view', `admin holds ${cap}`).toBe(true)
    }
    for (const cap of ['cost.view', 'cost.approve', 'portfolio.view', 'project.view',
                       'engineering.write', 'procurement.approve', 'crm.view', 'construction.write']) {
      expect(roleHasCapability('admin', cap), `admin must not hold ${cap}`).toBe(false)
    }
  })

  it('never lets a view capability imply an action (D5)', () => {
    // Every role that can see cost must still be denied cost approval unless
    // explicitly granted it.
    for (const role of USER_ROLES) {
      if (role === 'owner') continue
      if (roleHasCapability(role, 'cost.view')) {
        expect(roleHasCapability(role, 'cost.approve'), `${role} escalated cost.view to cost.approve`).toBe(false)
      }
    }
  })

  it('fails closed on unknown roles and unknown capabilities (D6)', () => {
    expect(roleHasCapability('superadmin', 'cost.view')).toBe(false)
    expect(roleHasCapability(undefined, 'cost.view')).toBe(false)
    expect(roleHasCapability(null, 'cost.view')).toBe(false)
    expect(roleHasCapability('owner', 'cost.nonexistent')).toBe(false)
    expect(roleHasCapability('owner', undefined)).toBe(false)
    expect(isServerCapability('constructor')).toBe(false)
    expect(isServerCapability('__proto__')).toBe(false)
    expect(isUserRole('pm')).toBe(false)
  })

  it('rejects an unregistered capability at registration, not at request time', () => {
    expect(() => requireCapability('not.a.capability' as never)).toThrow(/unknown capability/)
    expect(() => requireAnyCapability('cost.view', 'nope.nope' as never)).toThrow(/unknown capability/)
  })
})

// ─── Current-role re-resolution (§7) ─────────────────────────────────────────
describe('current role is re-resolved from the database', () => {
  it('authorizes on the CURRENT role, not the role embedded in the token', async () => {
    // The staleness scenario: token was issued while the user was an owner, the
    // database now says viewer. The demotion must take effect immediately.
    dbUser({ id: 'u1', tenant_id: 't1', role: 'viewer', is_active: true })
    const res = await request(appWithRole('cost.view', { sub: 'u1', tid: 't1', role: 'owner' })).get('/guarded')
    expect(res.status).toBe(403)
    expect(res.body).toEqual({ error: 'forbidden' })
  })

  it('grants on a current role even when the token claims something lesser', async () => {
    dbUser({ id: 'u1', tenant_id: 't1', role: 'owner', is_active: true })
    const res = await request(appWithRole('cost.approve', { sub: 'u1', tid: 't1', role: 'viewer' })).get('/guarded')
    expect(res.status).toBe(200)
  })

  it('denies a deactivated account holding a still-valid token', async () => {
    dbUser({ id: 'u1', tenant_id: 't1', role: 'owner', is_active: false })
    const res = await request(appWithRole('cost.view', { sub: 'u1', tid: 't1', role: 'owner' })).get('/guarded')
    expect(res.status).toBe(401)
  })

  it('denies a user row that no longer exists', async () => {
    dbUser(null)
    const res = await request(appWithRole('cost.view', { sub: 'gone', tid: 't1', role: 'owner' })).get('/guarded')
    expect(res.status).toBe(401)
  })

  it('denies an unrecognised role stored in the database', async () => {
    dbUser({ id: 'u1', tenant_id: 't1', role: 'superadmin', is_active: true })
    const res = await request(appWithRole('cost.view', { sub: 'u1', tid: 't1', role: 'owner' })).get('/guarded')
    expect(res.status).toBe(401)
  })

  it('denies when the token tenant and the stored tenant disagree', async () => {
    dbUser({ id: 'u1', tenant_id: 'tenant-B', role: 'owner', is_active: true })
    const res = await request(appWithRole('cost.view', { sub: 'u1', tid: 'tenant-A', role: 'owner' })).get('/guarded')
    expect(res.status).toBe(401)
  })

  it('denies when the lookup itself fails — an error is never a grant', async () => {
    mockQuery.mockRejectedValue(new Error('connection lost'))
    const res = await request(appWithRole('cost.view', { sub: 'u1', tid: 't1', role: 'owner' })).get('/guarded')
    expect(res.status).toBe(401)
  })

  it('denies an unauthenticated request outright', async () => {
    dbUser({ id: 'u1', tenant_id: 't1', role: 'owner', is_active: true })
    const res = await request(appWithRole('cost.view', undefined)).get('/guarded')
    expect(res.status).toBe(401)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('resolves the role at most once per request (§39: no N+1)', async () => {
    dbUser({ id: 'u1', tenant_id: 't1', role: 'owner', is_active: true })
    const app = express()
    app.use((req, _res, next) => { (req as AuthorizedRequest).auth = { sub: 'u1', tid: 't1', role: 'owner' } as never; next() })
    // Three capability gates on one route — a naive implementation would query thrice.
    app.get('/triple',
      requireCapability('cost.view'),
      requireCapability('cost.write'),
      requireCapability('cost.approve'),
      (_req, res) => { res.json({ ok: true }) })

    const res = await request(app).get('/triple')
    expect(res.status).toBe(200)
    expect(mockQuery).toHaveBeenCalledTimes(1)
  })

  it('does not retry a failed resolution on subsequent gates in the same request', async () => {
    dbUser(null)
    const app = express()
    app.use((req, _res, next) => { (req as AuthorizedRequest).auth = { sub: 'u1', tid: 't1' } as never; next() })
    app.get('/double', requireCapability('cost.view'), requireCapability('cost.write'), (_req, res) => { res.json({ ok: true }) })

    const res = await request(app).get('/double')
    expect(res.status).toBe(401)
    expect(mockQuery).toHaveBeenCalledTimes(1)
  })

  it('never reads a client-supplied role (D4)', async () => {
    dbUser({ id: 'u1', tenant_id: 't1', role: 'viewer', is_active: true })
    const app = express()
    app.use(express.json())
    app.use((req, _res, next) => { (req as AuthorizedRequest).auth = { sub: 'u1', tid: 't1', role: 'viewer' } as never; next() })
    app.post('/guarded', requireCapability('platform.admin'), (_req, res) => { res.json({ ok: true }) })

    const res = await request(app)
      .post('/guarded?role=owner')
      .set('x-role', 'owner')
      .set('x-effective-role', 'owner')
      .send({ role: 'owner', activeRole: 'owner', currentUser: { role: 'owner' } })

    expect(res.status).toBe(403)
  })
})

// ─── requireAnyCapability ────────────────────────────────────────────────────
describe('requireAnyCapability', () => {
  it('admits a caller holding either capability and denies one holding neither', async () => {
    const build = () => {
      const app = express()
      app.use((req, _res, next) => { (req as AuthorizedRequest).auth = { sub: 'u1', tid: 't1' } as never; next() })
      app.get('/either', requireAnyCapability('platform.admin', 'ai.govern'), (_req, res) => { res.json({ ok: true }) })
      return app
    }
    dbUser({ id: 'u1', tenant_id: 't1', role: 'admin', is_active: true })
    expect((await request(build()).get('/either')).status).toBe(200)

    mockQuery.mockReset()
    dbUser({ id: 'u1', tenant_id: 't1', role: 'field_ops', is_active: true })
    expect((await request(build()).get('/either')).status).toBe(403)
  })
})

// ─── resolveCurrentUser used directly ────────────────────────────────────────
describe('resolveCurrentUser', () => {
  it('memoises the result on the request', async () => {
    dbUser({ id: 'u1', tenant_id: 't1', role: 'engineer', is_active: true })
    const req = { auth: { sub: 'u1', tid: 't1' } } as unknown as AuthorizedRequest
    const first  = await resolveCurrentUser(req)
    const second = await resolveCurrentUser(req)
    expect(first).toEqual({ id: 'u1', tenantId: 't1', role: 'engineer' })
    expect(second).toBe(first)
    expect(mockQuery).toHaveBeenCalledTimes(1)
  })
})
