/**
 * Denver Engineering — Universal event publisher (R3)
 * ─────────────────────────────────────────────────────────────────────────────
 * One canonical event vocabulary (ECOSYSTEM_INTEGRATION_CONTRACT.md §4) and one
 * publish API. Denver emits canonical dotted events (`project.created`,
 * `fat.completed`, …) onto the EXISTING channels — the durable webhook dispatcher
 * (external subscribers) and, for the UI-relevant subset, the realtime bus.
 *
 * Additive + flag-gated + backward-compatible: this does not rewire existing
 * routes (no current callers) and does not change the typed realtime union — the
 * full vocabulary travels over webhooks (which already use dotted names); only a
 * mapped subset mirrors to the realtime bus. Fan-out is gated by UNIVERSAL_EVENTS
 * (default off); the envelope is always built/validated so callers can log it.
 *
 * Pure parts (vocabulary, envelope) are unit-tested; fan-out is mocked.
 */
import { randomUUID } from 'node:crypto'
import { emitEvent } from '../webhookDispatch'
import { broadcastEvent, type RealtimeEventType, type SubscriptionScope } from '../../realtime/eventBroadcaster'

// ─── Canonical vocabulary (single source of truth) ─────────────────────────────

export const CANONICAL_EVENTS = [
  'project.created', 'project.updated',
  'engineering.started', 'engineering.completed',
  'drawing.generated', 'calculation.completed',
  'equipment.created', 'equipment.updated',
  'fat.started', 'fat.completed', 'sat.completed', 'loopcheck.completed',
  'commissioning.started', 'commissioning.completed',
  'deficiency.created', 'deficiency.closed', 'ncr.created', 'ncr.closed',
  'punch.created', 'punch.closed', 'evidence.verified', 'witness.signed',
  'turnover.ready', 'turnover.completed',
] as const
export type CanonicalEvent = typeof CANONICAL_EVENTS[number]

const CANON = new Set<string>(CANONICAL_EVENTS)
export function isCanonicalEvent(event: string): event is CanonicalEvent {
  return CANON.has(event)
}

export class UnknownEventError extends Error {
  constructor(event: string) {
    super(`not a canonical event: ${event}`)
    this.name = 'UnknownEventError'
  }
}

/** Flag — fan-out is dormant until enabled. Default: off. */
export function isUniversalEventsEnabled(): boolean {
  return process.env['UNIVERSAL_EVENTS'] === 'true'
}

// ─── Envelope ─────────────────────────────────────────────────────────────────

export interface EventEnvelope {
  event_id: string
  event: CanonicalEvent
  tenant_id: string
  project_id: string | null
  subject_uuid: string | null   // Universal Object Registry id (R4)
  occurred_at: string
  correlation_id: string | null
  data: Record<string, unknown>
}

export interface PublishOpts {
  projectId?: string | null
  subjectUuid?: string | null
  correlationId?: string | null
  data?: Record<string, unknown>
  eventId?: string      // injectable for deterministic tests
  occurredAt?: string   // injectable for deterministic tests
}

/** Build + validate a canonical envelope (throws UnknownEventError). Pure. */
export function buildEnvelope(tenantId: string, event: string, opts: PublishOpts = {}): EventEnvelope {
  if (!isCanonicalEvent(event)) throw new UnknownEventError(event)
  return {
    event_id: opts.eventId ?? randomUUID(),
    event,
    tenant_id: tenantId,
    project_id: opts.projectId ?? null,
    subject_uuid: opts.subjectUuid ?? null,
    occurred_at: opts.occurredAt ?? new Date().toISOString(),
    correlation_id: opts.correlationId ?? null,
    data: opts.data ?? {},
  }
}

// Canonical → realtime bus mapping. Only UI-relevant events mirror to the typed
// realtime union; everything else travels over webhooks only.
const CANONICAL_TO_REALTIME: Record<string, { type: RealtimeEventType; scope: SubscriptionScope }> = {
  'commissioning.started':   { type: 'readiness_changed', scope: 'readiness' },
  'commissioning.completed': { type: 'readiness_changed', scope: 'readiness' },
  'fat.completed':           { type: 'readiness_changed', scope: 'readiness' },
  'sat.completed':           { type: 'readiness_changed', scope: 'readiness' },
  'turnover.ready':          { type: 'readiness_changed', scope: 'readiness' },
}

export interface PublishResult { envelope: EventEnvelope; published: boolean }

/**
 * Publish a canonical event. Always builds/validates the envelope; fans out to
 * the webhook dispatcher (+ realtime mirror for mapped events) only when the
 * UNIVERSAL_EVENTS flag is on. Returns the envelope and whether it was dispatched.
 */
export async function publishEvent(tenantId: string, event: string, opts: PublishOpts = {}): Promise<PublishResult> {
  const envelope = buildEnvelope(tenantId, event, opts)
  if (!isUniversalEventsEnabled()) return { envelope, published: false }

  // Durable external fan-out (subscribers store canonical names in webhooks.events[]).
  await emitEvent(tenantId, envelope.event, envelope as unknown as Record<string, unknown>)

  // Live UI mirror for the mapped subset.
  const rt = CANONICAL_TO_REALTIME[envelope.event]
  if (rt) {
    broadcastEvent({
      event_type: rt.type,
      tenant_id: tenantId,
      payload: { event: envelope.event, subject_uuid: envelope.subject_uuid, ...envelope.data },
      subscription_scope: rt.scope,
      scope_id: envelope.project_id ?? undefined,
      correlation_id: envelope.correlation_id ?? undefined,
    })
  }
  return { envelope, published: true }
}
