// Denver Engineering — Incident Replay Workbench (Phase 12)
// Provides replay-assisted incident diagnostics and timeline reconstruction

import crypto from 'crypto'
import { pool } from '../../db/pool'
import { tenantQuery } from '../../db/pool'
import { IncidentReplaySession } from './phase12Types'

// ─── Mapper ──────────────────────────────────────────────────────────────────

function _mapReplaySession(row: Record<string, unknown>): IncidentReplaySession {
  return {
    id: row.id as string,
    incidentId: row.incident_id as string,
    tenantId: row.tenant_id as string,
    eventsReplayed: Number(row.events_replayed),
    timelineReconstructed: row.timeline_reconstructed as boolean,
    rootCauseIdentified: row.root_cause_identified as boolean,
    rootCauseSummary: row.root_cause_summary as string | null,
    replayHash: row.replay_hash as string,
    sessionAt: new Date(row.session_at as string),
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function computeIncidentReplayHash(
  incidentId: string,
  eventsReplayed: number,
  sessionAt: Date,
): string {
  const payload = `${incidentId}:${eventsReplayed}:${sessionAt.toISOString()}`
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 32)
}

export function isRootCauseFound(session: IncidentReplaySession): boolean {
  return session.rootCauseIdentified && session.rootCauseSummary !== null
}

export function hasFullTimeline(session: IncidentReplaySession): boolean {
  return session.timelineReconstructed && session.eventsReplayed > 0
}

// ─── Service ─────────────────────────────────────────────────────────────────

export async function startReplaySession(
  incidentId: string,
  tenantId: string,
): Promise<IncidentReplaySession> {
  const sessionAt = new Date()
  const replayHash = computeIncidentReplayHash(incidentId, 0, sessionAt)
  const result = await pool.query(
    `INSERT INTO p12_incident_replay_sessions
       (incident_id, tenant_id, events_replayed, timeline_reconstructed, root_cause_identified, replay_hash, session_at)
     VALUES ($1,$2,0,FALSE,FALSE,$3,$4)
     RETURNING *`,
    [incidentId, tenantId, replayHash, sessionAt],
  )
  return _mapReplaySession(result.rows[0])
}

export async function completeReplaySession(
  sessionId: string,
  eventsReplayed: number,
  timelineReconstructed: boolean,
  rootCauseIdentified: boolean,
  rootCauseSummary: string | null,
): Promise<IncidentReplaySession> {
  const result = await pool.query(
    `UPDATE p12_incident_replay_sessions
     SET events_replayed=$2, timeline_reconstructed=$3,
         root_cause_identified=$4, root_cause_summary=$5
     WHERE id=$1
     RETURNING *`,
    [sessionId, eventsReplayed, timelineReconstructed, rootCauseIdentified, rootCauseSummary],
  )
  if (!result.rows[0]) throw new Error(`ReplaySession ${sessionId} not found`)
  return _mapReplaySession(result.rows[0])
}

export async function getIncidentReplaySessions(incidentId: string): Promise<IncidentReplaySession[]> {
  const result = await pool.query(
    `SELECT * FROM p12_incident_replay_sessions
     WHERE incident_id = $1
     ORDER BY session_at DESC`,
    [incidentId],
  )
  return result.rows.map(_mapReplaySession)
}

export async function getTenantReplaySessions(tenantId: string, limit = 10): Promise<IncidentReplaySession[]> {
  const result = await tenantQuery(
    tenantId,
    `SELECT * FROM p12_incident_replay_sessions
     WHERE tenant_id = $1
     ORDER BY session_at DESC
     LIMIT $2`,
    [tenantId, limit],
  )
  return result.rows.map(_mapReplaySession)
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  computeIncidentReplayHash,
  isRootCauseFound,
  hasFullTimeline,
  _mapReplaySession,
}
