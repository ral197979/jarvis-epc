// Denver Engineering — Support Triage Engine (Phase 11)
// Automatically triage support tickets with priority classification and diagnostics

import { pool } from '../../db/pool'
import {
  SupportTriageRecord,
  TriagePriority,
  IncidentClusterType,
} from './phase11Types'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _mapTriageRecord(row: Record<string, unknown>): SupportTriageRecord {
  return {
    id: row.id as string,
    ticketId: row.ticket_id as string,
    tenantId: row.tenant_id as string,
    suggestedPriority: row.suggested_priority as TriagePriority,
    clusterType: row.cluster_type as IncidentClusterType,
    confidence: Number(row.confidence),
    diagnosticSummary: row.diagnostic_summary as string,
    suggestedActions: (row.suggested_actions as string[]) ?? [],
    escalateToEngineering: Boolean(row.escalate_to_engineering),
    triagedAt: new Date(row.triaged_at as string),
    createdAt: new Date(row.created_at as string),
  }
}

// ─── Classify Cluster Type ────────────────────────────────────────────────────

export function classifyClusterType(
  title: string,
  description: string
): { clusterType: IncidentClusterType; confidence: number } {
  const text = `${title} ${description}`.toLowerCase()

  if (text.includes('replay') && text.includes('diverge')) {
    return { clusterType: 'replay_divergence', confidence: 0.9 }
  }
  if (text.includes('queue') && (text.includes('full') || text.includes('saturat'))) {
    return { clusterType: 'queue_saturation', confidence: 0.85 }
  }
  if (text.includes('billing') && (text.includes('lag') || text.includes('delay'))) {
    return { clusterType: 'billing_lag', confidence: 0.8 }
  }
  if (text.includes('auth') && (text.includes('fail') || text.includes('error') || text.includes('401'))) {
    return { clusterType: 'auth_failure', confidence: 0.85 }
  }
  if (text.includes('edge') && (text.includes('disconnect') || text.includes('sync'))) {
    return { clusterType: 'edge_disconnect', confidence: 0.8 }
  }
  if (text.includes('ai') && (text.includes('provider') || text.includes('openai') || text.includes('error'))) {
    return { clusterType: 'ai_provider_error', confidence: 0.8 }
  }
  if (text.includes('export') && (text.includes('fail') || text.includes('timeout'))) {
    return { clusterType: 'export_failure', confidence: 0.8 }
  }

  return { clusterType: 'unknown', confidence: 0.3 }
}

// ─── Suggest Priority ─────────────────────────────────────────────────────────

export function suggestPriority(
  clusterType: IncidentClusterType,
  affectedUsers: number
): TriagePriority {
  if (clusterType === 'replay_divergence' || clusterType === 'auth_failure') return 'critical'
  if (affectedUsers >= 100) return 'critical'
  if (clusterType === 'queue_saturation' || clusterType === 'billing_lag') return 'high'
  if (affectedUsers >= 10) return 'high'
  if (clusterType === 'edge_disconnect' || clusterType === 'ai_provider_error') return 'medium'
  return 'low'
}

// ─── Generate Diagnostic Summary ─────────────────────────────────────────────

export function generateDiagnosticSummary(
  clusterType: IncidentClusterType,
  confidence: number
): string {
  const confidenceLabel = confidence >= 0.8 ? 'High' : confidence >= 0.5 ? 'Medium' : 'Low'
  const summaries: Record<IncidentClusterType, string> = {
    replay_divergence: `Replay divergence detected. ${confidenceLabel} confidence. Check hash mismatches in replay_events table.`,
    queue_saturation: `Queue saturation pattern detected. ${confidenceLabel} confidence. Monitor queue depth and concurrency settings.`,
    billing_lag: `Billing reconciliation lag. ${confidenceLabel} confidence. Check billing_events backlog and reconciliation job health.`,
    auth_failure: `Authentication failure cluster. ${confidenceLabel} confidence. Verify JWT secrets and session store connectivity.`,
    edge_disconnect: `Edge sync disconnect pattern. ${confidenceLabel} confidence. Check edge node connectivity and sync lag metrics.`,
    ai_provider_error: `AI provider error cluster. ${confidenceLabel} confidence. Check OpenAI API status and fallback routing.`,
    export_failure: `Export failure pattern. ${confidenceLabel} confidence. Review export worker health and storage permissions.`,
    unknown: `Unknown incident type. ${confidenceLabel} confidence. Manual investigation required.`,
  }
  return summaries[clusterType]
}

// ─── Generate Suggested Actions ───────────────────────────────────────────────

export function generateSuggestedActions(clusterType: IncidentClusterType): string[] {
  const actions: Record<IncidentClusterType, string[]> = {
    replay_divergence: [
      'Check replay_incidents table for open incidents',
      'Verify computeReplayHash output matches stored hash',
      'Review recent event handler changes for non-determinism',
    ],
    queue_saturation: [
      'Increase queue_concurrency tuning parameter',
      'Check for stalled workers',
      'Review queue depth metrics and alert thresholds',
    ],
    billing_lag: [
      'Check billing reconciliation job health',
      'Review billing_events for unprocessed records',
      'Verify billing worker is running',
    ],
    auth_failure: [
      'Verify JWT secret rotation schedule',
      'Check session store (Redis) connectivity',
      'Review recent auth middleware changes',
    ],
    edge_disconnect: [
      'Check edge node network connectivity',
      'Review sync_batch_interval tuning',
      'Verify edge device firmware version',
    ],
    ai_provider_error: [
      'Check OpenAI API status page',
      'Verify API key validity and rate limits',
      'Enable AI fallback routing if available',
    ],
    export_failure: [
      'Check export worker pod status',
      'Verify S3/storage credentials and permissions',
      'Review export job logs for timeout patterns',
    ],
    unknown: [
      'Escalate to engineering for manual investigation',
      'Collect full diagnostic report',
      'Review recent deployment changes',
    ],
  }
  return actions[clusterType]
}

// ─── Should Escalate ─────────────────────────────────────────────────────────

export function shouldEscalateToEngineering(
  priority: TriagePriority,
  clusterType: IncidentClusterType
): boolean {
  return priority === 'critical' ||
    clusterType === 'replay_divergence' ||
    clusterType === 'unknown'
}

// ─── Create Triage Record ─────────────────────────────────────────────────────

export async function createTriageRecord(
  ticketId: string,
  tenantId: string,
  title: string,
  description: string,
  affectedUsers: number = 0
): Promise<SupportTriageRecord> {
  const { clusterType, confidence } = classifyClusterType(title, description)
  const priority = suggestPriority(clusterType, affectedUsers)
  const diagnosticSummary = generateDiagnosticSummary(clusterType, confidence)
  const suggestedActions = generateSuggestedActions(clusterType)
  const escalate = shouldEscalateToEngineering(priority, clusterType)

  const result = await pool.query(
    `INSERT INTO support_triage_records
       (ticket_id, tenant_id, suggested_priority, cluster_type, confidence,
        diagnostic_summary, suggested_actions, escalate_to_engineering, triaged_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
     RETURNING *`,
    [ticketId, tenantId, priority, clusterType, confidence, diagnosticSummary, suggestedActions, escalate]
  )
  return _mapTriageRecord(result.rows[0])
}

// ─── Get Triage Record ────────────────────────────────────────────────────────

export async function getTriageRecord(ticketId: string): Promise<SupportTriageRecord | null> {
  const result = await pool.query(
    `SELECT * FROM support_triage_records WHERE ticket_id = $1`,
    [ticketId]
  )
  return result.rows.length > 0 ? _mapTriageRecord(result.rows[0]) : null
}

// ─── List Critical Triage Records ────────────────────────────────────────────

export async function listCriticalTriageRecords(): Promise<SupportTriageRecord[]> {
  const result = await pool.query(
    `SELECT * FROM support_triage_records
     WHERE suggested_priority = 'critical' OR escalate_to_engineering = true
     ORDER BY triaged_at DESC`
  )
  return result.rows.map(_mapTriageRecord)
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  _mapTriageRecord,
  classifyClusterType,
  suggestPriority,
  generateDiagnosticSummary,
  generateSuggestedActions,
  shouldEscalateToEngineering,
}
