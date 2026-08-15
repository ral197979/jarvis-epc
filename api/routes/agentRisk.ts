// Denver Engineering — Agent Risk Routes (v5.0.1)
import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest } from '../middleware/tenant'
import { enqueueTask } from '../services/agents/agentTaskQueue'

import { requireCapability } from '../authz/requireCapability'
type R = Request & AuthenticatedRequest & TenantRequest

export const agentRiskRouter = Router()
agentRiskRouter.use(requireAuth as never, requireTenant() as never)

// GET /api/v1/agents/risk/overview — risk summary for a scope
agentRiskRouter.get('/overview', requireCapability('crossdomain.read') as never, async (req: Request, res: Response) => {
  const r = req as R
  const { scopeType, scopeId } = req.query

  // Enqueue a risk analysis task and return the task ID for async polling
  const task = await enqueueTask({
    tenantId: r.tenantId!,
    agentType: 'RiskAgent',
    taskType: 'analyze_risk',
    priority: 4,
    payload: { scopeType: scopeType ?? 'global', scopeId: scopeId ?? '' },
    createdBy: r.auth?.sub ?? 'system',
  })
  res.status(202).json({ taskId: task.id, status: 'queued' })
})

// POST /api/v1/agents/risk/analyze — trigger risk analysis with payload
agentRiskRouter.post('/analyze', async (req: Request, res: Response) => {
  try {
    const r = req as R
    const { scopeType, scopeId, requestedBy } = req.body
    if (!requestedBy) {
      return res.status(400).json({ error: 'requestedBy required' })
    }

    const task = await enqueueTask({
      tenantId: r.tenantId!,
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
    const r = req as R
    const { scopeType, scopeId, requestedBy } = req.body
    if (!requestedBy) {
      return res.status(400).json({ error: 'requestedBy required' })
    }

    const task = await enqueueTask({
      tenantId: r.tenantId!,
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
