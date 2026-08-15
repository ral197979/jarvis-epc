/**
 * Denver Engineering — Procurement Risk API (v4.52.0)
 * ─────────────────────────────────────────────────────────────────────────────
 *   GET /api/v1/projects/:projectId/procurement-risk
 *       per-PO delivery risk + vendor supply-chain rollup
 */
import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest } from '../middleware/tenant'
import { buildProcurementRisk } from '../services/procurement/procurementRiskService'

import { requireCapability } from '../authz/requireCapability'
type AuthTenantReq = Request & AuthenticatedRequest & TenantRequest
const router = Router()
router.use(requireAuth as never)
router.use(requireTenant() as never)

router.get('/projects/:projectId/procurement-risk', requireCapability('procurement.view') as never, async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  try {
    const result = await buildProcurementRisk(r.tenantId!, String(req.params.projectId), new Date())
    if (!result) return res.status(404).json({ error: 'Project not found' })
    res.json({ data: result })
  } catch (err) {
    res.status(500).json({ error: 'Failed to build procurement risk', detail: (err as Error).message })
  }
})

export const procurementRiskRouter = router
