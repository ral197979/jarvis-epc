/**
 * Denver Engineering — Executive Dashboard Routes (v4.40.0)
 * ──────────────────────────────────────────────────────────
 * Ava Phase 4 — Portfolio-level operational visibility.
 */

import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { TenantRequest } from '../middleware/tenant'
import { tenantQuery } from '../db/pool'
import { requireCapability } from '../authz/requireCapability'

export const executiveRouter = Router()
const auth = requireAuth as never
type ExecReq = Request & AuthenticatedRequest & TenantRequest

executiveRouter.use(auth)

// ─── Global overview ──────────────────────────────────────────────────────────
executiveRouter.get('/overview', requireCapability('portfolio.view') as never, async (req: Request, res: Response) => {
  const r = req as ExecReq
  const [actions, readiness, incidents, aiRecs] = await Promise.all([
    tenantQuery(r.tenantId!, `
      SELECT
        COUNT(*) FILTER (WHERE status = 'open') AS open_count,
        COUNT(*) FILTER (WHERE status = 'in_progress') AS in_progress_count,
        COUNT(*) FILTER (WHERE status = 'completed') AS completed_count,
        COUNT(*) FILTER (WHERE (sla_remaining_minutes IS NOT NULL AND sla_remaining_minutes < 0)) AS breached_count,
        COUNT(*) FILTER (WHERE max_escalation_level >= 1) AS escalated_count
      FROM actions WHERE tenant_id = $1
    `, [r.tenantId]),
    tenantQuery(r.tenantId!, `
      SELECT state, COUNT(*) AS count
      FROM readiness_scores WHERE tenant_id = $1
      GROUP BY state
    `, [r.tenantId]),
    tenantQuery(r.tenantId!, `
      SELECT severity, COUNT(*) AS count
      FROM ops_incidents WHERE tenant_id = $1 AND status = 'open'
      GROUP BY severity
    `, [r.tenantId]),
    tenantQuery(r.tenantId!, `
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending') AS pending_approvals,
        COUNT(*) FILTER (WHERE status = 'executed') AS executed_today
      FROM ai_recommendation_queue
      WHERE tenant_id = $1 AND generated_at >= now() - interval '24 hours'
    `, [r.tenantId]),
  ])
  res.json({
    data: {
      actions: actions.rows[0],
      readiness: readiness.rows,
      incidents: incidents.rows,
      ai_recommendations: aiRecs.rows[0],
    }
  })
})

// ─── Portfolio risk heatmap ───────────────────────────────────────────────────
executiveRouter.get('/portfolio-risk', requireCapability('portfolio.view') as never, async (req: Request, res: Response) => {
  const r = req as ExecReq
  const { rows } = await tenantQuery(r.tenantId!, `
    SELECT
      p.id AS project_id, p.name AS project_name,
      COUNT(a.id) FILTER (WHERE a.status IN ('open','in_progress')) AS open_actions,
      COUNT(a.id) FILTER (WHERE a.max_escalation_level >= 1) AS escalated,
      COUNT(a.id) FILTER (WHERE a.sla_remaining_minutes < 0) AS overdue,
      rs.score AS readiness_score, rs.state AS readiness_state
    FROM projects p
    LEFT JOIN actions a ON a.project_id = p.id AND a.tenant_id = p.tenant_id
    LEFT JOIN readiness_scores rs ON rs.entity_id = p.id AND rs.tenant_id = p.tenant_id
      AND rs.domain = 'project'
    WHERE p.tenant_id = $1
    GROUP BY p.id, p.name, rs.score, rs.state
    ORDER BY open_actions DESC
    LIMIT 50
  `, [r.tenantId])
  res.json({ data: rows })
})

// ─── Escalation hotspots ──────────────────────────────────────────────────────
executiveRouter.get('/escalation-hotspots', requireCapability('portfolio.view') as never, async (req: Request, res: Response) => {
  const r = req as ExecReq
  const { rows } = await tenantQuery(r.tenantId!, `
    SELECT
      project_id, source_module,
      COUNT(*) AS escalated_count,
      MAX(max_escalation_level) AS max_level,
      COUNT(*) FILTER (WHERE sla_remaining_minutes < 0) AS also_overdue
    FROM actions
    WHERE tenant_id = $1 AND max_escalation_level >= 1 AND status NOT IN ('completed','cancelled')
    GROUP BY project_id, source_module
    ORDER BY escalated_count DESC
    LIMIT 30
  `, [r.tenantId])
  res.json({ data: rows })
})

// ─── Contractor performance ───────────────────────────────────────────────────
executiveRouter.get('/contractor-performance', requireCapability('portfolio.view') as never, async (req: Request, res: Response) => {
  const r = req as ExecReq
  const { rows } = await tenantQuery(r.tenantId!, `
    SELECT
      assignee_id,
      COUNT(*) AS total_assigned,
      COUNT(*) FILTER (WHERE status = 'completed') AS completed,
      COUNT(*) FILTER (WHERE status IN ('open','in_progress') AND sla_remaining_minutes < 0) AS overdue,
      COUNT(*) FILTER (WHERE max_escalation_level >= 1) AS escalated,
      ROUND(AVG(CASE WHEN status = 'completed' AND created_at IS NOT NULL
        THEN EXTRACT(EPOCH FROM (updated_at - created_at)) / 3600 END), 1) AS avg_completion_hours
    FROM actions
    WHERE tenant_id = $1 AND assignee_id IS NOT NULL
    GROUP BY assignee_id
    ORDER BY overdue DESC
    LIMIT 50
  `, [r.tenantId])
  res.json({ data: rows })
})

// ─── SLA compliance ───────────────────────────────────────────────────────────
executiveRouter.get('/sla-compliance', requireCapability('portfolio.view') as never, async (req: Request, res: Response) => {
  const r = req as ExecReq
  const { rows } = await tenantQuery(r.tenantId!, `
    SELECT
      action_type,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE sla_remaining_minutes >= 0 OR sla_remaining_minutes IS NULL) AS compliant,
      COUNT(*) FILTER (WHERE sla_remaining_minutes < 0) AS breached,
      ROUND(100.0 * COUNT(*) FILTER (WHERE sla_remaining_minutes >= 0 OR sla_remaining_minutes IS NULL)
        / NULLIF(COUNT(*), 0), 1) AS compliance_pct
    FROM actions
    WHERE tenant_id = $1 AND status NOT IN ('completed','cancelled')
    GROUP BY action_type
    ORDER BY breached DESC
  `, [r.tenantId])
  res.json({ data: rows })
})

// ─── AI recommendation acceptance rate ───────────────────────────────────────
executiveRouter.get('/ai-acceptance', requireCapability('portfolio.view') as never, async (req: Request, res: Response) => {
  const r = req as ExecReq
  const { rows } = await tenantQuery(r.tenantId!, `
    SELECT
      category,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE status = 'approved') AS approved,
      COUNT(*) FILTER (WHERE status = 'rejected') AS rejected,
      COUNT(*) FILTER (WHERE status = 'executed') AS executed,
      ROUND(AVG(confidence_score), 1) AS avg_confidence
    FROM ai_recommendation_queue
    WHERE tenant_id = $1 AND generated_at >= now() - interval '30 days'
    GROUP BY category
    ORDER BY total DESC
  `, [r.tenantId])
  res.json({ data: rows })
})

// ─── Operational throughput ───────────────────────────────────────────────────
executiveRouter.get('/throughput', requireCapability('portfolio.view') as never, async (req: Request, res: Response) => {
  const r = req as ExecReq
  const days = Math.min(Number(req.query['days'] ?? 30), 90)
  const { rows } = await tenantQuery(r.tenantId!, `
    SELECT
      DATE_TRUNC('day', created_at) AS day,
      COUNT(*) FILTER (WHERE status = 'completed') AS completed,
      COUNT(*) AS created,
      COUNT(*) FILTER (WHERE max_escalation_level >= 1) AS escalated
    FROM actions
    WHERE tenant_id = $1 AND created_at >= now() - ($2 || ' days')::interval
    GROUP BY 1 ORDER BY 1 DESC
  `, [r.tenantId, String(days)])
  res.json({ data: rows })
})
