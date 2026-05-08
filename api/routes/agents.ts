// Denver Engineering — Agent Routes (v5.0.0)
import { Router, Request, Response } from 'express'
import { getAllAgents, getAllCapabilities } from '../services/agents/agentRegistry'
import { orchestrate, getAvailableObjectives } from '../services/agents/agentOrchestrator'
import { listExecutions, getExecution, getExecutionEvents, getDecisionTraces } from '../services/agents/agentExecutionLedger'
import { listTasks, getTask } from '../services/agents/agentTaskQueue'

export const agentsRouter = Router()

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
    const { tenantId, objective, scope, scopeId, context, requestedBy } = req.body
    if (!tenantId || !objective || !scope || !scopeId || !requestedBy) {
      return res.status(400).json({ error: 'tenantId, objective, scope, scopeId, requestedBy required' })
    }

    const result = await orchestrate({
      tenantId, objective, scope, scopeId,
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
agentsRouter.post('/execute', async (req: Request, res: Response) => {
  try {
    const { tenantId, objective, scope, scopeId, context, requestedBy } = req.body
    if (!tenantId || !objective || !scope || !scopeId || !requestedBy) {
      return res.status(400).json({ error: 'tenantId, objective, scope, scopeId, requestedBy required' })
    }

    const result = await orchestrate({
      tenantId, objective, scope, scopeId,
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
  const { tenantId, status, agentType, limit, offset } = req.query
  if (!tenantId) return res.status(400).json({ error: 'tenantId required' })

  const tasks = await listTasks(tenantId as string, {
    status: status as string | undefined,
    agentType: agentType as string | undefined,
    limit: limit ? parseInt(limit as string, 10) : undefined,
    offset: offset ? parseInt(offset as string, 10) : undefined,
  } as Record<string, unknown>)
  res.json({ tasks })
})

// GET /api/v1/agents/tasks/:id — get task
agentsRouter.get('/tasks/:id', async (req: Request, res: Response) => {
  const { tenantId } = req.query
  if (!tenantId) return res.status(400).json({ error: 'tenantId required' })

  const task = await getTask(req.params.id, tenantId as string)
  if (!task) return res.status(404).json({ error: 'Task not found' })
  res.json(task)
})

// GET /api/v1/agents/executions — list executions
agentsRouter.get('/executions', async (req: Request, res: Response) => {
  const { tenantId, agentType, limit, offset } = req.query
  if (!tenantId) return res.status(400).json({ error: 'tenantId required' })

  const executions = await listExecutions(tenantId as string, {
    agentType: agentType as string | undefined,
    limit: limit ? parseInt(limit as string, 10) : undefined,
    offset: offset ? parseInt(offset as string, 10) : undefined,
  } as Record<string, unknown>)
  res.json({ executions })
})

// GET /api/v1/agents/executions/:id — get execution detail
agentsRouter.get('/executions/:id', async (req: Request, res: Response) => {
  const { tenantId } = req.query
  if (!tenantId) return res.status(400).json({ error: 'tenantId required' })

  const [execution, events, traces] = await Promise.all([
    getExecution(req.params.id, tenantId as string),
    getExecutionEvents(req.params.id, tenantId as string),
    getDecisionTraces(req.params.id, tenantId as string),
  ])
  if (!execution) return res.status(404).json({ error: 'Execution not found' })
  res.json({ execution, events, traces })
})
