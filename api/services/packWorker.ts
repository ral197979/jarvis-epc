/**
 * Denver Engineering — Commissioning Pack Job Worker
 * ─────────────────────────────────────────────
 * v4.30.0 | Poll-based async worker for draft generation and finalization.
 *
 * Ported and TypeScript-ified from EngineeringHub v11 worker.js.
 *
 * Architecture:
 *   - No Redis / BullMQ dependency — uses PostgreSQL optimistic row locking
 *   - Polls generation_jobs every POLL_INTERVAL_MS for queued work
 *   - Locks job rows with UPDATE ... WHERE locked_at IS NULL to prevent
 *     double-processing in multi-process deployments
 *   - Retries up to max_attempts with exponential backoff via run_after
 *   - Runs in the same Node process as the API server (started from server.ts)
 *
 * Job types:
 *   generate_draft  — creates CommissioningPack from template engine
 *   finalize_pack   — applies review notes, renders MD/HTML, writes paths
 *
 * Environment:
 *   CX_PACK_CREDIT_COST   — credits consumed per draft (default: 1)
 *   CX_PACK_STORAGE_DIR   — local dir for generated artifacts (default: ./cx-packs)
 *   WORKER_ID             — unique worker identifier (default: hostname:pid)
 *   POLL_INTERVAL_MS      — poll frequency in ms (default: 4000)
 */

import { query, tenantTransaction } from '../db/pool'
import { slog } from '../../src/modules/observability/index'
import {
  buildDraftPack,
  applyReviewEdits,
  renderMarkdown,
  renderHtml,
  type PackPayload,
} from './templateEngine'
import fs   from 'node:fs/promises'
import path from 'node:path'
import os   from 'node:os'

// ─── Config ───────────────────────────────────────────────────────────────────

const PACK_CREDIT_COST  = Number(process.env['CX_PACK_CREDIT_COST']  ?? '1')
const STORAGE_DIR       = process.env['CX_PACK_STORAGE_DIR'] ?? path.join(process.cwd(), 'cx-packs')
const WORKER_ID         = process.env['WORKER_ID'] ?? `${os.hostname()}:${process.pid}`
const POLL_INTERVAL_MS  = Number(process.env['POLL_INTERVAL_MS'] ?? '4000')
const LOCK_TIMEOUT_MS   = 120_000    // reclaim stalled jobs after 2 min

// ─── Types ────────────────────────────────────────────────────────────────────

interface GenerationJob {
  id:           string
  tenant_id:    string
  created_by:   string
  type:         'generate_draft' | 'finalize_pack'
  status:       string
  payload_json: Record<string, unknown>
  attempts:     number
  max_attempts: number
}

// ─── Storage helpers ──────────────────────────────────────────────────────────

async function _ensureStorageDir(): Promise<void> {
  await fs.mkdir(STORAGE_DIR, { recursive: true })
}

async function _saveFile(filename: string, content: string): Promise<string> {
  await _ensureStorageDir()
  const filepath = path.join(STORAGE_DIR, filename)
  await fs.writeFile(filepath, content, 'utf8')
  return filepath
}

// ─── Credit balance check ─────────────────────────────────────────────────────

async function _getCreditBalance(tenantId: string): Promise<number> {
  const res = await query<{ balance: string }>(
    `SELECT COALESCE(SUM(delta), 0)::TEXT AS balance
     FROM billing_credits
     WHERE tenant_id = $1`,
    [tenantId],
  )
  return parseInt(res.rows[0]?.balance ?? '0', 10)
}

// ─── Job lock/claim ───────────────────────────────────────────────────────────

/**
 * Atomically claim a queued job for this worker.
 * Uses UPDATE ... RETURNING to prevent race conditions.
 * Also reclaims jobs locked longer than LOCK_TIMEOUT_MS (stalled workers).
 */
async function _claimJob(): Promise<GenerationJob | null> {
  const res = await query<GenerationJob>(`
    UPDATE generation_jobs
    SET    status     = 'running',
           locked_at  = NOW(),
           locked_by  = $1,
           attempts   = attempts + 1,
           updated_at = NOW()
    WHERE  id = (
      SELECT id FROM generation_jobs
      WHERE  status = 'queued'
        AND  run_after <= NOW()
        AND  attempts < max_attempts
        AND  (locked_at IS NULL OR locked_at < NOW() - INTERVAL '${LOCK_TIMEOUT_MS} milliseconds')
      ORDER BY created_at ASC
      LIMIT  1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `, [WORKER_ID])
  return res.rows[0] ?? null
}

// ─── Job: generate_draft ──────────────────────────────────────────────────────

async function _processDraft(job: GenerationJob): Promise<void> {
  const {
    packTitle,
    systemType,
    inputText    = '',
    projectId,
    sourceUploadId,
  } = job.payload_json as Record<string, string>

  if (!packTitle || !systemType) {
    throw new Error('generate_draft payload missing packTitle or systemType')
  }

  // Check credit balance
  const balance = await _getCreditBalance(job.tenant_id)
  if (balance < PACK_CREDIT_COST) {
    throw new Error(`Insufficient credits (balance: ${balance}, required: ${PACK_CREDIT_COST})`)
  }

  // Fetch extracted text from source upload if provided
  let extractedText = ''
  if (sourceUploadId) {
    const uploadRes = await query<{ extracted_text: string }>(
      `SELECT extracted_text FROM source_uploads WHERE id = $1 AND tenant_id = $2`,
      [sourceUploadId, job.tenant_id],
    )
    extractedText = uploadRes.rows[0]?.extracted_text ?? ''
  }

  // Generate draft payload via template engine (rules.ts bridge)
  const payload: PackPayload = buildDraftPack(systemType, packTitle, inputText, extractedText)

  // Create pack + deduct credits in a single transaction
  await tenantTransaction(job.tenant_id, async (client) => {
    const packRes = await client.query<{ id: string }>(`
      INSERT INTO commissioning_packs
        (tenant_id, project_id, created_by, source_upload_id,
         title, system_type, input_text, status, payload_json)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'ready_for_review', $8)
      RETURNING id
    `, [
      job.tenant_id,
      projectId   || null,
      job.created_by,
      sourceUploadId || null,
      packTitle,
      systemType,
      inputText,
      JSON.stringify(payload),
    ])

    const packId = packRes.rows[0]!.id

    // Deduct credits
    await client.query(`
      INSERT INTO billing_credits (tenant_id, delta, reason, ref_type, ref_id, created_by)
      VALUES ($1, $2, 'draft_pack_generation', 'commissioning_pack', $3, $4)
    `, [job.tenant_id, -PACK_CREDIT_COST, packId, job.created_by])

    // Write result back to job
    await client.query(`
      UPDATE generation_jobs
      SET status = 'complete', result_json = $1, locked_at = NULL, updated_at = NOW()
      WHERE id = $2
    `, [JSON.stringify({ packId }), job.id])

    slog('INFO', 'packWorker', '[draft] Pack created', {
      packId, systemType, tenantId: job.tenant_id,
    })
  })
}

// ─── Job: finalize_pack ───────────────────────────────────────────────────────

async function _processFinalize(job: GenerationJob): Promise<void> {
  const { packId, reviewNotes = '' } = job.payload_json as Record<string, string>
  if (!packId) throw new Error('finalize_pack payload missing packId')

  // Fetch pack (no tenant scoping needed — job is already tenant-scoped)
  const packRes = await query<{
    id: string; title: string; system_type: string; payload_json: PackPayload; tenant_id: string
  }>(`SELECT id, title, system_type, payload_json, tenant_id FROM commissioning_packs WHERE id = $1`, [packId])

  const pack = packRes.rows[0]
  if (!pack) throw new Error(`Pack not found: ${packId}`)
  if (pack.tenant_id !== job.tenant_id) throw new Error('Pack tenant mismatch')

  // Apply review edits
  const finalPayload = applyReviewEdits(pack.payload_json, reviewNotes)

  // Render artifacts
  const markdown = renderMarkdown(pack.title, pack.system_type, finalPayload)
  const html     = renderHtml(pack.title, pack.system_type, finalPayload)

  // Save to storage
  const mdPath   = await _saveFile(`${packId}.md`,   markdown)
  const htmlPath = await _saveFile(`${packId}.html`, html)

  // PDF: placeholder — wire Puppeteer here when available
  // const pdfPath = await _renderPdf(packId, html)
  const pdfPath: string | null = null

  // Update pack as finalized
  await tenantTransaction(job.tenant_id, async (client) => {
    await client.query(`
      UPDATE commissioning_packs
      SET status             = 'finalized',
          review_notes       = $1,
          final_payload_json = $2,
          markdown_path      = $3,
          html_path          = $4,
          pdf_path           = $5,
          updated_at         = NOW()
      WHERE id = $6
    `, [reviewNotes, JSON.stringify(finalPayload), mdPath, htmlPath, pdfPath, packId])

    await client.query(`
      UPDATE generation_jobs
      SET status = 'complete', result_json = $1, locked_at = NULL, updated_at = NOW()
      WHERE id = $2
    `, [JSON.stringify({ packId, mdPath, htmlPath }), job.id])

    slog('INFO', 'packWorker', '[finalize] Pack finalized', {
      packId, tenantId: job.tenant_id,
    })
  })
}

// ─── Job failure handler ──────────────────────────────────────────────────────

async function _failJob(job: GenerationJob, err: unknown): Promise<void> {
  const errorText = err instanceof Error ? err.message : String(err)
  const exhausted = job.attempts >= job.max_attempts

  // Exponential backoff: 30s, 2m, 8m
  const backoffMs = Math.pow(4, job.attempts) * 30_000
  const runAfter  = exhausted ? null : new Date(Date.now() + backoffMs).toISOString()

  await query(`
    UPDATE generation_jobs
    SET status     = $1,
        error_text = $2,
        run_after  = COALESCE($3::TIMESTAMPTZ, run_after),
        locked_at  = NULL,
        updated_at = NOW()
    WHERE id = $4
  `, [
    exhausted ? 'failed' : 'queued',
    errorText,
    runAfter,
    job.id,
  ])

  slog(exhausted ? 'ERROR' : 'WARN', 'packWorker',
    `[job] ${exhausted ? 'Exhausted' : 'Retrying'} — ${errorText}`,
    { jobId: job.id, type: job.type, attempts: job.attempts },
  )
}

// ─── Poll loop ────────────────────────────────────────────────────────────────

async function _tick(): Promise<void> {
  const job = await _claimJob()
  if (!job) return

  slog('INFO', 'packWorker', `[job] Claimed ${job.type}`, {
    jobId: job.id, tenantId: job.tenant_id, attempts: job.attempts,
  })

  try {
    if (job.type === 'generate_draft') await _processDraft(job)
    else if (job.type === 'finalize_pack') await _processFinalize(job)
    else throw new Error(`Unknown job type: ${job.type}`)
  } catch (err) {
    await _failJob(job, err)
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

let _timer: ReturnType<typeof setInterval> | null = null

/** Start the background poll loop. Call once from server.ts after DB is ready. */
export function startPackWorker(): void {
  if (_timer) return
  slog('INFO', 'packWorker', `[worker] Started — id=${WORKER_ID} poll=${POLL_INTERVAL_MS}ms`)
  _timer = setInterval(() => {
    _tick().catch(err => slog('ERROR', 'packWorker', '[worker] Tick error', { message: String(err) }))
  }, POLL_INTERVAL_MS)
}

/** Graceful shutdown — call in SIGTERM handler. */
export function stopPackWorker(): void {
  if (_timer) { clearInterval(_timer); _timer = null }
  slog('INFO', 'packWorker', '[worker] Stopped')
}
