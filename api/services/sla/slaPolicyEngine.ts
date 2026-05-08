/**
 * Denver Engineering — SLA Policy Engine (v4.34.0)
 * ──────────────────────────────────────────────────
 * Ava Phase 2D — Business-hours-aware, timezone-correct SLA computation.
 *
 * Features:
 *   - Compute business-hours-adjusted due_at from profile
 *   - Skip holidays and non-business days
 *   - Pause / resume SLA tracking (paused_duration_mins accumulates)
 *   - Grace period delay before first escalation
 *   - Escalation cooldown between successive levels
 *   - Remaining minutes computation (negative = overdue)
 *
 * All time arithmetic is done in UTC; timezone shifts are applied
 * only when determining if a given UTC instant falls within business hours.
 */

import { query } from '../../db/pool'
import { slog } from '../../../src/modules/observability/index'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SlaProfile {
  id:                          string
  tenant_id:                   string
  name:                        string
  business_hours_start:        string | null   // '08:00'
  business_hours_end:          string | null   // '17:00'
  business_days:               number[]        // [1,2,3,4,5]
  timezone:                    string          // 'America/Denver'
  holiday_dates:               string[]        // ['2026-12-25', ...]
  grace_period_minutes:        number
  escalation_cooldown_minutes: number
}

export interface ActionSlaState {
  id:                  string
  tenant_id:           string
  action_id:           string
  sla_profile_id:      string | null
  computed_due_at:     string | null
  sla_started_at:      string
  sla_paused_at:       string | null
  sla_resumed_at:      string | null
  paused_duration_mins: number
  sla_status:          'active' | 'paused' | 'breached' | 'met'
  remaining_minutes:   number | null
  breach_count:        number
}

// ─── Profile loader ───────────────────────────────────────────────────────────

export async function loadDefaultProfile(tenantId: string): Promise<SlaProfile | null> {
  const result = await query<SlaProfile>(`
    SELECT * FROM sla_profiles
    WHERE  tenant_id  = $1
      AND  is_default = TRUE
      AND  is_active  = TRUE
    LIMIT  1
  `, [tenantId])
  return result.rows[0] ?? null
}

export async function loadProfileById(
  tenantId: string,
  profileId: string,
): Promise<SlaProfile | null> {
  const result = await query<SlaProfile>(`
    SELECT * FROM sla_profiles
    WHERE id = $1 AND tenant_id = $2 AND is_active = TRUE
  `, [profileId, tenantId])
  return result.rows[0] ?? null
}

// ─── Business hours math ──────────────────────────────────────────────────────

/** Convert a UTC Date to the given IANA timezone as a plain object */
function _inTimezone(utc: Date, tz: string): {
  year: number; month: number; day: number; hour: number; minute: number; dow: number
} {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
  const parts = Object.fromEntries(fmt.formatToParts(utc).map(p => [p.type, p.value]))
  const dow = new Date(
    parseInt(parts['year']!), parseInt(parts['month']!) - 1, parseInt(parts['day']!)
  ).getDay()
  return {
    year:   parseInt(parts['year']!),
    month:  parseInt(parts['month']!),
    day:    parseInt(parts['day']!),
    hour:   parts['hour'] === '24' ? 0 : parseInt(parts['hour']!),
    minute: parseInt(parts['minute']!),
    dow,
  }
}

function _isHoliday(d: { year: number; month: number; day: number }, holidays: string[]): boolean {
  const str = `${d.year}-${String(d.month).padStart(2,'0')}-${String(d.day).padStart(2,'0')}`
  return holidays.includes(str)
}

function _isBusinessTime(utc: Date, profile: SlaProfile): boolean {
  if (!profile.business_hours_start || !profile.business_hours_end) return true // 24/7

  const local = _inTimezone(utc, profile.timezone)
  if (!profile.business_days.includes(local.dow)) return false
  if (_isHoliday(local, profile.holiday_dates))    return false

  const [startH, startM] = profile.business_hours_start.split(':').map(Number) as [number, number]
  const [endH,   endM  ] = profile.business_hours_end.split(':').map(Number) as [number, number]
  const localMins = local.hour * 60 + local.minute
  return localMins >= startH * 60 + startM && localMins < endH * 60 + endM
}

/**
 * Advance `start` by `durationHours` of business time according to `profile`.
 * If profile has no business hours, simply adds durationHours * 3600 seconds.
 * Steps forward in 15-minute increments to accumulate only business time.
 * Cap at 365 days to prevent infinite loops in pathological configs.
 */
export function computeBusinessDueDate(start: Date, durationHours: number, profile: SlaProfile): Date {
  if (!profile.business_hours_start) {
    const d = new Date(start)
    d.setHours(d.getHours() + durationHours)
    return d
  }

  const STEP_MS    = 15 * 60 * 1000   // 15-minute steps
  const TARGET_MS  = durationHours * 3600 * 1000
  const MAX_STEPS  = (365 * 24 * 4)   // 1 year of 15-min steps safety cap

  let cursor      = new Date(start)
  let accumulated = 0
  let steps       = 0

  while (accumulated < TARGET_MS && steps < MAX_STEPS) {
    if (_isBusinessTime(cursor, profile)) {
      accumulated += STEP_MS
    }
    cursor = new Date(cursor.getTime() + STEP_MS)
    steps++
  }

  return cursor
}

// ─── SLA state management ─────────────────────────────────────────────────────

export async function initSlaState(
  tenantId:    string,
  actionId:    string,
  dueAt:       Date | null,
  profileId:   string | null,
): Promise<ActionSlaState | null> {
  try {
    const result = await query<ActionSlaState>(`
      INSERT INTO action_sla_state
        (tenant_id, action_id, sla_profile_id, computed_due_at, sla_status)
      VALUES ($1, $2, $3, $4, 'active')
      ON CONFLICT (tenant_id, action_id) DO NOTHING
      RETURNING *
    `, [tenantId, actionId, profileId ?? null, dueAt?.toISOString() ?? null])
    return result.rows[0] ?? null
  } catch (err) {
    slog('ERROR', 'slaPolicyEngine', '[initSlaState] Failed', { error: String(err), actionId })
    return null
  }
}

export async function pauseSla(
  tenantId: string,
  actionId: string,
): Promise<boolean> {
  const result = await query(`
    UPDATE action_sla_state
    SET    sla_paused_at = NOW(),
           sla_status    = 'paused',
           updated_at    = NOW()
    WHERE  tenant_id  = $1
      AND  action_id  = $2
      AND  sla_status = 'active'
  `, [tenantId, actionId])
  return (result.rowCount ?? 0) > 0
}

export async function resumeSla(
  tenantId: string,
  actionId: string,
): Promise<boolean> {
  const result = await query(`
    UPDATE action_sla_state
    SET    sla_resumed_at        = NOW(),
           paused_duration_mins  = paused_duration_mins +
             EXTRACT(EPOCH FROM (NOW() - sla_paused_at)) / 60,
           sla_paused_at         = NULL,
           sla_status            = 'active',
           updated_at            = NOW()
    WHERE  tenant_id   = $1
      AND  action_id   = $2
      AND  sla_status  = 'paused'
  `, [tenantId, actionId])
  return (result.rowCount ?? 0) > 0
}

export async function computeRemainingMinutes(
  tenantId: string,
  actionId: string,
): Promise<number | null> {
  const result = await query<{ remaining_minutes: string | null }>(`
    SELECT
      CASE
        WHEN sla_status = 'paused'
        THEN EXTRACT(EPOCH FROM (computed_due_at - sla_paused_at +
               (paused_duration_mins * INTERVAL '1 minute'))) / 60
        ELSE EXTRACT(EPOCH FROM (computed_due_at - NOW() +
               (paused_duration_mins * INTERVAL '1 minute'))) / 60
      END AS remaining_minutes
    FROM action_sla_state
    WHERE tenant_id = $1 AND action_id = $2
  `, [tenantId, actionId])

  const raw = result.rows[0]?.remaining_minutes
  return raw != null ? Math.round(parseFloat(raw)) : null
}

/** Test-only */
export const __testHooks = {
  isBusinessTime:        _isBusinessTime,
  inTimezone:            _inTimezone,
  computeBusinessDueDate,
}
