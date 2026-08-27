/**
 * Denver Engineering — Predict API Routes (v10.15.0)
 *
 * GET /api/v1/predict/portfolio          — all projects health summary
 * GET /api/v1/predict/projects/:id       — single project deep analysis
 */
import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest }       from '../middleware/tenant'
import { getAllProjectHealth, getProjectHealth } from '../services/predict/predictService'
import { requireCapability } from '../authz/requireCapability'
import { requireProjectScope } from '../authz/recordScope'

type R = Request & AuthenticatedRequest & TenantRequest
const p = (req: Request, key: string) => {
  const v = (req.params as Record<string, string | string[]>)[key]
  return Array.isArray(v) ? v[0] : (v ?? '')
}

export const predictRouter = Router()
predictRouter.use(requireAuth     as never)
predictRouter.use(requireTenant() as never)

predictRouter.get('/predict/portfolio', requireCapability('portfolio.view') as never, async (req: Request, res: Response) => {
  const r = req as R
  try {
    const summary = await getAllProjectHealth(r.tenantId!)
    res.json({ summary })
  } catch (e) {
    console.error('[predict] portfolio error', e)
    res.status(500).json({ error: 'Failed to compute portfolio health' })
  }
})

predictRouter.get('/predict/projects/:id', requireCapability('portfolio.view') as never, requireProjectScope('id') as never, async (req: Request, res: Response) => {
  const r = req as R
  try {
    const health = await getProjectHealth(r.tenantId!, p(req, 'id'))
    if (!health) { res.status(404).json({ error: 'Project not found' }); return }
    res.json({ health })
  } catch (e) {
    res.status(500).json({ error: 'Failed to compute project health' })
  }
})
