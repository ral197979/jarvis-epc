// Denver Engineering — Governance Drift Detector (Phase 11)
// Detect and alert on governance drift across production controls

import { pool } from '../../db/pool'
import {
  GovernanceDriftEvent,
  GovernanceDriftType,
} from './phase11Types'

// ─── Drift Detection Snapshot ─────────────────────────────────────────────────

export interface GovernanceSnapshot {
  rlsPolicyCount: number
  auditEventsPerHour: number
  openReplayIncidents: number
  aiComplianceRate: number
  approvalGatePassRate: number
  capturedAt: Date
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _mapDriftEvent(row: Record<string, unknown>): GovernanceDriftEvent {
  return {
    id: row.id as string,
    driftType: row.drift_type as GovernanceDriftType,
    severity: row.severity as 'critical' | 'warning' | 'info',
    tenantId: row.tenant_id as string | null,
    description: row.description as string,
    detectedAt: new Date(row.detected_at as string),
    resolvedAt: row.resolved_at ? new Date(row.resolved_at as string) : null,
    createdAt: new Date(row.created_at as string),
  }
}

// ─── Take Governance Snapshot ─────────────────────────────────────────────────

export async function takeGovernanceSnapshot(): Promise<GovernanceSnapshot> {
  const [rlsResult, auditResult, replayResult, aiResult, gateResult] = await Promise.all([
    pool.query(`SELECT COUNT(*) as count FROM pg_policies WHERE schemaname = 'public'`),
    pool.query(`SELECT COUNT(*) as count FROM audit_log_entries WHERE created_at >= NOW() - INTERVAL '1 hour'`),
    pool.query(`SELECT COUNT(*) as count FROM replay_incidents WHERE status = 'open'`),
    pool.query(
      `SELECT COALESCE(AVG(CASE WHEN status = 'compliant' THEN 1.0 ELSE 0.0 END), 1.0) as rate
       FROM ai_explainability_reports WHERE created_at >= NOW() - INTERVAL '7 days'`
    ),
    pool.query(
      `SELECT COALESCE(AVG(CASE WHEN status = 'passed' THEN 1.0 ELSE 0.0 END), 1.0) as rate
       FROM production_gate_runs WHERE created_at >= NOW() - INTERVAL '24 hours'`
    ),
  ])

  return {
    rlsPolicyCount: Number(rlsResult.rows[0]?.count ?? 0),
    auditEventsPerHour: Number(auditResult.rows[0]?.count ?? 0),
    openReplayIncidents: Number(replayResult.rows[0]?.count ?? 0),
    aiComplianceRate: Number(aiResult.rows[0]?.rate ?? 1),
    approvalGatePassRate: Number(gateResult.rows[0]?.rate ?? 1),
    capturedAt: new Date(),
  }
}

// ─── Compare Snapshots ────────────────────────────────────────────────────────

export function compareSnapshots(
  current: GovernanceSnapshot,
  previous: GovernanceSnapshot
): GovernanceDriftType[] {
  const drifts: GovernanceDriftType[] = []

  if (current.rlsPolicyCount < previous.rlsPolicyCount) {
    drifts.push('rls_policy_removed')
  }
  if (current.auditEventsPerHour === 0 && previous.auditEventsPerHour > 0) {
    drifts.push('audit_gap')
  }
  if (current.openReplayIncidents > previous.openReplayIncidents + 2) {
    drifts.push('replay_divergence_spike')
  }
  if (current.aiComplianceRate < previous.aiComplianceRate - 0.1) {
    drifts.push('ai_explainability_regression')
  }
  if (current.approvalGatePassRate < 0.9) {
    drifts.push('approval_gate_bypassed')
  }

  return drifts
}

// ─── Classify Drift Severity ──────────────────────────────────────────────────

export function classifyDriftSeverity(
  driftType: GovernanceDriftType
): 'critical' | 'warning' | 'info' {
  const critical: GovernanceDriftType[] = [
    'rls_policy_removed', 'cross_tenant_leak', 'immutable_record_modified',
    'replay_divergence_spike',
  ]
  const warning: GovernanceDriftType[] = [
    'audit_gap', 'approval_gate_bypassed', 'ai_explainability_regression',
  ]

  if (critical.includes(driftType)) return 'critical'
  if (warning.includes(driftType)) return 'warning'
  return 'info'
}

// ─── Record Drift Event ───────────────────────────────────────────────────────

export async function recordDriftEvent(
  driftType: GovernanceDriftType,
  tenantId: string | null,
  description: string
): Promise<GovernanceDriftEvent> {
  const severity = classifyDriftSeverity(driftType)
  const result = await pool.query(
    `INSERT INTO governance_drift_events
       (drift_type, severity, tenant_id, description, detected_at, resolved_at, created_at)
     VALUES ($1, $2, $3, $4, NOW(), NULL, NOW())
     RETURNING *`,
    [driftType, severity, tenantId, description]
  )
  return _mapDriftEvent(result.rows[0])
}

// ─── Get Unresolved Drift Events ─────────────────────────────────────────────

export async function getUnresolvedDriftEvents(): Promise<GovernanceDriftEvent[]> {
  const result = await pool.query(
    `SELECT * FROM governance_drift_events
     WHERE resolved_at IS NULL
     ORDER BY severity DESC, detected_at DESC`
  )
  return result.rows.map(_mapDriftEvent)
}

// ─── Resolve Drift Event ──────────────────────────────────────────────────────

export async function resolveDriftEvent(eventId: string): Promise<GovernanceDriftEvent> {
  const result = await pool.query(
    `UPDATE governance_drift_events SET resolved_at = NOW() WHERE id = $1 RETURNING *`,
    [eventId]
  )
  if (result.rows.length === 0) {
    throw new Error(`Drift event ${eventId} not found`)
  }
  return _mapDriftEvent(result.rows[0])
}

// ─── Has Critical Drift ───────────────────────────────────────────────────────

export function hasCriticalDrift(events: GovernanceDriftEvent[]): boolean {
  return events.some(e => e.severity === 'critical' && e.resolvedAt === null)
}

// ─── Run Drift Detection ──────────────────────────────────────────────────────

export async function runDriftDetection(
  previousSnapshot: GovernanceSnapshot
): Promise<{ drifts: GovernanceDriftEvent[]; currentSnapshot: GovernanceSnapshot }> {
  const currentSnapshot = await takeGovernanceSnapshot()
  const driftTypes = compareSnapshots(currentSnapshot, previousSnapshot)

  const drifts: GovernanceDriftEvent[] = []
  for (const driftType of driftTypes) {
    const event = await recordDriftEvent(
      driftType,
      null,
      `Governance drift detected: ${driftType} at ${new Date().toISOString()}`
    )
    drifts.push(event)
  }

  return { drifts, currentSnapshot }
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  _mapDriftEvent,
  compareSnapshots,
  classifyDriftSeverity,
  hasCriticalDrift,
}
