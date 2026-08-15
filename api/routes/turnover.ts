/**
 * Denver Engineering — Turnover packages API (v4.38.0)
 * ─────────────────────────────────────────────────────────────────────────────
 *   GET   /api/v1/projects/:projectId/turnover-packages
 *   POST  /api/v1/projects/:projectId/turnover-packages   { name, area? }
 *   PATCH /api/v1/turnover-packages/:id                    { status | deliverables | commissioning_url | commissioning_status | notes }
 *
 * See WORKFLOW_REDESIGN.md §17.
 */
import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest } from '../middleware/tenant'
import { listPackages, createPackage, updatePackage, isValidStatus } from '../services/turnover/turnoverService'

import { requireCapability } from '../authz/requireCapability'
type AuthTenantReq = Request & AuthenticatedRequest & TenantRequest
const router = Router()
router.use(requireAuth as never)
router.use(requireTenant() as never)

router.get('/projects/:projectId/turnover-packages', requireCapability('docs.view') as never, async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  try { res.json({ data: await listPackages(r.tenantId!, String(req.params.projectId)) }) }
  catch (err) { res.status(500).json({ error: 'Failed to list turnover packages', detail: (err as Error).message }) }
})

router.post('/projects/:projectId/turnover-packages', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const name = (req.body as { name?: string }).name
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name is required' })
  try {
    const row = await createPackage(r.tenantId!, String(req.params.projectId), req.body, r.auth?.sub ?? null)
    res.status(201).json({ data: row })
  } catch (err) { res.status(500).json({ error: 'Failed to create turnover package', detail: (err as Error).message }) }
})

router.patch('/turnover-packages/:id', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const b = req.body as { status?: string }
  if (b.status !== undefined && !isValidStatus(b.status)) return res.status(400).json({ error: 'invalid status' })
  try {
    const row = await updatePackage(r.tenantId!, String(req.params.id), req.body)
    if (!row) return res.status(404).json({ error: 'Turnover package not found' })
    res.json({ data: row })
  } catch (err) { res.status(500).json({ error: 'Failed to update turnover package', detail: (err as Error).message }) }
})

export const turnoverRouter = router
