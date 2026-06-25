/**
 * Tests: api/routes/commissioningWebhook.ts
 *
 * Verifies HMAC gating and idempotent dispatch over a minimal express app that
 * mounts only the webhook router (the router supplies its own raw-body parser).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import { createHmac } from 'node:crypto'

const mockApply = vi.fn()
vi.mock('../services/integration/cxStatusMirror', () => ({
  applyInboundEvent: (...a: unknown[]) => mockApply(...a),
}))
const mockBroadcast = vi.fn()
vi.mock('../realtime/eventBroadcaster', () => ({
  broadcastEvent: (...a: unknown[]) => mockBroadcast(...a),
}))

import { commissioningWebhookRouter } from '../routes/commissioningWebhook'

const SECRET = 'whsec-test'

function makeApp() {
  const app = express()
  app.use('/api/cx/webhook', commissioningWebhookRouter)
  return app
}
function sign(body: string): string {
  return `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`
}

const EVENT = { event_id: 'e1', event: 'cx.phase_changed', tenant_id: 't1', handoff_id: 'hx1', data: { phase: 'sat_testing' } }

describe('POST /api/cx/webhook', () => {
  beforeEach(() => {
    mockApply.mockReset().mockResolvedValue({ processed: true })
    mockBroadcast.mockReset()
    process.env['COMMISSIONING_WEBHOOK_SECRET'] = SECRET
  })
  afterEach(() => { delete process.env['COMMISSIONING_WEBHOOK_SECRET'] })

  it('returns 503 when no secret is configured', async () => {
    delete process.env['COMMISSIONING_WEBHOOK_SECRET']
    const body = JSON.stringify(EVENT)
    const res = await request(makeApp()).post('/api/cx/webhook')
      .set('Content-Type', 'application/json').set('X-CX-Signature', sign(body)).send(body)
    expect(res.status).toBe(503)
    expect(mockApply).not.toHaveBeenCalled()
  })

  it('rejects an invalid signature with 401', async () => {
    const body = JSON.stringify(EVENT)
    const res = await request(makeApp()).post('/api/cx/webhook')
      .set('Content-Type', 'application/json').set('X-CX-Signature', 'sha256=deadbeef').send(body)
    expect(res.status).toBe(401)
    expect(mockApply).not.toHaveBeenCalled()
  })

  it('accepts a valid signature, dispatches, and republishes', async () => {
    const body = JSON.stringify(EVENT)
    const res = await request(makeApp()).post('/api/cx/webhook')
      .set('Content-Type', 'application/json').set('X-CX-Signature', sign(body)).send(body)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, processed: true })
    expect(mockApply).toHaveBeenCalledWith('t1', expect.objectContaining({ event: 'cx.phase_changed' }))
    expect(mockBroadcast).toHaveBeenCalledWith(expect.objectContaining({
      event_type: 'readiness_changed', tenant_id: 't1', scope_id: 'hx1',
    }))
  })

  it('does not republish a duplicate event', async () => {
    mockApply.mockResolvedValue({ processed: false })
    const body = JSON.stringify(EVENT)
    const res = await request(makeApp()).post('/api/cx/webhook')
      .set('Content-Type', 'application/json').set('X-CX-Signature', sign(body)).send(body)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, processed: false })
    expect(mockBroadcast).not.toHaveBeenCalled()
  })

  it('returns 400 on missing required fields', async () => {
    const body = JSON.stringify({ event: 'cx.phase_changed' }) // no tenant_id/event_id
    const res = await request(makeApp()).post('/api/cx/webhook')
      .set('Content-Type', 'application/json').set('X-CX-Signature', sign(body)).send(body)
    expect(res.status).toBe(400)
    expect(mockApply).not.toHaveBeenCalled()
  })
})
