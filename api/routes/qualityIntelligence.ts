/**
 * Denver Engineering — Quality Intelligence API (v4.51.0)
 * ─────────────────────────────────────────────────────────────────────────────
 *   GET /api/v1/projects/:projectId/quality-intelligence
 *       recurring issues, discipline performance, location hotspots
 */
import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest } from '../middleware/tenant'
import { buildQualityIntelligence } from '../services/quality/qualityIntelligenceService'

import { requireCapability } from '../authz/requireCapability'
type AuthTenantReq = Request & AuthenticatedRequest & TenantRequest
const router = Router()
router.use(requireAuth as never)
router.use(requireTenant() as never)

router.get('/projects/:projectId/quality-intelligence', requireCapability('quality.view') as never, async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  try {
    const result = await buildQualityIntelligence(r.tenantId!, String(req.params.projectId), new Date())
    if (!result) return res.status(404).json({ error: 'Project not found' })
    res.json({ data: result })
  } catch (err) {
    res.status(500).json({ error: 'Failed to build quality intelligence', detail: (err as Error).message })
  }
})

export const qualityIntelligenceRouter = router
