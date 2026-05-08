// Denver Engineering — Customer Go-Live Tracker (Phase 11)
// Track go-live milestones and activation status across pilot customers

import { pool } from '../../db/pool'
import { PilotTenant, PilotStatus } from './phase11Types'

// ─── Go-Live Milestone ────────────────────────────────────────────────────────

export interface GoLiveMilestone {
  id: string
  tenantId: string
  milestoneName: string
  milestoneKey: string
  achievedAt: Date | null
  expectedByDate: Date | null
  notes: string | null
  createdAt: Date
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _mapMilestone(row: Record<string, unknown>): GoLiveMilestone {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    milestoneName: row.milestone_name as string,
    milestoneKey: row.milestone_key as string,
    achievedAt: row.achieved_at ? new Date(row.achieved_at as string) : null,
    expectedByDate: row.expected_by_date ? new Date(row.expected_by_date as string) : null,
    notes: row.notes as string | null,
    createdAt: new Date(row.created_at as string),
  }
}

// ─── Create Milestone ─────────────────────────────────────────────────────────

export async function createGoLiveMilestone(
  tenantId: string,
  milestoneKey: string,
  milestoneName: string,
  expectedByDate: Date | null = null
): Promise<GoLiveMilestone> {
  const result = await pool.query(
    `INSERT INTO go_live_milestones
       (tenant_id, milestone_key, milestone_name, achieved_at, expected_by_date, notes, created_at)
     VALUES ($1, $2, $3, NULL, $4, NULL, NOW())
     RETURNING *`,
    [tenantId, milestoneKey, milestoneName, expectedByDate]
  )
  return _mapMilestone(result.rows[0])
}

// ─── Achieve Milestone ────────────────────────────────────────────────────────

export async function achieveMilestone(
  milestoneId: string,
  notes: string | null = null
): Promise<GoLiveMilestone> {
  const result = await pool.query(
    `UPDATE go_live_milestones
     SET achieved_at = NOW(), notes = $1
     WHERE id = $2
     RETURNING *`,
    [notes, milestoneId]
  )
  if (result.rows.length === 0) {
    throw new Error(`Milestone ${milestoneId} not found`)
  }
  return _mapMilestone(result.rows[0])
}

// ─── Get Milestones ───────────────────────────────────────────────────────────

export async function getTenantMilestones(tenantId: string): Promise<GoLiveMilestone[]> {
  const result = await pool.query(
    `SELECT * FROM go_live_milestones
     WHERE tenant_id = $1
     ORDER BY created_at ASC`,
    [tenantId]
  )
  return result.rows.map(_mapMilestone)
}

// ─── Get Overdue Milestones ───────────────────────────────────────────────────

export async function getOverdueMilestones(): Promise<GoLiveMilestone[]> {
  const result = await pool.query(
    `SELECT * FROM go_live_milestones
     WHERE achieved_at IS NULL
       AND expected_by_date IS NOT NULL
       AND expected_by_date < NOW()
     ORDER BY expected_by_date ASC`
  )
  return result.rows.map(_mapMilestone)
}

// ─── Compute Activation Progress ─────────────────────────────────────────────

export function computeActivationProgress(milestones: GoLiveMilestone[]): number {
  if (milestones.length === 0) return 0
  const achieved = milestones.filter(m => m.achievedAt !== null).length
  return Math.round((achieved / milestones.length) * 100)
}

// ─── Is Customer Activated ────────────────────────────────────────────────────

export function isCustomerActivated(pilot: PilotTenant): boolean {
  return pilot.status === 'active' || pilot.status === 'converted'
}

// ─── Get Activation Summary ───────────────────────────────────────────────────

export async function getActivationSummary(): Promise<{
  total: number
  invited: number
  provisioned: number
  onboarding: number
  active: number
  at_risk: number
  converted: number
  churned: number
}> {
  const result = await pool.query(
    `SELECT status, COUNT(*) as count FROM pilot_tenants GROUP BY status`
  )

  const counts: Record<string, number> = {}
  for (const row of result.rows as Record<string, unknown>[]) {
    counts[row.status as string] = Number(row.count)
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  return {
    total,
    invited: counts['invited'] ?? 0,
    provisioned: counts['provisioned'] ?? 0,
    onboarding: counts['onboarding'] ?? 0,
    active: counts['active'] ?? 0,
    at_risk: counts['at_risk'] ?? 0,
    converted: counts['converted'] ?? 0,
    churned: counts['churned'] ?? 0,
  }
}

// ─── Compute Days to Go Live ──────────────────────────────────────────────────

export function computeDaysToGoLive(expectedDate: Date): number {
  const now = new Date()
  const diffMs = expectedDate.getTime() - now.getTime()
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24))
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  _mapMilestone,
  computeActivationProgress,
  isCustomerActivated,
  computeDaysToGoLive,
}
