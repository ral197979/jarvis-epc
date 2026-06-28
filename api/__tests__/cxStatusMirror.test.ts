/**
 * Tests: api/services/integration/cxStatusMirror.ts
 *
 * reduceEvent is pure — exercised directly. applyInboundEvent is tested with a
 * mocked tenantQuery to prove idempotency (duplicate event_id → no mirror write).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const mockTenantQuery = vi.fn()
vi.mock('../db/pool', () => ({
  tenantQuery: (tenantId: string, sql: string, params: unknown[]) => mockTenantQuery(tenantId, sql, params),
}))

import { reduceEvent, applyInboundEvent } from '../services/integration/cxStatusMirror'

describe('reduceEvent (pure)', () => {
  it('maps cx.phase_changed with embedded counts', () => {
    const p = reduceEvent('cx.phase_changed', { phase: 'sat_testing', counts: { deficiencies_open: 4, ncr_open: 1, punch_open: 12 } })
    expect(p).toEqual({ phase: 'sat_testing', deficiencies_open: 4, ncr_open: 1, punch_open: 12 })
  })

  it('maps fat/sat status + readiness', () => {
    expect(reduceEvent('cx.fat_status_changed', { status: 'passed', readiness_pct: 100 }))
      .toEqual({ fat_status: 'passed', fat_readiness_pct: 100 })
    expect(reduceEvent('cx.sat_status_changed', { status: 'in_progress', readiness_pct: 60 }))
      .toEqual({ sat_status: 'in_progress', sat_readiness_pct: 60 })
  })

  it('maps counts_changed', () => {
    expect(reduceEvent('cx.counts_changed', { deficiencies_open: 2, ncr_open: 0, punch_open: 5 }))
      .toEqual({ deficiencies_open: 2, ncr_open: 0, punch_open: 5 })
  })

  it('maps accepted / rejected to a phase', () => {
    expect(reduceEvent('cx.accepted')).toEqual({ phase: 'accepted' })
    expect(reduceEvent('cx.rejected')).toEqual({ phase: 'rejected' })
  })

  it('collects published reports into references', () => {
    const p = reduceEvent('cx.report_published', { report_type: 'fat_report', url: 'https://cx/fat.pdf', sha256: 'ab12' })
    expect(p.references).toEqual({ reports: [{ type: 'fat_report', url: 'https://cx/fat.pdf', sha256: 'ab12' }] })
  })

  it('ignores unknown event types', () => {
    expect(reduceEvent('cx.something_new', { foo: 'bar' })).toEqual({})
  })

  it('ignores non-finite / wrong-typed fields', () => {
    expect(reduceEvent('cx.fat_status_changed', { status: 123, readiness_pct: 'oops' }))
      .toEqual({ fat_status: null })
  })
})

describe('applyInboundEvent (idempotency)', () => {
  beforeEach(() => mockTenantQuery.mockReset())

  const evt = { event_id: 'e1', event: 'cx.phase_changed', tenant_id: 't1', handoff_id: 'hx1', data: { phase: 'fat_testing' } }

  it('processes a fresh event and writes the mirror', async () => {
    mockTenantQuery
      .mockResolvedValueOnce({ rows: [{ id: 'led1' }] }) // idempotency insert → new row
      .mockResolvedValueOnce({ rows: [] })               // mirror upsert
    const r = await applyInboundEvent('t1', evt)
    expect(r).toEqual({ processed: true })
    expect(mockTenantQuery).toHaveBeenCalledTimes(2)
    expect(mockTenantQuery.mock.calls[1][1]).toContain('INSERT INTO cx_status_mirror')
  })

  it('is a no-op on a duplicate event_id (no mirror write)', async () => {
    mockTenantQuery.mockResolvedValueOnce({ rows: [] }) // idempotency insert → conflict, nothing returned
    const r = await applyInboundEvent('t1', evt)
    expect(r).toEqual({ processed: false })
    expect(mockTenantQuery).toHaveBeenCalledTimes(1) // never reached the mirror upsert
  })

  it('records the event but skips mirror write when patch is empty', async () => {
    mockTenantQuery.mockResolvedValueOnce({ rows: [{ id: 'led2' }] })
    const r = await applyInboundEvent('t1', { event_id: 'e2', event: 'cx.unknown', tenant_id: 't1', handoff_id: 'hx1' })
    expect(r).toEqual({ processed: true })
    expect(mockTenantQuery).toHaveBeenCalledTimes(1) // ledger only
  })

  it('normalizes a Menlo status event (FATCompleted → fat_status patch)', async () => {
    mockTenantQuery
      .mockResolvedValueOnce({ rows: [{ id: 'led3' }] })
      .mockResolvedValueOnce({ rows: [] })
    const r = await applyInboundEvent('t1', { event_id: 'e3', event: 'FATCompleted', tenant_id: 't1', handoff_id: 'hx1' })
    expect(r).toEqual({ processed: true })
    expect(mockTenantQuery).toHaveBeenCalledTimes(2)
    expect(mockTenantQuery.mock.calls[1][1]).toContain('fat_status')
  })

  it('applies a delta for a Menlo count event (PunchCreated → punch_open +1, clamped)', async () => {
    mockTenantQuery
      .mockResolvedValueOnce({ rows: [{ id: 'led4' }] })
      .mockResolvedValueOnce({ rows: [] })
    const r = await applyInboundEvent('t1', { event_id: 'e4', event: 'PunchCreated', tenant_id: 't1', handoff_id: 'hx1' })
    expect(r).toEqual({ processed: true })
    const sql = mockTenantQuery.mock.calls[1][1] as string
    expect(sql).toContain('punch_open')
    expect(sql).toContain('GREATEST(0,')
  })

  it('records audit-only Menlo events with no mirror write (LoopCheckCompleted)', async () => {
    mockTenantQuery.mockResolvedValueOnce({ rows: [{ id: 'led5' }] })
    const r = await applyInboundEvent('t1', { event_id: 'e5', event: 'LoopCheckCompleted', tenant_id: 't1', handoff_id: 'hx1' })
    expect(r).toEqual({ processed: true })
    expect(mockTenantQuery).toHaveBeenCalledTimes(1) // ledger only
  })
})
