/**
 * Denver Engineering — IoT Sensor Routes (v10.5.0)
 *
 * Sensor management (auth required):
 *   POST   /api/v1/projects/:projectId/sensors          — register sensor
 *   GET    /api/v1/projects/:projectId/sensors          — list sensors
 *   GET    /api/v1/sensors/:id                          — sensor detail + latest
 *   PATCH  /api/v1/sensors/:id/thresholds               — update alert thresholds
 *   GET    /api/v1/sensors/:id/readings                 — reading history
 *   GET    /api/v1/projects/:projectId/sensors/alerts   — open alerts
 *   POST   /api/v1/sensors/alerts/:alertId/acknowledge  — ack alert
 *   POST   /api/v1/sensors/tokens                       — create ingest token
 *
 * Ingest (accepts Bearer ingest token OR normal auth):
 *   POST   /api/v1/iot/ingest                           — batch ingest (Telegraf/EMQX webhook)
 *   POST   /api/v1/sensors/:uid/readings                — single reading ingest
 */
import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest } from '../middleware/tenant'
import {
  registerSensor, getSensor, listSensors, updateSensorThresholds,
  getReadings, getOpenAlerts, acknowledgeAlert,
  ingestBatch, ingestSingle,
  createIngestToken, resolveIngestToken,
} from '../services/iot/sensorIngestService'

import { requireCapability } from '../authz/requireCapability'
type R = Request & AuthenticatedRequest & TenantRequest
const p = (req: Request, key: string) => {
  const v = (req.params as Record<string, string | string[]>)[key]
  return Array.isArray(v) ? v[0] : (v ?? '')
}
const qs = (v: unknown) => Array.isArray(v) ? v[0] as string : v as string | undefined

// ─── Ingest token middleware ───────────────────────────────────────────────────
// Allows either a normal JWT (requireAuth) OR a bearer ingest token.

async function ingestAuth(req: Request, res: Response, next: () => void): Promise<void> {
  const auth = req.headers['authorization'] ?? ''
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : ''

  // Try normal auth first (sets tenantId via requireTenant)
  if (bearer && bearer.length === 64) {
    // 64-char hex = our ingest token
    const resolved = await resolveIngestToken(bearer)
    if (!resolved) { res.status(401).json({ error: 'Invalid ingest token' }); return }
    ;(req as R).tenantId = resolved.tenantId
    next(); return
  }
  // Fall through to normal auth (handled by caller route)
  next()
}

export const iotRouter = Router()

// ─── Authenticated management routes ─────────────────────────────────────────

const authRouter = Router()
authRouter.use(requireAuth   as never)
authRouter.use(requireTenant() as never)

authRouter.post('/projects/:projectId/sensors', async (req: Request, res: Response) => {
  const r = req as R
  try {
    const sensor = await registerSensor(r.tenantId!, { projectId: p(req, 'projectId'), ...req.body })
    res.status(201).json({ sensor })
  } catch (e) { res.status(500).json({ error: 'Failed to register sensor', detail: (e as Error).message }) }
})

authRouter.get('/projects/:projectId/sensors', requireCapability('construction.view') as never, async (req: Request, res: Response) => {
  const r = req as R
  try {
    const sensors = await listSensors(r.tenantId!, p(req, 'projectId'))
    res.json({ sensors })
  } catch (e) { res.status(500).json({ error: 'Failed to list sensors' }) }
})

authRouter.get('/sensors/:id', requireCapability('construction.view') as never, async (req: Request, res: Response) => {
  const r = req as R
  try {
    const sensor = await getSensor(r.tenantId!, p(req, 'id'))
    if (!sensor) { res.status(404).json({ error: 'Sensor not found' }); return }
    res.json({ sensor })
  } catch (e) { res.status(500).json({ error: 'Failed to get sensor' }) }
})

authRouter.patch('/sensors/:id/thresholds', async (req: Request, res: Response) => {
  const r = req as R
  try {
    const sensor = await updateSensorThresholds(r.tenantId!, p(req, 'id'), req.body)
    if (!sensor) { res.status(404).json({ error: 'Sensor not found' }); return }
    res.json({ sensor })
  } catch (e) { res.status(500).json({ error: 'Failed to update thresholds' }) }
})

authRouter.get('/sensors/:id/readings', requireCapability('construction.view') as never, async (req: Request, res: Response) => {
  const r = req as R
  try {
    const readings = await getReadings(r.tenantId!, p(req, 'id'), {
      from:  qs(req.query['from']),
      to:    qs(req.query['to']),
      limit: req.query['limit'] ? Number(req.query['limit']) : undefined,
    })
    res.json({ readings })
  } catch (e) { res.status(500).json({ error: 'Failed to get readings' }) }
})

authRouter.get('/projects/:projectId/sensors/alerts', requireCapability('construction.view') as never, async (req: Request, res: Response) => {
  const r = req as R
  try {
    const alerts = await getOpenAlerts(r.tenantId!, p(req, 'projectId'))
    res.json({ alerts })
  } catch (e) { res.status(500).json({ error: 'Failed to get alerts' }) }
})

authRouter.post('/sensors/alerts/:alertId/acknowledge', async (req: Request, res: Response) => {
  const r = req as R
  try {
    await acknowledgeAlert(r.tenantId!, p(req, 'alertId'), r.auth?.sub ?? 'unknown')
    res.json({ acknowledged: true })
  } catch (e) { res.status(500).json({ error: 'Failed to acknowledge alert' }) }
})

authRouter.post('/sensors/tokens', async (req: Request, res: Response) => {
  const r = req as R
  try {
    const { label = 'ingest-token', edgeNodeId, ttlDays } = req.body as Record<string, string>
    const result = await createIngestToken(r.tenantId!, label, edgeNodeId, ttlDays ? parseInt(ttlDays, 10) : 90)
    res.status(201).json({ ...result, warning: 'Store this token securely — it will not be shown again.' })
  } catch (e) { res.status(500).json({ error: 'Failed to create token' }) }
})

// ─── Ingest routes (token or JWT auth) ────────────────────────────────────────

// Telegraf HTTP output / EMQX webhook / Node-RED bulk ingest
// Accepts two formats:
//   1. Array of {sensorUid, value, ts?, quality?, raw?}
//   2. Telegraf line: [{name, tags:{sensor_uid}, fields:{value}, timestamp}]
iotRouter.post('/iot/ingest', requireAuth as never, requireTenant() as never, ingestAuth as never, async (req: Request, res: Response) => {
  const r = req as R
  const body = req.body as unknown

  let items: Array<{ sensorUid: string; value: number; ts?: string; quality?: 'good'|'uncertain'|'bad'; raw?: Record<string, unknown> }> = []

  if (Array.isArray(body)) {
    for (const item of body) {
      const i = item as Record<string, unknown>
      // Telegraf format: { name, tags: {sensor_uid}, fields: {value}, timestamp }
      if (i['tags'] && (i['fields'] as Record<string, unknown>)) {
        const tags   = i['tags'] as Record<string, string>
        const fields = i['fields'] as Record<string, number>
        const uid = tags['sensor_uid'] ?? tags['sensor_id'] ?? i['name'] as string
        const val = fields['value'] ?? fields['reading'] ?? Object.values(fields)[0]
        if (uid && val != null) {
          const tsNs = i['timestamp'] as number | undefined
          items.push({ sensorUid: uid, value: Number(val), ts: tsNs ? new Date(tsNs / 1e6).toISOString() : undefined, raw: i as Record<string, unknown> })
        }
      } else if (i['sensorUid'] != null) {
        items.push(i as typeof items[0])
      }
    }
  } else if (typeof body === 'object' && body !== null) {
    const i = body as Record<string, unknown>
    if (i['sensorUid'] != null) items.push(i as typeof items[0])
  }

  if (!items.length) { res.status(400).json({ error: 'No valid readings in payload' }); return }

  const projectId = qs(req.query['project_id']) ?? qs(req.body?.projectId) ?? ''

  try {
    const result = await ingestBatch(r.tenantId!, projectId, items)
    res.status(result.rejected === items.length ? 422 : 201).json({ result })
  } catch (e) { res.status(500).json({ error: 'Ingest failed', detail: (e as Error).message }) }
})

// Per-sensor single reading (simple webhook / direct API)
iotRouter.post('/sensors/:uid/readings', requireAuth as never, requireTenant() as never, ingestAuth as never, async (req: Request, res: Response) => {
  const r = req as R
  const { value, ts, quality, raw } = req.body as Record<string, unknown>
  if (value == null) { res.status(400).json({ error: 'value is required' }); return }
  const projectId = qs(req.query['project_id']) ?? ''
  try {
    const result = await ingestSingle(r.tenantId!, projectId, {
      sensorUid: p(req, 'uid'), value: Number(value),
      ts: ts as string | undefined,
      quality: quality as 'good' | undefined,
      raw: raw as Record<string, unknown> | undefined,
    })
    res.status(201).json({ result })
  } catch (e) { res.status(500).json({ error: 'Ingest failed', detail: (e as Error).message }) }
})

iotRouter.use('/', authRouter)
