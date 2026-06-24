/**
 * Denver Engineering — Critical-Path Intelligence API (v4.56.0)
 * ─────────────────────────────────────────────────────────────────────────────
 *   GET  /api/v1/schedule/:projectId/critical-path   — the zero-float chain + near-critical
 *   POST /api/v1/schedule/:projectId/what-if         — { changes: [{taskId, deltaDays}] }
 */
import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest } from '../middleware/tenant'
import { buildCriticalPath, buildWhatIf, type WhatIfChange } from '../services/schedule/scheduleCriticalPathService'

type AuthTenantReq = Request & AuthenticatedRequest & TenantRequest
const router = Router()
router.use(requireAuth as never)
router.use(requireTenant() as never)

router.get('/:projectId/critical-path', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  try {
    const result = await buildCriticalPath(r.tenantId!, String(req.params.projectId))
    if (!result) return res.status(404).json({ error: 'Project not found' })
    res.json({ data: result })
  } catch (err) { res.status(500).json({ error: 'Failed to compute critical path', detail: (err as Error).message }) }
})

router.post('/:projectId/what-if', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const changes = (req.body as { changes?: WhatIfChange[] }).changes
  if (!Array.isArray(changes) || changes.length === 0) return res.status(400).json({ error: 'changes array is required' })
  if (changes.some(c => !c.taskId || typeof c.deltaDays !== 'number')) {
    return res.status(400).json({ error: 'each change needs a taskId and numeric deltaDays' })
  }
  try {
    const result = await buildWhatIf(r.tenantId!, String(req.params.projectId), changes)
    if (!result) return res.status(404).json({ error: 'Project not found' })
    res.json({ data: result })
  } catch (err) { res.status(500).json({ error: 'Failed to run what-if', detail: (err as Error).message }) }
})

export const scheduleCriticalPathRouter = router
