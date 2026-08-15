/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Denver Engineering — Calculation Sessions Routes
 * GET/POST /api/v1/projects/:projectId/calc-sessions
 * GET/PATCH/DELETE /api/v1/calc-sessions/:id
 */
import { Router, Request, Response } from 'express'
import { tenantQuery } from '../db/pool'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest } from '../middleware/tenant'

import { requireCapability } from '../authz/requireCapability'
// v4.31.0 TS fix: narrow tenantId to required for post-middleware handlers.
// requireAuth + requireTenant middleware guarantee these are set before any
// handler in this file runs; asserting their presence at the type level avoids
// `string | undefined` leaking into every tenantQuery / logger call.
type AuthTenantRequest = Request & AuthenticatedRequest & Omit<TenantRequest, 'tenantId'> & { tenantId: string }

const router = Router()
router.use(requireAuth as any)
router.use(requireTenant() as any)

// ─── List sessions for a project ──────────────────────────────────────────────
router.get('/projects/:projectId/calc-sessions', requireCapability('engineering.view') as never, async (req: Request, res: Response) => {
  const r = req as AuthTenantRequest
  const { projectId } = req.params
  const { tool_name, limit = '20', offset = '0' } = req.query

  const params: unknown[] = [r.tenantId, projectId]
  let toolFilter = ''
  if (tool_name) { params.push(tool_name); toolFilter = `AND cs.tool_name = $${params.length}` }
  params.push(parseInt(limit as string, 10), parseInt(offset as string, 10))

  try {
    const result = await tenantQuery(r.tenantId,
      `SELECT cs.id, cs.tool_name, cs.tool_version, cs.input_summary, cs.output_summary,
              cs.notes, cs.created_at, u.name AS created_by_name,
              CASE WHEN cs.pid_svg IS NOT NULL THEN true ELSE false END AS has_pid
       FROM calc_sessions cs
       LEFT JOIN users u ON u.id = cs.created_by
       WHERE cs.tenant_id = $1 AND cs.project_id = $2 ${toolFilter}
       ORDER BY cs.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    )
    res.json({ sessions: result.rows })
  } catch (err) {
    console.error('[calc-sessions] list error', err)
    res.status(500).json({ error: 'Failed to list calculation sessions' })
  }
})

// ─── Save a new session ────────────────────────────────────────────────────────
router.post('/projects/:projectId/calc-sessions', requireCapability('engineering.write') as never, async (req: Request, res: Response) => {
  const r = req as AuthTenantRequest
  const { projectId } = req.params
  const { tool_name, tool_version, input_summary, output_summary, pid_svg, notes } = req.body

  if (!tool_name || typeof tool_name !== 'string')
    return res.status(400).json({ error: 'tool_name is required' })
  if (!output_summary || typeof output_summary !== 'object')
    return res.status(400).json({ error: 'output_summary (object) is required' })

  try {
    const result = await tenantQuery(r.tenantId,
      `INSERT INTO calc_sessions
         (tenant_id, project_id, tool_name, tool_version, input_summary, output_summary, pid_svg, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id, tool_name, tool_version, created_at`,
      [r.tenantId, projectId, tool_name, tool_version ?? null,
       input_summary ? JSON.stringify(input_summary) : null,
       JSON.stringify(output_summary),
       pid_svg ?? null, notes ?? null, r.auth?.sub ?? null]
    )

    // Promote P&ID SVG to documents table (non-fatal if schema differs)
    if (pid_svg && typeof pid_svg === 'string') {
      const docName = `${tool_name.toUpperCase()} P&ID — ${new Date().toISOString().slice(0, 10)}`
      await tenantQuery(r.tenantId,
        `INSERT INTO documents (tenant_id, project_id, name, type, content, created_by)
         VALUES ($1,$2,$3,'pid',$4,$5) ON CONFLICT DO NOTHING`,
        [r.tenantId, projectId, docName, pid_svg, r.auth?.sub ?? null]
      ).catch(e => console.warn('[calc-sessions] documents insert skipped:', e.message))
    }

    res.status(201).json({ session: result.rows[0] })
  } catch (err) {
    console.error('[calc-sessions] create error', err)
    res.status(500).json({ error: 'Failed to save calculation session' })
  }
})

// ─── Fetch single session (includes pid_svg) ──────────────────────────────────
router.get('/calc-sessions/:id', requireCapability('engineering.view') as never, async (req: Request, res: Response) => {
  const r = req as AuthTenantRequest
  try {
    const result = await tenantQuery(r.tenantId,
      `SELECT cs.*, u.name AS created_by_name
       FROM calc_sessions cs LEFT JOIN users u ON u.id = cs.created_by
       WHERE cs.id = $1 AND cs.tenant_id = $2`,
      [req.params.id, r.tenantId]
    )
    if (!result.rows[0]) return res.status(404).json({ error: 'Session not found' })
    res.json({ session: result.rows[0] })
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch session' })
  }
})

// ─── Update notes ─────────────────────────────────────────────────────────────
router.patch('/calc-sessions/:id', requireCapability('engineering.write') as never, async (req: Request, res: Response) => {
  const r = req as AuthTenantRequest
  const { notes } = req.body
  if (typeof notes !== 'string') return res.status(400).json({ error: 'notes (string) required' })
  try {
    const result = await tenantQuery(r.tenantId,
      'UPDATE calc_sessions SET notes=$1 WHERE id=$2 AND tenant_id=$3 RETURNING id,notes',
      [notes, req.params.id, r.tenantId]
    )
    if (!result.rows[0]) return res.status(404).json({ error: 'Session not found' })
    res.json({ session: result.rows[0] })
  } catch (err) {
    res.status(500).json({ error: 'Failed to update session' })
  }
})

// ─── Delete session ───────────────────────────────────────────────────────────
router.delete('/calc-sessions/:id', requireCapability('engineering.write') as never, async (req: Request, res: Response) => {
  const r = req as AuthTenantRequest
  try {
    await tenantQuery(r.tenantId,
      'DELETE FROM calc_sessions WHERE id=$1 AND tenant_id=$2',
      [req.params.id, r.tenantId]
    )
    res.json({ deleted: true })
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete session' })
  }
})

export { router as calculationsRouter }
