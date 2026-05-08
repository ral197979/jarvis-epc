/**
 * Denver Engineering — KPI Snapshot Handler
 * ──────────────────────────────────────
 * v4.31.0 | Writes tenant-wide metric rollups for trending.
 *
 * Registers the 'snapshot_kpis' job type. Admins schedule it (e.g. daily)
 * from the Automation UI; each fire inserts one kpi_snapshots row.
 *
 * Metrics captured (all tenant-wide):
 *   projects_total           — total project count
 *   projects_active          — status in ('planning','active')
 *   projects_completed       — status = 'completed'
 *   projects_on_hold         — status = 'on_hold'
 *   total_budget             — SUM(projects.budget)
 *   total_committed          — SUM(projects.committed_cost)
 *   total_actual             — SUM(projects.actual_cost)
 *   total_forecast           — SUM(projects.forecast_cost)
 *   rfis_open                — status IN ('open','pending')
 *   submittals_pending       — status IN ('draft','submitted','under_review')
 *   risks_open               — status = 'open'
 *   actions_open             — status IN ('open','in_progress')
 *   actions_overdue          — status = 'overdue'
 *
 * Add a KPI by adding one COUNT/SUM line to the SELECT and one entry to
 * the returned object. No migration needed — metrics is JSONB.
 */

import { query } from '../db/pool'
import { slog } from '../../src/modules/observability/index'
import { registerHandler, type BackgroundJob } from './scheduler'

interface KpiRow {
  projects_total:      string
  projects_active:     string
  projects_completed:  string
  projects_on_hold:    string
  total_budget:        string | null
  total_committed:     string | null
  total_actual:        string | null
  total_forecast:      string | null
  rfis_open:           string
  submittals_pending:  string
  risks_open:          string
  actions_open:        string
  actions_overdue:     string
}

export function registerKpiSnapshotHandler(): void {
  registerHandler('snapshot_kpis', _handleSnapshotJob)
  slog('INFO', 'kpiSnapshot', '[boot] Registered snapshot_kpis handler')
}

async function _handleSnapshotJob(job: BackgroundJob): Promise<Record<string, unknown>> {
  const tid = job.tenant_id

  // Single round-trip — one query rolls up every metric. Each subquery
  // is independent, so PG can parallelize where appropriate.
  const res = await query<KpiRow>(`
    SELECT
      (SELECT COUNT(*)::text FROM projects WHERE tenant_id=$1) AS projects_total,
      (SELECT COUNT(*)::text FROM projects WHERE tenant_id=$1 AND status IN ('planning','active')) AS projects_active,
      (SELECT COUNT(*)::text FROM projects WHERE tenant_id=$1 AND status='completed') AS projects_completed,
      (SELECT COUNT(*)::text FROM projects WHERE tenant_id=$1 AND status='on_hold')   AS projects_on_hold,
      (SELECT COALESCE(SUM(budget),0)::text         FROM projects WHERE tenant_id=$1) AS total_budget,
      (SELECT COALESCE(SUM(committed_cost),0)::text FROM projects WHERE tenant_id=$1) AS total_committed,
      (SELECT COALESCE(SUM(actual_cost),0)::text    FROM projects WHERE tenant_id=$1) AS total_actual,
      (SELECT COALESCE(SUM(forecast_cost),0)::text  FROM projects WHERE tenant_id=$1) AS total_forecast,
      (SELECT COUNT(*)::text FROM rfis           WHERE tenant_id=$1 AND status IN ('open','pending')) AS rfis_open,
      (SELECT COUNT(*)::text FROM submittals     WHERE tenant_id=$1 AND status IN ('draft','submitted','under_review')) AS submittals_pending,
      (SELECT COUNT(*)::text FROM risks          WHERE tenant_id=$1 AND status='open')     AS risks_open,
      (SELECT COUNT(*)::text FROM action_items   WHERE tenant_id=$1 AND status IN ('open','in_progress')) AS actions_open,
      (SELECT COUNT(*)::text FROM action_items   WHERE tenant_id=$1 AND status='overdue')  AS actions_overdue
  `, [tid])

  const row = res.rows[0]
  if (!row) throw new Error('snapshot_kpis: aggregation returned no rows')

  // Parse to numbers. Every field came through ::text so NULL → null → 0.
  const num = (v: string | null | undefined): number => {
    if (v == null) return 0
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
  }

  const metrics = {
    projects_total:      num(row.projects_total),
    projects_active:     num(row.projects_active),
    projects_completed:  num(row.projects_completed),
    projects_on_hold:    num(row.projects_on_hold),
    total_budget:        num(row.total_budget),
    total_committed:     num(row.total_committed),
    total_actual:        num(row.total_actual),
    total_forecast:      num(row.total_forecast),
    rfis_open:           num(row.rfis_open),
    submittals_pending:  num(row.submittals_pending),
    risks_open:          num(row.risks_open),
    actions_open:        num(row.actions_open),
    actions_overdue:     num(row.actions_overdue),
  }

  const insertRes = await query<{ id: string }>(`
    INSERT INTO kpi_snapshots (tenant_id, metrics)
    VALUES ($1, $2::jsonb)
    RETURNING id
  `, [tid, JSON.stringify(metrics)])

  const snapshotId = insertRes.rows[0]!.id

  slog('INFO', 'kpiSnapshot', '[snapshot] Captured', {
    tenantId: tid, snapshotId,
    projects: metrics.projects_total,
    budget:   metrics.total_budget,
  })

  return { snapshotId, metrics }
}

/** Test-only: direct access to the handler. */
export const __testHooks = { handleSnapshotJob: _handleSnapshotJob }
