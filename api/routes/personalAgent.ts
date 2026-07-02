/**
 * Denver Engineering — Personal Agent API (ADR-012, Phase 1)
 * ─────────────────────────────────────────────────────────────────────────────
 *   GET    /api/v1/me/agent/briefing       — My Work + personal memory
 *   GET    /api/v1/me/agent/memory         — list personal memory
 *   POST   /api/v1/me/agent/memory         — remember { key, value, memoryType?, confidence? }
 *   DELETE /api/v1/me/agent/memory/:key    — forget one key
 *   POST   /api/v1/me/agent/ask            — knowledge Q&A { question, projectId? }
 *
 * userId + tenantId come from the auth token (req.auth.sub / req.tenantId),
 * NEVER from the body. Dormant (404) until PERSONAL_AGENT=true.
 */
import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest } from '../middleware/tenant'
import {
  isPersonalAgentEnabled, rememberForUser, listUserMemory, forgetUserMemory,
  getPersonalBriefing, askPersonalAgent,
} from '../services/agents/personalAgentService'

type Req = Request & AuthenticatedRequest & TenantRequest
const router = Router()

// Flag gate — the whole surface is 404 until the feature is enabled.
router.use((_req: Request, res: Response, next) => {
  if (!isPersonalAgentEnabled()) { res.status(404).json({ error: 'not_found' }); return }
  next()
})
router.use(requireAuth as never)
router.use(requireTenant() as never)

function ids(req: Request): { tenantId: string; userId: string } {
  const r = req as Req
  return { tenantId: r.tenantId!, userId: r.auth!.sub }
}

router.get('/me/agent/briefing', async (req: Request, res: Response) => {
  const { tenantId, userId } = ids(req)
  try {
    res.json({ data: await getPersonalBriefing(tenantId, userId) })
  } catch (err) {
    res.status(500).json({ error: 'briefing_failed', detail: (err as Error).message })
  }
})

router.get('/me/agent/memory', async (req: Request, res: Response) => {
  const { tenantId, userId } = ids(req)
  try {
    res.json({ data: await listUserMemory(tenantId, userId) })
  } catch (err) {
    res.status(500).json({ error: 'memory_list_failed', detail: (err as Error).message })
  }
})

router.post('/me/agent/memory', async (req: Request, res: Response) => {
  const { tenantId, userId } = ids(req)
  const { key, value, memoryType, confidence } = req.body ?? {}
  if (typeof key !== 'string' || key.trim() === '') {
    return res.status(400).json({ error: 'key_required' })
  }
  // Accept any JSON value; jsonb column needs an object, so wrap primitives.
  const valueObj: Record<string, unknown> =
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : { value }
  try {
    const saved = await rememberForUser({ tenantId, userId, key: key.trim(), value: valueObj, memoryType, confidence })
    res.status(201).json({ data: saved })
  } catch (err) {
    res.status(500).json({ error: 'remember_failed', detail: (err as Error).message })
  }
})

router.delete('/me/agent/memory/:key', async (req: Request, res: Response) => {
  const { tenantId, userId } = ids(req)
  try {
    const removed = await forgetUserMemory(tenantId, userId, String(req.params.key))
    if (!removed) return res.status(404).json({ error: 'not_found' })
    res.json({ data: { forgotten: true } })
  } catch (err) {
    res.status(500).json({ error: 'forget_failed', detail: (err as Error).message })
  }
})

router.post('/me/agent/ask', async (req: Request, res: Response) => {
  const { tenantId, userId } = ids(req)
  const { question, projectId } = req.body ?? {}
  if (typeof question !== 'string' || question.trim() === '') {
    return res.status(400).json({ error: 'question_required' })
  }
  try {
    const result = await askPersonalAgent({ tenantId, userId, question: question.trim(), projectId: projectId ?? null })
    res.json({ data: result })
  } catch (err) {
    res.status(500).json({ error: 'ask_failed', detail: (err as Error).message })
  }
})

export const personalAgentRouter = router
