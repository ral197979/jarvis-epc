// Denver Engineering — Root Cause Synthesis Engine (v7.0.0)
// Correlates anomalies, events, and state changes to synthesize root causes.

import { tenantQuery } from '../../db/pool'
import { RootCauseCandidate, RootCauseReport } from './adaptiveTypes'
import { randomUUID } from 'crypto'

// ─── Synthesize root cause for an incident ────────────────────────────────────

export async function synthesizeRootCause(
  tenantId: string,
  opts: {
    entityId?: string
    entityType?: string
    windowHours?: number
    anomalyIds?: string[]
  },
): Promise<RootCauseReport> {
  const { entityId, entityType, windowHours = 24, anomalyIds = [] } = opts

  // Gather evidence in parallel
  const [anomalyEvidence, eventEvidence, stateEvidence] = await Promise.all([
    _gatherAnomalyEvidence(tenantId, entityId, windowHours, anomalyIds),
    _gatherEventEvidence(tenantId, entityId, windowHours),
    _gatherStateChangeEvidence(tenantId, entityId, windowHours),
  ])

  const candidates = _correlateEvidence(anomalyEvidence, eventEvidence, stateEvidence)
  const sorted = candidates.sort((a, b) => b.contributionScore - a.contributionScore)

  const primary = sorted[0] ?? _unknownCause()
  const contributing = sorted.slice(1, 5)

  return {
    incidentId: randomUUID(),
    tenantId,
    primaryCause: primary,
    contributingFactors: contributing,
    mitigationSuggestions: _buildMitigations(primary, contributing),
    synthesizedAt: new Date(),
  }
}

// ─── Evidence gathering ───────────────────────────────────────────────────────

interface AnomalyEvidence {
  anomalyType: string
  severity: string
  entityIds: string[]
  count: number
}

async function _gatherAnomalyEvidence(
  tenantId: string,
  entityId: string | undefined,
  windowHours: number,
  anomalyIds: string[],
): Promise<AnomalyEvidence[]> {
  const params: unknown[] = [tenantId, windowHours]
  const clauses = [
    'tenant_id = $1',
    `detected_at >= now() - ($2 || ' hours')::interval`,
    "resolved_at IS NULL",
  ]
  if (entityId != null)         { params.push(entityId);   clauses.push(`twin_id = $${params.length}`) }
  if (anomalyIds.length > 0)    { params.push(anomalyIds); clauses.push(`id = ANY($${params.length})`) }

  const res = await tenantQuery(
    tenantId,
    `SELECT
       anomaly_type,
       severity,
       ARRAY_AGG(DISTINCT twin_id) AS entity_ids,
       COUNT(*)::int AS cnt
     FROM operational_anomalies
     WHERE ${clauses.join(' AND ')}
     GROUP BY anomaly_type, severity
     ORDER BY cnt DESC`,
    params,
  )

  return res.rows.map(row => ({
    anomalyType: row.anomaly_type as string,
    severity: row.severity as string,
    entityIds: (row.entity_ids ?? []) as string[],
    count: Number(row.cnt),
  }))
}

interface EventEvidence {
  eventType: string
  entityIds: string[]
  count: number
}

async function _gatherEventEvidence(
  tenantId: string,
  entityId: string | undefined,
  windowHours: number,
): Promise<EventEvidence[]> {
  const params: unknown[] = [tenantId, windowHours]
  const clauses = [
    'tenant_id = $1',
    `created_at >= now() - ($2 || ' hours')::interval`,
  ]
  if (entityId != null) { params.push(entityId); clauses.push(`entity_id = $${params.length}`) }

  // Use realtime_event_log if it exists; gracefully handle missing table
  try {
    const res = await tenantQuery(
      tenantId,
      `SELECT
         event_type,
         ARRAY_AGG(DISTINCT entity_id) AS entity_ids,
         COUNT(*)::int AS cnt
       FROM realtime_event_log
       WHERE ${clauses.join(' AND ')}
       GROUP BY event_type
       ORDER BY cnt DESC
       LIMIT 20`,
      params,
    )
    return res.rows.map(row => ({
      eventType: row.event_type as string,
      entityIds: (row.entity_ids ?? []) as string[],
      count: Number(row.cnt),
    }))
  } catch {
    return []
  }
}

interface StateEvidence {
  field: string
  changeCount: number
  affectedTwinIds: string[]
}

async function _gatherStateChangeEvidence(
  tenantId: string,
  entityId: string | undefined,
  windowHours: number,
): Promise<StateEvidence[]> {
  const params: unknown[] = [tenantId, windowHours]
  const clauses = [
    'ot.tenant_id = $1',
    `tss.snapshot_at >= now() - ($2 || ' hours')::interval`,
    'tss.diff IS NOT NULL',
  ]
  if (entityId != null) {
    params.push(entityId)
    clauses.push(`ot.entity_id = $${params.length}`)
  }

  try {
    const res = await tenantQuery(
      tenantId,
      `SELECT
         tss.twin_id,
         jsonb_object_keys(tss.diff) AS changed_field
       FROM twin_state_snapshots tss
       JOIN operational_twins ot ON ot.id = tss.twin_id
       WHERE ${clauses.join(' AND ')}
       LIMIT 200`,
      params,
    )

    const byField: Record<string, { count: number; twins: Set<string> }> = {}
    for (const row of res.rows) {
      const f = row.changed_field as string
      if (byField[f] == null) byField[f] = { count: 0, twins: new Set() }
      byField[f]!.count++
      byField[f]!.twins.add(row.twin_id as string)
    }

    return Object.entries(byField)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10)
      .map(([field, data]) => ({
        field,
        changeCount: data.count,
        affectedTwinIds: Array.from(data.twins),
      }))
  } catch {
    return []
  }
}

// ─── Evidence correlation ─────────────────────────────────────────────────────

function _correlateEvidence(
  anomalies: AnomalyEvidence[],
  events: EventEvidence[],
  states: StateEvidence[],
): RootCauseCandidate[] {
  const candidates: RootCauseCandidate[] = []

  // Anomaly-driven candidates
  for (const a of anomalies) {
    const severityScore = { critical: 80, high: 60, medium: 40, low: 20 }[a.severity] ?? 30
    candidates.push({
      causeType: `anomaly:${a.anomalyType}`,
      description: `${a.count} ${a.severity} anomaly/anomalies of type '${a.anomalyType}' detected`,
      confidence: Math.min(0.95, 0.5 + a.count * 0.05),
      supportingEvidence: [`${a.count} open anomalies`, `severity: ${a.severity}`],
      affectedEntities: a.entityIds,
      contributionScore: Math.min(100, severityScore + a.count * 5),
    })
  }

  // High-frequency event candidates
  for (const e of events) {
    if (e.count < 3) continue
    candidates.push({
      causeType: `event:${e.eventType}`,
      description: `${e.count} repeated events of type '${e.eventType}'`,
      confidence: Math.min(0.8, 0.3 + e.count * 0.03),
      supportingEvidence: [`${e.count} events in window`],
      affectedEntities: e.entityIds,
      contributionScore: Math.min(70, e.count * 3),
    })
  }

  // State change candidates
  for (const s of states) {
    if (s.changeCount < 2) continue
    candidates.push({
      causeType: `state_change:${s.field}`,
      description: `Field '${s.field}' changed ${s.changeCount} times across ${s.affectedTwinIds.length} twin(s)`,
      confidence: Math.min(0.7, 0.3 + s.changeCount * 0.04),
      supportingEvidence: [`${s.changeCount} changes`, `${s.affectedTwinIds.length} affected twins`],
      affectedEntities: s.affectedTwinIds,
      contributionScore: Math.min(60, s.changeCount * 4),
    })
  }

  return candidates
}

// ─── Mitigations ──────────────────────────────────────────────────────────────

function _buildMitigations(
  primary: RootCauseCandidate,
  contributing: RootCauseCandidate[],
): string[] {
  const mitigations: string[] = []

  if (primary.causeType.startsWith('anomaly:')) {
    mitigations.push(`Resolve open ${primary.causeType.split(':')[1]} anomalies immediately`)
    mitigations.push('Run anomaly detection sweep across all affected entities')
  } else if (primary.causeType.startsWith('event:')) {
    mitigations.push(`Investigate source of repeated '${primary.causeType.split(':')[1]}' events`)
    mitigations.push('Check event pipeline for loops or misconfiguration')
  } else if (primary.causeType.startsWith('state_change:')) {
    mitigations.push(`Review all changes to field '${primary.causeType.split(':')[1]}'`)
    mitigations.push('Audit governance policies for unauthorized mutations')
  }

  if (contributing.length > 0) {
    mitigations.push(`Address ${contributing.length} contributing factor(s) after primary cause is resolved`)
  }

  return mitigations
}

function _unknownCause(): RootCauseCandidate {
  return {
    causeType: 'unknown',
    description: 'Insufficient evidence to determine root cause',
    confidence: 0.1,
    supportingEvidence: [],
    affectedEntities: [],
    contributionScore: 0,
  }
}

export const __testHooks = {
  _correlateEvidence,
  _buildMitigations,
  _unknownCause,
}
