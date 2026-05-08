// Denver Engineering — Migration Validation Service (Phase 11)
// Validate imported data against platform schema rules before committing

import { pool, tenantQuery } from '../../db/pool'

// ─── Validation Result ────────────────────────────────────────────────────────

export interface RowValidationResult {
  rowIndex: number
  valid: boolean
  errors: string[]
  warnings: string[]
}

export interface MigrationValidationSummary {
  jobId: string
  totalRows: number
  validRows: number
  invalidRows: number
  warningRows: number
  errors: string[]
  validatedAt: Date
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _mapValidationSummary(row: Record<string, unknown>): MigrationValidationSummary {
  return {
    jobId: row.job_id as string,
    totalRows: Number(row.total_rows),
    validRows: Number(row.valid_rows),
    invalidRows: Number(row.invalid_rows),
    warningRows: Number(row.warning_rows),
    errors: (row.errors as string[]) ?? [],
    validatedAt: new Date(row.validated_at as string),
  }
}

// ─── Validate Single Row ──────────────────────────────────────────────────────

export function validateRow(
  row: Record<string, unknown>,
  rowIndex: number,
  requiredFields: string[],
  numericFields: string[] = [],
  dateFields: string[] = []
): RowValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  for (const field of requiredFields) {
    if (row[field] === undefined || row[field] === null || row[field] === '') {
      errors.push(`Row ${rowIndex}: required field '${field}' is missing or empty`)
    }
  }

  for (const field of numericFields) {
    if (row[field] !== undefined && row[field] !== null) {
      const num = Number(row[field])
      if (isNaN(num)) {
        errors.push(`Row ${rowIndex}: field '${field}' must be a number, got '${row[field]}'`)
      }
    }
  }

  for (const field of dateFields) {
    if (row[field] !== undefined && row[field] !== null) {
      const d = new Date(row[field] as string)
      if (isNaN(d.getTime())) {
        errors.push(`Row ${rowIndex}: field '${field}' must be a valid date, got '${row[field]}'`)
      }
    }
  }

  return {
    rowIndex,
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

// ─── Validate Batch ───────────────────────────────────────────────────────────

export function validateBatch(
  rows: Record<string, unknown>[],
  requiredFields: string[],
  numericFields: string[] = [],
  dateFields: string[] = []
): RowValidationResult[] {
  return rows.map((row, idx) =>
    validateRow(row, idx, requiredFields, numericFields, dateFields)
  )
}

// ─── Store Validation Summary ─────────────────────────────────────────────────

export async function storeValidationSummary(
  jobId: string,
  results: RowValidationResult[]
): Promise<MigrationValidationSummary> {
  const totalRows = results.length
  const validRows = results.filter(r => r.valid).length
  const invalidRows = results.filter(r => !r.valid).length
  const warningRows = results.filter(r => r.warnings.length > 0).length
  const errors = results.flatMap(r => r.errors).slice(0, 100)

  const stored = await pool.query(
    `INSERT INTO migration_validation_summaries
       (job_id, total_rows, valid_rows, invalid_rows, warning_rows, errors, validated_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
     ON CONFLICT (job_id) DO UPDATE
       SET total_rows = $2, valid_rows = $3, invalid_rows = $4,
           warning_rows = $5, errors = $6, validated_at = NOW()
     RETURNING *`,
    [jobId, totalRows, validRows, invalidRows, warningRows, errors]
  )
  return _mapValidationSummary(stored.rows[0])
}

// ─── Get Validation Summary ───────────────────────────────────────────────────

export async function getValidationSummary(jobId: string): Promise<MigrationValidationSummary | null> {
  const result = await pool.query(
    `SELECT * FROM migration_validation_summaries WHERE job_id = $1`,
    [jobId]
  )
  return result.rows.length > 0 ? _mapValidationSummary(result.rows[0]) : null
}

// ─── Check for Duplicate Keys ─────────────────────────────────────────────────

export async function checkForDuplicateKeys(
  tenantId: string,
  tableName: string,
  keyField: string,
  keyValues: string[]
): Promise<string[]> {
  if (keyValues.length === 0) return []
  const rows = await tenantQuery(
    tenantId,
    `SELECT ${keyField} FROM ${tableName} WHERE ${keyField} = ANY($1)`,
    [keyValues]
  )
  return (rows as Record<string, unknown>[]).map(r => r[keyField] as string)
}

// ─── Is Validation Passed ─────────────────────────────────────────────────────

export function isValidationPassed(summary: MigrationValidationSummary): boolean {
  return summary.invalidRows === 0
}

// ─── Compute Validation Pass Rate ────────────────────────────────────────────

export function computeValidationPassRate(summary: MigrationValidationSummary): number {
  if (summary.totalRows === 0) return 0
  return summary.validRows / summary.totalRows
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  _mapValidationSummary,
  validateRow,
  validateBatch,
  isValidationPassed,
  computeValidationPassRate,
}
