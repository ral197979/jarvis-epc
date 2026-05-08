// Denver Engineering — Agent Readiness Routes (v5.0.0)
import { Router, Request, Response } from 'express'
import { enqueueTask } from '../services/agents/agentTaskQueue'
import { orchestrate } from '../services/agents/agentOrchestrator'

export const agentReadinessRouter = Router()

// GET /api/v1/agents/readiness/plan/:scope/:id — get readiness plan for a scope
agentReadinessRouter.get('/plan/:scope/:id', async (req: Request, res: Response) => {
  const { tenantId, requestedBy } = req.query
  if (!tenantId || !requestedBy) {
    return res.status(400).json({ error: 'tenantId, requestedBy required' })
  }

  const task = await enqueueTask({
    tenantId: tenantId as string,
    agentType: 'ReadinessCoordinatorAgent',
    taskType: 'generate_readiness_plan',
    priority: 4,
    payload: { scopeType: req.params.scope, scopeId: req.params.id },
    createdBy: requestedBy as string,
  })
  res.status(202).json({ taskId: task.id, status: 'queued' })
})

// POST /api/v1/agents/readiness/coordinate — coordinate readiness improvement
agentReadinessRouter.post('/coordinate', async (req: Request, res: Response) => {
  try {
    const { tenantId, scopeType, scopeId, requestedBy } = req.body
    if (!tenantId || !scopeType || !scopeId || !requestedBy) {
      return res.status(400).json({ error: 'tenantId, scopeType, scopeId, requestedBy required' })
    }

    const result = await orchestrate({
      tenantId,
      objective: 'assess_readiness',
      scope: scopeType,
      scopeId,
      context: {},
      requestedBy,
    })
    res.status(202).json(result)
  } catch (err: unknown) {
    res.status(400).json({ error: (err as Error).message })
  }
})

// POST /api/v1/agents/readiness/assess — assess current readiness
agentReadinessRouter.post('/assess', async (req: Request, res: Response) => {
  try {
    const { tenantId, scopeType, scopeId, requestedBy } = req.body
    if (!tenantId || !requestedBy) {
      return res.status(400).json({ error: 'tenantId, requestedBy required' })
    }

    const task = await enqueueTask({
      tenantId,
      agentType: 'ReadinessCoordinatorAgent',
      taskType: 'assess_readiness',
      priority: 4,
      payload: { scopeType: scopeType ?? 'global', scopeId: scopeId ?? '' },
      createdBy: requestedBy,
    })
    res.status(202).json({ taskId: task.id, status: 'queued' })
  } catch (err: unknown) {
    res.status(400).json({ error: (err as Error).message })
  }
})
