/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * Denver Engineering — Action Service (v4.33.0)
 * ─────────────────────────────────────────────
 * Ava Phase 1B/1D — Action creation, idempotency guard, delegation resolver.
 *
 * All modules call createAction() after a successful INSERT to emit a unified
 * action into the actions table. The service:
 *   1. Resolves the effective assignee after checking approval_delegations.
 *   2. Looks up the matching sla_rule to compute due_at.
 *   3. Inserts into actions with UNIQUE (tenant_id, source_module, source_id)
 *      — duplicate calls are silently ignored (idempotent).
 *
 * Callers must pass tenantId + source context. Everything else is optional.
 *
 * Usage:
 *   import { createAction } from '../services/actionService'
 *
 *   // inside a POST route, after INSERT RETURNING *:
 *   await createAction(tenantId, {
 *     title:          `RFI-${row.rfi_number}: ${row.title}`,
 *     action_type:    'RFI',
 *     source_module:  'rfis',
 *     source_id:      row.id,
 *     project_id:     row.project_id,
 *     priority:       row.priority ?? 'medium',
 *     assigned_to_user_id: row.assigned_to ?? null,
 *     created_by:     req.auth!.userId,
 *   })
 */

import { query } from '../db/pool'
import { slog } from '../../src/modules/observability/index'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreateActionInput {
  title:               string
  description?:        string
  action_type:         string       // RFI | SUBMITTAL | PUNCH_ITEM | COMPLIANCE_TASK | INSPECTION | BIM_ISSUE | DAILY_LOG | WORK_ORDER | ALARM | TEMPLATE_ASSIGNMENT
  source_module:       string       // rfis | submittals | punch_items | compliance_tasks | inspections | bim_issues | daily_logs
  source_id:           string       // UUID of the originating record
  project_id?:         string | null
  system_type?:        string | null // PWTP | WWTP | HVAC | EPC | null
  priority?:           'low' | 'medium' | 'high' | 'critical'
  assigned_to_user_id?: string | null
  assigned_to_role?:   string | null
  created_by?:         string | null
  due_at?:             Date | string | null  // override SLA-computed due_at if provided
}

export interface ActionRow {
  id:                   string
  tenant_id:            string
  project_id:           string | null
  title:                string
  description:          string | null
  action_type:          string
  source_module:        string
  source_id:            string
  system_type:          string | null
  priority:             string
  status:               string
  assigned_to_user_id:  string | null
  assigned_to_role:     string | null
  due_at:               string | null
  sla_rule_id:          string | null
  completed_at:         string | null
  cancelled_at:         string | null
  created_by:           string | null
  created_at:           string
  updated_at:           string
}

interface SlaRuleRow {
  id:                     string
  default_duration_hours: number
  escalation_levels:      unknown[]
}

interface DelegationRow {
  delegate_user_id: string
}

// ─── Delegation resolver ──────────────────────────────────────────────────────

/**
 * resolveEffectiveAssignee
 * ------------------------
 * Given a tenantId, a candidate user_id, and the action_type + source_module,
 * checks whether the user has an active delegation that covers this scope.
 * Returns the delegate's user_id if found; otherwise returns the original user_id.
 *
 * Delegation is time-bound (start_date <= NOW() <= end_date) and is_active.
 * Scope matching: if delegation.scope is empty {}, it covers all modules/types.
 * If scope.modules is set, source_module must be included.
 * If scope.action_types is set, action_type must be included.
 */
export async function resolveEffectiveAssignee(
  tenantId:       string,
  userId:         string | null | undefined,
  actionType:     string,
  sourceModule:   string,
): Promise<string | null> {
  if (!userId) return null

  const result = await query<DelegationRow>(`
    SELECT delegate_user_id
    FROM   approval_delegations
    WHERE  tenant_id        = $1
      AND  user_id          = $2
      AND  is_active        = TRUE
      AND  start_date      <= NOW()
      AND  end_date        >= NOW()
      AND  (
             scope = '{}'::jsonb
          OR scope IS NULL
          OR (
               (scope->'modules'   IS NULL OR scope->'modules'   @> to_jsonb($3::text))
           AND (scope->'action_types' IS NULL OR scope->'action_types' @> to_jsonb($4::text))
             )
           )
    ORDER  BY created_at DESC
    LIMIT  1
  `, [tenantId, userId, sourceModule, actionType])

  if (result.rows.length > 0) {
    const delegate = result.rows[0]!.delegate_user_id
    slog('INFO', 'actionService', '[delegation] Routing to delegate', {
      original: userId, delegate, actionType, sourceModule,
    })
    return delegate
  }

  return userId
}

// ─── SLA rule lookup ──────────────────────────────────────────────────────────

async function _resolveSlaRule(
  tenantId:    string,
  actionType:  string,
  systemType?: string | null,
): Promise<SlaRuleRow | null> {
  // Try specific system_type first, then fall back to NULL (catch-all)
  const result = await query<SlaRuleRow>(`
    SELECT id, default_duration_hours, escalation_levels
    FROM   sla_rules
    WHERE  tenant_id  = $1
      AND  action_type = $2
      AND  is_active   = TRUE
      AND  (system_type = $3 OR system_type IS NULL)
    ORDER  BY (system_type IS NOT NULL) DESC   -- prefer specific over catch-all
    LIMIT  1
  `, [tenantId, actionType, systemType ?? null])

  return result.rows[0] ?? null
}

// ─── createAction ─────────────────────────────────────────────────────────────

/**
 * createAction
 * ------------
 * Idempotent action creation. Safe to call multiple times for the same
 * (tenant_id, source_module, source_id) — subsequent calls are no-ops.
 *
 * Returns the action row (existing or newly created) or null on error.
 * Errors are logged but never thrown — this must not break the calling route.
 */
export async function createAction(
  tenantId: string,
  input: CreateActionInput,
): Promise<ActionRow | null> {
  try {
    // 1. Resolve effective assignee after delegation check
    const effectiveAssignee = await resolveEffectiveAssignee(
      tenantId,
      input.assigned_to_user_id,
      input.action_type,
      input.source_module,
    )

    // 2. Look up SLA rule for due_at computation
    let dueAt: Date | string | null = input.due_at ?? null
    let slaRuleId: string | null = null

    if (!dueAt) {
      const rule = await _resolveSlaRule(tenantId, input.action_type, input.system_type)
      if (rule) {
        slaRuleId = rule.id
        const due = new Date()
        due.setHours(due.getHours() + rule.default_duration_hours)
        dueAt = due
      }
    }

    // 3. INSERT with ON CONFLICT DO NOTHING for idempotency
    //    The UNIQUE constraint on (tenant_id, source_module, source_id) guarantees
    //    at-most-once creation even under concurrent requests.
    const result = await query<ActionRow>(`
      INSERT INTO actions (
        tenant_id, project_id, title, description, action_type,
        source_module, source_id, system_type, priority, status,
        assigned_to_user_id, assigned_to_role, due_at, sla_rule_id, created_by
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, 'open',
        $10, $11, $12, $13, $14
      )
      ON CONFLICT (tenant_id, source_module, source_id) DO NOTHING
      RETURNING *
    `, [
      tenantId,
      input.project_id    ?? null,
      input.title,
      input.description   ?? null,
      input.action_type,
      input.source_module,
      input.source_id,
      input.system_type   ?? null,
      input.priority      ?? 'medium',
      effectiveAssignee,
      input.assigned_to_role ?? null,
      dueAt,
      slaRuleId,
      input.created_by    ?? null,
    ])

    if (result.rows.length === 0) {
      // Conflict — action already exists; fetch and return it
      const existing = await query<ActionRow>(`
        SELECT * FROM actions
        WHERE tenant_id = $1 AND source_module = $2 AND source_id = $3
      `, [tenantId, input.source_module, input.source_id])
      return existing.rows[0] ?? null
    }

    slog('INFO', 'actionService', '[create] Action created', {
      id:          result.rows[0]!.id,
      action_type: input.action_type,
      source_id:   input.source_id,
      due_at:      dueAt,
    })

    return result.rows[0]!

  } catch (err) {
    // Non-blocking — log and return null so calling route is unaffected
    slog('ERROR', 'actionService', '[create] Failed to create action', {
      error:         String(err),
      action_type:   input.action_type,
      source_module: input.source_module,
      source_id:     input.source_id,
    })
    return null
  }
}

// ─── completeAction ───────────────────────────────────────────────────────────

/**
 * completeAction
 * --------------
 * Called by a module when its source record reaches a terminal state.
 * Marks the linked action as completed. Idempotent — safe on already-completed actions.
 */
export async function completeAction(
  tenantId:     string,
  sourceModule: string,
  sourceId:     string,
): Promise<void> {
  try {
    await query(`
      UPDATE actions
      SET    status       = 'completed',
             completed_at = NOW(),
             updated_at   = NOW()
      WHERE  tenant_id    = $1
        AND  source_module = $2
        AND  source_id     = $3
        AND  status NOT IN ('completed','cancelled')
    `, [tenantId, sourceModule, sourceId])
  } catch (err) {
    slog('ERROR', 'actionService', '[complete] Failed to complete action', {
      error: String(err), sourceModule, sourceId,
    })
  }
}

// ─── cancelAction ─────────────────────────────────────────────────────────────

/**
 * cancelAction
 * ------------
 * Called when a source record is deleted or voided.
 */
export async function cancelAction(
  tenantId:     string,
  sourceModule: string,
  sourceId:     string,
): Promise<void> {
  try {
    await query(`
      UPDATE actions
      SET    status       = 'cancelled',
             cancelled_at = NOW(),
             updated_at   = NOW()
      WHERE  tenant_id    = $1
        AND  source_module = $2
        AND  source_id     = $3
        AND  status NOT IN ('completed','cancelled')
    `, [tenantId, sourceModule, sourceId])
  } catch (err) {
    slog('ERROR', 'actionService', '[cancel] Failed to cancel action', {
      error: String(err), sourceModule, sourceId,
    })
  }
}

/** Test-only: export internals for unit testing */
export const __testHooks = {
  resolveEffectiveAssignee,
  resolveSlaRule: _resolveSlaRule,
}
