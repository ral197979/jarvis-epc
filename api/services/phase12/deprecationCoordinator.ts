// Denver Engineering — Deprecation Coordinator (Phase 12)
// Tracks deprecation schedules and tenant migration paths

import { pool } from '../../db/pool'
import { DeprecationRecord } from './phase12Types'

// ─── Mapper ──────────────────────────────────────────────────────────────────

function _mapDeprecationRecord(row: Record<string, unknown>): DeprecationRecord {
  return {
    id: row.id as string,
    entityType: row.entity_type as DeprecationRecord['entityType'],
    entityId: row.entity_id as string,
    entityName: row.entity_name as string,
    deprecatedAt: new Date(row.deprecated_at as string),
    sunsetAt: new Date(row.sunset_at as string),
    migrationPath: row.migration_path as string | null,
    affectedTenantsCount: Number(row.affected_tenants_count),
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function isDeprecated(record: DeprecationRecord): boolean {
  return record.deprecatedAt <= new Date()
}

export function isPastSunset(record: DeprecationRecord): boolean {
  return record.sunsetAt <= new Date()
}

export function getDaysToSunset(record: DeprecationRecord): number {
  return Math.ceil((record.sunsetAt.getTime() - Date.now()) / 86400000)
}

export function isHighImpactDeprecation(record: DeprecationRecord): boolean {
  return record.affectedTenantsCount >= 10 || record.migrationPath === null
}

// ─── Service ─────────────────────────────────────────────────────────────────

export async function recordDeprecation(
  entityType: DeprecationRecord['entityType'],
  entityId: string,
  entityName: string,
  sunsetAt: Date,
  affectedTenantsCount: number,
  migrationPath?: string,
): Promise<DeprecationRecord> {
  const result = await pool.query(
    `INSERT INTO p12_deprecations
       (entity_type, entity_id, entity_name, deprecated_at, sunset_at, migration_path, affected_tenants_count)
     VALUES ($1,$2,$3,NOW(),$4,$5,$6)
     RETURNING *`,
    [entityType, entityId, entityName, sunsetAt, migrationPath ?? null, affectedTenantsCount],
  )
  return _mapDeprecationRecord(result.rows[0])
}

export async function getActiveDeprecations(entityType?: DeprecationRecord['entityType']): Promise<DeprecationRecord[]> {
  const result = await pool.query(
    `SELECT * FROM p12_deprecations
     WHERE sunset_at > NOW()
       AND ($1::text IS NULL OR entity_type = $1)
     ORDER BY sunset_at ASC`,
    [entityType ?? null],
  )
  return result.rows.map(_mapDeprecationRecord)
}

export async function getUrgentDeprecations(daysAhead = 30): Promise<DeprecationRecord[]> {
  const result = await pool.query(
    `SELECT * FROM p12_deprecations
     WHERE sunset_at <= NOW() + ($1 || ' days')::interval
       AND sunset_at > NOW()
     ORDER BY sunset_at ASC, affected_tenants_count DESC`,
    [daysAhead],
  )
  return result.rows.map(_mapDeprecationRecord)
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  isDeprecated,
  isPastSunset,
  getDaysToSunset,
  isHighImpactDeprecation,
  _mapDeprecationRecord,
}
