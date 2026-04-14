/**
 * Tests: api/server — /api/v1/admin/sessions (OWN-01)
 *         Auth event recording via recordAuthEvent
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import request from 'supertest'
import app, { _clearAuthEvents, _getAuthEvents, recordAuthEvent } from '../../../api/server'

// Override JWT_SECRET for tests
process.env.JWT_SECRET    = 'test-jwt-secret-sessions'
process.env.NODE_ENV      = 'test'

describe('Auth Event Log — recordAuthEvent', () => {
  beforeEach(() => {
    _clearAuthEvents()
  })

  it('records a login_success event', () => {
    recordAuthEvent({ event: 'login_success', username: 'owner', role: 'owner', ip: '127.0.0.1', requestId: 'req-1' })
    const events = _getAuthEvents()
    expect(events).toHaveLength(1)
    expect(events[0].event).toBe('login_success')
    expect(events[0].username).toBe('owner')
    expect(events[0].ts).toBeTruthy()
  })

  it('records multiple events in reverse chronological order', () => {
    recordAuthEvent({ event: 'login_success', requestId: 'r1' })
    recordAuthEvent({ event: 'login_fail',    requestId: 'r2' })
    const events = _getAuthEvents()
    expect(events[0].event).toBe('login_fail')    // most recent first
    expect(events[1].event).toBe('login_success')
  })

  it('truncates to AUTH_EVENT_MAX (500) entries', () => {
    for (let i = 0; i < 520; i++) {
      recordAuthEvent({ event: 'login_fail', requestId: `r${i}` })
    }
    expect(_getAuthEvents().length).toBe(500)
  })

  it('clears all events', () => {
    recordAuthEvent({ event: 'logout', requestId: 'r1' })
    _clearAuthEvents()
    expect(_getAuthEvents()).toHaveLength(0)
  })
})

describe('GET /api/v1/admin/sessions — requires owner role', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/v1/admin/sessions')
    expect(res.status).toBe(401)
  })

  it('returns 401 with malformed token', async () => {
    const res = await request(app)
      .get('/api/v1/admin/sessions')
      .set('Authorization', 'Bearer bad-token')
    expect(res.status).toBe(401)
  })
})

describe('GET /api/v1/health — extended metrics (OBS-01)', () => {
  it('includes memoryMB fields', async () => {
    const res = await request(app).get('/api/v1/health')
    expect(res.status).toBe(200)
    expect(res.body.memoryMB).toBeDefined()
    expect(res.body.memoryMB.rss).toBeDefined()
    expect(res.body.memoryMB.heapUsed).toBeDefined()
  })

  it('includes uptime', async () => {
    const res = await request(app).get('/api/v1/health')
    expect(typeof res.body.uptime).toBe('number')
  })
})

describe('X-Request-ID correlation header (OBS-01)', () => {
  it('echoes a client-provided X-Request-ID', async () => {
    const res = await request(app)
      .get('/api/v1/health')
      .set('X-Request-ID', 'test-correlation-123')
    expect(res.headers['x-request-id']).toBe('test-correlation-123')
  })

  it('generates an X-Request-ID when none provided', async () => {
    const res = await request(app).get('/api/v1/health')
    expect(res.headers['x-request-id']).toBeTruthy()
    expect(typeof res.headers['x-request-id']).toBe('string')
  })
})
