/**
 * Denver Engineering — Timesheet Service (v10.16.0)
 *
 * Weekly hour logging per member per project.
 * Approving a timesheet auto-creates a labor Cost Entry → feeds ACWP.
 */
import { tenantQuery, tenantTransaction } from '../../db/pool'

export type TimesheetStatus = 'draft' | 'submitted' | 'approved' | 'rejected'


export interface Timesheet {
  id:           string
  tenantId:     string
  memberId:     string
  memberName?:  string
  memberRate?:  number | null
  projectId:    string
  projectName?: string
  weekStart:    string
  status:       TimesheetStatus
  totalHours:   number
  totalCost:    number | null
  mon:          number | null
  tue:          number | null
  wed:          number | null
  thu:          number | null
  fri:          number | null
  sat:          number | null
  sun:          number | null
  wbsCode:      string | null
  notes:        string | null
  submittedAt:  string | null
  approvedAt:   string | null
  approvedBy:   string | null
  costEntryId:  string | null
  createdAt:    string
  updatedAt:    string
}

export interface WeeklySummary {
  weekStart:    string
  totalHours:   number
  totalCost:    number
  memberCount:  number
  byStatus:     Record<TimesheetStatus, number>
}

function rowToTs(r: Record<string, unknown>): Timesheet {
  return {
    id:           r['id']            as string,
    tenantId:     r['tenant_id']     as string,
    memberId:     r['member_id']     as string,
    memberName:   r['member_name']   as string | undefined,
    memberRate:   r['hourly_rate']   !== undefined ? (r['hourly_rate'] !== null ? Number(r['hourly_rate']) : null) : undefined,
    projectId:    r['project_id']    as string,
    projectName:  r['project_name']  as string | undefined,
    weekStart:    r['week_start']    as string,
    status:       r['status']        as TimesheetStatus,
    totalHours:   Number(r['total_hours'] ?? 0),
    totalCost:    r['total_cost'] !== null ? Number(r['total_cost']) : null,
    mon:          r['mon_hrs'] !== null ? Number(r['mon_hrs']) : null,
    tue:          r['tue_hrs'] !== null ? Number(r['tue_hrs']) : null,
    wed:          r['wed_hrs'] !== null ? Number(r['wed_hrs']) : null,
    thu:          r['thu_hrs'] !== null ? Number(r['thu_hrs']) : null,
    fri:          r['fri_hrs'] !== null ? Number(r['fri_hrs']) : null,
    sat:          r['sat_hrs'] !== null ? Number(r['sat_hrs']) : null,
    sun:          r['sun_hrs'] !== null ? Number(r['sun_hrs']) : null,
    wbsCode:      r['wbs_code']      as string | null,
    notes:        r['notes']         as string | null,
    submittedAt:  r['submitted_at']  as string | null,
    approvedAt:   r['approved_at']   as string | null,
    approvedBy:   r['approved_by']   as string | null,
    costEntryId:  r['cost_entry_id'] as string | null,
    createdAt:    r['created_at']    as string,
    updatedAt:    r['updated_at']    as string,
  }
}

// ─── Upsert (create or update hours for a week) ───────────────────────────────

export interface UpsertTimesheetInput {
  memberId:   string
  projectId:  string
  weekStart:  string   // ISO date of Monday
  mon?: number; tue?: number; wed?: number; thu?: number
  fri?: number; sat?: number; sun?: number
  wbsCode?:   string
  notes?:     string
}

export async function upsertTimesheet(
  tenantId: string,
  input:    UpsertTimesheetInput,
): Promise<Timesheet> {
  const res = await tenantQuery(tenantId, `
    INSERT INTO timesheets
      (tenant_id, member_id, project_id, week_start,
       mon_hrs, tue_hrs, wed_hrs, thu_hrs, fri_hrs, sat_hrs, sun_hrs,
       wbs_code, notes)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    ON CONFLICT (tenant_id, member_id, project_id, week_start)
    DO UPDATE SET
      mon_hrs    = COALESCE(EXCLUDED.mon_hrs, timesheets.mon_hrs),
      tue_hrs    = COALESCE(EXCLUDED.tue_hrs, timesheets.tue_hrs),
      wed_hrs    = COALESCE(EXCLUDED.wed_hrs, timesheets.wed_hrs),
      thu_hrs    = COALESCE(EXCLUDED.thu_hrs, timesheets.thu_hrs),
      fri_hrs    = COALESCE(EXCLUDED.fri_hrs, timesheets.fri_hrs),
      sat_hrs    = COALESCE(EXCLUDED.sat_hrs, timesheets.sat_hrs),
      sun_hrs    = COALESCE(EXCLUDED.sun_hrs, timesheets.sun_hrs),
      wbs_code   = COALESCE(EXCLUDED.wbs_code, timesheets.wbs_code),
      notes      = COALESCE(EXCLUDED.notes,    timesheets.notes),
      updated_at = NOW()
    WHERE timesheets.status = 'draft'
    RETURNING *
  `, [tenantId, input.memberId, input.projectId, input.weekStart,
      input.mon ?? null, input.tue ?? null, input.wed ?? null, input.thu ?? null,
      input.fri ?? null, input.sat ?? null, input.sun ?? null,
      input.wbsCode ?? null, input.notes ?? null])
  return rowToTs(res.rows[0] as Record<string, unknown>)
}

// ─── List by project + week ───────────────────────────────────────────────────

/**
 * ADR-014 Phase 3G §6. `timesheets.project_id` is NOT NULL, so the resource is
 * PROJECT_REQUIRED and every row needs live membership of its project. `scope`
 * is built by the ROUTE from the live principal; the service composes SQL and
 * decides nothing. `$SCOPE_USER` is symbolic because this query numbers its own
 * parameters as it builds its filters.
 */
export async function listTimesheets(
  tenantId:  string,
  opts:      { projectId?: string; memberId?: string; weekStart?: string; status?: TimesheetStatus } = {},
  scope:     { sql: string; params: unknown[] } = { sql: '', params: [] },
): Promise<Timesheet[]> {
  const conditions = ['t.tenant_id = $1']
  const params: unknown[] = [tenantId]
  let idx = 2

  if (opts.projectId) { conditions.push(`t.project_id = $${idx++}`); params.push(opts.projectId) }
  if (opts.memberId)  { conditions.push(`t.member_id  = $${idx++}`); params.push(opts.memberId) }
  if (opts.weekStart) { conditions.push(`t.week_start = $${idx++}`); params.push(opts.weekStart) }
  if (opts.status)    { conditions.push(`t.status     = $${idx++}`); params.push(opts.status) }

  const scopeSql = scope.sql.replace(/\$SCOPE_USER/g, `$${idx}`)

  const res = await tenantQuery(tenantId, `
    SELECT
      t.*,
      CONCAT(m.first_name, ' ', m.last_name) AS member_name,
      m.hourly_rate,
      p.name AS project_name
    FROM timesheets t
    JOIN team_members m ON m.id = t.member_id AND m.tenant_id = t.tenant_id
    JOIN projects     p ON p.id = t.project_id AND p.tenant_id = t.tenant_id
    WHERE ${conditions.join(' AND ')}
    ${scopeSql}
    ORDER BY t.week_start DESC, m.last_name ASC
  `, [...params, ...scope.params])
  return res.rows.map(r => rowToTs(r as Record<string, unknown>))
}

// ─── Submit ───────────────────────────────────────────────────────────────────

export async function submitTimesheet(tenantId: string, id: string): Promise<Timesheet | null> {
  const res = await tenantQuery(tenantId, `
    UPDATE timesheets SET
      status       = 'submitted',
      submitted_at = NOW(),
      updated_at   = NOW()
    WHERE tenant_id = $1 AND id = $2 AND status = 'draft'
    RETURNING *
  `, [tenantId, id])
  return res.rows.length ? rowToTs(res.rows[0] as Record<string, unknown>) : null
}

// ─── Approve → auto-create Cost Entry ────────────────────────────────────────

export async function approveTimesheet(
  tenantId:   string,
  id:         string,
  approvedBy: string,
): Promise<Timesheet | null> {
  return tenantTransaction(tenantId, async (client) => {
    // Lock timesheet
    const tsRes = await client.query(
      `SELECT t.*, m.hourly_rate, m.first_name, m.last_name, p.name AS project_name
       FROM timesheets t
       JOIN team_members m ON m.id = t.member_id AND m.tenant_id = t.tenant_id
       JOIN projects     p ON p.id = t.project_id AND p.tenant_id = t.tenant_id
       WHERE t.tenant_id=$1 AND t.id=$2 AND t.status='submitted'
       FOR UPDATE`,
      [tenantId, id],
    )
    if (!tsRes.rows.length) return null

    const ts = tsRes.rows[0] as Record<string, unknown>
    const hours     = Number(ts['total_hours'] ?? 0)
    const rate      = ts['hourly_rate'] !== null ? Number(ts['hourly_rate']) : null
    const totalCost = rate !== null ? Math.round(hours * rate * 100) / 100 : null

    let costEntryId: string | null = null

    // Create Cost Entry if we have a rate
    if (totalCost !== null && totalCost > 0) {
      const weekEnd = new Date(ts['week_start'] as string)
      weekEnd.setDate(weekEnd.getDate() + 6)

      const ceRes = await client.query(
        `INSERT INTO cost_entries
           (tenant_id, project_id, entry_date, entry_type, wbs_code, description,
            amount, quantity, unit, unit_cost, status, posted_at, posted_by)
         VALUES ($1,$2,$3,'labor',$4,$5,$6,$7,'hrs',$8,'posted',NOW(),$9)
         RETURNING id`,
        [
          tenantId,
          ts['project_id'],
          weekEnd.toISOString().slice(0,10),
          ts['wbs_code'] ?? null,
          `Labor: ${ts['first_name']} ${ts['last_name']} — week of ${ts['week_start']}`,
          totalCost,
          hours,
          rate,
          approvedBy,
        ],
      )
      costEntryId = ceRes.rows[0]?.['id'] as string | null

      // Also insert into evm_actuals
      if (costEntryId) {
        const wbsRes = await client.query(
          `SELECT id FROM evm_wbs_entries
           WHERE tenant_id=$1 AND project_id=$2 AND wbs_code=$3 LIMIT 1`,
          [tenantId, ts['project_id'], ts['wbs_code'] ?? ''],
        )
        const wbsEntryId = wbsRes.rows[0]?.['id'] as string | null
        await client.query(
          `INSERT INTO evm_actuals
             (tenant_id, project_id, wbs_entry_id, amount, period_date, description)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [tenantId, ts['project_id'], wbsEntryId, totalCost,
           weekEnd.toISOString().slice(0,10),
           `Labor: ${ts['first_name']} ${ts['last_name']} — ${hours}hrs`],
        )
      }
    }

    // Lock timesheet as approved
    const updated = await client.query(
      `UPDATE timesheets SET
         status        = 'approved',
         approved_at   = NOW(),
         approved_by   = $3,
         total_cost    = $4,
         cost_entry_id = $5,
         updated_at    = NOW()
       WHERE tenant_id=$1 AND id=$2
       RETURNING *`,
      [tenantId, id, approvedBy, totalCost, costEntryId],
    )
    return rowToTs(updated.rows[0] as Record<string, unknown>)
  })
}

// ─── Reject ───────────────────────────────────────────────────────────────────

export async function rejectTimesheet(tenantId: string, id: string): Promise<Timesheet | null> {
  const res = await tenantQuery(tenantId, `
    UPDATE timesheets SET status='draft', submitted_at=NULL, updated_at=NOW()
    WHERE tenant_id=$1 AND id=$2 AND status='submitted'
    RETURNING *
  `, [tenantId, id])
  return res.rows.length ? rowToTs(res.rows[0] as Record<string, unknown>) : null
}

// ─── Weekly summary for a project ────────────────────────────────────────────

export async function getWeeklySummary(
  tenantId:  string,
  projectId: string,
  weeks:     number = 8,
): Promise<WeeklySummary[]> {
  const res = await tenantQuery(tenantId, `
    SELECT
      week_start,
      COUNT(DISTINCT member_id)::int                  AS member_count,
      COALESCE(SUM(total_hours), 0)                   AS total_hours,
      COALESCE(SUM(total_cost)  FILTER (WHERE status='approved'), 0) AS total_cost,
      COUNT(*) FILTER (WHERE status='draft')::int     AS draft_cnt,
      COUNT(*) FILTER (WHERE status='submitted')::int AS submitted_cnt,
      COUNT(*) FILTER (WHERE status='approved')::int  AS approved_cnt,
      COUNT(*) FILTER (WHERE status='rejected')::int  AS rejected_cnt
    FROM timesheets
    WHERE tenant_id=$1 AND project_id=$2
    GROUP BY week_start
    ORDER BY week_start DESC
    LIMIT ${weeks}
  `, [tenantId, projectId])

  return (res.rows as Record<string, unknown>[]).map(r => ({
    weekStart:   r['week_start']   as string,
    totalHours:  Number(r['total_hours']),
    totalCost:   Number(r['total_cost']),
    memberCount: Number(r['member_count']),
    byStatus: {
      draft:     Number(r['draft_cnt']),
      submitted: Number(r['submitted_cnt']),
      approved:  Number(r['approved_cnt']),
      rejected:  Number(r['rejected_cnt']),
    },
  }))
}
