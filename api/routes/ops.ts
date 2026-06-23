/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * Denver Engineering — Operations Center Routes (v4.35.0)
 * ─────────────────────────────────────────────────────────
 * Ava Phase 3 — Unified operations command center:
 *   GET  /ops/overview
 *   GET  /ops/live-feed
 *   GET  /ops/readiness
 *   GET  /ops/escalations
 *   GET  /ops/blockers
 *   POST /ops/reassign
 *   POST /ops/escalate
 *   POST /ops/freeze
 *   POST /ops/unfreeze
 *   POST /ops/incident
 */
import { Router, type Response } from 'express'
import type { TenantRequest as Request } from '../middleware/tenant'
import { tenantQuery } from '../db/pool'
import { computeReadiness } from '../services/readiness/readinessEngine'
import { generateInboxRecommendations, fetchRecommendationInputs } from '../services/ops/recommendationEngine'
import { batchPredictBreaches, getHistoricalBaseline } from '../services/ops/predictiveSla'
import { pollEvents } from '../realtime/wsGateway'
import { publishActionEvent } from '../services/actions/actionEventPublisher'
import { broadcastEvent } from '../realtime/eventBroadcaster'

export const opsRouter = Router()

// ─── GET /ops/overview ────────────────────────────────────────────────────────

opsRouter.get('/overview', async (req: Request, res: Response) => {
  const tenantId = req.tenantId!
  const projectId = req.query['project_id'] as string | undefined

  const [actions, incidents, notifications] = await Promise.all([
    tenantQuery(tenantId, `
      SELECT
        COUNT(*) FILTER (WHERE status NOT IN ('completed','cancelled')) AS open,
        COUNT(*) FILTER (WHERE due_at < NOW() AND status NOT IN ('completed','cancelled')) AS overdue,
        COUNT(*) FILTER (WHERE (max_escalation_level ?? 0) >= 1
                           AND status NOT IN ('completed','cancelled')) AS escalated,
        COUNT(*) FILTER (WHERE status NOT IN ('completed','cancelled')
                           AND EXISTS (
                             SELECT 1 FROM action_relations ar
                             WHERE ar.target_action_id = a.id
                               AND ar.deleted_at IS NULL
                               AND ar.relation_type IN ('blocks','caused_by','spawned_from')
                               AND ar.tenant_id = a.tenant_id
                           )) AS blocked
      FROM actions a
      WHERE tenant_id = $1 ${projectId ? 'AND project_id = $2' : ''}
    `, projectId ? [tenantId, projectId] : [tenantId]),
    tenantQuery(tenantId, `
      SELECT COUNT(*) FILTER (WHERE status NOT IN ('resolved','mitigated')) AS active
      FROM ops_incidents
      WHERE tenant_id = $1 ${projectId ? 'AND project_id = $2' : ''}
    `, projectId ? [tenantId, projectId] : [tenantId]),
    tenantQuery(tenantId, `
      SELECT COUNT(*) AS dead_letter_count
      FROM notification_dead_letters ndl
      JOIN notification_jobs nj ON nj.id = ndl.original_job_id
      WHERE nj.tenant_id = $1
    `, [tenantId]),
  ])

  const a = actions.rows[0]
  res.json({
    data: {
      open_actions:       Number(a.open),
      overdue_actions:    Number(a.overdue),
      escalated_actions:  Number(a.escalated),
      blocked_actions:    Number(a.blocked),
      active_incidents:   Number(incidents.rows[0]?.active ?? 0),
      notification_failures: Number(notifications.rows[0]?.dead_letter_count ?? 0),
    },
  })
})

// ─── GET /ops/live-feed ───────────────────────────────────────────────────────

opsRouter.get('/live-feed', async (req: Request, res: Response) => {
  const tenantId = req.tenantId!
  const lastSeq  = parseInt(req.query['last_seq'] as string ?? '0', 10)
  const scope    = (req.query['scope'] as string) ?? 'tenant'
  const scopeId  = req.query['scope_id'] as string | undefined

  const events = await pollEvents(
    tenantId, isNaN(lastSeq) ? 0 : lastSeq,
    scope as never, scopeId,
  )
  res.json({ data: events, meta: { count: events.length } })
})

// ─── GET /ops/readiness ───────────────────────────────────────────────────────

opsRouter.get('/readiness', async (req: Request, res: Response) => {
  const tenantId = req.tenantId!
  const projectId = req.query['project_id'] as string | undefined

  // Get all projects and compute readiness
  const projectsRes = await tenantQuery(tenantId, `
    SELECT id, name FROM projects
    WHERE tenant_id = $1 ${projectId ? 'AND id = $2' : ''}
      AND status NOT IN ('archived','cancelled')
    LIMIT 20
  `, projectId ? [tenantId, projectId] : [tenantId])

  const readiness = await Promise.all(
    projectsRes.rows.map(async (p) => {
      const result = await computeReadiness(tenantId, 'project', p.id)
      return { project_id: p.id, project_name: p.name, ...result }
    }),
  )

  res.json({ data: readiness })
})

// ─── GET /ops/escalations ─────────────────────────────────────────────────────

opsRouter.get('/escalations', async (req: Request, res: Response) => {
  const tenantId = req.tenantId!
  const limit    = Math.min(parseInt(req.query['limit'] as string ?? '50', 10), 200)

  const res2 = await tenantQuery(tenantId, `
    SELECT a.id, a.title, a.action_type, a.priority, a.status,
           a.max_escalation_level AS escalation_level,
           a.due_at, a.project_id,
           p.name AS project_name,
           u.email AS assignee_email
    FROM actions a
    LEFT JOIN projects p ON p.id = a.project_id
    LEFT JOIN users u ON u.id = a.assigned_to_user_id
    WHERE a.tenant_id = $1
      AND a.status NOT IN ('completed','cancelled')
      AND COALESCE(a.max_escalation_level, 0) >= 1
    ORDER BY a.max_escalation_level DESC, a.due_at ASC NULLS LAST
    LIMIT $2
  `, [tenantId, limit])

  res.json({ data: res2.rows, meta: { count: res2.rowCount } })
})

// ─── GET /ops/blockers ────────────────────────────────────────────────────────

opsRouter.get('/blockers', async (req: Request, res: Response) => {
  const tenantId = req.tenantId!

  const res2 = await tenantQuery(tenantId, `
    SELECT
      a.id, a.title, a.status, a.priority,
      COUNT(ar.id) AS blocker_count,
      ARRAY_AGG(ab.title ORDER BY ab.priority DESC) AS blocking_titles
    FROM actions a
    JOIN action_relations ar ON ar.target_action_id = a.id
      AND ar.deleted_at IS NULL
      AND ar.relation_type IN ('blocks','caused_by','spawned_from')
    JOIN actions ab ON ab.id = ar.source_action_id AND ab.tenant_id = a.tenant_id
    WHERE a.tenant_id = $1
      AND a.status NOT IN ('completed','cancelled')
    GROUP BY a.id, a.title, a.status, a.priority
    ORDER BY blocker_count DESC, a.due_at ASC NULLS LAST
    LIMIT 50
  `, [tenantId])

  res.json({ data: res2.rows })
})

// ─── POST /ops/reassign ───────────────────────────────────────────────────────

opsRouter.post('/reassign', async (req: Request, res: Response) => {
  const tenantId   = req.tenantId!
  const issuedBy   = (req as never as { auth?: { sub?: string } }).auth?.sub
  const { action_ids, target_user_id, reason } = req.body as {
    action_ids: string[]; target_user_id: string; reason: string
  }

  if (!action_ids?.length || !target_user_id || !reason) {
    res.status(400).json({ error: 'action_ids, target_user_id, and reason are required' })
    return
  }

  const cmdRes = await tenantQuery(tenantId, `
    INSERT INTO ops_commands
      (tenant_id, command_type, issued_by, target_action_ids, target_user_id, reason, status)
    VALUES ($1,'reassign',$2,$3,$4,$5,'executing')
    RETURNING id
  `, [tenantId, issuedBy, action_ids, target_user_id, reason])
  const commandId = cmdRes.rows[0].id as string

  // Apply reassignment
  await tenantQuery(tenantId, `
    UPDATE actions SET assigned_to_user_id = $3, updated_at = NOW()
    WHERE tenant_id = $1 AND id = ANY($2::uuid[])
  `, [tenantId, action_ids, target_user_id])

  // Publish events
  for (const actionId of action_ids) {
    void publishActionEvent(tenantId, actionId, 'reassigned', issuedBy ?? null, { target_user_id })
    broadcastEvent({ event_type: 'action_updated', tenant_id: tenantId,
      payload: { action_id: actionId, field: 'assigned_to', value: target_user_id },
      subscription_scope: 'action', scope_id: actionId })
  }

  await tenantQuery(tenantId, `UPDATE ops_commands SET status = 'completed', executed_at = NOW() WHERE id = $1`, [commandId])

  res.json({ data: { command_id: commandId, affected: action_ids.length } })
})

// ─── POST /ops/escalate ───────────────────────────────────────────────────────

opsRouter.post('/escalate', async (req: Request, res: Response) => {
  const tenantId = req.tenantId!
  const issuedBy = (req as never as { auth?: { sub?: string } }).auth?.sub
  const { action_ids, reason } = req.body as { action_ids: string[]; reason: string }

  if (!action_ids?.length || !reason) {
    res.status(400).json({ error: 'action_ids and reason are required' })
    return
  }

  const cmdRes = await tenantQuery(tenantId, `
    INSERT INTO ops_commands
      (tenant_id, command_type, issued_by, target_action_ids, reason, status)
    VALUES ($1,'bulk_escalate',$2,$3,$4,'executing')
    RETURNING id
  `, [tenantId, issuedBy, action_ids, reason])

  await tenantQuery(tenantId, `
    UPDATE actions SET
      max_escalation_level = COALESCE(max_escalation_level, 0) + 1,
      escalation_status = 'escalated', updated_at = NOW()
    WHERE tenant_id = $1 AND id = ANY($2::uuid[])
  `, [tenantId, action_ids])

  for (const actionId of action_ids) {
    void publishActionEvent(tenantId, actionId, 'escalated', issuedBy ?? null, { reason, source: 'supervisor' })
    broadcastEvent({ event_type: 'escalation_triggered', tenant_id: tenantId,
      payload: { action_id: actionId }, subscription_scope: 'escalation', scope_id: actionId })
  }

  await tenantQuery(tenantId, `UPDATE ops_commands SET status = 'completed', executed_at = NOW() WHERE id = $1`, [cmdRes.rows[0].id])
  res.json({ data: { command_id: cmdRes.rows[0].id, escalated: action_ids.length } })
})

// ─── POST /ops/freeze ────────────────────────────────────────────────────────

opsRouter.post('/freeze', async (req: Request, res: Response) => {
  const tenantId = req.tenantId!
  const issuedBy = (req as never as { auth?: { sub?: string } }).auth?.sub
  const { action_ids, reason } = req.body as { action_ids: string[]; reason: string }

  if (!action_ids?.length || !reason) {
    res.status(400).json({ error: 'action_ids and reason are required' })
    return
  }

  await tenantQuery(tenantId, `
    INSERT INTO ops_commands
      (tenant_id, command_type, issued_by, target_action_ids, reason, status, executed_at)
    VALUES ($1,'freeze',$2,$3,$4,'completed',NOW())
  `, [tenantId, issuedBy, action_ids, reason])

  // Pause SLA for all frozen actions
  await tenantQuery(tenantId, `
    INSERT INTO action_sla_state (tenant_id, action_id, sla_status, paused_at)
    SELECT $1, id, 'paused', NOW() FROM actions
    WHERE tenant_id = $1 AND id = ANY($2::uuid[])
    ON CONFLICT (tenant_id, action_id)
    DO UPDATE SET sla_status = 'paused', paused_at = NOW()
  `, [tenantId, action_ids])

  for (const actionId of action_ids) {
    void publishActionEvent(tenantId, actionId, 'sla_paused', issuedBy ?? null, { reason, source: 'freeze' })
  }

  res.json({ data: { frozen: action_ids.length } })
})

// ─── POST /ops/unfreeze ──────────────────────────────────────────────────────

opsRouter.post('/unfreeze', async (req: Request, res: Response) => {
  const tenantId = req.tenantId!
  const issuedBy = (req as never as { auth?: { sub?: string } }).auth?.sub
  const { action_ids, reason } = req.body as { action_ids: string[]; reason: string }

  if (!action_ids?.length || !reason) {
    res.status(400).json({ error: 'action_ids and reason are required' })
    return
  }

  await tenantQuery(tenantId, `
    UPDATE action_sla_state SET
      sla_status = 'active',
      paused_duration_mins = COALESCE(paused_duration_mins, 0) +
        EXTRACT(EPOCH FROM (NOW() - COALESCE(paused_at, NOW()))) / 60,
      paused_at = NULL
    WHERE tenant_id = $1 AND action_id = ANY($2::uuid[]) AND sla_status = 'paused'
  `, [tenantId, action_ids])

  for (const actionId of action_ids) {
    void publishActionEvent(tenantId, actionId, 'sla_resumed', issuedBy ?? null, { reason })
  }

  res.json({ data: { unfrozen: action_ids.length } })
})

// ─── POST /ops/incident ───────────────────────────────────────────────────────

opsRouter.post('/incident', async (req: Request, res: Response) => {
  const tenantId = req.tenantId!
  const reportedBy = (req as never as { auth?: { sub?: string } }).auth?.sub
  const { title, description, severity, project_id, related_action_ids } = req.body as {
    title: string; description?: string; severity?: string; project_id?: string; related_action_ids?: string[]
  }

  if (!title) { res.status(400).json({ error: 'title is required' }); return }

  const res2 = await tenantQuery(tenantId, `
    INSERT INTO ops_incidents
      (tenant_id, title, description, severity, reported_by, project_id, related_action_ids)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    RETURNING *
  `, [tenantId, title, description ?? null, severity ?? 'medium', reportedBy, project_id ?? null, related_action_ids ?? []])

  broadcastEvent({ event_type: 'incident_reported', tenant_id: tenantId,
    payload: { incident_id: res2.rows[0].id, title, severity },
    subscription_scope: 'tenant' })

  res.status(201).json({ data: res2.rows[0] })
})

// ─── GET /ops/recommendations ──────────────────────────────────────────────────

opsRouter.get('/recommendations', async (req: Request, res: Response) => {
  const tenantId  = req.tenantId!
  const projectId = req.query['project_id'] as string | undefined

  const inputs = await fetchRecommendationInputs(tenantId, projectId)
  const result = await generateInboxRecommendations(inputs)

  res.json({ data: result })
})
