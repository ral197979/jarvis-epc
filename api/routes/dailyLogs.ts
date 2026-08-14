/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Denver Engineering — Daily Logs API Route
 * ─────────────────────────────────────────────────────────────────────────────
 * v4.31.0 — Procore-parity daily field log.
 *
 * Endpoints:
 *   GET    /api/v1/projects/:projectId/daily-logs
 *   POST   /api/v1/projects/:projectId/daily-logs
 *   GET    /api/v1/daily-logs/:id
 *   PATCH  /api/v1/daily-logs/:id
 *   DELETE /api/v1/daily-logs/:id
 *   POST   /api/v1/daily-logs/:id/submit
 *   POST   /api/v1/daily-logs/:id/approve
 */
import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest } from '../middleware/tenant'
import { tenantQuery } from '../db/pool'
import { requireCapability } from '../authz/requireCapability'
import { createAction } from '../services/actionService'  // v4.33.0 Ava

type AuthTenantReq = Request & AuthenticatedRequest & TenantRequest
const router = Router()
router.use(requireAuth   as any)
router.use(requireTenant() as any)

const JSONB_FIELDS = new Set(['manpower','equipment','visitors','deliveries','incidents','photos'])

router.get('/projects/:projectId/daily-logs', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const { projectId } = req.params
  const { status, from, to, limit = '60', offset = '0' } = req.query
  const params: unknown[] = [r.tenantId!, projectId]
  const filters: string[] = []
  if (status) { params.push(status); filters.push(`status = $${params.length}`) }
  if (from)   { params.push(from);   filters.push(`log_date >= $${params.length}`) }
  if (to)     { params.push(to);     filters.push(`log_date <= $${params.length}`) }
  const where = filters.length ? `AND ${filters.join(' AND ')}` : ''
  params.push(parseInt(limit as string), parseInt(offset as string))
  try {
    const result = await tenantQuery(r.tenantId!,
      `SELECT id, log_date, weather, temp_f, wind_mph, humidity_pct,
              manpower, equipment, visitors, deliveries,
              work_performed, delays, safety_notes, incidents, quality_notes,
              photos, status, submitted_by, submitted_at, approved_by, approved_at,
              created_at, updated_at
         FROM daily_logs
        WHERE tenant_id=$1 AND project_id=$2 ${where}
        ORDER BY log_date DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    )
    res.json({ logs: result.rows, total: result.rowCount })
  } catch (e) {
    console.error('[daily-logs] list error', e)
    res.status(500).json({ error: 'Failed to list daily logs' })
  }
})

router.post('/projects/:projectId/daily-logs', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const projectId = req.params.projectId as string
  const b = req.body ?? {}
  if (!b.log_date) return res.status(400).json({ error: 'log_date required' })
  const j = (k: string) => b[k] != null ? JSON.stringify(b[k]) : '[]'
  try {
    const result = await tenantQuery(r.tenantId!,
      `INSERT INTO daily_logs
        (tenant_id, project_id, log_date, weather, temp_f, wind_mph, humidity_pct,
         manpower, equipment, visitors, deliveries,
         work_performed, delays, safety_notes, incidents, quality_notes, photos,
         status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       RETURNING *`,
      [r.tenantId!, projectId, b.log_date,
       b.weather ?? null, b.temp_f ?? null, b.wind_mph ?? null, b.humidity_pct ?? null,
       j('manpower'), j('equipment'), j('visitors'), j('deliveries'),
       b.work_performed ?? null, b.delays ?? null, b.safety_notes ?? null,
       j('incidents'), b.quality_notes ?? null, j('photos'),
       b.status ?? 'draft', (r as any).auth?.sub ?? null]
    )
    const row = result.rows[0]
    void createAction(r.tenantId!, {
      title:         `Daily Log: ${row.log_date}`,
      action_type:   'DAILY_LOG',
      source_module: 'daily_logs',
      source_id:     row.id,
      project_id:    projectId ?? null,
      priority:      'medium',
      created_by:    (r as any).auth?.sub ?? null,
    })
    res.status(201).json({ log: row })
  } catch (e: any) {
    if (e?.code === '23505') return res.status(409).json({ error: 'A log already exists for that date' })
    console.error('[daily-logs] create error', e)
    res.status(500).json({ error: 'Failed to create daily log' })
  }
})

router.get('/daily-logs/:id', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  try {
    const result = await tenantQuery(r.tenantId!,
      `SELECT * FROM daily_logs WHERE id=$1 AND tenant_id=$2`,
      [req.params.id, r.tenantId!]
    )
    if (!result.rows[0]) return res.status(404).json({ error: 'Log not found' })
    res.json({ log: result.rows[0] })
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch daily log' })
  }
})

router.patch('/daily-logs/:id', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const allowed = ['log_date','weather','temp_f','wind_mph','humidity_pct',
    'manpower','equipment','visitors','deliveries',
    'work_performed','delays','safety_notes','incidents','quality_notes','photos','status']
  const updates = Object.entries(req.body).filter(([k]) => allowed.includes(k))
  if (!updates.length) return res.status(400).json({ error: 'No updatable fields' })
  const setClauses = updates.map(([k], i) => `${k} = $${i + 3}`)
  const values = updates.map(([k, v]) =>
    JSONB_FIELDS.has(k) ? JSON.stringify(v ?? []) : v as any
  )
  setClauses.push(`updated_at = NOW()`)
  try {
    const result = await tenantQuery(r.tenantId!,
      `UPDATE daily_logs SET ${setClauses.join(', ')}
        WHERE id=$1 AND tenant_id=$2 RETURNING *`,
      [req.params.id, r.tenantId!, ...values]
    )
    if (!result.rows[0]) return res.status(404).json({ error: 'Log not found' })
    res.json({ log: result.rows[0] })
  } catch (e) {
    console.error('[daily-logs] patch error', e)
    res.status(500).json({ error: 'Failed to update daily log' })
  }
})

router.delete('/daily-logs/:id', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  try {
    await tenantQuery(r.tenantId!,
      'DELETE FROM daily_logs WHERE id=$1 AND tenant_id=$2',
      [req.params.id, r.tenantId!])
    res.json({ deleted: true })
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete daily log' })
  }
})

router.post('/daily-logs/:id/submit', requireCapability('construction.write') as never, async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  try {
    const result = await tenantQuery(r.tenantId!,
      `UPDATE daily_logs SET status='submitted', submitted_by=$3, submitted_at=NOW(), updated_at=NOW()
        WHERE id=$1 AND tenant_id=$2 RETURNING id, status, submitted_at`,
      [req.params.id, r.tenantId!, (r as any).auth?.sub ?? null])
    if (!result.rows[0]) return res.status(404).json({ error: 'Log not found' })
    res.json({ log: result.rows[0] })
  } catch (e) {
    res.status(500).json({ error: 'Failed to submit daily log' })
  }
})

router.post('/daily-logs/:id/approve', requireCapability('construction.approve') as never, async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  try {
    const result = await tenantQuery(r.tenantId!,
      `UPDATE daily_logs SET status='approved', approved_by=$3, approved_at=NOW(), updated_at=NOW()
        WHERE id=$1 AND tenant_id=$2 RETURNING id, status, approved_at`,
      [req.params.id, r.tenantId!, (r as any).auth?.sub ?? null])
    if (!result.rows[0]) return res.status(404).json({ error: 'Log not found' })
    res.json({ log: result.rows[0] })
  } catch (e) {
    res.status(500).json({ error: 'Failed to approve daily log' })
  }
})

export { router as dailyLogsRouter }
