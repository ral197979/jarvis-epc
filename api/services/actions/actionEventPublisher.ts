/**
 * Denver Engineering — Action Event Publisher (v4.34.0)
 * ───────────────────────────────────────────────────────
 * Ava Phase 2G — Publishes immutable events to action_events.
 *
 * All callers use publishActionEvent() — fire-and-forget.
 * Errors are logged but never thrown to preserve non-blocking semantics.
 *
 * Future-ready:
 *   - correlation_id threaded from request middleware
 *   - before/after snapshots for diff replay
 *   - event_type enum matches action_event_type Postgres type
 */

import { query } from '../../db/pool'
import { slog } from '../../../src/modules/observability/index'

// ─── Types ────────────────────────────────────────────────────────────────────

export type ActionEventType =
  | 'created' | 'assigned' | 'delegated' | 'reassigned'
  | 'escalated' | 'commented' | 'blocked' | 'unblocked'
  | 'status_changed' | 'priority_changed' | 'resolved'
  | 'reopened' | 'cancelled' | 'sla_paused' | 'sla_resumed'
  | 'relation_added' | 'relation_removed'

export type ActorType = 'user' | 'system' | 'worker' | 'api'

export interface PublishEventInput {
  tenantId:        string
  actionId:        string
  eventType:       ActionEventType
  actorId?:        string | null
  actorType?:      ActorType
  actorLabel?:     string | null
  correlationId?:  string | null
  beforeSnapshot?: Record<string, unknown> | null
  afterSnapshot?:  Record<string, unknown> | null
  metadata?:       Record<string, unknown>
}

// ─── Core publish ─────────────────────────────────────────────────────────────

export async function publishEvent(input: PublishEventInput): Promise<void> {
  try {
    await query(`
      INSERT INTO action_events (
        tenant_id, action_id, correlation_id,
        event_type, actor_id, actor_type, actor_label,
        before_snapshot, after_snapshot, metadata
      ) VALUES ($1, $2, $3, $4::action_event_type, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb)
    `, [
      input.tenantId,
      input.actionId,
      input.correlationId ?? null,
      input.eventType,
      input.actorId    ?? null,
      input.actorType  ?? 'system',
      input.actorLabel ?? null,
      input.beforeSnapshot ? JSON.stringify(input.beforeSnapshot) : null,
      input.afterSnapshot  ? JSON.stringify(input.afterSnapshot)  : null,
      JSON.stringify(input.metadata ?? {}),
    ])
  } catch (err) {
    slog('ERROR', 'actionEventPublisher', '[publish] Failed', {
      error:     String(err),
      actionId:  input.actionId,
      eventType: input.eventType,
    })
  }
}

/**
 * Convenience shorthand for the most common case:
 *   publishActionEvent(tenantId, actionId, eventType, actorId, metadata?)
 */
export function publishActionEvent(
  tenantId:   string,
  actionId:   string,
  eventType:  ActionEventType,
  actorId:    string | null,
  metadata?:  Record<string, unknown>,
  opts?: {
    actorType?:     ActorType
    actorLabel?:    string
    correlationId?: string
    before?:        Record<string, unknown>
    after?:         Record<string, unknown>
  },
): void {
  void publishEvent({
    tenantId,
    actionId,
    eventType,
    actorId,
    actorType:      opts?.actorType      ?? (actorId ? 'user' : 'system'),
    actorLabel:     opts?.actorLabel     ?? null,
    correlationId:  opts?.correlationId  ?? null,
    beforeSnapshot: opts?.before         ?? null,
    afterSnapshot:  opts?.after          ?? null,
    metadata:       metadata             ?? {},
  })
}

// ─── Fetch timeline ───────────────────────────────────────────────────────────

export interface ActionEvent {
  id:              string
  tenant_id:       string
  action_id:       string
  correlation_id:  string | null
  event_type:      ActionEventType
  event_version:   number
  actor_id:        string | null
  actor_type:      ActorType
  actor_label:     string | null
  before_snapshot: Record<string, unknown> | null
  after_snapshot:  Record<string, unknown> | null
  metadata:        Record<string, unknown>
  occurred_at:     string
}

export async function getActionTimeline(
  tenantId:   string,
  actionId:   string,
  limit:      number = 100,
  beforeDate?: string,
): Promise<ActionEvent[]> {
  const beforeClause = beforeDate ? `AND occurred_at < $4` : ''
  const params: unknown[] = [tenantId, actionId, limit]
  if (beforeDate) params.push(beforeDate)

  const result = await query<ActionEvent>(`
    SELECT
      ae.*,
      u.email AS actor_label_resolved
    FROM action_events ae
    LEFT JOIN users u ON u.id = ae.actor_id
    WHERE ae.tenant_id = $1
      AND ae.action_id = $2
      ${beforeClause}
    ORDER BY ae.occurred_at ASC
    LIMIT $3
  `, params)

  return result.rows
}
