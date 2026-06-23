/**
 * Denver Engineering — Pay Applications API (v4.45.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * AIA G702/G703 progress billing against a Schedule of Values.
 *
 *   GET   /api/v1/projects/:projectId/sov-items
 *   POST  /api/v1/projects/:projectId/sov-items
 *   GET   /api/v1/projects/:projectId/pay-applications
 *   POST  /api/v1/projects/:projectId/pay-applications        (creates a draft G702)
 *   GET   /api/v1/pay-applications/:id                         (computed G702/G703)
 *   PATCH /api/v1/pay-applications/:id/lines                   (upsert this-period amounts)
 *   PATCH /api/v1/pay-applications/:id                         (status transition)
 */
import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest } from '../middleware/tenant'
import { tenantQuery } from '../db/pool'
import {
  listSovItems, createSovItem, listPayApplications, createPayApplication,
  getPayApplicationView, upsertPayApplicationLines, setPayApplicationStatus,
} from '../services/costControl/payApplicationService'

type AuthTenantReq = Request & AuthenticatedRequest & TenantRequest
const router = Router()
router.use(requireAuth as never)
router.use(requireTenant() as never)

const VALID_STATUS = new Set(['draft', 'submitted', 'approved', 'paid', 'rejected'])

// ─── Schedule of Values ───────────────────────────────────────────────────────

router.get('/projects/:projectId/sov-items', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  try {
    res.json({ data: await listSovItems(r.tenantId!, String(req.params.projectId)) })
  } catch (err) { res.status(500).json({ error: 'Failed to list SOV items', detail: (err as Error).message }) }
})

router.post('/projects/:projectId/sov-items', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const b = req.body as { item_no?: string; description?: string; scheduled_value?: number; cost_code?: string; sort_order?: number }
  if (!b.item_no || !b.description) {
    return res.status(400).json({ error: 'item_no and description are required' })
  }
  if (b.scheduled_value != null && (typeof b.scheduled_value !== 'number' || b.scheduled_value < 0)) {
    return res.status(400).json({ error: 'scheduled_value must be a non-negative number' })
  }
  try {
    const row = await createSovItem(r.tenantId!, String(req.params.projectId), {
      item_no: b.item_no, description: b.description, scheduled_value: b.scheduled_value ?? 0,
      cost_code: b.cost_code ?? null, sort_order: b.sort_order ?? 0,
    }, r.auth?.sub ?? null)
    res.status(201).json({ data: row })
  } catch (err) { res.status(500).json({ error: 'Failed to create SOV item', detail: (err as Error).message }) }
})

// ─── Pay applications ─────────────────────────────────────────────────────────

router.get('/projects/:projectId/pay-applications', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  try {
    res.json({ data: await listPayApplications(r.tenantId!, String(req.params.projectId)) })
  } catch (err) { res.status(500).json({ error: 'Failed to list pay applications', detail: (err as Error).message }) }
})

router.post('/projects/:projectId/pay-applications', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const b = req.body as { retention_pct?: number; period_start?: string; period_end?: string; invoice_date?: string; seed_from_sov?: boolean }
  if (b.retention_pct != null && (b.retention_pct < 0 || b.retention_pct > 100)) {
    return res.status(400).json({ error: 'retention_pct must be between 0 and 100' })
  }
  try {
    const app = await createPayApplication(r.tenantId!, String(req.params.projectId), b, r.auth?.sub ?? null)
    res.status(201).json({ data: app })
  } catch (err) { res.status(500).json({ error: 'Failed to create pay application', detail: (err as Error).message }) }
})

router.get('/pay-applications/:id', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  try {
    const view = await getPayApplicationView(r.tenantId!, String(req.params.id))
    if (!view) return res.status(404).json({ error: 'Pay application not found' })
    res.json({ data: view })
  } catch (err) { res.status(500).json({ error: 'Failed to load pay application', detail: (err as Error).message }) }
})

router.patch('/pay-applications/:id/lines', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const b = req.body as { lines?: { sov_item_id: string; work_completed?: number; materials_stored?: number }[] }
  if (!Array.isArray(b.lines) || b.lines.length === 0) {
    return res.status(400).json({ error: 'lines array is required' })
  }
  if (b.lines.some(l => !l.sov_item_id)) {
    return res.status(400).json({ error: 'each line requires a sov_item_id' })
  }
  try {
    // Only editable while draft or rejected.
    const cur = await tenantQuery(r.tenantId!,
      `SELECT status FROM pay_applications WHERE tenant_id=$1 AND id=$2`, [r.tenantId!, String(req.params.id)])
    const status = cur.rows[0]?.status as string | undefined
    if (!status) return res.status(404).json({ error: 'Pay application not found' })
    if (!['draft', 'rejected'].includes(status)) {
      return res.status(409).json({ error: `Pay application is ${status}; only draft or rejected applications can be edited` })
    }
    const result = await upsertPayApplicationLines(r.tenantId!, String(req.params.id), b.lines)
    res.json({ data: result })
  } catch (err) { res.status(500).json({ error: 'Failed to update lines', detail: (err as Error).message }) }
})

router.patch('/pay-applications/:id', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const status = (req.body as { status?: string }).status
  if (!status || !VALID_STATUS.has(status)) {
    return res.status(400).json({ error: `status must be one of ${[...VALID_STATUS].join(', ')}` })
  }
  try {
    const row = await setPayApplicationStatus(r.tenantId!, String(req.params.id), status)
    if (!row) return res.status(404).json({ error: 'Pay application not found' })
    res.json({ data: row })
  } catch (err) { res.status(500).json({ error: 'Failed to update status', detail: (err as Error).message }) }
})

export const payApplicationsRouter = router
