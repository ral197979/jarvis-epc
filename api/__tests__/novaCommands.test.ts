/**
 * Tests: api/routes/novaCommands.ts
 *
 * Exercises the connection-scoped verification order, dual-secret rotation,
 * request-digest idempotency, and the contract-shaped project.create flow over
 * a minimal express app (the router supplies its own raw-body parser). The
 * pool is fully mocked — no real DB.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import { createHmac } from 'node:crypto'

const mockQuery = vi.fn()
const mockTenantQuery = vi.fn()
const mockClientQuery = vi.fn()
vi.mock('../db/pool', () => ({
  query: (...a: unknown[]) => mockQuery(...a),
  tenantQuery: (...a: unknown[]) => mockTenantQuery(...a),
  tenantTransaction: async (_tenantId: string, fn: (client: unknown) => Promise<unknown>) =>
    fn({ query: (...a: unknown[]) => mockClientQuery(...a) }),
  // Imported (not used on these paths) by novaOutbox's drain claim.
  pool: { connect: vi.fn() },
}))

import { novaCommandsRouter } from '../routes/novaCommands'

const SECRET = 'nova-cmd-secret'
const CONNECTION = {
  id: 'c0ffee00-0000-0000-0000-000000000001',
  tenant_id: '11111111-1111-1111-1111-111111111111',
  connection_id: 'conn-1',
  nova_tenant_id: 'nova-t-1',
  status: 'connected',
}

function makeApp() {
  const app = express()
  app.use('/api/nova', novaCommandsRouter)
  return app
}

function sign(body: string, ts: string, secret = SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')}`
}

function validCommand(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return Object.assign({
    schemaVersion: '1.0',
    command: 'project.create',
    idempotencyKey: 'idem-key-0001',
    connectionId: 'conn-1',
    novaTenantId: 'nova-t-1',
    novaProjectId: 'nova-p-9',
    novaProjectUrl: '/projects/nova-p-9',
    project: {
      name: 'Green Hydrogen Compression Skid',
      projectNumber: 'NV-2026-014',
      customerName: 'Aurora Midstream LLC',
      location: { name: 'Odessa, TX', country: 'US' },
      startDate: '2026-08-01',
      targetCompletionDate: '2027-03-31',
      scope: ['engineering', 'construction'],
    },
    requestedBy: { novaUserId: 'nu-77', displayName: 'Dana Reyes' },
  }, overrides)
}

async function post(path: string, body: string, headers: Record<string, string>) {
  let req = request(makeApp()).post(path).set('Content-Type', 'application/json')
  for (const [k, v] of Object.entries(headers)) req = req.set(k, v)
  return req.send(body)
}

function nowTs(): string { return String(Math.floor(Date.now() / 1000)) }

/** Default happy-path scripting for the transaction client. */
function scriptHappyPath() {
  mockClientQuery.mockImplementation((sql: string) => {
    if (sql.includes('INSERT INTO nova_inbound_commands')) return { rows: [{ id: 'ledger-1' }] }
    if (sql.includes('SELECT id FROM projects'))           return { rows: [] }
    if (sql.includes('SELECT id FROM nova_project_links')) return { rows: [] }
    if (sql.includes('INSERT INTO projects')) {
      return { rows: [{ id: 'dddddddd-0000-0000-0000-000000000009', code: 'NV-2026-014', created_at: new Date('2026-07-20T12:00:00Z') }] }
    }
    if (sql.includes('INSERT INTO nova_outbox')) return { rows: [{ id: 'outbox-1' }] }
    return { rows: [] }
  })
}

describe('POST /api/nova/commands', () => {
  beforeEach(() => {
    mockQuery.mockReset()
    mockTenantQuery.mockReset()
    mockClientQuery.mockReset()
    process.env['NOVA_EXTERNAL'] = 'true'
    process.env['NOVA_COMMAND_SECRET'] = SECRET
    delete process.env['NOVA_COMMAND_SECRET_PREVIOUS']
    // Connection lookup (plain query) resolves by default. Returns real
    // promises — the rejection-audit path chains .catch() on the result.
    mockQuery.mockImplementation((sql: string) => {
      if (typeof sql === 'string' && sql.includes('FROM nova_connections')) return Promise.resolve({ rows: [CONNECTION] })
      return Promise.resolve({ rows: [] })
    })
    scriptHappyPath()
  })
  afterEach(() => {
    delete process.env['NOVA_EXTERNAL']
    delete process.env['NOVA_COMMAND_SECRET']
    delete process.env['NOVA_COMMAND_SECRET_PREVIOUS']
  })

  it('returns 503 when NOVA_EXTERNAL is off', async () => {
    delete process.env['NOVA_EXTERNAL']
    const body = JSON.stringify(validCommand())
    const ts = nowTs()
    const res = await post('/api/nova/commands', body, { 'X-Nova-Timestamp': ts, 'X-Nova-Signature': sign(body, ts) })
    expect(res.status).toBe(503)
  })

  it('returns 503 when the command secret is unconfigured', async () => {
    delete process.env['NOVA_COMMAND_SECRET']
    const body = JSON.stringify(validCommand())
    const ts = nowTs()
    const res = await post('/api/nova/commands', body, { 'X-Nova-Timestamp': ts, 'X-Nova-Signature': sign(body, ts) })
    expect(res.status).toBe(503)
  })

  it('rejects a missing signature with 401', async () => {
    const body = JSON.stringify(validCommand())
    const res = await post('/api/nova/commands', body, { 'X-Nova-Timestamp': nowTs() })
    expect(res.status).toBe(401)
    expect(res.body).toEqual({ error: 'unauthorized' })
    expect(mockClientQuery).not.toHaveBeenCalled()
  })

  it('rejects an invalid signature with 401', async () => {
    const body = JSON.stringify(validCommand())
    const res = await post('/api/nova/commands', body, { 'X-Nova-Timestamp': nowTs(), 'X-Nova-Signature': 'sha256=deadbeef' })
    expect(res.status).toBe(401)
    expect(res.body).toEqual({ error: 'unauthorized' })
  })

  it('rejects a stale timestamp with 401 even when the signature is valid', async () => {
    const body = JSON.stringify(validCommand())
    const stale = String(Math.floor(Date.now() / 1000) - 3600)
    const res = await post('/api/nova/commands', body, { 'X-Nova-Timestamp': stale, 'X-Nova-Signature': sign(body, stale) })
    expect(res.status).toBe(401)
  })

  it('accepts a signature made with the PREVIOUS secret during rotation', async () => {
    process.env['NOVA_COMMAND_SECRET_PREVIOUS'] = 'old-secret'
    const body = JSON.stringify(validCommand())
    const ts = nowTs()
    const res = await post('/api/nova/commands', body, { 'X-Nova-Timestamp': ts, 'X-Nova-Signature': sign(body, ts, 'old-secret') })
    expect(res.status).toBe(201)
  })

  it('rejects an unknown connection with a uniform 401', async () => {
    mockQuery.mockImplementation(() => ({ rows: [] }))
    const body = JSON.stringify(validCommand())
    const ts = nowTs()
    const res = await post('/api/nova/commands', body, { 'X-Nova-Timestamp': ts, 'X-Nova-Signature': sign(body, ts) })
    expect(res.status).toBe(401)
    expect(res.body).toEqual({ error: 'unauthorized' })
  })

  it('rejects a connection whose status is not connected', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (typeof sql === 'string' && sql.includes('FROM nova_connections')) {
        return { rows: [{ ...CONNECTION, status: 'disconnected' }] }
      }
      return { rows: [] }
    })
    const body = JSON.stringify(validCommand())
    const ts = nowTs()
    const res = await post('/api/nova/commands', body, { 'X-Nova-Timestamp': ts, 'X-Nova-Signature': sign(body, ts) })
    expect(res.status).toBe(401)
  })

  it('rejects a novaTenantId mismatch with 401 and writes an audit row', async () => {
    const body = JSON.stringify(validCommand({ novaTenantId: 'someone-else' }))
    const ts = nowTs()
    const res = await post('/api/nova/commands', body, { 'X-Nova-Timestamp': ts, 'X-Nova-Signature': sign(body, ts) })
    expect(res.status).toBe(401)
    const auditCall = mockQuery.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO audit_log'))
    expect(auditCall).toBeDefined()
    expect(String(auditCall![0])).toContain('nova_command_rejected')
    expect(auditCall![1][0]).toBe(CONNECTION.tenant_id)
  })

  it('rejects an unknown schemaVersion with 422', async () => {
    const body = JSON.stringify(validCommand({ schemaVersion: '2.0' }))
    const ts = nowTs()
    const res = await post('/api/nova/commands', body, { 'X-Nova-Timestamp': ts, 'X-Nova-Signature': sign(body, ts) })
    expect(res.status).toBe(422)
    expect(res.body.error).toBe('validation')
  })

  it('rejects a missing required field with 422', async () => {
    const cmd = validCommand()
    delete (cmd['project'] as Record<string, unknown>)['projectNumber']
    const body = JSON.stringify(cmd)
    const ts = nowTs()
    const res = await post('/api/nova/commands', body, { 'X-Nova-Timestamp': ts, 'X-Nova-Signature': sign(body, ts) })
    expect(res.status).toBe(422)
    expect(res.body.error).toBe('validation')
    expect(mockClientQuery).not.toHaveBeenCalled()
  })

  it('answers connection.ping with 200 ok', async () => {
    const body = JSON.stringify({ schemaVersion: '1.0', command: 'connection.ping', connectionId: 'conn-1', novaTenantId: 'nova-t-1' })
    const ts = nowTs()
    const res = await post('/api/nova/commands', body, { 'X-Nova-Timestamp': ts, 'X-Nova-Signature': sign(body, ts) })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ schemaVersion: '1.0', status: 'ok' })
  })

  it('creates a project and returns the contract-shaped 201 response', async () => {
    const body = JSON.stringify(validCommand())
    const ts = nowTs()
    const res = await post('/api/nova/commands', body, { 'X-Nova-Timestamp': ts, 'X-Nova-Signature': sign(body, ts) })
    expect(res.status).toBe(201)
    expect(res.body).toEqual({
      schemaVersion: '1.0',
      status: 'created',
      denverOrganizationId: CONNECTION.tenant_id,
      denverProjectId: 'dddddddd-0000-0000-0000-000000000009',
      denverProjectNumber: 'NV-2026-014',
      projectUrl: '/projects/dddddddd-0000-0000-0000-000000000009',
      createdAt: '2026-07-20T12:00:00.000Z',
    })
    // Atomic side effects all ran on the SAME transaction client.
    const sqls = mockClientQuery.mock.calls.map(([sql]) => String(sql))
    expect(sqls.some(s => s.includes('INSERT INTO nova_inbound_commands'))).toBe(true)
    expect(sqls.some(s => s.includes('INSERT INTO projects'))).toBe(true)
    expect(sqls.some(s => s.includes('INSERT INTO nova_project_links'))).toBe(true)
    expect(sqls.some(s => s.includes('UPDATE nova_inbound_commands'))).toBe(true)
    expect(sqls.some(s => s.includes('INSERT INTO audit_log'))).toBe(true)
    expect(sqls.some(s => s.includes('INSERT INTO nova_outbox'))).toBe(true)
  })

  it('drops a non-relative novaProjectUrl (stores NULL) instead of rejecting', async () => {
    const body = JSON.stringify(validCommand({ novaProjectUrl: 'https://evil.example.com/x' }))
    const ts = nowTs()
    const res = await post('/api/nova/commands', body, { 'X-Nova-Timestamp': ts, 'X-Nova-Signature': sign(body, ts) })
    expect(res.status).toBe(201)
    const linkCall = mockClientQuery.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO nova_project_links'))
    expect(linkCall).toBeDefined()
    // params: [project_id, connection_id, nova_project_id, nova_project_number, nova_project_url, ...]
    expect(linkCall![1][4]).toBeNull()
  })

  it('replays a duplicate idempotency key with the stored response as already_exists', async () => {
    const storedResponse = {
      schemaVersion: '1.0', status: 'created',
      denverOrganizationId: CONNECTION.tenant_id,
      denverProjectId: 'dddddddd-0000-0000-0000-000000000009',
      denverProjectNumber: 'NV-2026-014',
      projectUrl: '/projects/dddddddd-0000-0000-0000-000000000009',
      createdAt: '2026-07-20T12:00:00.000Z',
    }
    const body = JSON.stringify(validCommand())
    const { createHash } = await import('node:crypto')
    const digest = createHash('sha256').update(Buffer.from(body)).digest('hex')
    mockClientQuery.mockImplementation((sql: string) => {
      if (sql.includes('INSERT INTO nova_inbound_commands')) return { rows: [] }   // conflict
      if (sql.includes('SELECT request_digest'))             return { rows: [{ request_digest: digest, response: storedResponse }] }
      return { rows: [] }
    })
    const ts = nowTs()
    const res = await post('/api/nova/commands', body, { 'X-Nova-Timestamp': ts, 'X-Nova-Signature': sign(body, ts) })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ...storedResponse, status: 'already_exists' })
    // No project was created on the replay path.
    const sqls = mockClientQuery.mock.calls.map(([sql]) => String(sql))
    expect(sqls.some(s => s.includes('INSERT INTO projects'))).toBe(false)
  })

  it('returns 409 idempotency_conflict when the same key arrives with a different body', async () => {
    mockClientQuery.mockImplementation((sql: string) => {
      if (sql.includes('INSERT INTO nova_inbound_commands')) return { rows: [] }   // conflict
      if (sql.includes('SELECT request_digest'))             return { rows: [{ request_digest: 'a-different-digest', response: { status: 'created' } }] }
      return { rows: [] }
    })
    const body = JSON.stringify(validCommand())
    const ts = nowTs()
    const res = await post('/api/nova/commands', body, { 'X-Nova-Timestamp': ts, 'X-Nova-Signature': sign(body, ts) })
    expect(res.status).toBe(409)
    expect(res.body.error).toBe('idempotency_conflict')
  })

  it('returns 409 conflict when the project code already exists, without creating a link', async () => {
    mockClientQuery.mockImplementation((sql: string) => {
      if (sql.includes('INSERT INTO nova_inbound_commands')) return { rows: [{ id: 'ledger-1' }] }
      if (sql.includes('SELECT id FROM projects'))           return { rows: [{ id: 'existing-project' }] }
      return { rows: [] }
    })
    const body = JSON.stringify(validCommand())
    const ts = nowTs()
    const res = await post('/api/nova/commands', body, { 'X-Nova-Timestamp': ts, 'X-Nova-Signature': sign(body, ts) })
    expect(res.status).toBe(409)
    expect(res.body.error).toBe('conflict')
    const sqls = mockClientQuery.mock.calls.map(([sql]) => String(sql))
    expect(sqls.some(s => s.includes('INSERT INTO nova_project_links'))).toBe(false)
  })
})

describe('POST /api/nova/reconcile', () => {
  beforeEach(() => {
    mockQuery.mockReset()
    mockTenantQuery.mockReset()
    mockClientQuery.mockReset()
    process.env['NOVA_EXTERNAL'] = 'true'
    process.env['NOVA_COMMAND_SECRET'] = SECRET
    mockQuery.mockImplementation((sql: string) => {
      if (typeof sql === 'string' && sql.includes('FROM nova_connections')) return { rows: [CONNECTION] }
      return { rows: [] }
    })
  })
  afterEach(() => {
    delete process.env['NOVA_EXTERNAL']
    delete process.env['NOVA_COMMAND_SECRET']
  })

  it('returns the link map for the verified connection only', async () => {
    mockTenantQuery.mockResolvedValue({
      rows: [{
        nova_project_id: 'nova-p-9',
        project_id: 'dddddddd-0000-0000-0000-000000000009',
        denver_project_number: 'NV-2026-014',
        last_event_at: new Date('2026-07-20T12:34:00Z'),
        latest_summary: { overallStatus: 'planning', overallPercent: 0 },
      }],
    })
    const body = JSON.stringify({ schemaVersion: '1.0', connectionId: 'conn-1', novaTenantId: 'nova-t-1' })
    const ts = nowTs()
    const res = await post('/api/nova/reconcile', body, { 'X-Nova-Timestamp': ts, 'X-Nova-Signature': sign(body, ts) })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      schemaVersion: '1.0',
      connectionId: 'conn-1',
      links: [{
        novaProjectId: 'nova-p-9',
        denverProjectId: 'dddddddd-0000-0000-0000-000000000009',
        denverProjectNumber: 'NV-2026-014',
        integrationLastEventAt: '2026-07-20T12:34:00.000Z',
        latestSummary: { overallStatus: 'planning', overallPercent: 0 },
      }],
    })
    // Tenant scoping comes from the connection row.
    expect(mockTenantQuery).toHaveBeenCalledWith(CONNECTION.tenant_id, expect.any(String), ['conn-1'])
  })

  it('requires a valid signature like /commands', async () => {
    const body = JSON.stringify({ schemaVersion: '1.0', connectionId: 'conn-1', novaTenantId: 'nova-t-1' })
    const res = await post('/api/nova/reconcile', body, { 'X-Nova-Timestamp': nowTs(), 'X-Nova-Signature': 'sha256=bad' })
    expect(res.status).toBe(401)
  })
})
