// Denver Engineering — Anomaly Detection Engine (v6.0.0)
// Statistical anomaly detection across twin metrics and operational signals.

import { tenantQuery } from '../../db/pool'
import { OperationalAnomaly, AnomalyDetectionInput, AnomalySeverity } from './twinTypes'

// ─── Run detection ────────────────────────────────────────────────────────────

export async function detectAnomalies(input: AnomalyDetectionInput): Promise<OperationalAnomaly[]> {
  const { tenantId, twinId, windowDays = 14 } = input
  const detected: OperationalAnomaly[] = []

  const [scoreAnomalies, velocityAnomalies, blockerAnomalies] = await Promise.all([
    _detectScoreAnomalies(tenantId, twinId, windowDays),
    _detectVelocityAnomalies(tenantId, twinId, windowDays),
    _detectBlockerClusters(tenantId, twinId),
  ])

  detected.push(...scoreAnomalies, ...velocityAnomalies, ...blockerAnomalies)

  // Persist anomalies
  const saved: OperationalAnomaly[] = []
  for (const anomaly of detected) {
    const res = await tenantQuery(
      tenantId,
      `INSERT INTO operational_anomalies
         (tenant_id, twin_id, anomaly_type, severity, anomaly_score,
          impacted_entities, explanation, suggested_actions,
          baseline_value, observed_value, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        tenantId,
        anomaly.twinId ?? null,
        anomaly.anomalyType,
        anomaly.severity,
        anomaly.anomalyScore,
        JSON.stringify(anomaly.impactedEntities),
        anomaly.explanation,
        JSON.stringify(anomaly.suggestedActions),
        anomaly.baselineValue ?? null,
        anomaly.observedValue ?? null,
        JSON.stringify(anomaly.metadata),
      ]
    )
    saved.push(_mapAnomaly(res.rows[0]))
  }

  return saved
}

// ─── Retrieve anomalies ───────────────────────────────────────────────────────

export async function listAnomalies(
  tenantId: string,
  filters: {
    twinId?: string
    severity?: AnomalySeverity
    resolved?: boolean
    limit?: number
    offset?: number
  } = {}
): Promise<OperationalAnomaly[]> {
  const conditions = ['tenant_id = $1']
  const params: unknown[] = [tenantId]
  let idx = 2

  if (filters.twinId) { conditions.push(`twin_id = $${idx++}`); params.push(filters.twinId) }
  if (filters.severity) { conditions.push(`severity = $${idx++}`); params.push(filters.severity) }
  if (filters.resolved === true) conditions.push('resolved_at IS NOT NULL')
  if (filters.resolved === false) conditions.push('resolved_at IS NULL AND false_positive = false')

  params.push(filters.limit ?? 50)
  params.push(filters.offset ?? 0)

  const res = await tenantQuery(
    tenantId,
    `SELECT * FROM operational_anomalies
     WHERE ${conditions.join(' AND ')}
     ORDER BY detected_at DESC
     LIMIT $${idx} OFFSET $${idx + 1}`,
    params
  )
  return res.rows.map(_mapAnomaly)
}

export async function resolveAnomaly(
  anomalyId: string,
  tenantId: string
): Promise<void> {
  await tenantQuery(
    tenantId,
    `UPDATE operational_anomalies SET resolved_at = now()
     WHERE id = $1 AND tenant_id = $2`,
    [anomalyId, tenantId]
  )
}

export async function markFalsePositive(
  anomalyId: string,
  tenantId: string
): Promise<void> {
  await tenantQuery(
    tenantId,
    `UPDATE operational_anomalies SET false_positive = true
     WHERE id = $1 AND tenant_id = $2`,
    [anomalyId, tenantId]
  )
}

// ─── Score anomaly detection ──────────────────────────────────────────────────

async function _detectScoreAnomalies(
  tenantId: string,
  twinId: string | undefined,
  windowDays: number
): Promise<Omit<OperationalAnomaly, 'id' | 'detectedAt' | 'resolvedAt' | 'falsePositive'>[]> {
  const condition = twinId ? 'AND twin_id = $3' : ''
  const params: unknown[] = [tenantId, windowDays]
  if (twinId) params.push(twinId)

  const res = await tenantQuery(
    tenantId,
    `SELECT
       twin_id,
       AVG(CAST(state->>'readiness_score' AS numeric)) as avg_readiness,
       STDDEV(CAST(state->>'readiness_score' AS numeric)) as stddev_readiness,
       MIN(CAST(state->>'readiness_score' AS numeric)) as min_readiness,
       MAX(CAST(state->>'readiness_score' AS numeric)) as max_readiness,
       (SELECT CAST(state->>'readiness_score' AS numeric)
        FROM twin_state_snapshots s2
        WHERE s2.twin_id = s.twin_id
        ORDER BY sequence_num DESC LIMIT 1) as latest_readiness
     FROM twin_state_snapshots s
     WHERE tenant_id = $1
       AND snapshot_at >= now() - ($2 || ' days')::interval
       AND state->>'readiness_score' IS NOT NULL
       ${condition}
     GROUP BY twin_id`,
    params
  ).catch(() => ({ rows: [] as Record<string, unknown>[] }))

  const anomalies: Omit<OperationalAnomaly, 'id' | 'detectedAt' | 'resolvedAt' | 'falsePositive'>[] = []

  for (const row of res.rows) {
    const avg = Number(row.avg_readiness)
    const stddev = Number(row.stddev_readiness ?? 0)
    const latest = Number(row.latest_readiness)

    if (stddev > 0 && Math.abs(latest - avg) > 2 * stddev) {
      const severity = _scoreSeverity(Math.abs(latest - avg) / stddev)
      anomalies.push({
        tenantId,
        twinId: row.twin_id as string | undefined,
        anomalyType: 'readiness_score_spike',
        severity,
        anomalyScore: Math.min(100, Math.round(Math.abs(latest - avg) / stddev * 25)),
        impactedEntities: [row.twin_id as string],
        explanation: `Readiness score deviated ${(Math.abs(latest - avg) / stddev).toFixed(1)}σ from ${windowDays}-day mean (baseline: ${avg.toFixed(1)}, observed: ${latest.toFixed(1)})`,
        suggestedActions: ['Investigate recent state changes', 'Review linked events', 'Check for data quality issues'],
        baselineValue: avg,
        observedValue: latest,
        metadata: { stddev, windowDays },
      })
    }
  }
  return anomalies
}

async function _detectVelocityAnomalies(
  tenantId: string,
  twinId: string | undefined,
  windowDays: number
): Promise<Omit<OperationalAnomaly, 'id' | 'detectedAt' | 'resolvedAt' | 'falsePositive'>[]> {
  const condition = twinId ? 'AND twin_id = $3' : ''
  const params: unknown[] = [tenantId, windowDays]
  if (twinId) params.push(twinId)

  const res = await tenantQuery(
    tenantId,
    `SELECT twin_id, COUNT(*) as change_count
     FROM twin_state_snapshots
     WHERE tenant_id = $1
       AND snapshot_at >= now() - ($2 || ' days')::interval
       ${condition}
     GROUP BY twin_id
     HAVING COUNT(*) >= 20`,
    params
  ).catch(() => ({ rows: [] as Record<string, unknown>[] }))

  return res.rows.map(row => {
    const count = Number(row.change_count)
    const severity: AnomalySeverity = count >= 50 ? 'high' : 'medium'
    return {
      tenantId,
      twinId: row.twin_id as string | undefined,
      anomalyType: 'high_state_velocity',
      severity,
      anomalyScore: Math.min(100, count * 2),
      impactedEntities: [row.twin_id as string],
      explanation: `${count} state changes in ${windowDays} days — unusually high velocity`,
      suggestedActions: ['Audit recent events', 'Check for runaway sync process', 'Review automation rules'],
      baselineValue: 5,
      observedValue: count,
      metadata: { windowDays },
    }
  })
}

async function _detectBlockerClusters(
  tenantId: string,
  twinId: string | undefined
): Promise<Omit<OperationalAnomaly, 'id' | 'detectedAt' | 'resolvedAt' | 'falsePositive'>[]> {
  const condition = twinId ? 'AND project_id = (SELECT entity_id FROM operational_twins WHERE id = $2 AND tenant_id = $1)' : ''
  const params: unknown[] = [tenantId]
  if (twinId) params.push(twinId)

  const res = await tenantQuery(
    tenantId,
    `SELECT project_id, COUNT(*) as blocker_count
     FROM actions
     WHERE tenant_id = $1 AND status = 'blocked' ${condition}
     GROUP BY project_id
     HAVING COUNT(*) >= 5`,
    params
  ).catch(() => ({ rows: [] as Record<string, unknown>[] }))

  return res.rows.map(row => {
    const count = Number(row.blocker_count)
    const severity: AnomalySeverity = count >= 15 ? 'critical' : count >= 10 ? 'high' : 'medium'
    return {
      tenantId,
      twinId,
      anomalyType: 'blocker_cluster',
      severity,
      anomalyScore: Math.min(100, count * 5),
      impactedEntities: [row.project_id as string],
      explanation: `${count} actions currently blocked in project — blocker cluster detected`,
      suggestedActions: ['Escalate to project manager', 'Identify root blocker', 'Run dependency analysis'],
      baselineValue: 2,
      observedValue: count,
      metadata: { projectId: row.project_id },
    }
  })
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _scoreSeverity(sigmas: number): AnomalySeverity {
  if (sigmas >= 4) return 'critical'
  if (sigmas >= 3) return 'high'
  if (sigmas >= 2) return 'medium'
  return 'low'
}

export function _mapAnomaly(row: Record<string, unknown>): OperationalAnomaly {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    twinId: row.twin_id != null ? row.twin_id as string : undefined,
    anomalyType: row.anomaly_type as string,
    severity: row.severity as AnomalySeverity,
    anomalyScore: Number(row.anomaly_score),
    impactedEntities: (row.impacted_entities ?? []) as string[],
    explanation: row.explanation as string,
    suggestedActions: (row.suggested_actions ?? []) as string[],
    baselineValue: row.baseline_value != null ? Number(row.baseline_value) : undefined,
    observedValue: row.observed_value != null ? Number(row.observed_value) : undefined,
    detectedAt: new Date(row.detected_at as string),
    resolvedAt: row.resolved_at != null ? new Date(row.resolved_at as string) : undefined,
    falsePositive: Boolean(row.false_positive),
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
  }
}

export const __testHooks = { _mapAnomaly, _scoreSeverity }
