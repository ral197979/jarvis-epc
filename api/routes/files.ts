/**
 * Denver Engineering — File Management Routes
 * ──────────────────────────────────────
 * v4.26.0 | Upload, versioning, download, folder tree
 *
 * Routes:
 *   POST   /api/v1/files/request-upload       — Presign upload slot
 *   PUT    /api/v1/files/upload/:token        — Receive file (local backend)
 *   POST   /api/v1/files/confirm/:versionId   — Confirm upload complete
 *   GET    /api/v1/files/download/:token      — Stream file (local backend)
 *   GET    /api/v1/files/presign/:versionId   — Get presigned download URL (S3)
 *   GET    /api/v1/files/documents            — List documents
 *   GET    /api/v1/files/documents/:id        — Get document + versions
 *   PATCH  /api/v1/files/documents/:id        — Update metadata
 *   DELETE /api/v1/files/documents/:id        — Soft-delete
 *   GET    /api/v1/files/folders              — Folder tree
 *   POST   /api/v1/files/folders              — Create folder
 */

import { Router, Response, Request } from 'express'
import fs      from 'node:fs'
import path    from 'node:path'
import crypto  from 'node:crypto'
import { tenantQuery, tenantTransaction } from '../db/pool'
import { requireAuth, AuthenticatedRequest } from '../auth'
import { requireTenant, TenantRequest } from '../middleware/tenant'
import { getStorage } from '../files/storage'
import { slog } from '../../src/modules/observability/index'

import { requireCapability } from '../authz/requireCapability'
import { requireRecordScope, requireBodyProjectScope } from '../authz/recordScope'
type Req = AuthenticatedRequest & TenantRequest

const router = Router()
router.use(requireAuth as never)

const LOCAL_DIR = process.env['STORAGE_LOCAL_DIR'] ?? path.join(process.cwd(), 'uploads')
const MAX_FILE_SIZE = Number(process.env['MAX_FILE_SIZE_MB'] ?? '100') * 1024 * 1024

// ─── MIME allowlist & IFC size cap ───────────────────────────────────────────

const ALLOWED_MIME_TYPES = new Set([
  // Documents
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain', 'text/csv',
  // Images — NOTE: image/svg+xml deliberately excluded (AUD-006): SVG is an
  // active-content (script-capable) format and is an XSS vector when served
  // from the app origin. Re-add only behind server-side SVG sanitization.
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  // BIM / CAD
  'application/octet-stream',   // IFC, DWG, RVT, etc. — binary opaque types
  'model/ifc',
  'model/gltf-binary', 'model/gltf+json',
  // Schedule
  'text/xml', 'application/xml',
  // Generic archives (drawings packages)
  'application/zip', 'application/x-zip-compressed',
])

// IFC files: hard cap at 100 MB regardless of global MAX_FILE_SIZE
const IFC_MAX_BYTES = 100 * 1024 * 1024

function _isIfcFile(filename: unknown): boolean {
  return typeof filename === 'string' && /\.ifc$/i.test(filename)
}

// ─── POST /request-upload ─────────────────────────────────────────────────────
// Creates a document + version record, returns a presigned upload URL.

router.post('/request-upload', requireCapability('docs.write') as never, requireBodyProjectScope('projectId') as never, requireTenant() as never, async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const {
    filename, mimeType, sizeBytes, projectId, folderId,
    docTitle, docType, discipline, docNumber, tags = [],
    version,   // if set, adds a new version to existing doc
    documentId,
  } = req.body as Record<string, unknown>

  if (!filename || !sizeBytes) {
    res.status(422).json({ error: 'validation', message: 'filename and sizeBytes required' })
    return
  }

  // ── P1-5: MIME type validation ──
  const declaredMime = String(mimeType ?? 'application/octet-stream')
  if (!ALLOWED_MIME_TYPES.has(declaredMime)) {
    res.status(415).json({
      error:   'unsupported_media_type',
      message: `File type '${declaredMime}' is not allowed.`,
    })
    return
  }

  // ── P1-6: IFC file size hard cap ──
  if (_isIfcFile(filename) && Number(sizeBytes) > IFC_MAX_BYTES) {
    res.status(413).json({
      error:   'file_too_large',
      message: `IFC files are limited to ${IFC_MAX_BYTES / 1024 / 1024} MB.`,
    })
    return
  }

  // Check tenant storage quota
  const tenantResult = await tenantQuery<{ used: string; max: string }>(tenantId,
    'SELECT used_storage_gb::text AS used, max_storage_gb::text AS max FROM tenants WHERE id = current_setting(\'app.current_tenant_id\',true)::uuid',
    []
  )
  const used = parseFloat(tenantResult.rows[0]?.used ?? '0')
  const max  = parseFloat(tenantResult.rows[0]?.max  ?? '10')
  const addedGb = Number(sizeBytes) / 1_073_741_824

  if (used + addedGb > max) {
    res.status(413).json({
      error:   'storage_quota_exceeded',
      message: `Storage quota exceeded. Used: ${used.toFixed(2)} GB / ${max} GB.`,
    })
    return
  }

  const storage  = getStorage()
  const ext      = path.extname(String(filename)).toLowerCase()
  const key      = `${tenantId}/${projectId ?? '_global'}/${crypto.randomBytes(16).toString('hex')}${ext}`

  const presign  = await storage.presignUpload(key, {
    mimeType:     String(mimeType ?? 'application/octet-stream'),
    maxSizeBytes: MAX_FILE_SIZE,
  })

  // Upsert document + pending version in a transaction
  const { docId, versionId, versionNum } = await tenantTransaction(tenantId, async (client) => {
    let docId: string
    let versionNum: number

    if (documentId) {
      // New version of existing document
      const docRes = await client.query(
        'SELECT id, current_version FROM documents WHERE id = $1 AND tenant_id = current_setting(\'app.current_tenant_id\',true)::uuid',
        [documentId]
      )
      if (!docRes.rows[0]) throw Object.assign(new Error('Document not found'), { status: 404 })
      docId      = docRes.rows[0].id
      versionNum = (docRes.rows[0].current_version ?? 1) + 1
    } else {
      // New document
      const docRes = await client.query(
        `INSERT INTO documents (tenant_id,project_id,folder_id,title,type,discipline,doc_number,tags,status,created_by)
         VALUES (current_setting('app.current_tenant_id',true)::uuid,$1,$2,$3,$4,$5,$6,$7,'uploading',$8)
         RETURNING id`,
        [projectId??null, folderId??null, docTitle??String(filename), docType??null, discipline??null, docNumber??null, tags, req.auth?.sub??null]
      )
      docId      = docRes.rows[0].id
      versionNum = 1
    }

    const vRes = await client.query(
      `INSERT INTO document_versions (tenant_id,document_id,version,storage_backend,storage_key,original_name,mime_type,size_bytes,status,change_note,uploaded_by)
       VALUES (current_setting('app.current_tenant_id',true)::uuid,$1,$2,$3,$4,$5,$6,$7,'uploading',$8,$9)
       RETURNING id`,
      [docId, versionNum, process.env['STORAGE_BACKEND']??'local', key, String(filename), String(mimeType??'application/octet-stream'), Number(sizeBytes), String(version??''), req.auth?.sub??null]
    )

    return { docId, versionId: vRes.rows[0].id, versionNum }
  })

  slog('INFO', 'files', '[upload] Presigned upload slot created', { tenantId, docId, versionId, key })

  res.status(201).json({
    data: {
      documentId: docId,
      versionId,
      versionNum,
      uploadUrl:   presign.uploadUrl,
      uploadToken: presign.uploadToken,
      storageKey:  key,
      expiresAt:   presign.expiresAt,
    },
  })
})

// ─── PUT /upload/:token — Local backend file receive ─────────────────────────

router.put('/upload/:token', requireCapability('docs.write') as never, async (req: Request, res: Response) => {
  const { token } = req.params
  const tokenDir  = path.join(LOCAL_DIR, '.tokens')
  const metaPath  = path.join(tokenDir, `${token}.json`)

  if (!fs.existsSync(metaPath)) {
    res.status(404).json({ error: 'invalid_token', message: 'Upload token not found or already used.' })
    return
  }

  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as {
    key: string; expiresAt: string; maxSize: number; mimeType?: string
  }

  if (new Date(meta.expiresAt) < new Date()) {
    fs.unlinkSync(metaPath)
    res.status(410).json({ error: 'token_expired' })
    return
  }

  const contentLength = parseInt(req.headers['content-length'] ?? '0', 10)
  if (contentLength > meta.maxSize) {
    res.status(413).json({ error: 'file_too_large', maxBytes: meta.maxSize })
    return
  }

  const storage = getStorage()
  try {
    const { sizeBytes, etag } = await storage.streamToKey(meta.key, req, req.headers['content-type'])
    fs.unlinkSync(metaPath)  // consume token
    res.json({ key: meta.key, sizeBytes, etag })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    slog('ERROR', 'files', '[upload] Stream error', { message: msg })
    res.status(500).json({ error: 'upload_failed', message: msg })
  }
})

// ─── POST /confirm/:versionId ─────────────────────────────────────────────────
// Called after upload completes. Sets version + document status to 'active'.

router.post('/confirm/:versionId', requireCapability('docs.write') as never, requireRecordScope('document_versions', 'versionId') as never, requireTenant() as never, async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const { versionId } = req.params
  const { checksumSha256, sizeBytes } = req.body as { checksumSha256?: string; sizeBytes?: number }

  const storage  = getStorage()

  // Load the pending version
  const vRes = await tenantQuery(tenantId, `
    SELECT dv.*, d.id AS doc_id, d.current_version AS doc_current_version
    FROM document_versions dv
    JOIN documents d ON d.id = dv.document_id
    WHERE dv.id = $1 AND dv.tenant_id = current_setting('app.current_tenant_id',true)::uuid
  `, [versionId])

  const ver = vRes.rows[0]
  if (!ver) { res.status(404).json({ error: 'not_found' }); return }
  if (ver.status !== 'uploading') { res.status(409).json({ error: 'conflict', message: 'Version is not in uploading state.' }); return }

  // Verify object exists in storage
  const exists = await storage.objectExists(ver.storage_key)
  if (!exists) {
    res.status(422).json({ error: 'upload_not_found', message: 'File not found in storage. Upload may have failed.' })
    return
  }

  const meta = await storage.getMetadata(ver.storage_key)

  await tenantTransaction(tenantId, async (client) => {
    await client.query(
      `UPDATE document_versions SET status='active', size_bytes=COALESCE($1,size_bytes), checksum_sha256=$2 WHERE id=$3`,
      [sizeBytes ?? meta?.sizeBytes, checksumSha256 ?? null, versionId]
    )
    await client.query(
      `UPDATE documents SET status='active', current_version=$1 WHERE id=$2`,
      [ver.version, ver.doc_id]
    )
  })

  slog('INFO', 'files', '[upload] Confirmed', { tenantId, versionId, key: ver.storage_key })
  res.json({ data: { versionId, documentId: ver.doc_id, version: ver.version, status: 'active' } })
})

// ─── GET /presign/:versionId — presigned download URL ────────────────────────

router.get('/presign/:versionId', requireTenant() as never, requireCapability('docs.view') as never, requireRecordScope('document_versions', 'versionId') as never, async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const ver = await tenantQuery(tenantId, `
    SELECT storage_key, original_name, mime_type FROM document_versions
    WHERE id=$1 AND status='active' AND tenant_id=current_setting('app.current_tenant_id',true)::uuid
  `, [req.params['versionId']])

  if (!ver.rows[0]) { res.status(404).json({ error: 'not_found' }); return }

  const { downloadUrl, expiresAt } = await getStorage().presignDownload(ver.rows[0].storage_key, 3600)
  res.json({ data: { downloadUrl, expiresAt, filename: ver.rows[0].original_name } })
})

// ─── GET /download/:token — Local backend streaming download ─────────────────

router.get('/download/:token', requireCapability('docs.view') as never, async (req: Request, res: Response) => {
  const tokenDir = path.join(LOCAL_DIR, '.tokens')
  const metaPath = path.join(tokenDir, `dl_${req.params['token']}.json`)

  if (!fs.existsSync(metaPath)) { res.status(404).json({ error: 'invalid_token' }); return }
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as { key: string; expiresAt: string }
  if (new Date(meta.expiresAt) < new Date()) { fs.unlinkSync(metaPath); res.status(410).json({ error: 'expired' }); return }

  const safePath = path.join(LOCAL_DIR, path.normalize(meta.key).replace(/^(\.\.[/\\])+/, ''))
  if (!fs.existsSync(safePath)) { res.status(404).json({ error: 'file_not_found' }); return }

  fs.unlinkSync(metaPath)
  // AUD-006: force a non-renderable content type + disable MIME sniffing so a
  // stored HTML/SVG/polyglot cannot execute as script in the app origin.
  res.setHeader('Content-Type', 'application/octet-stream')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Content-Disposition', `attachment; filename="${path.basename(meta.key)}"`)
  fs.createReadStream(safePath).pipe(res)
})

// ─── GET /documents ───────────────────────────────────────────────────────────

router.get('/documents', requireTenant() as never, requireCapability('docs.view') as never, async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const { project_id, folder_id, type, search, page = '1', limit = '25' } = req.query as Record<string, string>
  const pg = Math.max(1, parseInt(page, 10))
  const lm = Math.min(100, Math.max(1, parseInt(limit, 10)))
  const off = (pg - 1) * lm

  const conds: string[] = []; const vals: unknown[] = []; let i = 1
  if (project_id) { conds.push(`d.project_id=$${i++}`); vals.push(project_id) }
  if (folder_id)  { conds.push(`d.folder_id=$${i++}`);  vals.push(folder_id) }
  if (type)       { conds.push(`d.type=$${i++}`);        vals.push(type) }
  if (search)     { conds.push(`d.title ILIKE $${i++}`); vals.push(`%${search}%`) }

  const where = conds.length ? `AND ${conds.join(' AND ')}` : ''

  const data = await tenantQuery(tenantId, `
    SELECT d.*,
           dv.original_name, dv.size_bytes, dv.mime_type, dv.uploaded_at,
           u.display_name AS uploaded_by_name
    FROM documents d
    LEFT JOIN document_versions dv ON dv.document_id = d.id AND dv.version = d.current_version
    LEFT JOIN users u ON u.id = dv.uploaded_by
    WHERE d.tenant_id=current_setting('app.current_tenant_id',true)::uuid AND d.status != 'deleted' ${where}
    ORDER BY d.created_at DESC LIMIT $${i} OFFSET $${i+1}
  `, [...vals, lm, off])

  res.json({ data: data.rows })
})

// ─── GET /documents/:id ───────────────────────────────────────────────────────

router.get('/documents/:id', requireTenant() as never, requireCapability('docs.view') as never, requireRecordScope('documents') as never, async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const [docRes, versionsRes] = await Promise.all([
    tenantQuery(tenantId, `
      SELECT d.*, p.code AS project_code FROM documents d
      LEFT JOIN projects p ON p.id = d.project_id
      WHERE d.id=$1 AND d.tenant_id=current_setting('app.current_tenant_id',true)::uuid AND d.status!='deleted'
    `, [req.params['id']]),
    tenantQuery(tenantId, `
      SELECT dv.*, u.display_name AS uploaded_by_name FROM document_versions dv
      LEFT JOIN users u ON u.id = dv.uploaded_by
      WHERE dv.document_id=$1 AND dv.status='active' ORDER BY dv.version DESC
    `, [req.params['id']]),
  ])

  if (!docRes.rows[0]) { res.status(404).json({ error: 'not_found' }); return }
  res.json({ data: { ...docRes.rows[0], versions: versionsRes.rows } })
})

// ─── PATCH /documents/:id ─────────────────────────────────────────────────────

router.patch('/documents/:id', requireCapability('docs.write') as never, requireRecordScope('documents') as never, requireTenant() as never, async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const fields = ['title','description','type','discipline','doc_number','tags','metadata']
  const sets: string[] = []; const vals: unknown[] = []; let i = 1
  for (const f of fields) {
    if (Object.prototype.hasOwnProperty.call(req.body, f)) {
      sets.push(`${f}=$${i++}`)
      vals.push(f === 'metadata' ? JSON.stringify(req.body[f]) : req.body[f])
    }
  }
  if (!sets.length) { res.status(422).json({ error: 'validation', message: 'No valid fields' }); return }
  vals.push(req.params['id'])
  const result = await tenantQuery(tenantId, `
    UPDATE documents SET ${sets.join(',')}
    WHERE id=$${i} AND tenant_id=current_setting('app.current_tenant_id',true)::uuid AND status!='deleted' RETURNING *
  `, vals)
  if (!result.rows[0]) { res.status(404).json({ error: 'not_found' }); return }
  res.json({ data: result.rows[0] })
})

// ─── DELETE /documents/:id ────────────────────────────────────────────────────

router.delete('/documents/:id', requireCapability('docs.write') as never, requireRecordScope('documents') as never, requireTenant() as never, async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const result = await tenantQuery(tenantId, `
    UPDATE documents SET status='deleted'
    WHERE id=$1 AND tenant_id=current_setting('app.current_tenant_id',true)::uuid AND status!='deleted'
    RETURNING id
  `, [req.params['id']])
  if (!result.rows[0]) { res.status(404).json({ error: 'not_found' }); return }
  res.status(204).send()
})

// ─── GET /folders ─────────────────────────────────────────────────────────────

router.get('/folders', requireTenant() as never, requireCapability('docs.view') as never, async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const { project_id } = req.query as Record<string, string>
  const conds = ['f.tenant_id=current_setting(\'app.current_tenant_id\',true)::uuid']
  const vals: unknown[] = []

  if (project_id) { conds.push(`f.project_id=$1`); vals.push(project_id) }

  const data = await tenantQuery(tenantId, `
    SELECT f.*, (SELECT COUNT(*) FROM documents d WHERE d.folder_id=f.id AND d.status='active') AS doc_count
    FROM document_folders f
    WHERE ${conds.join(' AND ')}
    ORDER BY f.path ASC
  `, vals)

  res.json({ data: data.rows })
})

// ─── POST /folders ────────────────────────────────────────────────────────────

router.post('/folders', requireCapability('docs.write') as never, requireBodyProjectScope('project_id') as never, requireTenant() as never, async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const { name, parent_id, project_id, color } = req.body as Record<string, unknown>
  if (!name) { res.status(422).json({ error: 'validation', message: 'name required' }); return }

  let parentPath = ''
  if (parent_id) {
    const p = await tenantQuery<{ path: string }>(tenantId,
      'SELECT path FROM document_folders WHERE id=$1 AND tenant_id=current_setting(\'app.current_tenant_id\',true)::uuid',
      [parent_id]
    )
    if (!p.rows[0]) { res.status(404).json({ error: 'parent_not_found' }); return }
    parentPath = p.rows[0].path
  }

  const slug = String(name).toLowerCase().replace(/[^a-z0-9-]/g, '-')
  const folderPath = parentPath ? `${parentPath}/${slug}` : `/${slug}`

  const result = await tenantQuery(tenantId, `
    INSERT INTO document_folders (tenant_id,project_id,parent_id,name,path,color,created_by)
    VALUES (current_setting('app.current_tenant_id',true)::uuid,$1,$2,$3,$4,$5,$6) RETURNING *
  `, [project_id??null, parent_id??null, String(name), folderPath, color??null, req.auth?.sub??null])

  res.status(201).json({ data: result.rows[0] })
})

export default router
