/**
 * Denver Engineering — Agent Actions Routes (v4.31.0)
 *
 *   GET  /api/v1/agent-actions                 — paginated list + filters
 *   GET  /api/v1/agent-actions/_stats          — rollup for digest / dashboards
 *   GET  /api/v1/agent-actions/:id             — detail
 *   POST /api/v1/agent-actions/:id/review      — human confirmation/override
 *
 * Primary consumer: the Agent Actions review queue in the Automation UI.
 * Secondary consumer: the morning-digest handler, which calls _stats to
 * summarize "what did the agent do overnight" before drafting the email.
 */

import { Router, Response } from 'express'
import { tenantQuery } from '../db/pool'
import { requireAuth, AuthenticatedRequest } from '../auth'
import { requireTenant, TenantRequest } from '../middleware/tenant'
import { stats as actionStats, markReviewed } from '../services/agentActions'

type Req = AuthenticatedRequest & TenantRequest

const router = Router()
router.use(requireAuth as never)
router.use(requireTenant() as never)

function _pagination(q: Record<string, unknown>) {
  const page  = Math.max(1, parseInt(String(q['page'] ?? '1'), 10))
  const limit = Math.min(200, Math.max(1, parseInt(String(q['limit'] ?? '50'), 10)))
  return { page, limit, offset: (page - 1) * limit }
}

// ─── GET /_stats — mount BEFORE /:id so the param route doesn't swallow it ──

router.get('/_stats', async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const { from, to, project_id } = req.query as Record<string, string>
  const now = new Date()
  const defaultFrom = new Date(now.getTime() - 24 * 3600 * 1000).toISOString()

  const rollup = await actionStats({
    tenantId,
    projectId: project_id,
    from: from ?? defaultFrom,
    to:   to   ?? now.toISOString(),
  })
  res.json({ data: rollup })
})

// ─── GET list ─────────────────────────────────────────────────────────────────

router.get('/', async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const { page, limit, offset } = _pagination(req.query as Record<string, unknown>)
  const { agent, action_type, project_id, decision, reviewed, from, to } =
    req.query as Record<string, string>

  const conds: string[] = []
  const vals: unknown[] = []
  let i = 1
  if (agent)       { conds.push(`agent_name = $${i++}`);  vals.push(agent) }
  if (action_type) { conds.push(`action_type = $${i++}`); vals.push(action_type) }
  if (project_id)  { conds.push(`project_id = $${i++}`);  vals.push(project_id) }
  if (decision)    { conds.push(`decision = $${i++}`);    vals.push(decision) }
  if (reviewed === 'true')  conds.push(`reviewed_at IS NOT NULL`)
  if (reviewed === 'false') conds.push(`reviewed_at IS NULL`)
  if (from) { conds.push(`created_at >= $${i++}`); vals.push(from) }
  if (to)   { conds.push(`created_at <= $${i++}`); vals.push(to) }

  const where = conds.length ? `AND ${conds.join(' AND ')}` : ''

  const [rows, countRow] = await Promise.all([
    tenantQuery(tenantId, `
      SELECT id, project_id, agent_name, action_type, target_type, target_id,
             decision, rationale, rule_id, evidence, confidence,
             human_reviewable, reviewed_by, reviewed_at, review_outcome, review_notes,
             created_at
      FROM   agent_actions
      WHERE  tenant_id = current_setting('app.current_tenant_id',true)::uuid ${where}
      ORDER  BY created_at DESC
      LIMIT  $${i} OFFSET $${i + 1}
    `, [...vals, limit, offset]),
    tenantQuery<{ count: string }>(tenantId, `
      SELECT COUNT(*)::text AS count FROM agent_actions
      WHERE tenant_id = current_setting('app.current_tenant_id',true)::uuid ${where}
    `, vals),
  ])

  const total = parseInt(countRow.rows[0]?.count ?? '0', 10)
  res.json({ data: rows.rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
})

// ─── GET one ──────────────────────────────────────────────────────────────────

router.get('/:id', async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const r = await tenantQuery(tenantId, `
    SELECT * FROM agent_actions
    WHERE id = $1
      AND tenant_id = current_setting('app.current_tenant_id',true)::uuid
  `, [req.params['id']])
  if (!r.rows[0]) { res.status(404).json({ error: 'not_found' }); return }
  res.json({ data: r.rows[0] })
})

// ─── POST review ──────────────────────────────────────────────────────────────

router.post('/:id/review', async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const b = req.body as { outcome?: string; notes?: string }
  if (!['confirmed','overridden','reversed'].includes(b.outcome ?? '')) {
    res.status(422).json({ error: 'validation', message: 'outcome must be confirmed|overridden|reversed' })
    return
  }
  const userId = req.auth?.sub ?? null
  if (!userId) {
    res.status(401).json({ error: 'user_required' })
    return
  }

  const updated = await markReviewed(
    tenantId, String(req.params['id']), b.outcome as 'confirmed'|'overridden'|'reversed',
    userId, b.notes,
  )
  if (!updated) { res.status(404).json({ error: 'not_found' }); return }
  res.json({ data: updated })
})

export default router
