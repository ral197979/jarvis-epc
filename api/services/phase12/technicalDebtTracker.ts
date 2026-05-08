// Denver Engineering — Technical Debt Tracker (Phase 12)
// Identifies and tracks technical debt items across the platform

import { pool } from '../../db/pool'
import { TechnicalDebtItem, DebtCategory } from './phase12Types'

// ─── Mapper ──────────────────────────────────────────────────────────────────

function _mapDebtItem(row: Record<string, unknown>): TechnicalDebtItem {
  return {
    id: row.id as string,
    category: row.category as DebtCategory,
    description: row.description as string,
    severity: row.severity as TechnicalDebtItem['severity'],
    estimatedEffortDays: Number(row.estimated_effort_days),
    replayImpact: row.replay_impact as boolean,
    identifiedAt: new Date(row.identified_at as string),
    resolvedAt: row.resolved_at ? new Date(row.resolved_at as string) : null,
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function computeTotalDebtEffort(items: TechnicalDebtItem[]): number {
  return items
    .filter(i => i.resolvedAt === null)
    .reduce((sum, i) => sum + i.estimatedEffortDays, 0)
}

export function hasBlockingDebt(items: TechnicalDebtItem[]): boolean {
  return items.some(i => i.severity === 'critical' && i.replayImpact && i.resolvedAt === null)
}

export function countDebtBySeverity(items: TechnicalDebtItem[]): Record<string, number> {
  const open = items.filter(i => i.resolvedAt === null)
  return {
    critical: open.filter(i => i.severity === 'critical').length,
    high: open.filter(i => i.severity === 'high').length,
    medium: open.filter(i => i.severity === 'medium').length,
    low: open.filter(i => i.severity === 'low').length,
  }
}

export function classifyDebtRisk(totalEffortDays: number): 'low' | 'medium' | 'high' | 'critical' {
  if (totalEffortDays > 90) return 'critical'
  if (totalEffortDays > 45) return 'high'
  if (totalEffortDays > 15) return 'medium'
  return 'low'
}

// ─── Service ─────────────────────────────────────────────────────────────────

export async function recordDebtItem(
  category: DebtCategory,
  description: string,
  severity: TechnicalDebtItem['severity'],
  estimatedEffortDays: number,
  replayImpact: boolean,
): Promise<TechnicalDebtItem> {
  const result = await pool.query(
    `INSERT INTO p12_technical_debt
       (category, description, severity, estimated_effort_days, replay_impact, identified_at)
     VALUES ($1,$2,$3,$4,$5,NOW())
     RETURNING *`,
    [category, description, severity, estimatedEffortDays, replayImpact],
  )
  return _mapDebtItem(result.rows[0])
}

export async function resolveDebtItem(debtId: string): Promise<TechnicalDebtItem> {
  const result = await pool.query(
    `UPDATE p12_technical_debt
     SET resolved_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [debtId],
  )
  if (!result.rows[0]) throw new Error(`TechnicalDebtItem ${debtId} not found`)
  return _mapDebtItem(result.rows[0])
}

export async function getOpenDebtItems(category?: DebtCategory): Promise<TechnicalDebtItem[]> {
  const result = await pool.query(
    `SELECT * FROM p12_technical_debt
     WHERE resolved_at IS NULL
       AND ($1::text IS NULL OR category = $1)
     ORDER BY severity, estimated_effort_days DESC`,
    [category ?? null],
  )
  return result.rows.map(_mapDebtItem)
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  computeTotalDebtEffort,
  hasBlockingDebt,
  countDebtBySeverity,
  classifyDebtRisk,
  _mapDebtItem,
}
