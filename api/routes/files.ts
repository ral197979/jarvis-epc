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
import { getStorage, DOWNLOAD_TOKEN_PATTERN, UPLOAD_TOKEN_PATTERN } from '../files/storage'
import type { LocalDownloadTokenMeta } from '../files/storage'
import { slog } from '../../src/modules/observability/index'

import { requireCapability } from '../authz/requireCapability'
import { requireRecordScope, requireBodyProjectScope, collectionScopeSql, collectionScopeParams, authorizeRecordScope } from '../authz/recordScope'
import { resolveCurrentUser } from '../authz/currentUser'
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
  // ADR-014 Phase 3K, same reasoning as the download route: Express decodes
  // path parameters, so `%2F` and `..` arrive intact and `path.join` would
  // honour them. Only a minted token shape may build a sidecar path.
  if (!token || !UPLOAD_TOKEN_PATTERN.test(String(token))) {
    res.status(404).json({ error: 'invalid_token', message: 'Upload token not found or already used.' })
    return
  }
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

  // ADR-014 Phase 3K. The token is minted FOR this principal and AGAINST this
  // version. `requireRecordScope` above proved the caller may reach it now; the
  // binding is what lets the redemption path prove it again then.
  const principal = await resolveCurrentUser(req as never)
  if (!principal) { res.status(401).json({ error: 'unauthenticated' }); return }

  const { downloadUrl, expiresAt } = await getStorage().presignDownload(
    ver.rows[0].storage_key,
    { tenantId, subjectId: principal.id, resource: 'document_versions', recordId: String(req.params['versionId']) },
    3600,
  )
  res.json({ data: { downloadUrl, expiresAt, filename: ver.rows[0].original_name } })
})

// ─── GET /download/:token — Local backend streaming download ─────────────────
//
// ADR-014 Phase 3K. This was the last surface in the ADR-014 perimeter that
// answered from a credential instead of from the database.
//
// Every other authorization surface now re-derives authority on every call:
// `resolveCurrentUser` re-reads the role, `requireRecordScope` re-reads the
// record's project, `canAccessProject` re-reads live membership. This route
// re-read none of them. It checked that the caller held `docs.view` — which is
// a role-level capability, not access to any particular file — and then handed
// over whatever `key` the sidecar named. Close a membership, demote a user out
// of a project, move the document: the token minted a minute earlier still
// worked, for the rest of its hour.
//
// The token is now a POINTER, not a credential. It names a tenant, a subject
// and a `document_versions` row; the answer is re-derived from those on every
// redemption, through the same ladder `requireRecordScope` uses (§20). Order
// matters — each check must refuse before the next one leaks anything:
//
//   1. token FORMAT      before any path is built     (traversal)
//   2. sidecar exists / not expired                    (404 / 410)
//   3. BINDING present   — an unbound token is dead    (fail closed)
//   4. TENANT match      before the record is named    (cross-tenant)
//   5. SUBJECT match     — the token is not bearer     (transfer)
//   6. RECORD SCOPE, live                              (revocation)
//   7. the version is still active and still points at this key
//   8. only then: consume the token and stream
//
// A refusal never consumes the token. Burning it on a refused request would let
// anyone who guessed a token deny the legitimate holder their download, and
// would make the refusal observable to the prober.

router.get('/download/:token',
  requireTenant() as never,
  requireCapability('docs.view') as never,
  async (req: Req, res: Response) => {

  const invalid = (): void => { res.status(404).json({ error: 'invalid_token' }) }

  // (1) Format first. `req.params.token` is percent-decoded by Express, so it
  // can contain `/` and `..`; nothing but a minted token may reach `path.join`.
  const token = String(req.params['token'] ?? '')
  if (!DOWNLOAD_TOKEN_PATTERN.test(token)) { invalid(); return }

  const tokenDir = path.join(LOCAL_DIR, '.tokens')
  const metaPath = path.join(tokenDir, `dl_${token}.json`)

  // (2) Existence and expiry.
  if (!fs.existsSync(metaPath)) { invalid(); return }
  let meta: Partial<LocalDownloadTokenMeta>
  try {
    meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as Partial<LocalDownloadTokenMeta>
  } catch { invalid(); return }
  if (!meta.expiresAt || new Date(meta.expiresAt) < new Date()) {
    // Expiry is the one refusal that DOES consume: the token is spent either
    // way, and leaving it on disk only accumulates dead sidecars.
    fs.unlinkSync(metaPath)
    res.status(410).json({ error: 'expired' })
    return
  }

  // (3) An unbound sidecar is one minted before Phase 3K, or by a mint site
  // that could not say who it was for. Neither can be re-authorized, so neither
  // is honoured. Tokens live one hour, so this is self-clearing.
  //
  // Honest note: this line is a TYPE-NARROWING gate and defence in depth, not
  // an independent control. Removing it does not open anything — every missing
  // field is caught again below, because `undefined` fails the tenant, subject,
  // scope and key comparisons in turn. The Phase-3K mutation run records it as
  // the one mutant that stays green, and that is why. It is kept because it
  // states the invariant in one place and because it is what lets checks 4–7
  // compare strings rather than `string | undefined`.
  if (!meta.tenantId || !meta.subjectId || !meta.resource || !meta.recordId || !meta.key) {
    invalid(); return
  }

  const principal = await resolveCurrentUser(req as never)
  if (!principal) { res.status(401).json({ error: 'unauthenticated' }); return }

  // (4) Tenant. Checked against the resolved principal, not the token's own
  // claim about itself, and before the record id is used for anything.
  if (meta.tenantId !== principal.tenantId) { invalid(); return }

  // (5) Subject. The URL is handed to the caller who asked for it; it is not a
  // shareable link, and a forwarded one is worth nothing to anyone else.
  if (meta.subjectId !== principal.id) { invalid(); return }

  // (6) The live scope decision — the same one `requireRecordScope` makes, from
  // the same function, so the two cannot drift.
  if (await authorizeRecordScope(principal, meta.resource, meta.recordId) === 'REFUSE') {
    invalid(); return
  }

  // (7) The version must still be active, and must still be the row this key
  // belongs to. A soft-deleted or superseded version stops being downloadable
  // now rather than when the token happens to expire.
  const live = await tenantQuery<{ storage_key: string }>(req.tenantId!, `
    SELECT storage_key FROM document_versions
    WHERE id = $1 AND status = 'active'
      AND tenant_id = current_setting('app.current_tenant_id',true)::uuid
  `, [meta.recordId])
  if (live.rows[0]?.storage_key !== meta.key) { invalid(); return }

  // Containment, belt and braces: the resolved path must stay inside the
  // storage root even though `key` is server-generated.
  const safePath = path.resolve(LOCAL_DIR, path.normalize(meta.key).replace(/^(\.\.[/\\])+/, ''))
  if (safePath !== path.resolve(LOCAL_DIR) && !safePath.startsWith(path.resolve(LOCAL_DIR) + path.sep)) {
    invalid(); return
  }
  if (!fs.existsSync(safePath)) { res.status(404).json({ error: 'file_not_found' }); return }

  // (8) Admitted. Only now is the token spent.
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

  // ADR-014 Phase 3F. `documents` is DUAL_PROJECT_OR_TENANT: a `_global`
  // document has no project and stays visible to any docs.view holder in the
  // tenant, while a project document needs live membership of that project.
  // The predicate is ANDed OUTSIDE the caller's filters and BEFORE LIMIT, so
  // `?project_id=` can only narrow the authorized set (§9) and paging describes
  // that set rather than a tenant page with holes cut in it (§14).
  const principal = await resolveCurrentUser(req as never)
  if (!principal) { res.status(401).json({ error: 'unauthenticated' }); return }
  const scope = collectionScopeSql(principal, 'documents', 'd.project_id', `$${i}`)
  const scopeVals = collectionScopeParams(principal, 'documents')
  const j = i + scopeVals.length

  const data = await tenantQuery(tenantId, `
    SELECT d.*,
           dv.original_name, dv.size_bytes, dv.mime_type, dv.uploaded_at,
           u.display_name AS uploaded_by_name
    FROM documents d
    LEFT JOIN document_versions dv ON dv.document_id = d.id AND dv.version = d.current_version
    LEFT JOIN users u ON u.id = dv.uploaded_by
    WHERE d.tenant_id=current_setting('app.current_tenant_id',true)::uuid AND d.status != 'deleted' ${where}
    ${scope}
    ORDER BY d.created_at DESC LIMIT $${j} OFFSET $${j+1}
  `, [...vals, ...scopeVals, lm, off])

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

// ─── GET /documents/:id/content — inline viewer stream ───────────────────────
//
// The in-app viewers (drawings, document preview) need to RENDER a document,
// not download it. `GET /download/:token` deliberately cannot serve them:
// AUD-006 forces `application/octet-stream` + `attachment` on that route so a
// stored polyglot can never execute in the app origin, which means a browser
// saves the file instead of displaying it.
//
// So DrawingsView pointed its iframe at `/api/v1/documents/:id/file`, a route
// that has never existed. The request fell through to the SPA catch-all and the
// iframe rendered the application's own HTML shell — a viewer that looked wired
// and displayed nothing. This is that route, built rather than aliased.
//
// It is inline, so it re-opens the AUD-006 question and answers it by TYPE
// rather than by header alone:
//
//   • the mime type must be on INLINE_SAFE_MIME_TYPES — PDF and raster images,
//     all passive formats. `image/svg+xml` is absent for the same reason it is
//     absent from the upload allowlist: SVG is script-capable.
//   • the type served is the ALLOWLIST's spelling, never the stored string, so
//     a crafted `mime_type` column cannot choose the response type.
//   • `nosniff` stops the browser second-guessing that decision, and
//     `sandbox` neutralises active content even if one ever gets through.
//   • anything else is 415 and points at the download route, which is safe for
//     arbitrary bytes precisely because it refuses to render them.
//
// Authorization is the ordinary ladder — tenant, capability, record scope on
// `documents` — so the viewer reaches exactly the documents its list does.

const INLINE_SAFE_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
])

router.get('/documents/:id/content',
  requireTenant() as never,
  requireCapability('docs.view') as never,
  requireRecordScope('documents') as never,
  async (req: Req, res: Response) => {

  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  // The document's CURRENT version, chosen by the server. A caller cannot ask
  // for an arbitrary version here; that is what /presign/:versionId is for, and
  // it carries its own record-scope guard on `document_versions`.
  //
  // Honest note on the tenant predicate below: it is defence in depth, not an
  // independent control. `requireRecordScope('documents')` is tenant-bounded on
  // the same row and has already refused a cross-tenant id by the time this
  // runs, so removing the predicate breaks no test — the mutation run records
  // it as green for that reason. It stays because this statement must remain
  // correct on its own if the guard above it is ever reordered or replaced.
  const ver = await tenantQuery<{ storage_key: string; original_name: string; mime_type: string }>(tenantId, `
    SELECT dv.storage_key, dv.original_name, dv.mime_type
    FROM documents d
    JOIN document_versions dv
      ON dv.document_id = d.id AND dv.version = d.current_version AND dv.status = 'active'
    WHERE d.id = $1 AND d.status != 'deleted'
      AND d.tenant_id = current_setting('app.current_tenant_id',true)::uuid
  `, [req.params['id']])

  const row = ver.rows[0]
  if (!row) { res.status(404).json({ error: 'not_found' }); return }

  const declared = String(row.mime_type ?? '').toLowerCase()
  if (!INLINE_SAFE_MIME_TYPES.has(declared)) {
    res.status(415).json({
      error:   'not_inline_renderable',
      message: 'This document type cannot be displayed inline. Use the download endpoint.',
    })
    return
  }

  const stream = await getStorage().readStream(row.storage_key)
  if (!stream) { res.status(404).json({ error: 'file_not_found' }); return }

  // The allowlist's own spelling, not the column's.
  res.setHeader('Content-Type', [...INLINE_SAFE_MIME_TYPES].find(m => m === declared)!)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Content-Security-Policy', 'sandbox')
  res.setHeader('Content-Disposition', `inline; filename="${path.basename(String(row.original_name ?? 'document'))}"`)
  stream.pipe(res)
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

  // ADR-014 Phase 3G. `document_folders` is DUAL_PROJECT_OR_TENANT: migration
  // 003 makes `project_id` nullable and files.ts creates folders with
  // `project_id ?? null`, so a tenant-level folder is a designed state. The
  // `doc_count` subquery carries the SAME predicate on the documents it counts
  // — a folder the caller may see must not report how many documents it holds
  // in a project they may not (§19).
  const principal = await resolveCurrentUser(req as never)
  if (!principal) { res.status(401).json({ error: 'unauthenticated' }); return }
  const folderScope = collectionScopeSql(principal, 'document_folders', 'f.project_id', `$${vals.length + 1}`)
  const docScope    = collectionScopeSql(principal, 'documents',        'd.project_id', `$${vals.length + 1}`)
  const scopeVals   = collectionScopeParams(principal, 'document_folders')

  const data = await tenantQuery(tenantId, `
    SELECT f.*, (SELECT COUNT(*) FROM documents d
                  WHERE d.folder_id=f.id AND d.status='active' ${docScope}) AS doc_count
    FROM document_folders f
    WHERE ${conds.join(' AND ')}
    ${folderScope}
    ORDER BY f.path ASC
  `, [...vals, ...scopeVals])

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
