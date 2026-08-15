// Denver Engineering — Agent Readiness Routes (v5.0.0)
import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest }       from '../middleware/tenant'
import { enqueueTask } from '../services/agents/agentTaskQueue'
import { orchestrate } from '../services/agents/agentOrchestrator'

import { requireCapability } from '../authz/requireCapability'
type R = Request & AuthenticatedRequest & TenantRequest

export const agentReadinessRouter = Router()
agentReadinessRouter.use(requireAuth     as never)
agentReadinessRouter.use(requireTenant() as never)

// GET /api/v1/agents/readiness/plan/:scope/:id
agentReadinessRouter.get('/plan/:scope/:id', requireCapability('crossdomain.read') as never, async (req: Request, res: Response) => {
  const r = req as R
  const task = await enqueueTask({
    tenantId:   r.tenantId!,
    agentType:  'ReadinessCoordinatorAgent',
    taskType:   'generate_readiness_plan',
    priority:   4,
    payload:    { scopeType: req.params.scope, scopeId: req.params.id },
    createdBy:  r.auth?.sub ?? 'system',
  })
  res.status(202).json({ taskId: task.id, status: 'queued' })
})

// POST /api/v1/agents/readiness/coordinate
agentReadinessRouter.post('/coordinate', async (req: Request, res: Response) => {
  const r = req as R
  try {
    const { scopeType, scopeId } = req.body as Record<string, string>
    if (!scopeType || !scopeId) {
      return res.status(400).json({ error: 'scopeType, scopeId required' })
    }
    const result = await orchestrate({
      tenantId:    r.tenantId!,
      objective:   'assess_readiness',
      scope:       scopeType,
      scopeId,
      context:     {},
      requestedBy: r.auth?.sub ?? 'system',
    })
    res.status(202).json(result)
  } catch (err: unknown) {
    res.status(400).json({ error: (err as Error).message })
  }
})

// POST /api/v1/agents/readiness/assess
agentReadinessRouter.post('/assess', async (req: Request, res: Response) => {
  const r = req as R
  try {
    const { scopeType, scopeId } = req.body as Record<string, string | undefined>
    const task = await enqueueTask({
      tenantId:   r.tenantId!,
      agentType:  'ReadinessCoordinatorAgent',
      taskType:   'assess_readiness',
      priority:   4,
      payload:    { scopeType: scopeType ?? 'global', scopeId: scopeId ?? '' },
      createdBy:  r.auth?.sub ?? 'system',
    })
    res.status(202).json({ taskId: task.id, status: 'queued' })
  } catch (err: unknown) {
    res.status(400).json({ error: (err as Error).message })
  }
})
