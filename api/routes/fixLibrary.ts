/**
 * Denver Engineering — Fix Library Routes (v4.31.0)
 *
 *   GET    /api/v1/knowledge-fixes                 — paginated list + filters
 *   POST   /api/v1/knowledge-fixes                 — create
 *   POST   /api/v1/knowledge-fixes/search          — structured search
 *   GET    /api/v1/knowledge-fixes/:id             — detail
 *   PATCH  /api/v1/knowledge-fixes/:id             — edit narrative/tags
 *   POST   /api/v1/knowledge-fixes/:id/verify      — promote confidence
 *   DELETE /api/v1/knowledge-fixes/:id             — admin
 *   GET    /api/v1/knowledge-fixes/_meta/symptoms  — distinct symptoms for autocomplete
 */

import { Router, Response } from 'express'
import { tenantQuery } from '../db/pool'
import { requireAuth, AuthenticatedRequest } from '../auth'
import { requireTenant, TenantRequest } from '../middleware/tenant'
import { requireCapability } from '../authz/requireCapability'
import { requireRecordScope } from '../authz/recordScope'
import {
  createFix, searchFixes, getFix, deleteFix, verifyFix, listUsedSymptoms,
  type FixConfidence,
} from '../services/fixLibrary'

type Req = AuthenticatedRequest & TenantRequest

const router = Router()
router.use(requireAuth as never)
router.use(requireTenant() as never)


function _pagination(q: Record<string, unknown>) {
  const page  = Math.max(1, parseInt(String(q['page']  ?? '1'), 10))
  const limit = Math.min(200, Math.max(1, parseInt(String(q['limit'] ?? '25'), 10)))
  return { page, limit, offset: (page - 1) * limit }
}

// ─── GET symptoms meta (mount before /:id so it doesn't collide) ──────────────

router.get('/_meta/symptoms', requireCapability('engineering.view') as never, async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }
  const symptoms = await listUsedSymptoms(tenantId)
  res.json({ data: symptoms })
})

// ─── Search (POST so we can accept structured arrays without URL ugliness) ────

router.post('/search', requireCapability('engineering.view') as never, async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const b = req.body as Record<string, unknown>
  const hits = await searchFixes({
    tenantId,
    symptoms:      Array.isArray(b['symptoms']) ? (b['symptoms'] as string[]) : undefined,
    assetSystem:   b['asset_system']    as string | undefined,
    assetTag:      b['asset_tag']       as string | undefined,
    query:         b['query']           as string | undefined,
    limit:         typeof b['limit']    === 'number' ? b['limit'] as number : undefined,
    minConfidence: b['min_confidence']  as FixConfidence | undefined,
  })
  res.json({ data: hits })
})

// ─── List ─────────────────────────────────────────────────────────────────────

router.get('/', requireCapability('engineering.view') as never, async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const { page, limit, offset } = _pagination(req.query as Record<string, unknown>)
  const { asset_system, confidence, project_id, source_id, auto_only } =
    req.query as Record<string, string>

  const conds: string[] = []
  const vals: unknown[] = []
  let i = 1
  if (asset_system) { conds.push(`asset_system = $${i++}`); vals.push(asset_system) }
  if (confidence)   { conds.push(`confidence = $${i++}`);   vals.push(confidence) }
  if (project_id)   { conds.push(`project_id = $${i++}`);   vals.push(project_id) }
  if (source_id)    { conds.push(`source_id = $${i++}`);    vals.push(source_id) }
  if (auto_only === 'true') { conds.push(`extraction_run_id IS NOT NULL`) }
  if (auto_only === 'false') { conds.push(`extraction_run_id IS NULL`) }
  const where = conds.length ? `AND ${conds.join(' AND ')}` : ''

  const [rows, countRow] = await Promise.all([
    tenantQuery(tenantId, `
      SELECT id, project_id, asset_system, asset_tag, symptoms,
             root_cause, resolution_steps, confidence,
             verified_by, verified_at, source_url, source_note,
             source_id, extraction_run_id,
             created_by, created_at, updated_at
      FROM   knowledge_fixes
      WHERE  tenant_id = current_setting('app.current_tenant_id',true)::uuid ${where}
      ORDER  BY created_at DESC
      LIMIT  $${i} OFFSET $${i + 1}
    `, [...vals, limit, offset]),
    tenantQuery<{ count: string }>(tenantId, `
      SELECT COUNT(*)::text AS count FROM knowledge_fixes
      WHERE  tenant_id = current_setting('app.current_tenant_id',true)::uuid ${where}
    `, vals),
  ])

  const total = parseInt(countRow.rows[0]?.count ?? '0', 10)
  res.json({
    data: rows.rows,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  })
})

// ─── Create ──────────────────────────────────────────────────────────────────

router.post('/', requireCapability('engineering.write') as never, async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const b = req.body as Record<string, unknown>
  try {
    const fix = await createFix({
      tenantId,
      projectId:       (b['project_id']   as string | undefined) ?? null,
      assetSystem:     (b['asset_system'] as string | undefined) ?? null,
      assetTag:        (b['asset_tag']    as string | undefined) ?? null,
      symptoms:        Array.isArray(b['symptoms']) ? (b['symptoms'] as string[]) : [],
      rootCause:       (b['root_cause']       as string | undefined) ?? '',
      resolutionSteps: (b['resolution_steps'] as string | undefined) ?? '',
      confidence:      (b['confidence']       as FixConfidence | undefined),
      sourceUrl:       (b['source_url']       as string | undefined) ?? null,
      sourceNote:      (b['source_note']      as string | undefined) ?? null,
      createdBy:       req.auth?.sub ?? null,
    })
    res.status(201).json({ data: fix })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(422).json({ error: 'validation', message: msg })
  }
})

// ─── Read ────────────────────────────────────────────────────────────────────

router.get('/:id', requireCapability('engineering.view') as never, async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }
  const fix = await getFix(tenantId, String(req.params['id']))
  if (!fix) { res.status(404).json({ error: 'not_found' }); return }
  res.json({ data: fix })
})

// ─── Update ──────────────────────────────────────────────────────────────────

router.patch('/:id', requireCapability('engineering.write') as never, requireRecordScope('knowledge_fixes') as never, async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const fields = ['asset_system','asset_tag','symptoms','root_cause',
                  'resolution_steps','source_url','source_note','project_id']
  const sets: string[] = []
  const vals: unknown[] = []
  let i = 1
  for (const f of fields) {
    if (Object.prototype.hasOwnProperty.call(req.body, f)) {
      if (f === 'symptoms') {
        sets.push(`${f} = $${i++}::text[]`)
        vals.push(req.body[f])
      } else {
        sets.push(`${f} = $${i++}`)
        vals.push(req.body[f])
      }
    }
  }
  if (sets.length === 0) { res.status(422).json({ error: 'validation', message: 'no valid fields' }); return }
  vals.push(req.params['id'])

  const result = await tenantQuery(tenantId, `
    UPDATE knowledge_fixes SET ${sets.join(', ')}
    WHERE id = $${i}
      AND tenant_id = current_setting('app.current_tenant_id',true)::uuid
    RETURNING *
  `, vals)
  if (!result.rows[0]) { res.status(404).json({ error: 'not_found' }); return }
  res.json({ data: result.rows[0] })
})

// ─── Verify ──────────────────────────────────────────────────────────────────

router.post('/:id/verify', requireCapability('assistant.admin') as never, requireRecordScope('knowledge_fixes') as never, async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }
  const userId = req.auth?.sub
  if (!userId) { res.status(401).json({ error: 'user_required' }); return }

  const confidence = ((req.body as { confidence?: string })?.confidence ?? 'confirmed') as FixConfidence
  if (!['confirmed','probable','suspected'].includes(confidence)) {
    res.status(422).json({ error: 'validation', message: 'confidence must be confirmed|probable|suspected' })
    return
  }

  const updated = await verifyFix(tenantId, String(req.params['id']), userId, confidence)
  if (!updated) { res.status(404).json({ error: 'not_found' }); return }
  res.json({ data: updated })
})

// ─── Delete (admin) ──────────────────────────────────────────────────────────

router.delete('/:id', requireCapability('assistant.admin') as never, requireRecordScope('knowledge_fixes') as never, async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }
  const ok = await deleteFix(tenantId, String(req.params['id']))
  if (!ok) { res.status(404).json({ error: 'not_found' }); return }
  res.status(204).send()
})

export default router
