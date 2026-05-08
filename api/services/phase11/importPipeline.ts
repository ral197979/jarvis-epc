// Denver Engineering — Import Pipeline (Phase 11)
// Manage data import jobs with validation, execution, and rollback support

import { pool } from '../../db/pool'
import {
  ImportJob,
  ImportSource,
  ImportStatus,
  IMPORT_MAX_BATCH_SIZE,
} from './phase11Types'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _mapImportJob(row: Record<string, unknown>): ImportJob {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    source: row.source as ImportSource,
    fileName: row.file_name as string,
    rowCount: Number(row.row_count),
    validatedRows: Number(row.validated_rows),
    importedRows: Number(row.imported_rows),
    failedRows: Number(row.failed_rows),
    status: row.status as ImportStatus,
    dryRun: Boolean(row.dry_run),
    errors: (row.errors as string[]) ?? [],
    startedAt: new Date(row.started_at as string),
    completedAt: row.completed_at ? new Date(row.completed_at as string) : null,
    createdAt: new Date(row.created_at as string),
  }
}

// ─── Create Import Job ────────────────────────────────────────────────────────

export async function createImportJob(
  tenantId: string,
  source: ImportSource,
  fileName: string,
  rowCount: number,
  dryRun: boolean = false
): Promise<ImportJob> {
  const result = await pool.query(
    `INSERT INTO import_jobs
       (tenant_id, source, file_name, row_count, validated_rows, imported_rows,
        failed_rows, status, dry_run, errors, started_at, completed_at, created_at)
     VALUES ($1, $2, $3, $4, 0, 0, 0, 'pending', $5, '{}', NOW(), NULL, NOW())
     RETURNING *`,
    [tenantId, source, fileName, rowCount, dryRun]
  )
  return _mapImportJob(result.rows[0])
}

// ─── Advance Import Status ────────────────────────────────────────────────────

export async function advanceImportStatus(
  jobId: string,
  status: ImportStatus,
  updates: {
    validatedRows?: number
    importedRows?: number
    failedRows?: number
    errors?: string[]
  } = {}
): Promise<ImportJob> {
  const sets: string[] = ['status = $1']
  const params: unknown[] = [status]
  let paramIdx = 2

  if (updates.validatedRows !== undefined) {
    sets.push(`validated_rows = $${paramIdx++}`)
    params.push(updates.validatedRows)
  }
  if (updates.importedRows !== undefined) {
    sets.push(`imported_rows = $${paramIdx++}`)
    params.push(updates.importedRows)
  }
  if (updates.failedRows !== undefined) {
    sets.push(`failed_rows = $${paramIdx++}`)
    params.push(updates.failedRows)
  }
  if (updates.errors !== undefined) {
    sets.push(`errors = $${paramIdx++}`)
    params.push(updates.errors)
  }
  if (status === 'complete' || status === 'failed' || status === 'rolled_back') {
    sets.push('completed_at = NOW()')
  }

  params.push(jobId)
  const result = await pool.query(
    `UPDATE import_jobs SET ${sets.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
    params
  )
  return _mapImportJob(result.rows[0])
}

// ─── Get Import Job ───────────────────────────────────────────────────────────

export async function getImportJob(jobId: string): Promise<ImportJob | null> {
  const result = await pool.query(
    `SELECT * FROM import_jobs WHERE id = $1`,
    [jobId]
  )
  return result.rows.length > 0 ? _mapImportJob(result.rows[0]) : null
}

// ─── List Import Jobs ─────────────────────────────────────────────────────────

export async function listImportJobs(
  tenantId: string,
  status?: ImportStatus
): Promise<ImportJob[]> {
  if (status) {
    const result = await pool.query(
      `SELECT * FROM import_jobs WHERE tenant_id = $1 AND status = $2 ORDER BY created_at DESC`,
      [tenantId, status]
    )
    return result.rows.map(_mapImportJob)
  }
  const result = await pool.query(
    `SELECT * FROM import_jobs WHERE tenant_id = $1 ORDER BY created_at DESC`,
    [tenantId]
  )
  return result.rows.map(_mapImportJob)
}

// ─── Compute Batch Count ──────────────────────────────────────────────────────

export function computeBatchCount(rowCount: number): number {
  return Math.ceil(rowCount / IMPORT_MAX_BATCH_SIZE)
}

// ─── Compute Import Progress ──────────────────────────────────────────────────

export function computeImportProgress(job: ImportJob): number {
  if (job.rowCount === 0) return 0
  const processed = job.importedRows + job.failedRows
  return Math.round((processed / job.rowCount) * 100)
}

// ─── Is Import Successful ─────────────────────────────────────────────────────

export function isImportSuccessful(job: ImportJob): boolean {
  return job.status === 'complete' && job.failedRows === 0
}

// ─── Can Rollback ─────────────────────────────────────────────────────────────

export function canRollback(job: ImportJob): boolean {
  return (job.status === 'complete' || job.status === 'failed') && !job.dryRun
}

// ─── Validate Row Count ───────────────────────────────────────────────────────

export function validateRowCount(rowCount: number): { valid: boolean; error?: string } {
  if (rowCount <= 0) return { valid: false, error: 'Row count must be positive' }
  if (rowCount > IMPORT_MAX_BATCH_SIZE * 100) {
    return { valid: false, error: `Row count exceeds maximum allowed (${IMPORT_MAX_BATCH_SIZE * 100})` }
  }
  return { valid: true }
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  _mapImportJob,
  computeBatchCount,
  computeImportProgress,
  isImportSuccessful,
  canRollback,
  validateRowCount,
}
