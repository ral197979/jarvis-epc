// Denver Engineering — Replay Integrity Auditor (v10.0.0)
// Audits replay integrity across event streams; produces immutable audit trails.

import { createHash } from 'crypto'
import { default as pool } from '../../db/pool'
import { tenantQuery } from '../../db/pool'
import {
  ReplayIntegrityAudit, IntegrityAuditStatus, IntegrityViolation,
  MAX_REPLAY_DIVERGENCE_TOLERANCE,
} from './phase10Types'

// ─── Audit lifecycle ──────────────────────────────────────────────────────────

export async function startIntegrityAudit(
  environment: string,
  auditedBy: string,
  eventStreamIds: string[],
): Promise<ReplayIntegrityAudit> {
  const res = await pool.query(
    `INSERT INTO replay_integrity_audits
      (environment, audited_by, event_stream_ids, status,
       streams_audited, violations_found, audit_hash)
     VALUES ($1,$2,$3,'running',0,0,NULL)
     RETURNING *`,
    [environment, auditedBy, JSON.stringify(eventStreamIds)],
  )
  return _mapAudit(res.rows[0])
}

export async function recordIntegrityViolation(
  auditId: string,
  eventStreamId: string,
  violationType: string,
  description: string,
  severity: 'critical' | 'warning',
  evidence: Record<string, unknown> = {},
): Promise<IntegrityViolation> {
  const res = await pool.query(
    `INSERT INTO integrity_violations
      (audit_id, event_stream_id, violation_type, description, severity, evidence, detected_at)
     VALUES ($1,$2,$3,$4,$5,$6,now())
     RETURNING *`,
    [auditId, eventStreamId, violationType, description, severity, JSON.stringify(evidence)],
  )
  return _mapViolation(res.rows[0])
}

export async function completeIntegrityAudit(
  auditId: string,
  streamsAudited: number,
): Promise<ReplayIntegrityAudit> {
  const violationsRes = await pool.query(
    `SELECT COUNT(*) AS cnt FROM integrity_violations WHERE audit_id = $1`,
    [auditId],
  )
  const violationsFound = Number(violationsRes.rows[0]?.['cnt'] ?? 0)
  const status: IntegrityAuditStatus = violationsFound > 0 ? 'violations_found' : 'clean'
  const auditHash = computeAuditHash(auditId, streamsAudited, violationsFound)

  const res = await pool.query(
    `UPDATE replay_integrity_audits
     SET status = $2, streams_audited = $3, violations_found = $4,
         audit_hash = $5, completed_at = now()
     WHERE id = $1
     RETURNING *`,
    [auditId, status, streamsAudited, violationsFound, auditHash],
  )
  return _mapAudit(res.rows[0])
}

export async function getIntegrityAudit(
  auditId: string,
): Promise<ReplayIntegrityAudit | null> {
  const res = await pool.query(
    `SELECT * FROM replay_integrity_audits WHERE id = $1`,
    [auditId],
  )
  return res.rows.length > 0 ? _mapAudit(res.rows[0]) : null
}

export async function getIntegrityViolations(
  auditId: string,
): Promise<IntegrityViolation[]> {
  const res = await pool.query(
    `SELECT * FROM integrity_violations WHERE audit_id = $1
     ORDER BY severity DESC, detected_at`,
    [auditId],
  )
  return res.rows.map(_mapViolation)
}

export async function listIntegrityAudits(
  environment?: string,
  limit = 10,
): Promise<ReplayIntegrityAudit[]> {
  const res = await pool.query(
    `SELECT * FROM replay_integrity_audits
     WHERE ($1::text IS NULL OR environment = $1)
     ORDER BY created_at DESC LIMIT $2`,
    [environment ?? null, limit],
  )
  return res.rows.map(_mapAudit)
}

// ─── Tenant replay integrity check ────────────────────────────────────────────

export async function auditTenantStreamIntegrity(
  tenantId: string,
  eventStreamId: string,
  auditId: string,
): Promise<{ clean: boolean; violationCount: number }> {
  const res = await tenantQuery(
    tenantId,
    `SELECT COUNT(*) AS violations
     FROM replay_incidents
     WHERE tenant_id = $1 AND event_stream_id = $2 AND status = 'open'`,
    [tenantId, eventStreamId],
  )
  const violationCount = Number(res.rows[0]?.['violations'] ?? 0)
  if (violationCount > MAX_REPLAY_DIVERGENCE_TOLERANCE) {
    await recordIntegrityViolation(
      auditId, eventStreamId,
      'open_replay_incidents',
      `${violationCount} unresolved replay incidents for stream ${eventStreamId}`,
      'critical',
      { tenantId, violationCount },
    )
  }
  return { clean: violationCount <= MAX_REPLAY_DIVERGENCE_TOLERANCE, violationCount }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function computeAuditHash(
  auditId: string,
  streamsAudited: number,
  violationsFound: number,
): string {
  return createHash('sha256')
    .update(`${auditId}:${streamsAudited}:${violationsFound}`)
    .digest('hex')
    .slice(0, 24)
}

export function isAuditClean(audit: ReplayIntegrityAudit): boolean {
  return audit.status === 'clean' && audit.violationsFound === 0
}

export function computeIntegrityScore(
  streamsAudited: number,
  violationsFound: number,
): number {
  if (streamsAudited === 0) return 100
  const cleanStreams = Math.max(0, streamsAudited - violationsFound)
  return Math.round((cleanStreams / streamsAudited) * 100)
}

// ─── Test hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  _mapAudit,
  _mapViolation,
  computeAuditHash,
  isAuditClean,
  computeIntegrityScore,
  MAX_REPLAY_DIVERGENCE_TOLERANCE,
}

// ─── Mappers ──────────────────────────────────────────────────────────────────

function _mapAudit(row: Record<string, unknown>): ReplayIntegrityAudit {
  return {
    id: row['id'] as string,
    environment: row['environment'] as string,
    auditedBy: row['audited_by'] as string,
    eventStreamIds: (typeof row['event_stream_ids'] === 'string'
      ? JSON.parse(row['event_stream_ids'] as string)
      : row['event_stream_ids']) as string[],
    status: row['status'] as IntegrityAuditStatus,
    streamsAudited: Number(row['streams_audited'] ?? 0),
    violationsFound: Number(row['violations_found'] ?? 0),
    auditHash: (row['audit_hash'] as string) ?? null,
    completedAt: row['completed_at'] != null ? new Date(row['completed_at'] as string) : null,
    createdAt: new Date(row['created_at'] as string),
  }
}

function _mapViolation(row: Record<string, unknown>): IntegrityViolation {
  return {
    id: row['id'] as string,
    auditId: row['audit_id'] as string,
    eventStreamId: row['event_stream_id'] as string,
    violationType: row['violation_type'] as string,
    description: row['description'] as string,
    severity: row['severity'] as 'critical' | 'warning',
    evidence: (typeof row['evidence'] === 'string'
      ? JSON.parse(row['evidence'] as string)
      : row['evidence']) as Record<string, unknown>,
    detectedAt: new Date(row['detected_at'] as string),
    createdAt: new Date(row['created_at'] as string),
  }
}
