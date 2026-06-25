/**
 * Denver Engineering — Related records API (v4.35.0)
 * ─────────────────────────────────────────────────────────────────────────────
 *   GET /api/v1/related/:source/:id   → records connected to this record
 *
 * See WORKFLOW_REDESIGN.md §9. Only real (FK / shared-key / Action-spine) links.
 */
import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest } from '../middleware/tenant'
import { getRelated, RELATED_SOURCES } from '../services/related/relatedService'

type AuthTenantReq = Request & AuthenticatedRequest & TenantRequest
const router = Router()
router.use(requireAuth as never)
router.use(requireTenant() as never)

router.get('/related/:source/:id', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const source = String(req.params.source)
  if (!RELATED_SOURCES.has(source)) return res.status(400).json({ error: `unknown source: ${source}` })
  try {
    res.json({ data: await getRelated(r.tenantId!, source, String(req.params.id)) })
  } catch (err) {
    res.status(500).json({ error: 'Failed to load related records', detail: (err as Error).message })
  }
})

export const relatedRouter = router
