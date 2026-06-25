/**
 * Project Lifecycle + Gates — engine + route tests (v4.34.0)
 *
 * `buildLifecycle` is pure and deterministic, so most coverage is plain unit
 * tests. A small route smoke test mirrors the mock-pool pattern.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const mockQuery = vi.fn()
vi.mock('../db/pool', () => ({
  tenantQuery: (tenantId: string, sql: string, params: unknown[]) => mockQuery(tenantId, sql, params),
  query:       (sql: string, params: unknown[]) => mockQuery(null, sql, params),
}))
vi.mock('../auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.auth = { sub: 'u1', tid: 't1' }; next() },
}))
vi.mock('../middleware/tenant', () => ({
  requireTenant: () => (req: any, _res: any, next: any) => { req.tenantId = 'tenant-1'; next() },
}))

import {
  buildLifecycle, type LifecycleFacts, type GateApproval, type ProjectLifecycleInput,
} from '../services/lifecycle/lifecycleService'

const NOW = new Date('2026-06-22T12:00:00Z')

function facts(over: Partial<LifecycleFacts> = {}): LifecycleFacts {
  return {
    budget: 0, openRfis: 0, openCriticalRfis: 0, openSubmittals: 0,
    pendingChangeOrders: 0, failedInspections: 0, openNcrs: 0, openPunch: 0, ...over,
  }
}
function project(over: Partial<ProjectLifecycleInput> = {}): ProjectLifecycleInput {
  return { id: 'p1', currentPhase: 'feasibility', projectManager: 'pm1', ...over }
}

describe('buildLifecycle — stages', () => {
  it('marks done/active/upcoming relative to current_phase', () => {
    const lc = buildLifecycle(project({ currentPhase: 'construction' }), facts({ budget: 1 }), {}, NOW)
    const byKey = Object.fromEntries(lc.stages.map(s => [s.key, s.status]))
    expect(byKey.feasibility).toBe('done')
    expect(byKey.procurement).toBe('done')
    expect(byKey.construction).toBe('active')
    expect(byKey.commissioning).toBe('upcoming')
    expect(lc.currentPhase).toBe('construction')
    expect(lc.stages).toHaveLength(7)
  })

  it('defaults an unknown/null phase to feasibility', () => {
    const lc = buildLifecycle(project({ currentPhase: null }), facts(), {}, NOW)
    expect(lc.currentPhase).toBe('feasibility')
    expect(lc.currentGate?.key).toBe('feed')   // next gate after feasibility
  })
})

describe('buildLifecycle — computed gate requirements', () => {
  it('feed gate requires a budget and is unsatisfied at $0', () => {
    const lc = buildLifecycle(project(), facts({ budget: 0 }), {}, NOW)
    expect(lc.currentGate?.key).toBe('feed')
    expect(lc.currentGate?.requirementsSatisfied).toBe(false)
    expect(lc.currentGate?.requirements[0].satisfied).toBe(false)
  })

  it('feed gate requirements are satisfied once a budget exists', () => {
    const lc = buildLifecycle(project(), facts({ budget: 1_000_000 }), {}, NOW)
    expect(lc.currentGate?.requirementsSatisfied).toBe(true)
  })

  it('commissioning gate reflects open punch / NCR / failed inspections', () => {
    const lc = buildLifecycle(project({ currentPhase: 'construction' }),
      facts({ openPunch: 3, openNcrs: 2, failedInspections: 1 }), {}, NOW)
    expect(lc.currentGate?.key).toBe('commissioning')
    const reqs = Object.fromEntries((lc.currentGate?.requirements ?? []).map(r => [r.key, r]))
    expect(reqs.punch.satisfied).toBe(false)
    expect(reqs.punch.detail).toContain('3 open punch')
    expect(reqs.open_ncr.satisfied).toBe(false)
    expect(reqs.failed_insp.satisfied).toBe(false)
    expect(lc.currentGate?.requirementsSatisfied).toBe(false)
  })
})

describe('buildLifecycle — advancement gating', () => {
  it('cannot advance while the gate is pending, even if requirements are met', () => {
    const lc = buildLifecycle(project(), facts({ budget: 1 }), {}, NOW)
    expect(lc.currentGate?.requirementsSatisfied).toBe(true)
    expect(lc.currentGate?.approvalStatus).toBe('pending')
    expect(lc.canAdvance).toBe(false)
  })

  it('can advance once the controlling gate is approved', () => {
    const approvals: Record<string, GateApproval> = {
      feed: { status: 'approved', ownerId: 'pm1', expectedDate: null, approvedBy: 'u1', approvedAt: '2026-06-20' },
    }
    const lc = buildLifecycle(project(), facts({ budget: 1 }), approvals, NOW)
    expect(lc.canAdvance).toBe(true)
  })

  it('a waived gate also permits advancement', () => {
    const approvals: Record<string, GateApproval> = {
      feed: { status: 'waived', ownerId: null, expectedDate: null, approvedBy: 'u1', approvedAt: null },
    }
    const lc = buildLifecycle(project(), facts(), approvals, NOW)
    expect(lc.canAdvance).toBe(true)
  })

  it('has no current gate at the final phase', () => {
    const lc = buildLifecycle(project({ currentPhase: 'closeout' }), facts(), {}, NOW)
    expect(lc.currentGate).toBeNull()
    expect(lc.canAdvance).toBe(false)
  })
})

// ─── Route smoke test ─────────────────────────────────────────────────────────
import express from 'express'
import request from 'supertest'
import { lifecycleRouter } from '../routes/lifecycle'

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1', lifecycleRouter as any)
  return app
}

// Query order in getProjectLifecycle: project, openRfis, openCriticalRfis,
// openSubmittals, pendingChangeOrders, failedInspections, openNcrs, openPunch,
// projectBudget, approvals.
function mockLifecycle(opts: { phase: string; ncrs?: string; punch?: string; budget?: string; approvals?: any[] }) {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: 'p1', current_phase: opts.phase, project_manager: 'u9' }] }) // project
    .mockResolvedValueOnce({ rows: [{ c: '0' }] }) // openRfis
    .mockResolvedValueOnce({ rows: [{ c: '0' }] }) // openCriticalRfis
    .mockResolvedValueOnce({ rows: [{ c: '0' }] }) // openSubmittals
    .mockResolvedValueOnce({ rows: [{ c: '0' }] }) // pendingChangeOrders
    .mockResolvedValueOnce({ rows: [{ c: '0' }] }) // failedInspections
    .mockResolvedValueOnce({ rows: [{ c: opts.ncrs ?? '0' }] }) // openNcrs
    .mockResolvedValueOnce({ rows: [{ c: opts.punch ?? '0' }] }) // openPunch
    .mockResolvedValueOnce({ rows: [{ budget: opts.budget ?? '0' }] }) // projectBudget
    .mockResolvedValueOnce({ rows: opts.approvals ?? [] }) // approvals
}

describe('Lifecycle route smoke', () => {
  beforeEach(() => vi.clearAllMocks())

  it('GET /projects/:id/lifecycle returns the map with computed requirements', async () => {
    mockLifecycle({ phase: 'construction', ncrs: '2', punch: '3', budget: '1000000' })
    const res = await request(makeApp()).get('/api/v1/projects/p1/lifecycle')
    expect(res.status).toBe(200)
    expect(res.body.data.currentPhase).toBe('construction')
    expect(res.body.data.currentGate.key).toBe('commissioning')
    expect(res.body.data.currentGate.requirementsSatisfied).toBe(false)
    expect(res.body.data.canAdvance).toBe(false)
  })

  it('GET returns 404 for an unknown project', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    const res = await request(makeApp()).get('/api/v1/projects/nope/lifecycle')
    expect(res.status).toBe(404)
  })

  it('POST /gates/:gateKey rejects an invalid action', async () => {
    const res = await request(makeApp()).post('/api/v1/projects/p1/gates/feed').send({ action: 'bogus' })
    expect(res.status).toBe(400)
  })

  it('POST /gates/:gateKey approves a gate and reflects canAdvance', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }) // upsert
    mockLifecycle({ phase: 'construction', budget: '1000000', approvals: [
      { gate_key: 'commissioning', status: 'approved', owner_id: 'u9', expected_date: null, approved_by: 'u1', approved_at: '2026-06-22' },
    ] })
    const res = await request(makeApp()).post('/api/v1/projects/p1/gates/commissioning').send({ action: 'approve' })
    expect(res.status).toBe(200)
    expect(res.body.data.currentGate.approvalStatus).toBe('approved')
    expect(res.body.data.canAdvance).toBe(true)
  })
})
