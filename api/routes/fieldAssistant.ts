/**
 * Denver Engineering — Field Assistant API (v4.48.0)
 * ─────────────────────────────────────────────────────────────────────────────
 *   GET /api/v1/projects/:projectId/field-assistant
 *       → inspections due, behind schedule, and open items by area
 */
import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest } from '../middleware/tenant'
import { buildProjectFieldBriefing } from '../services/field/fieldAssistantService'

import { requireAllCapabilities } from '../authz/requireCapability'
type AuthTenantReq = Request & AuthenticatedRequest & TenantRequest
const router = Router()
router.use(requireAuth as never)
router.use(requireTenant() as never)

router.get('/projects/:projectId/field-assistant', requireAllCapabilities('assistant.use', 'project.view', 'quality.view', 'schedule.view') as never, async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  try {
    const briefing = await buildProjectFieldBriefing(r.tenantId!, String(req.params.projectId), new Date())
    if (!briefing) return res.status(404).json({ error: 'Project not found' })
    res.json({ data: briefing })
  } catch (err) {
    res.status(500).json({ error: 'Failed to build field briefing', detail: (err as Error).message })
  }
})

export const fieldAssistantRouter = router
