/**
 * Tests: api/middleware/idempotency.ts
 *
 * Store unit tests (injectable clock → deterministic TTL) + middleware behavior
 * over a tiny express app: flag gating, opt-in via header, replay, key scoping
 * (tenant / key / 5xx), and TTL expiry.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { InMemoryIdempotencyStore, idempotency } from '../middleware/idempotency'

describe('InMemoryIdempotencyStore', () => {
  it('returns undefined before set, the entry after, undefined after TTL', () => {
    let t = 1000
    const store = new InMemoryIdempotencyStore(100, () => t)
    expect(store.get('k')).toBeUndefined()
    store.set('k', 201, { ok: true })
    expect(store.get('k')).toEqual({ status: 201, body: { ok: true } })
    t = 1101 // +101 > ttl 100
    expect(store.get('k')).toBeUndefined()
  })
})

describe('idempotency middleware', () => {
  beforeEach(() => { process.env['IDEMPOTENCY'] = 'true' })
  afterEach(() => { delete process.env['IDEMPOTENCY'] })

  // App: a counter-incrementing POST so replays are observable. A pre-middleware
  // sets req.tenantId from a header so we can test tenant scoping.
  function makeApp(store = new InMemoryIdempotencyStore(60_000)) {
    const app = express()
    app.use(express.json())
    app.use((req, _res, next) => { (req as any).tenantId = req.header('X-Tenant') ?? 'none'; next() })
    app.use(idempotency(store))
    let n = 0
    app.post('/thing', (_req, res) => { n += 1; res.status(201).json({ n }) })
    app.post('/fail', (_req, res) => { n += 1; res.status(500).json({ n }) })
    app.get('/thing', (_req, res) => { n += 1; res.json({ n }) })
    return app
  }

  it('passes through when the flag is off (no replay)', async () => {
    delete process.env['IDEMPOTENCY']
    const app = makeApp()
    const a = await request(app).post('/thing').set('Idempotency-Key', 'k1')
    const b = await request(app).post('/thing').set('Idempotency-Key', 'k1')
    expect(a.body.n).toBe(1); expect(b.body.n).toBe(2) // executed both times
  })

  it('executes every time when no Idempotency-Key is sent', async () => {
    const app = makeApp()
    const a = await request(app).post('/thing')
    const b = await request(app).post('/thing')
    expect(a.body.n).toBe(1); expect(b.body.n).toBe(2)
  })

  it('replays the cached response for a repeated key (handler runs once)', async () => {
    const app = makeApp()
    const a = await request(app).post('/thing').set('Idempotency-Key', 'k1')
    const b = await request(app).post('/thing').set('Idempotency-Key', 'k1')
    expect(a.status).toBe(201); expect(a.body).toEqual({ n: 1 })
    expect(b.status).toBe(201); expect(b.body).toEqual({ n: 1 }) // same — not re-run
    expect(b.headers['idempotent-replay']).toBe('true')
  })

  it('different keys execute independently', async () => {
    const app = makeApp()
    const a = await request(app).post('/thing').set('Idempotency-Key', 'k1')
    const b = await request(app).post('/thing').set('Idempotency-Key', 'k2')
    expect(a.body).toEqual({ n: 1 }); expect(b.body).toEqual({ n: 2 })
  })

  it('scopes the key by tenant', async () => {
    const app = makeApp()
    const a = await request(app).post('/thing').set('Idempotency-Key', 'k1').set('X-Tenant', 't1')
    const b = await request(app).post('/thing').set('Idempotency-Key', 'k1').set('X-Tenant', 't2')
    expect(a.body).toEqual({ n: 1 }); expect(b.body).toEqual({ n: 2 }) // different tenant → not a replay
  })

  it('does not cache 5xx (transient → re-executed)', async () => {
    const app = makeApp()
    const a = await request(app).post('/fail').set('Idempotency-Key', 'k1')
    const b = await request(app).post('/fail').set('Idempotency-Key', 'k1')
    expect(a.body.n).toBe(1); expect(b.body.n).toBe(2)
  })

  it('ignores non-mutating methods', async () => {
    const app = makeApp()
    const a = await request(app).get('/thing').set('Idempotency-Key', 'k1')
    const b = await request(app).get('/thing').set('Idempotency-Key', 'k1')
    expect(a.body.n).toBe(1); expect(b.body.n).toBe(2)
  })

  it('re-executes after the entry expires (TTL)', async () => {
    let t = 0
    const store = new InMemoryIdempotencyStore(1000, () => t)
    const app = makeApp(store)
    const a = await request(app).post('/thing').set('Idempotency-Key', 'k1')
    t = 2000 // past ttl
    const b = await request(app).post('/thing').set('Idempotency-Key', 'k1')
    expect(a.body).toEqual({ n: 1 }); expect(b.body).toEqual({ n: 2 })
  })
})
