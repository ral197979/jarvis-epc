// Denver Engineering — Agent Risk Routes (v5.0.1)
import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest } from '../middleware/tenant'
import { enqueueTask, latestTaskForScope } from '../services/agents/agentTaskQueue'

import { requireCapability } from '../authz/requireCapability'
type R = Request & AuthenticatedRequest & TenantRequest

export const agentRiskRouter = Router()
agentRiskRouter.use(requireAuth as never, requireTenant() as never)

// GET /api/v1/agents/risk/overview — latest risk analysis for a scope
//
// ADR-014 Phase 2C-5 §19/§20 (Option B, existing mutation). Until Phase 2C-5
// this GET called `enqueueTask`, so `crossdomain.read` was sufficient to create
// durable agent work — a read capability performing a write. It now OBSERVES the
// newest `analyze_risk` task for the scope and creates nothing.
//
// The creation path is unchanged and already existed: POST /agents/risk/analyze,
// guarded by `crossdomain.write`. No second way to create the same job was added.
agentRiskRouter.get('/overview', requireCapability('crossdomain.read') as never, async (req: Request, res: Response) => {
  const r = req as R
  const scopeType = String(req.query['scopeType'] ?? 'global')
  const scopeId   = String(req.query['scopeId']   ?? '')

  const task = await latestTaskForScope(r.tenantId!, 'analyze_risk', scopeType, scopeId)
  if (!task) {
    // Honest empty state: nothing has been analysed for this scope yet. The
    // caller triggers analysis through the mutation route, which needs
    // crossdomain.write — deliberately more authority than reading.
    res.json({ task: null, scopeType, scopeId })
    return
  }
  res.json({
    task: { taskId: task.id, status: task.status, result: task.result ?? null, createdAt: task.createdAt },
    scopeType,
    scopeId,
  })
})

// POST /api/v1/agents/risk/analyze — trigger risk analysis with payload
agentRiskRouter.post('/analyze', requireCapability('crossdomain.write') as never, async (req: Request, res: Response) => {
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
agentRiskRouter.post('/mitigate', requireCapability('crossdomain.write') as never, async (req: Request, res: Response) => {
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
