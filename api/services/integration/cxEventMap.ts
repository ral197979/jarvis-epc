/**
 * Denver Engineering — Commissioning event edge adapter (R1)
 * ─────────────────────────────────────────────────────────────────────────────
 * Maps between three event vocabularies so each system keeps its own internal
 * names (ECOSYSTEM_INTEGRATION_CONTRACT.md §4):
 *
 *   Menlo internal  ⇄  canonical (dotted)  ⇄  Denver mirror (cx.*)
 *   FATCompleted    →   fat.completed       →  cx.fat_status_changed {status:passed}
 *
 * The mapping lives in ONE place (this adapter). Denver's internal mirror
 * vocabulary (cx.*) and its pure reducer (cxStatusMirror.reduceEvent) stay
 * unchanged; inbound Menlo/canonical names are translated here at the edge.
 *
 * Pure module — no DB, no IO. Unit-tested.
 */

// ─── Inbound: Menlo internal → canonical ──────────────────────────────────────

export const MENLO_TO_CANONICAL: Record<string, string> = {
  CommissioningStarted:   'commissioning.started',
  CommissioningCompleted: 'commissioning.completed',
  FATScheduled:           'fat.scheduled',
  FATCompleted:           'fat.completed',
  SATScheduled:           'sat.scheduled',
  SATCompleted:           'sat.completed',
  LoopCheckCompleted:     'loopcheck.completed',
  DeficiencyCreated:      'deficiency.created',
  DeficiencyResolved:     'deficiency.closed',
  NCRCreated:             'ncr.created',
  NCRClosed:              'ncr.closed',
  PunchCreated:           'punch.created',
  PunchClosed:            'punch.closed',
  TurnoverReady:          'turnover.ready',
  EvidenceVerified:       'evidence.verified',
  WitnessSigned:          'witness.signed',
  ClientSignOff:          'witness.client_signoff',
}

// ─── Outbound: canonical → Menlo inbound name (Denver → Menlo) ─────────────────

export const CANONICAL_TO_MENLO_INBOUND: Record<string, string> = {
  'project.ready_for_commissioning': 'ProjectReadyForCommissioning',
  'construction.completed':          'ConstructionCompleted',
  'equipment.installed':             'EquipmentInstalled',
  'equipment.replaced':              'EquipmentReplaced',
  'system.ready_for_testing':        'SystemReadyForTesting',
  'vendor_data.updated':             'VendorDataUpdated',
  'drawing.approved':                'ApprovedDrawingUpdated',
  'submittal.approved':              'ApprovedSubmittalUpdated',
}

/** Outbound translate: canonical → Menlo inbound event name (passthrough if unmapped). */
export function toMenloInboundEvent(canonical: string): string {
  return CANONICAL_TO_MENLO_INBOUND[canonical] ?? canonical
}

// ─── Inbound: any name → Denver mirror instruction ────────────────────────────

/**
 * A normalized mirror instruction. Either `delta` (relative count adjustment) or
 * an `event` to feed cxStatusMirror.reduceEvent (absolute setter). `event` is
 * always set for logging/audit even on a delta.
 */
export interface NormalizedEvent {
  event: string
  data?: Record<string, unknown>
  delta?: Record<string, number>
}

/** Count columns a delta may target (allowlist — guards SQL identifier use). */
export const DELTA_FIELDS = ['deficiencies_open', 'ncr_open', 'punch_open'] as const

/**
 * Translate an inbound event (Menlo internal, canonical, or already-cx.*) into a
 * Denver mirror instruction. Returns null when the event has no mirror effect
 * (e.g. loop checks, evidence, witness) — the caller still records it for
 * idempotency/audit.
 */
export function toMirrorEvent(eventName: string, data: Record<string, unknown> = {}): NormalizedEvent | null {
  // Denver-internal vocabulary passes straight through (back-compat with PR-1).
  if (eventName.startsWith('cx.')) return { event: eventName, data }

  const canonical = MENLO_TO_CANONICAL[eventName] ?? eventName
  switch (canonical) {
    case 'commissioning.started':
      return { event: 'cx.phase_changed', data: { phase: 'in_commissioning' } }
    case 'commissioning.completed':
      return { event: 'cx.accepted' }
    case 'turnover.ready':
      return { event: 'cx.phase_changed', data: { phase: 'ready_for_turnover' } }
    case 'fat.completed':
      return { event: 'cx.fat_status_changed', data: { status: 'passed', readiness_pct: data['readiness_pct'] } }
    case 'fat.scheduled':
      return { event: 'cx.fat_status_changed', data: { status: 'scheduled' } }
    case 'sat.completed':
      return { event: 'cx.sat_status_changed', data: { status: 'passed', readiness_pct: data['readiness_pct'] } }
    case 'sat.scheduled':
      return { event: 'cx.sat_status_changed', data: { status: 'scheduled' } }
    case 'deficiency.created': return { event: canonical, delta: { deficiencies_open: 1 } }
    case 'deficiency.closed':  return { event: canonical, delta: { deficiencies_open: -1 } }
    case 'ncr.created':        return { event: canonical, delta: { ncr_open: 1 } }
    case 'ncr.closed':         return { event: canonical, delta: { ncr_open: -1 } }
    case 'punch.created':      return { event: canonical, delta: { punch_open: 1 } }
    case 'punch.closed':       return { event: canonical, delta: { punch_open: -1 } }
    default:
      return null   // no mirror column (loopcheck/evidence/witness/unknown) — audit only
  }
}
