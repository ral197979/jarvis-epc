/**
 * Denver Engineering — Ask Jarvis Routes (v4.31.0)
 *
 *   POST /api/v1/ask                         — submit a question, get a
 *                                               structured grounded answer
 *   GET  /api/v1/ask/sessions                — list the caller's sessions
 *   GET  /api/v1/ask/sessions/:id            — session + full message thread
 *   POST /api/v1/ask/sessions/:id/resolve    — flag session as resolved
 *   DELETE /api/v1/ask/sessions/:id          — admin delete
 *   GET  /api/v1/ask/chunks/:id              — single chunk for citation
 *                                               hover preview / modal
 *
 * /ask itself accepts { question, session_id?, project_id?, asset_system?,
 * top_k?, chunk_char_limit? }. Returns the full AskResult (see askBuilder.ts).
 */

import { Router, Response } from 'express'
import { tenantQuery } from '../db/pool'
import { requireAuth, AuthenticatedRequest } from '../auth'
import { requireTenant, TenantRequest } from '../middleware/tenant'
import { requireCapability } from '../authz/requireCapability'
import { askJarvis } from '../services/askBuilder'
import { AiBudgetExceededError } from '../services/enterprise/aiCostTracker'

type Req = AuthenticatedRequest & TenantRequest

const router = Router()
router.use(requireAuth as never)
router.use(requireTenant() as never)
// ADR-014 Phase 2 §20: the UI hides Ask Jarvis from roles without
// `assistant.use`, but the endpoint itself accepted any authenticated tenant
// user, so the route denial was bypassable by calling the API directly. Every
// operation on this router now requires the same capability the sidebar reads.
// NOTE: this authorizes *use of the endpoint*. It does not filter which
// documents the retriever may return — that is Phase 3.
router.use(requireCapability('assistant.use') as never)

// ─── Prompt injection guard ───────────────────────────────────────────────────

const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?previous\s+instructions?/i,
  /disregard\s+(your\s+)?system\s+prompt/i,
  /you\s+are\s+now\s+a/i,
  /forget\s+(everything|all)\s+(above|before|prior)/i,
  /act\s+as\s+(if\s+you\s+(are|were)\s+)?(?:an?\s+)?(?:evil|unrestricted|jailbroken|unfiltered)/i,
  /\bdan\b.*\bmode\b/i,   // "DAN mode" variants
]

function _detectInjection(question: string): boolean {
  return INJECTION_PATTERNS.some(p => p.test(question))
}

// ─── POST /ask ────────────────────────────────────────────────────────────────

router.post('/', async (req: Req, res: Response) => {
  const { tenantId } = req
  const userId = req.auth?.sub
  if (!tenantId || !userId) {
    res.status(400).json({ error: 'tenant_and_user_required' })
    return
  }
  const b = req.body as Record<string, unknown>
  const question = String(b['question'] ?? '').trim()
  if (!question) {
    res.status(422).json({ error: 'validation', message: 'question required' })
    return
  }
  if (question.length > 4000) {
    res.status(422).json({ error: 'validation', message: 'question too long (max 4000 chars)' })
    return
  }
  if (_detectInjection(question)) {
    res.status(422).json({ error: 'validation', message: 'Question contains disallowed content.' })
    return
  }

  try {
    const result = await askJarvis({
      tenantId,
      userId,
      sessionId:      (b['session_id']   as string | undefined) ?? undefined,
      projectId:      (b['project_id']   as string | undefined) ?? null,
      assetSystem:    (b['asset_system'] as string | undefined) ?? null,
      question,
      topK:           typeof b['top_k'] === 'number' ? b['top_k'] as number : undefined,
      chunkCharLimit: typeof b['chunk_char_limit'] === 'number' ? b['chunk_char_limit'] as number : undefined,
    })
    res.json({ data: result })
  } catch (err) {
    if (err instanceof AiBudgetExceededError) {
      res.status(402).json({ error: 'ai_budget_exceeded', budget: err.status })
      return
    }
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('ANTHROPIC_API_KEY not configured')) {
      res.status(503).json({ error: 'llm_not_configured', message: msg })
      return
    }
    res.status(500).json({ error: 'ask_failed', message: msg })
  }
})

// ─── GET /ask/sessions ────────────────────────────────────────────────────────

router.get('/sessions', async (req: Req, res: Response) => {
  const { tenantId } = req
  const userId = req.auth?.sub
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const page  = Math.max(1, parseInt(String(req.query['page']  ?? '1'), 10))
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query['limit'] ?? '25'), 10)))
  const offset = (page - 1) * limit

  const [rows, countRow] = await Promise.all([
    tenantQuery(tenantId, `
      SELECT id, title, project_id, resolved_flag, resolved_at,
             linked_work_order_id, message_count, created_at, updated_at
      FROM   chat_sessions
      WHERE  tenant_id = current_setting('app.current_tenant_id',true)::uuid
        AND  user_id   = $1
      ORDER  BY updated_at DESC
      LIMIT  $2 OFFSET $3
    `, [userId, limit, offset]),
    tenantQuery<{ count: string }>(tenantId, `
      SELECT COUNT(*)::text AS count FROM chat_sessions
      WHERE  tenant_id = current_setting('app.current_tenant_id',true)::uuid
        AND  user_id = $1
    `, [userId]),
  ])

  const total = parseInt(countRow.rows[0]?.count ?? '0', 10)
  res.json({
    data: rows.rows,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  })
})

// ─── GET /ask/sessions/:id ────────────────────────────────────────────────────

router.get('/sessions/:id', async (req: Req, res: Response) => {
  const { tenantId } = req
  const userId = req.auth?.sub
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const sid = String(req.params['id'])

  const [session, messages] = await Promise.all([
    tenantQuery(tenantId, `
      SELECT * FROM chat_sessions
      WHERE id = $1 AND user_id = $2
        AND tenant_id = current_setting('app.current_tenant_id',true)::uuid
    `, [sid, userId]),
    tenantQuery(tenantId, `
      SELECT id, ordinal, role, content, structured_answer, retrieved_chunk_ids,
             input_tokens, output_tokens, model, error_text, created_at
      FROM   chat_messages
      WHERE  session_id = $1
        AND  tenant_id  = current_setting('app.current_tenant_id',true)::uuid
      ORDER  BY ordinal
    `, [sid]),
  ])

  if (!session.rows[0]) { res.status(404).json({ error: 'not_found' }); return }
  res.json({ data: { session: session.rows[0], messages: messages.rows } })
})

// ─── POST /ask/sessions/:id/resolve — learning-loop signal ────────────────────

router.post('/sessions/:id/resolve', async (req: Req, res: Response) => {
  const { tenantId } = req
  const userId = req.auth?.sub
  if (!tenantId || !userId) {
    res.status(400).json({ error: 'tenant_and_user_required' })
    return
  }
  const b = req.body as { linked_work_order_id?: string }

  const r = await tenantQuery(tenantId, `
    UPDATE chat_sessions
    SET resolved_flag        = TRUE,
        resolved_at          = NOW(),
        resolved_by          = $1,
        linked_work_order_id = COALESCE($2::uuid, linked_work_order_id)
    WHERE id        = $3
      AND user_id   = $1
      AND tenant_id = current_setting('app.current_tenant_id',true)::uuid
    RETURNING *
  `, [userId, b.linked_work_order_id ?? null, String(req.params['id'])])
  if (!r.rows[0]) { res.status(404).json({ error: 'not_found' }); return }
  res.json({ data: r.rows[0] })
})

// ─── DELETE /ask/sessions/:id (admin) ─────────────────────────────────────────

router.delete('/sessions/:id', requireCapability('assistant.admin') as never, async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }
  const r = await tenantQuery<{ id: string }>(tenantId, `
    DELETE FROM chat_sessions
    WHERE id = $1
      AND tenant_id = current_setting('app.current_tenant_id',true)::uuid
    RETURNING id
  `, [String(req.params['id'])])
  if (!r.rows[0]) { res.status(404).json({ error: 'not_found' }); return }
  res.status(204).send()
})

// ─── GET /ask/chunks/:id — citation hover/modal ────────────────────────────────

router.get('/chunks/:id', async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }
  const r = await tenantQuery(tenantId, `
    SELECT c.id, c.source_id, c.ordinal, c.page_ref, c.text, c.tokens_est,
           s.title AS source_title, s.storage_path AS source_path,
           s.kind AS source_kind, s.license_type
    FROM   knowledge_chunks c
    JOIN   knowledge_sources s ON s.id = c.source_id
    WHERE  c.id = $1
      AND  c.tenant_id = current_setting('app.current_tenant_id',true)::uuid
  `, [String(req.params['id'])])
  if (!r.rows[0]) { res.status(404).json({ error: 'not_found' }); return }
  res.json({ data: r.rows[0] })
})

export default router
