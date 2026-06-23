/**
 * Denver Engineering — RFI Copilot API (v4.46.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * Mounted alongside the RFIs router; the `/:id/copilot` suffix does not collide
 * with the existing `/:id` routes.
 *
 *   GET /api/v1/rfis/:id/copilot  — precedent, suggested responders, impact
 */
import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest } from '../middleware/tenant'
import { buildRfiCopilot } from '../services/rfi/rfiCopilotService'

type AuthTenantReq = Request & AuthenticatedRequest & TenantRequest
const router = Router()
router.use(requireAuth as never)
router.use(requireTenant() as never)

router.get('/:id/copilot', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  try {
    const result = await buildRfiCopilot(r.tenantId!, String(req.params.id), new Date())
    if (!result) return res.status(404).json({ error: 'RFI not found' })
    res.json({ data: result })
  } catch (err) {
    res.status(500).json({ error: 'Failed to build RFI copilot', detail: (err as Error).message })
  }
})

export const rfiCopilotRouter = router
