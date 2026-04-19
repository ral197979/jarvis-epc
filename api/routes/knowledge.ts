/**
 * JARVIS EPC — Knowledge Base Routes (v4.31.0)
 *
 *   POST   /api/v1/knowledge/sources           — register a source + enqueue ingest
 *   GET    /api/v1/knowledge/sources           — list sources + status
 *   GET    /api/v1/knowledge/sources/:id       — source detail
 *   POST   /api/v1/knowledge/sources/:id/reingest — requeue chunking
 *   DELETE /api/v1/knowledge/sources/:id       — admin; drops chunks too
 *   GET    /api/v1/knowledge/sources/:id/chunks — paginated chunks
 *
 *   POST   /api/v1/knowledge/search            — body: { query, topK?, filters... }
 */

import { Router, Response } from 'express'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { tenantQuery } from '../db/pool'
import { requireAuth, AuthenticatedRequest } from '../auth'
import { requireTenant, TenantRequest } from '../middleware/tenant'
import { enqueueSourceIngest } from '../services/knowledgeIngest'
import { searchKnowledge } from '../services/knowledgeSearch'
import { bulkIngestDirectory, isPathAllowed } from '../services/knowledgeBulkIngest'
import { enqueueExtractFromSource, enqueueExtractBulk } from '../services/fixExtractor'

type Req = AuthenticatedRequest & TenantRequest

const router = Router()
router.use(requireAuth as never)
router.use(requireTenant() as never)

function _requireAdmin(req: Req, res: Response): boolean {
  if (!['owner','admin'].includes(req.auth?.role ?? '')) {
    res.status(403).json({ error: 'forbidden', message: 'owner/admin role required' })
    return false
  }
  return true
}

function _pagination(q: Record<string, unknown>) {
  const page  = Math.max(1, parseInt(String(q['page']  ?? '1'), 10))
  const limit = Math.min(200, Math.max(1, parseInt(String(q['limit'] ?? '25'), 10)))
  return { page, limit, offset: (page - 1) * limit }
}

// ─── Bulk ingest — admin-only server-side directory walk ──────────────────────
//
// Body:
//   {
//     root_path:     string,              // absolute path readable by the server
//     extensions?:   string[],            // ['pdf'] default
//     tags?:         string[],
//     license_type?: string,              // 'owned' default
//     asset_system?: string,
//     dry_run?:      boolean,             // preview only
//     limit?:        number,              // max files, default 5000
//     skip_dirs?:    string[]             // override default skip list
//   }
//
// Returns the BulkIngestResult.  If KNOWLEDGE_INGEST_ROOTS is set in the
// server env, root_path must be under one of those prefixes.

router.post('/bulk-ingest', async (req: Req, res: Response) => {
  if (!_requireAdmin(req, res)) return
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const b = req.body as Record<string, unknown>
  const rootPath = String(b['root_path'] ?? '').trim()
  if (!rootPath) {
    res.status(422).json({ error: 'validation', message: 'root_path required' })
    return
  }

  // Reject paths outside the allowlist early with a clear error — don't
  // wait until the walker opens the dir.
  const guard = isPathAllowed(rootPath)
  if (!guard.ok) {
    res.status(403).json({ error: 'path_not_allowed', message: guard.reason })
    return
  }

  try {
    const result = await bulkIngestDirectory(
      tenantId,
      req.auth?.sub ?? null,
      {
        rootPath,
        extensions:  Array.isArray(b['extensions']) ? (b['extensions'] as string[]) : ['pdf'],
        tags:        Array.isArray(b['tags'])       ? (b['tags']       as string[]) : [],
        licenseType: (b['license_type'] as string | undefined) ?? 'owned',
        assetSystem: (b['asset_system'] as string | undefined) ?? null,
        skipDirs:    Array.isArray(b['skip_dirs'])  ? (b['skip_dirs']  as string[]) : undefined,
        limit:       typeof b['limit'] === 'number' ? (b['limit'] as number) : undefined,
        dryRun:      b['dry_run'] === true,
      },
    )
    res.json({ data: result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.startsWith('path_not_allowed:')) {
      res.status(403).json({ error: 'path_not_allowed', message: msg })
      return
    }
    res.status(500).json({ error: 'bulk_ingest_failed', message: msg })
  }
})

// ─── Search (POST so tag arrays serialize cleanly) ────────────────────────────

router.post('/search', async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const b = req.body as Record<string, unknown>
  const query = String(b['query'] ?? '').trim()
  if (!query) { res.status(422).json({ error: 'validation', message: 'query required' }); return }

  const hits = await searchKnowledge({
    tenantId,
    query,
    topK:        typeof b['topK'] === 'number' ? b['topK'] as number : undefined,
    sourceIds:   Array.isArray(b['source_ids']) ? (b['source_ids']   as string[]) : undefined,
    tags:        Array.isArray(b['tags'])       ? (b['tags']         as string[]) : undefined,
    assetSystem: b['asset_system'] as string | undefined,
    licenseTypes: Array.isArray(b['license_types']) ? (b['license_types'] as string[]) : undefined,
  })
  res.json({ data: hits })
})

// ─── List sources ─────────────────────────────────────────────────────────────

router.get('/sources', async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const { page, limit, offset } = _pagination(req.query as Record<string, unknown>)
  const { status, kind, asset_system } = req.query as Record<string, string>

  const conds: string[] = []
  const vals: unknown[] = []
  let i = 1
  if (status)       { conds.push(`status = $${i++}`);       vals.push(status) }
  if (kind)         { conds.push(`kind = $${i++}`);         vals.push(kind) }
  if (asset_system) { conds.push(`asset_system = $${i++}`); vals.push(asset_system) }
  const where = conds.length ? `AND ${conds.join(' AND ')}` : ''

  const [rows, countRow] = await Promise.all([
    tenantQuery(tenantId, `
      SELECT id, title, kind, storage_path, original_filename, byte_size, page_count,
             license_type, attribution, status, error_text, chunk_count,
             tags, asset_system, project_id, ingested_at, created_at, updated_at
      FROM   knowledge_sources
      WHERE  tenant_id = current_setting('app.current_tenant_id',true)::uuid ${where}
      ORDER  BY created_at DESC
      LIMIT  $${i} OFFSET $${i + 1}
    `, [...vals, limit, offset]),
    tenantQuery<{ count: string }>(tenantId, `
      SELECT COUNT(*)::text AS count FROM knowledge_sources
      WHERE  tenant_id = current_setting('app.current_tenant_id',true)::uuid ${where}
    `, vals),
  ])

  const total = parseInt(countRow.rows[0]?.count ?? '0', 10)
  res.json({
    data: rows.rows,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  })
})

// ─── Create / register source (+ enqueue ingest) ──────────────────────────────

router.post('/sources', async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const b = req.body as Record<string, unknown>
  const storagePath = String(b['storage_path'] ?? '').trim()
  if (!storagePath) {
    res.status(422).json({ error: 'validation', message: 'storage_path required' })
    return
  }

  // Inspect the file: size + sha256 for dedup. Runs server-side, so the
  // file must be readable from the API process; typically a mounted
  // shared volume, a staging dir, or (local dev) an attached drive.
  let stat: Awaited<ReturnType<typeof fs.stat>>
  try {
    stat = await fs.stat(storagePath)
  } catch (err) {
    res.status(422).json({
      error: 'file_not_accessible',
      message: `storage_path not readable: ${err instanceof Error ? err.message : String(err)}`,
    })
    return
  }
  if (!stat.isFile()) {
    res.status(422).json({ error: 'validation', message: 'storage_path must be a file' })
    return
  }

  const buf = await fs.readFile(storagePath)
  const sha = crypto.createHash('sha256').update(buf).digest('hex')

  const title            = String(b['title'] ?? path.basename(storagePath)).slice(0, 512)
  const originalFilename = path.basename(storagePath)
  const licenseType      = String(b['license_type'] ?? 'owned')
  const kind             = (String(b['kind'] ?? 'pdf')).toLowerCase()
  const tags             = Array.isArray(b['tags']) ? (b['tags'] as string[]) : []
  const assetSystem      = (b['asset_system'] as string | undefined) ?? null

  try {
    const insRes = await tenantQuery<{ id: string }>(tenantId, `
      INSERT INTO knowledge_sources
        (tenant_id, title, kind, storage_path, original_filename,
         byte_size, sha256, license_type, license_attest, attribution,
         status, tags, asset_system, project_id, created_by)
      VALUES
        (current_setting('app.current_tenant_id',true)::uuid,
         $1, $2, $3, $4, $5, $6, $7, $8, $9,
         'pending', $10::text[], $11, $12, $13)
      RETURNING id
    `, [
      title, kind, storagePath, originalFilename,
      stat.size, sha, licenseType,
      b['license_attest'] ?? null,
      b['attribution']    ?? null,
      tags, assetSystem,
      b['project_id']     ?? null,
      req.auth?.sub       ?? null,
    ])
    const id = insRes.rows[0]!.id

    const jobId = await enqueueSourceIngest(tenantId, id, req.auth?.sub ?? null)
    res.status(202).json({
      data: { source_id: id, status: 'pending', ingest_job_id: jobId },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('knowledge_sources_sha_unique')) {
      res.status(409).json({ error: 'already_ingested', message: 'A source with this content already exists in this tenant.' })
      return
    }
    throw err
  }
})

// ─── Detail ───────────────────────────────────────────────────────────────────

router.get('/sources/:id', async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const result = await tenantQuery(tenantId, `
    SELECT * FROM knowledge_sources
    WHERE id = $1
      AND tenant_id = current_setting('app.current_tenant_id',true)::uuid
  `, [req.params['id']])
  if (!result.rows[0]) { res.status(404).json({ error: 'not_found' }); return }
  res.json({ data: result.rows[0] })
})

// ─── Chunks for a source (paginated) ──────────────────────────────────────────

router.get('/sources/:id/chunks', async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const { page, limit, offset } = _pagination(req.query as Record<string, unknown>)
  const [rows, countRow] = await Promise.all([
    tenantQuery(tenantId, `
      SELECT id, ordinal, page_ref, char_start, char_end, tokens_est, text, created_at
      FROM   knowledge_chunks
      WHERE  source_id = $1
        AND  tenant_id = current_setting('app.current_tenant_id',true)::uuid
      ORDER  BY ordinal
      LIMIT  $2 OFFSET $3
    `, [req.params['id'], limit, offset]),
    tenantQuery<{ count: string }>(tenantId, `
      SELECT COUNT(*)::text AS count FROM knowledge_chunks
      WHERE source_id = $1
        AND tenant_id = current_setting('app.current_tenant_id',true)::uuid
    `, [req.params['id']]),
  ])

  const total = parseInt(countRow.rows[0]?.count ?? '0', 10)
  res.json({
    data: rows.rows,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  })
})

// ─── Re-ingest ────────────────────────────────────────────────────────────────

router.post('/sources/:id/reingest', async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const ownership = await tenantQuery<{ id: string }>(tenantId, `
    SELECT id FROM knowledge_sources
    WHERE id = $1
      AND tenant_id = current_setting('app.current_tenant_id',true)::uuid
  `, [req.params['id']])
  if (!ownership.rows[0]) { res.status(404).json({ error: 'not_found' }); return }

  await tenantQuery(tenantId, `
    UPDATE knowledge_sources SET status='pending', error_text=NULL WHERE id=$1
  `, [req.params['id']])
  const jobId = await enqueueSourceIngest(tenantId, String(req.params['id']), req.auth?.sub ?? null)
  res.status(202).json({ data: { source_id: req.params['id'], status: 'pending', ingest_job_id: jobId } })
})

// ─── Mine fixes from a single source ──────────────────────────────────────────

router.post('/sources/:id/mine-fixes', async (req: Req, res: Response) => {
  if (!_requireAdmin(req, res)) return
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  // Verify source exists + belongs to tenant
  const own = await tenantQuery<{ id: string; status: string }>(tenantId, `
    SELECT id, status FROM knowledge_sources
    WHERE  id = $1 AND tenant_id = current_setting('app.current_tenant_id',true)::uuid
  `, [req.params['id']])
  if (!own.rows[0]) { res.status(404).json({ error: 'not_found' }); return }
  if (own.rows[0].status !== 'ready') {
    res.status(409).json({
      error: 'source_not_ready',
      message: `source status=${own.rows[0].status} — wait for ingest to complete`,
    })
    return
  }

  const b = req.body as { reextract?: boolean }
  try {
    const jobId = await enqueueExtractFromSource(
      tenantId, String(req.params['id']), req.auth?.sub ?? null,
      { reextract: b?.reextract === true },
    )
    res.status(202).json({ data: {
      source_id: req.params['id'],
      job_id:    jobId,
      queued:    true,
      message:   'Fix extraction queued. Check progress via GET /api/v1/knowledge-fixes?source_id=<id>.',
    }})
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(500).json({ error: 'enqueue_failed', message: msg })
  }
})

// ─── Mine fixes in bulk — OEM + record tier only by default ────────────────────

router.post('/mine-fixes-bulk', async (req: Req, res: Response) => {
  if (!_requireAdmin(req, res)) return
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const b = req.body as { limit?: number; asset_system?: string; reextract?: boolean }
  try {
    const result = await enqueueExtractBulk(tenantId, req.auth?.sub ?? null, {
      limit:       typeof b?.limit === 'number' ? b.limit : undefined,
      assetSystem: b?.asset_system,
      reextract:   b?.reextract === true,
    })
    res.status(202).json({ data: result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(500).json({ error: 'enqueue_failed', message: msg })
  }
})

// ─── Delete (admin) ───────────────────────────────────────────────────────────

router.delete('/sources/:id', async (req: Req, res: Response) => {
  if (!_requireAdmin(req, res)) return
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const r = await tenantQuery<{ id: string }>(tenantId, `
    DELETE FROM knowledge_sources
    WHERE id = $1
      AND tenant_id = current_setting('app.current_tenant_id',true)::uuid
    RETURNING id
  `, [req.params['id']])
  if (!r.rows[0]) { res.status(404).json({ error: 'not_found' }); return }
  res.status(204).send()
})

export default router
