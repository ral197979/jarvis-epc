// Denver Engineering — Subsystem Dependency Analyzer (Phase 12)
// Analyzes coupling between platform subsystems

import { pool } from '../../db/pool'
import { SubsystemDependency } from './phase12Types'

// ─── Mapper ──────────────────────────────────────────────────────────────────

function _mapDependency(row: Record<string, unknown>): SubsystemDependency {
  return {
    id: row.id as string,
    fromSubsystem: row.from_subsystem as string,
    toSubsystem: row.to_subsystem as string,
    couplingScore: Number(row.coupling_score),
    replayDependent: row.replay_dependent as boolean,
    governanceDependent: row.governance_dependent as boolean,
    recordedAt: new Date(row.recorded_at as string),
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function isTightlyCoupled(dep: SubsystemDependency): boolean {
  return dep.couplingScore >= 0.7
}

export function computeAverageCoupling(deps: SubsystemDependency[]): number {
  if (deps.length === 0) return 0
  return deps.reduce((sum, d) => sum + d.couplingScore, 0) / deps.length
}

export function getHighRiskDependencies(deps: SubsystemDependency[]): SubsystemDependency[] {
  return deps.filter(d => d.couplingScore >= 0.7 && (d.replayDependent || d.governanceDependent))
}

export function computeCouplingRisk(deps: SubsystemDependency[]): 'low' | 'medium' | 'high' {
  const avgCoupling = computeAverageCoupling(deps)
  const highRisk = getHighRiskDependencies(deps).length
  if (avgCoupling >= 0.7 || highRisk >= 5) return 'high'
  if (avgCoupling >= 0.45 || highRisk >= 2) return 'medium'
  return 'low'
}

// ─── Service ─────────────────────────────────────────────────────────────────

export async function recordDependency(
  fromSubsystem: string,
  toSubsystem: string,
  couplingScore: number,
  replayDependent: boolean,
  governanceDependent: boolean,
): Promise<SubsystemDependency> {
  const result = await pool.query(
    `INSERT INTO p12_subsystem_dependencies
       (from_subsystem, to_subsystem, coupling_score, replay_dependent, governance_dependent, recorded_at)
     VALUES ($1,$2,$3,$4,$5,NOW())
     ON CONFLICT (from_subsystem, to_subsystem) DO UPDATE
       SET coupling_score=$3, replay_dependent=$4, governance_dependent=$5, recorded_at=NOW()
     RETURNING *`,
    [fromSubsystem, toSubsystem, couplingScore, replayDependent, governanceDependent],
  )
  return _mapDependency(result.rows[0])
}

export async function getDependenciesFrom(subsystem: string): Promise<SubsystemDependency[]> {
  const result = await pool.query(
    `SELECT * FROM p12_subsystem_dependencies
     WHERE from_subsystem = $1
     ORDER BY coupling_score DESC`,
    [subsystem],
  )
  return result.rows.map(_mapDependency)
}

export async function getAllDependencies(): Promise<SubsystemDependency[]> {
  const result = await pool.query(
    `SELECT * FROM p12_subsystem_dependencies
     ORDER BY coupling_score DESC`,
  )
  return result.rows.map(_mapDependency)
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  isTightlyCoupled,
  computeAverageCoupling,
  getHighRiskDependencies,
  computeCouplingRisk,
  _mapDependency,
}
