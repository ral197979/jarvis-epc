/**
 * Denver Engineering — Export Routes (v4.40.0)
 * ──────────────────────────────────────────────
 * Ava Phase 4 — Async data export job lifecycle.
 */

import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { TenantRequest } from '../middleware/tenant'
import { createExportJob, getExportJob } from '../services/export/dataWarehouse'

export const exportsRouter = Router()
const auth = requireAuth as never
type ExportReq = Request & AuthenticatedRequest & TenantRequest

exportsRouter.use(auth)

// ─── Create export job ────────────────────────────────────────────────────────
exportsRouter.post('/', async (req: Request, res: Response) => {
  const r = req as ExportReq
  const { name, export_type, format = 'json', filters = {} } = req.body
  if (!name || !export_type) {
    res.status(400).json({ error: 'name and export_type are required' }); return
  }
  const valid_types = ['analytics','audit','actions','readiness','events','sla_predictions','recommendations']
  if (!valid_types.includes(export_type)) {
    res.status(400).json({ error: `export_type must be one of: ${valid_types.join(', ')}` }); return
  }
  const jobId = await createExportJob({
    tenantId: r.tenantId, name, exportType: export_type, format, filters, requestedBy: r.auth.sub,
  })
  res.status(202).json({ data: { job_id: jobId, status: 'pending' } })
})

// ─── Get export job status ────────────────────────────────────────────────────
exportsRouter.get('/:id', async (req: Request, res: Response) => {
  const r = req as ExportReq
  const job = await getExportJob(r.tenantId, req.params['id']!)
  if (!job) { res.status(404).json({ error: 'Export job not found' }); return }
  res.json({ data: job })
})

// ─── Download (redirect to signed URL) ───────────────────────────────────────
exportsRouter.get('/:id/download', async (req: Request, res: Response) => {
  const r = req as ExportReq
  const job = await getExportJob(r.tenantId, req.params['id']!) as Record<string, unknown> | null
  if (!job) { res.status(404).json({ error: 'Not found' }); return }
  if (job['status'] !== 'completed') {
    res.status(400).json({ error: `Export not ready (status: ${job['status']})` }); return
  }
  if (!job['download_url']) {
    res.status(400).json({ error: 'Download URL not available' }); return
  }
  res.redirect(job['download_url'] as string)
})
