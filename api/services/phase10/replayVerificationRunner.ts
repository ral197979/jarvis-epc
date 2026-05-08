// Denver Engineering — Replay Verification Runner (v10.0.0)
// Verifies that event replay is fully deterministic across multiple passes.

import { createHash } from 'crypto'
import { pool } from '../../db/pool'
import { tenantQuery } from '../../db/pool'
import {
  ReplayVerificationRun, ReplayVerificationStatus,
  MAX_REPLAY_DIVERGENCE_TOLERANCE,
} from './phase10Types'

// ─── Verification runs ────────────────────────────────────────────────────────

export interface StartVerificationInput {
  workflowId?: string
  eventStreamId?: string
  replayCount?: number
}

export async function startVerification(
  input: StartVerificationInput,
): Promise<ReplayVerificationRun> {
  const res = await pool.query(
    `INSERT INTO replay_verification_runs
      (workflow_id, event_stream_id, replay_count,
       deterministic_passes, deterministic_failures, status)
     VALUES ($1,$2,$3,0,0,'pending')
     RETURNING *`,
    [
      input.workflowId ?? null,
      input.eventStreamId ?? null,
      input.replayCount ?? 3,
    ],
  )
  return _mapRun(res.rows[0])
}

export async function recordReplayPass(
  runId: string,
  checksumA: string,
  checksumB: string,
): Promise<{ deterministic: boolean }> {
  const deterministic = checksumA === checksumB
  const column = deterministic ? 'deterministic_passes' : 'deterministic_failures'

  await pool.query(
    `UPDATE replay_verification_runs
     SET ${column} = ${column} + 1,
         divergence_details = CASE
           WHEN $2 = FALSE THEN jsonb_build_object(
             'checksumA', $3::text, 'checksumB', $4::text
           )
           ELSE divergence_details
         END
     WHERE id = $1`,
    [runId, deterministic, checksumA, checksumB],
  )
  return { deterministic }
}

export async function completeVerification(
  runId: string,
): Promise<ReplayVerificationRun> {
  const run = await getVerificationRun(runId)
  if (run == null) throw new Error(`Verification run ${runId} not found`)

  const diverged = run.deterministicFailures > MAX_REPLAY_DIVERGENCE_TOLERANCE
  const status: ReplayVerificationStatus = diverged ? 'failed' : 'passed'

  const res = await pool.query(
    `UPDATE replay_verification_runs
     SET status = $2, verified_at = now()
     WHERE id = $1
     RETURNING *`,
    [runId, status],
  )
  return _mapRun(res.rows[0])
}

export async function getVerificationRun(
  runId: string,
): Promise<ReplayVerificationRun | null> {
  const res = await pool.query(
    `SELECT * FROM replay_verification_runs WHERE id = $1`,
    [runId],
  )
  return res.rows.length > 0 ? _mapRun(res.rows[0]) : null
}

export async function listVerificationRuns(
  workflowId?: string,
  limit = 10,
): Promise<ReplayVerificationRun[]> {
  const res = await pool.query(
    `SELECT * FROM replay_verification_runs
     WHERE ($1::text IS NULL OR workflow_id = $1)
     ORDER BY created_at DESC LIMIT $2`,
    [workflowId ?? null, limit],
  )
  return res.rows.map(_mapRun)
}

// ─── Tenant-scoped replay verification ────────────────────────────────────────

export async function verifyTenantReplay(
  tenantId: string,
  eventStreamId: string,
  replayA: Record<string, unknown>,
  replayB: Record<string, unknown>,
): Promise<{ deterministic: boolean; divergenceHash: string | null }> {
  const hashA = computeReplayHash(replayA)
  const hashB = computeReplayHash(replayB)
  const deterministic = hashA === hashB

  await tenantQuery(
    tenantId,
    `INSERT INTO tenant_replay_verifications
      (tenant_id, event_stream_id, hash_a, hash_b, deterministic, verified_at)
     VALUES ($1,$2,$3,$4,$5,now())`,
    [tenantId, eventStreamId, hashA, hashB, deterministic],
  )

  return {
    deterministic,
    divergenceHash: deterministic ? null : `${hashA}≠${hashB}`,
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function computeReplayHash(payload: Record<string, unknown>): string {
  const canonical = JSON.stringify(payload, Object.keys(payload).sort())
  return createHash('sha256').update(canonical).digest('hex')
}

export function isDeterministic(
  passes: number,
  failures: number,
): boolean {
  return failures <= MAX_REPLAY_DIVERGENCE_TOLERANCE
}

export function computeDeterminismRate(
  passes: number,
  total: number,
): number {
  if (total === 0) return 1.0
  return passes / total
}

// ─── Test hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  _mapRun,
  computeReplayHash,
  isDeterministic,
  computeDeterminismRate,
  MAX_REPLAY_DIVERGENCE_TOLERANCE,
}

// ─── Mapper ───────────────────────────────────────────────────────────────────

function _mapRun(row: Record<string, unknown>): ReplayVerificationRun {
  return {
    id: row['id'] as string,
    workflowId: (row['workflow_id'] as string) ?? null,
    eventStreamId: (row['event_stream_id'] as string) ?? null,
    replayCount: Number(row['replay_count'] ?? 3),
    deterministicPasses: Number(row['deterministic_passes'] ?? 0),
    deterministicFailures: Number(row['deterministic_failures'] ?? 0),
    status: row['status'] as ReplayVerificationStatus,
    divergenceDetails: row['divergence_details'] != null
      ? (typeof row['divergence_details'] === 'string'
        ? JSON.parse(row['divergence_details'] as string)
        : row['divergence_details']) as Record<string, unknown>
      : null,
    verifiedAt: row['verified_at'] != null ? new Date(row['verified_at'] as string) : null,
    createdAt: new Date(row['created_at'] as string),
  }
}
