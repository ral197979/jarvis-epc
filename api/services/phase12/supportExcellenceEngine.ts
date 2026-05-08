// Denver Engineering — Support Excellence Engine (Phase 12)
// Tracks support records, resolution times, and operational outcomes

import { pool } from '../../db/pool'
import { tenantQuery } from '../../db/pool'
import { SupportRecord } from './phase12Types'

// ─── Mapper ──────────────────────────────────────────────────────────────────

function _mapSupportRecord(row: Record<string, unknown>): SupportRecord {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    incidentId: row.incident_id as string | null,
    category: row.category as string,
    priority: row.priority as SupportRecord['priority'],
    replayAssisted: row.replay_assisted as boolean,
    resolutionTimeMs: row.resolution_time_ms != null ? Number(row.resolution_time_ms) : null,
    aiSummaryGenerated: row.ai_summary_generated as boolean,
    resolvedAt: row.resolved_at ? new Date(row.resolved_at as string) : null,
    createdAt: new Date(row.created_at as string),
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function computeAverageResolutionTime(records: SupportRecord[]): number {
  const resolved = records.filter(r => r.resolutionTimeMs != null)
  if (resolved.length === 0) return 0
  return resolved.reduce((sum, r) => sum + (r.resolutionTimeMs ?? 0), 0) / resolved.length
}

export function isSupportSLAMet(record: SupportRecord, slaMs: number): boolean {
  if (record.resolutionTimeMs == null) return false
  return record.resolutionTimeMs <= slaMs
}

export function getSLAThresholdMs(priority: SupportRecord['priority']): number {
  switch (priority) {
    case 'critical': return 4 * 60 * 60 * 1000       // 4 hours
    case 'high': return 24 * 60 * 60 * 1000           // 24 hours
    case 'medium': return 72 * 60 * 60 * 1000         // 72 hours
    case 'low': return 7 * 24 * 60 * 60 * 1000        // 7 days
  }
}

export function computeSLAComplianceRate(records: SupportRecord[]): number {
  const resolved = records.filter(r => r.resolutionTimeMs != null)
  if (resolved.length === 0) return 1.0
  const met = resolved.filter(r => isSupportSLAMet(r, getSLAThresholdMs(r.priority))).length
  return met / resolved.length
}

// ─── Service ─────────────────────────────────────────────────────────────────

export async function createSupportRecord(
  tenantId: string,
  category: string,
  priority: SupportRecord['priority'],
  incidentId?: string,
): Promise<SupportRecord> {
  const result = await pool.query(
    `INSERT INTO p12_support_records
       (tenant_id, incident_id, category, priority, replay_assisted, ai_summary_generated)
     VALUES ($1,$2,$3,$4,FALSE,FALSE)
     RETURNING *`,
    [tenantId, incidentId ?? null, category, priority],
  )
  return _mapSupportRecord(result.rows[0])
}

export async function resolveSupportRecord(
  recordId: string,
  resolutionTimeMs: number,
  replayAssisted: boolean,
  aiSummaryGenerated: boolean,
): Promise<SupportRecord> {
  const result = await pool.query(
    `UPDATE p12_support_records
     SET resolution_time_ms=$2, replay_assisted=$3, ai_summary_generated=$4, resolved_at=NOW()
     WHERE id=$1
     RETURNING *`,
    [recordId, resolutionTimeMs, replayAssisted, aiSummaryGenerated],
  )
  if (!result.rows[0]) throw new Error(`SupportRecord ${recordId} not found`)
  return _mapSupportRecord(result.rows[0])
}

export async function getTenantSupportRecords(tenantId: string, limit = 50): Promise<SupportRecord[]> {
  const result = await tenantQuery(
    tenantId,
    `SELECT * FROM p12_support_records
     WHERE tenant_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [tenantId, limit],
  )
  return result.rows.map(_mapSupportRecord)
}

export async function getOpenCriticalRecords(): Promise<SupportRecord[]> {
  const result = await pool.query(
    `SELECT * FROM p12_support_records
     WHERE priority = 'critical' AND resolved_at IS NULL
     ORDER BY created_at ASC`,
  )
  return result.rows.map(_mapSupportRecord)
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  computeAverageResolutionTime,
  isSupportSLAMet,
  getSLAThresholdMs,
  computeSLAComplianceRate,
  _mapSupportRecord,
}
