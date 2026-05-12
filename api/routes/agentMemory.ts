// Denver Engineering — Agent Memory Routes (v5.0.1)
import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest } from '../middleware/tenant'
import { type AgentType, type MemoryScopeType, type LinkType } from '../services/agents/agentTypes'
import {
  storeMemory,
  recallMemory,
  queryMemory,
  forgetMemory,
  getLinkedMemories,
  purgeExpiredMemory,
} from '../services/agents/agentMemoryService'

type R = Request & AuthenticatedRequest & TenantRequest
const p = (req: Request, key: string) => {
  const v = (req.params as Record<string, string | string[]>)[key]
  return Array.isArray(v) ? v[0] : (v ?? '')
}

export const agentMemoryRouter = Router()
agentMemoryRouter.use(requireAuth as never, requireTenant() as never)

// GET /api/v1/agents/memory — query memory
agentMemoryRouter.get('/', async (req: Request, res: Response) => {
  const r = req as R
  const { agentType, scopeType, scopeId, memoryType, minConfidence, limit } = req.query

  const entries = await queryMemory(r.tenantId!, {
    agentType: agentType as string | undefined,
    scopeType: scopeType as string | undefined,
    scopeId: scopeId as string | undefined,
    memoryType: memoryType as string | undefined,
    minConfidence: minConfidence ? parseFloat(minConfidence as string) : undefined,
    limit: limit ? parseInt(limit as string, 10) : undefined,
  } as Record<string, unknown>)
  res.json({ entries })
})

// POST /api/v1/agents/memory — store memory
agentMemoryRouter.post('/', async (req: Request, res: Response) => {
  try {
    const r = req as R
    // Inject tenantId from auth — overrides any client-supplied value
    const entry = await storeMemory({ ...req.body, tenantId: r.tenantId! })
    res.status(201).json(entry)
  } catch (err: unknown) {
    res.status(400).json({ error: (err as Error).message })
  }
})

// GET /api/v1/agents/memory/:agentType/:scope/:scopeId/:key — recall specific entry
agentMemoryRouter.get('/:agentType/:scopeType/:scopeId/:key', async (req: Request, res: Response) => {
  const r = req as R
  const entry = await recallMemory(
    r.tenantId!,
    p(req, 'agentType') as AgentType,
    p(req, 'scopeType') as MemoryScopeType,
    p(req, 'scopeId'),
    p(req, 'key')
  )
  if (!entry) return res.status(404).json({ error: 'Memory entry not found' })
  res.json(entry)
})

// DELETE /api/v1/agents/memory/:agentType/:scope/:scopeId/:key — forget
agentMemoryRouter.delete('/:agentType/:scopeType/:scopeId/:key', async (req: Request, res: Response) => {
  const r = req as R
  const deleted = await forgetMemory(
    r.tenantId!,
    p(req, 'agentType') as AgentType,
    p(req, 'scopeType') as MemoryScopeType,
    p(req, 'scopeId'),
    p(req, 'key')
  )
  res.json({ deleted })
})

// GET /api/v1/agents/memory/:entryId/links — get linked memories
agentMemoryRouter.get('/:entryId/links', async (req: Request, res: Response) => {
  const r = req as R
  const { linkType } = req.query
  const entries = await getLinkedMemories(
    r.tenantId!,
    p(req, 'entryId'),
    linkType as LinkType | undefined
  )
  res.json({ entries })
})

// POST /api/v1/agents/memory/purge — purge expired entries
agentMemoryRouter.post('/purge', async (req: Request, res: Response) => {
  const r = req as R
  const purged = await purgeExpiredMemory(r.tenantId!)
  res.json({ purged })
})
