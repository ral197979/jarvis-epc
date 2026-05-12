/**
 * Denver Engineering — Readiness Routes (v4.35.1)
 * ──────────────────────────────────────────────────
 * Ava Phase 3
 *   GET /readiness/project/:id
 *   GET /readiness/system/:id
 *   GET /readiness/subsystem/:id
 *   GET /readiness/project/:id/history
 */
import { Router, type Response } from 'express'
import type { Request } from '../middleware/tenant'
import { tenantQuery } from '../db/pool'
import {
  computeReadiness, persistReadinessScore, type ReadinessDomain,
} from '../services/readiness/readinessEngine'

export const readinessRouter = Router()

// ─── GET /readiness/project/:id ───────────────────────────────────────────────

readinessRouter.get('/project/:id', async (req: Request, res: Response) => {
  const tenantId = req.tenantId!
  const projectId = req.params['id']!
  const domain    = (req.query['domain'] as ReadinessDomain) ?? 'project'

  const projRes = await tenantQuery(tenantId,
    `SELECT id, name FROM projects WHERE id = $1 AND tenant_id = $2`,
    [projectId, tenantId],
  )
  if (!projRes.rows[0]) { res.status(404).json({ error: 'not_found' }); return }

  const result = await computeReadiness(tenantId, domain, projectId)
  void persistReadinessScore(tenantId, domain, projectId, 'project', result)

  res.json({
    data: {
      entity_id:   projectId,
      entity_name: projRes.rows[0].name as string,
      domain,
      ...result,
    },
  })
})

// ─── GET /readiness/system/:id ────────────────────────────────────────────────

readinessRouter.get('/system/:id', async (req: Request, res: Response) => {
  const tenantId = req.tenantId!
  const systemId = req.params['id']!

  const sysRes = await tenantQuery(tenantId,
    `SELECT id, name FROM systems WHERE id = $1 AND tenant_id = $2`,
    [systemId, tenantId],
  )
  if (!sysRes.rows[0]) { res.status(404).json({ error: 'not_found' }); return }

  const result = await computeReadiness(tenantId, 'system', systemId)
  void persistReadinessScore(tenantId, 'system', systemId, 'system', result)

  res.json({ data: { entity_id: systemId, entity_name: sysRes.rows[0].name as string, domain: 'system', ...result } })
})

// ─── GET /readiness/subsystem/:id ─────────────────────────────────────────────

readinessRouter.get('/subsystem/:id', async (req: Request, res: Response) => {
  const tenantId    = req.tenantId!
  const subsystemId = req.params['id']!

  const result = await computeReadiness(tenantId, 'subsystem', subsystemId)
  void persistReadinessScore(tenantId, 'subsystem', subsystemId, 'subsystem', result)

  res.json({ data: { entity_id: subsystemId, domain: 'subsystem', ...result } })
})

// ─── GET /readiness/project/:id/history ──────────────────────────────────────

readinessRouter.get('/project/:id/history', async (req: Request, res: Response) => {
  const tenantId  = req.tenantId!
  const projectId = req.params['id']!
  const domain    = (req.query['domain'] as string) ?? 'project'
  const days      = Math.min(parseInt(req.query['days'] as string ?? '30', 10), 90)

  const res2 = await tenantQuery(tenantId, `
    SELECT snapshot_date, readiness_score, readiness_state, blocking_factors, component_scores
    FROM readiness_snapshots
    WHERE tenant_id = $1 AND entity_id = $2 AND domain = $3
      AND snapshot_date >= CURRENT_DATE - INTERVAL '1 day' * $4
    ORDER BY snapshot_date ASC
  `, [tenantId, projectId, domain, days])

  res.json({ data: res2.rows })
})

// ─── GET /readiness/overview ──────────────────────────────────────────────────

readinessRouter.get('/overview', async (req: Request, res: Response) => {
  const tenantId = req.tenantId!

  const res2 = await tenantQuery(tenantId, `
    SELECT rs.entity_id, rs.domain, rs.readiness_score, rs.readiness_state,
           rs.blocking_factors, rs.computed_at,
           p.name AS entity_name
    FROM readiness_scores rs
    JOIN projects p ON p.id = rs.entity_id AND p.tenant_id = rs.tenant_id
    WHERE rs.tenant_id = $1
    ORDER BY rs.readiness_score ASC
  `, [tenantId])

  res.json({ data: res2.rows })
})
