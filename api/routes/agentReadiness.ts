// Denver Engineering — Agent Readiness Routes (v5.0.0)
import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest }       from '../middleware/tenant'
import { enqueueTask, latestTaskForScope } from '../services/agents/agentTaskQueue'
import { orchestrate } from '../services/agents/agentOrchestrator'

import { requireCapability } from '../authz/requireCapability'
type R = Request & AuthenticatedRequest & TenantRequest

export const agentReadinessRouter = Router()
agentReadinessRouter.use(requireAuth     as never)
agentReadinessRouter.use(requireTenant() as never)

// GET /api/v1/agents/readiness/plan/:scope/:id — latest readiness plan for a scope
//
// ADR-014 Phase 2C-5 §19/§20 (Option A, genuinely read-only). Until Phase 2C-5
// this GET called `enqueueTask`, so `crossdomain.read` was sufficient to inject a
// `generate_readiness_plan` task. It now OBSERVES the newest such task and
// creates nothing.
//
// No mutation route is added here, deliberately. `generate_readiness_plan` is a
// step the orchestrator schedules as part of the `assess_readiness` plan
// (agentOrchestrator.ts), reachable through POST /agents/readiness/coordinate
// under `ai.govern`. Adding a second way to create the same job would be exactly
// the duplication §20 warns against, and this GET had no client caller to
// preserve — the only reference in the repository was the route itself.
agentReadinessRouter.get('/plan/:scope/:id', requireCapability('crossdomain.read') as never, async (req: Request, res: Response) => {
  const r = req as R
  const scopeType = String(req.params['scope'] ?? '')
  const scopeId   = String(req.params['id']    ?? '')

  const task = await latestTaskForScope(r.tenantId!, 'generate_readiness_plan', scopeType, scopeId)
  if (!task) {
    res.json({ task: null, scopeType, scopeId })
    return
  }
  res.json({
    task: { taskId: task.id, status: task.status, result: task.result ?? null, createdAt: task.createdAt },
    scopeType,
    scopeId,
  })
})

// POST /api/v1/agents/readiness/coordinate
agentReadinessRouter.post('/coordinate', requireCapability('ai.govern') as never, async (req: Request, res: Response) => {
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
agentReadinessRouter.post('/assess', requireCapability('crossdomain.write') as never, async (req: Request, res: Response) => {
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
