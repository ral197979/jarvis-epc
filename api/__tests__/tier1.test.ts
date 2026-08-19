/**
 * Tier-1 API smoke tests — v4.30.0
 *
 * Single spec file that verifies the happy-path shape of every Tier-1
 * read endpoint. Individual per-route spec files (mcp.test.ts) remain
 * authoritative for CRUD / edge cases; this file catches regressions
 * like "missing router mount", "forgot requireTenant()", or "response shape
 * changed" without the overhead of exhaustive per-route coverage.
 *
 * Covers: dailyLogs, drawings, bim, budgets, inspections, punchLists,
 *         calculations, audit.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * ADR-014 Phase 2B-1: these smoke tests verify response *shape*, but the routes
 * they exercise now require a capability, so each group must state who is
 * calling. `CALLER.role` defaults to the project manager — the role that holds
 * the delivery view capabilities the untouched groups need — and the groups
 * covering a high-sensitivity domain narrow it to the role Phase 1 actually
 * grants that domain to. Authorization re-resolves the role from the database,
 * so the pool answers that lookup ahead of the scripted mock, keeping every
 * `mockResolvedValueOnce` sequence aligned with the handler's own queries.
 */
const CALLER = vi.hoisted(() => ({ role: 'project_manager' }))

// ─── Mock DB pool ─────────────────────────────────────────────────────────────
const mockQuery = vi.fn()
vi.mock('../db/pool', () => ({
  tenantQuery:       (tenantId: string, sql: string, params: unknown[]) =>
    /SELECT (id|p\.id) FROM projects/i.test(String(sql))
      ? Promise.resolve({ rows: [{ id: '30000000-0000-4000-8000-000000000001' }], rowCount: 1 })
      : mockQuery(tenantId, sql, params),
  tenantTransaction: async <T>(_tenantId: string, fn: (q: any) => Promise<T>) => fn(mockQuery),
  query:             (sql: string, params: unknown[]) =>
    /FROM\s+users\s+WHERE\s+id/i.test(String(sql))
      ? Promise.resolve({ rows: [{ id: 'user-1', tenant_id: 'tenant-1', role: CALLER.role, is_active: true }], rowCount: 1 })
      : mockQuery(null, sql, params),
}))

vi.mock('../auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.auth = { sub: 'user-1', tid: 'tenant-1', role: CALLER.role, jti: 'abc' }
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
import { changeOrdersRouter } from '../routes/changeOrders'
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
  app.use('/api/v1', changeOrdersRouter as any)
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
  CALLER.role = 'project_manager'
})

// ─── Daily Logs ───────────────────────────────────────────────────────────────
describe('Tier-1 smoke: dailyLogs', () => {
  it('GET /projects/:id/daily-logs returns list', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [rowStub({ log_date: '2026-04-16', weather: 'sunny' })], rowCount: 1 })
    const res = await request(app).get('/api/v1/projects/30000000-0000-4000-8000-000000000001/daily-logs')
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
    const res = await request(app).get('/api/v1/projects/30000000-0000-4000-8000-000000000001/drawings')
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
    const res = await request(app).get('/api/v1/projects/30000000-0000-4000-8000-000000000001/bim-models')
    expect([200, 204]).toContain(res.status)
  })

  it('GET /projects/:id/bim-issues returns list', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 })
    const res = await request(app).get('/api/v1/projects/30000000-0000-4000-8000-000000000001/bim-issues')
    expect([200, 204]).toContain(res.status)
  })
})

// ─── Budgets ──────────────────────────────────────────────────────────────────
describe('Tier-1 smoke: budgets', () => {
  // Budget, rollup and change-order reads disclose commercial value and require
  // `cost.view`. Phase 1 grants it to the owner alone — a project manager gets
  // 403 here now, which is the §14 boundary this gate exists to create.
  beforeEach(() => { CALLER.role = 'owner' })

  it('GET /projects/:id/budget returns budget', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [rowStub({ total: 100000, committed: 50000 })], rowCount: 1 })
    const res = await request(app).get('/api/v1/projects/30000000-0000-4000-8000-000000000001/budget')
    expect([200, 404]).toContain(res.status)
  })

  it('GET /projects/:id/budget/rollup returns rollup', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 })
    const res = await request(app).get('/api/v1/projects/30000000-0000-4000-8000-000000000001/budget/rollup')
    expect([200, 404]).toContain(res.status)
  })

  it('GET /projects/:id/change-orders returns list', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 })
    const res = await request(app).get('/api/v1/projects/30000000-0000-4000-8000-000000000001/change-orders')
    expect([200, 204]).toContain(res.status)
  })
})

// ─── Inspections ──────────────────────────────────────────────────────────────
describe('Tier-1 smoke: inspections', () => {
  it('GET /projects/:id/inspection-templates returns list', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [rowStub({ name: 'Pre-Functional', is_active: true })], rowCount: 1 })
    const res = await request(app).get('/api/v1/projects/30000000-0000-4000-8000-000000000001/inspection-templates')
    expect([200, 204]).toContain(res.status)
  })

  it('GET /projects/:id/inspections returns list', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 })
    const res = await request(app).get('/api/v1/projects/30000000-0000-4000-8000-000000000001/inspections')
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
    const res = await request(app).get('/api/v1/projects/30000000-0000-4000-8000-000000000001/punch-lists')
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
    const res = await request(app).get('/api/v1/projects/30000000-0000-4000-8000-000000000001/calc-sessions')
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
  // The audit trail requires `audit.view`. Its holders are owner and admin;
  // admin is the narrower of the two, so it is the caller here.
  beforeEach(() => { CALLER.role = 'admin' })

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
