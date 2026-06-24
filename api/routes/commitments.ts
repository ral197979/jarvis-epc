/**
 * Denver Engineering — Commitment Rollup API (v4.57.0)
 * ─────────────────────────────────────────────────────────────────────────────
 *   GET /api/v1/projects/:projectId/commitments
 *       committed / billed / retention / remaining + per-subcontract breakdown
 */
import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest } from '../middleware/tenant'
import { buildCommitmentRollup } from '../services/costControl/commitmentRollupService'

type AuthTenantReq = Request & AuthenticatedRequest & TenantRequest
const router = Router()
router.use(requireAuth as never)
router.use(requireTenant() as never)

router.get('/projects/:projectId/commitments', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  try {
    const result = await buildCommitmentRollup(r.tenantId!, String(req.params.projectId))
    if (!result) return res.status(404).json({ error: 'Project not found' })
    res.json({ data: result })
  } catch (err) {
    res.status(500).json({ error: 'Failed to build commitment rollup', detail: (err as Error).message })
  }
})

export const commitmentsRouter = router
