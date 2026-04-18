/**
 * Tests: api/services/fieldSync.ts + api/routes/fieldSync.ts
 * Covers idempotency replay, conflict detection, validation, batch dispatch.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ─── DB pool mocks ────────────────────────────────────────────────────────────

const mockQuery = vi.fn()
const mockClientQuery = vi.fn()

vi.mock('../db/pool', () => ({
  tenantQuery: (tenantId: string, sql: string, params: unknown[]) => mockQuery(tenantId, sql, params),
  // tenantTransaction receives a fn; we invoke it with a fake client whose
  // .query delegates to mockClientQuery so the test controls every call.
  tenantTransaction: async (tenantId: string, fn: (client: any) => any) => {
    const fakeClient = { query: (sql: string, params?: unknown[]) => mockClientQuery(tenantId, sql, params) }
    return fn(fakeClient)
  },
}))

// ─── Auth / tenant mocks ──────────────────────────────────────────────────────

vi.mock('../auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.auth = { sub: 'user-1', role: 'engineer', tid: 'tenant-1', jti: 'j' }
    next()
  },
}))

vi.mock('../middleware/tenant', () => ({
  requireTenant: () => (req: any, _res: any, next: any) => {
    req.tenantId = 'tenant-1'
    next()
  },
}))

import express from 'express'
import request from 'supertest'
import { processFieldSyncBatch } from '../services/fieldSync'
import fieldSyncRouter from '../routes/fieldSync'

const UUID_A = '11111111-1111-4111-8111-111111111111'
const UUID_B = '22222222-2222-4222-8222-222222222222'
const UUID_ITEM = '33333333-3333-4333-8333-333333333333'

// ═══════════════════════════════════════════════════════════════════════════
// Service — processFieldSyncBatch
// ═══════════════════════════════════════════════════════════════════════════

describe('fieldSync service — validation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects non-UUID client_op_id without hitting DB', async () => {
    const results = await processFieldSyncBatch('tenant-1', 'user-1', [
      { client_op_id: 'not-a-uuid', resource: 'action_items', op: 'create', data: { title: 'x' } },
    ])
    expect(results[0].status).toBe('error')
    expect(results[0].error).toMatch(/UUID/)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('rejects unsupported resource', async () => {
    const results = await processFieldSyncBatch('tenant-1', 'user-1', [
      { client_op_id: UUID_A, resource: 'not_a_table', op: 'create', data: {} },
    ])
    expect(results[0].status).toBe('error')
    expect(results[0].error).toMatch(/unsupported resource/)
  })

  it('rejects update without id', async () => {
    const results = await processFieldSyncBatch('tenant-1', 'user-1', [
      { client_op_id: UUID_A, resource: 'action_items', op: 'update', data: {} },
    ])
    expect(results[0].status).toBe('error')
    expect(results[0].error).toMatch(/update requires id/)
  })
})

describe('fieldSync service — idempotency replay', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns cached result for an already-processed client_op_id', async () => {
    // Fast-path SELECT returns the cached row — no transaction opened.
    mockQuery.mockResolvedValueOnce({
      rows: [{ status: 'success', resource_id: UUID_ITEM, response_body: { id: UUID_ITEM, title: 'x' } }],
    })
    const results = await processFieldSyncBatch('tenant-1', 'user-1', [
      { client_op_id: UUID_A, resource: 'action_items', op: 'create', data: { title: 'x' } },
    ])
    expect(results[0].status).toBe('replay')
    expect(results[0].resource_id).toBe(UUID_ITEM)
    expect(mockClientQuery).not.toHaveBeenCalled()   // never entered the transaction
  })
})

describe('fieldSync service — create path', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reserves slot, inserts action_item, records result', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })                             // cache miss
    mockClientQuery
      .mockResolvedValueOnce({ rows: [{ id: 'reservation-1' }] })            // reservation insert
      .mockResolvedValueOnce({ rows: [{ id: UUID_ITEM, title: 'x' }] })      // action_item insert
      .mockResolvedValueOnce({ rows: [] })                                   // update idempotency row

    const results = await processFieldSyncBatch('tenant-1', 'user-1', [
      { client_op_id: UUID_A, resource: 'action_items', op: 'create', data: { title: 'x' } },
    ])
    expect(results[0].status).toBe('success')
    expect(results[0].resource_id).toBe(UUID_ITEM)
    // Sanity: idempotency row got final status (4th call in transaction)
    const finalUpdate = mockClientQuery.mock.calls.find(c => /UPDATE field_sync_operations/.test(c[1]))
    expect(finalUpdate).toBeTruthy()
  })

  it('returns error from resource dispatch when required field missing', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    mockClientQuery
      .mockResolvedValueOnce({ rows: [{ id: 'reservation-2' }] })
      .mockResolvedValueOnce({ rows: [] })                                   // update idempotency row

    const results = await processFieldSyncBatch('tenant-1', 'user-1', [
      { client_op_id: UUID_A, resource: 'action_items', op: 'create', data: {} },   // missing title
    ])
    expect(results[0].status).toBe('error')
    expect(results[0].error).toMatch(/title required/)
  })

  it('handles race where sibling request won the reservation', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] })                                     // ON CONFLICT DO NOTHING
      .mockResolvedValueOnce({                                                  // SELECT committed row
        rows: [{ status: 'success', resource_id: UUID_ITEM, response_body: { id: UUID_ITEM } }],
      })

    const results = await processFieldSyncBatch('tenant-1', 'user-1', [
      { client_op_id: UUID_A, resource: 'action_items', op: 'create', data: { title: 'x' } },
    ])
    expect(results[0].status).toBe('replay')
    expect(results[0].resource_id).toBe(UUID_ITEM)
  })
})

describe('fieldSync service — update with optimistic lock', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns success when base_updated_at matches', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    mockClientQuery
      .mockResolvedValueOnce({ rows: [{ id: 'reservation-3' }] })
      .mockResolvedValueOnce({ rows: [{ id: UUID_ITEM, title: 'new', updated_at: '2026-04-18T10:00:00Z' }] })
      .mockResolvedValueOnce({ rows: [] })

    const results = await processFieldSyncBatch('tenant-1', 'user-1', [
      { client_op_id: UUID_A, resource: 'action_items', op: 'update',
        id: UUID_ITEM, base_updated_at: '2026-04-18T09:00:00Z',
        data: { title: 'new' } },
    ])
    expect(results[0].status).toBe('success')
  })

  it('returns conflict with current row when updated_at mismatches', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    mockClientQuery
      .mockResolvedValueOnce({ rows: [{ id: 'reservation-4' }] })
      .mockResolvedValueOnce({ rows: [] })                                   // UPDATE matched 0 rows
      .mockResolvedValueOnce({                                                // SELECT current row
        rows: [{ id: UUID_ITEM, title: 'someone-else-wrote', updated_at: '2026-04-18T11:00:00Z' }],
      })
      .mockResolvedValueOnce({ rows: [] })                                   // update idempotency row

    const results = await processFieldSyncBatch('tenant-1', 'user-1', [
      { client_op_id: UUID_A, resource: 'action_items', op: 'update',
        id: UUID_ITEM, base_updated_at: '2026-04-18T09:00:00Z',
        data: { title: 'stale' } },
    ])
    expect(results[0].status).toBe('conflict')
    expect(results[0].current).toMatchObject({ title: 'someone-else-wrote' })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Route — /api/v1/field-sync/batch
// ═══════════════════════════════════════════════════════════════════════════

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/field-sync', fieldSyncRouter)
  return app
}

describe('field-sync route', () => {
  beforeEach(() => vi.clearAllMocks())

  it('422 when operations is not an array', async () => {
    const res = await request(makeApp()).post('/api/v1/field-sync/batch').send({ operations: 'nope' })
    expect(res.status).toBe(422)
  })

  it('empty batch returns empty results', async () => {
    const res = await request(makeApp()).post('/api/v1/field-sync/batch').send({ operations: [] })
    expect(res.status).toBe(200)
    expect(res.body.results).toEqual([])
  })

  it('rejects oversized batch with 413', async () => {
    const ops = Array.from({ length: 101 }, () => ({
      client_op_id: UUID_A, resource: 'action_items', op: 'create', data: { title: 'x' },
    }))
    const res = await request(makeApp()).post('/api/v1/field-sync/batch').send({ operations: ops })
    expect(res.status).toBe(413)
  })

  it('processes valid batch and returns per-op results', async () => {
    // op 1 = replay (cached), op 2 = validation error
    mockQuery.mockResolvedValueOnce({
      rows: [{ status: 'success', resource_id: UUID_ITEM, response_body: { id: UUID_ITEM } }],
    })
    const res = await request(makeApp()).post('/api/v1/field-sync/batch').send({
      operations: [
        { client_op_id: UUID_A, resource: 'action_items', op: 'create', data: { title: 'x' } },
        { client_op_id: UUID_B, resource: 'not_supported', op: 'create', data: {} },
      ],
    })
    expect(res.status).toBe(200)
    expect(res.body.results).toHaveLength(2)
    expect(res.body.results[0].status).toBe('replay')
    expect(res.body.results[1].status).toBe('error')
  })
})
