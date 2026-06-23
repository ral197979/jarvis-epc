/**
 * Denver Engineering — Autonomous Coordination API (v4.49.0)
 * ─────────────────────────────────────────────────────────────────────────────
 *   POST /api/v1/projects/:projectId/coordination/scan            — generate recommendations
 *   GET  /api/v1/projects/:projectId/coordination/recommendations — list (?status=)
 *   POST /api/v1/coordination/recommendations/:id/approve         — execute (create action)
 *   POST /api/v1/coordination/recommendations/:id/dismiss
 */
import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest } from '../middleware/tenant'
import {
  scanProject, listRecommendations, approveRecommendation, dismissRecommendation,
} from '../services/coordination/autoCoordinationService'

type AuthTenantReq = Request & AuthenticatedRequest & TenantRequest
const router = Router()
router.use(requireAuth as never)
router.use(requireTenant() as never)

router.post('/projects/:projectId/coordination/scan', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  try {
    res.json({ data: await scanProject(r.tenantId!, String(req.params.projectId), new Date()) })
  } catch (err) { res.status(500).json({ error: 'Scan failed', detail: (err as Error).message }) }
})

router.get('/projects/:projectId/coordination/recommendations', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const status = typeof req.query['status'] === 'string' ? req.query['status'] : undefined
  try {
    res.json({ data: await listRecommendations(r.tenantId!, String(req.params.projectId), status) })
  } catch (err) { res.status(500).json({ error: 'Failed to list recommendations', detail: (err as Error).message }) }
})

router.post('/coordination/recommendations/:id/approve', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  try {
    const result = await approveRecommendation(r.tenantId!, String(req.params.id), r.auth?.sub ?? null)
    if ('notFound' in result) return res.status(404).json({ error: 'Recommendation not found' })
    if ('alreadyDecided' in result) return res.status(409).json({ error: `Recommendation already ${result.alreadyDecided}` })
    res.json({ data: result })
  } catch (err) { res.status(500).json({ error: 'Approval failed', detail: (err as Error).message }) }
})

router.post('/coordination/recommendations/:id/dismiss', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  try {
    const result = await dismissRecommendation(r.tenantId!, String(req.params.id), r.auth?.sub ?? null)
    if ('notFoundOrDecided' in result) return res.status(404).json({ error: 'Recommendation not found or already decided' })
    res.json({ data: result })
  } catch (err) { res.status(500).json({ error: 'Dismiss failed', detail: (err as Error).message }) }
})

export const autoCoordinationRouter = router
