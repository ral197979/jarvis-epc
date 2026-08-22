/**
 * Denver Engineering — Timesheet Routes (v10.16.0)
 *
 * PUT  /api/v1/projects/:projectId/timesheets          — upsert week
 * GET  /api/v1/projects/:projectId/timesheets          — list (week, status filters)
 * GET  /api/v1/projects/:projectId/timesheets/summary  — weekly totals (8 weeks)
 * GET  /api/v1/team/members/:memberId/timesheets       — list by member
 * POST /api/v1/timesheets/:id/submit
 * POST /api/v1/timesheets/:id/approve
 * POST /api/v1/timesheets/:id/reject
 */
import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest }       from '../middleware/tenant'
import { requireCapability } from '../authz/requireCapability'
import { requireProjectScope, requireRecordScope } from '../authz/recordScope'
import {
  upsertTimesheet, listTimesheets, submitTimesheet,
  approveTimesheet, rejectTimesheet, getWeeklySummary,
  type TimesheetStatus,
} from '../services/timesheets/timesheetService'

type R = Request & AuthenticatedRequest & TenantRequest
const p = (req: Request, key: string) => {
  const v = (req.params as Record<string, string | string[]>)[key]
  return Array.isArray(v) ? v[0] : (v ?? '')
}
const q = (req: Request, key: string) => {
  const v = (req.query as Record<string, string | string[]>)[key]
  return Array.isArray(v) ? v[0] : v
}

export const timesheetsRouter = Router()
timesheetsRouter.use(requireAuth     as never)
timesheetsRouter.use(requireTenant() as never)

timesheetsRouter.put('/projects/:projectId/timesheets', requireCapability('team.write') as never, requireProjectScope() as never, async (req: Request, res: Response) => {
  const r = req as R
  const { memberId, weekStart } = req.body as Record<string, unknown>
  if (!memberId || !weekStart) { res.status(400).json({ error: 'memberId and weekStart required' }); return }
  try {
    const ts = await upsertTimesheet(r.tenantId!, { projectId: p(req, 'projectId'), ...req.body })
    res.json({ timesheet: ts })
  } catch (e) { res.status(500).json({ error: 'Failed to save timesheet' }) }
})

timesheetsRouter.get('/projects/:projectId/timesheets', requireCapability('team.view') as never, async (req: Request, res: Response) => {
  const r = req as R
  try {
    const timesheets = await listTimesheets(r.tenantId!, {
      projectId: p(req, 'projectId'),
      weekStart: q(req, 'week')   as string | undefined,
      status:    q(req, 'status') as TimesheetStatus | undefined,
    })
    res.json({ timesheets })
  } catch (e) { res.status(500).json({ error: 'Failed to list timesheets' }) }
})

timesheetsRouter.get('/projects/:projectId/timesheets/summary', requireCapability('team.view') as never, async (req: Request, res: Response) => {
  const r = req as R
  try {
    const weeks = await getWeeklySummary(r.tenantId!, p(req, 'projectId'))
    res.json({ weeks })
  } catch (e) { res.status(500).json({ error: 'Failed to get summary' }) }
})

timesheetsRouter.get('/team/members/:memberId/timesheets', requireCapability('team.view') as never, async (req: Request, res: Response) => {
  const r = req as R
  try {
    const timesheets = await listTimesheets(r.tenantId!, { memberId: p(req, 'memberId') })
    res.json({ timesheets })
  } catch (e) { res.status(500).json({ error: 'Failed to list timesheets' }) }
})

timesheetsRouter.post('/timesheets/:id/submit', requireCapability('team.write') as never, requireRecordScope('timesheets') as never, async (req: Request, res: Response) => {
  const r = req as R
  try {
    const ts = await submitTimesheet(r.tenantId!, p(req, 'id'))
    if (!ts) { res.status(404).json({ error: 'Timesheet not found or not draft' }); return }
    res.json({ timesheet: ts })
  } catch (e) { res.status(500).json({ error: 'Failed to submit' }) }
})

timesheetsRouter.post('/timesheets/:id/approve', requireCapability('team.approve') as never, requireRecordScope('timesheets') as never, async (req: Request, res: Response) => {
  const r = req as R
  try {
    const ts = await approveTimesheet(r.tenantId!, p(req, 'id'), r.auth?.sub ?? 'unknown')
    if (!ts) { res.status(404).json({ error: 'Timesheet not found or not submitted' }); return }
    res.json({ timesheet: ts })
  } catch (e) { res.status(500).json({ error: 'Failed to approve' }) }
})

timesheetsRouter.post('/timesheets/:id/reject', requireCapability('team.approve') as never, requireRecordScope('timesheets') as never, async (req: Request, res: Response) => {
  const r = req as R
  try {
    const ts = await rejectTimesheet(r.tenantId!, p(req, 'id'))
    if (!ts) { res.status(404).json({ error: 'Timesheet not found or not submitted' }); return }
    res.json({ timesheet: ts })
  } catch (e) { res.status(500).json({ error: 'Failed to reject' }) }
})
