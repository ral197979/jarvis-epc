/**
 * Tests: api/routes/novaIntegrationStatus.ts
 *
 * Tenant-authed Nova panel read API + manual retry. Pool fully mocked
 * (novaCommands.test.ts style); auth/tenant middleware mocked with a mutable
 * identity (changeOrdersAuthz.test.ts style) so role paths can be exercised.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const h = vi.hoisted(() => ({
  identity: {} as { sub?: string; role?: string },
  tenantId: '11111111-1111-1111-1111-111111111111',
}))

const mockTenantQuery = vi.fn()
// ADR-014 Phase 2A: authorization re-resolves the caller's role from the
// database, so the pool answers that lookup using the identity under test.
vi.mock('../db/pool', () => ({
  query: async (sql: string) =>
    /FROM\s+users\s+WHERE\s+id/i.test(String(sql))
      ? { rows: [{ id: h.identity.sub ?? 'u1', tenant_id: h.tenantId, role: h.identity.role, is_active: true }], rowCount: 1 }
      : { rows: [], rowCount: 0 },
  tenantQuery: (...a: unknown[]) => mockTenantQuery(...a),
  pool: { connect: vi.fn() },
}))
vi.mock('../auth', () => ({
  requireAuth: (req: { auth?: unknown }, _res: unknown, next: () => void) => { req.auth = h.identity; next() },
}))
vi.mock('../middleware/tenant', () => ({
  requireTenant: () => (req: { tenantId?: string }, _res: unknown, next: () => void) => { req.tenantId = h.tenantId; next() },
}))

import express from 'express'
import request from 'supertest'
import { novaIntegrationStatusRouter, composeNovaUrl, deliveryHealth } from '../routes/novaIntegrationStatus'

const PROJECT_ID = 'dddddddd-0000-0000-0000-000000000009'

const LINK_ROW = {
  nova_project_id:     'nova-p-9',
  nova_project_number: 'NV-2026-014',
  nova_project_url:    '/projects/nova-p-9',
  nova_customer_name:  'Aurora Midstream LLC',
  contract_number:     'CN-88231',
  connection_id:       'conn-1',
  commercial_pm:       null,
  created_at:          new Date('2026-07-20T12:00:00Z'),
  last_event_at:       new Date('2026-07-20T12:30:00Z'),
}

const CONN_ROW = {
  connection_id:  'conn-1',
  nova_tenant_id: 'nova-t-1',
  nova_base_url:  'https://nova.example.com',
  status:         'connected',
}

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1', novaIntegrationStatusRouter)
  return app
}

/** Script the GET's four tenantQuery calls from row fixtures. */
function scriptGet(opts: {
  link?: Record<string, unknown> | null
  connection?: Record<string, unknown> | null
  counts?: { queued: string; retrying: string; dead: string }
  lastDelivered?: Record<string, unknown> | null
} = {}) {
  const link       = opts.link === undefined ? LINK_ROW : opts.link
  const connection = opts.connection === undefined ? CONN_ROW : opts.connection
  const counts     = opts.counts ?? { queued: '0', retrying: '0', dead: '0' }
  const last       = opts.lastDelivered === undefined
    ? { event_type: 'denver.project.created', delivered_at: new Date('2026-07-20T12:05:00Z') }
    : opts.lastDelivered
  mockTenantQuery.mockImplementation((_tenant: string, sql: string) => {
    if (sql.includes('FROM nova_project_links')) return Promise.resolve({ rows: link ? [link] : [] })
    if (sql.includes('FROM nova_connections'))   return Promise.resolve({ rows: connection ? [connection] : [] })
    if (sql.includes('FILTER'))                  return Promise.resolve({ rows: [counts] })
    if (sql.includes("status = 'delivered'"))    return Promise.resolve({ rows: last ? [last] : [] })
    return Promise.resolve({ rows: [] })
  })
}

beforeEach(() => {
  mockTenantQuery.mockReset()
  h.identity = { sub: 'user-1', role: 'engineer' }
})
afterEach(() => {
  delete process.env['NOVA_PUBLIC_URL']
})

// ─── GET /projects/:id/nova-integration ───────────────────────────────────────

describe('GET /api/v1/projects/:id/nova-integration', () => {
  it('returns linked:false when the project has no Nova link', async () => {
    scriptGet({ link: null })
    const res = await request(makeApp()).get(`/api/v1/projects/${PROJECT_ID}/nova-integration`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ linked: false })
  })

  it('returns the link, connection, delivery health, and composed Nova URL', async () => {
    scriptGet({ counts: { queued: '1', retrying: '0', dead: '0' } })
    const res = await request(makeApp()).get(`/api/v1/projects/${PROJECT_ID}/nova-integration`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      linked: true,
      link: {
        novaProjectId:     'nova-p-9',
        novaProjectNumber: 'NV-2026-014',
        novaCustomerName:  'Aurora Midstream LLC',
        contractNumber:    'CN-88231',
        commercialPm:      null,
        linkedAt:          '2026-07-20T12:00:00.000Z',
        lastEventAt:       '2026-07-20T12:30:00.000Z',
      },
      connection: { connectionId: 'conn-1', novaTenantId: 'nova-t-1', status: 'connected' },
      health: 'pending',
      delivery: {
        queuedCount: 1,
        failedCount: 0,
        deadCount:   0,
        lastDeliveredAt:        '2026-07-20T12:05:00.000Z',
        lastDeliveredEventType: 'denver.project.created',
      },
      openInNovaUrl: 'https://nova.example.com/projects/nova-p-9',
    })
    // Every query ran with the middleware-resolved tenant.
    for (const call of mockTenantQuery.mock.calls) expect(call[0]).toBe(h.tenantId)
  })

  it('never returns a contract value or commercial summary in any payload', async () => {
    scriptGet()
    const res = await request(makeApp()).get(`/api/v1/projects/${PROJECT_ID}/nova-integration`)
    expect(res.status).toBe(200)
    const serialized = JSON.stringify(res.body).toLowerCase()
    expect(serialized).not.toContain('contractvalue')
    expect(serialized).not.toContain('contract_value')
    expect(serialized).not.toContain('commercialsummary')
    expect(serialized).not.toContain('metadata')
    // The SELECT itself only extracts the commercialPm key, never the blob.
    const linkSql = String(mockTenantQuery.mock.calls.find(c => String(c[1]).includes('FROM nova_project_links'))![1])
    expect(linkSql).not.toContain('metadata,')
    expect(linkSql).toContain("metadata->'nova'->>'commercialPm'")
  })

  it('reports health failed (never healthy) when dead deliveries exist', async () => {
    scriptGet({ counts: { queued: '0', retrying: '0', dead: '2' } })
    const res = await request(makeApp()).get(`/api/v1/projects/${PROJECT_ID}/nova-integration`)
    expect(res.status).toBe(200)
    expect(res.body.health).toBe('failed')
    expect(res.body.delivery.deadCount).toBe(2)
  })

  it('reports health degraded when deliveries are retrying', async () => {
    scriptGet({ counts: { queued: '0', retrying: '3', dead: '0' } })
    const res = await request(makeApp()).get(`/api/v1/projects/${PROJECT_ID}/nova-integration`)
    expect(res.body.health).toBe('degraded')
    expect(res.body.delivery.failedCount).toBe(3)
  })

  it('reports health disconnected when the connection row is missing or not connected', async () => {
    scriptGet({ connection: null })
    const res = await request(makeApp()).get(`/api/v1/projects/${PROJECT_ID}/nova-integration`)
    expect(res.body.health).toBe('disconnected')
    expect(res.body.connection).toBeNull()
  })

  it('drops a non-relative stored path — openInNovaUrl is null, never an echo', async () => {
    scriptGet({ link: { ...LINK_ROW, nova_project_url: 'https://evil.example.com/x' } })
    const res = await request(makeApp()).get(`/api/v1/projects/${PROJECT_ID}/nova-integration`)
    expect(res.status).toBe(200)
    expect(res.body.openInNovaUrl).toBeNull()
    expect(JSON.stringify(res.body)).not.toContain('evil.example.com')
  })

  it('returns openInNovaUrl null when no base URL is available', async () => {
    scriptGet({ connection: { ...CONN_ROW, nova_base_url: null } })
    const res = await request(makeApp()).get(`/api/v1/projects/${PROJECT_ID}/nova-integration`)
    expect(res.body.openInNovaUrl).toBeNull()
  })

  it('falls back to NOVA_PUBLIC_URL when the connection has no base URL', async () => {
    process.env['NOVA_PUBLIC_URL'] = 'https://nova.public.example.com/'
    scriptGet({ connection: { ...CONN_ROW, nova_base_url: null } })
    const res = await request(makeApp()).get(`/api/v1/projects/${PROJECT_ID}/nova-integration`)
    expect(res.body.openInNovaUrl).toBe('https://nova.public.example.com/projects/nova-p-9')
  })
})

// ─── POST /projects/:id/nova-integration/retry ────────────────────────────────

describe('POST /api/v1/projects/:id/nova-integration/retry', () => {
  function scriptRetry(requeuedIds: string[] = ['o-1', 'o-2']) {
    mockTenantQuery.mockImplementation((_tenant: string, sql: string) => {
      if (sql.includes('SELECT id FROM nova_project_links')) return Promise.resolve({ rows: [{ id: 'link-1' }] })
      if (sql.includes('UPDATE nova_outbox')) return Promise.resolve({ rows: requeuedIds.map(id => ({ id })) })
      if (sql.includes('INSERT INTO audit_log')) return Promise.resolve({ rows: [] })
      return Promise.resolve({ rows: [] })
    })
  }

  it('returns 403 for a non-privileged role and touches nothing', async () => {
    h.identity = { sub: 'user-1', role: 'engineer' }
    scriptRetry()
    const res = await request(makeApp()).post(`/api/v1/projects/${PROJECT_ID}/nova-integration/retry`)
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('forbidden')
    expect(mockTenantQuery).not.toHaveBeenCalled()
  })

  // BEHAVIOUR CHANGE (ADR-014 Phase 2A). A token carrying no resolvable role no
  // longer reaches the authorization decision: `resolveCurrentUser` cannot
  // establish an active principal, which is a 401 by the Phase 2 contract
  // (401 = we cannot say who you are; 403 = we can, and you may not). 403 is
  // reserved for a known principal lacking the capability.
  it('returns 401 when the token has no resolvable role', async () => {
    h.identity = { sub: 'user-1' }
    const res = await request(makeApp()).post(`/api/v1/projects/${PROJECT_ID}/nova-integration/retry`)
    expect(res.status).toBe(401)
    expect(mockTenantQuery).not.toHaveBeenCalled()
  })

  it('re-queues dead/failed rows for an admin and writes an audit row', async () => {
    h.identity = { sub: 'admin-1', role: 'admin' }
    scriptRetry(['o-1', 'o-2'])
    const res = await request(makeApp()).post(`/api/v1/projects/${PROJECT_ID}/nova-integration/retry`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ requeued: 2 })

    const updateCall = mockTenantQuery.mock.calls.find(c => String(c[1]).includes('UPDATE nova_outbox'))
    expect(updateCall).toBeDefined()
    const updateSql = String(updateCall![1])
    // Targets only dead + previously-failed rows, resets the ladder.
    expect(updateSql).toContain("status = 'dead'")
    expect(updateSql).toContain('attempts > 0')
    expect(updateSql).toContain('attempts = 0')
    expect(updateCall![2]).toEqual([PROJECT_ID])

    const auditCall = mockTenantQuery.mock.calls.find(c => String(c[1]).includes('INSERT INTO audit_log'))
    expect(auditCall).toBeDefined()
    expect(String(auditCall![1])).toContain('nova_retry_requested')
    expect(auditCall![2]).toEqual(['admin-1', PROJECT_ID, JSON.stringify({ requeued: 2 })])
  })

  it('allows owner as well', async () => {
    h.identity = { sub: 'owner-1', role: 'owner' }
    scriptRetry(['o-1'])
    const res = await request(makeApp()).post(`/api/v1/projects/${PROJECT_ID}/nova-integration/retry`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ requeued: 1 })
  })

  it('returns 404 when the project is not linked to Nova', async () => {
    h.identity = { sub: 'admin-1', role: 'admin' }
    mockTenantQuery.mockImplementation((_tenant: string, sql: string) => {
      if (sql.includes('SELECT id FROM nova_project_links')) return Promise.resolve({ rows: [] })
      return Promise.resolve({ rows: [] })
    })
    const res = await request(makeApp()).post(`/api/v1/projects/${PROJECT_ID}/nova-integration/retry`)
    expect(res.status).toBe(404)
    const sqls = mockTenantQuery.mock.calls.map(c => String(c[1]))
    expect(sqls.some(s => s.includes('UPDATE nova_outbox'))).toBe(false)
  })
})

// ─── Pure helpers ─────────────────────────────────────────────────────────────

describe('composeNovaUrl', () => {
  it('joins a valid base and relative path', () => {
    expect(composeNovaUrl('https://nova.example.com/', '/projects/p-1')).toBe('https://nova.example.com/projects/p-1')
  })
  it('rejects absolute/protocol-relative/traversal paths', () => {
    expect(composeNovaUrl('https://nova.example.com', 'https://evil.example.com/x')).toBeNull()
    expect(composeNovaUrl('https://nova.example.com', '//evil.example.com/x')).toBeNull()
    expect(composeNovaUrl('https://nova.example.com', '/a/../b')).toBeNull()
    expect(composeNovaUrl('https://nova.example.com', 'projects/p-1')).toBeNull()
    expect(composeNovaUrl('https://nova.example.com', null)).toBeNull()
  })
  it('rejects a non-http(s) or missing base', () => {
    expect(composeNovaUrl('', '/projects/p-1')).toBeNull()
    expect(composeNovaUrl('javascript:alert(1)', '/projects/p-1')).toBeNull()
    expect(composeNovaUrl(null, '/projects/p-1')).toBeNull()
  })
})

describe('deliveryHealth', () => {
  const base = { connectionStatus: 'connected', queued: 0, retrying: 0, dead: 0 }
  it('is healthy only with a connected connection and no problem rows', () => {
    expect(deliveryHealth(base)).toBe('healthy')
  })
  it('failed deliveries can never render healthy', () => {
    expect(deliveryHealth({ ...base, dead: 1 })).toBe('failed')
    expect(deliveryHealth({ ...base, retrying: 1 })).toBe('degraded')
    expect(deliveryHealth({ ...base, dead: 1, queued: 5 })).toBe('failed')
  })
  it('disconnected trumps everything', () => {
    expect(deliveryHealth({ ...base, connectionStatus: 'disconnected', dead: 3 })).toBe('disconnected')
    expect(deliveryHealth({ ...base, connectionStatus: null })).toBe('disconnected')
  })
  it('queued-only reports pending', () => {
    expect(deliveryHealth({ ...base, queued: 2 })).toBe('pending')
  })
})
