// Denver Engineering — Service Lifecycle Manager (Phase 12)
// Manages service versioning and lifecycle states

import { pool } from '../../db/pool'
import { ServiceLifecycleRecord } from './phase12Types'

// ─── Mapper ──────────────────────────────────────────────────────────────────

function _mapLifecycleRecord(row: Record<string, unknown>): ServiceLifecycleRecord {
  return {
    id: row.id as string,
    serviceName: row.service_name as string,
    version: row.version as string,
    status: row.status as ServiceLifecycleRecord['status'],
    deprecatedAt: row.deprecated_at ? new Date(row.deprecated_at as string) : null,
    sunsetAt: row.sunset_at ? new Date(row.sunset_at as string) : null,
    replacedBy: row.replaced_by as string | null,
    createdAt: new Date(row.created_at as string),
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function isServiceActive(record: ServiceLifecycleRecord): boolean {
  return record.status === 'active'
}

export function isServiceSunset(record: ServiceLifecycleRecord): boolean {
  if (record.status === 'removed') return true
  if (record.sunsetAt && record.sunsetAt <= new Date()) return true
  return false
}

export function getDaysUntilSunset(record: ServiceLifecycleRecord): number | null {
  if (!record.sunsetAt) return null
  const diff = record.sunsetAt.getTime() - Date.now()
  return Math.ceil(diff / 86400000)
}

export function countByStatus(records: ServiceLifecycleRecord[]): Record<string, number> {
  return records.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1
    return acc
  }, {})
}

// ─── Service ─────────────────────────────────────────────────────────────────

export async function registerService(
  serviceName: string,
  version: string,
): Promise<ServiceLifecycleRecord> {
  const result = await pool.query(
    `INSERT INTO p12_service_lifecycle
       (service_name, version, status)
     VALUES ($1,$2,'active')
     ON CONFLICT (service_name, version) DO UPDATE SET status='active'
     RETURNING *`,
    [serviceName, version],
  )
  return _mapLifecycleRecord(result.rows[0])
}

export async function deprecateService(
  serviceName: string,
  version: string,
  sunsetAt: Date,
  replacedBy?: string,
): Promise<ServiceLifecycleRecord> {
  const result = await pool.query(
    `UPDATE p12_service_lifecycle
     SET status='deprecated', deprecated_at=NOW(), sunset_at=$3, replaced_by=$4
     WHERE service_name=$1 AND version=$2
     RETURNING *`,
    [serviceName, version, sunsetAt, replacedBy ?? null],
  )
  if (!result.rows[0]) throw new Error(`Service ${serviceName}@${version} not found`)
  return _mapLifecycleRecord(result.rows[0])
}

export async function getServicesByStatus(status: ServiceLifecycleRecord['status']): Promise<ServiceLifecycleRecord[]> {
  const result = await pool.query(
    `SELECT * FROM p12_service_lifecycle
     WHERE status = $1
     ORDER BY service_name`,
    [status],
  )
  return result.rows.map(_mapLifecycleRecord)
}

export async function getUpcomingSunsets(daysAhead = 30): Promise<ServiceLifecycleRecord[]> {
  const result = await pool.query(
    `SELECT * FROM p12_service_lifecycle
     WHERE status = 'deprecated'
       AND sunset_at <= NOW() + ($1 || ' days')::interval
     ORDER BY sunset_at ASC`,
    [daysAhead],
  )
  return result.rows.map(_mapLifecycleRecord)
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  isServiceActive,
  isServiceSunset,
  getDaysUntilSunset,
  countByStatus,
  _mapLifecycleRecord,
}
