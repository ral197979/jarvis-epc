/**
 * Denver Engineering — Meeting Minutes API Routes (v10.9.0)
 *
 * POST   /api/v1/projects/:projectId/meetings              — create meeting
 * GET    /api/v1/projects/:projectId/meetings              — list meetings
 * GET    /api/v1/meetings/:id                              — get detail
 * PATCH  /api/v1/meetings/:id                              — update (draft only)
 * POST   /api/v1/meetings/:id/publish                      — draft → published
 * POST   /api/v1/meetings/:id/archive                      — published → archived
 *
 * GET    /api/v1/meetings/:id/agenda                       — list agenda items
 * POST   /api/v1/meetings/:id/agenda                       — add agenda item
 * PATCH  /api/v1/meetings/:id/agenda/:itemId               — update agenda item
 * DELETE /api/v1/meetings/:id/agenda/:itemId               — remove agenda item
 *
 * GET    /api/v1/meetings/:id/actions                      — list action items
 * POST   /api/v1/meetings/:id/actions                      — create action item
 */
import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest }       from '../middleware/tenant'
import { requireCapability } from '../authz/requireCapability'
import { requireProjectScope, requireRecordScope } from '../authz/recordScope'
import {
  createMeeting, getMeeting, listMeetings, updateMeeting, publishMeeting, archiveMeeting,
  listAgendaItems, addAgendaItem, updateAgendaItem, deleteAgendaItem,
  createMeetingAction, listMeetingActions,
  type MeetingType, type MeetingStatus,
} from '../services/meetings/meetingService'

type R = Request & AuthenticatedRequest & TenantRequest
const p = (req: Request, key: string) => {
  const v = (req.params as Record<string, string | string[]>)[key]
  return Array.isArray(v) ? v[0] : (v ?? '')
}
const q = (req: Request, key: string) => {
  const v = (req.query as Record<string, string | string[]>)[key]
  return Array.isArray(v) ? v[0] : v
}

export const meetingsRouter = Router()
meetingsRouter.use(requireAuth    as never)
meetingsRouter.use(requireTenant() as never)

// ─── Meetings ─────────────────────────────────────────────────────────────────

meetingsRouter.post('/projects/:projectId/meetings', requireCapability('project.write') as never, requireProjectScope() as never, async (req: Request, res: Response) => {
  const r = req as R
  const { title, meetingDate } = req.body as Record<string, unknown>
  if (!title || !meetingDate) { res.status(400).json({ error: 'title and meetingDate are required' }); return }
  try {
    const meeting = await createMeeting(r.tenantId!, {
      projectId: p(req, 'projectId'),
      createdBy: r.auth?.sub,
      ...req.body,
    })
    res.status(201).json({ meeting })
  } catch (e) { res.status(500).json({ error: 'Failed to create meeting' }) }
})

meetingsRouter.get('/projects/:projectId/meetings', requireCapability('project.view') as never, async (req: Request, res: Response) => {
  const r = req as R
  try {
    const meetings = await listMeetings(r.tenantId!, p(req, 'projectId'), {
      meetingType: q(req, 'type')   as MeetingType | undefined,
      status:      q(req, 'status') as MeetingStatus | undefined,
      limit:       q(req, 'limit')  ? Number(q(req, 'limit')) : undefined,
    })
    res.json({ meetings })
  } catch (e) { res.status(500).json({ error: 'Failed to list meetings' }) }
})

meetingsRouter.get('/meetings/:id', requireCapability('project.view') as never, async (req: Request, res: Response) => {
  const r = req as R
  try {
    const meeting = await getMeeting(r.tenantId!, p(req, 'id'))
    if (!meeting) { res.status(404).json({ error: 'Meeting not found' }); return }
    res.json({ meeting })
  } catch (e) { res.status(500).json({ error: 'Failed to get meeting' }) }
})

meetingsRouter.patch('/meetings/:id', requireCapability('project.write') as never, requireRecordScope('meetings') as never, async (req: Request, res: Response) => {
  const r = req as R
  try {
    const meeting = await updateMeeting(r.tenantId!, p(req, 'id'), req.body)
    if (!meeting) { res.status(404).json({ error: 'Meeting not found or not in draft status' }); return }
    res.json({ meeting })
  } catch (e) { res.status(500).json({ error: 'Failed to update meeting' }) }
})

meetingsRouter.post('/meetings/:id/publish', requireCapability('docs.publish') as never, requireRecordScope('meetings') as never, async (req: Request, res: Response) => {
  const r = req as R
  try {
    const meeting = await publishMeeting(r.tenantId!, p(req, 'id'))
    if (!meeting) { res.status(404).json({ error: 'Meeting not found or not in draft status' }); return }
    res.json({ meeting })
  } catch (e) { res.status(500).json({ error: 'Failed to publish meeting' }) }
})

meetingsRouter.post('/meetings/:id/archive', requireCapability('docs.publish') as never, requireRecordScope('meetings') as never, async (req: Request, res: Response) => {
  const r = req as R
  try {
    const meeting = await archiveMeeting(r.tenantId!, p(req, 'id'))
    if (!meeting) { res.status(404).json({ error: 'Meeting not found or not published' }); return }
    res.json({ meeting })
  } catch (e) { res.status(500).json({ error: 'Failed to archive meeting' }) }
})

// ─── Agenda items ─────────────────────────────────────────────────────────────

meetingsRouter.get('/meetings/:id/agenda', requireCapability('project.view') as never, async (req: Request, res: Response) => {
  const r = req as R
  try {
    const items = await listAgendaItems(r.tenantId!, p(req, 'id'))
    res.json({ agendaItems: items })
  } catch (e) { res.status(500).json({ error: 'Failed to list agenda items' }) }
})

meetingsRouter.post('/meetings/:id/agenda', requireCapability('project.write') as never, requireRecordScope('meetings') as never, async (req: Request, res: Response) => {
  const r = req as R
  const { topic } = req.body as Record<string, unknown>
  if (!topic) { res.status(400).json({ error: 'topic is required' }); return }
  try {
    const item = await addAgendaItem(r.tenantId!, p(req, 'id'), req.body)
    res.status(201).json({ agendaItem: item })
  } catch (e) { res.status(500).json({ error: 'Failed to add agenda item' }) }
})

meetingsRouter.patch('/meetings/:id/agenda/:itemId', requireCapability('project.write') as never, requireRecordScope('meetings') as never, async (req: Request, res: Response) => {
  const r = req as R
  try {
    const item = await updateAgendaItem(r.tenantId!, p(req, 'itemId'), req.body)
    if (!item) { res.status(404).json({ error: 'Agenda item not found' }); return }
    res.json({ agendaItem: item })
  } catch (e) { res.status(500).json({ error: 'Failed to update agenda item' }) }
})

meetingsRouter.delete('/meetings/:id/agenda/:itemId', requireCapability('project.write') as never, requireRecordScope('meetings') as never, async (req: Request, res: Response) => {
  const r = req as R
  try {
    await deleteAgendaItem(r.tenantId!, p(req, 'itemId'))
    res.status(204).end()
  } catch (e) { res.status(500).json({ error: 'Failed to delete agenda item' }) }
})

// ─── Action items ─────────────────────────────────────────────────────────────

meetingsRouter.get('/meetings/:id/actions', requireCapability('project.view') as never, async (req: Request, res: Response) => {
  const r = req as R
  try {
    const actions = await listMeetingActions(r.tenantId!, p(req, 'id'))
    res.json({ actions })
  } catch (e) { res.status(500).json({ error: 'Failed to list action items' }) }
})

meetingsRouter.post('/meetings/:id/actions', requireCapability('project.write') as never, requireRecordScope('meetings') as never, async (req: Request, res: Response) => {
  const r = req as R
  const { title, projectId } = req.body as Record<string, unknown>
  if (!title || !projectId) { res.status(400).json({ error: 'title and projectId are required' }); return }
  try {
    const action = await createMeetingAction(
      r.tenantId!, p(req, 'id'), String(projectId),
      { createdBy: r.auth?.sub, ...req.body },
    )
    res.status(201).json({ action })
  } catch (e) { res.status(500).json({ error: 'Failed to create action item' }) }
})
