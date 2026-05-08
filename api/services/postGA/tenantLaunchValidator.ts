// Denver Engineering — Tenant Launch Validator (Post-GA)
// Validates all launch gates before a tenant is activated in production

import { pool } from '../../db/pool'
import { LaunchGate, LaunchGateStatus, LAUNCH_VALIDATION_PASS_RATE } from './postGATypes'

// ─── Mapper ──────────────────────────────────────────────────────────────────

function _mapLaunchGate(row: Record<string, unknown>): LaunchGate {
  return {
    gateName: row.gate_name as string,
    category: row.category as LaunchGate['category'],
    status: row.status as LaunchGateStatus,
    currentValue: Number(row.current_value),
    requiredValue: Number(row.required_value),
    detail: row.detail as string,
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function evaluateLaunchGate(currentValue: number, requiredValue: number, tolerance = 0): LaunchGateStatus {
  if (currentValue >= requiredValue) return 'pass'
  if (currentValue >= requiredValue * (1 - tolerance)) return 'warn'
  return 'fail'
}

export function hasReplayGatePassed(gates: LaunchGate[]): boolean {
  const replayGates = gates.filter(g => g.category === 'replay')
  if (replayGates.length === 0) return false
  return replayGates.every(g => g.status === 'pass')
}

export function hasGovernanceGatePassed(gates: LaunchGate[]): boolean {
  const govGates = gates.filter(g => g.category === 'governance')
  if (govGates.length === 0) return false
  return govGates.every(g => g.status === 'pass')
}

export function computeValidationPassRate(gates: LaunchGate[]): number {
  if (gates.length === 0) return 1.0
  return gates.filter(g => g.status === 'pass').length / gates.length
}

export function isValidationPassing(gates: LaunchGate[]): boolean {
  const passRate = computeValidationPassRate(gates)
  return passRate >= LAUNCH_VALIDATION_PASS_RATE
    && hasReplayGatePassed(gates)
    && hasGovernanceGatePassed(gates)
}

export function getFailedGates(gates: LaunchGate[]): LaunchGate[] {
  return gates.filter(g => g.status === 'fail')
}

// ─── Service ─────────────────────────────────────────────────────────────────

export async function runLaunchValidation(
  tenantId: string,
  gates: Omit<LaunchGate, 'status'>[],
): Promise<LaunchGate[]> {
  const evaluated = gates.map(g => ({
    ...g,
    status: evaluateLaunchGate(g.currentValue, g.requiredValue, 0.05),
  }))

  for (const gate of evaluated) {
    await pool.query(
      `INSERT INTO pga_launch_gates
         (tenant_id, gate_name, category, status, current_value, required_value, detail, validated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
       ON CONFLICT (tenant_id, gate_name) DO UPDATE
         SET status=$4, current_value=$5, validated_at=NOW()`,
      [tenantId, gate.gateName, gate.category, gate.status, gate.currentValue, gate.requiredValue, gate.detail],
    )
  }
  return evaluated
}

export async function getLaunchGates(tenantId: string): Promise<LaunchGate[]> {
  const result = await pool.query(
    `SELECT * FROM pga_launch_gates WHERE tenant_id=$1 ORDER BY category, gate_name`,
    [tenantId],
  )
  return result.rows.map(_mapLaunchGate)
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  evaluateLaunchGate,
  hasReplayGatePassed,
  hasGovernanceGatePassed,
  computeValidationPassRate,
  isValidationPassing,
  getFailedGates,
  _mapLaunchGate,
}
