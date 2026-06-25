/**
 * Denver Engineering — My Work API (v4.33.0)
 * ─────────────────────────────────────────────────────────────────────────────
 *   GET /api/v1/my-work    → the current user's cross-module personal queue
 *
 * See WORKFLOW_REDESIGN.md §7. Personal scope (not project-scoped): rolls up the
 * signed-in user's assigned/approval/overdue/upcoming/completed work.
 */
import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest } from '../middleware/tenant'
import { buildMyWork } from '../services/myWork/myWorkService'

type AuthTenantReq = Request & AuthenticatedRequest & TenantRequest
const router = Router()
router.use(requireAuth as never)
router.use(requireTenant() as never)

router.get('/my-work', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const userId = r.auth?.sub
  if (!userId) return res.status(401).json({ error: 'No authenticated user' })
  try {
    res.json({ data: await buildMyWork(r.tenantId!, userId, new Date()) })
  } catch (err) {
    res.status(500).json({ error: 'Failed to build My Work', detail: (err as Error).message })
  }
})

export const myWorkRouter = router
