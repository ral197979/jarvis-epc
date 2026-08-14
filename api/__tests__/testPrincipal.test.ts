/**
 * ADR-014 Phase 2A §8 — the role-aware API test foundation, tested itself.
 *
 * The helper is only trustworthy if it drives the real authorization path. These
 * assert that it resolves each of the seven roles through `resolveCurrentUser`
 * and `requireCapability`, keeps every stale/inactive/missing/mismatched case
 * reachable, and refuses to invent a role when a test forgets to state one.
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
  principal, principalQuery, authMiddlewareFor, ALL_ROLES, type TestPrincipal,
} from './helpers/testPrincipal'
import { requireCapability } from '../authz/requireCapability'
import { SERVER_ROLE_CAPS } from '../authz/capabilities'

let current: TestPrincipal

beforeEach(() => {
  mockQuery.mockReset()
  mockQuery.mockImplementation(principalQuery(() => current))
})

/** A route guarded by one capability, driven through the real middleware. */
function guarded(capability: string) {
  const app = express()
  app.use(authMiddlewareFor(() => current))
  app.get('/op', requireCapability(capability as never), (_req, res) => { res.json({ ok: true }) })
  return app
}

describe('principal()', () => {
  it('refuses to build a principal without an explicit role', () => {
    // The whole point: a forgotten role must fail loudly, never elevate.
    expect(() => principal({} as never)).toThrow(/`role` is required/)
    expect(() => principal(undefined as never)).toThrow(/`role` is required/)
  })

  it('defaults the token claims to the authoritative role, not to owner', () => {
    const p = principal({ role: 'viewer' })
    expect(p.jwtRole).toBe('viewer')
    expect(p.active).toBe(true)
    expect(p.exists).toBe(true)
  })
})

describe('each of the seven roles resolves through the real authorization path', () => {
  it.each(ALL_ROLES)('resolves %s from the database, not from the token', async role => {
    current = principal({ role })
    // Pick a capability this role genuinely holds, so a pass means the helper
    // delivered the right identity rather than that the gate was permissive.
    const held = SERVER_ROLE_CAPS[role][0]
    expect((await request(guarded(held)).get('/op')).status).toBe(200)

    // And one it does not hold.
    const notHeld = role === 'owner' ? null
      : SERVER_ROLE_CAPS.owner.find(c => !SERVER_ROLE_CAPS[role].includes(c))!
    if (notHeld) {
      expect((await request(guarded(notHeld)).get('/op')).status).toBe(403)
    }
  })

  it('routes the current-user lookup through resolveCurrentUser exactly once', async () => {
    current = principal({ role: 'engineer' })
    await request(guarded('engineering.write')).get('/op')
    const lookups = mockQuery.mock.calls.filter(c =>
      c.some(a => typeof a === 'string' && /FROM\s+users\s+WHERE\s+id/i.test(a)))
    expect(lookups).toHaveLength(1)
  })
})

describe('stale and degraded principals stay reachable', () => {
  it('lets the database role govern when the token claims something higher', async () => {
    current = principal({ role: 'viewer', jwtRole: 'owner' })
    expect((await request(guarded('cost.view')).get('/op')).status).toBe(403)
  })

  it('lets the database role govern when the token claims something lower', async () => {
    current = principal({ role: 'owner', jwtRole: 'viewer' })
    expect((await request(guarded('cost.approve')).get('/op')).status).toBe(200)
  })

  it('models a deactivated account', async () => {
    current = principal({ role: 'owner', active: false })
    expect((await request(guarded('cost.view')).get('/op')).status).toBe(401)
  })

  it('models a user row that no longer exists', async () => {
    current = principal({ role: 'owner', exists: false })
    expect((await request(guarded('cost.view')).get('/op')).status).toBe(401)
  })

  it('models a tenant mismatch between the token and the stored row', async () => {
    current = principal({ role: 'owner', tenantId: 'tenant-A', jwtTenantId: 'tenant-B' })
    expect((await request(guarded('cost.view')).get('/op')).status).toBe(401)
  })
})

describe('the helper grants nothing on its own', () => {
  it('never produces an owner fallback for a low-privilege principal', async () => {
    current = principal({ role: 'viewer' })
    for (const capability of ['cost.approve', 'platform.admin', 'ai.govern', 'team.approve']) {
      expect((await request(guarded(capability)).get('/op')).status,
        `viewer must not hold ${capability}`).toBe(403)
    }
  })

  it('delegates non-authorization queries to the test-supplied handler', async () => {
    const delegate = vi.fn(async () => ({ rows: [{ id: 'row-1' }], rowCount: 1 }))
    mockQuery.mockImplementation(principalQuery(() => current, delegate))
    current = principal({ role: 'owner' })

    const app = express()
    app.use(authMiddlewareFor(() => current))
    app.get('/op', requireCapability('cost.view'), async (_req, res) => {
      const { query } = await import('../db/pool')
      const r = await query('SELECT * FROM change_orders WHERE id = $1', ['x'])
      res.json({ rows: r.rows })
    })

    const res = await request(app).get('/op')
    expect(res.status).toBe(200)
    expect(res.body.rows).toEqual([{ id: 'row-1' }])
    expect(delegate).toHaveBeenCalledTimes(1)
  })
})
