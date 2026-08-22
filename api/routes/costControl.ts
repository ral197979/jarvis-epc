/**
 * Denver Engineering — Cost Control API Routes (v10.10.0)
 *
 * GET /api/v1/projects/:projectId/cost-control  — full snapshot
 */
import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest }       from '../middleware/tenant'
import { getCostControlSnapshot } from '../services/costControl/costControlService'
import { requireCapability } from '../authz/requireCapability'
import { requireProjectScope } from '../authz/recordScope'

type R = Request & AuthenticatedRequest & TenantRequest
const p = (req: Request, key: string) => {
  const v = (req.params as Record<string, string | string[]>)[key]
  return Array.isArray(v) ? v[0] : (v ?? '')
}

export const costControlRouter = Router()
costControlRouter.use(requireAuth    as never)
costControlRouter.use(requireTenant() as never)

costControlRouter.get('/projects/:projectId/cost-control', requireCapability('cost.view') as never, requireProjectScope() as never, async (req: Request, res: Response) => {
  const r = req as R
  try {
    const snapshot = await getCostControlSnapshot(r.tenantId!, p(req, 'projectId'))
    res.json({ snapshot })
  } catch (e) {
    console.error('[cost-control] snapshot error', e)
    res.status(500).json({ error: 'Failed to load cost control snapshot' })
  }
})
