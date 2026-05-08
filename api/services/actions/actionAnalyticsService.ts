/**
 * Denver Engineering — Action Analytics Service (v4.34.0)
 * ─────────────────────────────────────────────────────────
 * Ava Phase 2F — Nightly snapshot aggregation + live KPI computation.
 *
 * Two modes:
 *   1. Live queries — for real-time overview/trends endpoints (fast, indexed)
 *   2. Snapshot job — nightly aggregation into action_analytics_snapshots
 *      (registered as background job handler)
 *
 * Registered via registerHandler('action_analytics_snapshot', ...) in scheduler.
 */

import { query } from '../../db/pool'
import { registerHandler, enqueue } from '../scheduler'
import { slog } from '../../../src/modules/observability/index'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ActionOverview {
  total_open:         number
  total_overdue:      number
  total_completed_today: number
  total_escalated:    number
  sla_compliance_pct: number | null
  by_status:  Record<string, number>
  by_priority: Record<string, number>
  by_type:    Record<string, number>
  overdue_count: number
}

export interface ActionTrend {
  date:          string
  created:       number
  completed:     number
  overdue:       number
  escalated:     number
  sla_pct:       number | null
}

export interface AssigneeWorkload {
  user_id:     string
  email:       string
  open_count:  number
  overdue_count: number
  avg_age_hours: number
}

// ─── Live overview query ──────────────────────────────────────────────────────

export async function getOverview(tenantId: string): Promise<ActionOverview> {
  const [statusCounts, overdueCount, completedToday, escalated, slaCompliance] = await Promise.all([

    query<{ status: string; priority: string; action_type: string; count: string }>(`
      SELECT status, priority, action_type, COUNT(*)::text AS count
      FROM   actions
      WHERE  tenant_id = $1
      GROUP BY status, priority, action_type
    `, [tenantId]),

    query<{ count: string }>(`
      SELECT COUNT(*)::text AS count FROM actions
      WHERE tenant_id = $1 AND status IN ('open','in_progress')
        AND due_at IS NOT NULL AND due_at < NOW()
    `, [tenantId]),

    query<{ count: string }>(`
      SELECT COUNT(*)::text AS count FROM actions
      WHERE tenant_id = $1 AND status = 'completed'
        AND completed_at >= CURRENT_DATE
    `, [tenantId]),

    query<{ count: string }>(`
      SELECT COUNT(DISTINCT action_id)::text AS count FROM action_escalations
      WHERE tenant_id = $1 AND triggered_at >= NOW() - INTERVAL '7 days'
    `, [tenantId]),

    query<{ pct: string | null }>(`
      SELECT
        ROUND(100.0 * COUNT(*) FILTER (WHERE completed_at <= due_at AND due_at IS NOT NULL)
          / NULLIF(COUNT(*) FILTER (WHERE status = 'completed' AND due_at IS NOT NULL), 0), 2
        )::text AS pct
      FROM actions
      WHERE tenant_id = $1 AND status = 'completed'
        AND created_at >= NOW() - INTERVAL '30 days'
    `, [tenantId]),
  ])

  const by_status:   Record<string, number> = {}
  const by_priority: Record<string, number> = {}
  const by_type:     Record<string, number> = {}
  let total_open = 0

  for (const row of statusCounts.rows) {
    const cnt = parseInt(row.count, 10)
    by_status[row.status]       = (by_status[row.status]       ?? 0) + cnt
    by_priority[row.priority]   = (by_priority[row.priority]   ?? 0) + cnt
    by_type[row.action_type]    = (by_type[row.action_type]    ?? 0) + cnt
    if (row.status === 'open' || row.status === 'in_progress') total_open += cnt
  }

  return {
    total_open,
    total_overdue:         parseInt(overdueCount.rows[0]?.count ?? '0', 10),
    total_completed_today: parseInt(completedToday.rows[0]?.count ?? '0', 10),
    total_escalated:       parseInt(escalated.rows[0]?.count ?? '0', 10),
    sla_compliance_pct:    slaCompliance.rows[0]?.pct != null
      ? parseFloat(slaCompliance.rows[0].pct)
      : null,
    by_status,
    by_priority,
    by_type,
    overdue_count: parseInt(overdueCount.rows[0]?.count ?? '0', 10),
  }
}

// ─── Trends (last N days from snapshots or live) ──────────────────────────────

export async function getTrends(
  tenantId: string,
  days: number = 30,
): Promise<ActionTrend[]> {
  // Try snapshots first (fast path)
  const snapshots = await query<{
    snapshot_date: string; total_created: string; total_completed: string;
    total_overdue: string; total_escalations_fired: string; sla_compliance_pct: string | null;
  }>(`
    SELECT snapshot_date, total_created, total_completed,
           total_overdue, total_escalations_fired, sla_compliance_pct
    FROM   action_analytics_snapshots
    WHERE  tenant_id     = $1
      AND  snapshot_date >= CURRENT_DATE - $2
    ORDER BY snapshot_date ASC
  `, [tenantId, days])

  if (snapshots.rows.length > 0) {
    return snapshots.rows.map(r => ({
      date:      r.snapshot_date,
      created:   parseInt(r.total_created, 10),
      completed: parseInt(r.total_completed, 10),
      overdue:   parseInt(r.total_overdue, 10),
      escalated: parseInt(r.total_escalations_fired, 10),
      sla_pct:   r.sla_compliance_pct != null ? parseFloat(r.sla_compliance_pct) : null,
    }))
  }

  // Live fallback: generate from raw actions (slower, for tenants with no snapshots yet)
  const live = await query<{
    d: string; created: string; completed: string; overdue: string;
  }>(`
    SELECT
      DATE(created_at) AS d,
      COUNT(*)::text   AS created,
      COUNT(*) FILTER (WHERE status = 'completed')::text AS completed,
      COUNT(*) FILTER (WHERE due_at IS NOT NULL AND due_at < CURRENT_DATE AND status NOT IN ('completed','cancelled'))::text AS overdue
    FROM actions
    WHERE tenant_id = $1 AND created_at >= NOW() - ($2 * INTERVAL '1 day')
    GROUP BY DATE(created_at)
    ORDER BY d ASC
  `, [tenantId, days])

  return live.rows.map(r => ({
    date:      r.d,
    created:   parseInt(r.created, 10),
    completed: parseInt(r.completed, 10),
    overdue:   parseInt(r.overdue, 10),
    escalated: 0,
    sla_pct:   null,
  }))
}

// ─── Workload ─────────────────────────────────────────────────────────────────

export async function getWorkload(
  tenantId: string,
  limit: number = 20,
): Promise<AssigneeWorkload[]> {
  const result = await query<{
    user_id: string; email: string; open_count: string;
    overdue_count: string; avg_age_hours: string;
  }>(`
    SELECT
      u.id    AS user_id,
      u.email,
      COUNT(a.id)::text AS open_count,
      COUNT(a.id) FILTER (WHERE a.due_at IS NOT NULL AND a.due_at < NOW())::text AS overdue_count,
      ROUND(AVG(EXTRACT(EPOCH FROM (NOW() - a.created_at)) / 3600.0), 1)::text  AS avg_age_hours
    FROM   actions a
    INNER JOIN users u ON u.id = a.assigned_to_user_id
    WHERE  a.tenant_id = $1
      AND  a.status   IN ('open','in_progress')
    GROUP BY u.id, u.email
    ORDER BY COUNT(a.id) DESC
    LIMIT  $2
  `, [tenantId, limit])

  return result.rows.map(r => ({
    user_id:      r.user_id,
    email:        r.email,
    open_count:   parseInt(r.open_count, 10),
    overdue_count: parseInt(r.overdue_count, 10),
    avg_age_hours: parseFloat(r.avg_age_hours),
  }))
}

// ─── Snapshot job ─────────────────────────────────────────────────────────────

async function _runSnapshot(tenantId: string): Promise<void> {
  const today = new Date().toISOString().slice(0, 10)

  // Aggregate all metrics for today
  const [base, byModule, byPriority, bySysType, workload] = await Promise.all([

    query<Record<string, string>>(`
      SELECT
        COUNT(*) FILTER (WHERE DATE(created_at) = CURRENT_DATE)::text        AS total_created,
        COUNT(*) FILTER (WHERE status = 'completed'
          AND DATE(completed_at) = CURRENT_DATE)::text                       AS total_completed,
        COUNT(*) FILTER (WHERE status = 'cancelled'
          AND DATE(cancelled_at) = CURRENT_DATE)::text                       AS total_cancelled,
        COUNT(*) FILTER (WHERE status IN ('open','in_progress'))::text       AS total_open,
        COUNT(*) FILTER (WHERE due_at < NOW() AND status IN ('open','in_progress'))::text AS total_overdue,
        ROUND(100.0 * COUNT(*) FILTER (WHERE completed_at <= due_at AND due_at IS NOT NULL)
          / NULLIF(COUNT(*) FILTER (WHERE status='completed' AND due_at IS NOT NULL), 0), 2)::text AS sla_compliance_pct,
        ROUND(AVG(EXTRACT(EPOCH FROM (COALESCE(completed_at,NOW()) - created_at))/3600.0), 2)::text AS avg_resolution_hours
      FROM actions
      WHERE tenant_id = $1
    `, [tenantId]),

    query<{ module: string; cnt_created: string; cnt_completed: string; cnt_overdue: string }>(`
      SELECT
        source_module AS module,
        COUNT(*) FILTER (WHERE DATE(created_at) = CURRENT_DATE)::text AS cnt_created,
        COUNT(*) FILTER (WHERE status = 'completed')::text             AS cnt_completed,
        COUNT(*) FILTER (WHERE due_at < NOW() AND status IN ('open','in_progress'))::text AS cnt_overdue
      FROM actions WHERE tenant_id = $1
      GROUP BY source_module
    `, [tenantId]),

    query<{ priority: string; cnt: string }>(`
      SELECT priority, COUNT(*)::text AS cnt FROM actions
      WHERE tenant_id=$1 AND status IN ('open','in_progress')
      GROUP BY priority
    `, [tenantId]),

    query<{ system_type: string | null; cnt: string }>(`
      SELECT COALESCE(system_type,'none') AS system_type, COUNT(*)::text AS cnt
      FROM actions WHERE tenant_id=$1 AND status IN ('open','in_progress')
      GROUP BY system_type
    `, [tenantId]),

    query<{ user_id: string; open_cnt: string }>(`
      SELECT assigned_to_user_id AS user_id, COUNT(*)::text AS open_cnt
      FROM actions WHERE tenant_id=$1 AND status IN ('open','in_progress')
        AND assigned_to_user_id IS NOT NULL
      GROUP BY assigned_to_user_id
      ORDER BY COUNT(*) DESC LIMIT 10
    `, [tenantId]),
  ])

  const b = base.rows[0] ?? {}

  const byModuleJson: Record<string, unknown> = {}
  for (const r of byModule.rows) {
    byModuleJson[r.module] = {
      created: parseInt(r.cnt_created, 10),
      completed: parseInt(r.cnt_completed, 10),
      overdue: parseInt(r.cnt_overdue, 10),
    }
  }

  const byPriorityJson: Record<string, number> = {}
  for (const r of byPriority.rows) byPriorityJson[r.priority] = parseInt(r.cnt, 10)

  const bySysJson: Record<string, number> = {}
  for (const r of bySysType.rows) bySysJson[r.system_type] = parseInt(r.cnt, 10)

  const workloadJson = workload.rows.map(r => ({
    user_id: r.user_id, open_count: parseInt(r.open_cnt, 10),
  }))

  // Upsert snapshot
  await query(`
    INSERT INTO action_analytics_snapshots (
      tenant_id, snapshot_date,
      total_created, total_completed, total_cancelled, total_open,
      total_overdue, sla_compliance_pct, avg_resolution_hours,
      by_module, by_priority, by_system_type, assignee_workload
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb)
    ON CONFLICT (tenant_id, snapshot_date) DO UPDATE
      SET total_created = EXCLUDED.total_created,
          total_completed = EXCLUDED.total_completed,
          total_cancelled = EXCLUDED.total_cancelled,
          total_open = EXCLUDED.total_open,
          total_overdue = EXCLUDED.total_overdue,
          sla_compliance_pct = EXCLUDED.sla_compliance_pct,
          avg_resolution_hours = EXCLUDED.avg_resolution_hours,
          by_module = EXCLUDED.by_module,
          by_priority = EXCLUDED.by_priority,
          by_system_type = EXCLUDED.by_system_type,
          assignee_workload = EXCLUDED.assignee_workload
  `, [
    tenantId, today,
    parseInt(b['total_created'] ?? '0', 10),
    parseInt(b['total_completed'] ?? '0', 10),
    parseInt(b['total_cancelled'] ?? '0', 10),
    parseInt(b['total_open'] ?? '0', 10),
    parseInt(b['total_overdue'] ?? '0', 10),
    b['sla_compliance_pct'] != null ? parseFloat(b['sla_compliance_pct']) : null,
    b['avg_resolution_hours'] != null ? parseFloat(b['avg_resolution_hours']) : null,
    JSON.stringify(byModuleJson),
    JSON.stringify(byPriorityJson),
    JSON.stringify(bySysJson),
    JSON.stringify(workloadJson),
  ])

  slog('INFO', 'actionAnalytics', '[snapshot] Written', { tenantId, date: today })
}

// ─── Registration ─────────────────────────────────────────────────────────────

export function registerAnalyticsSnapshotHandler(): void {
  registerHandler('action_analytics_snapshot', async (job) => {
    await _runSnapshot(job.tenant_id)
    return { date: new Date().toISOString().slice(0, 10) }
  })
}

/** Enqueue a snapshot job for all active tenants. Called by nightly scheduled_job. */
export async function enqueueSnapshotForAllTenants(): Promise<void> {
  const tenants = await query<{ id: string }>(`
    SELECT id FROM tenants WHERE is_active = TRUE
  `, [])

  for (const { id } of tenants.rows) {
    await enqueue(id, 'action_analytics_snapshot', {}, { maxAttempts: 3 })
  }

  slog('INFO', 'actionAnalytics', '[enqueue] Snapshot jobs enqueued', {
    count: tenants.rows.length,
  })
}

/** Test-only */
export const __testHooks = { runSnapshot: _runSnapshot }
