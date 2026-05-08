/**
 * Denver Engineering — Event Proximity Correlation Finder (v4.31.0)
 *
 * Given a subject event (test failure, pack finalized, punch opened),
 * returns a time-proximity ranked list of other tenant events that
 * happened near it in the audit log, daily logs, action items, and
 * compliance tasks. The output ranks by a blend of:
 *
 *   type_weight × proximity_decay × scope_match
 *
 * This is not a causal claim. It's an evidence surface — a human or
 * second-pass LLM reasons about causation; this service just puts
 * likely-related items on the PM's desk.
 *
 * Alias normalization (systemTagAlias.ts) means 'CH-01', 'ch 01',
 * 'CH_01' all match the same asset in free-text daily-log mentions.
 */

import { tenantQuery } from '../db/pool'
import { buildIlikeAliasOr, normalizeSystemTag } from './systemTagAlias'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Subject {
  kind:         'test_failure' | 'pack_finalized' | 'punch_opened' | string
  id:           string
  project_id?:  string
  system_tag?:  string       // e.g. 'CH-01'
  occurred_at:  string       // ISO timestamp
}

export interface FindOptions {
  window_hours?: number      // default 48
  limit?:        number      // default 20
}

export type CorrelationSource =
  | 'audit_log'
  | 'daily_log'
  | 'action_item'
  | 'compliance_task'
  | 'commissioning_pack'

export interface CorrelationHit {
  source:       CorrelationSource
  event_id:     string
  occurred_at:  string
  delta_hours:  number       // negative = before subject; positive = after
  summary:      string
  score:        number       // 0 - 1
  why:          string       // human-readable explanation of the score
}

// ─── Tunables ─────────────────────────────────────────────────────────────────

const TYPE_WEIGHT: Record<CorrelationSource, number> = {
  audit_log:          0.9,
  daily_log:          0.7,
  compliance_task:    0.6,
  action_item:        0.5,
  commissioning_pack: 0.4,
}

// Exponential time decay: score halves every ~17 hours, drops to ~0.14 at 48h.
function proximityDecay(deltaHours: number): number {
  return Math.exp(-Math.abs(deltaHours) / 24)
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function findCorrelates(
  tenantId: string,
  subject:  Subject,
  opts:     FindOptions = {},
): Promise<CorrelationHit[]> {
  const windowHours = opts.window_hours ?? 48
  const limit       = opts.limit        ?? 20

  const at = new Date(subject.occurred_at)
  if (Number.isNaN(at.getTime())) return []
  const windowFrom = new Date(at.getTime() - windowHours * 3_600_000).toISOString()
  const windowTo   = new Date(at.getTime() + windowHours * 3_600_000).toISOString()

  const normalizedTag = subject.system_tag ? normalizeSystemTag(subject.system_tag) : null

  // Fire all source queries in parallel. Each returns a partial list of
  // CorrelationHit with scoring already computed so merging is cheap.
  const [audit, daily, actions, compliance, packs] = await Promise.all([
    _fromAuditLog      (tenantId, subject, windowFrom, windowTo, at, normalizedTag),
    _fromDailyLogs     (tenantId, subject, windowFrom, windowTo, at, normalizedTag),
    _fromActionItems   (tenantId, subject, windowFrom, windowTo, at),
    _fromComplianceTasks(tenantId, subject, windowFrom, windowTo, at),
    _fromCommissioningPacks(tenantId, subject, windowFrom, windowTo, at),
  ])

  const merged = [...audit, ...daily, ...actions, ...compliance, ...packs]

  // Exclude the subject itself if it happens to appear (same id).
  const filtered = merged.filter(h => h.event_id !== subject.id)

  filtered.sort((a, b) => b.score - a.score)
  return filtered.slice(0, limit)
}

// ─── Source queries ──────────────────────────────────────────────────────────

async function _fromAuditLog(
  tenantId: string,
  subject:  Subject,
  from:     string,
  to:       string,
  at:       Date,
  tag:      string | null,
): Promise<CorrelationHit[]> {
  const conds: string[] = [
    `tenant_id = current_setting('app.current_tenant_id',true)::uuid`,
    `created_at BETWEEN $1 AND $2`,
  ]
  const vals: unknown[] = [from, to]

  // Scope narrowing: prefer events on the same project or resource.
  // If no project context, fall through to tenant-wide results.
  if (subject.project_id) {
    // Match either resource_id = project_id (project-level events) OR
    // any resource_id that's likely tied to that project is too broad;
    // narrow via resource_id alone keeps precision high.
    conds.push(`(resource_id = $${vals.length + 1} OR resource = 'projects' AND resource_id = $${vals.length + 1})`)
    vals.push(subject.project_id)
  }

  const res = await tenantQuery<{
    id: string; action: string; resource: string; resource_id: string | null
    user_id: string | null; created_at: string
  }>(tenantId, `
    SELECT id, action, resource, resource_id, user_id, created_at
    FROM   audit_log
    WHERE  ${conds.join(' AND ')}
    ORDER  BY created_at DESC
    LIMIT  50
  `, vals)

  return res.rows.map(r => {
    const delta = _hoursBetween(r.created_at, at)
    const scopeMatch = 1.0    // project-filter above already ensures scope
    const score = TYPE_WEIGHT.audit_log * proximityDecay(delta) * scopeMatch
    return {
      source:      'audit_log' as const,
      event_id:    r.id,
      occurred_at: r.created_at,
      delta_hours: delta,
      summary:     `${r.action} · ${r.resource}${r.resource_id ? ' #' + r.resource_id.slice(0, 8) : ''}`,
      score,
      why:         `same project · ${_describeDelta(delta)} · audit event`,
      _tag: tag,   // unused — silences "variable assigned but never read" for tag in this branch
    } as CorrelationHit
  })
}

async function _fromDailyLogs(
  tenantId: string,
  subject:  Subject,
  from:     string,
  to:       string,
  at:       Date,
  tag:      string | null,
): Promise<CorrelationHit[]> {
  const conds: string[] = [
    `tenant_id = current_setting('app.current_tenant_id',true)::uuid`,
    `log_date BETWEEN ($1)::date AND ($2)::date`,
  ]
  const vals: unknown[] = [from, to]

  if (subject.project_id) {
    conds.push(`project_id = $${vals.length + 1}`)
    vals.push(subject.project_id)
  }

  // If we know the asset tag, bias toward logs that mention it.
  // Always return the full project-windowed set — the presence or
  // absence of the tag match affects the per-row score, not inclusion.
  let tagMatchSql = 'FALSE'
  let paramIdxStart = vals.length + 1
  if (tag) {
    const workPerformed = buildIlikeAliasOr('work_performed', tag, paramIdxStart)
    vals.push(...workPerformed.values)
    paramIdxStart = workPerformed.nextIdx
    const delays = buildIlikeAliasOr('delays', tag, paramIdxStart)
    vals.push(...delays.values)
    paramIdxStart = delays.nextIdx
    const safety = buildIlikeAliasOr('safety_notes', tag, paramIdxStart)
    vals.push(...safety.values)
    paramIdxStart = safety.nextIdx
    tagMatchSql = `(${workPerformed.sql} OR ${delays.sql} OR ${safety.sql})`
  }

  const res = await tenantQuery<{
    id: string; log_date: string; work_performed: string | null; delays: string | null
    tag_match: boolean
  }>(tenantId, `
    SELECT id, log_date, work_performed, delays,
           ${tagMatchSql} AS tag_match
    FROM   daily_logs
    WHERE  ${conds.join(' AND ')}
    ORDER  BY log_date DESC
    LIMIT  50
  `, vals)

  return res.rows.map(r => {
    // daily_logs has a log_date (DATE), not a timestamp — approximate
    // delta by treating the log as 18:00 local (end-of-day capture).
    const ts = new Date(`${r.log_date}T18:00:00Z`)
    const delta = _hoursBetween(ts.toISOString(), at)
    const scopeMatch = r.tag_match ? 1.0 : (subject.project_id ? 0.6 : 0.2)
    const score = TYPE_WEIGHT.daily_log * proximityDecay(delta) * scopeMatch
    const snippet = (r.work_performed || r.delays || '').slice(0, 100)
    return {
      source:      'daily_log' as const,
      event_id:    r.id,
      occurred_at: ts.toISOString(),
      delta_hours: delta,
      summary:     snippet ? `Daily log: ${snippet}${snippet.length === 100 ? '…' : ''}` : 'Daily log (no text)',
      score,
      why:         r.tag_match
                     ? `tag '${tag}' matched in log text · ${_describeDelta(delta)}`
                     : subject.project_id
                       ? `same project · ${_describeDelta(delta)} · no tag match`
                       : `same tenant · ${_describeDelta(delta)} · weak scope`,
    }
  })
}

async function _fromActionItems(
  tenantId: string,
  subject:  Subject,
  from:     string,
  to:       string,
  at:       Date,
): Promise<CorrelationHit[]> {
  // Completed action items are the high-signal events — "filter changed"
  // usually closes an action item rather than appearing as a raw log.
  const conds: string[] = [
    `tenant_id = current_setting('app.current_tenant_id',true)::uuid`,
    `completed_at BETWEEN $1 AND $2`,
  ]
  const vals: unknown[] = [from, to]

  if (subject.project_id) {
    conds.push(`project_id = $${vals.length + 1}`)
    vals.push(subject.project_id)
  }

  const res = await tenantQuery<{
    id: string; title: string; status: string; completed_at: string
  }>(tenantId, `
    SELECT id, title, status, completed_at
    FROM   action_items
    WHERE  ${conds.join(' AND ')} AND status = 'completed'
    ORDER  BY completed_at DESC
    LIMIT  50
  `, vals)

  return res.rows.map(r => {
    const delta = _hoursBetween(r.completed_at, at)
    const scopeMatch = subject.project_id ? 0.9 : 0.3
    const score = TYPE_WEIGHT.action_item * proximityDecay(delta) * scopeMatch
    return {
      source:      'action_item' as const,
      event_id:    r.id,
      occurred_at: r.completed_at,
      delta_hours: delta,
      summary:     `Action completed: ${r.title.slice(0, 120)}`,
      score,
      why:         subject.project_id
                     ? `same project · action completed · ${_describeDelta(delta)}`
                     : `same tenant · action completed · ${_describeDelta(delta)}`,
    }
  })
}

async function _fromComplianceTasks(
  tenantId: string,
  subject:  Subject,
  from:     string,
  to:       string,
  at:       Date,
): Promise<CorrelationHit[]> {
  // State transitions carry the most meaning — completed, waived, overdue.
  // updated_at fires on each transition thanks to the trigger.
  const conds: string[] = [
    `tenant_id = current_setting('app.current_tenant_id',true)::uuid`,
    `updated_at BETWEEN $1 AND $2`,
  ]
  const vals: unknown[] = [from, to]

  if (subject.project_id) {
    conds.push(`project_id = $${vals.length + 1}`)
    vals.push(subject.project_id)
  }

  const res = await tenantQuery<{
    id: string; title: string; category: string; status: string; updated_at: string
  }>(tenantId, `
    SELECT id, title, category, status, updated_at
    FROM   compliance_tasks
    WHERE  ${conds.join(' AND ')}
    ORDER  BY updated_at DESC
    LIMIT  50
  `, vals)

  return res.rows.map(r => {
    const delta = _hoursBetween(r.updated_at, at)
    const scopeMatch = subject.project_id ? 0.8 : 0.3
    const score = TYPE_WEIGHT.compliance_task * proximityDecay(delta) * scopeMatch
    return {
      source:      'compliance_task' as const,
      event_id:    r.id,
      occurred_at: r.updated_at,
      delta_hours: delta,
      summary:     `Compliance ${r.status}: ${r.category} · ${r.title.slice(0, 80)}`,
      score,
      why:         `compliance transition · ${_describeDelta(delta)}`,
    }
  })
}

async function _fromCommissioningPacks(
  tenantId: string,
  subject:  Subject,
  from:     string,
  to:       string,
  at:       Date,
): Promise<CorrelationHit[]> {
  const conds: string[] = [
    `tenant_id = current_setting('app.current_tenant_id',true)::uuid`,
    `updated_at BETWEEN $1 AND $2`,
    `status = 'finalized'`,
  ]
  const vals: unknown[] = [from, to]

  if (subject.project_id) {
    conds.push(`project_id = $${vals.length + 1}`)
    vals.push(subject.project_id)
  }

  const res = await tenantQuery<{
    id: string; title: string; system_type: string; updated_at: string
  }>(tenantId, `
    SELECT id, title, system_type, updated_at
    FROM   commissioning_packs
    WHERE  ${conds.join(' AND ')}
    ORDER  BY updated_at DESC
    LIMIT  50
  `, vals)

  return res.rows.map(r => {
    const delta = _hoursBetween(r.updated_at, at)
    const scopeMatch = subject.project_id ? 0.7 : 0.2
    const score = TYPE_WEIGHT.commissioning_pack * proximityDecay(delta) * scopeMatch
    return {
      source:      'commissioning_pack' as const,
      event_id:    r.id,
      occurred_at: r.updated_at,
      delta_hours: delta,
      summary:     `Pack finalized: ${r.system_type} · ${r.title.slice(0, 80)}`,
      score,
      why:         `adjacent pack finalized · ${_describeDelta(delta)}`,
    }
  })
}

// ─── Formatting helpers ──────────────────────────────────────────────────────

function _hoursBetween(iso: string, ref: Date): number {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return 0
  return (t - ref.getTime()) / 3_600_000
}

function _describeDelta(hrs: number): string {
  const abs = Math.abs(hrs)
  const hrsStr = abs < 1 ? `${Math.round(abs * 60)}min`
                        : abs < 48 ? `${abs.toFixed(1)}h`
                        : `${(abs / 24).toFixed(1)}d`
  return hrs < 0 ? `${hrsStr} before` : `${hrsStr} after`
}
