/**
 * Denver Engineering — Schedule Import Routes (v10.4.0)
 *
 * POST /api/v1/projects/:projectId/schedule/import   — upload XER or MSP XML
 * GET  /api/v1/projects/:projectId/schedule/imports  — list import job history
 */
import { Router, Request, Response } from 'express'
import multer from 'multer'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest } from '../middleware/tenant'
import { importSchedule, listImportJobs } from '../services/schedule/scheduleImportService'

import { requireCapability } from '../authz/requireCapability'
import { requireProjectScope } from '../authz/recordScope'
type R = Request & AuthenticatedRequest & TenantRequest
const p = (req: Request, key: string) => {
  const v = (req.params as Record<string, string | string[]>)[key]
  return Array.isArray(v) ? v[0] : (v ?? '')
}

// Memory storage — files are small text; max 50 MB
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /\.(xer|xml)$/i.test(file.originalname)
    if (ok) cb(null, true); else cb(new Error('Only .xer and .xml files are accepted'))
  },
})

export const scheduleImportRouter = Router()
scheduleImportRouter.use(requireAuth   as never)
scheduleImportRouter.use(requireTenant() as never)

// ─── Upload + import ──────────────────────────────────────────────────────────

// Authorization precedes multipart parsing: an unauthorized caller must not get
// as far as having their upload buffered (ADR-014 Phase 2C-1 §15).
scheduleImportRouter.post(
  '/projects/:projectId/schedule/import',
  requireCapability('schedule.write') as never, requireProjectScope() as never,
  upload.single('file') as never,
  async (req: Request, res: Response) => {
    const r = req as R & { file?: Express.Multer.File }
    if (!r.file) { res.status(400).json({ error: 'No file uploaded. Send file as multipart field "file".' }); return }

    const content = r.file.buffer.toString('utf-8')
    if (!content.trim()) { res.status(400).json({ error: 'Uploaded file is empty' }); return }

    try {
      const result = await importSchedule(
        r.tenantId!,
        p(req, 'projectId'),
        r.file.originalname,
        content,
        r.auth?.sub,
      )
      res.status(201).json({ import: result })
    } catch (e) {
      res.status(500).json({ error: 'Import failed' })
    }
  },
)

// ─── Job history ──────────────────────────────────────────────────────────────

scheduleImportRouter.get('/projects/:projectId/schedule/imports', requireCapability('schedule.view') as never, requireProjectScope() as never, async (req: Request, res: Response) => {
  const r = req as R
  try {
    const jobs = await listImportJobs(r.tenantId!, p(req, 'projectId'))
    res.json({ jobs })
  } catch (e) {
    res.status(500).json({ error: 'Failed to list import jobs' })
  }
})
