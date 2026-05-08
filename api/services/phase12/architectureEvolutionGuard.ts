// Denver Engineering — Architecture Evolution Guard (Phase 12)
// Validates architectural changes against evolution safety rules

import { pool } from '../../db/pool'
import { EvolutionGuardCheck } from './phase12Types'

// ─── Mapper ──────────────────────────────────────────────────────────────────

function _mapGuardCheck(row: Record<string, unknown>): EvolutionGuardCheck {
  return {
    id: row.id as string,
    checkName: row.check_name as string,
    category: row.category as EvolutionGuardCheck['category'],
    passed: row.passed as boolean,
    currentValue: Number(row.current_value),
    threshold: Number(row.threshold),
    detail: row.detail as string,
    checkedAt: new Date(row.checked_at as string),
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function evaluateGuardCheck(currentValue: number, threshold: number): boolean {
  return currentValue <= threshold
}

export function computeGuardPassRate(checks: EvolutionGuardCheck[]): number {
  if (checks.length === 0) return 1.0
  const passed = checks.filter(c => c.passed).length
  return passed / checks.length
}

export function hasBlockingFailures(checks: EvolutionGuardCheck[]): boolean {
  return checks.some(c => !c.passed && (c.category === 'governance_risk' || c.category === 'replay_surface'))
}

export function getFailedChecks(checks: EvolutionGuardCheck[]): EvolutionGuardCheck[] {
  return checks.filter(c => !c.passed)
}

// ─── Service ─────────────────────────────────────────────────────────────────

export async function runGuardCheck(
  checkName: string,
  category: EvolutionGuardCheck['category'],
  currentValue: number,
  threshold: number,
  detail: string,
): Promise<EvolutionGuardCheck> {
  const passed = evaluateGuardCheck(currentValue, threshold)
  const result = await pool.query(
    `INSERT INTO p12_evolution_guard_checks
       (check_name, category, passed, current_value, threshold, detail, checked_at)
     VALUES ($1,$2,$3,$4,$5,$6,NOW())
     RETURNING *`,
    [checkName, category, passed, currentValue, threshold, detail],
  )
  return _mapGuardCheck(result.rows[0])
}

export async function getLatestGuardChecks(): Promise<EvolutionGuardCheck[]> {
  const result = await pool.query(
    `SELECT DISTINCT ON (check_name) *
     FROM p12_evolution_guard_checks
     ORDER BY check_name, checked_at DESC`,
  )
  return result.rows.map(_mapGuardCheck)
}

export async function getGuardCheckHistory(checkName: string, limit = 20): Promise<EvolutionGuardCheck[]> {
  const result = await pool.query(
    `SELECT * FROM p12_evolution_guard_checks
     WHERE check_name = $1
     ORDER BY checked_at DESC
     LIMIT $2`,
    [checkName, limit],
  )
  return result.rows.map(_mapGuardCheck)
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  evaluateGuardCheck,
  computeGuardPassRate,
  hasBlockingFailures,
  getFailedChecks,
  _mapGuardCheck,
}
