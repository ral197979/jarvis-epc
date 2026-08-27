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
import { requireCapability } from '../authz/requireCapability'
import { personalPrincipal } from '../authz/personalScope'

type AuthTenantReq = Request & AuthenticatedRequest & TenantRequest
const router = Router()
router.use(requireAuth as never)
router.use(requireTenant() as never)

router.get('/my-work', requireCapability('personal.view') as never, async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  // ADR-014 Phase 2C-4A: live principal, so a deactivated or deleted user cannot
  // pull a queue. `buildMyWork` is already self-scoped and stays that way — no
  // caller-supplied user scope is accepted anywhere on this route.
  const principal = await personalPrincipal(req)
  if (!principal) return res.status(401).json({ error: 'unauthenticated' })
  const userId = principal.id
  try {
    res.json({ data: await buildMyWork(r.tenantId!, userId, new Date()) })
  } catch (err) {
    res.status(500).json({ error: 'Failed to build My Work', detail: (err as Error).message })
  }
})

export const myWorkRouter = router
