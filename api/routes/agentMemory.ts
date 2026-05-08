// Denver Engineering — Agent Memory Routes (v5.0.0)
import { Router, Request, Response } from 'express'
import {
  storeMemory,
  recallMemory,
  queryMemory,
  forgetMemory,
  getLinkedMemories,
  purgeExpiredMemory,
} from '../services/agents/agentMemoryService'

export const agentMemoryRouter = Router()

// GET /api/v1/agents/memory — query memory
agentMemoryRouter.get('/', async (req: Request, res: Response) => {
  const { tenantId, agentType, scopeType, scopeId, memoryType, minConfidence, limit } = req.query
  if (!tenantId) return res.status(400).json({ error: 'tenantId required' })

  const entries = await queryMemory(tenantId as string, {
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
    const entry = await storeMemory(req.body)
    res.status(201).json(entry)
  } catch (err: unknown) {
    res.status(400).json({ error: (err as Error).message })
  }
})

// GET /api/v1/agents/memory/:agentType/:scope/:scopeId/:key — recall specific entry
agentMemoryRouter.get('/:agentType/:scopeType/:scopeId/:key', async (req: Request, res: Response) => {
  const { tenantId } = req.query
  if (!tenantId) return res.status(400).json({ error: 'tenantId required' })

  const entry = await recallMemory(
    tenantId as string,
    req.params.agentType as string,
    req.params.scopeType as string,
    req.params.scopeId,
    req.params.key
  )
  if (!entry) return res.status(404).json({ error: 'Memory entry not found' })
  res.json(entry)
})

// DELETE /api/v1/agents/memory/:agentType/:scope/:scopeId/:key — forget
agentMemoryRouter.delete('/:agentType/:scopeType/:scopeId/:key', async (req: Request, res: Response) => {
  const { tenantId } = req.query
  if (!tenantId) return res.status(400).json({ error: 'tenantId required' })

  const deleted = await forgetMemory(
    tenantId as string,
    req.params.agentType as string,
    req.params.scopeType as string,
    req.params.scopeId,
    req.params.key
  )
  res.json({ deleted })
})

// GET /api/v1/agents/memory/:entryId/links — get linked memories
agentMemoryRouter.get('/:entryId/links', async (req: Request, res: Response) => {
  const { tenantId, linkType } = req.query
  if (!tenantId) return res.status(400).json({ error: 'tenantId required' })

  const entries = await getLinkedMemories(
    tenantId as string,
    req.params.entryId,
    linkType as string | undefined
  )
  res.json({ entries })
})

// POST /api/v1/agents/memory/purge — purge expired entries
agentMemoryRouter.post('/purge', async (req: Request, res: Response) => {
  const { tenantId } = req.body
  if (!tenantId) return res.status(400).json({ error: 'tenantId required' })

  const purged = await purgeExpiredMemory(tenantId)
  res.json({ purged })
})
