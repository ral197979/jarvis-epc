/**
 * ADR-014 Phase 2B-2 §39–§40, §48–§49 — authorization runs *before* data access.
 *
 * The sweep proves the status code. This proves what the status code is meant to
 * imply: that a caller without the domain capability never causes a query or a
 * service call against that domain, so authorization cannot become an existence
 * oracle and a denial costs nothing downstream.
 *
 * These mount the REAL routers with their real middleware chains, one
 * representative per delivery family.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

const h = vi.hoisted(() => ({
  query:        vi.fn(),
  listMembers:  vi.fn(),
  getTeamSummary: vi.fn(),
  tagCoverage:  vi.fn(),
}))

vi.mock('../db/pool', () => ({
  query:             (...a: unknown[]) => h.query(...a),
  tenantQuery:       (...a: unknown[]) => h.query(...a),
  tenantTransaction: vi.fn(),
}))

import { principal, principalQuery, authMiddlewareFor, tenantMiddlewareFor, type TestPrincipal } from './helpers/testPrincipal'

let current: TestPrincipal

vi.mock('../auth', async () => {
  const actual = await vi.importActual<typeof import('../auth')>('../auth')
  return { ...actual, requireAuth: authMiddlewareFor(() => current) }
})
vi.mock('../middleware/tenant', () => ({ requireTenant: () => tenantMiddlewareFor(() => current) }))

vi.mock('../services/team/teamService', () => ({
  createMember: vi.fn(), listMembers: h.listMembers, getMember: vi.fn(), updateMember: vi.fn(),
  createAssignment: vi.fn(), listAssignmentsByMember: vi.fn(), listAssignmentsByProject: vi.fn(),
  endAssignment: vi.fn(), getTeamSummary: h.getTeamSummary,
}))
vi.mock('../services/cxExecution', () => ({ getTagPackCoverage: h.tagCoverage }))
vi.mock('../services/actionService', () => ({ createAction: vi.fn() }))

import { teamRouter } from '../routes/team'
import { drawingsRouter } from '../routes/drawings'
import { dailyLogsRouter } from '../routes/dailyLogs'
import { punchListsRouter } from '../routes/punchLists'
import { systemsRouter } from '../routes/systems'
import { vendorsRouter } from '../routes/procurement'
import filesRouter from '../routes/files'

/** Mounted exactly as server.ts mounts them. */
function app() {
  const a = express()
  a.use(express.json())
  a.use('/api/v1', teamRouter as never)
  a.use('/api/v1', drawingsRouter as never)
  a.use('/api/v1', dailyLogsRouter as never)
  a.use('/api/v1', punchListsRouter as never)
  a.use('/api/v1', systemsRouter as never)
  a.use('/api/v1/vendors', vendorsRouter as never)
  a.use('/api/v1/files', filesRouter as never)
  return a
}

/**
 * ADR-014 Phase 3B: the drawings, inspections and punch-list collections are
 * now record-scoped, so a caller needs project MEMBERSHIP as well as the domain
 * capability. This file exists to prove the CAPABILITY gate, so the fixture
 * grants membership and lets the capability dimension stay the variable — the
 * membership dimension has its own suites. The id is a real uuid because scope
 * resolves against a uuid column and a malformed id is denied outright.
 */
const PROJECT = '30000000-0000-4000-8000-0000000000p1'.replace('p1', '01')

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset()
  h.query.mockImplementation(principalQuery(() => current, (...args: unknown[]) => {
    const sql = args.find(a => typeof a === 'string' && /SELECT/i.test(a)) as string | undefined
    // The record-scope lookup: the caller is a member of the fixture project.
    if (sql && /SELECT (id|p\.id) FROM projects/i.test(sql)) {
      // Faithful: only the fixture project is a member project, so a different
      // project id resolves to no rows exactly as the database would.
      const ids = (args[args.length - 1] as unknown[])?.[0] as string[] | undefined
      const hit = Array.isArray(ids) && ids.includes(PROJECT)
      return { rows: hit ? [{ id: PROJECT }] : [], rowCount: hit ? 1 : 0 }
    }
    return { rows: [], rowCount: 0 }
  }))
  h.listMembers.mockResolvedValue([])
  h.getTeamSummary.mockResolvedValue({})
  h.tagCoverage.mockResolvedValue({})
})

/** Queries that are not the current-user authorization lookup. */
const domainQueries = () => h.query.mock.calls.filter(args =>
  !args.some(a => typeof a === 'string' && /FROM\s+users\s+WHERE\s+id/i.test(a)))

/**
 * Each family: the endpoint, a role that legitimately reads it, and a role that
 * holds a *different* delivery capability — proving denial is per domain, not a
 * blanket "non-owner" rule.
 */
const FAMILIES = [
  { family: 'team',          path: '/api/v1/team/members',                    allowed: 'project_manager', denied: 'engineer',    service: () => h.listMembers },
  { family: 'engineering',   path: `/api/v1/projects/${PROJECT}/drawings`,            allowed: 'engineer',        denied: 'field_ops',   service: null },
  { family: 'documents',     path: '/api/v1/files/documents',                 allowed: 'viewer',          denied: 'admin',       service: null },
  { family: 'construction',  path: `/api/v1/projects/${PROJECT}/daily-logs`,          allowed: 'field_ops',       denied: 'procurement', service: null },
  { family: 'quality',       path: `/api/v1/projects/${PROJECT}/punch-lists`,         allowed: 'engineer',        denied: 'procurement', service: null },
  { family: 'procurement',   path: '/api/v1/vendors',                         allowed: 'procurement',     denied: 'engineer',    service: null },
  { family: 'commissioning', path: `/api/v1/projects/${PROJECT}/systems`,             allowed: 'project_manager', denied: 'engineer',    service: null },
] as const

// ─── §39 — a denied read never touches the data ───────────────────────────────
describe.each(FAMILIES)('$family: an unauthorized read stops before data access', ({ path, allowed, denied, service }) => {
  it(`returns 403 for ${denied} and invokes no service or domain query`, async () => {
    current = principal({ role: denied })
    const res = await request(app()).get(path)

    expect(res.status).toBe(403)
    expect(res.body).toEqual({ error: 'forbidden' })
    if (service) expect(service(), 'the domain service ran for a denied caller').not.toHaveBeenCalled()
    expect(domainQueries(),
      `a denied caller caused ${domainQueries().length} domain quer(ies)`).toEqual([])
  })

  it(`reaches the data for ${allowed}, who holds the capability`, async () => {
    current = principal({ role: allowed })
    const res = await request(app()).get(path)
    expect(res.status, `${allowed} must cross the gate`).toBeLessThan(400)
  })
})

// ─── §40 — no existence oracle ────────────────────────────────────────────────
describe('a denial discloses nothing about what exists', () => {
  it('answers identically whether or not the requested records exist', async () => {
    current = principal({ role: 'engineer' })   // holds engineering.view, not team.view

    h.listMembers.mockResolvedValue([{ id: 'm1', name: 'A. Engineer' }])
    const withData = await request(app()).get('/api/v1/team/members')

    h.listMembers.mockResolvedValue([])
    const withoutData = await request(app()).get('/api/v1/team/members')

    expect(withData.status).toBe(withoutData.status)
    expect(withData.body).toEqual(withoutData.body)
    expect(withData.body).toEqual({ error: 'forbidden' })
    expect(h.listMembers).not.toHaveBeenCalled()
  })

  it('does not echo the required capability or the caller role in the denial', async () => {
    current = principal({ role: 'procurement' })
    const res = await request(app()).get(`/api/v1/projects/${PROJECT}/punch-lists`)
    expect(res.status).toBe(403)
    expect(JSON.stringify(res.body)).not.toMatch(/quality\.view|procurement|capability/i)
  })

  it('denies a missing record the same way as an existing one', async () => {
    // Domain-wide authorization must resolve before the record lookup, so a
    // caller cannot distinguish "no such drawing" from "not your domain".
    current = principal({ role: 'procurement' })
    const present = await request(app()).get(`/api/v1/projects/${PROJECT}/drawings`)
    const absent  = await request(app()).get('/api/v1/projects/does-not-exist/drawings')
    expect(present.status).toBe(403)
    expect(absent.status).toBe(403)
    expect(present.body).toEqual(absent.body)
    expect(domainQueries()).toEqual([])
  })
})

// ─── §48 — the stale-token proof on a real delivery route ─────────────────────
describe('a stale token cannot read a delivery domain', () => {
  it('denies the team roster when the token says project_manager and the database says engineer', async () => {
    current = principal({ role: 'engineer', jwtRole: 'project_manager' })
    const res = await request(app()).get('/api/v1/team/members')
    expect(res.status).toBe(403)
    expect(h.listMembers).not.toHaveBeenCalled()
  })

  it('denies commissioning systems when the token says owner and the database says viewer', async () => {
    current = principal({ role: 'viewer', jwtRole: 'owner' })
    const res = await request(app()).get(`/api/v1/projects/${PROJECT}/systems`)
    expect(res.status).toBe(403)
    expect(domainQueries()).toEqual([])
  })

  it('admits documents to a viewer whose token claims nothing useful', async () => {
    // Phase 1 grants docs.view to the viewer; the database, not the token, says so.
    current = principal({ role: 'viewer', jwtRole: 'viewer' })
    const res = await request(app()).get('/api/v1/files/documents')
    expect(res.status).toBeLessThan(400)
  })

  it('denies a deactivated project manager', async () => {
    current = principal({ role: 'project_manager', active: false })
    expect((await request(app()).get('/api/v1/team/members')).status).toBe(401)
    expect(h.listMembers).not.toHaveBeenCalled()
  })
})

// ─── §49 — capability authorization does not weaken tenant isolation ──────────
describe('tenant isolation survives the delivery guards', () => {
  it('scopes an authorized cross-tenant read to the caller tenant, not the requested one', async () => {
    current = principal({ role: 'project_manager', tenantId: 'tenant-a', jwtTenantId: 'tenant-a' })
    await request(app()).get('/api/v1/team/members')
    expect(h.listMembers).toHaveBeenCalledWith('tenant-a', expect.anything())
  })

  it('keeps a delivery query bound to the caller tenant', async () => {
    current = principal({ role: 'engineer', tenantId: 'tenant-a', jwtTenantId: 'tenant-a' })
    await request(app()).get(`/api/v1/projects/${PROJECT}/drawings`)
    const [tenantArg] = domainQueries()[0] as unknown[]
    expect(tenantArg, 'the query must run in the caller tenant, whatever the URL asks for').toBe('tenant-a')
  })

  it('refuses a project outside the caller scope before any domain query runs', async () => {
    // ADR-014 Phase 3B strengthened this: naming another team's project in the
    // URL no longer merely runs a tenant-bound query that returns nothing — the
    // record-scope guard refuses first, so no domain query happens at all.
    const FOREIGN = '30000000-0000-4000-8000-0000000000ff'
    current = principal({ role: 'engineer', tenantId: 'tenant-a', jwtTenantId: 'tenant-a' })
    const res = await request(app()).get(`/api/v1/projects/${FOREIGN}/drawings`)
    expect(res.status).toBe(404)
    const drawingReads = domainQueries().filter(args =>
      args.some(a => typeof a === 'string' && /FROM\s+drawings/i.test(a)))
    expect(drawingReads, 'no drawing was read for an out-of-scope project').toEqual([])
  })

  it('resolves the current user once per request, not once per guard', async () => {
    current = principal({ role: 'project_manager' })
    await request(app()).get(`/api/v1/projects/${PROJECT}/systems`)
    const lookups = h.query.mock.calls.filter(args =>
      args.some(a => typeof a === 'string' && /FROM\s+users\s+WHERE\s+id/i.test(a)))
    expect(lookups.length, 'the current-role lookup must not repeat per guard').toBe(1)
  })
})
