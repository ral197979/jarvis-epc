/**
 * Denver Engineering — Team Service (v10.13.0)
 */
import { tenantQuery } from '../../db/pool'

export type MemberStatus   = 'active' | 'inactive' | 'on_leave'
export type AssignmentRole =
  | 'project_manager' | 'superintendent' | 'engineer' | 'foreman'
  | 'inspector' | 'safety_officer' | 'estimator' | 'coordinator' | 'other'

export interface TeamMember {
  id:          string
  tenantId:    string
  firstName:   string
  lastName:    string
  fullName:    string
  email:       string | null
  phone:       string | null
  role:        string
  trade:       string | null
  hourlyRate:  number | null
  status:      MemberStatus
  notes:       string | null
  createdAt:   string
  updatedAt:   string
  // aggregated
  activeProjects?: number
  totalAllocation?: number   // sum of allocation_pct across active assignments
}

export interface ProjectAssignment {
  id:             string
  tenantId:       string
  memberId:       string
  projectId:      string
  projectName?:   string
  assignmentRole: AssignmentRole
  allocationPct:  number
  startDate:      string
  endDate:        string | null
  notes:          string | null
  createdAt:      string
  // member fields (when listing by project)
  memberFirstName?: string
  memberLastName?:  string
  memberRole?:      string
}

export interface TeamSummary {
  totalActive:    number
  totalInactive:  number
  onLeave:        number
  byRole:         Record<string, number>
  avgAllocation:  number
}

function rowToMember(r: Record<string, unknown>): TeamMember {
  return {
    id:         r['id']         as string,
    tenantId:   r['tenant_id']  as string,
    firstName:  r['first_name'] as string,
    lastName:   r['last_name']  as string,
    fullName:   `${r['first_name']} ${r['last_name']}`,
    email:      r['email']      as string | null,
    phone:      r['phone']      as string | null,
    role:       r['role']       as string,
    trade:      r['trade']      as string | null,
    hourlyRate: r['hourly_rate'] !== null ? Number(r['hourly_rate']) : null,
    status:     r['status']     as MemberStatus,
    notes:      r['notes']      as string | null,
    createdAt:  r['created_at'] as string,
    updatedAt:  r['updated_at'] as string,
    activeProjects:   r['active_projects']  !== undefined ? Number(r['active_projects'])  : undefined,
    totalAllocation:  r['total_allocation'] !== undefined ? Number(r['total_allocation']) : undefined,
  }
}

function rowToAssignment(r: Record<string, unknown>): ProjectAssignment {
  return {
    id:             r['id']              as string,
    tenantId:       r['tenant_id']       as string,
    memberId:       r['member_id']       as string,
    projectId:      r['project_id']      as string,
    projectName:    r['project_name']    as string | undefined,
    assignmentRole: r['assignment_role'] as AssignmentRole,
    allocationPct:  Number(r['allocation_pct']),
    startDate:      r['start_date']      as string,
    endDate:        r['end_date']        as string | null,
    notes:          r['notes']           as string | null,
    createdAt:      r['created_at']      as string,
    memberFirstName: r['member_first_name'] as string | undefined,
    memberLastName:  r['member_last_name']  as string | undefined,
    memberRole:      r['member_role']       as string | undefined,
  }
}

// ─── Members ──────────────────────────────────────────────────────────────────

export interface CreateMemberInput {
  firstName:  string
  lastName:   string
  email?:     string
  phone?:     string
  role:       string
  trade?:     string
  hourlyRate?: number
  notes?:     string
}

export async function createMember(tenantId: string, input: CreateMemberInput): Promise<TeamMember> {
  const res = await tenantQuery(tenantId, `
    INSERT INTO team_members
      (tenant_id, first_name, last_name, email, phone, role, trade, hourly_rate, notes)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    RETURNING *
  `, [tenantId, input.firstName, input.lastName,
      input.email     ?? null, input.phone     ?? null,
      input.role,
      input.trade     ?? null, input.hourlyRate ?? null,
      input.notes     ?? null])
  return rowToMember(res.rows[0] as Record<string, unknown>)
}

/**
 * ADR-014 Phase 3G — the collection authorization predicate for
 * `project_assignments`, built by the ROUTE from the live principal and handed
 * here as SQL plus its bound parameter. The service composes queries; it never
 * decides authorization and never sees the principal.
 *
 * `$SCOPE_USER` is symbolic because each query below numbers its own
 * parameters. `project_assignments` is PROJECT_REQUIRED, so the predicate is a
 * plain membership test with no tenant-global branch.
 */
export interface AssignmentScope { sql: string; params: unknown[] }
const NO_SCOPE: AssignmentScope = { sql: '', params: [] }

export async function listMembers(
  tenantId: string,
  opts:     { status?: MemberStatus; search?: string } = {},
  scope: AssignmentScope = NO_SCOPE,
): Promise<TeamMember[]> {
  const conditions = ['m.tenant_id = $1']
  const params: unknown[] = [tenantId]
  let idx = 2

  if (opts.status) { conditions.push(`m.status = $${idx++}`); params.push(opts.status) }
  if (opts.search) {
    conditions.push(`(m.first_name ILIKE $${idx} OR m.last_name ILIKE $${idx} OR m.role ILIKE $${idx})`)
    params.push(`%${opts.search}%`); idx++
  }

  const res = await tenantQuery(tenantId, `
    SELECT
      m.*,
      COUNT(DISTINCT a.id) FILTER (
        WHERE a.start_date <= CURRENT_DATE
          AND (a.end_date IS NULL OR a.end_date >= CURRENT_DATE)
      )::int                                                  AS active_projects,
      COALESCE(SUM(a.allocation_pct) FILTER (
        WHERE a.start_date <= CURRENT_DATE
          AND (a.end_date IS NULL OR a.end_date >= CURRENT_DATE)
      ), 0)::int                                              AS total_allocation
    FROM team_members m
    LEFT JOIN project_assignments a ON a.member_id = m.id AND a.tenant_id = m.tenant_id
      ${scope.sql.replace(/\$SCOPE_USER/g, `$${idx}`)}
    WHERE ${conditions.join(' AND ')}
    GROUP BY m.id
    ORDER BY m.last_name ASC, m.first_name ASC
  `, [...params, ...scope.params])
  return res.rows.map(r => rowToMember(r as Record<string, unknown>))
}

/**
 * ADR-014 Phase 3G §4/§22. The member is NOT hidden because they work on a
 * project the caller cannot reach — the outer record keeps its own `team.view`
 * authority. The scope predicate goes on the LEFT JOIN, so unauthorized
 * assignments simply fail to join and `active_projects` / `total_allocation`
 * describe only what the caller may see (§7). Jane stays visible; Jane's
 * Project-B allocation does not.
 */
export async function getMember(
  tenantId: string,
  id:       string,
  scope:    AssignmentScope = NO_SCOPE,
): Promise<TeamMember | null> {
  const res = await tenantQuery(tenantId, `
    SELECT
      m.*,
      COUNT(DISTINCT a.id) FILTER (
        WHERE a.start_date <= CURRENT_DATE
          AND (a.end_date IS NULL OR a.end_date >= CURRENT_DATE)
      )::int AS active_projects,
      COALESCE(SUM(a.allocation_pct) FILTER (
        WHERE a.start_date <= CURRENT_DATE
          AND (a.end_date IS NULL OR a.end_date >= CURRENT_DATE)
      ), 0)::int AS total_allocation
    FROM team_members m
    LEFT JOIN project_assignments a ON a.member_id = m.id AND a.tenant_id = m.tenant_id
      ${scope.sql.replace(/\$SCOPE_USER/g, '$3')}
    WHERE m.tenant_id = $1 AND m.id = $2
    GROUP BY m.id
  `, [tenantId, id, ...scope.params])
  return res.rows.length ? rowToMember(res.rows[0] as Record<string, unknown>) : null
}

export async function updateMember(
  tenantId: string,
  id:       string,
  patch:    Partial<CreateMemberInput & { status: MemberStatus }>,
): Promise<TeamMember | null> {
  const res = await tenantQuery(tenantId, `
    UPDATE team_members SET
      first_name  = COALESCE($3, first_name),
      last_name   = COALESCE($4, last_name),
      email       = COALESCE($5, email),
      phone       = COALESCE($6, phone),
      role        = COALESCE($7, role),
      trade       = COALESCE($8, trade),
      hourly_rate = COALESCE($9, hourly_rate),
      status      = COALESCE($10::member_status, status),
      notes       = COALESCE($11, notes),
      updated_at  = NOW()
    WHERE tenant_id = $1 AND id = $2
    RETURNING *
  `, [tenantId, id,
      patch.firstName  ?? null, patch.lastName   ?? null,
      patch.email      ?? null, patch.phone      ?? null,
      patch.role       ?? null, patch.trade      ?? null,
      patch.hourlyRate ?? null,
      patch.status     ?? null, patch.notes      ?? null])
  return res.rows.length ? rowToMember(res.rows[0] as Record<string, unknown>) : null
}

// ─── Assignments ──────────────────────────────────────────────────────────────

export interface CreateAssignmentInput {
  memberId:       string
  projectId:      string
  assignmentRole: AssignmentRole
  allocationPct?: number
  startDate:      string
  endDate?:       string
  notes?:         string
}

export async function createAssignment(
  tenantId: string,
  input:    CreateAssignmentInput,
): Promise<ProjectAssignment> {
  const res = await tenantQuery(tenantId, `
    INSERT INTO project_assignments
      (tenant_id, member_id, project_id, assignment_role, allocation_pct, start_date, end_date, notes)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT (tenant_id, member_id, project_id, start_date)
    DO UPDATE SET
      assignment_role = EXCLUDED.assignment_role,
      allocation_pct  = EXCLUDED.allocation_pct,
      end_date        = EXCLUDED.end_date,
      notes           = EXCLUDED.notes
    RETURNING *
  `, [tenantId, input.memberId, input.projectId, input.assignmentRole,
      input.allocationPct ?? 100, input.startDate,
      input.endDate ?? null, input.notes ?? null])
  return rowToAssignment(res.rows[0] as Record<string, unknown>)
}

/**
 * ADR-014 Phase 3G §5. The path id addresses a `team_members` row, which has no
 * project parent — so `requireRecordScope('team_members')` would be a false
 * guard (§9). The ROWS are what carry a project, and they are filtered here.
 */
export async function listAssignmentsByMember(
  tenantId: string,
  memberId: string,
  scope:    AssignmentScope = NO_SCOPE,
): Promise<ProjectAssignment[]> {
  const res = await tenantQuery(tenantId, `
    SELECT a.*, p.name AS project_name
    FROM   project_assignments a
    JOIN   projects p ON p.id = a.project_id AND p.tenant_id = a.tenant_id
    WHERE  a.tenant_id = $1 AND a.member_id = $2
    ${scope.sql.replace(/\$SCOPE_USER/g, '$3')}
    ORDER  BY a.start_date DESC
  `, [tenantId, memberId, ...scope.params])
  return res.rows.map(r => rowToAssignment(r as Record<string, unknown>))
}

export async function listAssignmentsByProject(
  tenantId:  string,
  projectId: string,
): Promise<ProjectAssignment[]> {
  const res = await tenantQuery(tenantId, `
    SELECT
      a.*,
      m.first_name AS member_first_name,
      m.last_name  AS member_last_name,
      m.role       AS member_role
    FROM   project_assignments a
    JOIN   team_members m ON m.id = a.member_id AND m.tenant_id = a.tenant_id
    WHERE  a.tenant_id = $1 AND a.project_id = $2
    ORDER  BY a.start_date DESC
  `, [tenantId, projectId])
  return res.rows.map(r => rowToAssignment(r as Record<string, unknown>))
}

export async function endAssignment(tenantId: string, assignmentId: string): Promise<boolean> {
  const res = await tenantQuery(tenantId, `
    UPDATE project_assignments SET end_date = CURRENT_DATE
    WHERE tenant_id = $1 AND id = $2 AND (end_date IS NULL OR end_date > CURRENT_DATE)
  `, [tenantId, assignmentId])
  return (res.rowCount ?? 0) > 0
}

// ─── Summary ──────────────────────────────────────────────────────────────────

export async function getTeamSummary(tenantId: string): Promise<TeamSummary> {
  const statusRes = await tenantQuery(tenantId, `
    SELECT status, COUNT(*)::int AS cnt FROM team_members
    WHERE tenant_id = $1 GROUP BY status
  `, [tenantId])

  const byStatus: Record<string, number> = {}
  for (const row of statusRes.rows as Record<string, unknown>[]) {
    byStatus[row['status'] as string] = Number(row['cnt'])
  }

  const roleRes = await tenantQuery(tenantId, `
    SELECT role, COUNT(*)::int AS cnt FROM team_members
    WHERE tenant_id = $1 AND status = 'active' GROUP BY role ORDER BY cnt DESC
  `, [tenantId])

  const byRole: Record<string, number> = {}
  for (const row of roleRes.rows as Record<string, unknown>[]) {
    byRole[row['role'] as string] = Number(row['cnt'])
  }

  const allocRes = await tenantQuery(tenantId, `
    SELECT AVG(sub.total_alloc)::numeric(6,1) AS avg_alloc
    FROM (
      SELECT m.id, COALESCE(SUM(a.allocation_pct), 0) AS total_alloc
      FROM   team_members m
      LEFT JOIN project_assignments a
        ON a.member_id = m.id AND a.tenant_id = m.tenant_id
        AND a.start_date <= CURRENT_DATE
        AND (a.end_date IS NULL OR a.end_date >= CURRENT_DATE)
      WHERE m.tenant_id = $1 AND m.status = 'active'
      GROUP BY m.id
    ) sub
  `, [tenantId])

  return {
    totalActive:   byStatus['active']   ?? 0,
    totalInactive: byStatus['inactive'] ?? 0,
    onLeave:       byStatus['on_leave'] ?? 0,
    byRole,
    avgAllocation: Number(allocRes.rows[0]?.['avg_alloc'] ?? 0),
  }
}
