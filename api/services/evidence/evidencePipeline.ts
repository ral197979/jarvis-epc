/**
 * Denver Engineering — Field Evidence Ingestion Pipeline (v4.35.0)
 * ─────────────────────────────────────────────────────────────────
 * Ava Phase 3 — Centralized evidence ingestion for photos, videos,
 * voice notes, PDFs, markups, and annotated drawings.
 *
 * Architecture:
 *   1. Client initiates upload → receives presigned URL
 *   2. Client uploads directly to storage (no server proxy)
 *   3. Client confirms upload → enqueues processing jobs
 *   4. Background worker: compress, thumbnail, OCR, AI tag
 */
import { pool } from '../../db/pool'

// ─── Types ────────────────────────────────────────────────────────────────────

export type EvidenceType = 'photo' | 'video' | 'voice_note' | 'pdf' | 'markup' | 'annotated_drawing' | 'document'

export interface InitiateUploadInput {
  tenantId:         string
  uploadedBy:       string
  evidenceType:     EvidenceType
  originalFilename: string
  contentType:      string
  fileSizeBytes:    number
  deviceId?:        string
  capturedAt?:      string
  geolocation?:     { lat: number; lng: number; accuracy_meters?: number }
}

export interface ConfirmUploadInput {
  tenantId:       string
  evidenceId:     string
  storageKey:     string
  checksumSha256?: string
}

export interface LinkEvidenceInput {
  tenantId:    string
  evidenceId:  string
  entityType:  string
  entityId:    string
  linkedBy:    string
  context?:    string
}

// ─── Upload initiation ────────────────────────────────────────────────────────

export async function initiateUpload(input: InitiateUploadInput): Promise<{
  evidenceId: string
  storageKey: string
  uploadUrl:  string
}> {
  // Generate a storage key
  const storageKey = `evidence/${input.tenantId}/${Date.now()}-${input.originalFilename}`

  const res = await pool.query(`
    INSERT INTO evidence_assets
      (tenant_id, uploaded_by, evidence_type, status, storage_key,
       original_filename, content_type, file_size_bytes, device_id,
       captured_at, geolocation, upload_attempts)
    VALUES ($1,$2,$3,'uploading',$4,$5,$6,$7,$8,$9,$10,1)
    RETURNING id
  `, [
    input.tenantId, input.uploadedBy, input.evidenceType, storageKey,
    input.originalFilename, input.contentType, input.fileSizeBytes,
    input.deviceId ?? null,
    input.capturedAt ?? null,
    input.geolocation ? JSON.stringify(input.geolocation) : null,
  ])

  const evidenceId = res.rows[0].id as string

  // In production, generate a presigned S3/GCS URL here
  // For now, return a placeholder URL
  const uploadUrl = `/api/v1/evidence/${evidenceId}/upload`

  return { evidenceId, storageKey, uploadUrl }
}

// ─── Upload confirmation ──────────────────────────────────────────────────────

export async function confirmUpload(input: ConfirmUploadInput): Promise<void> {
  // Dedup check: if another asset with same checksum exists, mark as duplicate
  if (input.checksumSha256) {
    const dupRes = await pool.query(`
      SELECT id FROM evidence_assets
      WHERE tenant_id = $1 AND checksum_sha256 = $2 AND id != $3 AND status != 'uploading'
    `, [input.tenantId, input.checksumSha256, input.evidenceId])
    if (dupRes.rows[0]) {
      // Mark as duplicate — will be linked to the original
      await pool.query(`
        UPDATE evidence_assets SET status = 'archived', updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2
      `, [input.evidenceId, input.tenantId])
      return
    }
  }

  await pool.query(`
    UPDATE evidence_assets SET
      status          = 'uploaded',
      storage_key     = $3,
      checksum_sha256 = $4,
      last_upload_at  = NOW(),
      updated_at      = NOW()
    WHERE id = $1 AND tenant_id = $2
  `, [input.evidenceId, input.tenantId, input.storageKey, input.checksumSha256 ?? null])

  // Enqueue processing jobs
  await _enqueueProcessingJobs(input.tenantId, input.evidenceId)
}

// ─── Processing job queue ─────────────────────────────────────────────────────

const JOB_TYPES: Record<EvidenceType, string[]> = {
  photo:             ['compress', 'thumbnail', 'ai_tag'],
  video:             ['compress', 'thumbnail', 'transcode'],
  voice_note:        ['compress'],
  pdf:               ['thumbnail', 'ocr'],
  markup:            ['thumbnail'],
  annotated_drawing: ['thumbnail', 'ocr'],
  document:          ['thumbnail', 'ocr'],
}

async function _enqueueProcessingJobs(tenantId: string, evidenceId: string): Promise<void> {
  const res = await pool.query(
    `SELECT evidence_type FROM evidence_assets WHERE id = $1 AND tenant_id = $2`,
    [evidenceId, tenantId],
  )
  if (!res.rows[0]) return

  const evidenceType = res.rows[0].evidence_type as EvidenceType
  const jobTypes = JOB_TYPES[evidenceType] ?? ['compress']

  for (const jobType of jobTypes) {
    await pool.query(`
      INSERT INTO evidence_processing_jobs
        (tenant_id, evidence_id, job_type, status)
      VALUES ($1, $2, $3, 'pending')
      ON CONFLICT DO NOTHING
    `, [tenantId, evidenceId, jobType])
  }

  // Update asset status to processing
  await pool.query(`
    UPDATE evidence_assets SET status = 'processing', updated_at = NOW()
    WHERE id = $1 AND tenant_id = $2
  `, [evidenceId, tenantId])
}

// ─── Evidence linking ─────────────────────────────────────────────────────────

export async function linkEvidence(input: LinkEvidenceInput): Promise<void> {
  await pool.query(`
    INSERT INTO evidence_links
      (tenant_id, evidence_id, entity_type, entity_id, linked_by, context)
    VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT (tenant_id, evidence_id, entity_type, entity_id) DO NOTHING
  `, [
    input.tenantId, input.evidenceId, input.entityType,
    input.entityId, input.linkedBy, input.context ?? null,
  ])
}

// ─── Evidence retrieval ───────────────────────────────────────────────────────

export async function getEvidenceForEntity(
  tenantId:   string,
  entityType: string,
  entityId:   string,
): Promise<unknown[]> {
  const res = await pool.query(`
    SELECT ea.*, el.context, el.linked_at
    FROM evidence_links el
    JOIN evidence_assets ea ON ea.id = el.evidence_id
    WHERE el.tenant_id = $1
      AND el.entity_type = $2
      AND el.entity_id = $3
      AND ea.status NOT IN ('uploading','archived')
    ORDER BY el.linked_at DESC
  `, [tenantId, entityType, entityId])
  return res.rows
}

// ─── Upload retry ─────────────────────────────────────────────────────────────

export async function retryUpload(tenantId: string, evidenceId: string): Promise<boolean> {
  const res = await pool.query(`
    UPDATE evidence_assets SET
      upload_attempts = upload_attempts + 1,
      last_upload_at  = NOW(),
      status          = 'uploading',
      updated_at      = NOW()
    WHERE id = $1 AND tenant_id = $2 AND status IN ('uploading','failed')
    RETURNING id
  `, [evidenceId, tenantId])
  return res.rows.length > 0
}

// ─── Processing worker (claim + process) ─────────────────────────────────────

export async function claimProcessingJob(workerId: string): Promise<unknown | null> {
  const res = await pool.query(`
    UPDATE evidence_processing_jobs SET
      status       = 'processing',
      locked_until = NOW() + INTERVAL '5 minutes',
      locked_by    = $1,
      started_at   = NOW(),
      attempts     = attempts + 1
    WHERE id = (
      SELECT id FROM evidence_processing_jobs
      WHERE status IN ('pending','failed')
        AND run_after <= NOW()
        AND (locked_until IS NULL OR locked_until < NOW())
        AND attempts < max_attempts
      ORDER BY run_after
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `, [workerId])
  return res.rows[0] ?? null
}

export async function completeProcessingJob(
  jobId:  string,
  result: Record<string, unknown>,
): Promise<void> {
  await pool.query(`
    UPDATE evidence_processing_jobs SET
      status       = 'completed',
      result       = $2,
      completed_at = NOW(),
      locked_until = NULL
    WHERE id = $1
  `, [jobId, JSON.stringify(result)])
}

export async function failProcessingJob(jobId: string, error: string): Promise<void> {
  await pool.query(`
    UPDATE evidence_processing_jobs SET
      status   = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
      error    = $2,
      run_after = NOW() + (INTERVAL '30 seconds' * POWER(2, attempts)),
      locked_until = NULL
    WHERE id = $1
  `, [jobId, error])
}

// ─── Test hooks ───────────────────────────────────────────────────────────────

export const __testHooks = { _enqueueProcessingJobs, JOB_TYPES }
