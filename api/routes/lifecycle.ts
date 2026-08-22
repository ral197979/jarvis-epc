/**
 * Denver Engineering — Project Lifecycle + Gates API (v4.34.0)
 * ─────────────────────────────────────────────────────────────────────────────
 *   GET  /api/v1/projects/:projectId/lifecycle
 *   POST /api/v1/projects/:projectId/gates/:gateKey   { action: approve|waive|reset, expectedDate? }
 *   POST /api/v1/projects/:projectId/advance
 *
 * See WORKFLOW_REDESIGN.md §4 + §8.
 */
import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest } from '../middleware/tenant'
import { getProjectLifecycle, setGate, advancePhase } from '../services/lifecycle/lifecycleService'

import { requireCapability } from '../authz/requireCapability'
import { requireProjectScope } from '../authz/recordScope'
type AuthTenantReq = Request & AuthenticatedRequest & TenantRequest
const router = Router()
router.use(requireAuth as never)
router.use(requireTenant() as never)

const ACTIONS = new Set(['approve', 'waive', 'reset'])

router.get('/projects/:projectId/lifecycle', requireCapability('project.view') as never, requireProjectScope() as never, async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  try {
    const lc = await getProjectLifecycle(r.tenantId!, String(req.params.projectId), new Date())
    if (!lc) return res.status(404).json({ error: 'Project not found' })
    res.json({ data: lc })
  } catch (err) { res.status(500).json({ error: 'Failed to build lifecycle', detail: (err as Error).message }) }
})

router.post('/projects/:projectId/gates/:gateKey', requireCapability('project.approve') as never, requireProjectScope() as never, async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const action = String((req.body as { action?: string }).action ?? '')
  if (!ACTIONS.has(action)) return res.status(400).json({ error: `action must be one of ${[...ACTIONS].join(', ')}` })
  const expectedDate = (req.body as { expectedDate?: string }).expectedDate ?? null
  try {
    const lc = await setGate(r.tenantId!, String(req.params.projectId), String(req.params.gateKey),
      action as 'approve' | 'waive' | 'reset', r.auth?.sub ?? null, expectedDate)
    if (!lc) return res.status(404).json({ error: 'Project not found' })
    res.json({ data: lc })
  } catch (err) {
    const msg = (err as Error).message
    if (msg === 'invalid gate key') return res.status(400).json({ error: msg })
    res.status(500).json({ error: 'Failed to update gate', detail: msg })
  }
})

router.post('/projects/:projectId/advance', requireCapability('project.approve') as never, requireProjectScope() as never, async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  try {
    const result = await advancePhase(r.tenantId!, String(req.params.projectId))
    if (!result.lifecycle && result.reason === 'Project not found') return res.status(404).json({ error: result.reason })
    if (!result.ok) return res.status(409).json({ error: result.reason, data: result.lifecycle })
    res.json({ data: result.lifecycle })
  } catch (err) { res.status(500).json({ error: 'Failed to advance phase', detail: (err as Error).message }) }
})

export const lifecycleRouter = router
