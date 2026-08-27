/**
 * Safety — predictive analysis + route tests (v4.53.0)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// ADR-014 Phase 2B-2: Safety observations, incidents and intelligence
// require `safety.view`. Phase 1 grants it to owner, PM and field ops;
// field ops is the narrowest.
// Authorization re-resolves that role from the database on every request,
// so the pool answers the lookup for the caller under test.
const CALLER = vi.hoisted(() => ({ id: 'caller', tenant_id: 'tenant-1', role: 'field_ops', is_active: true }))

const mockQuery = vi.fn()

/**
 * ADR-014 Phase 3D — the record-scope layer asks two questions before a handler
 * runs: which project owns this record, and may the caller reach it. Both are
 * answered here rather than through the scripted mock, for the same reason the
 * current-user lookup already is: an authorization query must not consume a
 * `mockResolvedValueOnce` entry written for the handler's own queries.
 */
const _recordScopeAnswer = (sql: unknown, params: unknown): { rows: unknown[]; rowCount: number } | null => {
  const s = String(sql)
  if (/AS\s+project_id/i.test(s)) return { rows: [{ project_id: '30000000-0000-4000-8000-000000000001' }], rowCount: 1 }
  if (/FROM\s+projects\s+p?\b/i.test(s) && /ANY\(\$\d+::uuid\[\]\)/i.test(s)) {
    // Echo back the ids the resolver asked about, so the fixture's own
    // project is the one reported reachable.
    const ids = ((params as unknown[])?.find(x => Array.isArray(x)) as string[] | undefined) ?? []
    return { rows: ids.map(id => ({ id })), rowCount: ids.length }
  }
  return null
}

vi.mock('../db/pool', () => ({
  tenantQuery: (...__a: unknown[]) => _recordScopeAnswer(__a[1], __a[2]) ?? (((t: string, sql: string, p: unknown[]) => mockQuery(t, sql, p)) as (...z: unknown[]) => unknown)(...__a),
  query:       (sql: string, p: unknown[]) =>
    /FROM\s+users\s+WHERE\s+id/i.test(String(sql))
      ? Promise.resolve({ rows: [CALLER], rowCount: 1 })
      : mockQuery(null, sql, p),
}))
vi.mock('../auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.auth = { sub: 'u1', tid: 'tenant-1', role: 'field_ops' }
    next()
  },
}))
vi.mock('../middleware/tenant', () => ({ requireTenant: () => (req: any, _res: any, next: any) => { req.tenantId = 'tenant-1'; next() } }))

import { analyzeSafety, type ObsRow, type IncRow } from '../services/safety/safetyService'

const NOW = new Date('2026-06-22T12:00:00Z')

describe('analyzeSafety — empty', () => {
  it('prompts to log records', () => {
    const s = analyzeSafety([], [], NOW)
    expect(s.leadingIndicators.observations).toBe(0)
    expect(s.headline).toMatch(/no safety records/i)
    expect(s.leadingIndicators.riskLevel).toBe('low')
  })
})

describe('analyzeSafety — high-risk areas', () => {
  it('weights incidents above observations and ranks worst location first', () => {
    const obs: ObsRow[] = [{ severity: 'low', location: 'Area A', description: 'housekeeping' }, { severity: 'low', location: 'Area B', description: 'housekeeping' }]
    const inc: IncRow[] = [{ type: 'injury', severity: 'high', location: 'Area B', description: 'fall from ladder' }]
    const s = analyzeSafety(obs, inc, NOW)
    expect(s.highRiskAreas[0].location).toBe('Area B')   // incident-weighted
    expect(s.highRiskAreas[0].incidents).toBe(1)
  })
})

describe('analyzeSafety — recurring hazards', () => {
  it('clusters repeated hazard keywords (>=2)', () => {
    const obs: ObsRow[] = [
      { severity: 'medium', description: 'Ladder not secured at level 3' },
      { severity: 'medium', description: 'Ladder missing rubber feet' },
      { severity: 'low', description: 'Spill in corridor' },
    ]
    const s = analyzeSafety(obs, [], NOW)
    const ladder = s.recurringHazards.find(h => h.hazard === 'ladder')
    expect(ladder).toBeTruthy()
    expect(ladder!.count).toBe(2)
    expect(s.recurringHazards.find(h => h.hazard === 'spill')).toBeFalsy() // only 1
  })
})

describe('analyzeSafety — leading indicators', () => {
  it('computes observation-to-incident ratio and reporting culture', () => {
    const obs: ObsRow[] = Array.from({ length: 20 }, () => ({ severity: 'low', description: 'good catch housekeeping', status: 'closed' }))
    const inc: IncRow[] = [{ type: 'near_miss', severity: 'medium', description: 'dropped tool', status: 'closed' }]
    const s = analyzeSafety(obs, inc, NOW)
    expect(s.leadingIndicators.observationToIncidentRatio).toBe(20)
    expect(s.leadingIndicators.reportingCulture).toBe('strong')
    expect(s.leadingIndicators.nearMisses).toBe(1)
  })
  it('raises the risk index for recordables + open high-severity', () => {
    const inc: IncRow[] = [
      { type: 'injury', severity: 'critical', description: 'laceration', status: 'investigating' },
      { type: 'injury', severity: 'high', description: 'strain', status: 'reported' },
    ]
    const s = analyzeSafety([], inc, NOW)
    expect(s.leadingIndicators.recordables).toBe(2)
    expect(s.leadingIndicators.openHighSeverity).toBe(2)
    expect(['high', 'critical']).toContain(s.leadingIndicators.riskLevel)
  })
})

// ─── Route smoke ──────────────────────────────────────────────────────────────
import express from 'express'
import request from 'supertest'
import { safetyRouter } from '../routes/safety'

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1', safetyRouter as any)
  return app
}

describe('Safety routes', () => {
  beforeEach(() => vi.clearAllMocks())

  it('POST observation requires a description', async () => {
    const res = await request(makeApp()).post('/api/v1/projects/30000000-0000-4000-8000-000000000001/safety/observations').send({ severity: 'low' })
    expect(res.status).toBe(400)
  })

  it('POST observation creates one', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'o1', type: 'hazard', severity: 'high', status: 'open', description: 'exposed rebar' }], rowCount: 1 })
    const res = await request(makeApp()).post('/api/v1/projects/30000000-0000-4000-8000-000000000001/safety/observations').send({ type: 'hazard', severity: 'high', description: 'exposed rebar' })
    expect(res.status).toBe(201)
    expect(res.body.data.id).toBe('o1')
  })

  it('GET intelligence returns the analysis', async () => {
    mockQuery.mockImplementation(async (_t: string, sql: string) => {
      if (/FROM projects WHERE/.test(sql)) return { rows: [{ id: 'p1' }], rowCount: 1 }
      if (/FROM safety_observations/.test(sql)) return { rows: [{ severity: 'medium', location: 'B', description: 'ladder unsecured' }] }
      if (/FROM safety_incidents/.test(sql)) return { rows: [{ type: 'near_miss', severity: 'high', location: 'B', description: 'ladder slip', status: 'reported' }] }
      return { rows: [] }
    })
    const res = await request(makeApp()).get('/api/v1/projects/30000000-0000-4000-8000-000000000001/safety/intelligence')
    expect(res.status).toBe(200)
    expect(res.body.data.leadingIndicators).toBeTruthy()
    expect(res.body.data.highRiskAreas[0].location).toBe('B')
  })

  it('GET intelligence 404s for an unknown project', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 })
    const res = await request(makeApp()).get('/api/v1/projects/nope/safety/intelligence')
    expect(res.status).toBe(404)
  })

  it('PATCH observation status validates', async () => {
    const res = await request(makeApp()).patch('/api/v1/safety/observations/4352da72-80f1-4ecc-8acf-1ba84eb945c9').send({ status: 'bogus' })
    expect(res.status).toBe(400)
  })
})
