// Denver Engineering — Migration Replay Validator (Phase 12)
// Validates replay hash consistency before and after migrations

import crypto from 'crypto'
import { pool } from '../../db/pool'
import { MigrationReplayCheck } from './phase12Types'

// ─── Mapper ──────────────────────────────────────────────────────────────────

function _mapMigrationReplayCheck(row: Record<string, unknown>): MigrationReplayCheck {
  return {
    id: row.id as string,
    migrationId: row.migration_id as string,
    preMigrationHash: row.pre_migration_hash as string,
    postMigrationHash: row.post_migration_hash as string,
    hashMatch: row.hash_match as boolean,
    rowsValidated: Number(row.rows_validated),
    rowsMismatched: Number(row.rows_mismatched),
    checkedAt: new Date(row.checked_at as string),
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function computeMigrationDataHash(rows: Record<string, unknown>[]): string {
  const canonical = rows.map(r => JSON.stringify(r, Object.keys(r).sort())).join('\n')
  return crypto.createHash('sha256').update(canonical).digest('hex')
}

export function isMigrationReplaySafe(check: MigrationReplayCheck): boolean {
  return check.hashMatch && check.rowsMismatched === 0
}

export function computeMismatchRate(rowsValidated: number, rowsMismatched: number): number {
  if (rowsValidated === 0) return 0
  return rowsMismatched / rowsValidated
}

// ─── Service ─────────────────────────────────────────────────────────────────

export async function recordMigrationReplayCheck(
  migrationId: string,
  preMigrationHash: string,
  postMigrationHash: string,
  rowsValidated: number,
  rowsMismatched: number,
): Promise<MigrationReplayCheck> {
  const hashMatch = preMigrationHash === postMigrationHash
  const result = await pool.query(
    `INSERT INTO p12_migration_replay_checks
       (migration_id, pre_migration_hash, post_migration_hash, hash_match, rows_validated, rows_mismatched, checked_at)
     VALUES ($1,$2,$3,$4,$5,$6,NOW())
     RETURNING *`,
    [migrationId, preMigrationHash, postMigrationHash, hashMatch, rowsValidated, rowsMismatched],
  )
  return _mapMigrationReplayCheck(result.rows[0])
}

export async function getMigrationReplayCheck(migrationId: string): Promise<MigrationReplayCheck | null> {
  const result = await pool.query(
    `SELECT * FROM p12_migration_replay_checks
     WHERE migration_id = $1
     ORDER BY checked_at DESC
     LIMIT 1`,
    [migrationId],
  )
  return result.rows[0] ? _mapMigrationReplayCheck(result.rows[0]) : null
}

export async function getFailedMigrationChecks(): Promise<MigrationReplayCheck[]> {
  const result = await pool.query(
    `SELECT * FROM p12_migration_replay_checks
     WHERE hash_match = FALSE OR rows_mismatched > 0
     ORDER BY checked_at DESC`,
  )
  return result.rows.map(_mapMigrationReplayCheck)
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  computeMigrationDataHash,
  isMigrationReplaySafe,
  computeMismatchRate,
  _mapMigrationReplayCheck,
}
