/**
 * Denver Engineering — Compliance Watcher
 * ────────────────────────────────────
 * v4.31.0 | Scans compliance_tasks each tick and fires webhook events
 *          when tasks enter their notification window or become overdue.
 *
 * Registers one promoter (no handler needed — this watcher works by
 * emitting webhook events directly, each of which becomes a durable
 * background_jobs row via emitEvent).
 *
 * State transitions:
 *   pending  → notified  emits 'compliance.task_due'
 *   pending  → overdue   emits 'compliance.task_overdue'  (if never notified)
 *   notified → overdue   emits 'compliance.task_overdue'
 *
 * Each transition is an atomic UPDATE … FOR UPDATE SKIP LOCKED so multiple
 * workers ticking simultaneously can't double-fire. A task is emitted
 * exactly once per transition; completed / waived tasks are never touched.
 */

import { query } from '../db/pool'
import { slog } from '../../src/modules/observability/index'
import { registerPromoter } from './scheduler'
import { emitEvent } from './webhookDispatch'

const SCAN_MIN_INTERVAL_MS = Number(
  process.env['COMPLIANCE_SCAN_MIN_INTERVAL_MS'] ?? '60000',
)
let _lastScanAt = 0

interface TransitionRow {
  id:         string
  tenant_id:  string
  title:      string
  category:   string
  due_date:   string
  project_id: string | null
  assigned_to: string | null
}

export function registerComplianceWatcher(): void {
  registerPromoter(_scanComplianceTasks)
  slog('INFO', 'complianceWatcher', '[boot] Registered compliance promoter')
}

async function _scanComplianceTasks(): Promise<void> {
  const now = Date.now()
  if (now - _lastScanAt < SCAN_MIN_INTERVAL_MS) return
  _lastScanAt = now

  // Phase 1 — Due-soon: pending tasks whose (due_date - notify_days_before)
  // has arrived but are still in the future. Transition to 'notified' and
  // stamp last_notified_at; this query is idempotent because once a task
  // becomes 'notified' it stops matching.
  const dueSoon = await query<TransitionRow>(`
    UPDATE compliance_tasks
    SET    status           = 'notified',
           last_notified_at = NOW()
    WHERE  id IN (
      SELECT id FROM compliance_tasks
      WHERE  status = 'pending'
        AND  due_date > CURRENT_DATE
        AND  due_date - make_interval(days => notify_days_before) <= NOW()
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, tenant_id, title, category, due_date::text,
              project_id, assigned_to
  `)

  for (const row of dueSoon.rows) {
    await emitEvent(row.tenant_id, 'compliance.task_due', {
      taskId:      row.id,
      title:       row.title,
      category:    row.category,
      dueDate:     row.due_date,
      projectId:   row.project_id,
      assignedTo:  row.assigned_to,
    })
  }

  // Phase 2 — Overdue: any non-terminal task whose due_date has passed.
  // Covers both 'pending' (never entered notify window — e.g. created past-due)
  // and 'notified' (entered window, never completed).
  const overdue = await query<TransitionRow>(`
    UPDATE compliance_tasks
    SET    status           = 'overdue',
           last_notified_at = NOW()
    WHERE  id IN (
      SELECT id FROM compliance_tasks
      WHERE  status IN ('pending','notified')
        AND  due_date < CURRENT_DATE
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, tenant_id, title, category, due_date::text,
              project_id, assigned_to
  `)

  for (const row of overdue.rows) {
    await emitEvent(row.tenant_id, 'compliance.task_overdue', {
      taskId:      row.id,
      title:       row.title,
      category:    row.category,
      dueDate:     row.due_date,
      projectId:   row.project_id,
      assignedTo:  row.assigned_to,
    })
  }

  if (dueSoon.rows.length > 0 || overdue.rows.length > 0) {
    slog('INFO', 'complianceWatcher', '[scan] Transitions emitted', {
      due_soon: dueSoon.rows.length,
      overdue:  overdue.rows.length,
    })
  }
}

/** Test-only: direct access to the scan function and internal throttle. */
export const __testHooks = {
  scanOnce: _scanComplianceTasks,
  resetThrottle: () => { _lastScanAt = 0 },
}
