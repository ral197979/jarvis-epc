// Denver Engineering — Ecosystem Moderation Engine (Phase 12)
// Central orchestration for marketplace moderation workflows

import { pool } from '../../db/pool'
import { ModerationRecord, ModerationTarget, ModerationStatus } from './phase12Types'

// ─── Mapper ──────────────────────────────────────────────────────────────────

function _mapModerationRecord(row: Record<string, unknown>): ModerationRecord {
  return {
    id: row.id as string,
    targetId: row.target_id as string,
    targetType: row.target_type as ModerationTarget,
    status: row.status as ModerationStatus,
    trustScore: Number(row.trust_score),
    reviewerId: row.reviewer_id as string | null,
    reviewNotes: row.review_notes as string | null,
    sandboxValidated: row.sandbox_validated as boolean,
    immutableAt: new Date(row.immutable_at as string),
    createdAt: new Date(row.created_at as string),
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function isModerationApproved(record: ModerationRecord): boolean {
  return record.status === 'approved'
}

export function canEscalateToApproved(record: ModerationRecord): boolean {
  return record.status === 'under_review' && record.sandboxValidated && record.trustScore >= 70
}

export function isModerationFinal(record: ModerationRecord): boolean {
  return ['approved', 'rejected', 'revoked'].includes(record.status)
}

export function computeModerationRisk(
  trustScore: number,
  sandboxValidated: boolean,
  abuseFlags: number,
): 'low' | 'medium' | 'high' {
  if (!sandboxValidated || abuseFlags >= 3) return 'high'
  if (trustScore < 50 || abuseFlags >= 1) return 'medium'
  return 'low'
}

// ─── Service ─────────────────────────────────────────────────────────────────

export async function submitForModeration(
  targetId: string,
  targetType: ModerationTarget,
  initialTrustScore: number,
): Promise<ModerationRecord> {
  const result = await pool.query(
    `INSERT INTO p12_moderation_records
       (target_id, target_type, status, trust_score, sandbox_validated, immutable_at)
     VALUES ($1,$2,'pending',$3,FALSE,NOW())
     RETURNING *`,
    [targetId, targetType, initialTrustScore],
  )
  return _mapModerationRecord(result.rows[0])
}

export async function advanceModerationStatus(
  recordId: string,
  newStatus: ModerationStatus,
  reviewerId: string,
  reviewNotes: string,
): Promise<ModerationRecord> {
  const result = await pool.query(
    `UPDATE p12_moderation_records
     SET status = $2, reviewer_id = $3, review_notes = $4, immutable_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [recordId, newStatus, reviewerId, reviewNotes],
  )
  if (!result.rows[0]) throw new Error(`ModerationRecord ${recordId} not found`)
  return _mapModerationRecord(result.rows[0])
}

export async function markSandboxValidated(recordId: string): Promise<ModerationRecord> {
  const result = await pool.query(
    `UPDATE p12_moderation_records
     SET sandbox_validated = TRUE, immutable_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [recordId],
  )
  if (!result.rows[0]) throw new Error(`ModerationRecord ${recordId} not found`)
  return _mapModerationRecord(result.rows[0])
}

export async function getModerationRecord(targetId: string, targetType: ModerationTarget): Promise<ModerationRecord | null> {
  const result = await pool.query(
    `SELECT * FROM p12_moderation_records
     WHERE target_id = $1 AND target_type = $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [targetId, targetType],
  )
  return result.rows[0] ? _mapModerationRecord(result.rows[0]) : null
}

export async function getPendingModerations(targetType?: ModerationTarget): Promise<ModerationRecord[]> {
  const result = await pool.query(
    `SELECT * FROM p12_moderation_records
     WHERE status IN ('pending','under_review')
       AND ($1::text IS NULL OR target_type = $1)
     ORDER BY created_at ASC`,
    [targetType ?? null],
  )
  return result.rows.map(_mapModerationRecord)
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  isModerationApproved,
  canEscalateToApproved,
  isModerationFinal,
  computeModerationRisk,
  _mapModerationRecord,
}
