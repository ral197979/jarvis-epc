/**
 * Tests: api/services/integration/novaSnapshotDiff.ts
 *
 * The hash-diff job must enqueue exactly one event per actual change and
 * nothing on a no-change pass. Pool + projection are mocked — no real DB.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const mockQuery = vi.fn()
const mockTenantQuery = vi.fn()
const mockClientQuery = vi.fn()
vi.mock('../db/pool', () => ({
  query: (...a: unknown[]) => mockQuery(...a),
  tenantQuery: (...a: unknown[]) => mockTenantQuery(...a),
  tenantTransaction: async (_tenantId: string, fn: (client: unknown) => Promise<unknown>) =>
    fn({ query: (...a: unknown[]) => mockClientQuery(...a) }),
  pool: { connect: vi.fn() },
}))

const mockBuildProgressSummary = vi.fn()
vi.mock('../services/integration/novaProgressProjection', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>()
  return { ...original, buildProgressSummary: (...a: unknown[]) => mockBuildProgressSummary(...a) }
})

const mockRegisterHandler = vi.fn()
const mockRegisterPromoter = vi.fn()
const mockEnqueue = vi.fn()
vi.mock('../services/scheduler', () => ({
  registerHandler: (...a: unknown[]) => mockRegisterHandler(...a),
  registerPromoter: (...a: unknown[]) => mockRegisterPromoter(...a),
  enqueue: (...a: unknown[]) => mockEnqueue(...a),
}))

import { registerNovaSnapshotDiffHandler, diffTurnoverState, toContractPackage } from '../services/integration/novaSnapshotDiff'
import { summaryHash } from '../services/integration/novaProgressProjection'

type Handler = (job: { tenant_id: string; payload_json: Record<string, unknown> }) => Promise<Record<string, unknown>>

const SUMMARY = { overallStatus: 'construction', overallPercent: 40 }
const LINK = {
  id: 'link-1',
  project_id: 'proj-1',
  connection_id: 'conn-1',
  nova_project_id: 'nova-p-9',
  last_summary_hash: summaryHash(SUMMARY),
  last_turnover_state: {},
  nova_tenant_id: 'nova-t-1',
}

function getHandler(): Handler {
  registerNovaSnapshotDiffHandler()
  const call = mockRegisterHandler.mock.calls.find(([type]) => type === 'nova_snapshot_diff')
  expect(call).toBeDefined()
  return call![1] as Handler
}

describe('nova_snapshot_diff handler', () => {
  beforeEach(() => {
    mockQuery.mockReset()
    mockTenantQuery.mockReset()
    mockClientQuery.mockReset().mockResolvedValue({ rows: [{ id: 'x' }] })
    mockBuildProgressSummary.mockReset()
    mockRegisterHandler.mockReset()
    mockRegisterPromoter.mockReset()
    mockEnqueue.mockReset()
    process.env['NOVA_EXTERNAL'] = 'true'
  })
  afterEach(() => { delete process.env['NOVA_EXTERNAL'] })

  function scriptTenantQueries(link: Record<string, unknown>, packages: Record<string, unknown>[]) {
    mockTenantQuery.mockImplementation((_tenantId: string, sql: string) => {
      if (sql.includes('FROM nova_project_links'))  return Promise.resolve({ rows: [link] })
      if (sql.includes('FROM turnover_packages'))   return Promise.resolve({ rows: packages })
      return Promise.resolve({ rows: [] })
    })
  }

  it('does nothing when neither summary nor packages changed', async () => {
    scriptTenantQueries(LINK, [])
    mockBuildProgressSummary.mockResolvedValue(SUMMARY)
    const result = await getHandler()({ tenant_id: 't1', payload_json: {} })
    expect(result).toEqual({ links: 1, emitted: 0 })
    expect(mockClientQuery).not.toHaveBeenCalled()
  })

  it('emits exactly one progress event when the summary hash changed, and updates the hash atomically', async () => {
    scriptTenantQueries({ ...LINK, last_summary_hash: 'stale-hash' }, [])
    mockBuildProgressSummary.mockResolvedValue(SUMMARY)
    const result = await getHandler()({ tenant_id: 't1', payload_json: {} })
    expect(result).toEqual({ links: 1, emitted: 1 })
    const sqls = mockClientQuery.mock.calls.map(([sql]) => String(sql))
    expect(sqls.filter(s => s.includes('INSERT INTO nova_outbox'))).toHaveLength(1)
    expect(sqls.filter(s => s.includes('UPDATE nova_project_links'))).toHaveLength(1)
    // The stored hash is the new summary's hash.
    const updateCall = mockClientQuery.mock.calls.find(([sql]) => String(sql).includes('UPDATE nova_project_links'))
    expect(updateCall![1][0]).toBe(summaryHash(SUMMARY))
    // The outbox payload carries the contract identifiers.
    const outboxCall = mockClientQuery.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO nova_outbox'))
    const payload = JSON.parse(String(outboxCall![1][2])) as Record<string, unknown>
    expect(payload['connectionId']).toBe('conn-1')
    expect(payload['novaTenantId']).toBe('nova-t-1')
    expect(payload['summary']).toEqual(SUMMARY)
  })

  it('emits one turnover event per changed package only', async () => {
    const pkgA = { id: 'tp-a', name: 'Train A', area: null, status: 'open' }
    const pkgB = { id: 'tp-b', name: 'Train B', area: 'Area 200', status: 'accepted' }
    // pkgA unchanged (hash pre-seeded), pkgB is new → exactly one event.
    const lastState = { 'tp-a': summaryHash(toContractPackage(pkgA)) }
    scriptTenantQueries({ ...LINK, last_turnover_state: lastState }, [pkgA, pkgB])
    mockBuildProgressSummary.mockResolvedValue(SUMMARY)

    const result = await getHandler()({ tenant_id: 't1', payload_json: {} })
    expect(result).toEqual({ links: 1, emitted: 1 })
    const outboxCalls = mockClientQuery.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO nova_outbox'))
    expect(outboxCalls).toHaveLength(1)
    const payload = JSON.parse(String(outboxCalls[0]![1][2])) as Record<string, unknown>
    expect(payload['package']).toEqual({ packageId: 'tp-b', title: 'Train B', status: 'accepted', systemOrArea: 'Area 200' })
  })

  it('skips entirely when NOVA_EXTERNAL is off', async () => {
    delete process.env['NOVA_EXTERNAL']
    const result = await getHandler()({ tenant_id: 't1', payload_json: {} })
    expect(result).toEqual({ skipped: true, reason: 'NOVA_EXTERNAL off' })
    expect(mockTenantQuery).not.toHaveBeenCalled()
  })
})

describe('diffTurnoverState (pure)', () => {
  it('reports no changes when hashes match and rebuilds the next state map', () => {
    const pkg = { id: 'tp-1', name: 'Train A', area: null, status: 'open' }
    const state = { 'tp-1': summaryHash(toContractPackage(pkg)) }
    const { changed, nextState } = diffTurnoverState([pkg], state)
    expect(changed).toEqual([])
    expect(nextState).toEqual(state)
  })

  it('flags a package whose status changed', () => {
    const before = { id: 'tp-1', name: 'Train A', area: null, status: 'open' }
    const after = { ...before, status: 'ready_for_turnover' }
    const state = { 'tp-1': summaryHash(toContractPackage(before)) }
    const { changed } = diffTurnoverState([after], state)
    expect(changed).toEqual([after])
  })
})
