/**
 * Denver Engineering — Risk Register Routes (v10.17.0)
 *
 * GET  /api/v1/projects/:projectId/risks/summary
 * POST /api/v1/projects/:projectId/risks
 * GET  /api/v1/projects/:projectId/risks
 * GET  /api/v1/risks/:id
 * PATCH /api/v1/risks/:id
 * POST  /api/v1/risks/:id/close
 */
import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest }       from '../middleware/tenant'
import { requireCapability } from '../authz/requireCapability'
import { requireProjectScope, requireRecordScope } from '../authz/recordScope'
import { guardTransitionOwnedState } from '../authz/transitionStates'
import {
  createRisk, listRisks, getRisk, updateRisk, closeRisk, getRiskSummary,
  type RiskStatus, type RiskCategory,
} from '../services/riskRegister/riskService'

type R = Request & AuthenticatedRequest & TenantRequest
const p = (req: Request, key: string) => {
  const v = (req.params as Record<string, string | string[]>)[key]
  return Array.isArray(v) ? v[0] : (v ?? '')
}
const q = (req: Request, key: string) => {
  const v = (req.query as Record<string, string | string[]>)[key]
  return Array.isArray(v) ? v[0] : v
}

export const riskRegisterRouter = Router()
riskRegisterRouter.use(requireAuth     as never)
riskRegisterRouter.use(requireTenant() as never)

riskRegisterRouter.get('/projects/:projectId/risks/summary', requireCapability('risk.view') as never, requireProjectScope() as never, async (req: Request, res: Response) => {
  const r = req as R
  try { res.json({ summary: await getRiskSummary(r.tenantId!, p(req, 'projectId')) }) }
  catch (e) { res.status(500).json({ error: 'Failed to load risk summary' }) }
})

riskRegisterRouter.post('/projects/:projectId/risks', requireCapability('risk.write') as never, requireProjectScope() as never, async (req: Request, res: Response) => {
  const r = req as R
  const { title, category, probability, impact } = req.body as Record<string, unknown>
  if (!title || !category || !probability || !impact) {
    res.status(400).json({ error: 'title, category, probability, impact required' }); return
  }
  try {
    const risk = await createRisk(r.tenantId!, p(req, 'projectId'), { createdBy: r.auth?.sub, ...req.body })
    res.status(201).json({ risk })
  } catch (e) { res.status(500).json({ error: 'Failed to create risk' }) }
})

riskRegisterRouter.get('/projects/:projectId/risks', requireCapability('risk.view') as never, requireProjectScope() as never, async (req: Request, res: Response) => {
  const r = req as R
  try {
    const risks = await listRisks(r.tenantId!, p(req, 'projectId'), {
      status:   q(req, 'status')   as RiskStatus   | undefined,
      category: q(req, 'category') as RiskCategory | undefined,
    })
    res.json({ risks })
  } catch (e) { res.status(500).json({ error: 'Failed to list risks' }) }
})

riskRegisterRouter.get('/risks/:id', requireCapability('risk.view') as never, requireRecordScope('risks') as never, async (req: Request, res: Response) => {
  const r = req as R
  try {
    const risk = await getRisk(r.tenantId!, p(req, 'id'))
    if (!risk) { res.status(404).json({ error: 'Risk not found' }); return }
    res.json({ risk })
  } catch (e) { res.status(500).json({ error: 'Failed to get risk' }) }
})

riskRegisterRouter.patch('/risks/:id', requireCapability('risk.write') as never, requireRecordScope('risks') as never, guardTransitionOwnedState('risks') as never, async (req: Request, res: Response) => {
  const r = req as R
  try {
    const risk = await updateRisk(r.tenantId!, p(req, 'id'), req.body)
    if (!risk) { res.status(404).json({ error: 'Risk not found' }); return }
    res.json({ risk })
  } catch (e) { res.status(500).json({ error: 'Failed to update risk' }) }
})

riskRegisterRouter.post('/risks/:id/close', requireCapability('risk.approve') as never, requireRecordScope('risks') as never, async (req: Request, res: Response) => {
  const r = req as R
  try {
    const risk = await closeRisk(r.tenantId!, p(req, 'id'))
    if (!risk) { res.status(404).json({ error: 'Risk not found or already closed' }); return }
    res.json({ risk })
  } catch (e) { res.status(500).json({ error: 'Failed to close risk' }) }
})
