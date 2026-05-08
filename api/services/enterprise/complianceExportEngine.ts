// Denver Engineering — Compliance Export Engine (v8.0.0)
// Creates, tracks, and serves compliance data exports with checksums and audit trails.

import { createHash } from 'crypto'
import { tenantQuery } from '../../db/pool'
import {
  ComplianceExport, RequestExportInput, ExportFormat, ExportStatus,
} from './enterpriseTypes'
import { requireFeature } from './featureGateService'

// Export TTL: 7 days
const EXPORT_TTL_MS = 7 * 24 * 60 * 60 * 1000

// ─── Request a new export ─────────────────────────────────────────────────────

export async function requestExport(
  tenantId: string,
  input: RequestExportInput,
): Promise<ComplianceExport> {
  await requireFeature(tenantId, 'compliance_export')

  const { exportType, format, requestedBy, filterFrom, filterTo } = input
  const expiresAt = new Date(Date.now() + EXPORT_TTL_MS)

  const res = await tenantQuery(
    tenantId,
    `INSERT INTO compliance_exports
      (tenant_id, export_type, format, status, requested_by,
       filter_from, filter_to, expires_at, manifest)
     VALUES ($1,$2,$3,'pending',$4,$5,$6,$7,'{}')
     RETURNING *`,
    [tenantId, exportType, format, requestedBy ?? null, filterFrom ?? null, filterTo ?? null, expiresAt],
  )
  return _mapExport(res.rows[0])
}

// ─── Get export ───────────────────────────────────────────────────────────────

export async function getExport(tenantId: string, exportId: string): Promise<ComplianceExport | null> {
  const res = await tenantQuery(
    tenantId,
    `SELECT * FROM compliance_exports WHERE tenant_id = $1 AND id = $2`,
    [tenantId, exportId],
  )
  return res.rows.length > 0 ? _mapExport(res.rows[0]) : null
}

// ─── List exports ─────────────────────────────────────────────────────────────

export async function listExports(
  tenantId: string,
  opts: { status?: ExportStatus; limit?: number } = {},
): Promise<ComplianceExport[]> {
  const { status, limit = 50 } = opts
  const params: unknown[] = [tenantId]
  let statusCond = ''
  if (status != null) { params.push(status); statusCond = `AND status = $${params.length}` }
  params.push(limit)

  const res = await tenantQuery(
    tenantId,
    `SELECT * FROM compliance_exports WHERE tenant_id = $1 ${statusCond}
     ORDER BY created_at DESC LIMIT $${params.length}`,
    params,
  )
  return res.rows.map(_mapExport)
}

// ─── Mark export running ──────────────────────────────────────────────────────

export async function markExportRunning(
  tenantId: string,
  exportId: string,
): Promise<ComplianceExport> {
  const res = await tenantQuery(
    tenantId,
    `UPDATE compliance_exports SET status = 'running' WHERE tenant_id = $1 AND id = $2 RETURNING *`,
    [tenantId, exportId],
  )
  if (res.rows.length === 0) throw new Error(`Export ${exportId} not found`)
  return _mapExport(res.rows[0])
}

// ─── Complete export ──────────────────────────────────────────────────────────

export async function completeExport(
  tenantId: string,
  exportId: string,
  result: {
    storagePath: string
    recordCount: number
    fileSizeBytes: number
    data: string | Buffer // raw data for checksum
    manifest?: Record<string, unknown>
  },
): Promise<ComplianceExport> {
  const checksum = _computeChecksum(result.data)

  const res = await tenantQuery(
    tenantId,
    `UPDATE compliance_exports SET
       status = 'completed',
       storage_path = $2,
       record_count = $3,
       file_size_bytes = $4,
       checksum = $5,
       manifest = $6,
       completed_at = now()
     WHERE tenant_id = $1 AND id = $7
     RETURNING *`,
    [
      tenantId, result.storagePath, result.recordCount, result.fileSizeBytes,
      checksum, JSON.stringify(result.manifest ?? {}), exportId,
    ],
  )
  if (res.rows.length === 0) throw new Error(`Export ${exportId} not found`)
  return _mapExport(res.rows[0])
}

// ─── Fail export ──────────────────────────────────────────────────────────────

export async function failExport(
  tenantId: string,
  exportId: string,
  error: string,
): Promise<ComplianceExport> {
  const res = await tenantQuery(
    tenantId,
    `UPDATE compliance_exports SET status = 'failed', error = $2 WHERE tenant_id = $1 AND id = $3 RETURNING *`,
    [tenantId, error, exportId],
  )
  if (res.rows.length === 0) throw new Error(`Export ${exportId} not found`)
  return _mapExport(res.rows[0])
}

// ─── Expire stale exports (background job) ────────────────────────────────────

export async function expireStaleExports(tenantId: string): Promise<number> {
  const res = await tenantQuery(
    tenantId,
    `UPDATE compliance_exports
     SET status = 'expired'
     WHERE tenant_id = $1 AND status = 'completed' AND expires_at < now()
     RETURNING id`,
    [tenantId],
  )
  return res.rows.length
}

// ─── Checksum ─────────────────────────────────────────────────────────────────

function _computeChecksum(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

// ─── Mapper ───────────────────────────────────────────────────────────────────

export function _mapExport(row: Record<string, unknown>): ComplianceExport {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    exportType: String(row.export_type),
    format: row.format as ExportFormat,
    status: row.status as ExportStatus,
    requestedBy: row.requested_by != null ? String(row.requested_by) : undefined,
    filterFrom: row.filter_from != null ? new Date(row.filter_from as string) : undefined,
    filterTo: row.filter_to != null ? new Date(row.filter_to as string) : undefined,
    recordCount: row.record_count != null ? Number(row.record_count) : undefined,
    fileSizeBytes: row.file_size_bytes != null ? Number(row.file_size_bytes) : undefined,
    storagePath: row.storage_path != null ? String(row.storage_path) : undefined,
    checksum: row.checksum != null ? String(row.checksum) : undefined,
    manifest: (row.manifest ?? {}) as Record<string, unknown>,
    expiresAt: row.expires_at != null ? new Date(row.expires_at as string) : undefined,
    completedAt: row.completed_at != null ? new Date(row.completed_at as string) : undefined,
    error: row.error != null ? String(row.error) : undefined,
    createdAt: new Date(row.created_at as string),
  }
}

export const __testHooks = { _mapExport, _computeChecksum, EXPORT_TTL_MS }
