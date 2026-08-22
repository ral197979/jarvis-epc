/**
 * Denver Engineering — Vendor Scorecard API (v4.59.0)
 * ─────────────────────────────────────────────────────────────────────────────
 *   GET /api/v1/projects/:projectId/vendor-scorecard
 *       per-vendor standing: commitments, billing, PO on-time, at-risk
 */
import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest } from '../middleware/tenant'
import { buildVendorScorecard } from '../services/procurement/vendorScorecardService'

import { requireCapability } from '../authz/requireCapability'
import { requireProjectScope } from '../authz/recordScope'
type AuthTenantReq = Request & AuthenticatedRequest & TenantRequest
const router = Router()
router.use(requireAuth as never)
router.use(requireTenant() as never)

router.get('/projects/:projectId/vendor-scorecard', requireCapability('procurement.view') as never, requireProjectScope() as never, async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  try {
    const result = await buildVendorScorecard(r.tenantId!, String(req.params.projectId), new Date())
    if (!result) return res.status(404).json({ error: 'Project not found' })
    res.json({ data: result })
  } catch (err) {
    res.status(500).json({ error: 'Failed to build vendor scorecard', detail: (err as Error).message })
  }
})

export const vendorScorecardRouter = router
