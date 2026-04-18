/**
 * Tests: api/services/scheduler.ts
 * Covers the handler registry, enqueue helper, and promoter registration.
 * The poll loop itself is not started — we never call startScheduler().
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

const mockQuery = vi.fn()
vi.mock('../db/pool', () => ({
  tenantQuery: (tenantId: string, sql: string, params: unknown[]) => mockQuery(tenantId, sql, params),
  query:       (sql: string, params: unknown[]) => mockQuery(null, sql, params),
}))

import {
  registerHandler,
  listRegisteredHandlers,
  enqueue,
  registerPromoter,
} from '../services/scheduler'

describe('scheduler — handler registry', () => {
  beforeEach(() => vi.clearAllMocks())

  it('registers and lists handlers', () => {
    registerHandler('test_alpha', async () => {})
    registerHandler('test_beta',  async () => {})
    const names = listRegisteredHandlers()
    expect(names).toContain('test_alpha')
    expect(names).toContain('test_beta')
  })

  it('replaces an existing handler on re-registration (hot swap)', async () => {
    const first  = vi.fn(async () => ({ v: 1 }))
    const second = vi.fn(async () => ({ v: 2 }))
    registerHandler('test_swap', first)
    registerHandler('test_swap', second)
    expect(listRegisteredHandlers().filter(n => n === 'test_swap')).toHaveLength(1)
  })
})

describe('scheduler — enqueue', () => {
  beforeEach(() => vi.clearAllMocks())

  it('inserts a row and returns the new id', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'job-123' }] })
    const id = await enqueue('tenant-1', 'webhook_dispatch', { foo: 'bar' })
    expect(id).toBe('job-123')
    const [, sql, params] = mockQuery.mock.calls[0]!
    expect(sql).toMatch(/INSERT INTO background_jobs/)
    expect(params[0]).toBe('tenant-1')
    expect(params[3]).toBe('webhook_dispatch')
    expect(params[4]).toBe(JSON.stringify({ foo: 'bar' }))
  })

  it('applies optional maxAttempts and runAfter', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'job-xyz' }] })
    const at = new Date('2026-05-01T00:00:00Z')
    await enqueue('tenant-1', 'snapshot_kpis', {}, { maxAttempts: 5, runAfter: at })
    const [, , params] = mockQuery.mock.calls[0]!
    expect(params[5]).toBe(5)                  // max_attempts
    expect(params[6]).toBe(at.toISOString())   // run_after
  })
})

describe('scheduler — promoter registry', () => {
  it('accepts a promoter function without error', () => {
    expect(() => registerPromoter(async () => {})).not.toThrow()
  })
})
