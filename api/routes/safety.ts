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
 *   PATCH /api/v1/safety/incidents/:id/recordable    (OSHA classification)
 *   GET   /api/v1/projects/:projectId/safety/exposure-hours
 *   POST  /api/v1/projects/:projectId/safety/exposure-hours
 *   GET   /api/v1/safety/exposure-hours              (tenant-wide)
 *   POST  /api/v1/safety/exposure-hours              (tenant-wide)
 *   GET   /api/v1/projects/:projectId/safety/trir
 *   GET   /api/v1/safety/trir                        (tenant-wide)
 */
import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest } from '../middleware/tenant'
import {
  listObservations, createObservation, updateObservationStatus,
  listIncidents, createIncident, updateIncidentStatus, buildSafetyIntelligence,
} from '../services/safety/safetyService'
import {
  computeTrir, listExposureHours, recordExposureHours, classifyIncidentRecordable,
} from '../services/safety/trirService'

import { requireCapability } from '../authz/requireCapability'
import { requireProjectScope, requireRecordScope, resolveProjectScope } from '../authz/recordScope'
import { resolveCurrentUser } from '../authz/currentUser'
type AuthTenantReq = Request & AuthenticatedRequest & TenantRequest
const router = Router()
router.use(requireAuth as never)
router.use(requireTenant() as never)

const OBS_STATUS = new Set(['open', 'actioned', 'closed'])
const INC_STATUS = new Set(['reported', 'investigating', 'corrective', 'closed'])

// ─── Observations ─────────────────────────────────────────────────────────────

router.get('/projects/:projectId/safety/observations', requireCapability('safety.view') as never, requireProjectScope() as never, async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  try { res.json({ data: await listObservations(r.tenantId!, String(req.params.projectId)) }) }
  catch (err) { res.status(500).json({ error: 'Failed to list observations', detail: (err as Error).message }) }
})

router.post('/projects/:projectId/safety/observations', requireCapability('safety.write') as never, requireProjectScope() as never, async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const b = req.body as { description?: string }
  if (!b.description || !String(b.description).trim()) return res.status(400).json({ error: 'description is required' })
  try {
    const row = await createObservation(r.tenantId!, String(req.params.projectId), req.body, r.auth?.sub ?? null)
    res.status(201).json({ data: row })
  } catch (err) { res.status(500).json({ error: 'Failed to create observation', detail: (err as Error).message }) }
})

router.patch('/safety/observations/:id', requireCapability('safety.write') as never, requireRecordScope('safety_observations') as never, async (req: Request, res: Response) => {
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

router.get('/projects/:projectId/safety/incidents', requireCapability('safety.view') as never, requireProjectScope() as never, async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  try { res.json({ data: await listIncidents(r.tenantId!, String(req.params.projectId)) }) }
  catch (err) { res.status(500).json({ error: 'Failed to list incidents', detail: (err as Error).message }) }
})

router.post('/projects/:projectId/safety/incidents', requireCapability('safety.write') as never, requireProjectScope() as never, async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const b = req.body as { description?: string }
  if (!b.description || !String(b.description).trim()) return res.status(400).json({ error: 'description is required' })
  try {
    const row = await createIncident(r.tenantId!, String(req.params.projectId), req.body, r.auth?.sub ?? null)
    res.status(201).json({ data: row })
  } catch (err) { res.status(500).json({ error: 'Failed to create incident', detail: (err as Error).message }) }
})

router.patch('/safety/incidents/:id', requireCapability('safety.write') as never, requireRecordScope('safety_incidents') as never, async (req: Request, res: Response) => {
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

router.get('/projects/:projectId/safety/intelligence', requireCapability('safety.view') as never, requireProjectScope() as never, async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  try {
    const result = await buildSafetyIntelligence(r.tenantId!, String(req.params.projectId), new Date())
    if (!result) return res.status(404).json({ error: 'Project not found' })
    res.json({ data: result })
  } catch (err) { res.status(500).json({ error: 'Failed to build safety intelligence', detail: (err as Error).message }) }
})

export const safetyRouter = router

// ═══════════════════════════════════════════════════════════════════════════════
// TRIR — recordability, exposure hours, and the rate itself
// ═══════════════════════════════════════════════════════════════════════════════
//
// The dashboard used to compute TRIR from a column that did not exist over a
// denominator that was invented. These routes are the only supported source of
// the rate, and the service behind them refuses rather than estimates.

// ─── Recordability classification ────────────────────────────────────────────
//
// `safety.write` rather than `safety.approve`. Recordability is determined by
// whoever runs safety on site, and `safety.approve` is Owner-only in this
// registry — gating it there would leave incidents unclassified, which is the
// state that blocks the metric entirely. Auditability comes from the stored
// determiner and timestamp, not from narrowing the capability.

router.patch('/safety/incidents/:id/recordable', requireCapability('safety.write') as never, requireRecordScope('safety_incidents') as never, async (req: Request, res: Response) => {
    const r = req as AuthTenantReq
    const b = req.body as { recordable?: unknown; basis?: unknown }

    // Explicit boolean only. No coercion: `"false"`, `0` and `null` are all
    // rejected rather than guessed at, because a wrong determination here is a
    // regulatory misstatement and an absent one is a legitimate state.
    if (typeof b.recordable !== 'boolean') {
      return res.status(400).json({ error: 'recordable must be true or false' })
    }
    try {
      const row = await classifyIncidentRecordable(
        r.tenantId!, String(req.params.id), b.recordable,
        typeof b.basis === 'string' ? b.basis : null, r.auth?.sub ?? null,
      )
      if (!row) return res.status(404).json({ error: 'Incident not found' })
      res.json({ data: row })
    } catch (err) {
      res.status(500).json({ error: 'Failed to classify incident', detail: (err as Error).message })
    }
})

// ─── Exposure hours ──────────────────────────────────────────────────────────

async function readExposure(req: Request, res: Response, projectId: string | null): Promise<void> {
  const r = req as AuthTenantReq
  try {
    res.json({ data: await listExposureHours(r.tenantId!, projectId) })
  } catch (err) {
    res.status(500).json({ error: 'Failed to list exposure hours', detail: (err as Error).message })
  }
}

async function writeExposure(req: Request, res: Response, projectId: string | null): Promise<void> {
  const r = req as AuthTenantReq
  const b = req.body as Record<string, unknown>
  try {
    const out = await recordExposureHours(r.tenantId!, {
      projectId,
      periodStart: String(b.period_start ?? ''),
      periodEnd:   String(b.period_end ?? ''),
      hours:       Number(b.hours),
      source:      String(b.source ?? ''),
      sourceReference: b.source_reference == null ? null : String(b.source_reference),
      note:            b.note == null ? null : String(b.note),
    }, r.auth?.sub ?? null)

    if (out.error === 'overlapping_period') {
      // 409, not 400: the request is well-formed, it collides with a record
      // that already exists. Merging them would double-count the hours.
      res.status(409).json({ error: out.error, conflictsWith: out.conflictsWith })
      return
    }
    if (out.error) { res.status(400).json({ error: out.error }); return }
    res.status(201).json({ data: out.record })
  } catch (err) {
    res.status(500).json({ error: 'Failed to record exposure hours', detail: (err as Error).message })
  }
}

// Written as full handlers rather than one-line delegations on purpose. The
// ADR-014 census parses a route body from its registration to the next
// line-initial `})`; a concise arrow form produces none, and the route silently
// drops out of the audit with its guards unseen. House style keeps it visible.

router.get('/projects/:projectId/safety/exposure-hours', requireCapability('safety.view') as never, requireProjectScope() as never, async (req: Request, res: Response) => {
    await readExposure(req, res, String(req.params.projectId))
})

router.post('/projects/:projectId/safety/exposure-hours', requireCapability('safety.write') as never, requireProjectScope() as never, async (req: Request, res: Response) => {
    await writeExposure(req, res, String(req.params.projectId))
})

// Tenant-wide exposure. There is no project in the path to scope against, and a
// tenant-wide figure is the denominator of the published compliance metric, so
// writing one is held at approve level while reading it is not.
router.get('/safety/exposure-hours', requireCapability('safety.view') as never, async (req: Request, res: Response) => {
    await readExposure(req, res, null)
})

router.post('/safety/exposure-hours', requireCapability('safety.approve') as never, async (req: Request, res: Response) => {
    await writeExposure(req, res, null)
})

// ─── The rate ────────────────────────────────────────────────────────────────

router.get('/projects/:projectId/safety/trir', requireCapability('safety.view') as never, requireProjectScope() as never, async (req: Request, res: Response) => {
    const r = req as AuthTenantReq
    const q = req.query as Record<string, string>
    try {
      res.json({ data: await computeTrir(r.tenantId!, {
        projectId:   String(req.params.projectId),
        periodStart: String(q.period_start ?? ''),
        periodEnd:   String(q.period_end ?? ''),
      }) })
    } catch (err) {
      res.status(500).json({ error: 'Failed to compute TRIR', detail: (err as Error).message })
    }
})


/**
 * Tenant-wide TRIR — what the executive dashboard reads.
 *
 * The numerator is restricted to projects the caller can actually reach, using
 * the same resolver every other ADR-014 collection uses. A caller with no
 * project membership gets an empty set, NOT the whole tenant: passing `null`
 * would mean "unrestricted", so the two cases are distinguished explicitly here
 * rather than left to a falsy check.
 */
router.get('/safety/trir', requireCapability('safety.view') as never, async (req: Request, res: Response) => {
    const r = req as AuthTenantReq
    const q = req.query as Record<string, string>
    try {
      const principal = await resolveCurrentUser(req as never)
      if (!principal) return res.status(401).json({ error: 'unauthenticated' })

      const scope = await resolveProjectScope(principal)
      const visibleProjectIds = scope.kind === 'ALL_IN_TENANT' ? null : [...scope.projectIds]

      res.json({ data: await computeTrir(r.tenantId!, {
        projectId: null,
        periodStart: String(q.period_start ?? ''),
        periodEnd:   String(q.period_end ?? ''),
        visibleProjectIds,
      }) })
    } catch (err) {
      res.status(500).json({ error: 'Failed to compute TRIR', detail: (err as Error).message })
    }
})
