// Denver Engineering — Compatibility Matrix Generator (Phase 12)
// Generates and validates version compatibility matrices

import { pool } from '../../db/pool'
import { CompatibilityMatrix } from './phase12Types'

// ─── Mapper ──────────────────────────────────────────────────────────────────

function _mapCompatibilityMatrix(row: Record<string, unknown>): CompatibilityMatrix {
  return {
    id: row.id as string,
    fromVersion: row.from_version as string,
    toVersion: row.to_version as string,
    compatible: row.compatible as boolean,
    replayCompatible: row.replay_compatible as boolean,
    schemaCompatible: row.schema_compatible as boolean,
    breakingChanges: row.breaking_changes as string[],
    generatedAt: new Date(row.generated_at as string),
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function isFullyCompatible(matrix: CompatibilityMatrix): boolean {
  return matrix.compatible && matrix.replayCompatible && matrix.schemaCompatible && matrix.breakingChanges.length === 0
}

export function hasBreakingChanges(matrix: CompatibilityMatrix): boolean {
  return matrix.breakingChanges.length > 0
}

export function classifyCompatibilityRisk(matrix: CompatibilityMatrix): 'none' | 'low' | 'medium' | 'high' {
  if (!matrix.replayCompatible) return 'high'
  if (!matrix.schemaCompatible) return 'high'
  if (!matrix.compatible) return 'medium'
  if (matrix.breakingChanges.length > 0) return 'low'
  return 'none'
}

export function requiresMigration(matrix: CompatibilityMatrix): boolean {
  return !matrix.schemaCompatible || matrix.breakingChanges.length > 0
}

// ─── Service ─────────────────────────────────────────────────────────────────

export async function generateCompatibilityMatrix(
  fromVersion: string,
  toVersion: string,
  compatible: boolean,
  replayCompatible: boolean,
  schemaCompatible: boolean,
  breakingChanges: string[],
): Promise<CompatibilityMatrix> {
  const result = await pool.query(
    `INSERT INTO p12_compatibility_matrix
       (from_version, to_version, compatible, replay_compatible, schema_compatible, breaking_changes, generated_at)
     VALUES ($1,$2,$3,$4,$5,$6,NOW())
     ON CONFLICT (from_version, to_version) DO UPDATE
       SET compatible=$3, replay_compatible=$4, schema_compatible=$5, breaking_changes=$6, generated_at=NOW()
     RETURNING *`,
    [fromVersion, toVersion, compatible, replayCompatible, schemaCompatible, JSON.stringify(breakingChanges)],
  )
  return _mapCompatibilityMatrix(result.rows[0])
}

export async function getCompatibilityMatrix(fromVersion: string, toVersion: string): Promise<CompatibilityMatrix | null> {
  const result = await pool.query(
    `SELECT * FROM p12_compatibility_matrix
     WHERE from_version = $1 AND to_version = $2`,
    [fromVersion, toVersion],
  )
  return result.rows[0] ? _mapCompatibilityMatrix(result.rows[0]) : null
}

export async function getIncompatibleUpgrades(): Promise<CompatibilityMatrix[]> {
  const result = await pool.query(
    `SELECT * FROM p12_compatibility_matrix
     WHERE compatible = FALSE OR replay_compatible = FALSE OR schema_compatible = FALSE
     ORDER BY generated_at DESC`,
  )
  return result.rows.map(_mapCompatibilityMatrix)
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  isFullyCompatible,
  hasBreakingChanges,
  classifyCompatibilityRisk,
  requiresMigration,
  _mapCompatibilityMatrix,
}
