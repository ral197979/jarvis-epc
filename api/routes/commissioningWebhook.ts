/**
 * Denver Engineering — Commissioning inbound webhook (PR-1)
 * ─────────────────────────────────────────────────────────────────────────────
 *   POST /api/cx/webhook   (Commissioning → Denver)
 *
 * Receives status events from the external Commissioning platform, verifies an
 * HMAC-SHA256 signature over the RAW request body, applies them idempotently to
 * the status mirror, and republishes onto Denver's event bus for internal fan-out.
 *
 * This router is mounted in server.ts BEFORE the global express.json() parser so
 * it can read the raw body for signature verification. It is intentionally
 * OUTSIDE the /api/v1 auth+CSRF chain: authentication is the HMAC signature
 * (service-to-service), not a user session.
 *
 * See COMMISSIONING_EXTRACTION_PLAN.md §2.5 and §3.2.
 */
import { Router, Request, Response, raw } from 'express'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { commissioningWebhookSecret } from '../services/integration/cxConfig'
import { applyInboundEvent, type InboundCxEvent } from '../services/integration/cxStatusMirror'
import { broadcastEvent } from '../realtime/eventBroadcaster'
import { slog } from '../../src/modules/observability/index'

const router = Router()

/** Constant-time compare of two signature strings. */
function _safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

router.post('/', raw({ type: '*/*', limit: '1mb' }), async (req: Request, res: Response) => {
  const secret = commissioningWebhookSecret()
  if (!secret) return res.status(503).json({ error: 'commissioning webhook not configured' })

  const body = Buffer.isBuffer(req.body) ? (req.body as Buffer) : Buffer.from('')
  const signature = req.header('X-CX-Signature') ?? ''
  const expected = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
  if (!_safeEqual(signature, expected)) {
    return res.status(401).json({ error: 'invalid signature' })
  }

  let evt: InboundCxEvent
  try {
    evt = JSON.parse(body.toString('utf8')) as InboundCxEvent
  } catch {
    return res.status(400).json({ error: 'invalid json' })
  }
  if (!evt.tenant_id || !evt.event || !evt.event_id) {
    return res.status(400).json({ error: 'missing required fields: tenant_id, event, event_id' })
  }

  try {
    const { processed } = await applyInboundEvent(evt.tenant_id, evt)
    if (processed) {
      // Republish internally so readiness/dashboards react. 'readiness_changed' is
      // an existing bus event type; payload carries the commissioning provenance.
      broadcastEvent({
        event_type: 'readiness_changed',
        tenant_id: evt.tenant_id,
        payload: { source: 'commissioning', event: evt.event, handoff_id: evt.handoff_id ?? null, data: evt.data ?? {} },
        subscription_scope: 'readiness',
        scope_id: evt.handoff_id,
        correlation_id: evt.correlation_id,
      })
    }
    return res.json({ ok: true, processed })
  } catch (err) {
    slog('ERROR', 'commissioning', '[webhook] failed to apply event', {
      tenantId: evt.tenant_id, event: evt.event, eventId: evt.event_id,
      message: err instanceof Error ? err.message : String(err),
    })
    return res.status(500).json({ error: 'failed to process event' })
  }
})

export const commissioningWebhookRouter = router
