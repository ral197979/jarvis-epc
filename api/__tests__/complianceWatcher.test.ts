/**
 * Tests: api/services/complianceWatcher.ts
 * Covers the two state transitions (pending→notified, notified→overdue)
 * and verifies emitEvent is called with the right payload for each row.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

const mockQuery = vi.fn()
vi.mock('../db/pool', () => ({
  tenantQuery: (tenantId: string, sql: string, params: unknown[]) => mockQuery(tenantId, sql, params),
  query:       (sql: string, params: unknown[]) => mockQuery(null, sql, params),
}))

const mockEmit = vi.fn()
vi.mock('../services/webhookDispatch', () => ({
  emitEvent: (tenantId: string, eventType: string, payload: Record<string, unknown>) =>
    mockEmit(tenantId, eventType, payload),
}))

import { __testHooks } from '../services/complianceWatcher'

function row(overrides: Record<string, unknown> = {}) {
  return {
    id:          'task-1',
    tenant_id:   'tenant-1',
    title:       'JHA Renewal',
    category:    'jha',
    due_date:    '2026-05-15',
    project_id:  null,
    assigned_to: null,
    ...overrides,
  }
}

describe('complianceWatcher — scan transitions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __testHooks.resetThrottle()
  })

  it('emits compliance.task_due for each pending→notified row', async () => {
    // Phase 1: return 2 due-soon rows
    mockQuery.mockResolvedValueOnce({ rows: [row({ id: 'a' }), row({ id: 'b', category: 'permit' })] })
    // Phase 2: no overdue rows
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await __testHooks.scanOnce()

    expect(mockEmit).toHaveBeenCalledTimes(2)
    expect(mockEmit).toHaveBeenCalledWith('tenant-1', 'compliance.task_due',
      expect.objectContaining({ taskId: 'a', category: 'jha' }))
    expect(mockEmit).toHaveBeenCalledWith('tenant-1', 'compliance.task_due',
      expect.objectContaining({ taskId: 'b', category: 'permit' }))
  })

  it('emits compliance.task_overdue for each overdue row', async () => {
    __testHooks.resetThrottle()
    mockQuery.mockResolvedValueOnce({ rows: [] })                             // no due-soon
    mockQuery.mockResolvedValueOnce({ rows: [row({ id: 'c', due_date: '2026-04-01' })] })

    await __testHooks.scanOnce()

    expect(mockEmit).toHaveBeenCalledTimes(1)
    expect(mockEmit).toHaveBeenCalledWith('tenant-1', 'compliance.task_overdue',
      expect.objectContaining({ taskId: 'c' }))
  })

  it('emits nothing when no rows transition', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    mockQuery.mockResolvedValueOnce({ rows: [] })
    await __testHooks.scanOnce()
    expect(mockEmit).not.toHaveBeenCalled()
  })

  it('self-throttles to avoid repeated DB scans', async () => {
    mockQuery.mockResolvedValue({ rows: [] })
    await __testHooks.scanOnce()            // first call fires queries
    const callsAfterFirst = mockQuery.mock.calls.length
    await __testHooks.scanOnce()            // second call should short-circuit
    expect(mockQuery.mock.calls.length).toBe(callsAfterFirst)
  })
})
