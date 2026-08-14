// Denver Engineering — Agent Routes (v5.0.1)
import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest } from '../middleware/tenant'
import { getAllAgents, getAllCapabilities } from '../services/agents/agentRegistry'
import { orchestrate, getAvailableObjectives } from '../services/agents/agentOrchestrator'
import { listExecutions, getExecution, getExecutionEvents, getDecisionTraces } from '../services/agents/agentExecutionLedger'
import { listTasks, getTask } from '../services/agents/agentTaskQueue'
import { requireCapability } from '../authz/requireCapability'

type R = Request & AuthenticatedRequest & TenantRequest
const p = (req: Request, key: string) => {
  const v = (req.params as Record<string, string | string[]>)[key]
  return Array.isArray(v) ? v[0] : (v ?? '')
}

export const agentsRouter = Router()
agentsRouter.use(requireAuth as never, requireTenant() as never)

// GET /api/v1/agents — list registered agents
agentsRouter.get('/', (_req: Request, res: Response) => {
  res.json({ agents: getAllAgents() })
})

// GET /api/v1/agents/capabilities — list all capabilities
agentsRouter.get('/capabilities', (_req: Request, res: Response) => {
  res.json({ capabilities: getAllCapabilities() })
})

// GET /api/v1/agents/objectives — list available objectives
agentsRouter.get('/objectives', (_req: Request, res: Response) => {
  res.json({ objectives: getAvailableObjectives() })
})

// POST /api/v1/agents/plan — dry-run plan without executing
agentsRouter.post('/plan', async (req: Request, res: Response) => {
  try {
    const r = req as R
    const { objective, scope, scopeId, context, requestedBy } = req.body
    if (!objective || !scope || !scopeId || !requestedBy) {
      return res.status(400).json({ error: 'objective, scope, scopeId, requestedBy required' })
    }

    const result = await orchestrate({
      tenantId: r.tenantId!, objective, scope, scopeId,
      context: context ?? {},
      requestedBy,
      options: { dryRun: true },
    })
    res.json(result)
  } catch (err: unknown) {
    res.status(400).json({ error: (err as Error).message })
  }
})

// POST /api/v1/agents/execute — execute an objective
agentsRouter.post('/execute', requireCapability('ai.govern') as never, async (req: Request, res: Response) => {
  try {
    const r = req as R
    const { objective, scope, scopeId, context, requestedBy } = req.body
    if (!objective || !scope || !scopeId || !requestedBy) {
      return res.status(400).json({ error: 'objective, scope, scopeId, requestedBy required' })
    }

    const result = await orchestrate({
      tenantId: r.tenantId!, objective, scope, scopeId,
      context: context ?? {},
      requestedBy,
    })
    res.status(202).json(result)
  } catch (err: unknown) {
    res.status(400).json({ error: (err as Error).message })
  }
})

// GET /api/v1/agents/tasks — list tasks
agentsRouter.get('/tasks', async (req: Request, res: Response) => {
  const r = req as R
  const { status, agentType, limit, offset } = req.query

  const tasks = await listTasks(r.tenantId!, {
    status: status as string | undefined,
    agentType: agentType as string | undefined,
    limit: limit ? parseInt(limit as string, 10) : undefined,
    offset: offset ? parseInt(offset as string, 10) : undefined,
  } as Record<string, unknown>)
  res.json({ tasks })
})

// GET /api/v1/agents/tasks/:id — get task
agentsRouter.get('/tasks/:id', async (req: Request, res: Response) => {
  const r = req as R
  const task = await getTask(p(req, 'id'), r.tenantId!)
  if (!task) return res.status(404).json({ error: 'Task not found' })
  res.json(task)
})

// GET /api/v1/agents/executions — list executions
agentsRouter.get('/executions', async (req: Request, res: Response) => {
  const r = req as R
  const { agentType, limit, offset } = req.query

  const executions = await listExecutions(r.tenantId!, {
    agentType: agentType as string | undefined,
    limit: limit ? parseInt(limit as string, 10) : undefined,
    offset: offset ? parseInt(offset as string, 10) : undefined,
  } as Record<string, unknown>)
  res.json({ executions })
})

// GET /api/v1/agents/executions/:id — get execution detail
agentsRouter.get('/executions/:id', async (req: Request, res: Response) => {
  const r = req as R
  const execId = p(req, 'id')
  const [execution, events, traces] = await Promise.all([
    getExecution(execId, r.tenantId!),
    getExecutionEvents(execId, r.tenantId!),
    getDecisionTraces(execId, r.tenantId!),
  ])
  if (!execution) return res.status(404).json({ error: 'Execution not found' })
  res.json({ execution, events, traces })
})
