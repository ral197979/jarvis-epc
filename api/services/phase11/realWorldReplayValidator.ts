// Denver Engineering — Real-World Replay Validator (Phase 11)
// Validate replay determinism against production event streams in real time

import { pool, tenantQuery } from '../../db/pool'
import { createHash } from 'crypto'

// ─── Real-World Replay Validation Result ─────────────────────────────────────

export interface RealWorldReplayResult {
  id: string
  tenantId: string
  streamId: string
  eventCount: number
  passedEvents: number
  failedEvents: number
  deterministicRate: number
  divergedAt: Date | null
  environment: string
  validatedAt: Date
  createdAt: Date
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _mapResult(row: Record<string, unknown>): RealWorldReplayResult {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    streamId: row.stream_id as string,
    eventCount: Number(row.event_count),
    passedEvents: Number(row.passed_events),
    failedEvents: Number(row.failed_events),
    deterministicRate: Number(row.deterministic_rate),
    divergedAt: row.diverged_at ? new Date(row.diverged_at as string) : null,
    environment: row.environment as string,
    validatedAt: new Date(row.validated_at as string),
    createdAt: new Date(row.created_at as string),
  }
}

// ─── Compute Replay Hash ──────────────────────────────────────────────────────

export function computeReplayHash(payload: Record<string, unknown>): string {
  const canonical = JSON.stringify(payload, Object.keys(payload).sort())
  return createHash('sha256').update(canonical).digest('hex')
}

// ─── Validate Stream Against Production ──────────────────────────────────────

export async function validateStreamAgainstProduction(
  tenantId: string,
  streamId: string,
  environment: string
): Promise<RealWorldReplayResult> {
  // Get production events for this stream
  const productionEvents = await tenantQuery(
    tenantId,
    `SELECT id, payload, replay_hash FROM replay_events
     WHERE stream_id = $1 AND status = 'committed'
     ORDER BY sequence_number ASC`,
    [streamId]
  )

  let passedEvents = 0
  let failedEvents = 0
  let divergedAt: Date | null = null

  for (const event of productionEvents as Record<string, unknown>[]) {
    const storedHash = event.replay_hash as string
    const computedHash = computeReplayHash(event.payload as Record<string, unknown>)

    if (computedHash === storedHash) {
      passedEvents++
    } else {
      failedEvents++
      if (!divergedAt) divergedAt = new Date()
    }
  }

  const eventCount = productionEvents.length
  const deterministicRate = eventCount === 0 ? 1 : passedEvents / eventCount

  const result = await pool.query(
    `INSERT INTO real_world_replay_results
       (tenant_id, stream_id, event_count, passed_events, failed_events,
        deterministic_rate, diverged_at, environment, validated_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
     RETURNING *`,
    [tenantId, streamId, eventCount, passedEvents, failedEvents, deterministicRate, divergedAt, environment]
  )
  return _mapResult(result.rows[0])
}

// ─── Get Validation Result ────────────────────────────────────────────────────

export async function getValidationResult(resultId: string): Promise<RealWorldReplayResult | null> {
  const result = await pool.query(
    `SELECT * FROM real_world_replay_results WHERE id = $1`,
    [resultId]
  )
  return result.rows.length > 0 ? _mapResult(result.rows[0]) : null
}

// ─── List Validation Results ──────────────────────────────────────────────────

export async function listValidationResults(
  tenantId: string,
  environment: string
): Promise<RealWorldReplayResult[]> {
  const rows = await tenantQuery(
    tenantId,
    `SELECT * FROM real_world_replay_results
     WHERE environment = $1
     ORDER BY validated_at DESC`,
    [environment]
  )
  return (rows as Record<string, unknown>[]).map(_mapResult)
}

// ─── Compute Overall Determinism Rate ────────────────────────────────────────

export function computeOverallDeterminismRate(results: RealWorldReplayResult[]): number {
  if (results.length === 0) return 1
  const totalEvents = results.reduce((acc, r) => acc + r.eventCount, 0)
  const totalPassed = results.reduce((acc, r) => acc + r.passedEvents, 0)
  return totalEvents === 0 ? 1 : totalPassed / totalEvents
}

// ─── Has Divergence ───────────────────────────────────────────────────────────

export function hasDivergence(results: RealWorldReplayResult[]): boolean {
  return results.some(r => r.failedEvents > 0)
}

// ─── Get Diverged Streams ─────────────────────────────────────────────────────

export async function getDivergedStreams(
  environment: string
): Promise<RealWorldReplayResult[]> {
  const result = await pool.query(
    `SELECT * FROM real_world_replay_results
     WHERE environment = $1 AND failed_events > 0
     ORDER BY validated_at DESC`,
    [environment]
  )
  return result.rows.map(_mapResult)
}

// ─── Is Determinism Acceptable ────────────────────────────────────────────────

export function isDeterminismAcceptable(rate: number): boolean {
  return rate === 1.0 // Zero tolerance for divergence
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  _mapResult,
  computeReplayHash,
  computeOverallDeterminismRate,
  hasDivergence,
  isDeterminismAcceptable,
}
