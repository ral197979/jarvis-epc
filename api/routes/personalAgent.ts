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
import { AiBudgetExceededError } from '../services/enterprise/aiCostTracker'
import { requireCapability, requireAllCapabilities } from '../authz/requireCapability'
import { personalPrincipal } from '../authz/personalScope'

type Req = Request & AuthenticatedRequest & TenantRequest
const router = Router()

// AUDIT-P0 (discovered during remediation, not in the original 2026-07-02
// report): this router is mounted at bare `/api/v1` (app.use('/api/v1',
// personalAgentRouter) in server.ts), and this flag-gate was previously
// registered with router.use((req,res,next) => ...) — no path prefix — so it
// ran for EVERY request under /api/v1/*, not just this router's own
// /me/agent/* routes. Since PERSONAL_AGENT defaults to false/unset (see
// .env.example), this made the entire API 404 for every endpoint mounted
// after this router in server.ts (projects, my-work, vendors, RFIs, ...) in
// any environment that didn't explicitly opt in — reproduced locally and
// confirmed to be the actual mechanism behind every non-health endpoint
// returning a bare {"error":"not_found"}. Scoping the gate to '/me/agent'
// (matching this router's own route paths below) fixes it without touching
// the flag's intended default-off behavior for its own surface.
router.use('/me/agent', (_req: Request, res: Response, next) => {
  if (!isPersonalAgentEnabled()) { res.status(404).json({ error: 'not_found' }); return }
  next()
})
router.use('/me/agent', requireAuth as never)
router.use('/me/agent', requireTenant() as never)

/**
 * ADR-014 Phase 2C-4A §9: the user id that scopes personal state comes from the
 * live database principal, not the token subject. Resolving it here means a
 * deleted or deactivated account, or a token whose tenant claim contradicts the
 * stored row, cannot reach this user's memory at all.
 *
 * Returns `null` after writing the refusal, so a handler reads:
 *   const ids = await personalIds(req, res); if (!ids) return
 */
async function personalIds(
  req: Request, res: Response,
): Promise<{ tenantId: string; userId: string } | null> {
  const r = req as Req
  const principal = await personalPrincipal(req)
  if (!principal) { res.status(401).json({ error: 'unauthenticated' }); return null }
  return { tenantId: r.tenantId!, userId: principal.id }
}

router.get('/me/agent/briefing', requireCapability('personal.view') as never, async (req: Request, res: Response) => {
  const idsOrNull = await personalIds(req, res); if (!idsOrNull) return
  const { tenantId, userId } = idsOrNull
  try {
    res.json({ data: await getPersonalBriefing(tenantId, userId) })
  } catch (err) {
    res.status(500).json({ error: 'briefing_failed', detail: (err as Error).message })
  }
})

router.get('/me/agent/memory', requireCapability('personal.view') as never, async (req: Request, res: Response) => {
  const idsOrNull = await personalIds(req, res); if (!idsOrNull) return
  const { tenantId, userId } = idsOrNull
  try {
    res.json({ data: await listUserMemory(tenantId, userId) })
  } catch (err) {
    res.status(500).json({ error: 'memory_list_failed', detail: (err as Error).message })
  }
})

router.post('/me/agent/memory', requireCapability('personal.write') as never, async (req: Request, res: Response) => {
  const idsOrNull = await personalIds(req, res); if (!idsOrNull) return
  const { tenantId, userId } = idsOrNull
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

router.delete('/me/agent/memory/:key', requireCapability('personal.write') as never, async (req: Request, res: Response) => {
  const idsOrNull = await personalIds(req, res); if (!idsOrNull) return
  const { tenantId, userId } = idsOrNull
  try {
    const removed = await forgetUserMemory(tenantId, userId, String(req.params.key))
    if (!removed) return res.status(404).json({ error: 'not_found' })
    res.json({ data: { forgotten: true } })
  } catch (err) {
    res.status(500).json({ error: 'forget_failed', detail: (err as Error).message })
  }
})

// ADR-014 Phase 2C-4A §28. This calls the same askJarvis() engine as
// /api/v1/ask, which is gated router-wide by `assistant.use`, and it persists a
// chat session plus messages and consumes AI budget. Guarded by personal.write
// alone it would be a cheaper path to Jarvis for a principal the assistant gate
// refuses, so both authorities are required: the right to use the assistant, and
// the right to write this user's personal state.
router.post('/me/agent/ask',
  requireAllCapabilities('personal.write', 'assistant.use') as never,
  async (req: Request, res: Response) => {
  const idsOrNull = await personalIds(req, res); if (!idsOrNull) return
  const { tenantId, userId } = idsOrNull
  const { question, projectId } = req.body ?? {}
  if (typeof question !== 'string' || question.trim() === '') {
    return res.status(400).json({ error: 'question_required' })
  }
  try {
    const result = await askPersonalAgent({ tenantId, userId, question: question.trim(), projectId: projectId ?? null })
    res.json({ data: result })
  } catch (err) {
    if (err instanceof AiBudgetExceededError) {
      return res.status(402).json({ error: 'ai_budget_exceeded', budget: err.status })
    }
    res.status(500).json({ error: 'ask_failed', detail: (err as Error).message })
  }
})

export const personalAgentRouter = router
