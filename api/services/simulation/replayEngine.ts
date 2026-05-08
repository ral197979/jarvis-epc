/**
 * Denver Engineering — Operational Simulation + Replay Engine (v4.40.0)
 * ─────────────────────────────────────────────────────────────────────
 * Ava Phase 4 — Replays historical events and evaluates what-if scenarios
 * in complete isolation from production data. No production mutations occur.
 *
 * Non-negotiable rules:
 * - Simulation sessions write ONLY to simulation_* tables
 * - Replay ordering is deterministic (sequence_number ASC)
 * - Checksum is SHA-256 of concatenated event IDs in replay order
 * - What-if mutations are stored in simulation_events, not realtime_event_log
 */

import { createHash } from 'node:crypto'
import { tenantQuery } from '../../db/pool'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReplayConfig {
  type:           'replay' | 'what_if' | 'forecast'
  replayFrom?:    string    // ISO timestamp
  replayTo?:      string    // ISO timestamp
  projectId?:     string
  limit?:         number
  syntheticEvents?: SyntheticEvent[]  // injected what-if events
}

export interface SyntheticEvent {
  event_type: string
  payload:    Record<string, unknown>
  inject_at?: number    // sequence_number to inject before
}

export interface SimulationOutcome {
  sessionId:            string
  status:               string
  eventsReplayed:       number
  replayChecksum:       string
  projectedReadiness:   number | null
  projectedEscalations: number
  projectedSlaBreaches: number
  predictedBottlenecks: string[]
  impactedSystems:      string[]
  readinessDelta:       number | null
  whatIfScenarios:      unknown[]
}

// ─── Checksum ─────────────────────────────────────────────────────────────────

export function computeReplayChecksum(
  events: Array<{ id?: unknown; sequence_number: number }>
): string {
  const payload = events
    .sort((a, b) => a.sequence_number - b.sequence_number)
    .map(e => `${e.id ?? ''}:${e.sequence_number}`)
    .join('|')
  return createHash('sha256').update(payload).digest('hex')
}

// ─── Simulate Single Event Against Mutable State ─────────────────────────────

export function _applySimulatedEvent(
  state: Record<string, unknown>,
  event: { event_type: string; payload: Record<string, unknown> }
): Record<string, unknown> {
  const next = { ...state }

  switch (event.event_type) {
    case 'action_escalated':
      next['escalationCount'] = ((next['escalationCount'] as number) ?? 0) + 1
      break
    case 'sla_breached':
      next['slaBreachCount'] = ((next['slaBreachCount'] as number) ?? 0) + 1
      break
    case 'sla_paused':
      next['pausedCount'] = ((next['pausedCount'] as number) ?? 0) + 1
      break
    case 'action_completed':
      next['completedCount'] = ((next['completedCount'] as number) ?? 0) + 1
      next['openCount'] = Math.max(0, ((next['openCount'] as number) ?? 0) - 1)
      break
    case 'action_created':
      next['openCount'] = ((next['openCount'] as number) ?? 0) + 1
      break
    case 'blocker_added':
      next['blockerCount'] = ((next['blockerCount'] as number) ?? 0) + 1
      break
    case 'blocker_resolved':
      next['blockerCount'] = Math.max(0, ((next['blockerCount'] as number) ?? 0) - 1)
      break
    case 'readiness_changed':
      if (typeof event.payload['score'] === 'number') {
        next['readinessScore'] = event.payload['score']
      }
      break
    default: break
  }
  return next
}

// ─── Projected Readiness from Simulated State ────────────────────────────────

export function _projectReadiness(
  state: Record<string, unknown>
): number | null {
  const openCount  = (state['openCount']  as number) ?? 0
  const escalations= (state['escalationCount'] as number) ?? 0
  const breaches   = (state['slaBreachCount']  as number) ?? 0
  const blockers   = (state['blockerCount']    as number) ?? 0

  if (openCount === 0 && escalations === 0 && breaches === 0) return 95
  const deduction = (breaches * 10) + (escalations * 5) + (blockers * 8) + (openCount * 0.5)
  return Math.max(0, Math.min(100, 100 - deduction))
}

// ─── Create Simulation Session ────────────────────────────────────────────────

export async function createSimulationSession(
  tenantId: string,
  triggeredBy: string,
  config: ReplayConfig
): Promise<string> {
  const { rows } = await tenantQuery(tenantId, `
    INSERT INTO simulation_sessions
      (tenant_id, simulation_type, triggered_by, config, replay_from, replay_to)
    VALUES ($1,$2,$3,$4::jsonb,$5,$6)
    RETURNING id
  `, [tenantId, config.type, triggeredBy, JSON.stringify(config),
      config.replayFrom ?? null, config.replayTo ?? null])
  return rows[0]!.id as string
}

// ─── Run Replay ───────────────────────────────────────────────────────────────

export async function runReplay(
  sessionId: string,
  tenantId: string
): Promise<SimulationOutcome> {
  await tenantQuery(tenantId,
    `UPDATE simulation_sessions SET status = 'running', started_at = now() WHERE id = $1`,
    [sessionId])

  // Load session config
  const { rows: sessRows } = await tenantQuery(tenantId,
    `SELECT * FROM simulation_sessions WHERE id = $1 AND tenant_id = $2`,
    [sessionId, tenantId])
  if (!sessRows[0]) throw new Error(`Session ${sessionId} not found`)

  const sess = sessRows[0]
  const cfg  = sess.config as ReplayConfig
  const limit = cfg.limit ?? 500

  // Load historical events from realtime_event_log (read-only)
  const params: unknown[] = [tenantId]
  let q = `SELECT id, event_type, payload, sequence_number, published_at
           FROM realtime_event_log WHERE tenant_id = $1`
  if (cfg.replayFrom) { params.push(cfg.replayFrom); q += ` AND published_at >= $${params.length}` }
  if (cfg.replayTo)   { params.push(cfg.replayTo);   q += ` AND published_at <= $${params.length}` }
  params.push(limit); q += ` ORDER BY sequence_number ASC LIMIT $${params.length}`

  const { rows: events } = await tenantQuery(tenantId, q, params)

  // Merge synthetic events for what-if
  const syntheticEvents: SyntheticEvent[] = cfg.syntheticEvents ?? []
  const allEvents = [...events]

  // Insert synthetic events into simulation_events table
  let seqCounter = events.length
  for (const syn of syntheticEvents) {
    const insertBefore = syn.inject_at ?? seqCounter
    allEvents.splice(insertBefore, 0, {
      id: null, event_type: syn.event_type, payload: syn.payload,
      sequence_number: insertBefore + 0.5,  // fractional to preserve order
      published_at: new Date(),
    })
    seqCounter++
  }

  // Normalize sequence numbers after merge
  allEvents.forEach((e, i) => { e.sequence_number = i })

  // Write simulation events (isolated copy)
  for (const ev of allEvents) {
    await tenantQuery(tenantId, `
      INSERT INTO simulation_events
        (tenant_id, session_id, sequence_number, event_type, payload, source, original_event_id)
      VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)
    `, [tenantId, sessionId, ev.sequence_number, ev.event_type,
        JSON.stringify(ev.payload ?? {}),
        ev.id ? 'replay' : 'synthetic',
        ev.id ?? null])
  }

  // Apply events to mutable simulation state
  let state: Record<string, unknown> = { openCount: 0, escalationCount: 0, slaBreachCount: 0, blockerCount: 0 }
  for (const ev of allEvents) {
    state = _applySimulatedEvent(state, ev as { event_type: string; payload: Record<string, unknown> })
  }

  const checksum = computeReplayChecksum(allEvents.map(e => ({ id: e.id, sequence_number: e.sequence_number })))
  const projectedReadiness   = _projectReadiness(state)
  const projectedEscalations = (state['escalationCount'] as number) ?? 0
  const projectedSlaBreaches = (state['slaBreachCount']  as number) ?? 0

  // Identify bottlenecks
  const predictedBottlenecks: string[] = []
  if ((state['blockerCount'] as number) > 3) predictedBottlenecks.push('dependency_chain')
  if (projectedSlaBreaches > 5)             predictedBottlenecks.push('sla_overload')
  if (projectedEscalations > 3)             predictedBottlenecks.push('escalation_chain')
  if ((state['openCount'] as number) > 20)  predictedBottlenecks.push('action_saturation')

  // Compute delta vs. current readiness (simplified: just use projected vs. baseline 75)
  const readinessDelta = projectedReadiness !== null ? projectedReadiness - 75 : null

  // Persist results
  await tenantQuery(tenantId, `
    INSERT INTO simulation_results
      (tenant_id, session_id, projected_readiness, projected_escalations, projected_sla_breaches,
       predicted_bottlenecks, readiness_delta)
    VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)
  `, [tenantId, sessionId, projectedReadiness, projectedEscalations, projectedSlaBreaches,
      JSON.stringify(predictedBottlenecks), readinessDelta])

  await tenantQuery(tenantId, `
    UPDATE simulation_sessions SET
      status = 'completed', completed_at = now(),
      events_replayed = $1, replay_checksum = $2,
      projected_readiness = $3, projected_escalations = $4, projected_sla_breaches = $5
    WHERE id = $6
  `, [allEvents.length, checksum, projectedReadiness, projectedEscalations, projectedSlaBreaches, sessionId])

  return {
    sessionId, status: 'completed', eventsReplayed: allEvents.length,
    replayChecksum: checksum, projectedReadiness, projectedEscalations, projectedSlaBreaches,
    predictedBottlenecks, impactedSystems: [], readinessDelta, whatIfScenarios: [],
  }
}

// ─── What-If Simulation ───────────────────────────────────────────────────────

export async function runWhatIf(
  tenantId: string,
  triggeredBy: string,
  config: ReplayConfig & { syntheticEvents: SyntheticEvent[] }
): Promise<SimulationOutcome> {
  const sessionId = await createSimulationSession(tenantId, triggeredBy, config)
  return runReplay(sessionId, tenantId)
}

// ─── Get Results ─────────────────────────────────────────────────────────────

export async function getSimulationResults(
  tenantId: string,
  sessionId: string
): Promise<unknown> {
  const { rows } = await tenantQuery(tenantId, `
    SELECT s.*, r.*
    FROM simulation_sessions s
    LEFT JOIN simulation_results r ON r.session_id = s.id
    WHERE s.id = $1 AND s.tenant_id = $2
  `, [sessionId, tenantId])
  return rows[0] ?? null
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  computeReplayChecksum,
  _applySimulatedEvent,
  _projectReadiness,
  createSimulationSession,
  runReplay,
  runWhatIf,
}
