/**
 * Denver Engineering — Schedule Forecast API (v4.50.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * Mounted alongside the schedule router; `/:projectId/forecast` does not collide
 * with the existing `/:projectId/cpm`, `/:projectId/tasks` routes.
 *
 *   GET /api/v1/schedule/:projectId/forecast?iterations=&target=
 */
import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest } from '../middleware/tenant'
import { buildScheduleForecast } from '../services/schedule/scheduleMonteCarloService'

import { requireCapability } from '../authz/requireCapability'
type AuthTenantReq = Request & AuthenticatedRequest & TenantRequest
const router = Router()
router.use(requireAuth as never)
router.use(requireTenant() as never)

router.get('/:projectId/forecast', requireCapability('schedule.view') as never, async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const iterations = parseInt(String(req.query['iterations'] ?? ''), 10)
  const target = parseInt(String(req.query['target'] ?? ''), 10)
  try {
    const result = await buildScheduleForecast(r.tenantId!, String(req.params.projectId), {
      iterations: isNaN(iterations) ? undefined : iterations,
      targetDays: isNaN(target) ? null : target,
    })
    if (result === null) return res.status(404).json({ error: 'Project not found' })
    if ('error' in result) return res.status(422).json({ error: result.error })
    res.json({ data: result })
  } catch (err) {
    res.status(500).json({ error: 'Forecast failed', detail: (err as Error).message })
  }
})

export const scheduleForecastRouter = router
