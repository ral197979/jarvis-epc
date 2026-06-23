/**
 * Denver Engineering — Generic Scheduler + Background Job Runner
 * ──────────────────────────────────────────────────────────
 * v4.31.0 | Cron-style recurring jobs on top of Pack Worker pattern.
 *
 * This is the companion to packWorker.ts. Whereas packWorker polls
 * the `generation_jobs` enum-typed queue for commissioning work,
 * this service polls the TEXT-typed `background_jobs` queue so new
 * features can register handlers at runtime without schema churn.
 *
 * Architecture:
 *   1. Handler registry    — `registerHandler(type, fn)`
 *   2. Ad-hoc enqueue      — `enqueue(tenantId, type, payload, opts?)`
 *   3. Recurring promotion — scheduled_jobs rows with next_run_at <= NOW()
 *                            are inserted into background_jobs on each tick
 *   4. Job claim + run     — FOR UPDATE SKIP LOCKED, exponential backoff
 *
 * Adding a new automated feature is two lines:
 *   registerHandler('webhook_dispatch', async (job) => { ... })
 *   await enqueue(tenantId, 'webhook_dispatch', { ... })
 *
 * For recurring work, insert a scheduled_jobs row (e.g. interval_seconds=86400)
 * and the scheduler will promote it into a background_jobs row each cycle.
 */

import { query } from '../db/pool'
import { slog } from '../../src/modules/observability/index'
import { jobTotal, jobDurationMs } from './observability/metrics'
import os from 'node:os'

// ─── Config ───────────────────────────────────────────────────────────────────

const WORKER_ID        = process.env['SCHEDULER_WORKER_ID'] ?? `scheduler:${os.hostname()}:${process.pid}`
const POLL_INTERVAL_MS = Number(process.env['SCHEDULER_POLL_INTERVAL_MS'] ?? '5000')
const LOCK_TIMEOUT_MS  = 120_000    // reclaim stalled jobs after 2 min

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BackgroundJob {
  id:                string
  tenant_id:         string
  scheduled_job_id:  string | null
  created_by:        string | null
  job_type:          string
  payload_json:      Record<string, unknown>
  attempts:          number
  max_attempts:      number
}

export type JobHandler = (job: BackgroundJob) => Promise<Record<string, unknown> | void>

export interface EnqueueOptions {
  runAfter?:    Date | string          // delay; default NOW()
  maxAttempts?: number                 // default 3
  createdBy?:   string                 // user id, optional
  scheduledJobId?: string              // link to recurring definition
}

// ─── Handler registry ─────────────────────────────────────────────────────────

const _handlers = new Map<string, JobHandler>()

/**
 * Register a handler for a given job_type. Later registrations overwrite
 * earlier ones (useful for hot-swapping in tests).
 */
export function registerHandler(jobType: string, handler: JobHandler): void {
  _handlers.set(jobType, handler)
  slog('INFO', 'scheduler', `[handler] Registered ${jobType}`)
}

/** For introspection / admin UIs. */
export function listRegisteredHandlers(): string[] {
  return Array.from(_handlers.keys()).sort()
}

// ─── Promoter registry ────────────────────────────────────────────────────────

type Promoter = () => Promise<void>
const _promoters: Promoter[] = []

/**
 * Register a scan function that runs on each scheduler tick, BEFORE the
 * built-in scheduled_jobs promotion. Use this when a domain table already
 * owns its own schedule (e.g. integrations.sync_interval,
 * compliance_tasks.due_at) and you want to enqueue background_jobs for
 * any row that's due, without duplicating the schedule into scheduled_jobs.
 *
 * Promoters MUST be idempotent — they run once per tick (≈5s) and may run
 * concurrently with other workers. Use atomic UPDATE ... RETURNING + FOR
 * UPDATE SKIP LOCKED to claim due rows exactly once across instances.
 */
export function registerPromoter(fn: Promoter): void {
  _promoters.push(fn)
}

// ─── Ad-hoc enqueue ───────────────────────────────────────────────────────────

/**
 * Insert a one-off job. Returns the new row id. Handlers don't need
 * to be registered at enqueue time — only at tick time.
 */
export async function enqueue(
  tenantId: string,
  jobType:  string,
  payload:  Record<string, unknown>,
  opts:     EnqueueOptions = {},
): Promise<string> {
  const res = await query<{ id: string }>(`
    INSERT INTO background_jobs
      (tenant_id, scheduled_job_id, created_by, job_type,
       payload_json, max_attempts, run_after)
    VALUES ($1, $2, $3, $4, $5::jsonb, $6, COALESCE($7::TIMESTAMPTZ, NOW()))
    RETURNING id
  `, [
    tenantId,
    opts.scheduledJobId ?? null,
    opts.createdBy      ?? null,
    jobType,
    JSON.stringify(payload),
    opts.maxAttempts    ?? 3,
    opts.runAfter ? new Date(opts.runAfter).toISOString() : null,
  ])
  const id = res.rows[0]!.id
  slog('INFO', 'scheduler', `[enqueue] ${jobType}`, { jobId: id, tenantId })
  return id
}

// ─── Scheduled-job promotion ──────────────────────────────────────────────────

/**
 * Promote any due recurring definitions into background_jobs rows.
 *
 * For each row where enabled=TRUE AND next_run_at <= NOW():
 *   1. Insert a background_jobs row with the same payload
 *   2. Advance next_run_at by interval_seconds (if set)
 *   3. If no interval (one-shot), disable the definition
 *
 * cron_expression is reserved — not parsed here in v1.
 */
async function _promoteDueScheduled(): Promise<number> {
  // Select-then-update pattern is fine — row count here is small (cron defs,
  // not individual jobs) and we want to operate per-row to compute next_run_at.
  const due = await query<{
    id: string
    tenant_id: string
    job_type: string
    payload_json: Record<string, unknown>
    interval_seconds: number | null
    max_attempts: number
    created_by: string | null
  }>(`
    SELECT id, tenant_id, job_type, payload_json,
           interval_seconds, max_attempts, created_by
    FROM scheduled_jobs
    WHERE enabled = TRUE
      AND next_run_at <= NOW()
    ORDER BY next_run_at ASC
    LIMIT 50
  `)

  if (due.rows.length === 0) return 0

  let promoted = 0
  for (const def of due.rows) {
    try {
      const jobId = await enqueue(def.tenant_id, def.job_type, def.payload_json, {
        maxAttempts:    def.max_attempts,
        createdBy:      def.created_by ?? undefined,
        scheduledJobId: def.id,
      })

      if (def.interval_seconds && def.interval_seconds > 0) {
        // Advance cadence. GREATEST prevents drift when a tick is late:
        // if next_run_at fell far behind NOW(), jump to NOW() + interval
        // instead of replaying all missed intervals.
        await query(`
          UPDATE scheduled_jobs
          SET last_run_at = NOW(),
              last_job_id = $1,
              next_run_at = GREATEST(
                next_run_at + ($2 || ' seconds')::INTERVAL,
                NOW()           + ($2 || ' seconds')::INTERVAL
              ),
              updated_at  = NOW()
          WHERE id = $3
        `, [jobId, String(def.interval_seconds), def.id])
      } else {
        // One-shot: disable after firing
        await query(`
          UPDATE scheduled_jobs
          SET enabled     = FALSE,
              last_run_at = NOW(),
              last_job_id = $1,
              updated_at  = NOW()
          WHERE id = $2
        `, [jobId, def.id])
      }

      promoted++
    } catch (err) {
      slog('ERROR', 'scheduler', '[promote] Failed to promote recurring def', {
        scheduledJobId: def.id,
        jobType: def.job_type,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return promoted
}

// ─── Job claim ────────────────────────────────────────────────────────────────

async function _claimJob(): Promise<BackgroundJob | null> {
  const res = await query<BackgroundJob>(`
    UPDATE background_jobs
    SET    status     = 'running',
           locked_at  = NOW(),
           locked_by  = $1,
           attempts   = attempts + 1,
           updated_at = NOW()
    WHERE  id = (
      SELECT id FROM background_jobs
      WHERE  status = 'queued'
        AND  run_after <= NOW()
        AND  attempts < max_attempts
        AND  (locked_at IS NULL OR locked_at < NOW() - INTERVAL '${LOCK_TIMEOUT_MS} milliseconds')
      ORDER BY created_at ASC
      LIMIT  1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, tenant_id, scheduled_job_id, created_by,
              job_type, payload_json, attempts, max_attempts
  `, [WORKER_ID])
  return res.rows[0] ?? null
}

// ─── Job failure handler ──────────────────────────────────────────────────────

async function _failJob(job: BackgroundJob, err: unknown): Promise<void> {
  const errorText = err instanceof Error ? err.message : String(err)
  const exhausted = job.attempts >= job.max_attempts

  // Exponential backoff: 30s, 2m, 8m
  const backoffMs = Math.pow(4, job.attempts) * 30_000
  const runAfter  = exhausted ? null : new Date(Date.now() + backoffMs).toISOString()

  await query(`
    UPDATE background_jobs
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

  slog(exhausted ? 'ERROR' : 'WARN', 'scheduler',
    `[job] ${exhausted ? 'Exhausted' : 'Retrying'} — ${errorText}`,
    { jobId: job.id, type: job.job_type, attempts: job.attempts },
  )
}

// ─── Job completion ───────────────────────────────────────────────────────────

async function _completeJob(job: BackgroundJob, result: Record<string, unknown> | void): Promise<void> {
  await query(`
    UPDATE background_jobs
    SET status      = 'complete',
        result_json = $1::jsonb,
        error_text  = NULL,
        locked_at   = NULL,
        updated_at  = NOW()
    WHERE id = $2
  `, [result ? JSON.stringify(result) : null, job.id])
}

// ─── Poll tick ────────────────────────────────────────────────────────────────

async function _tick(): Promise<void> {
  // 1a. Run domain-specific promoters (e.g. integration sync scanner).
  //     Each failure is isolated so one bad promoter can't block the tick.
  for (const promoter of _promoters) {
    try {
      await promoter()
    } catch (err) {
      slog('ERROR', 'scheduler', '[promoter] Failed', {
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // 1b. Promote any due scheduled_jobs recurring definitions
  await _promoteDueScheduled()

  // 2. Claim and run one queued job (keep per-tick work small; next tick picks up the rest)
  const job = await _claimJob()
  if (!job) return

  const handler = _handlers.get(job.job_type)
  if (!handler) {
    // No handler registered — fail fast so it doesn't spin in the queue
    await _failJob(job, new Error(`No handler registered for job_type='${job.job_type}'`))
    return
  }

  slog('INFO', 'scheduler', `[job] Claimed ${job.job_type}`, {
    jobId: job.id, tenantId: job.tenant_id, attempts: job.attempts,
  })

  const jobStart = Date.now()
  try {
    const result = await handler(job)
    await _completeJob(job, result)
    const elapsed = Date.now() - jobStart
    jobTotal.inc({ job_type: job.job_type, status: 'success' })
    jobDurationMs.observe({ job_type: job.job_type }, elapsed)
    slog('INFO', 'scheduler', `[job] Complete ${job.job_type}`, { jobId: job.id })
  } catch (err) {
    jobTotal.inc({ job_type: job.job_type, status: 'failed' })
    jobDurationMs.observe({ job_type: job.job_type }, Date.now() - jobStart)
    await _failJob(job, err)
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

let _timer: ReturnType<typeof setInterval> | null = null

/** Start the scheduler poll loop. Call once from server.ts after DB is ready. */
export function startScheduler(): void {
  if (_timer) return
  slog('INFO', 'scheduler', `[scheduler] Started — id=${WORKER_ID} poll=${POLL_INTERVAL_MS}ms`)
  _timer = setInterval(() => {
    _tick().catch(err => slog('ERROR', 'scheduler', '[scheduler] Tick error', {
      message: err instanceof Error ? err.message : String(err),
    }))
  }, POLL_INTERVAL_MS)
}

/** Graceful shutdown — call in SIGTERM handler. */
export function stopScheduler(): void {
  if (_timer) { clearInterval(_timer); _timer = null }
  slog('INFO', 'scheduler', '[scheduler] Stopped')
}
