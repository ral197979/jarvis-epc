/**
 * ADR-014 Phase 2C-5 §11–§13 — the IoT ingest hybrid, exercised on both halves.
 *
 * One URL, two callers, and they must be proved separately. The guard commits to
 * a mode from the SHAPE of the presented credential and never reconsiders it:
 *
 *   64-hex bearer  → service path. Resolved against `sensor_ingest_tokens`.
 *                    Tenant comes from the token row. An unresolvable token is
 *                    refused 401 — never retried as a session.
 *   anything else  → user path. requireAuth → requireTenant →
 *                    requireCapability('platform.integrations'), to completion.
 *
 * The failure this shape exists to prevent is a guard that reads
 * "if token OR anything session-ish then allow". So the tests below assert not
 * only that each path admits its own caller, but that neither path can be used
 * to rescue a failure on the other, and that a tenant is never taken from the
 * request body on either path.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

const ingestBatch  = vi.fn(async (_tenantId: string, _projectId: string, _items: unknown[]) => ({ accepted: 1, rejected: 0 }))
const ingestSingle = vi.fn(async (_tenantId: string, _projectId: string, _reading: unknown) => ({ accepted: 1 }))
const resolveIngestToken = vi.fn<(t: string) => Promise<{ tenantId: string; edgeNodeId: string | null } | null>>()

vi.mock('../services/iot/sensorIngestService', () => ({
  registerSensor: vi.fn(), getSensor: vi.fn(), listSensors: vi.fn(async () => []),
  updateSensorThresholds: vi.fn(), getReadings: vi.fn(async () => []),
  getOpenAlerts: vi.fn(async () => []), acknowledgeAlert: vi.fn(),
  ingestBatch:  (...a: unknown[]) => ingestBatch(...(a as [string, string, unknown[]])),
  ingestSingle: (...a: unknown[]) => ingestSingle(...(a as [string, string, unknown])),
  createIngestToken: vi.fn(),
  resolveIngestToken: (...a: unknown[]) => resolveIngestToken(...(a as [string])),
}))

const mockQuery = vi.fn<(...a: unknown[]) => Promise<{ rows: unknown[] }>>()
vi.mock('../db/pool', () => ({
  query:       (...a: unknown[]) => mockQuery(...a),
  tenantQuery: (...a: unknown[]) => mockQuery(...a),
  tenantTransaction: async (_t: string, fn: (c: unknown) => unknown) => fn({ query: mockQuery }),
  pool: { query: (...a: unknown[]) => mockQuery(...a), connect: vi.fn() },
}))

const TENANT_A = 'tenant-aaaa'
const TENANT_B = 'tenant-bbbb'
const SERVICE_TOKEN_A = 'a'.repeat(64)
const SERVICE_TOKEN_B = 'b'.repeat(64)
const BAD_TOKEN       = 'f'.repeat(64)   // right shape, no row

import type { UserRole } from '../authz/capabilities'

interface Caller { id: string; tenantId: string; role: UserRole; active?: boolean }
let sessionCaller: Caller | null = null

vi.mock('../auth', () => ({
  requireAuth: (req: Record<string, unknown>, res: Record<string, unknown>, next: () => void) => {
    const c = (globalThis as Record<string, unknown>)['__iot'] as Caller | null
    if (!c) {
      ;(res as unknown as { status: (n: number) => { json: (b: unknown) => void } })
        .status(401).json({ error: 'unauthenticated' })
      return
    }
    req['auth'] = { sub: c.id, tid: c.tenantId, role: c.role, jti: 'jti' }
    next()
  },
  requireRole: () => (_r: unknown, _s: unknown, next: () => void) => next(),
}))
vi.mock('../middleware/tenant', () => {
  const mw = (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    const c = (globalThis as Record<string, unknown>)['__iot'] as Caller | null
    if (c) req['tenantId'] = c.tenantId
    next()
  }
  return {
    requireTenant: (...args: unknown[]) =>
      typeof args[2] === 'function'
        ? mw(args[0] as Record<string, unknown>, args[1], args[2] as () => void)
        : mw,
    invalidateTenantCache: () => {},
  }
})

import { iotRouter } from '../routes/iot'

const setSession = (c: Caller | null) => {
  sessionCaller = c
  ;(globalThis as Record<string, unknown>)['__iot'] = c
}

const makeApp = () => {
  const app = express()
  app.use(express.json())
  app.use('/api/v1', iotRouter as never)
  return app
}

/** The tenant the ingest service was actually called with. */
const ingestTenant = () => (ingestBatch.mock.calls[0]?.[0] ?? ingestSingle.mock.calls[0]?.[0]) as string | undefined
const ingested = () => ingestBatch.mock.calls.length + ingestSingle.mock.calls.length

beforeEach(() => {
  ingestBatch.mockClear(); ingestSingle.mockClear(); mockQuery.mockClear()
  resolveIngestToken.mockReset()
  resolveIngestToken.mockImplementation(async (t: string) => {
    if (t === SERVICE_TOKEN_A) return { tenantId: TENANT_A, edgeNodeId: null }
    if (t === SERVICE_TOKEN_B) return { tenantId: TENANT_B, edgeNodeId: null }
    return null
  })
  // The live-principal lookup behind requireCapability.
  mockQuery.mockImplementation(async (...a: unknown[]) => {
    const sql = a.find(x => typeof x === 'string' && /SELECT/i.test(x)) as string | undefined
    if (sql && /FROM users/i.test(sql)) {
      const c = sessionCaller
      return { rows: c && c.active !== false ? [{ id: c.id, tenant_id: c.tenantId, role: c.role, is_active: true }] : [] }
    }
    return { rows: [] }
  })
  setSession(null)
})

const BATCH = [{ sensorUid: 's-1', value: 42 }]

// ─── 1. Service path ──────────────────────────────────────────────────────────
describe('the machine path admits a verified ingest credential', () => {
  it('accepts a batch and binds the tenant from the token row', async () => {
    const res = await request(makeApp()).post('/api/v1/iot/ingest')
      .set('Authorization', `Bearer ${SERVICE_TOKEN_A}`).send(BATCH)
    expect(res.status).toBe(201)
    expect(ingestTenant(), 'tenant must come from the credential, not the request').toBe(TENANT_A)
  })

  it('accepts a single reading on the same contract', async () => {
    const res = await request(makeApp()).post('/api/v1/sensors/s-1/readings')
      .set('Authorization', `Bearer ${SERVICE_TOKEN_B}`).send({ value: 7 })
    expect(res.status).toBe(201)
    expect(ingestTenant()).toBe(TENANT_B)
  })

  it('needs no user session at all', async () => {
    setSession(null)
    const res = await request(makeApp()).post('/api/v1/iot/ingest')
      .set('Authorization', `Bearer ${SERVICE_TOKEN_A}`).send(BATCH)
    expect(res.status).toBe(201)
  })
})

// ─── 2. Service path fails closed, and never falls back ───────────────────────
describe('a token-shaped credential that does not resolve is refused outright', () => {
  it('refuses an unknown ingest token', async () => {
    const res = await request(makeApp()).post('/api/v1/iot/ingest')
      .set('Authorization', `Bearer ${BAD_TOKEN}`).send(BATCH)
    expect(res.status).toBe(401)
    expect(ingested(), 'a refused credential must ingest nothing').toBe(0)
  })

  it('does NOT fall back to a session when the token is bad', async () => {
    // The regression this guards: a revoked machine credential being
    // reinterpreted as a different credential type. Even with a fully
    // authorized owner session present, a bad 64-hex bearer must still fail.
    setSession({ id: 'u1', tenantId: TENANT_A, role: 'owner' })
    const res = await request(makeApp()).post('/api/v1/iot/ingest')
      .set('Authorization', `Bearer ${BAD_TOKEN}`).send(BATCH)
    expect(res.status).toBe(401)
    expect(ingested()).toBe(0)
  })

  it('does not let a service credential borrow another tenant', async () => {
    const res = await request(makeApp()).post('/api/v1/iot/ingest')
      .set('Authorization', `Bearer ${SERVICE_TOKEN_A}`)
      .query({ tenantId: TENANT_B })
      .send([{ sensorUid: 's-1', value: 1, tenantId: TENANT_B }])
    expect(res.status).toBe(201)
    expect(ingestTenant(), 'a payload tenant must be ignored').toBe(TENANT_A)
  })
})

// ─── 3. User path ─────────────────────────────────────────────────────────────
describe('the human path requires a live session holding platform.integrations', () => {
  it('admits the owner', async () => {
    setSession({ id: 'u-owner', tenantId: TENANT_A, role: 'owner' })
    const res = await request(makeApp()).post('/api/v1/iot/ingest').send(BATCH)
    expect(res.status).toBe(201)
    expect(ingestTenant()).toBe(TENANT_A)
  })

  it('admits the platform administrator, whose remit includes integrations', async () => {
    setSession({ id: 'u-admin', tenantId: TENANT_A, role: 'admin' })
    const res = await request(makeApp()).post('/api/v1/iot/ingest').send(BATCH)
    expect(res.status).toBe(201)
  })

  const UNAUTHORIZED: UserRole[] = ['project_manager', 'engineer', 'procurement', 'field_ops', 'viewer']

  it.each(UNAUTHORIZED)('refuses %s, which does not hold platform.integrations', async role => {
    setSession({ id: 'u', tenantId: TENANT_A, role })
    const res = await request(makeApp()).post('/api/v1/iot/ingest').send(BATCH)
    expect(res.status).toBe(403)
    expect(ingested(), 'a refused caller must ingest nothing').toBe(0)
  })

  it.each(UNAUTHORIZED)('refuses %s on the single-reading route too', async role => {
    setSession({ id: 'u', tenantId: TENANT_A, role })
    const res = await request(makeApp()).post('/api/v1/sensors/s-1/readings').send({ value: 1 })
    expect(res.status).toBe(403)
    expect(ingested()).toBe(0)
  })

  it('refuses an unauthenticated caller', async () => {
    setSession(null)
    const res = await request(makeApp()).post('/api/v1/iot/ingest').send(BATCH)
    expect(res.status).toBe(401)
    expect(ingested()).toBe(0)
  })

  it('refuses a token that is authoritative in claim but not in the database', async () => {
    // §31 live authority: the JWT still says owner, the row says the account is
    // gone. `requireCapability` resolves the LIVE principal, so this fails.
    setSession({ id: 'u-gone', tenantId: TENANT_A, role: 'owner', active: false })
    const res = await request(makeApp()).post('/api/v1/iot/ingest').send(BATCH)
    expect([401, 403]).toContain(res.status)
    expect(ingested(), 'a stale token must not ingest').toBe(0)
  })
})

// ─── 4. Cross-tenant polarity on the user path (§13) ──────────────────────────
describe('a human caller ingests only into their own tenant', () => {
  it('uses the session tenant, never a body-supplied one', async () => {
    setSession({ id: 'u-owner', tenantId: TENANT_A, role: 'owner' })
    const res = await request(makeApp()).post('/api/v1/iot/ingest')
      .query({ tenantId: TENANT_B })
      .send([{ sensorUid: 's-1', value: 1, tenantId: TENANT_B }])
    expect(res.status).toBe(201)
    expect(ingestTenant(), 'tenant B must not be reachable from a tenant A session').toBe(TENANT_A)
  })
})
