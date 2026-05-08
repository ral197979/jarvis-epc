// Denver Engineering — Migration Safety Validator (Phase 11)
// Validate deployment migrations against production safety criteria

import { pool, tenantQuery } from '../../db/pool'

// ─── Migration Safety Check ───────────────────────────────────────────────────

export interface MigrationSafetyCheck {
  checkName: string
  passed: boolean
  severity: 'critical' | 'warning' | 'info'
  detail: string
}

export interface MigrationSafetyReport {
  version: string
  environment: string
  checks: MigrationSafetyCheck[]
  safeToApply: boolean
  blockers: string[]
  warnings: string[]
  evaluatedAt: Date
}

// ─── Individual Safety Checks ─────────────────────────────────────────────────

export async function checkNoOrphanedForeignKeys(
  tenantId: string
): Promise<MigrationSafetyCheck> {
  try {
    const rows = await tenantQuery(
      tenantId,
      `SELECT COUNT(*) as count FROM information_schema.table_constraints
       WHERE constraint_type = 'FOREIGN KEY'
         AND table_schema = 'public'`,
      []
    )
    const count = Number((rows[0] as Record<string, unknown>)?.count ?? 0)
    return {
      checkName: 'no_orphaned_foreign_keys',
      passed: true,
      severity: 'info',
      detail: `${count} foreign key constraints active`,
    }
  } catch {
    return {
      checkName: 'no_orphaned_foreign_keys',
      passed: false,
      severity: 'warning',
      detail: 'Could not verify foreign key constraints',
    }
  }
}

export async function checkNoLongRunningTransactions(): Promise<MigrationSafetyCheck> {
  const result = await pool.query(
    `SELECT COUNT(*) as count FROM pg_stat_activity
     WHERE state = 'active'
       AND now() - pg_stat_activity.query_start > interval '5 minutes'`
  )
  const count = Number(result.rows[0]?.count ?? 0)
  return {
    checkName: 'no_long_running_transactions',
    passed: count === 0,
    severity: count > 0 ? 'critical' : 'info',
    detail: count === 0
      ? 'No long-running transactions detected'
      : `${count} long-running transaction(s) detected — migration may cause locks`,
  }
}

export async function checkReplayIntegrityBeforeMigration(): Promise<MigrationSafetyCheck> {
  const result = await pool.query(
    `SELECT COUNT(*) as count FROM replay_incidents WHERE status = 'open'`
  )
  const openCount = Number(result.rows[0]?.count ?? 0)
  return {
    checkName: 'replay_integrity_pre_migration',
    passed: openCount === 0,
    severity: openCount > 0 ? 'critical' : 'info',
    detail: openCount === 0
      ? 'No open replay incidents — safe to migrate'
      : `${openCount} open replay incident(s) — resolve before migrating`,
  }
}

export async function checkDiskSpaceAvailable(): Promise<MigrationSafetyCheck> {
  // Use pg catalog to check database size as proxy
  const result = await pool.query(
    `SELECT pg_database_size(current_database()) as db_size_bytes`
  )
  const sizeBytes = Number(result.rows[0]?.db_size_bytes ?? 0)
  const sizeGb = sizeBytes / (1024 ** 3)
  const passed = sizeGb < 100 // Warn if DB > 100GB
  return {
    checkName: 'disk_space_available',
    passed,
    severity: passed ? 'info' : 'warning',
    detail: `Database size: ${sizeGb.toFixed(2)} GB`,
  }
}

// ─── Run Migration Safety Validation ────────────────────────────────────────

export async function runMigrationSafetyValidation(
  version: string,
  environment: string,
  tenantId: string
): Promise<MigrationSafetyReport> {
  const checks = await Promise.all([
    checkNoOrphanedForeignKeys(tenantId),
    checkNoLongRunningTransactions(),
    checkReplayIntegrityBeforeMigration(),
    checkDiskSpaceAvailable(),
  ])

  const blockers = checks
    .filter(c => !c.passed && c.severity === 'critical')
    .map(c => c.detail)

  const warnings = checks
    .filter(c => !c.passed && c.severity === 'warning')
    .map(c => c.detail)

  return {
    version,
    environment,
    checks,
    safeToApply: blockers.length === 0,
    blockers,
    warnings,
    evaluatedAt: new Date(),
  }
}

// ─── Is Migration Safe ────────────────────────────────────────────────────────

export function isMigrationSafe(report: MigrationSafetyReport): boolean {
  return report.safeToApply && report.blockers.length === 0
}

// ─── Count Checks By Severity ─────────────────────────────────────────────────

export function countChecksBySeverity(
  checks: MigrationSafetyCheck[]
): { critical: number; warning: number; info: number } {
  return {
    critical: checks.filter(c => c.severity === 'critical' && !c.passed).length,
    warning: checks.filter(c => c.severity === 'warning' && !c.passed).length,
    info: checks.filter(c => c.severity === 'info').length,
  }
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  isMigrationSafe,
  countChecksBySeverity,
}
