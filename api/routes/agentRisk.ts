// Denver Engineering — Agent Risk Routes (v5.0.0)
import { Router, Request, Response } from 'express'
import { enqueueTask } from '../services/agents/agentTaskQueue'

export const agentRiskRouter = Router()

// GET /api/v1/agents/risk/overview — risk summary for a scope
agentRiskRouter.get('/overview', async (req: Request, res: Response) => {
  const { tenantId, scopeType, scopeId } = req.query
  if (!tenantId) return res.status(400).json({ error: 'tenantId required' })

  // Enqueue a risk analysis task and return the task ID for async polling
  const task = await enqueueTask({
    tenantId: tenantId as string,
    agentType: 'RiskAgent',
    taskType: 'analyze_risk',
    priority: 4,
    payload: { scopeType: scopeType ?? 'global', scopeId: scopeId ?? '' },
    createdBy: 'system',
  })
  res.status(202).json({ taskId: task.id, status: 'queued' })
})

// POST /api/v1/agents/risk/analyze — trigger risk analysis with payload
agentRiskRouter.post('/analyze', async (req: Request, res: Response) => {
  try {
    const { tenantId, scopeType, scopeId, requestedBy } = req.body
    if (!tenantId || !requestedBy) {
      return res.status(400).json({ error: 'tenantId, requestedBy required' })
    }

    const task = await enqueueTask({
      tenantId,
      agentType: 'RiskAgent',
      taskType: 'analyze_risk',
      priority: 3,
      payload: { scopeType: scopeType ?? 'global', scopeId: scopeId ?? '' },
      createdBy: requestedBy,
    })
    res.status(202).json({ taskId: task.id, status: 'queued' })
  } catch (err: unknown) {
    res.status(400).json({ error: (err as Error).message })
  }
})

// POST /api/v1/agents/risk/mitigate — recommend mitigations
agentRiskRouter.post('/mitigate', async (req: Request, res: Response) => {
  try {
    const { tenantId, scopeType, scopeId, requestedBy } = req.body
    if (!tenantId || !requestedBy) {
      return res.status(400).json({ error: 'tenantId, requestedBy required' })
    }

    const task = await enqueueTask({
      tenantId,
      agentType: 'RiskAgent',
      taskType: 'recommend_mitigation',
      priority: 3,
      payload: { scopeType: scopeType ?? 'global', scopeId: scopeId ?? '' },
      createdBy: requestedBy,
    })
    res.status(202).json({ taskId: task.id, status: 'queued' })
  } catch (err: unknown) {
    res.status(400).json({ error: (err as Error).message })
  }
})
