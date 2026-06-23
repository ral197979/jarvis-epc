// Denver Engineering — Replay Support Analyzer (v10.0.0)
// Analyzes replay failures to assist support triage and root-cause identification.

import { createHash } from 'crypto'
import { pool } from '../../db/pool'
import { tenantQuery } from '../../db/pool'
import {
  ReplayIncident, ReplayIncidentStatus, ReplayRootCause,
  MAX_REPLAY_DIVERGENCE_TOLERANCE,
} from './phase10Types'

// ─── Incident management ──────────────────────────────────────────────────────

export async function openReplayIncident(
  tenantId: string,
  eventStreamId: string,
  divergenceHash: string,
  replayPassCount: number,
  replayFailCount: number,
): Promise<ReplayIncident> {
  const res = await pool.query(
    `INSERT INTO replay_incidents
      (tenant_id, event_stream_id, divergence_hash,
       replay_pass_count, replay_fail_count, status)
     VALUES ($1,$2,$3,$4,$5,'open')
     RETURNING *`,
    [tenantId, eventStreamId, divergenceHash, replayPassCount, replayFailCount],
  )
  return _mapIncident(res.rows[0])
}

export async function resolveReplayIncident(
  incidentId: string,
  rootCause: ReplayRootCause,
  resolution: string,
): Promise<ReplayIncident> {
  const res = await pool.query(
    `UPDATE replay_incidents
     SET status = 'resolved', root_cause = $2, resolution = $3, resolved_at = now()
     WHERE id = $1
     RETURNING *`,
    [incidentId, rootCause, resolution],
  )
  if (res.rows.length === 0) throw new Error(`Replay incident ${incidentId} not found`)
  return _mapIncident(res.rows[0])
}

export async function getReplayIncident(
  incidentId: string,
): Promise<ReplayIncident | null> {
  const res = await pool.query(
    `SELECT * FROM replay_incidents WHERE id = $1`,
    [incidentId],
  )
  return res.rows.length > 0 ? _mapIncident(res.rows[0]) : null
}

export async function listReplayIncidents(
  tenantId?: string,
  status?: ReplayIncidentStatus,
  limit = 20,
): Promise<ReplayIncident[]> {
  const res = await pool.query(
    `SELECT * FROM replay_incidents
     WHERE ($1::text IS NULL OR tenant_id = $1)
       AND ($2::text IS NULL OR status = $2)
     ORDER BY created_at DESC LIMIT $3`,
    [tenantId ?? null, status ?? null, limit],
  )
  return res.rows.map(_mapIncident)
}

// ─── Root-cause analysis ──────────────────────────────────────────────────────

export async function analyzeReplayDivergence(
  tenantId: string,
  eventStreamId: string,
): Promise<{
  incidentCount: number
  rootCauses: Array<{ cause: ReplayRootCause; count: number }>
  recommendation: string
}> {
  const res = await tenantQuery(
    tenantId,
    `SELECT root_cause, COUNT(*) AS cnt
     FROM replay_incidents
     WHERE tenant_id = $1 AND event_stream_id = $2
       AND root_cause IS NOT NULL
     GROUP BY root_cause
     ORDER BY cnt DESC`,
    [tenantId, eventStreamId],
  )

  const totalRes = await tenantQuery(
    tenantId,
    `SELECT COUNT(*) AS total FROM replay_incidents
     WHERE tenant_id = $1 AND event_stream_id = $2`,
    [tenantId, eventStreamId],
  )

  const rootCauses = res.rows.map(r => ({
    cause: r['root_cause'] as ReplayRootCause,
    count: Number(r['cnt']),
  }))
  const incidentCount = Number(totalRes.rows[0]?.['total'] ?? 0)
  const topCause = rootCauses[0]?.cause ?? null

  return {
    incidentCount,
    rootCauses,
    recommendation: generateRecommendation(topCause),
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function generateRecommendation(rootCause: ReplayRootCause | null): string {
  switch (rootCause) {
    case 'nondeterministic_code': return 'audit event handlers for random/time-dependent logic'
    case 'missing_event': return 'Verify event stream completeness and ordering guarantees'
    case 'schema_mismatch': return 'Check schema migrations applied before replay window'
    case 'clock_skew': return 'Enable monotonic clock source; audit timestamp sources'
    case 'external_dependency': return 'Mock or stub external calls during replay'
    default: return 'Collect replay traces and escalate to platform team'
  }
}

export function computeDivergenceHash(
  checksumA: string,
  checksumB: string,
): string {
  return createHash('sha256')
    .update(`${checksumA}≠${checksumB}`)
    .digest('hex')
    .slice(0, 16)
}

export function isDivergenceToleranceExceeded(
  failCount: number,
): boolean {
  return failCount > MAX_REPLAY_DIVERGENCE_TOLERANCE
}

export function computeDivergenceRate(
  failCount: number,
  totalCount: number,
): number {
  if (totalCount === 0) return 0
  return failCount / totalCount
}

// ─── Test hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  _mapIncident,
  generateRecommendation,
  computeDivergenceHash,
  isDivergenceToleranceExceeded,
  computeDivergenceRate,
  MAX_REPLAY_DIVERGENCE_TOLERANCE,
}

// ─── Mapper ───────────────────────────────────────────────────────────────────

function _mapIncident(row: Record<string, unknown>): ReplayIncident {
  return {
    id: row['id'] as string,
    tenantId: row['tenant_id'] as string,
    eventStreamId: row['event_stream_id'] as string,
    divergenceHash: row['divergence_hash'] as string,
    replayPassCount: Number(row['replay_pass_count'] ?? 0),
    replayFailCount: Number(row['replay_fail_count'] ?? 0),
    status: row['status'] as ReplayIncidentStatus,
    rootCause: (row['root_cause'] as ReplayRootCause) ?? null,
    resolution: (row['resolution'] as string) ?? null,
    resolvedAt: row['resolved_at'] != null ? new Date(row['resolved_at'] as string) : null,
    createdAt: new Date(row['created_at'] as string),
  }
}
