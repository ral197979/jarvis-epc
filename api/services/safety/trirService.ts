/**
 * Denver Engineering — TRIR (Total Recordable Incident Rate)
 * ─────────────────────────────────────────────────────────────────────────────
 * TRIR = recordable incidents × 200,000 / exposure hours
 *
 * 200,000 is the OSHA constant: 100 full-time equivalents × 40 hours × 50 weeks.
 *
 * What this replaces
 * ──────────────────
 * The dashboard computed `(recordable × 200,000) / (200,000 × toolbox_talks
 * .length)`. `safety_incidents` had no `recordable` column, so the numerator
 * counted nothing; `toolbox_talks` has no table, so the denominator was
 * invented and then clamped to a minimum of 1 — which meant the card always
 * produced a plausible number. TRIR is a regulated metric, and a fabricated one
 * on an executive dashboard is a compliance claim about a workplace.
 *
 * The rule this module exists to enforce
 * ──────────────────────────────────────
 * A rate is returned ONLY when both halves are complete and measured. Every
 * other outcome is `trir: null` with a machine-readable `reason`, and callers
 * must render the reason rather than a zero. There is deliberately no branch
 * that estimates, infers, or substitutes a proxy for either half — the absence
 * of such a branch is the feature.
 *
 * Why an unclassified incident blocks the whole rate: recordability is a
 * regulatory determination, so an undetermined incident is not "not
 * recordable". Counting only the confirmed ones would silently understate the
 * rate by exactly the number nobody has looked at yet, and understating TRIR is
 * the direction that matters.
 */
import { tenantQuery } from '../../db/pool'

/** OSHA base: 100 FTE × 40 h × 50 weeks. */
export const OSHA_HOURS_BASE = 200_000

export type TrirUnavailableReason =
  /** At least one incident in the period has no recordability determination. */
  | 'unclassified_incidents'
  /** No exposure hours recorded at this scope for any part of the period. */
  | 'no_exposure_hours'
  /** Exposure hours exist but do not span the whole period. */
  | 'incomplete_exposure_coverage'
  /** Hours are recorded and total zero — a rate would divide by zero. */
  | 'zero_exposure_hours'
  /** The requested period is not a valid range. */
  | 'invalid_period'

export interface TrirResult {
  /** The rate, or null when it cannot be computed truthfully. */
  trir: number | null
  /** Why it is null. Absent when `trir` is a number. */
  reason?: TrirUnavailableReason
  /** Human-readable form of `reason`, safe to render. */
  detail?: string

  scope: 'tenant' | 'project'
  projectId: string | null
  periodStart: string
  periodEnd: string

  /** Confirmed recordable incidents. Null when the classification is incomplete. */
  recordableIncidents: number | null
  /** Incidents still awaiting a determination. Always reported. */
  unclassifiedIncidents: number
  /** Total incidents in scope for the period. */
  totalIncidents: number

  /** Measured hours. Null when no basis exists. */
  exposureHours: number | null
  /** How many exposure records the denominator was built from. */
  exposureRecords: number
  /** Days of the period with no exposure record covering them. */
  uncoveredDays: number
}

const DETAIL: Record<TrirUnavailableReason, string> = {
  unclassified_incidents:
    'Some incidents in this period have no recordability determination.',
  no_exposure_hours:
    'No exposure hours have been recorded for this period.',
  incomplete_exposure_coverage:
    'Exposure hours do not cover the whole period.',
  zero_exposure_hours:
    'Recorded exposure hours are zero, so a rate cannot be calculated.',
  invalid_period:
    'The requested period is not a valid date range.',
}

interface CountsRow { total: string; recordable: string; unclassified: string }
interface ExposureRow { period_start: string; period_end: string; hours: string }

const DAY_MS = 86_400_000
const toUtcDay = (iso: string): number => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`)
const isIsoDate = (v: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(v)

/**
 * Days in [start, end] not covered by any exposure record.
 *
 * Intervals are inclusive on both ends and may overlap or be recorded out of
 * order, so they are merged before measuring. This is what turns "some hours
 * exist" into "the basis is complete", and it is the check that stops a single
 * week's payroll export from being presented as a quarter's denominator.
 */
export function uncoveredDayCount(
  periodStart: string, periodEnd: string,
  intervals: { start: string; end: string }[],
): number {
  const from = toUtcDay(periodStart)
  const to   = toUtcDay(periodEnd)
  if (!(to >= from)) return 0

  const totalDays = Math.round((to - from) / DAY_MS) + 1

  const clipped = intervals
    .map(i => ({ s: Math.max(toUtcDay(i.start), from), e: Math.min(toUtcDay(i.end), to) }))
    .filter(i => i.e >= i.s)
    .sort((a, b) => a.s - b.s)

  let covered = 0
  let cursor  = -Infinity
  for (const i of clipped) {
    const s = Math.max(i.s, cursor === -Infinity ? i.s : cursor + DAY_MS)
    if (i.e >= s) {
      covered += Math.round((i.e - s) / DAY_MS) + 1
      cursor = i.e
    }
  }
  return Math.max(0, totalDays - covered)
}

function unavailable(base: Omit<TrirResult, 'trir' | 'reason' | 'detail'>, reason: TrirUnavailableReason): TrirResult {
  return { ...base, trir: null, reason, detail: DETAIL[reason] }
}

/**
 * Compute TRIR for a tenant, or for one project inside it.
 *
 * `projectId` null means the whole tenant, and then only TENANT-scoped exposure
 * rows count. Project rows are not summed into a tenant figure: any project
 * that never filed its hours would silently shrink the denominator and inflate
 * the rate, which is the same class of error as inventing it.
 *
 * `visibleProjectIds` restricts the numerator to projects the caller may reach.
 * Passing an empty array means "no projects", not "all projects" — the caller
 * is responsible for that distinction and the route makes it explicitly.
 */
export async function computeTrir(
  tenantId: string,
  opts: {
    projectId?: string | null
    periodStart: string
    periodEnd: string
    visibleProjectIds?: string[] | null
  },
): Promise<TrirResult> {
  const projectId   = opts.projectId ?? null
  const periodStart = String(opts.periodStart)
  const periodEnd   = String(opts.periodEnd)

  const base: Omit<TrirResult, 'trir' | 'reason' | 'detail'> = {
    scope: projectId ? 'project' : 'tenant',
    projectId,
    periodStart, periodEnd,
    recordableIncidents: null,
    unclassifiedIncidents: 0,
    totalIncidents: 0,
    exposureHours: null,
    exposureRecords: 0,
    uncoveredDays: 0,
  }

  if (!isIsoDate(periodStart) || !isIsoDate(periodEnd) || toUtcDay(periodEnd) < toUtcDay(periodStart)) {
    return unavailable(base, 'invalid_period')
  }

  // ── Numerator ──
  // `recordable IS NULL` is counted separately and is never folded into the
  // false branch. FILTER, not a WHERE, so one pass answers all three.
  const scopeSql: string[] = ['tenant_id = $1', 'incident_date BETWEEN $2::date AND $3::date']
  const params: unknown[] = [tenantId, periodStart, periodEnd]

  if (projectId) {
    params.push(projectId)
    scopeSql.push(`project_id = $${params.length}`)
  } else if (opts.visibleProjectIds != null) {
    // Tenant scope, restricted to what the caller can reach.
    params.push(opts.visibleProjectIds)
    scopeSql.push(`project_id = ANY($${params.length}::uuid[])`)
  }

  const counts = await tenantQuery<CountsRow>(tenantId, `
    SELECT COUNT(*)::text                                            AS total,
           COUNT(*) FILTER (WHERE recordable IS TRUE)::text          AS recordable,
           COUNT(*) FILTER (WHERE recordable IS NULL)::text          AS unclassified
      FROM safety_incidents
     WHERE ${scopeSql.join(' AND ')}
  `, params)

  const row = counts.rows[0]
  base.totalIncidents        = Number(row?.total ?? 0)
  base.unclassifiedIncidents = Number(row?.unclassified ?? 0)
  const recordable           = Number(row?.recordable ?? 0)

  // ── Denominator ──
  // Scope levels are never mixed; see the note above.
  const expParams: unknown[] = [tenantId, periodStart, periodEnd]
  let expScope = 'project_id IS NULL'
  if (projectId) {
    expParams.push(projectId)
    expScope = `project_id = $${expParams.length}`
  }

  const exposure = await tenantQuery<ExposureRow>(tenantId, `
    SELECT period_start::text, period_end::text, hours::text
      FROM safety_exposure_hours
     WHERE tenant_id = $1
       AND ${expScope}
       AND period_start <= $3::date
       AND period_end   >= $2::date
     ORDER BY period_start
  `, expParams)

  base.exposureRecords = exposure.rows.length
  const uncovered = uncoveredDayCount(periodStart, periodEnd,
    exposure.rows.map(r => ({ start: r.period_start, end: r.period_end })))
  base.uncoveredDays = uncovered

  // ── Refusals, in the order that gives the most useful reason ──
  //
  // The numerator is checked first: an unclassified incident makes the rate
  // wrong in the understating direction, which matters more than a missing
  // denominator that merely makes it uncomputable.
  if (base.unclassifiedIncidents > 0) return unavailable(base, 'unclassified_incidents')
  if (exposure.rows.length === 0)     return unavailable(base, 'no_exposure_hours')
  if (uncovered > 0)                  return unavailable(base, 'incomplete_exposure_coverage')

  const hours = exposure.rows.reduce((t, r) => t + Number(r.hours), 0)
  base.exposureHours = hours
  base.recordableIncidents = recordable

  if (hours <= 0) return unavailable(base, 'zero_exposure_hours')

  return { ...base, trir: (recordable * OSHA_HOURS_BASE) / hours }
}

// ─── Exposure hours ──────────────────────────────────────────────────────────

export interface ExposureRecord {
  id: string
  project_id: string | null
  period_start: string
  period_end: string
  hours: string
  source: string
  source_reference: string | null
  note: string | null
  recorded_by: string | null
  created_at: string
}

export async function listExposureHours(
  tenantId: string, projectId: string | null,
): Promise<ExposureRecord[]> {
  const params: unknown[] = [tenantId]
  let scope = 'project_id IS NULL'
  if (projectId) { params.push(projectId); scope = `project_id = $${params.length}` }
  const res = await tenantQuery<ExposureRecord>(tenantId, `
    SELECT id, project_id, period_start::text, period_end::text, hours::text,
           source, source_reference, note, recorded_by, created_at::text
      FROM safety_exposure_hours
     WHERE tenant_id = $1 AND ${scope}
     ORDER BY period_start DESC
     LIMIT 500
  `, params)
  return res.rows
}

export type ExposureError = 'invalid_period' | 'invalid_hours' | 'source_required' | 'overlapping_period'

/**
 * Record measured exposure hours.
 *
 * Overlap is refused rather than merged. Two records covering the same days
 * would both be summed into the denominator, inflating hours and understating
 * the rate — the same failure the invented denominator produced, arrived at
 * honestly. The unique indexes catch identical periods; this catches partial
 * overlap, which no index can express without btree_gist.
 */
export async function recordExposureHours(
  tenantId: string,
  input: {
    projectId?: string | null
    periodStart: string; periodEnd: string
    hours: number
    source: string
    sourceReference?: string | null
    note?: string | null
  },
  userId: string | null,
): Promise<{ record?: ExposureRecord; error?: ExposureError; conflictsWith?: string }> {
  const projectId = input.projectId ?? null
  const { periodStart, periodEnd } = input

  if (!isIsoDate(periodStart) || !isIsoDate(periodEnd) || toUtcDay(periodEnd) < toUtcDay(periodStart)) {
    return { error: 'invalid_period' }
  }
  if (!Number.isFinite(input.hours) || input.hours < 0) return { error: 'invalid_hours' }
  if (!input.source || !String(input.source).trim())     return { error: 'source_required' }

  const params: unknown[] = [tenantId, periodStart, periodEnd]
  let scope = 'project_id IS NULL'
  if (projectId) { params.push(projectId); scope = `project_id = $${params.length}` }

  const clash = await tenantQuery<{ id: string }>(tenantId, `
    SELECT id FROM safety_exposure_hours
     WHERE tenant_id = $1 AND ${scope}
       AND period_start <= $3::date AND period_end >= $2::date
     LIMIT 1
  `, params)
  if (clash.rows[0]) return { error: 'overlapping_period', conflictsWith: clash.rows[0].id }

  const res = await tenantQuery<ExposureRecord>(tenantId, `
    INSERT INTO safety_exposure_hours
      (tenant_id, project_id, period_start, period_end, hours, source, source_reference, note, recorded_by)
    VALUES ($1, $2, $3::date, $4::date, $5, $6, $7, $8, $9)
    RETURNING id, project_id, period_start::text, period_end::text, hours::text,
              source, source_reference, note, recorded_by, created_at::text
  `, [tenantId, projectId, periodStart, periodEnd, input.hours,
      String(input.source).trim(), input.sourceReference ?? null, input.note ?? null, userId])

  return { record: res.rows[0] }
}

// ─── Recordability classification ────────────────────────────────────────────

/**
 * Record an OSHA recordability determination.
 *
 * `recordable` must be an explicit boolean. There is no path that sets it from
 * a default, an inference, or a bulk operation: the classification exists
 * precisely so that "nobody has decided yet" stays distinguishable from "not
 * recordable", and every determination carries who made it and when.
 */
export async function classifyIncidentRecordable(
  tenantId: string, incidentId: string,
  recordable: boolean, basis: string | null, userId: string | null,
): Promise<{ id: string; recordable: boolean; recordable_classified_at: string } | null> {
  const res = await tenantQuery<{ id: string; recordable: boolean; recordable_classified_at: string }>(tenantId, `
    UPDATE safety_incidents
       SET recordable = $3,
           recordable_basis = $4,
           recordable_classified_by = $5,
           recordable_classified_at = NOW(),
           updated_at = NOW()
     WHERE tenant_id = $1 AND id = $2
     RETURNING id, recordable, recordable_classified_at::text
  `, [tenantId, incidentId, recordable, basis, userId])
  return res.rows[0] ?? null
}
