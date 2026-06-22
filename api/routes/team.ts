/**
 * Denver Engineering — Team & Workforce API Routes (v10.13.0)
 *
 * GET  /api/v1/team/summary
 * POST /api/v1/team/members
 * GET  /api/v1/team/members
 * GET  /api/v1/team/members/:id
 * PATCH /api/v1/team/members/:id
 *
 * GET  /api/v1/team/members/:id/assignments
 * POST /api/v1/team/assignments
 * GET  /api/v1/projects/:projectId/team
 * POST /api/v1/team/assignments/:id/end
 */
import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest } from '../middleware/tenant'
import { createMember, listMembers, getMember, updateMember, createAssignment, listAssignmentsByMember, listAssignmentsByProject, endAssignment, getTeamSummary, type MemberStatus } from '../services/team/teamService'

type R = Request & AuthenticatedRequest & TenantRequest
const p = (req: Request, key: string) => {
  const v = (req.params as Record<string, string | string[]>)[key]
  return Array.isArray(v) ? v[0] : (v ?? '')
}
const q = (req: Request, key: string) => {
  const v = (req.query as Record<string, string | string[]>)[key]
  return Array.isArray(v) ? v[0] : v
}

export const teamRouter = Router()
teamRouter.use(requireAuth     as never)
teamRouter.use(requireTenant() as never)

teamRouter.get('/team/summary', async (req: Request, res: Response) => {
  const r = req as R
  try { res.json({ summary: await getTeamSummary(r.tenantId!) }) }
  catch (e) { res.status(500).json({ error: 'Failed to load team summary' }) }
})

teamRouter.post('/team/members', async (req: Request, res: Response) => {
  const r = req as R
  const { firstName, lastName, role } = req.body as Record<string, unknown>
  if (!firstName || !lastName || !role) {
    res.status(400).json({ error: 'firstName, lastName, and role are required' }); return
  }
  try { res.status(201).json({ member: await createMember(r.tenantId!, req.body) }) }
  catch (e) { res.status(500).json({ error: 'Failed to create member' }) }
})

teamRouter.get('/team/members', async (req: Request, res: Response) => {
  const r = req as R
  try {
    const members = await listMembers(r.tenantId!, {
      status: q(req, 'status') as MemberStatus | undefined,
      search: q(req, 'q')     as string | undefined,
    })
    res.json({ members })
  } catch (e) { res.status(500).json({ error: 'Failed to list members' }) }
})

teamRouter.get('/team/members/:id', async (req: Request, res: Response) => {
  const r = req as R
  try {
    const member = await getMember(r.tenantId!, p(req, 'id'))
    if (!member) { res.status(404).json({ error: 'Member not found' }); return }
    res.json({ member })
  } catch (e) { res.status(500).json({ error: 'Failed to get member' }) }
})

teamRouter.patch('/team/members/:id', async (req: Request, res: Response) => {
  const r = req as R
  try {
    const member = await updateMember(r.tenantId!, p(req, 'id'), req.body)
    if (!member) { res.status(404).json({ error: 'Member not found' }); return }
    res.json({ member })
  } catch (e) { res.status(500).json({ error: 'Failed to update member' }) }
})

teamRouter.get('/team/members/:id/assignments', async (req: Request, res: Response) => {
  const r = req as R
  try { res.json({ assignments: await listAssignmentsByMember(r.tenantId!, p(req, 'id')) }) }
  catch (e) { res.status(500).json({ error: 'Failed to list assignments' }) }
})

teamRouter.post('/team/assignments', async (req: Request, res: Response) => {
  const r = req as R
  const { memberId, projectId, assignmentRole, startDate } = req.body as Record<string, unknown>
  if (!memberId || !projectId || !assignmentRole || !startDate) {
    res.status(400).json({ error: 'memberId, projectId, assignmentRole, startDate are required' }); return
  }
  try { res.status(201).json({ assignment: await createAssignment(r.tenantId!, req.body) }) }
  catch (e) { res.status(500).json({ error: 'Failed to create assignment' }) }
})

teamRouter.get('/projects/:projectId/team', async (req: Request, res: Response) => {
  const r = req as R
  try { res.json({ assignments: await listAssignmentsByProject(r.tenantId!, p(req, 'projectId')) }) }
  catch (e) { res.status(500).json({ error: 'Failed to list project team' }) }
})

teamRouter.post('/team/assignments/:id/end', async (req: Request, res: Response) => {
  const r = req as R
  try {
    const ok = await endAssignment(r.tenantId!, p(req, 'id'))
    if (!ok) { res.status(404).json({ error: 'Assignment not found or already ended' }); return }
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: 'Failed to end assignment' }) }
})
