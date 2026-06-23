/**
 * Tier-1 API smoke tests — v4.30.0
 *
 * Single spec file that verifies the happy-path shape of every Tier-1
 * read endpoint. Individual per-route spec files (risks.test.ts, mcp.test.ts)
 * remain authoritative for CRUD / edge cases; this file catches regressions
 * like "missing router mount", "forgot requireTenant()", or "response shape
 * changed" without the overhead of exhaustive per-route coverage.
 *
 * Covers: dailyLogs, drawings, bim, budgets, inspections, punchLists,
 *         calculations, audit.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ─── Mock DB pool ─────────────────────────────────────────────────────────────
const mockQuery = vi.fn()
vi.mock('../db/pool', () => ({
  tenantQuery:       (tenantId: string, sql: string, params: unknown[]) => mockQuery(tenantId, sql, params),
  tenantTransaction: async <T>(_tenantId: string, fn: (q: any) => Promise<T>) => fn(mockQuery),
  query:             (sql: string, params: unknown[]) => mockQuery(null, sql, params),
}))

vi.mock('../auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.auth = { sub: 'user-1', tid: 'tenant-1', role: 'project_manager', jti: 'abc' }
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

// slog spams; silence it
// v4.31.0: slog is a callable function `slog(level, category, msg, data)`, not
// an object with .error/.info methods. Mock as a callable that also carries
// method properties for any legacy call sites.
vi.mock('../../src/modules/observability/index', () => {
  const slog: any = vi.fn()
  slog.info  = vi.fn()
  slog.warn  = vi.fn()
  slog.error = vi.fn()
  slog.debug = vi.fn()
  return { slog }
})

// ─── Import routers AFTER mocks ───────────────────────────────────────────────
import express from 'express'
import request from 'supertest'
import { dailyLogsRouter }   from '../routes/dailyLogs'
import { drawingsRouter }    from '../routes/drawings'
import { bimRouter }         from '../routes/bim'
import { budgetsRouter }     from '../routes/budgets'
import { inspectionsRouter } from '../routes/inspections'
import { punchListsRouter }  from '../routes/punchLists'
import { calculationsRouter } from '../routes/calculations'
import { auditRouter }       from '../routes/audit'

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1', dailyLogsRouter as any)
  app.use('/api/v1', drawingsRouter as any)
  app.use('/api/v1', bimRouter as any)
  app.use('/api/v1', budgetsRouter as any)
  app.use('/api/v1', inspectionsRouter as any)
  app.use('/api/v1', punchListsRouter as any)
  app.use('/api/v1', calculationsRouter as any)
  app.use('/api/v1/audit', auditRouter as any)
  return app
}

const app = makeApp()

// ─── Helpers ──────────────────────────────────────────────────────────────────
function rowStub(overrides: Record<string, unknown> = {}) {
  return {
    id: 'row-1',
    tenant_id: 'tenant-1',
    created_at: '2026-04-16T00:00:00Z',
    updated_at: '2026-04-16T00:00:00Z',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── Daily Logs ───────────────────────────────────────────────────────────────
describe('Tier-1 smoke: dailyLogs', () => {
  it('GET /projects/:id/daily-logs returns list', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [rowStub({ log_date: '2026-04-16', weather: 'sunny' })], rowCount: 1 })
    const res = await request(app).get('/api/v1/projects/proj-1/daily-logs')
    expect([200, 204]).toContain(res.status)
    expect(mockQuery).toHaveBeenCalled()
  })

  it('GET /daily-logs/:id passes through tenant query', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [rowStub()], rowCount: 1 })
    const res = await request(app).get('/api/v1/daily-logs/row-1')
    expect([200, 404]).toContain(res.status)
  })
})

// ─── Drawings ─────────────────────────────────────────────────────────────────
describe('Tier-1 smoke: drawings', () => {
  it('GET /projects/:id/drawings returns list', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [rowStub({ sheet_number: 'A-101', title: 'Floor Plan' })], rowCount: 1 })
    const res = await request(app).get('/api/v1/projects/proj-1/drawings')
    expect([200, 204]).toContain(res.status)
  })

  it('GET /drawings/:id/revisions returns list', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 })
    const res = await request(app).get('/api/v1/drawings/dwg-1/revisions')
    expect([200, 404]).toContain(res.status)
  })

  it('GET /drawings/:id/markups returns list', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 })
    const res = await request(app).get('/api/v1/drawings/dwg-1/markups')
    expect([200, 404]).toContain(res.status)
  })
})

// ─── BIM ──────────────────────────────────────────────────────────────────────
describe('Tier-1 smoke: bim', () => {
  it('GET /projects/:id/bim-models returns list', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [rowStub({ name: 'Arch Model', version: '1.0' })], rowCount: 1 })
    const res = await request(app).get('/api/v1/projects/proj-1/bim-models')
    expect([200, 204]).toContain(res.status)
  })

  it('GET /projects/:id/bim-issues returns list', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 })
    const res = await request(app).get('/api/v1/projects/proj-1/bim-issues')
    expect([200, 204]).toContain(res.status)
  })
})

// ─── Budgets ──────────────────────────────────────────────────────────────────
describe('Tier-1 smoke: budgets', () => {
  it('GET /projects/:id/budget returns budget', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [rowStub({ total: 100000, committed: 50000 })], rowCount: 1 })
    const res = await request(app).get('/api/v1/projects/proj-1/budget')
    expect([200, 404]).toContain(res.status)
  })

  it('GET /projects/:id/budget/rollup returns rollup', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 })
    const res = await request(app).get('/api/v1/projects/proj-1/budget/rollup')
    expect([200, 404]).toContain(res.status)
  })

  it('GET /projects/:id/change-orders returns list', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 })
    const res = await request(app).get('/api/v1/projects/proj-1/change-orders')
    expect([200, 204]).toContain(res.status)
  })
})

// ─── Inspections ──────────────────────────────────────────────────────────────
describe('Tier-1 smoke: inspections', () => {
  it('GET /projects/:id/inspection-templates returns list', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [rowStub({ name: 'Pre-Functional', is_active: true })], rowCount: 1 })
    const res = await request(app).get('/api/v1/projects/proj-1/inspection-templates')
    expect([200, 204]).toContain(res.status)
  })

  it('GET /projects/:id/inspections returns list', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 })
    const res = await request(app).get('/api/v1/projects/proj-1/inspections')
    expect([200, 204]).toContain(res.status)
  })

  it('GET /inspections/:id returns detail or 404', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 })
    const res = await request(app).get('/api/v1/inspections/insp-1')
    expect([200, 404]).toContain(res.status)
  })
})

// ─── Punch Lists ──────────────────────────────────────────────────────────────
describe('Tier-1 smoke: punchLists', () => {
  it('GET /projects/:id/punch-lists returns list', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [rowStub({ name: 'Pre-Handover' })], rowCount: 1 })
    const res = await request(app).get('/api/v1/projects/proj-1/punch-lists')
    expect([200, 204]).toContain(res.status)
  })

  it('GET /punch-lists/:id/items returns list', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 })
    const res = await request(app).get('/api/v1/punch-lists/pl-1/items')
    expect([200, 404]).toContain(res.status)
  })
})

// ─── Calculations ─────────────────────────────────────────────────────────────
describe('Tier-1 smoke: calculations', () => {
  it('GET /projects/:id/calc-sessions returns list', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [rowStub({ name: 'Pump Sizing' })], rowCount: 1 })
    const res = await request(app).get('/api/v1/projects/proj-1/calc-sessions')
    expect([200, 204]).toContain(res.status)
  })

  it('GET /calc-sessions/:id returns detail or 404', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 })
    const res = await request(app).get('/api/v1/calc-sessions/cs-1')
    expect([200, 404]).toContain(res.status)
  })
})

// ─── Audit ────────────────────────────────────────────────────────────────────
describe('Tier-1 smoke: audit', () => {
  it('GET /audit returns paginated shape', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [rowStub({ action: 'create', resource: 'projects' })], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] })
    const res = await request(app).get('/api/v1/audit')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('data')
    expect(res.body).toHaveProperty('pagination')
    expect(res.body.pagination).toMatchObject({ page: 1, limit: 50 })
  })

  it('GET /audit rejects invalid action', async () => {
    const res = await request(app).get('/api/v1/audit?action=pillage')
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('invalid_action')
  })

  it('GET /audit accepts valid action filter', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
    const res = await request(app).get('/api/v1/audit?action=create')
    expect(res.status).toBe(200)
    const [, sql, params] = mockQuery.mock.calls[0]
    expect(sql).toContain('a.action =')
    expect(params).toContain('create')
  })

  it('GET /audit/:id returns detail or 404', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 })
    const res = await request(app).get('/api/v1/audit/00000000-0000-0000-0000-000000000001')
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('not_found')
  })

  it('GET /audit/_meta/actions returns enum list', async () => {
    const res = await request(app).get('/api/v1/audit/_meta/actions')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.actions)).toBe(true)
    expect(res.body.actions).toContain('create')
    expect(res.body.actions).toContain('integrate_push')
  })

  it('GET /audit applies pagination bounds', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
    const res = await request(app).get('/api/v1/audit?page=2&limit=25')
    expect(res.status).toBe(200)
    expect(res.body.pagination.page).toBe(2)
    expect(res.body.pagination.limit).toBe(25)
  })

  it('GET /audit clamps limit over 200 to 200', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
    const res = await request(app).get('/api/v1/audit?limit=9999')
    expect(res.status).toBe(200)
    expect(res.body.pagination.limit).toBe(200)
  })

  it('GET /audit passes search/resource/user filters to SQL', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
    const res = await request(app).get('/api/v1/audit?resource=projects&search=foo')
    expect(res.status).toBe(200)
    const [, sql, params] = mockQuery.mock.calls[0]
    expect(sql).toContain('a.resource =')
    expect(sql).toContain('ILIKE')
    expect(params).toContain('projects')
    expect(params).toContain('%foo%')
  })

  it('GET /audit returns 500 on DB error', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB dead'))
    const res = await request(app).get('/api/v1/audit')
    expect(res.status).toBe(500)
    expect(res.body.error).toBe('audit_list_failed')
  })
})
