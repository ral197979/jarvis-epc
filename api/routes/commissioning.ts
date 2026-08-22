/**
 * Denver Engineering — Commissioning Pack Routes
 * ────────────────────────────────────────
 * v4.30.0 | Integrated from EngineeringHub v11
 *
 * Routes:
 *   POST   /api/v1/commissioning/uploads/text-ingest  — Ingest raw text as source upload
 *   GET    /api/v1/commissioning/uploads              — List source uploads
 *   POST   /api/v1/commissioning/generate-draft       — Queue GENERATE_DRAFT job (costs 1 credit)
 *   GET    /api/v1/commissioning/packs                — List packs (paginated, filterable)
 *   GET    /api/v1/commissioning/packs/:id            — Get single pack + payload
 *   PATCH  /api/v1/commissioning/packs/:id/review     — Save review notes (status → ready_for_review)
 *   POST   /api/v1/commissioning/finalize             — Queue FINALIZE_PACK job
 *   GET    /api/v1/commissioning/jobs                 — List generation jobs
 *   GET    /api/v1/commissioning/balance              — Current credit balance
 *   POST   /api/v1/commissioning/credits              — Grant credits (owner / admin only)
 *   GET    /api/v1/commissioning/packs/:id/download/:format — Download MD/HTML artifact
 *
 * All routes require:
 *   - requireAuth    (sets req.auth: JarvisTokenPayload)
 *   - requireTenant  (sets req.tenantId / req.tenant)
 *
 * Add to api/server.ts:
 *   import commissioningRouter from './routes/commissioning'
 *   app.use('/api/v1/commissioning', commissioningRouter)
 */

import { Router, Response }  from 'express'
import fs                     from 'node:fs/promises'
// v4.31.0 TS fix: `path` unused after STORAGE_DIR removal
// import path                   from 'node:path'
// v4.31.0 TS fix: `tenantTransaction` unused in current routes
import { tenantQuery, query } from '../db/pool'
import { requireAuth, AuthenticatedRequest }     from '../auth'
import { requireTenant, TenantRequest }          from '../middleware/tenant'
import { slog }                                  from '../../src/modules/observability/index'
import { requireCapability } from '../authz/requireCapability'
import { requireRecordScope, requireBodyProjectScope } from '../authz/recordScope'

type Req = AuthenticatedRequest & TenantRequest

const router = Router()
router.use(requireAuth as never)
router.use(requireTenant() as never)

// ─── Config ───────────────────────────────────────────────────────────────────

const PACK_CREDIT_COST = Number(process.env['CX_PACK_CREDIT_COST'] ?? '1')
// v4.31.0 TS fix: STORAGE_DIR declaration removed (strict noUnusedLocals bites
// even underscored names). Reintroduce when pack-storage persistence goes live.

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _paginationParams(q: Record<string, unknown>) {
  const page  = Math.max(1, parseInt(String(q['page']  ?? '1'),  10))
  const limit = Math.min(100, Math.max(1, parseInt(String(q['limit'] ?? '25'), 10)))
  return { page, limit, offset: (page - 1) * limit }
}

async function _creditBalance(tenantId: string): Promise<number> {
  const res = await query<{ balance: string }>(
    `SELECT COALESCE(SUM(delta), 0)::TEXT AS balance FROM billing_credits WHERE tenant_id = $1`,
    [tenantId],
  )
  return parseInt(res.rows[0]?.balance ?? '0', 10)
}

// ─── POST /uploads/text-ingest ────────────────────────────────────────────────
// Accepts a plain-text document (spec section, notes) and stores it as a
// SourceUpload record. Returns the upload ID for use in generate-draft.

router.post('/uploads/text-ingest', requireCapability('commissioning.write') as never, requireBodyProjectScope('projectId') as never, async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const { fileName, rawText, contentType = 'text/plain', projectId } = req.body as Record<string, string>

  if (!fileName || !rawText) {
    res.status(400).json({ error: 'validation', message: 'fileName and rawText are required' })
    return
  }

  const result = await tenantQuery<{ id: string; file_name: string; created_at: string }>(
    tenantId,
    `INSERT INTO source_uploads
       (tenant_id, uploaded_by, project_id, file_name, content_type, extracted_text)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, file_name, created_at`,
    [tenantId, req.auth!.sub, projectId ?? null, fileName, contentType, rawText],
  )

  const upload = result.rows[0]
  slog('INFO', 'commissioning', '[ingest] Source upload created', { uploadId: upload?.id, tenantId })
  res.status(201).json({ success: true, upload })
})

// ─── GET /uploads ─────────────────────────────────────────────────────────────

router.get('/uploads', requireCapability('commissioning.view') as never, async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const { limit, offset } = _paginationParams(req.query as Record<string, unknown>)

  const result = await tenantQuery(tenantId, `
    SELECT id, file_name, content_type, size_bytes, project_id, created_at,
           LEFT(extracted_text, 200) AS extracted_text_preview
    FROM source_uploads
    WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ORDER BY created_at DESC
    LIMIT $1 OFFSET $2
  `, [limit, offset])

  res.json({ items: result.rows })
})

// ─── GET /balance ─────────────────────────────────────────────────────────────

router.get('/balance', requireCapability('commissioning.view') as never, async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const balance = await _creditBalance(tenantId)
  res.json({ balance, cost_per_draft: PACK_CREDIT_COST })
})

// ─── POST /credits ────────────────────────────────────────────────────────────
// Grant credits manually. Owner / admin only.

// ADR-014 D3 — credit issuance is platform entitlement administration, not
// ordinary project cost approval: it writes billing_credits with a caller-supplied
// delta that may add or remove entitlement. platform.admin already governs
// platform feature and usage administration and its holders are {owner, admin} —
// exactly the legacy role set — so the authority is unchanged while the decision
// moves from the JWT claim to the live database principal.
router.post('/credits', requireCapability('platform.admin') as never, async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const { delta, reason } = req.body as { delta: number; reason: string }
  if (!delta || !reason) {
    res.status(400).json({ error: 'validation', message: 'delta and reason are required' })
    return
  }

  await tenantQuery(tenantId,
    `INSERT INTO billing_credits (tenant_id, delta, reason, created_by) VALUES ($1, $2, $3, $4)`,
    [tenantId, delta, reason, req.auth!.sub],
  )

  const balance = await _creditBalance(tenantId)
  slog('INFO', 'commissioning', '[credits] Grant applied', { tenantId, delta, reason })
  res.status(201).json({ success: true, balance })
})

// ─── POST /generate-draft ─────────────────────────────────────────────────────
// Queues a GENERATE_DRAFT job. Debit happens inside the worker after validation.
// Returns immediately with jobId; client polls /jobs or /packs.

router.post('/generate-draft', requireCapability('commissioning.write') as never, requireBodyProjectScope('projectId') as never, async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const { title, systemType, inputText = '', uploadId, projectId } =
    req.body as Record<string, string>

  if (!title || !systemType) {
    res.status(400).json({ error: 'validation', message: 'title and systemType are required' })
    return
  }

  // Pre-flight credit check (advisory — worker does the authoritative check)
  const balance = await _creditBalance(tenantId)
  if (balance < PACK_CREDIT_COST) {
    res.status(402).json({
      error:   'insufficient_credits',
      message: `Requires ${PACK_CREDIT_COST} credit(s). Current balance: ${balance}.`,
      balance,
    })
    return
  }

  const payload = {
    packTitle:      title,
    systemType,
    inputText,
    sourceUploadId: uploadId   ?? null,
    projectId:      projectId  ?? null,
  }

  const jobRes = await tenantQuery<{ id: string }>(tenantId, `
    INSERT INTO generation_jobs (tenant_id, created_by, type, payload_json)
    VALUES ($1, $2, 'generate_draft', $3)
    RETURNING id
  `, [tenantId, req.auth!.sub, JSON.stringify(payload)])

  const jobId = jobRes.rows[0]!.id
  slog('INFO', 'commissioning', '[draft] Job queued', { jobId, systemType, tenantId })
  res.status(202).json({ success: true, jobId })
})

// ─── POST /packs/manual ───────────────────────────────────────────────────────
// Persist a rules-engine generated CxPack without going through the AI worker.
// Stores the full CxPack as payload_json so CxWorkflowView can re-hydrate it.

router.post('/packs/manual', requireCapability('commissioning.write') as never, requireBodyProjectScope('projectId') as never, async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const { title, systemType, projectId, payload } =
    req.body as { title?: string; systemType?: string; projectId?: string; payload?: unknown }

  if (!title || !systemType) {
    res.status(400).json({ error: 'validation', message: 'title and systemType are required' })
    return
  }

  const result = await tenantQuery<{ id: string; title: string; status: string; created_at: string }>(
    tenantId, `
    INSERT INTO commissioning_packs
      (tenant_id, created_by, project_id, title, system_type, status, payload_json)
    VALUES ($1, $2, $3, $4, $5, 'draft', $6)
    RETURNING id, title, status, created_at
  `, [tenantId, req.auth!.sub, projectId ?? null, title, systemType, payload ? JSON.stringify({ cx_pack: payload }) : null])

  res.status(201).json({ item: result.rows[0] })
})

// ─── GET /packs ───────────────────────────────────────────────────────────────

router.get('/packs', requireCapability('commissioning.view') as never, async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const { page, limit, offset } = _paginationParams(req.query as Record<string, unknown>)
  const { status, system_type, project_id, search } = req.query as Record<string, string>

  const conditions: string[] = []
  const values: unknown[]    = []
  let   p                    = 1

  if (status)      { conditions.push(`status = $${p++}`);       values.push(status)      }
  if (system_type) { conditions.push(`system_type = $${p++}`);  values.push(system_type) }
  if (project_id)  { conditions.push(`project_id = $${p++}`);   values.push(project_id)  }
  if (search)      { conditions.push(`title ILIKE $${p++}`);    values.push(`%${search}%`) }

  const where = conditions.length ? `AND ${conditions.join(' AND ')}` : ''

  const [dataRes, countRes] = await Promise.all([
    tenantQuery(tenantId, `
      SELECT cp.*,
             u.display_name AS created_by_name,
             pr.name        AS project_name
      FROM commissioning_packs cp
      LEFT JOIN users    u  ON u.id  = cp.created_by
      LEFT JOIN projects pr ON pr.id = cp.project_id
      WHERE cp.tenant_id = current_setting('app.current_tenant_id', true)::uuid
      ${where}
      ORDER BY cp.created_at DESC
      LIMIT $${p} OFFSET $${p + 1}
    `, [...values, limit, offset]),
    tenantQuery<{ count: string }>(tenantId, `
      SELECT COUNT(*)::TEXT AS count FROM commissioning_packs
      WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid ${where}
    `, values),
  ])

  const total = parseInt(countRes.rows[0]?.count ?? '0', 10)
  res.json({
    items:      dataRes.rows,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  })
})

// ─── GET /packs/:id ───────────────────────────────────────────────────────────

router.get('/packs/:id', requireCapability('commissioning.view') as never, requireRecordScope('commissioning_packs') as never, async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const result = await tenantQuery(tenantId, `
    SELECT cp.*,
           u.display_name  AS created_by_name,
           pr.name         AS project_name,
           su.file_name    AS source_upload_name
    FROM commissioning_packs cp
    LEFT JOIN users         u  ON u.id  = cp.created_by
    LEFT JOIN projects      pr ON pr.id = cp.project_id
    LEFT JOIN source_uploads su ON su.id = cp.source_upload_id
    WHERE cp.id = $1
      AND cp.tenant_id = current_setting('app.current_tenant_id', true)::uuid
  `, [req.params['id']])

  const pack = result.rows[0]
  if (!pack) { res.status(404).json({ error: 'not_found' }); return }

  // Append download links for finalized artifacts
  const downloads: Record<string, { available: boolean; path?: string }> = {
    markdown: { available: !!pack.markdown_path, path: pack.markdown_path },
    html:     { available: !!pack.html_path,     path: pack.html_path     },
    pdf:      { available: !!pack.pdf_path,       path: pack.pdf_path      },
  }

  res.json({ ...pack, downloads })
})

// ─── PATCH /packs/:id/review ──────────────────────────────────────────────────
// Saves review notes without triggering finalization.
// Status stays at ready_for_review; finalize is a separate step.

router.patch('/packs/:id/review', requireCapability('commissioning.write') as never, requireRecordScope('commissioning_packs') as never, async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const { reviewNotes } = req.body as { reviewNotes: string }
  if (typeof reviewNotes !== 'string') {
    res.status(400).json({ error: 'validation', message: 'reviewNotes must be a string' })
    return
  }

  const result = await tenantQuery<{ id: string; status: string }>(tenantId, `
    UPDATE commissioning_packs
    SET review_notes = $1, updated_at = NOW()
    WHERE id = $2
      AND tenant_id = current_setting('app.current_tenant_id', true)::uuid
      AND status IN ('draft', 'ready_for_review')
    RETURNING id, status
  `, [reviewNotes, req.params['id']])

  if (!result.rows[0]) {
    res.status(404).json({ error: 'not_found', message: 'Pack not found or cannot be reviewed in its current state.' })
    return
  }

  res.json({ success: true, pack: result.rows[0] })
})

// ─── POST /finalize ───────────────────────────────────────────────────────────
// Queues a FINALIZE_PACK job. Worker renders MD/HTML and writes paths.

router.post('/finalize', requireCapability('commissioning.approve') as never, async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const { packId, reviewNotes = '' } = req.body as Record<string, string>
  if (!packId) {
    res.status(400).json({ error: 'validation', message: 'packId is required' })
    return
  }

  // Verify pack exists and is in a finalizable state
  const packCheck = await tenantQuery<{ id: string; status: string }>(tenantId, `
    SELECT id, status FROM commissioning_packs
    WHERE id = $1 AND tenant_id = current_setting('app.current_tenant_id', true)::uuid
  `, [packId])

  const pack = packCheck.rows[0]
  if (!pack) { res.status(404).json({ error: 'not_found' }); return }
  if (!['draft', 'ready_for_review'].includes(pack.status)) {
    res.status(409).json({
      error:   'invalid_state',
      message: `Pack status is '${pack.status}' — only draft or ready_for_review packs can be finalized.`,
    })
    return
  }

  const jobRes = await tenantQuery<{ id: string }>(tenantId, `
    INSERT INTO generation_jobs (tenant_id, created_by, type, payload_json)
    VALUES ($1, $2, 'finalize_pack', $3)
    RETURNING id
  `, [tenantId, req.auth!.sub, JSON.stringify({ packId, reviewNotes })])

  const jobId = jobRes.rows[0]!.id
  slog('INFO', 'commissioning', '[finalize] Job queued', { jobId, packId, tenantId })
  res.status(202).json({ success: true, jobId })
})

// ─── GET /jobs ────────────────────────────────────────────────────────────────

router.get('/jobs', requireCapability('commissioning.view') as never, async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const { limit, offset } = _paginationParams(req.query as Record<string, unknown>)
  const { status, type } = req.query as Record<string, string>

  const conditions: string[] = []
  const values: unknown[]    = []
  let p = 1

  if (status) { conditions.push(`status = $${p++}`); values.push(status) }
  if (type)   { conditions.push(`type = $${p++}`);   values.push(type)   }

  const where = conditions.length ? `AND ${conditions.join(' AND ')}` : ''

  const result = await tenantQuery(tenantId, `
    SELECT id, type, status, payload_json, result_json, error_text,
           attempts, max_attempts, run_after, created_at, updated_at
    FROM generation_jobs
    WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ${where}
    ORDER BY created_at DESC
    LIMIT $${p} OFFSET $${p + 1}
  `, [...values, limit, offset])

  res.json({ items: result.rows })
})

// ─── GET /packs/:id/download/:format ─────────────────────────────────────────
// Streams a generated artifact. format: 'markdown' | 'html' | 'pdf'

router.get('/packs/:id/download/:format', requireCapability('commissioning.view') as never, requireRecordScope('commissioning_packs') as never, async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const { id, format } = req.params as Record<string, string>
  const formatMap: Record<string, { col: string; mime: string; ext: string }> = {
    markdown: { col: 'markdown_path', mime: 'text/markdown',       ext: 'md'   },
    html:     { col: 'html_path',     mime: 'text/html',           ext: 'html' },
    pdf:      { col: 'pdf_path',      mime: 'application/pdf',     ext: 'pdf'  },
  }

  const fmt = formatMap[format!]
  if (!fmt) {
    res.status(400).json({ error: 'invalid_format', message: 'format must be markdown, html, or pdf' })
    return
  }

  const result = await tenantQuery<{ title: string; path: string }>(tenantId, `
    SELECT title, ${fmt.col} AS path FROM commissioning_packs
    WHERE id = $1 AND tenant_id = current_setting('app.current_tenant_id', true)::uuid
  `, [id])

  const row = result.rows[0]
  if (!row)       { res.status(404).json({ error: 'not_found' }); return }
  if (!row.path)  { res.status(404).json({ error: 'artifact_not_ready', message: `${format} artifact not yet generated.` }); return }

  try {
    const content = await fs.readFile(row.path)
    const slug    = row.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)
    res.setHeader('Content-Type', fmt.mime)
    res.setHeader('Content-Disposition', `attachment; filename="${slug}.${fmt.ext}"`)
    res.send(content)
  } catch {
    res.status(404).json({ error: 'artifact_missing', message: 'Generated file not found on disk.' })
  }
})

export default router
