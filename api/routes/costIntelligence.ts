/**
 * Denver Engineering — Cost Intelligence API (v4.54.0)
 * ─────────────────────────────────────────────────────────────────────────────
 *   GET /api/v1/projects/:projectId/cost-intelligence
 *       cost position, drift drivers, overrun risk, recommendations
 */
import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest } from '../middleware/tenant'
import { buildCostIntelligence } from '../services/costControl/costIntelligenceService'
import { requireCapability } from '../authz/requireCapability'
import { requireProjectScope } from '../authz/recordScope'

type AuthTenantReq = Request & AuthenticatedRequest & TenantRequest
const router = Router()
router.use(requireAuth as never)
router.use(requireTenant() as never)

router.get('/projects/:projectId/cost-intelligence', requireCapability('cost.view') as never, requireProjectScope() as never, async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  try {
    const result = await buildCostIntelligence(r.tenantId!, String(req.params.projectId))
    if (!result) return res.status(404).json({ error: 'Project not found' })
    res.json({ data: result })
  } catch (err) {
    res.status(500).json({ error: 'Failed to build cost intelligence', detail: (err as Error).message })
  }
})

export const costIntelligenceRouter = router
