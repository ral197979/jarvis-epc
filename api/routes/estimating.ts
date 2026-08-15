/**
 * Denver Engineering — Estimating Routes (v10.0.0)
 * ──────────────────────────────────────────────────
 * BIM element parsing, quantity takeoff, cost lookup, and estimate assembly.
 *
 * Endpoints:
 *   POST   /api/v1/bim-models/:modelId/parse-elements   — batch upsert IFC elements
 *   POST   /api/v1/bim-models/:modelId/parse-job        — queue async IFC parse job
 *   GET    /api/v1/bim-models/:modelId/parse-job        — parse job status
 *   GET    /api/v1/bim-models/:modelId/elements         — list elements (filtered)
 *   GET    /api/v1/bim-models/:modelId/elements/:id     — single element
 *   POST   /api/v1/bim-models/:modelId/elements/:id/link — link element → entity
 *   GET    /api/v1/bim-models/:modelId/quantity-summary  — aggregated quantities
 *   POST   /api/v1/bim-models/:modelId/takeoff           — create manual takeoff items
 *   POST   /api/v1/bim-models/:modelId/takeoff/auto      — auto-extract from BIM
 *   GET    /api/v1/bim-models/:modelId/takeoff           — list takeoff items
 *   GET    /api/v1/cost-items/search                     — search cost library
 *   POST   /api/v1/estimates                             — create estimate
 *   GET    /api/v1/estimates                             — list estimates
 *   GET    /api/v1/estimates/:id                         — estimate + lines
 *   POST   /api/v1/estimates/:id/lines                   — add lines
 *   POST   /api/v1/estimates/:id/approve                 — approve estimate
 *   POST   /api/v1/bim-models/:modelId/ava-estimate      — Ava full auto-estimate
 */
import { Router, type Request, type Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest } from '../middleware/tenant'
import {
  upsertBimElements,
  getModelElements,
  getElementById,
  linkElementToEntity,
  getElementLinks,
  enqueueIfcParseJob,
  getParseJobStatus,
  getModelQuantitySummary,
} from '../services/bim/bimElementService'
import {
  createTakeoffItems,
  getTakeoffItems,
  searchCostItems,
  createEstimate,
  addEstimateLines,
  getEstimate,
  listEstimates,
  autoTakeoffFromBim,
  type TakeoffInput,
  type EstimateLineDraft,
} from '../services/estimating/estimatingService'
import { runEstimatingAgent } from '../services/estimating/estimatingAgent'
import { tenantQuery } from '../db/pool'
import { requireCapability } from '../authz/requireCapability'

type R = Request & AuthenticatedRequest & TenantRequest
const router = Router()
router.use(requireAuth as never)
router.use(requireTenant() as never)

const sub = (req: Request) => (req as R).auth?.sub ?? 'system'
const tid = (req: Request) => (req as R).tenantId!
const qs  = (v: string | string[] | undefined): string | undefined =>
  Array.isArray(v) ? v[0] : v
const p   = (req: Request, key: string): string =>
  qs((req.params as Record<string, string | string[]>)[key]) ?? ''

// ─── BIM Element Ingestion ────────────────────────────────────────────────────

// POST /bim-models/:modelId/parse-elements
// Accepts a JSON array of IFC element objects (from IFC.js parser output)
router.post('/bim-models/:modelId/parse-elements', requireCapability('engineering.write') as never, async (req: Request, res: Response) => {
  const { elements } = req.body as { elements?: unknown[] }
  if (!Array.isArray(elements) || !elements.length) {
    res.status(400).json({ error: 'elements array required' }); return
  }
  try {
    const result = await upsertBimElements(tid(req), p(req, 'modelId'), elements as never)
    res.status(200).json({ data: result })
  } catch (e) {
    console.error('[estimating] parse-elements error', e)
    res.status(500).json({ error: 'Failed to upsert BIM elements' })
  }
})

// POST /bim-models/:modelId/parse-job
// Queues an async IFC parse job for server-side parsing (when file is in storage)
router.post('/bim-models/:modelId/parse-job', requireCapability('engineering.write') as never, async (req: Request, res: Response) => {
  const { storage_key } = req.body as { storage_key?: string }
  if (!storage_key) { res.status(400).json({ error: 'storage_key required' }); return }
  try {
    const jobId = await enqueueIfcParseJob(tid(req), p(req, 'modelId'), storage_key)
    res.status(201).json({ data: { job_id: jobId, status: 'pending' } })
  } catch (e) {
    res.status(500).json({ error: 'Failed to enqueue parse job' })
  }
})

// GET /bim-models/:modelId/parse-job
router.get('/bim-models/:modelId/parse-job', requireCapability('engineering.view') as never, async (req: Request, res: Response) => {
  try {
    const status = await getParseJobStatus(tid(req), p(req, 'modelId'))
    if (!status) { res.status(404).json({ error: 'No parse job found' }); return }
    res.json({ data: status })
  } catch (e) {
    res.status(500).json({ error: 'Failed to get parse job status' })
  }
})

// GET /bim-models/:modelId/elements
router.get('/bim-models/:modelId/elements', requireCapability('engineering.view') as never, async (req: Request, res: Response) => {
  const ifc_type   = qs(req.query['ifc_type'] as string | string[])
  const discipline = qs(req.query['discipline'] as string | string[])
  const level      = qs(req.query['level'] as string | string[])
  const limit      = qs(req.query['limit'] as string | string[])
  const offset     = qs(req.query['offset'] as string | string[])
  try {
    const result = await getModelElements(tid(req), p(req, 'modelId'), {
      ifc_type, discipline, level,
      limit:  limit  ? parseInt(limit)  : undefined,
      offset: offset ? parseInt(offset) : undefined,
    })
    res.json({ data: result })
  } catch (e) {
    res.status(500).json({ error: 'Failed to list BIM elements' })
  }
})

// GET /bim-models/:modelId/elements/:id
router.get('/bim-models/:modelId/elements/:id', requireCapability('engineering.view') as never, async (req: Request, res: Response) => {
  try {
    const el = await getElementById(tid(req), p(req, 'id'))
    if (!el) { res.status(404).json({ error: 'Element not found' }); return }
    const links = await getElementLinks(tid(req), p(req, 'id'))
    res.json({ data: { ...el, links } })
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch element' })
  }
})

// POST /bim-models/:modelId/elements/:id/link
router.post('/bim-models/:modelId/elements/:id/link', requireCapability('engineering.write') as never, async (req: Request, res: Response) => {
  const { entity_type, entity_id, context } = req.body as Record<string, string>
  if (!entity_type || !entity_id) {
    res.status(400).json({ error: 'entity_type and entity_id required' }); return
  }
  try {
    await linkElementToEntity(tid(req), p(req, 'id'), entity_type, entity_id, sub(req), context)
    res.status(201).json({ data: { linked: true } })
  } catch (e) {
    res.status(500).json({ error: 'Failed to link element' })
  }
})

// GET /bim-models/:modelId/quantity-summary
router.get('/bim-models/:modelId/quantity-summary', requireCapability('engineering.view') as never, async (req: Request, res: Response) => {
  try {
    const summary = await getModelQuantitySummary(tid(req), p(req, 'modelId'))
    res.json({ data: summary })
  } catch (e) {
    res.status(500).json({ error: 'Failed to get quantity summary' })
  }
})

// ─── Takeoff ──────────────────────────────────────────────────────────────────

// POST /bim-models/:modelId/takeoff
router.post('/bim-models/:modelId/takeoff', requireCapability('engineering.write') as never, async (req: Request, res: Response) => {
  const { items } = req.body as { items?: TakeoffInput[] }
  if (!Array.isArray(items) || !items.length) {
    res.status(400).json({ error: 'items array required' }); return
  }
  try {
    const ids = await createTakeoffItems(tid(req), p(req, 'modelId'), items, sub(req))
    res.status(201).json({ data: { ids, count: ids.length } })
  } catch (e) {
    res.status(500).json({ error: 'Failed to create takeoff items' })
  }
})

// POST /bim-models/:modelId/takeoff/auto
router.post('/bim-models/:modelId/takeoff/auto', requireCapability('engineering.write') as never, async (req: Request, res: Response) => {
  try {
    const result = await autoTakeoffFromBim(tid(req), p(req, 'modelId'), sub(req))
    res.json({ data: result })
  } catch (e) {
    console.error('[estimating] auto-takeoff error', e)
    res.status(500).json({ error: 'Failed to auto-extract takeoff' })
  }
})

// GET /bim-models/:modelId/takeoff
router.get('/bim-models/:modelId/takeoff', requireCapability('engineering.view') as never, async (req: Request, res: Response) => {
  try {
    const items = await getTakeoffItems(tid(req), p(req, 'modelId'))
    res.json({ data: items })
  } catch (e) {
    res.status(500).json({ error: 'Failed to list takeoff items' })
  }
})

// ─── Cost Library ─────────────────────────────────────────────────────────────

// GET /cost-items/search?q=concrete&region=NYC&limit=20
router.get('/cost-items/search', requireCapability('cost.view') as never, async (req: Request, res: Response) => {
  const q      = qs(req.query['q'] as string | string[])
  const region = qs(req.query['region'] as string | string[])
  const limit  = qs(req.query['limit'] as string | string[])
  if (!q) { res.status(400).json({ error: 'q (search query) required' }); return }
  try {
    const items = await searchCostItems(tid(req), q, region, limit ? parseInt(limit) : 20)
    res.json({ data: items })
  } catch (e) {
    res.status(500).json({ error: 'Failed to search cost items' })
  }
})

// ─── Estimates ────────────────────────────────────────────────────────────────

// POST /estimates
router.post('/estimates', requireCapability('engineering.write') as never, async (req: Request, res: Response) => {
  const b = req.body as Record<string, unknown>
  if (!b['name']) { res.status(400).json({ error: 'name required' }); return }
  try {
    const result = await createEstimate(tid(req), b as never, sub(req))
    res.status(201).json({ data: result })
  } catch (e) {
    res.status(500).json({ error: 'Failed to create estimate' })
  }
})

// GET /estimates?project_id=...
router.get('/estimates', requireCapability('cost.view') as never, async (req: Request, res: Response) => {
  const project_id = qs(req.query['project_id'] as string | string[])
  try {
    const estimates = await listEstimates(tid(req), project_id)
    res.json({ data: estimates })
  } catch (e) {
    res.status(500).json({ error: 'Failed to list estimates' })
  }
})

// GET /estimates/:id
router.get('/estimates/:id', requireCapability('cost.view') as never, async (req: Request, res: Response) => {
  try {
    const result = await getEstimate(tid(req), p(req, 'id'))
    if (!result) { res.status(404).json({ error: 'Estimate not found' }); return }
    res.json({ data: result })
  } catch (e) {
    res.status(500).json({ error: 'Failed to get estimate' })
  }
})

// POST /estimates/:id/lines
router.post('/estimates/:id/lines', requireCapability('engineering.write') as never, async (req: Request, res: Response) => {
  const { lines } = req.body as { lines?: EstimateLineDraft[] }
  if (!Array.isArray(lines) || !lines.length) {
    res.status(400).json({ error: 'lines array required' }); return
  }
  try {
    await addEstimateLines(tid(req), p(req, 'id'), lines)
    const result = await getEstimate(tid(req), p(req, 'id'))
    res.json({ data: result })
  } catch (e) {
    res.status(500).json({ error: 'Failed to add estimate lines' })
  }
})

// POST /estimates/:id/approve
router.post('/estimates/:id/approve', requireCapability('cost.approve') as never, async (req: Request, res: Response) => {
  try {
    await tenantQuery(tid(req),
      `UPDATE estimates SET status='approved', approved_by=$1, approved_at=now(), updated_at=now()
       WHERE id=$2 AND tenant_id=$3`,
      [sub(req), p(req, 'id'), tid(req)])
    res.json({ data: { approved: true } })
  } catch (e) {
    res.status(500).json({ error: 'Failed to approve estimate' })
  }
})

// ─── Ava Auto-Estimate ────────────────────────────────────────────────────────

// POST /bim-models/:modelId/ava-estimate
// Full pipeline: BIM elements → takeoff → cost lookup → estimate + AI summary
router.post('/bim-models/:modelId/ava-estimate', requireCapability('engineering.write') as never, async (req: Request, res: Response) => {
  const b = req.body as { project_id?: string; region?: string; name?: string }
  try {
    const result = await runEstimatingAgent({
      tenantId:  tid(req),
      modelId:   p(req, 'modelId'),
      projectId: b.project_id,
      region:    b.region,
      name:      b.name,
      createdBy: sub(req),
    })
    res.status(201).json({ data: result })
  } catch (e) {
    console.error('[estimating] ava-estimate error', e)
    res.status(500).json({ error: 'Failed to run Ava estimating agent' })
  }
})

export { router as estimatingRouter }
