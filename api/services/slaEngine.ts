/**
 * Denver Engineering — SLA Engine (v4.33.0)
 * ──────────────────────────────────────────
 * Ava Phase 1C — Background worker that scans open actions every minute,
 * fires escalations when due_at is breached, and records each escalation
 * in action_escalations (append-only).
 *
 * Architecture (follows complianceWatcher pattern):
 *   - Registered as a promoter via registerPromoter() so the existing
 *     scheduler picks it up on every POLL_INTERVAL tick.
 *   - Uses FOR UPDATE SKIP LOCKED to be safe under multiple worker processes.
 *   - Escalation levels read from sla_rules.escalation_levels JSONB.
 *   - Each action can escalate through levels 1 → 2 → 3 on successive ticks.
 *   - An action is only re-escalated to a higher level after the configured
 *     after_hours threshold for that level has elapsed since due_at.
 *
 * Escalation level defaults (used when no sla_rule matched at action creation):
 *   Level 1 — at due_at + 0h  → notify assigned user
 *   Level 2 — at due_at + 24h → notify supervisor role
 *   Level 3 — at due_at + 48h → notify admin role
 *
 * Notification stubs: notified_users is stored for later integration with
 * the in-app notification and email delivery systems. The engine records the
 * event now; delivery is wired in Phase 1 Sprint 4 (§1.8 notifications).
 */

import { query } from '../db/pool'
import { slog } from '../../src/modules/observability/index'
import { registerPromoter } from './scheduler'

// ─── Config ───────────────────────────────────────────────────────────────────

const SCAN_MIN_INTERVAL_MS = Number(
  process.env['SLA_SCAN_MIN_INTERVAL_MS'] ?? '60000',   // default 1 min
)
let _lastScanAt = 0

// ─── Types ────────────────────────────────────────────────────────────────────

interface EscalationLevel {
  level:        number   // 1 | 2 | 3
  after_hours:  number   // hours after due_at to fire this level
  notify_role:  string   // 'assigned_user' | 'supervisor' | 'admin'
}

interface OverdueActionRow {
  id:                  string
  tenant_id:           string
  project_id:          string | null
  title:               string
  action_type:         string
  source_module:       string
  source_id:           string
  system_type:         string | null
  priority:            string
  assigned_to_user_id: string | null
  assigned_to_role:    string | null
  due_at:              string
  sla_rule_id:         string | null
  hours_overdue:       number
  max_escalation_level: number | null  // highest level already fired, null = none
}

interface SlaRuleForAction {
  escalation_levels: EscalationLevel[]
}

// ─── Default escalation ladder ────────────────────────────────────────────────

const DEFAULT_ESCALATION_LEVELS: EscalationLevel[] = [
  { level: 1, after_hours: 0,  notify_role: 'assigned_user' },
  { level: 2, after_hours: 24, notify_role: 'supervisor'     },
  { level: 3, after_hours: 48, notify_role: 'admin'          },
]

// ─── Core scan ────────────────────────────────────────────────────────────────

async function _scanOverdueActions(): Promise<void> {
  const now = Date.now()
  if (now - _lastScanAt < SCAN_MIN_INTERVAL_MS) return
  _lastScanAt = now

  // Fetch all open actions where due_at has passed, with their current max
  // escalation level (null = never escalated). Uses SKIP LOCKED to be
  // concurrent-worker safe.
  const overdueResult = await query<OverdueActionRow>(`
    SELECT
      a.id,
      a.tenant_id,
      a.project_id,
      a.title,
      a.action_type,
      a.source_module,
      a.source_id,
      a.system_type,
      a.priority,
      a.assigned_to_user_id,
      a.assigned_to_role,
      a.due_at::text,
      a.sla_rule_id,
      EXTRACT(EPOCH FROM (NOW() - a.due_at)) / 3600.0 AS hours_overdue,
      MAX(ae.escalation_level)                          AS max_escalation_level
    FROM actions a
    LEFT JOIN action_escalations ae ON ae.action_id = a.id
    WHERE a.status IN ('open','in_progress')
      AND a.due_at IS NOT NULL
      AND a.due_at < NOW()
    GROUP BY
      a.id, a.tenant_id, a.project_id, a.title, a.action_type,
      a.source_module, a.source_id, a.system_type, a.priority,
      a.assigned_to_user_id, a.assigned_to_role, a.due_at, a.sla_rule_id
    FOR UPDATE OF a SKIP LOCKED
  `)

  if (overdueResult.rows.length === 0) return

  let totalFired = 0

  for (const action of overdueResult.rows) {
    const levels = await _resolveEscalationLevels(action)
    const fired  = await _fireNextEscalation(action, levels)
    if (fired) totalFired++
  }

  if (totalFired > 0) {
    slog('INFO', 'slaEngine', '[scan] Escalations fired', { count: totalFired })
  }
}

// ─── Escalation level resolution ─────────────────────────────────────────────

async function _resolveEscalationLevels(action: OverdueActionRow): Promise<EscalationLevel[]> {
  if (!action.sla_rule_id) return DEFAULT_ESCALATION_LEVELS

  const ruleResult = await query<SlaRuleForAction>(`
    SELECT escalation_levels FROM sla_rules WHERE id = $1
  `, [action.sla_rule_id])

  const raw = ruleResult.rows[0]?.escalation_levels
  if (!raw || !Array.isArray(raw) || raw.length === 0) return DEFAULT_ESCALATION_LEVELS

  return raw as EscalationLevel[]
}

// ─── Fire next escalation level ───────────────────────────────────────────────

async function _fireNextEscalation(
  action: OverdueActionRow,
  levels: EscalationLevel[],
): Promise<boolean> {
  const currentMax    = action.max_escalation_level ?? 0
  const hoursOverdue  = Number(action.hours_overdue)

  // Find the next level that:
  //   a) has a level number > currentMax (not yet fired), AND
  //   b) its after_hours threshold has been met
  const nextLevel = levels
    .filter(l => l.level > currentMax && hoursOverdue >= l.after_hours)
    .sort((a, b) => a.level - b.level)[0]

  if (!nextLevel) return false   // nothing to fire yet

  // Resolve notified users for this role
  const notifiedUsers = await _resolveNotifiedUsers(
    action.tenant_id,
    action.assigned_to_user_id,
    nextLevel.notify_role,
  )

  // Record the escalation (append-only)
  await query(`
    INSERT INTO action_escalations (
      tenant_id, action_id, escalation_level,
      triggered_at, notified_users, notify_role, hours_overdue
    ) VALUES (
      $1, $2, $3,
      NOW(), $4::jsonb, $5, $6
    )
  `, [
    action.tenant_id,
    action.id,
    nextLevel.level,
    JSON.stringify(notifiedUsers),
    nextLevel.notify_role,
    hoursOverdue,
  ])

  slog('INFO', 'slaEngine', '[escalate] Fired', {
    action_id:        action.id,
    action_type:      action.action_type,
    level:            nextLevel.level,
    notify_role:      nextLevel.notify_role,
    hours_overdue:    hoursOverdue.toFixed(1),
    notified_users:   notifiedUsers.length,
  })

  // TODO Phase 1 Sprint 4: emit in-app notification to notifiedUsers
  // await _emitNotification(action, nextLevel, notifiedUsers)

  return true
}

// ─── Notified user resolution ─────────────────────────────────────────────────

async function _resolveNotifiedUsers(
  tenantId:          string,
  assignedUserId:    string | null,
  notifyRole:        string,
): Promise<string[]> {
  // Level 1 — assigned user only
  if (notifyRole === 'assigned_user') {
    return assignedUserId ? [assignedUserId] : []
  }

  // Levels 2 & 3 — look up users by role in the tenant
  const roleMap: Record<string, string[]> = {
    supervisor:      ['project_manager'],
    admin:           ['admin', 'owner'],
  }

  const roles = roleMap[notifyRole]
  if (!roles || roles.length === 0) return []

  const placeholders = roles.map((_: string, i: number) => `$${i + 2}`).join(',')
  const result = await query<{ id: string }>(`
    SELECT id FROM users
    WHERE  tenant_id = $1
      AND  role IN (${placeholders})
      AND  is_active = TRUE
    LIMIT  10
  `, [tenantId, ...roles])

  return result.rows.map(r => r.id)
}

// ─── Public registration ──────────────────────────────────────────────────────

export function registerSlaEngine(): void {
  registerPromoter(_scanOverdueActions)
  slog('INFO', 'slaEngine', '[boot] Registered SLA engine promoter')
}

/** Test-only: expose internals */
export const __testHooks = {
  scanOnce:              _scanOverdueActions,
  resetThrottle:         () => { _lastScanAt = 0 },
  resolveEscalationLevels: _resolveEscalationLevels,
  fireNextEscalation:    _fireNextEscalation,
}
