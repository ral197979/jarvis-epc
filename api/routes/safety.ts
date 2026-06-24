/**
 * Denver Engineering — Safety API (v4.53.0)
 * ─────────────────────────────────────────────────────────────────────────────
 *   GET   /api/v1/projects/:projectId/safety/observations
 *   POST  /api/v1/projects/:projectId/safety/observations
 *   PATCH /api/v1/safety/observations/:id            (status)
 *   GET   /api/v1/projects/:projectId/safety/incidents
 *   POST  /api/v1/projects/:projectId/safety/incidents
 *   PATCH /api/v1/safety/incidents/:id               (status)
 *   GET   /api/v1/projects/:projectId/safety/intelligence
 */
import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest } from '../middleware/tenant'
import {
  listObservations, createObservation, updateObservationStatus,
  listIncidents, createIncident, updateIncidentStatus, buildSafetyIntelligence,
} from '../services/safety/safetyService'

type AuthTenantReq = Request & AuthenticatedRequest & TenantRequest
const router = Router()
router.use(requireAuth as never)
router.use(requireTenant() as never)

const OBS_STATUS = new Set(['open', 'actioned', 'closed'])
const INC_STATUS = new Set(['reported', 'investigating', 'corrective', 'closed'])

// ─── Observations ─────────────────────────────────────────────────────────────

router.get('/projects/:projectId/safety/observations', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  try { res.json({ data: await listObservations(r.tenantId!, String(req.params.projectId)) }) }
  catch (err) { res.status(500).json({ error: 'Failed to list observations', detail: (err as Error).message }) }
})

router.post('/projects/:projectId/safety/observations', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const b = req.body as { description?: string }
  if (!b.description || !String(b.description).trim()) return res.status(400).json({ error: 'description is required' })
  try {
    const row = await createObservation(r.tenantId!, String(req.params.projectId), req.body, r.auth?.sub ?? null)
    res.status(201).json({ data: row })
  } catch (err) { res.status(500).json({ error: 'Failed to create observation', detail: (err as Error).message }) }
})

router.patch('/safety/observations/:id', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const status = (req.body as { status?: string }).status
  if (!status || !OBS_STATUS.has(status)) return res.status(400).json({ error: `status must be one of ${[...OBS_STATUS].join(', ')}` })
  try {
    const row = await updateObservationStatus(r.tenantId!, String(req.params.id), status)
    if (!row) return res.status(404).json({ error: 'Observation not found' })
    res.json({ data: row })
  } catch (err) { res.status(500).json({ error: 'Failed to update observation', detail: (err as Error).message }) }
})

// ─── Incidents ────────────────────────────────────────────────────────────────

router.get('/projects/:projectId/safety/incidents', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  try { res.json({ data: await listIncidents(r.tenantId!, String(req.params.projectId)) }) }
  catch (err) { res.status(500).json({ error: 'Failed to list incidents', detail: (err as Error).message }) }
})

router.post('/projects/:projectId/safety/incidents', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const b = req.body as { description?: string }
  if (!b.description || !String(b.description).trim()) return res.status(400).json({ error: 'description is required' })
  try {
    const row = await createIncident(r.tenantId!, String(req.params.projectId), req.body, r.auth?.sub ?? null)
    res.status(201).json({ data: row })
  } catch (err) { res.status(500).json({ error: 'Failed to create incident', detail: (err as Error).message }) }
})

router.patch('/safety/incidents/:id', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const status = (req.body as { status?: string }).status
  if (!status || !INC_STATUS.has(status)) return res.status(400).json({ error: `status must be one of ${[...INC_STATUS].join(', ')}` })
  try {
    const row = await updateIncidentStatus(r.tenantId!, String(req.params.id), status)
    if (!row) return res.status(404).json({ error: 'Incident not found' })
    res.json({ data: row })
  } catch (err) { res.status(500).json({ error: 'Failed to update incident', detail: (err as Error).message }) }
})

// ─── Predictive intelligence ──────────────────────────────────────────────────

router.get('/projects/:projectId/safety/intelligence', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  try {
    const result = await buildSafetyIntelligence(r.tenantId!, String(req.params.projectId), new Date())
    if (!result) return res.status(404).json({ error: 'Project not found' })
    res.json({ data: result })
  } catch (err) { res.status(500).json({ error: 'Failed to build safety intelligence', detail: (err as Error).message }) }
})

export const safetyRouter = router
