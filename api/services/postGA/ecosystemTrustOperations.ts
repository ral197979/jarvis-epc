// Denver Engineering — Ecosystem Trust Operations (Post-GA)
// Operates moderation queue and trust scoring for plugins, workflows, and partners

import { pool } from '../../db/pool'
import {
  EcosystemTrustOperationsRecord,
  ModerationQueueItem,
  ModerationAction,
  EcosystemEntityType,
  ECOSYSTEM_TRUST_MIN_SIGNAL,
} from './postGATypes'

// ─── Mappers ─────────────────────────────────────────────────────────────────

function _mapTrustRecord(row: Record<string, unknown>): EcosystemTrustOperationsRecord {
  return {
    id: row.id as string,
    entityId: row.entity_id as string,
    entityType: row.entity_type as EcosystemEntityType,
    trustScore: Number(row.trust_score),
    moderationAction: row.moderation_action as ModerationAction | null,
    actionReason: row.action_reason as string | null,
    reviewerId: row.reviewer_id as string | null,
    isImmutable: row.is_immutable as boolean,
    actionedAt: row.actioned_at ? new Date(row.actioned_at as string) : null,
    createdAt: new Date(row.created_at as string),
  }
}

function _mapQueueItem(row: Record<string, unknown>): ModerationQueueItem {
  return {
    id: row.id as string,
    entityId: row.entity_id as string,
    entityType: row.entity_type as EcosystemEntityType,
    trustScore: Number(row.trust_score),
    flagCount: Number(row.flag_count),
    priority: row.priority as ModerationQueueItem['priority'],
    queuedAt: new Date(row.queued_at as string),
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function computeModerationPriority(
  trustScore: number,
  flagCount: number,
  entityType: EcosystemEntityType,
): ModerationQueueItem['priority'] {
  if (flagCount >= 3 || trustScore < 30) return 'critical'
  if (flagCount >= 1 || trustScore < 50) return 'high'
  if (entityType === 'agent' || trustScore < 70) return 'medium'
  return 'low'
}

export function isAutoRejectEligible(trustScore: number, flagCount: number): boolean {
  return flagCount >= 5 || trustScore < 10
}

export function isTrustSufficient(trustScore: number): boolean {
  return trustScore >= ECOSYSTEM_TRUST_MIN_SIGNAL * 100
}

export function canAutoApprove(trustScore: number, flagCount: number): boolean {
  // Never auto-approve per non-negotiable rules — always require human review
  return false
}

export function computeEcosystemTrustSignal(records: EcosystemTrustOperationsRecord[]): number {
  if (records.length === 0) return 1.0
  const trusted = records.filter(r => r.trustScore >= 75 && r.moderationAction !== 'reject' && r.moderationAction !== 'revoke').length
  return trusted / records.length
}

// ─── Service ─────────────────────────────────────────────────────────────────

export async function createTrustRecord(
  entityId: string,
  entityType: EcosystemEntityType,
  trustScore: number,
): Promise<EcosystemTrustOperationsRecord> {
  const result = await pool.query(
    `INSERT INTO pga_ecosystem_trust_records
       (entity_id, entity_type, trust_score, is_immutable)
     VALUES ($1,$2,$3,FALSE)
     RETURNING *`,
    [entityId, entityType, trustScore],
  )
  return _mapTrustRecord(result.rows[0])
}

export async function applyModerationAction(
  recordId: string,
  action: ModerationAction,
  reason: string,
  reviewerId: string,
): Promise<EcosystemTrustOperationsRecord> {
  const result = await pool.query(
    `UPDATE pga_ecosystem_trust_records
     SET moderation_action=$2, action_reason=$3, reviewer_id=$4, is_immutable=TRUE, actioned_at=NOW()
     WHERE id=$1 AND is_immutable=FALSE
     RETURNING *`,
    [recordId, action, reason, reviewerId],
  )
  if (!result.rows[0]) throw new Error(`TrustRecord ${recordId} not found or already immutable`)
  return _mapTrustRecord(result.rows[0])
}

export async function queueForModeration(
  entityId: string,
  entityType: EcosystemEntityType,
  trustScore: number,
  flagCount: number,
): Promise<ModerationQueueItem> {
  const priority = computeModerationPriority(trustScore, flagCount, entityType)
  const result = await pool.query(
    `INSERT INTO pga_moderation_queue
       (entity_id, entity_type, trust_score, flag_count, priority, queued_at)
     VALUES ($1,$2,$3,$4,$5,NOW())
     ON CONFLICT (entity_id) DO UPDATE
       SET trust_score=$3, flag_count=$4, priority=$5, queued_at=NOW()
     RETURNING *`,
    [entityId, entityType, trustScore, flagCount, priority],
  )
  return _mapQueueItem(result.rows[0])
}

export async function getModerationQueue(priority?: ModerationQueueItem['priority']): Promise<ModerationQueueItem[]> {
  const result = await pool.query(
    `SELECT * FROM pga_moderation_queue
     WHERE ($1::text IS NULL OR priority=$1)
     ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, queued_at ASC`,
    [priority ?? null],
  )
  return result.rows.map(_mapQueueItem)
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  computeModerationPriority,
  isAutoRejectEligible,
  isTrustSufficient,
  canAutoApprove,
  computeEcosystemTrustSignal,
  _mapTrustRecord,
  _mapQueueItem,
}
