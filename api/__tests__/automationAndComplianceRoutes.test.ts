/**
 * Tests: api/routes/automation.ts + api/routes/compliance.ts
 * Covers admin role gating, list/create flows, state transitions.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Declared before the pool mock factory so it can read the active role.
let _currentRole = 'owner'

const mockQuery = vi.fn()
// ADR-014 Phase 2A: these routes now require a capability, so the pool must
// answer the current-user lookup. It is served here rather than through
// mockQuery so per-test scripting cannot starve authorization. The role mirrors
// `_currentRole`, which each describe block already sets.
vi.mock('../db/pool', () => ({
  tenantQuery: (tenantId: string, sql: string, params: unknown[]) => mockQuery(tenantId, sql, params),
  query: async (sql: string, params: unknown[]) =>
    /FROM\s+users\s+WHERE\s+id/i.test(String(sql))
      ? { rows: [{ id: 'u1', tenant_id: 'tenant-1', role: _currentRole, is_active: true }], rowCount: 1 }
      : mockQuery(null, sql, params),
}))

// Auth mock factory — lets each describe pick the role
vi.mock('../auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.auth = { sub: 'user-1', role: _currentRole, tid: 'tenant-1', jti: 'j' }
    next()
  },
}))

vi.mock('../middleware/tenant', () => ({
  requireTenant: () => (req: any, _res: any, next: any) => {
    req.tenantId = 'tenant-1'
    next()
  },
}))

// Stub scheduler so `listRegisteredHandlers` is callable inside the route
vi.mock('../services/scheduler', () => ({
  listRegisteredHandlers: () => ['webhook_dispatch', 'snapshot_kpis', 'purge_audit_logs'],
}))

import express from 'express'
import request from 'supertest'
import automationRouter from '../routes/automation'
import complianceRouter from '../routes/compliance'

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/admin/automation', automationRouter)
  app.use('/api/v1/compliance-tasks', complianceRouter)
  return app
}

// ═══════════════════════════════════════════════════════════════════════════
// Automation routes
// ═══════════════════════════════════════════════════════════════════════════

describe('automation routes — owner access', () => {
  beforeEach(() => { vi.clearAllMocks(); _currentRole = 'owner' })

  it('GET /handlers returns the registered job types', async () => {
    const res = await request(makeApp()).get('/api/v1/admin/automation/handlers')
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual(expect.arrayContaining(['webhook_dispatch','snapshot_kpis']))
  })

  it('GET /scheduled returns paginated results', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 's-1', name: 'nightly-kpi', enabled: true }] })
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '1' }] })
    const res = await request(makeApp()).get('/api/v1/admin/automation/scheduled')
    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.pagination.total).toBe(1)
  })

  it('POST /scheduled validates required fields', async () => {
    const res = await request(makeApp())
      .post('/api/v1/admin/automation/scheduled')
      .send({ name: 'only-name' })
    expect(res.status).toBe(422)
    expect(res.body.error).toBe('validation')
  })

  it('POST /scheduled inserts a recurring job', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 's-2', name: 'nightly', job_type: 'snapshot_kpis' }] })
    const res = await request(makeApp())
      .post('/api/v1/admin/automation/scheduled')
      .send({ name: 'nightly', job_type: 'snapshot_kpis', interval_seconds: 86400, payload_json: {} })
    expect(res.status).toBe(201)
    expect(res.body.data.id).toBe('s-2')
  })

  it('POST /background/:id/retry requeues a failed job', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'j-1', status: 'queued', attempts: 0 }] })
    const res = await request(makeApp()).post('/api/v1/admin/automation/background/j-1/retry')
    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('queued')
  })
})

describe('automation routes — non-admin is blocked', () => {
  beforeEach(() => { vi.clearAllMocks(); _currentRole = 'engineer' })

  it('GET /handlers returns 403', async () => {
    const res = await request(makeApp()).get('/api/v1/admin/automation/handlers')
    expect(res.status).toBe(403)
  })

  it('GET /scheduled returns 403', async () => {
    const res = await request(makeApp()).get('/api/v1/admin/automation/scheduled')
    expect(res.status).toBe(403)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Compliance routes
// ═══════════════════════════════════════════════════════════════════════════

describe('compliance routes', () => {
  beforeEach(() => { vi.clearAllMocks(); _currentRole = 'owner' })

  it('POST / validates required fields', async () => {
    const res = await request(makeApp())
      .post('/api/v1/compliance-tasks')
      .send({ title: 'missing-due-date' })
    expect(res.status).toBe(422)
  })

  it('POST / creates a task', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{
      id: 't-1', title: 'JHA', due_date: '2026-06-01', status: 'pending', category: 'jha',
    }] })
    const res = await request(makeApp())
      .post('/api/v1/compliance-tasks')
      .send({ title: 'JHA', due_date: '2026-06-01', category: 'jha' })
    expect(res.status).toBe(201)
    expect(res.body.data.id).toBe('t-1')
  })

  it('POST /:id/complete marks task terminal', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 't-1', status: 'completed' }] })
    const res = await request(makeApp()).post('/api/v1/compliance-tasks/t-1/complete')
    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('completed')
    const [, sql] = mockQuery.mock.calls[0]!
    expect(sql).toMatch(/status\s*=\s*'completed'/)
  })

  it('POST /:id/complete returns 404 when task already terminal', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    const res = await request(makeApp()).post('/api/v1/compliance-tasks/t-1/complete')
    expect(res.status).toBe(404)
  })

  it('POST /:id/waive requires admin', async () => {
    _currentRole = 'engineer'
    const res = await request(makeApp()).post('/api/v1/compliance-tasks/t-1/waive')
    expect(res.status).toBe(403)
  })

  it('DELETE /:id requires admin', async () => {
    _currentRole = 'engineer'
    const res = await request(makeApp()).delete('/api/v1/compliance-tasks/t-1')
    expect(res.status).toBe(403)
  })
})
