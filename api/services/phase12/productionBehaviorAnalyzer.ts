// Denver Engineering — Production Behavior Analyzer (Phase 12)
// Tracks real tenant behavior events for telemetry refinement

import { pool } from '../../db/pool'
import { tenantQuery } from '../../db/pool'
import { BehaviorEvent, BehaviorEventType } from './phase12Types'

// ─── Mapper ──────────────────────────────────────────────────────────────────

function _mapBehaviorEvent(row: Record<string, unknown>): BehaviorEvent {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    eventType: row.event_type as BehaviorEventType,
    context: (row.context as Record<string, unknown>) ?? {},
    sessionId: row.session_id as string | null,
    recordedAt: new Date(row.recorded_at as string),
    createdAt: new Date(row.created_at as string),
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function computeAbandonmentRate(total: number, abandoned: number): number {
  if (total === 0) return 0
  return abandoned / total
}

export function computeOverrideRate(total: number, overrides: number): number {
  if (total === 0) return 0
  return overrides / total
}

export function classifyBehaviorRisk(abandonmentRate: number, overrideRate: number): 'low' | 'medium' | 'high' {
  if (abandonmentRate > 0.5 || overrideRate > 0.6) return 'high'
  if (abandonmentRate > 0.25 || overrideRate > 0.35) return 'medium'
  return 'low'
}

// ─── Service ─────────────────────────────────────────────────────────────────

export async function recordBehaviorEvent(
  tenantId: string,
  eventType: BehaviorEventType,
  context: Record<string, unknown>,
  sessionId?: string,
): Promise<BehaviorEvent> {
  const result = await pool.query(
    `INSERT INTO p12_behavior_events (tenant_id, event_type, context, session_id, recorded_at)
     VALUES ($1, $2, $3, $4, NOW())
     RETURNING *`,
    [tenantId, eventType, JSON.stringify(context), sessionId ?? null],
  )
  return _mapBehaviorEvent(result.rows[0])
}

export async function getBehaviorEvents(
  tenantId: string,
  eventType?: BehaviorEventType,
  limit = 100,
): Promise<BehaviorEvent[]> {
  const result = await tenantQuery(
    tenantId,
    `SELECT * FROM p12_behavior_events
     WHERE tenant_id = $1
       AND ($2::text IS NULL OR event_type = $2)
     ORDER BY recorded_at DESC
     LIMIT $3`,
    [tenantId, eventType ?? null, limit],
  )
  return result.rows.map(_mapBehaviorEvent)
}

export async function getBehaviorEventCounts(
  tenantId: string,
  since: Date,
): Promise<Record<BehaviorEventType, number>> {
  const result = await tenantQuery(
    tenantId,
    `SELECT event_type, COUNT(*)::int AS cnt
     FROM p12_behavior_events
     WHERE tenant_id = $1 AND recorded_at >= $2
     GROUP BY event_type`,
    [tenantId, since],
  )
  const counts = {} as Record<BehaviorEventType, number>
  for (const row of result.rows) {
    counts[row.event_type as BehaviorEventType] = row.cnt
  }
  return counts
}

export async function getGlobalBehaviorSummary(
  since: Date,
): Promise<{ eventType: BehaviorEventType; count: number }[]> {
  const result = await pool.query(
    `SELECT event_type, COUNT(*)::int AS count
     FROM p12_behavior_events
     WHERE recorded_at >= $1
     GROUP BY event_type
     ORDER BY count DESC`,
    [since],
  )
  return result.rows.map(r => ({
    eventType: r.event_type as BehaviorEventType,
    count: r.count as number,
  }))
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  computeAbandonmentRate,
  computeOverrideRate,
  classifyBehaviorRisk,
  _mapBehaviorEvent,
}
