/**
 * JARVIS EPC — Integrations Routes + Webhook Dispatcher
 * ───────────────────────────────────────────────────────
 * v4.26.0 | Integration registry, webhooks, sync jobs
 *
 * Routes:
 *   GET/POST         /api/v1/integrations
 *   GET/PATCH/DELETE /api/v1/integrations/:id
 *   POST             /api/v1/integrations/:id/test
 *   POST             /api/v1/integrations/:id/sync
 *   GET/POST         /api/v1/webhooks
 *   GET/PATCH/DELETE /api/v1/webhooks/:id
 *   GET              /api/v1/webhooks/:id/deliveries
 *   GET              /api/v1/sync-jobs
 *
 * Webhook Dispatcher:
 *   dispatchWebhookEvent(tenantId, event, payload)
 *   — Finds matching webhooks, queues deliveries, signs with HMAC-SHA256
 */

import { Router, Response } from 'express'
import crypto from 'node:crypto'
// v4.31.0 TS fix: `tenantTransaction` unused in current routes
import { tenantQuery } from '../db/pool'
import { requireAuth, AuthenticatedRequest } from '../auth'
import { requireTenant, TenantRequest } from '../middleware/tenant'
import { slog } from '../../src/modules/observability/index'

type Req = AuthenticatedRequest & TenantRequest

function _auth() { return [requireAuth as never, requireTenant() as never] }
function _pagination(q: Record<string, unknown>) {
  const page  = Math.max(1, parseInt(String(q['page'] ?? '1'), 10))
  const limit = Math.min(100, Math.max(1, parseInt(String(q['limit'] ?? '25'), 10)))
  return { page, limit, offset: (page - 1) * limit }
}

// ═══════════════════════════════════════════════════════════════════════════════
// WEBHOOK DISPATCHER (shared, not a route)
// ═══════════════════════════════════════════════════════════════════════════════

export async function dispatchWebhookEvent(
  tenantId: string,
  event: string,
  payload: Record<string, unknown>,
  requestId?: string,
): Promise<void> {
  try {
    // Find all active webhooks subscribed to this event
    const result = await tenantQuery<{
      id: string; url: string; secret: string; headers: Record<string, string>; retry_max: number; timeout_ms: number
    }>(tenantId, `
      SELECT id, url, secret, headers, retry_max, timeout_ms
      FROM webhooks
      WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
        AND active = true
        AND $1 = ANY(events)
    `, [event])

    if (result.rows.length === 0) return

    const body      = JSON.stringify({ event, payload, timestamp: new Date().toISOString() })
    const timestamp = Math.floor(Date.now() / 1000).toString()

    for (const webhook of result.rows) {
      const signature = _signWebhook(webhook.secret, timestamp, body)

      // Insert a pending delivery record
      await tenantQuery(tenantId, `
        INSERT INTO webhook_deliveries (tenant_id, webhook_id, event, payload, attempt)
        VALUES (current_setting('app.current_tenant_id',true)::uuid, $1, $2, $3, 1)
      `, [webhook.id, event, JSON.parse(body)])

      // Fire-and-forget delivery (with retry on failure)
      _deliverWebhook({
        tenantId,
        webhook,
        event,
        body,
        signature,
        timestamp,
        attempt: 1,
      }).catch((err) => {
        slog('WARN', 'webhooks', '[dispatch] Delivery error', {
          webhookId: webhook.id, event, message: err?.message,
        })
      })
    }
  } catch (err) {
    slog('ERROR', 'webhooks', '[dispatch] Failed to dispatch event', {
      event, tenantId, message: (err as Error)?.message,
    })
  }
}

function _signWebhook(secret: string, timestamp: string, body: string): string {
  const payload = `${timestamp}.${body}`
  return `sha256=${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`
}

async function _deliverWebhook(opts: {
  tenantId: string
  webhook: { id: string; url: string; secret: string; headers: Record<string, string>; retry_max: number; timeout_ms: number }
  event: string
  body: string
  signature: string
  timestamp: string
  attempt: number
}): Promise<void> {
  const { tenantId, webhook, body, signature, timestamp, attempt } = opts
  const start = Date.now()

  try {
    const controller = new AbortController()
    const timeout    = setTimeout(() => controller.abort(), webhook.timeout_ms)

    const response = await fetch(webhook.url, {
      method:  'POST',
      headers: {
        'Content-Type':            'application/json',
        'X-Jarvis-Signature':      signature,
        'X-Jarvis-Timestamp':      timestamp,
        'X-Jarvis-Delivery':       crypto.randomUUID(),
        ...webhook.headers,
      },
      body,
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout))

    const duration    = Date.now() - start
    const responseBody = await response.text().catch(() => '')

    await tenantQuery(tenantId, `
      UPDATE webhook_deliveries
      SET status_code=$1, response_body=$2, duration_ms=$3, delivered_at=NOW()
      WHERE webhook_id=$4 AND delivered_at IS NULL
      ORDER BY created_at DESC LIMIT 1
    `, [response.status, responseBody.slice(0, 500), duration, webhook.id])

    await tenantQuery(tenantId, `
      UPDATE webhooks SET last_triggered=NOW(), last_status=$1,
        failure_count = CASE WHEN $1 >= 200 AND $1 < 300 THEN 0 ELSE failure_count + 1 END
      WHERE id=$2
    `, [response.status, webhook.id])

    if (!response.ok && attempt < webhook.retry_max) {
      const backoff = Math.pow(2, attempt) * 5000
      setTimeout(() => {
        _deliverWebhook({ ...opts, attempt: attempt + 1 }).catch(() => {})
      }, backoff)
    }
  } catch (err) {
    const duration = Date.now() - start
    const msg = err instanceof Error ? err.message : String(err)

    await tenantQuery(tenantId, `
      UPDATE webhook_deliveries SET error=$1, duration_ms=$2 WHERE webhook_id=$3 AND delivered_at IS NULL ORDER BY created_at DESC LIMIT 1
    `, [msg, duration, webhook.id]).catch(() => {})

    if (attempt < webhook.retry_max) {
      const backoff = Math.pow(2, attempt) * 5000
      setTimeout(() => {
        _deliverWebhook({ ...opts, attempt: attempt + 1 }).catch(() => {})
      }, backoff)
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// INTEGRATIONS ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

export const integrationsRouter = Router()
integrationsRouter.use(..._auth())

integrationsRouter.get('/', async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  // v4.31.0 TS fix: `page` unused — pagination uses limit/offset directly
  const { limit, offset } = _pagination(req.query as Record<string, unknown>)
  const { type, status } = req.query as Record<string, string>

  const conds: string[] = []; const vals: unknown[] = []; let i = 1
  if (type)   { conds.push(`type=$${i++}`);   vals.push(type) }
  if (status) { conds.push(`status=$${i++}`); vals.push(status) }
  const where = conds.length ? `AND ${conds.join(' AND ')}` : ''

  const data = await tenantQuery(tenantId, `
    SELECT id, name, type, status, direction, base_url, config, field_mappings,
           last_sync_at, last_error, sync_enabled, sync_interval, created_at
    FROM integrations
    WHERE tenant_id=current_setting('app.current_tenant_id',true)::uuid ${where}
    ORDER BY created_at DESC LIMIT $${i} OFFSET $${i+1}
  `, [...vals, limit, offset])

  res.json({ data: data.rows })
})

integrationsRouter.get('/:id', async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const result = await tenantQuery(tenantId, `
    SELECT id,name,type,status,direction,base_url,config,field_mappings,last_sync_at,last_error,sync_enabled,sync_interval,created_at
    FROM integrations WHERE id=$1 AND tenant_id=current_setting('app.current_tenant_id',true)::uuid
  `, [req.params['id']])
  if (!result.rows[0]) { res.status(404).json({ error: 'not_found' }); return }
  res.json({ data: result.rows[0] })
})

integrationsRouter.post('/', async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }
  if (!['owner','admin'].includes(req.auth?.role ?? '')) { res.status(403).json({ error: 'forbidden' }); return }

  const b = req.body as Record<string, unknown>
  if (!b['name'] || !b['type']) { res.status(422).json({ error: 'validation', message: 'name and type required' }); return }

  const result = await tenantQuery(tenantId, `
    INSERT INTO integrations (tenant_id,name,type,status,direction,base_url,config,field_mappings,sync_interval,created_by)
    VALUES (current_setting('app.current_tenant_id',true)::uuid,$1,$2,'pending',$3,$4,$5,$6,$7,$8)
    RETURNING id,name,type,status,direction,base_url,config,field_mappings,created_at
  `, [b['name'],b['type'],b['direction']??'bidirectional',b['base_url']??null,JSON.stringify(b['config']??{}),JSON.stringify(b['field_mappings']??{}),b['sync_interval']??3600,req.auth?.sub??null])
  res.status(201).json({ data: result.rows[0] })
})

integrationsRouter.patch('/:id', async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }
  if (!['owner','admin'].includes(req.auth?.role ?? '')) { res.status(403).json({ error: 'forbidden' }); return }

  const fields = ['name','status','direction','base_url','config','field_mappings','sync_enabled','sync_interval']
  const sets: string[] = []; const vals: unknown[] = []; let i = 1
  for (const f of fields) {
    if (Object.prototype.hasOwnProperty.call(req.body, f)) {
      sets.push(`${f}=$${i++}`)
      vals.push(['config','field_mappings'].includes(f) ? JSON.stringify(req.body[f]) : req.body[f])
    }
  }
  if (!sets.length) { res.status(422).json({ error: 'validation', message: 'No valid fields' }); return }
  vals.push(req.params['id'])
  const result = await tenantQuery(tenantId, `
    UPDATE integrations SET ${sets.join(',')}
    WHERE id=$${i} AND tenant_id=current_setting('app.current_tenant_id',true)::uuid RETURNING *
  `, vals)
  if (!result.rows[0]) { res.status(404).json({ error: 'not_found' }); return }
  res.json({ data: result.rows[0] })
})

integrationsRouter.post('/:id/test', async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const result = await tenantQuery(tenantId, `
    SELECT id,name,type,base_url,config FROM integrations
    WHERE id=$1 AND tenant_id=current_setting('app.current_tenant_id',true)::uuid
  `, [req.params['id']])

  const integration = result.rows[0]
  if (!integration) { res.status(404).json({ error: 'not_found' }); return }

  // Connectivity test (simple HTTP GET to base_url/health or ping)
  let ok = false; let message = 'No base_url configured'
  if (integration.base_url) {
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 5000)
      const r = await fetch(`${integration.base_url}/health`, { signal: ctrl.signal }).finally(() => clearTimeout(t))
      ok = r.ok
      message = `HTTP ${r.status}`
    } catch (e) { message = (e as Error)?.message ?? 'Connection failed' }
  }

  await tenantQuery(tenantId, `
    UPDATE integrations SET status=$1, last_error=$2 WHERE id=$3
  `, [ok ? 'active' : 'error', ok ? null : message, integration.id])

  res.json({ data: { ok, message } })
})

integrationsRouter.post('/:id/sync', async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const intRes = await tenantQuery(tenantId, `
    SELECT id,type,status FROM integrations WHERE id=$1 AND tenant_id=current_setting('app.current_tenant_id',true)::uuid
  `, [req.params['id']])
  if (!intRes.rows[0]) { res.status(404).json({ error: 'not_found' }); return }
  if (intRes.rows[0].status !== 'active') { res.status(409).json({ error: 'integration_not_active' }); return }

  const jobRes = await tenantQuery(tenantId, `
    INSERT INTO sync_jobs (tenant_id,integration_id,status,direction,triggered_by)
    VALUES (current_setting('app.current_tenant_id',true)::uuid,$1,'pending',$2,$3) RETURNING id
  `, [intRes.rows[0].id, req.body['direction']??'bidirectional', req.auth?.sub??null])

  slog('INFO', 'integrations', '[sync] Job queued', { tenantId, jobId: jobRes.rows[0].id, integrationId: intRes.rows[0].id })
  res.status(202).json({ data: { jobId: jobRes.rows[0].id, status: 'pending', message: 'Sync job queued.' } })
})

// ═══════════════════════════════════════════════════════════════════════════════
// WEBHOOKS ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

export const webhooksRouter = Router()
webhooksRouter.use(..._auth())

webhooksRouter.get('/', async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }
  const data = await tenantQuery(tenantId, `
    SELECT id,name,url,events,active,retry_max,last_triggered,last_status,failure_count,created_at
    FROM webhooks WHERE tenant_id=current_setting('app.current_tenant_id',true)::uuid ORDER BY created_at DESC
  `, [])
  res.json({ data: data.rows })
})

webhooksRouter.post('/', async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }
  if (!['owner','admin'].includes(req.auth?.role ?? '')) { res.status(403).json({ error: 'forbidden' }); return }

  const b = req.body as Record<string, unknown>
  if (!b['name'] || !b['url']) { res.status(422).json({ error: 'validation', message: 'name and url required' }); return }

  const secret = crypto.randomBytes(32).toString('hex')
  const result = await tenantQuery(tenantId, `
    INSERT INTO webhooks (tenant_id,name,url,secret,events,active,retry_max,timeout_ms,headers,created_by)
    VALUES (current_setting('app.current_tenant_id',true)::uuid,$1,$2,$3,$4,$5,$6,$7,$8,$9)
    RETURNING id,name,url,events,active,retry_max,created_at
  `, [b['name'],b['url'],secret,b['events']??[],b['active']??true,b['retry_max']??3,b['timeout_ms']??10000,JSON.stringify(b['headers']??{}),req.auth?.sub??null])

  res.status(201).json({ data: { ...result.rows[0], secret } })
})

webhooksRouter.patch('/:id', async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }
  const fields = ['name','url','events','active','retry_max','timeout_ms','headers']
  const sets: string[] = []; const vals: unknown[] = []; let i = 1
  for (const f of fields) {
    if (Object.prototype.hasOwnProperty.call(req.body, f)) {
      sets.push(`${f}=$${i++}`)
      vals.push(f === 'headers' ? JSON.stringify(req.body[f]) : req.body[f])
    }
  }
  if (!sets.length) { res.status(422).json({ error: 'validation', message: 'No valid fields' }); return }
  vals.push(req.params['id'])
  const result = await tenantQuery(tenantId, `UPDATE webhooks SET ${sets.join(',')} WHERE id=$${i} AND tenant_id=current_setting('app.current_tenant_id',true)::uuid RETURNING id,name,url,events,active`, vals)
  if (!result.rows[0]) { res.status(404).json({ error: 'not_found' }); return }
  res.json({ data: result.rows[0] })
})

webhooksRouter.delete('/:id', async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }
  const result = await tenantQuery<{ id: string }>(tenantId, `
    DELETE FROM webhooks WHERE id=$1 AND tenant_id=current_setting('app.current_tenant_id',true)::uuid RETURNING id
  `, [req.params['id']])
  if (!result.rows[0]) { res.status(404).json({ error: 'not_found' }); return }
  res.status(204).send()
})

webhooksRouter.get('/:id/deliveries', async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }
  const data = await tenantQuery(tenantId, `
    SELECT id,event,attempt,status_code,duration_ms,error,delivered_at,created_at
    FROM webhook_deliveries WHERE webhook_id=$1 AND tenant_id=current_setting('app.current_tenant_id',true)::uuid
    ORDER BY created_at DESC LIMIT 50
  `, [req.params['id']])
  res.json({ data: data.rows })
})

// ─── Sync jobs ────────────────────────────────────────────────────────────────

export const syncJobsRouter = Router()
syncJobsRouter.use(..._auth())

syncJobsRouter.get('/', async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }
  // v4.31.0 TS fix: `page` unused — pagination uses limit/offset directly
  const { limit, offset } = _pagination(req.query as Record<string, unknown>)
  const data = await tenantQuery(tenantId, `
    SELECT sj.*, i.name AS integration_name, i.type AS integration_type, u.display_name AS triggered_by_name
    FROM sync_jobs sj
    JOIN integrations i ON i.id = sj.integration_id
    LEFT JOIN users u ON u.id = sj.triggered_by
    WHERE sj.tenant_id=current_setting('app.current_tenant_id',true)::uuid
    ORDER BY sj.created_at DESC LIMIT $1 OFFSET $2
  `, [limit, offset])
  res.json({ data: data.rows })
})
