/**
 * Denver Engineering — Runbook Routes (v4.40.0)
 * ──────────────────────────────────────────────
 * Ava Phase 4 — CRUD + execution endpoints for operational runbooks.
 */

import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { TenantRequest } from '../middleware/tenant'
import { tenantQuery } from '../db/pool'
import { executeRunbook, rollbackExecution, approveRunbookStep } from '../services/runbook/runbookEngine'

export const runbooksRouter = Router()
const auth = requireAuth as never

type RunbookReq = Request & AuthenticatedRequest & TenantRequest

runbooksRouter.use(auth)

// ─── List runbooks ────────────────────────────────────────────────────────────
runbooksRouter.get('/', async (req: Request, res: Response) => {
  const r = req as RunbookReq
  const { rows } = await tenantQuery(r.tenantId, `
    SELECT r.id, r.name, r.description, r.trigger_type, r.status, r.tags,
           r.created_at,
           (SELECT count(*) FROM runbook_executions e WHERE e.runbook_id = r.id) AS execution_count
    FROM operational_runbooks r
    WHERE r.tenant_id = $1
    ORDER BY r.created_at DESC
    LIMIT 100
  `, [r.tenantId])
  res.json({ data: rows })
})

// ─── Create runbook ───────────────────────────────────────────────────────────
runbooksRouter.post('/', async (req: Request, res: Response) => {
  const r = req as RunbookReq
  const { name, description, trigger_type = 'manual', trigger_config = {}, tags = [], steps, rollback_steps = [] } = req.body
  if (!name || !steps || !Array.isArray(steps)) {
    res.status(400).json({ error: 'name and steps are required' }); return
  }
  const { rows: rbRows } = await tenantQuery(r.tenantId, `
    INSERT INTO operational_runbooks (tenant_id, name, description, trigger_type, trigger_config, tags, created_by)
    VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)
    RETURNING id
  `, [r.tenantId, name, description ?? null, trigger_type,
      JSON.stringify(trigger_config), tags, r.auth.sub])
  const runbookId = rbRows[0]!.id as string
  const { rows: vRows } = await tenantQuery(r.tenantId, `
    INSERT INTO runbook_versions (tenant_id, runbook_id, version, steps, rollback_steps, created_by)
    VALUES ($1,$2,1,$3::jsonb,$4::jsonb,$5)
    RETURNING id
  `, [r.tenantId, runbookId, JSON.stringify(steps), JSON.stringify(rollback_steps), r.auth.sub])
  const versionId = vRows[0]!.id as string
  await tenantQuery(r.tenantId,
    `UPDATE operational_runbooks SET current_version_id = $1, status = 'active' WHERE id = $2`,
    [versionId, runbookId])
  res.status(201).json({ data: { runbook_id: runbookId, version_id: versionId } })
})

// ─── Execute runbook ──────────────────────────────────────────────────────────
runbooksRouter.post('/:id/execute', async (req: Request, res: Response) => {
  const r = req as RunbookReq
  const { mode = 'live', variables = {}, correlation_id } = req.body
  if (!['live', 'dry_run', 'simulation'].includes(mode)) {
    res.status(400).json({ error: 'mode must be live | dry_run | simulation' }); return
  }
  try {
    const result = await executeRunbook(r.tenantId, req.params['id']!, r.auth.sub,
      { mode, variables, correlationId: correlation_id })
    res.json({ data: result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(400).json({ error: msg })
  }
})

// ─── Simulate runbook (dry-run shortcut) ──────────────────────────────────────
runbooksRouter.post('/:id/simulate', async (req: Request, res: Response) => {
  const r = req as RunbookReq
  const { variables = {} } = req.body
  try {
    const result = await executeRunbook(r.tenantId, req.params['id']!, r.auth.sub,
      { mode: 'dry_run', variables })
    res.json({ data: result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(400).json({ error: msg })
  }
})

// ─── Get executions ───────────────────────────────────────────────────────────
runbooksRouter.get('/:id/executions', async (req: Request, res: Response) => {
  const r = req as RunbookReq
  const limit = Math.min(Number(req.query['limit'] ?? 20), 100)
  const { rows } = await tenantQuery(r.tenantId, `
    SELECT id, status, mode, triggered_by, current_step, total_steps,
           result_summary, started_at, completed_at
    FROM runbook_executions
    WHERE runbook_id = $1 AND tenant_id = $2
    ORDER BY created_at DESC LIMIT $3
  `, [req.params['id'], r.tenantId, limit])
  res.json({ data: rows })
})

// ─── Rollback execution ───────────────────────────────────────────────────────
runbooksRouter.post('/executions/:execId/rollback', async (req: Request, res: Response) => {
  const r = req as RunbookReq
  const result = await rollbackExecution(req.params['execId']!, r.tenantId)
  res.json({ data: result })
})

// ─── Approve step ─────────────────────────────────────────────────────────────
runbooksRouter.post('/executions/:execId/approve/:stepIndex', async (req: Request, res: Response) => {
  const r = req as RunbookReq
  await approveRunbookStep(r.tenantId, req.params['execId']!, Number(req.params['stepIndex']), r.auth.sub)
  res.json({ data: { approved: true } })
})
