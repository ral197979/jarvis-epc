/**
 * EPC Core — F04 + F05 gate tests (v4.32.0)
 *
 * F04: _failJob duplicate-column fix — asserts the UPDATE SQL no longer has
 *      two `status` assignments (source inspection).
 * F05: POST /test-packs must reject requests missing systemId with 400.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// ─── Mock DB pool ─────────────────────────────────────────────────────────────
const mockQuery = vi.fn()
vi.mock('../db/pool', () => ({
  tenantQuery:       (tenantId: string, sql: string, params: unknown[]) => mockQuery(tenantId, sql, params),
  tenantTransaction: async <T>(_tenantId: string, fn: (q: any) => Promise<T>) =>
    fn({ query: (sql: string, params: unknown[]) => mockQuery(null, sql, params) }),
  query:             (sql: string, params: unknown[]) => mockQuery(null, sql, params),
}))

vi.mock('../auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.auth = { sub: 'user-1', tid: 'tenant-1', role: 'project_manager', jti: 'abc' }
    next()
  },
}))

vi.mock('../middleware/tenant', () => ({
  requireTenant: () => (req: any, _res: any, next: any) => {
    req.tenantId = 'tenant-1'
    next()
  },
}))

vi.mock('../../src/modules/observability/index', () => {
  const slog: any = vi.fn()
  slog.info  = vi.fn()
  slog.warn  = vi.fn()
  slog.error = vi.fn()
  slog.debug = vi.fn()
  return { slog }
})

import express from 'express'
import request from 'supertest'
import { testPacksRouter } from '../routes/testPacks'

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1', testPacksRouter as any)
  return app
}

const app = makeApp()

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── F05: test-packs gate ─────────────────────────────────────────────────────

describe('F05: POST /test-packs systemId gate', () => {
  it('rejects when systemId is missing', async () => {
    const res = await request(app)
      .post('/api/v1/test-packs')
      .send({ projectId: 'proj-1', packNo: 'TP-001', title: 'Pump Test', packType: 'functional' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('validation')
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('rejects when projectId is missing', async () => {
    const res = await request(app)
      .post('/api/v1/test-packs')
      .send({ systemId: 'sys-1', packNo: 'TP-001', title: 'Pump Test', packType: 'functional' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('validation')
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('rejects title-only packs (no systemId, no packNo, no packType)', async () => {
    const res = await request(app)
      .post('/api/v1/test-packs')
      .send({ projectId: 'proj-1', title: 'Synthetic Pack' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('validation')
  })

  it('calls DB when all required fields are present', async () => {
    // tenantTransaction calls fn(mockQuery):
    //   1st call: assertSystemInScope (returns the system row)
    //   2nd call: INSERT test_packs (returns the new pack row)
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'sys-1' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{
        id: 'pack-1', pack_no: 'TP-001', title: 'Pump Test',
        pack_type: 'functional', status: 'draft', revision: 'A',
        generated_from: 'manual', project_id: 'proj-1', system_id: 'sys-1',
        subsystem_id: null, tag_id: null, commissioning_item_id: null,
        tenant_id: 'tenant-1',
        created_at: '2026-04-22T00:00:00Z',
        updated_at: '2026-04-22T00:00:00Z',
      }], rowCount: 1 })
    const res = await request(app)
      .post('/api/v1/test-packs')
      .send({ projectId: 'proj-1', systemId: 'sys-1', packNo: 'TP-001', title: 'Pump Test', packType: 'functional' })
    expect(res.status).toBe(201)
    expect(res.body.item).toBeDefined()
    expect(mockQuery).toHaveBeenCalled()
  })
})

// ─── F04: packWorker _failJob SQL ─────────────────────────────────────────────

describe('F04: packWorker _failJob SQL', () => {
  it('UPDATE has no duplicate status column after fix', () => {
    const src = readFileSync(
      join(process.cwd(), 'api/services/packWorker.ts'), 'utf8',
    )
    // Isolate just the UPDATE block inside _failJob
    const fnStart  = src.indexOf('async function _failJob(')
    const fnEnd    = src.indexOf('\nasync function', fnStart + 1)
    const fnSource = fnEnd > -1 ? src.slice(fnStart, fnEnd) : src.slice(fnStart)

    // Must have exactly one status assignment
    const statusAssignments = (fnSource.match(/\bstatus\s*=/g) ?? []).length
    expect(statusAssignments).toBe(1)
  })

  it('UPDATE param list has 4 values (not 5) after duplicate removal', () => {
    const src = readFileSync(
      join(process.cwd(), 'api/services/packWorker.ts'), 'utf8',
    )
    const fnStart  = src.indexOf('async function _failJob(')
    const fnEnd    = src.indexOf('\nasync function', fnStart + 1)
    const fnSource = fnEnd > -1 ? src.slice(fnStart, fnEnd) : src.slice(fnStart)

    // The highest $N in the fixed SQL should be $4, not $5
    const paramRefs = (fnSource.match(/\$(\d+)/g) ?? []).map(p => parseInt(p.slice(1), 10))
    const maxParam  = Math.max(...paramRefs)
    expect(maxParam).toBe(4)
  })
})

// ─── F05 coverage endpoint ────────────────────────────────────────────────────

import { getTagPackCoverage } from '../services/epcCore'

// getTagPackCoverage now runs two parallel queries:
//   call[0] = summary COUNT (params: [projectId])
//   call[1] = paginated tags (params: [projectId, limit, offset])
describe('F05: getTagPackCoverage', () => {
  const ctx = { tenantId: 'tenant-1', projectId: 'proj-1' }

  it('returns zeroed summary when project has no tags', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total_tags: '0', covered_tags: '0' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
    const report = await getTagPackCoverage(ctx)
    expect(report.summary).toEqual({
      total_tags: 0, covered_tags: 0, uncovered_tags: 0, coverage_pct: 0,
    })
    expect(report.tags).toHaveLength(0)
  })

  it('counts covered vs uncovered tags correctly from summary query', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total_tags: '3', covered_tags: '2' }], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [
          { tag_id: 't1', tag_no: 'TAG-001', equipment_name: 'Pump A', system_id: 'sys-1', tag_status: 'active', packs: [{ id: 'p1', pack_no: 'TP-001', pack_type: 'functional', status: 'approved' }] },
          { tag_id: 't2', tag_no: 'TAG-002', equipment_name: 'Pump B', system_id: 'sys-1', tag_status: 'active', packs: [] },
          { tag_id: 't3', tag_no: 'TAG-003', equipment_name: 'Valve C', system_id: 'sys-1', tag_status: 'active', packs: [{ id: 'p2', pack_no: 'TP-002', pack_type: 'loop', status: 'draft' }] },
        ],
        rowCount: 3,
      })
    const report = await getTagPackCoverage(ctx)
    expect(report.summary).toEqual({
      total_tags: 3, covered_tags: 2, uncovered_tags: 1, coverage_pct: 67,
    })
    expect(report.tags).toHaveLength(3)
  })

  it('summary uses only projectId; tags query uses projectId + limit + offset', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total_tags: '0', covered_tags: '0' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
    await getTagPackCoverage({ ...ctx, limit: 25, offset: 50 })
    const calls = mockQuery.mock.calls as [string, string, unknown[]][]
    // Summary query: only [projectId]
    expect(calls[0][2]).toEqual(['proj-1'])
    // Tags query: [projectId, limit, offset]
    expect(calls[1][2]).toEqual(['proj-1', 25, 50])
  })

  it('returns pagination metadata in response', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total_tags: '10', covered_tags: '5' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
    const report = await getTagPackCoverage({ ...ctx, limit: 5, offset: 0 })
    expect(report.pagination).toEqual({ limit: 5, offset: 0, total: 10 })
  })

  it('returns 100% coverage when summary reports all covered', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total_tags: '1', covered_tags: '1' }], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [{ tag_id: 't1', tag_no: 'TAG-001', equipment_name: 'E1', system_id: 's1', tag_status: 'active', packs: [{ id: 'p1', pack_no: 'TP-001', pack_type: 'functional', status: 'approved' }] }],
        rowCount: 1,
      })
    const report = await getTagPackCoverage(ctx)
    expect(report.summary.coverage_pct).toBe(100)
    expect(report.summary.uncovered_tags).toBe(0)
  })
})
