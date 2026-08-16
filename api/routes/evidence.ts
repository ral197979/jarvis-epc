/**
 * Denver Engineering — Evidence Routes (v4.35.0)
 * ────────────────────────────────────────────────
 * Ava Phase 3
 *   POST /evidence/initiate    — start upload, get presigned URL
 *   POST /evidence/confirm     — confirm upload complete
 *   POST /evidence/link        — link evidence to entity
 *   GET  /evidence/entity/:type/:id — get evidence for entity
 *   POST /evidence/:id/retry   — retry failed upload
 *   GET  /evidence/:id         — get evidence metadata
 */
import { Router, type Response } from 'express'
import type { TenantRequest as Request } from '../middleware/tenant'
import { tenantQuery } from '../db/pool'
import { requireCapability } from '../authz/requireCapability'
import {
  initiateUpload, confirmUpload, linkEvidence,
  getEvidenceForEntity, retryUpload,
} from '../services/evidence/evidencePipeline'

export const evidenceRouter = Router()

// ─── POST /evidence/initiate ──────────────────────────────────────────────────

evidenceRouter.post('/initiate', requireCapability('crossdomain.write') as never, async (req: Request, res: Response) => {
  const tenantId   = req.tenantId!
  const uploadedBy = (req as never as { auth?: { sub?: string } }).auth?.sub
  const { evidence_type, original_filename, content_type, file_size_bytes,
          device_id, captured_at, geolocation } = req.body as Record<string, unknown>

  if (!evidence_type || !original_filename || !content_type) {
    res.status(400).json({ error: 'evidence_type, original_filename, content_type required' })
    return
  }

  const result = await initiateUpload({
    tenantId,
    uploadedBy:       uploadedBy ?? 'unknown',
    evidenceType:     evidence_type as never,
    originalFilename: original_filename as string,
    contentType:      content_type as string,
    fileSizeBytes:    Number(file_size_bytes ?? 0),
    deviceId:         device_id as string | undefined,
    capturedAt:       captured_at as string | undefined,
    geolocation:      geolocation as never,
  })

  res.status(201).json({ data: result })
})

// ─── POST /evidence/confirm ───────────────────────────────────────────────────

evidenceRouter.post('/confirm', requireCapability('crossdomain.write') as never, async (req: Request, res: Response) => {
  const tenantId = req.tenantId!
  const { evidence_id, storage_key, checksum_sha256 } = req.body as {
    evidence_id: string; storage_key: string; checksum_sha256?: string
  }

  if (!evidence_id || !storage_key) {
    res.status(400).json({ error: 'evidence_id and storage_key required' })
    return
  }

  await confirmUpload({ tenantId, evidenceId: evidence_id, storageKey: storage_key, checksumSha256: checksum_sha256 })
  res.json({ data: { confirmed: true, evidence_id } })
})

// ─── POST /evidence/link ──────────────────────────────────────────────────────

evidenceRouter.post('/link', requireCapability('crossdomain.write') as never, async (req: Request, res: Response) => {
  const tenantId  = req.tenantId!
  const linkedBy  = (req as never as { auth?: { sub?: string } }).auth?.sub
  const { evidence_id, entity_type, entity_id, context } = req.body as {
    evidence_id: string; entity_type: string; entity_id: string; context?: string
  }

  if (!evidence_id || !entity_type || !entity_id) {
    res.status(400).json({ error: 'evidence_id, entity_type, entity_id required' })
    return
  }

  await linkEvidence({ tenantId, evidenceId: evidence_id, entityType: entity_type,
    entityId: entity_id, linkedBy: linkedBy ?? 'unknown', context })

  res.json({ data: { linked: true } })
})

// ─── GET /evidence/entity/:type/:id ──────────────────────────────────────────

evidenceRouter.get('/entity/:type/:id', requireCapability('crossdomain.read') as never, async (req: Request, res: Response) => {
  const tenantId  = req.tenantId!
  const entityType = req.params['type'] as string
  const entityId   = req.params['id'] as string

  const items = await getEvidenceForEntity(tenantId, entityType, entityId)
  res.json({ data: items })
})

// ─── POST /evidence/:id/retry ─────────────────────────────────────────────────

evidenceRouter.post('/:id/retry', requireCapability('platform.automation') as never, async (req: Request, res: Response) => {
  const tenantId  = req.tenantId!
  const evidenceId = req.params['id'] as string

  const ok = await retryUpload(tenantId, evidenceId)
  if (!ok) { res.status(404).json({ error: 'evidence_not_found_or_not_retryable' }); return }
  res.json({ data: { retrying: true, evidence_id: evidenceId } })
})

// ─── GET /evidence/:id ────────────────────────────────────────────────────────

evidenceRouter.get('/:id', requireCapability('crossdomain.read') as never, async (req: Request, res: Response) => {
  const tenantId  = req.tenantId!
  const evidenceId = req.params['id'] as string

  const res2 = await tenantQuery(tenantId,
    `SELECT * FROM evidence_assets WHERE id = $1 AND tenant_id = $2`,
    [evidenceId, tenantId],
  )
  if (!res2.rows[0]) { res.status(404).json({ error: 'not_found' }); return }
  res.json({ data: res2.rows[0] })
})

// ─── GET /evidence/assets/:id/scan-event (QR/NFC) ────────────────────────────
// Assets scan is co-located here since evidence and asset ops are tightly coupled

evidenceRouter.post('/assets/:id/scan', requireCapability('crossdomain.write') as never, async (req: Request, res: Response) => {
  const tenantId  = req.tenantId!
  const assetId   = req.params['id'] as string
  const scannedBy = (req as never as { auth?: { sub?: string } }).auth?.sub
  const { asset_type, scan_method, device_id, geolocation, scan_context } = req.body as {
    asset_type: string; scan_method?: string; device_id?: string;
    geolocation?: { lat: number; lng: number }; scan_context?: string
  }

  await tenantQuery(tenantId, `
    INSERT INTO asset_scan_events
      (tenant_id, asset_id, asset_type, scan_method, scanned_by, device_id, geolocation, scan_context)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
  `, [tenantId, assetId, asset_type ?? 'equipment', scan_method ?? 'qr',
      scannedBy, device_id ?? null,
      geolocation ? JSON.stringify(geolocation) : null, scan_context ?? null])

  res.status(201).json({ data: { recorded: true } })
})
