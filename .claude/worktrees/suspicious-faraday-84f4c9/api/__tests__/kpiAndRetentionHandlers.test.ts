/**
 * Tests: api/services/kpiSnapshot.ts + api/services/auditRetention.ts
 * Two small handlers; one file keeps the setup noise low.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

const mockQuery = vi.fn()
vi.mock('../db/pool', () => ({
  tenantQuery: (tenantId: string, sql: string, params: unknown[]) => mockQuery(tenantId, sql, params),
  query:       (sql: string, params: unknown[]) => mockQuery(null, sql, params),
}))

import { __testHooks as kpi } from '../services/kpiSnapshot'
import { __testHooks as retention } from '../services/auditRetention'
import type { BackgroundJob } from '../services/scheduler'

function job(overrides: Partial<BackgroundJob> = {}): BackgroundJob {
  return {
    id: 'job-1', tenant_id: 'tenant-1', scheduled_job_id: null, created_by: null,
    job_type: 'test', payload_json: {}, attempts: 1, max_attempts: 3,
    ...overrides,
  }
}

// ─── KPI snapshot handler ─────────────────────────────────────────────────────

describe('kpiSnapshot — handleSnapshotJob', () => {
  beforeEach(() => vi.clearAllMocks())

  it('computes metrics and inserts a snapshot row', async () => {
    // First query = aggregate SELECT; second = INSERT returning id
    mockQuery.mockResolvedValueOnce({
      rows: [{
        projects_total: '12', projects_active: '7', projects_completed: '4', projects_on_hold: '1',
        total_budget: '5000000', total_committed: '2500000', total_actual: '1800000', total_forecast: '4900000',
        rfis_open: '3', submittals_pending: '5', risks_open: '2', actions_open: '8', actions_overdue: '1',
      }],
    })
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'snap-1' }] })

    const result = await kpi.handleSnapshotJob(job()) as Record<string, unknown>

    expect(result['snapshotId']).toBe('snap-1')
    const metrics = result['metrics'] as Record<string, number>
    expect(metrics.projects_total).toBe(12)
    expect(metrics.total_budget).toBe(5_000_000)
    expect(metrics.actions_overdue).toBe(1)
  })

  it('coerces null/invalid counts to 0', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        projects_total: null, projects_active: '0', projects_completed: '0', projects_on_hold: '0',
        total_budget: null, total_committed: null, total_actual: null, total_forecast: null,
        rfis_open: '0', submittals_pending: '0', risks_open: '0', actions_open: '0', actions_overdue: '0',
      }],
    })
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'snap-2' }] })

    const result = await kpi.handleSnapshotJob(job()) as Record<string, unknown>
    const metrics = result['metrics'] as Record<string, number>
    expect(metrics.projects_total).toBe(0)
    expect(metrics.total_budget).toBe(0)
  })

  it('throws when the aggregate query returns no rows', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    await expect(kpi.handleSnapshotJob(job())).rejects.toThrow(/aggregation returned no rows/)
  })
})

// ─── Audit retention handler ──────────────────────────────────────────────────

describe('auditRetention — handlePurgeJob', () => {
  beforeEach(() => vi.clearAllMocks())

  it('deletes rows older than the tenants configured window', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ audit_retention_days: 365 }] })
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'a' }, { id: 'b' }], rowCount: 2 })

    const result = await retention.handlePurgeJob(job()) as Record<string, unknown>

    expect(result['purged']).toBe(2)
    expect(result['retentionDays']).toBe(365)
    expect(result['batched']).toBe(false)

    const [, sql, params] = mockQuery.mock.calls[1]!
    expect(sql).toMatch(/DELETE FROM audit_log/)
    expect(params[0]).toBe('tenant-1')
    expect(params[1]).toBe(365)
  })

  it('skips cleanly when retention_days = 0 (disabled)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ audit_retention_days: 0 }] })

    const result = await retention.handlePurgeJob(job()) as Record<string, unknown>
    expect(result['skipped']).toBe(true)
    expect(result['purged']).toBe(0)
    // only the tenant lookup ran — no DELETE
    expect(mockQuery).toHaveBeenCalledTimes(1)
  })

  it('throws when the tenant row is missing', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    await expect(retention.handlePurgeJob(job())).rejects.toThrow(/Tenant not found/)
  })
})
