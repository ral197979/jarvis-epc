/**
 * Denver Engineering — Submittal Review API (v4.47.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * Mounted alongside the submittals router; `/:id/review` does not collide with
 * the existing `/:id` routes.
 *
 *   GET /api/v1/submittals/:id/review — readiness checks, precedent, reviewer, risk
 */
import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest } from '../middleware/tenant'
import { buildSubmittalReview } from '../services/submittal/submittalReviewService'

import { requireCapability } from '../authz/requireCapability'
import { requireRecordScope } from '../authz/recordScope'
type AuthTenantReq = Request & AuthenticatedRequest & TenantRequest
const router = Router()
router.use(requireAuth as never)
router.use(requireTenant() as never)

router.get('/:id/review', requireCapability('construction.view') as never, requireRecordScope('submittal') as never, async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  try {
    const result = await buildSubmittalReview(r.tenantId!, String(req.params.id), new Date())
    if (!result) return res.status(404).json({ error: 'Submittal not found' })
    res.json({ data: result })
  } catch (err) {
    res.status(500).json({ error: 'Failed to build submittal review', detail: (err as Error).message })
  }
})

export const submittalReviewRouter = router
