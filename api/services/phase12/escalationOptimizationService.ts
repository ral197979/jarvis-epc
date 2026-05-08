// Denver Engineering — Escalation Optimization Service (Phase 12)
// Optimizes support escalation routing and tracks escalation patterns

import { pool } from '../../db/pool'
import { EscalationRoute } from './phase12Types'

// ─── Mapper ──────────────────────────────────────────────────────────────────

function _mapEscalationRoute(row: Record<string, unknown>): EscalationRoute {
  return {
    id: row.id as string,
    supportRecordId: row.support_record_id as string,
    fromTier: row.from_tier as EscalationRoute['fromTier'],
    toTier: row.to_tier as EscalationRoute['toTier'],
    reason: row.reason as string,
    autoRouted: row.auto_routed as boolean,
    escalatedAt: new Date(row.escalated_at as string),
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function determineEscalationTier(
  category: string,
  priority: 'critical' | 'high' | 'medium' | 'low',
  replayIssue: boolean,
): EscalationRoute['toTier'] {
  if (replayIssue || priority === 'critical') return 'engineering'
  if (priority === 'high') return 'l3'
  if (priority === 'medium') return 'l2'
  return 'l1'
}

export function isEscalationSkipped(from: EscalationRoute['fromTier'], to: EscalationRoute['toTier']): boolean {
  const tiers = ['l1', 'l2', 'l3', 'engineering']
  const fromIdx = tiers.indexOf(from)
  const toIdx = tiers.indexOf(to)
  return toIdx - fromIdx > 1
}

export function computeEscalationRate(records: { escalated: boolean }[]): number {
  if (records.length === 0) return 0
  const escalated = records.filter(r => r.escalated).length
  return escalated / records.length
}

// ─── Service ─────────────────────────────────────────────────────────────────

export async function recordEscalation(
  supportRecordId: string,
  fromTier: EscalationRoute['fromTier'],
  toTier: EscalationRoute['toTier'],
  reason: string,
  autoRouted = false,
): Promise<EscalationRoute> {
  const result = await pool.query(
    `INSERT INTO p12_escalation_routes
       (support_record_id, from_tier, to_tier, reason, auto_routed, escalated_at)
     VALUES ($1,$2,$3,$4,$5,NOW())
     RETURNING *`,
    [supportRecordId, fromTier, toTier, reason, autoRouted],
  )
  return _mapEscalationRoute(result.rows[0])
}

export async function getEscalationsForRecord(supportRecordId: string): Promise<EscalationRoute[]> {
  const result = await pool.query(
    `SELECT * FROM p12_escalation_routes
     WHERE support_record_id = $1
     ORDER BY escalated_at ASC`,
    [supportRecordId],
  )
  return result.rows.map(_mapEscalationRoute)
}

export async function getEngineeeringEscalations(since: Date): Promise<EscalationRoute[]> {
  const result = await pool.query(
    `SELECT * FROM p12_escalation_routes
     WHERE to_tier = 'engineering' AND escalated_at >= $1
     ORDER BY escalated_at DESC`,
    [since],
  )
  return result.rows.map(_mapEscalationRoute)
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  determineEscalationTier,
  isEscalationSkipped,
  computeEscalationRate,
  _mapEscalationRoute,
}
