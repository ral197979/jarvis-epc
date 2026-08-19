/**
 * Denver Engineering — project membership (ADR-014 Phase 3B)
 * ─────────────────────────────────────────────────────────────────────────────
 * The write side of the record-scope model. `api/authz/recordScope.ts` reads
 * `project_members` to decide who may reach a project; this module is the only
 * place that decides who is IN it.
 *
 * Two kinds of membership, and the distinction is load-bearing:
 *
 *   SYSTEM   `created_by`, `project_manager`, `lead_engineer` mirror columns on
 *            the project row. They are written only by the project workflows
 *            that own those columns, transactionally with the column change, so
 *            the two can never disagree. A caller can never ask for one.
 *
 *   MANUAL   `manual` is the only source the membership API can grant. It is
 *            what makes ordinary participation expressible at all — the three
 *            system sources cover at most three principals per project.
 *
 * Sources are ADDITIVE. Reassigning the project manager closes the outgoing
 * user's `project_manager` row and opens one for the incoming user; it does not
 * touch any other source that user holds. Someone who created the project AND
 * was manually added keeps access when they stop being its manager — which is
 * the entire reason provenance is modelled rather than a boolean.
 */
import type { PoolClient } from 'pg'
import { tenantQuery } from '../../db/pool'

/** The four reasons a membership can exist. Mirrors the `project_member_source` enum. */
export type MembershipSource = 'created_by' | 'project_manager' | 'lead_engineer' | 'manual'

/**
 * Sources the SYSTEM maintains from the project row. A caller may never name
 * one: doing so would let a manual grant masquerade as a system assignment and
 * survive the reassignment logic that is supposed to close it.
 */
export const SYSTEM_SOURCES: readonly MembershipSource[] = ['created_by', 'project_manager', 'lead_engineer']

/** The only source the membership administration API may create (§16). */
export const MANUAL_SOURCE: MembershipSource = 'manual'

export const isSystemSource = (s: string): boolean =>
  (SYSTEM_SOURCES as readonly string[]).includes(s)

/**
 * Open a membership, or leave an already-open one alone.
 *
 * `ON CONFLICT DO NOTHING` against the partial unique index means re-granting an
 * already-active source is a no-op rather than an error — assignment workflows
 * that set the same manager twice must not fail.
 */
export async function openMembership(
  client: PoolClient,
  input: { tenantId: string; projectId: string; userId: string; source: MembershipSource; grantedBy: string | null },
): Promise<void> {
  await client.query(
    `INSERT INTO project_members (tenant_id, project_id, user_id, source, created_by)
     VALUES ($1, $2, $3, $4::project_member_source, $5)
     ON CONFLICT DO NOTHING`,
    [input.tenantId, input.projectId, input.userId, input.source, input.grantedBy],
  )
}

/**
 * Close every active row for one (project, user, source).
 *
 * Closes rather than deletes: the historical fact that access existed is
 * authorization evidence and outlives the revocation.
 */
export async function closeMembership(
  client: PoolClient,
  input: { tenantId: string; projectId: string; userId: string; source: MembershipSource },
): Promise<number> {
  const res = await client.query(
    `UPDATE project_members
        SET active_to = NOW(), updated_at = NOW()
      WHERE tenant_id  = $1
        AND project_id = $2
        AND user_id    = $3
        AND source     = $4::project_member_source
        AND active_to IS NULL`,
    [input.tenantId, input.projectId, input.userId, input.source],
  )
  return res.rowCount ?? 0
}

/**
 * Move a system source from one user to another, transactionally.
 *
 * Called when `projects.project_manager` or `projects.lead_engineer` changes.
 * The outgoing user loses ONLY this source; anything else they hold — a
 * `manual` grant, `created_by`, the other system role — is untouched, so their
 * access survives if it rests on another reason (§19).
 *
 * A no-op when the column did not actually change, so an unrelated PATCH does
 * not churn membership rows.
 */
export async function syncSystemSource(
  client: PoolClient,
  input: {
    tenantId: string; projectId: string; source: MembershipSource
    previousUserId: string | null; nextUserId: string | null; grantedBy: string | null
  },
): Promise<{ closed: number; opened: number }> {
  const { tenantId, projectId, source, previousUserId, nextUserId, grantedBy } = input
  if (previousUserId === nextUserId) return { closed: 0, opened: 0 }

  let closed = 0
  if (previousUserId) {
    closed = await closeMembership(client, { tenantId, projectId, userId: previousUserId, source })
  }
  let opened = 0
  if (nextUserId) {
    await openMembership(client, { tenantId, projectId, userId: nextUserId, source, grantedBy })
    opened = 1
  }
  return { closed, opened }
}

/**
 * Open every system membership a newly created project implies (§17).
 *
 * Runs inside the same transaction as the INSERT, so a project whose creator
 * could not be made a member is not created at all. The alternative — a project
 * its own creator cannot read — is precisely the dead end Phase 3A produced.
 */
export async function syncMembershipsForNewProject(
  client: PoolClient,
  input: {
    tenantId: string; projectId: string
    createdBy: string | null; projectManager: string | null; leadEngineer: string | null
  },
): Promise<void> {
  const { tenantId, projectId, createdBy, projectManager, leadEngineer } = input
  const pairs: Array<[MembershipSource, string | null]> = [
    ['created_by', createdBy],
    ['project_manager', projectManager],
    ['lead_engineer', leadEngineer],
  ]
  for (const [source, userId] of pairs) {
    if (userId) await openMembership(client, { tenantId, projectId, userId, source, grantedBy: createdBy })
  }
}

// ─── Roster reads ─────────────────────────────────────────────────────────────

export interface ProjectMemberRow {
  userId:      string
  displayName: string | null
  email:       string | null
  /** Every active reason this user is a member, so the UI can explain access. */
  sources:     MembershipSource[]
}

/**
 * Who is currently on a project.
 *
 * Deliberately narrow (§14): identity and the reasons for membership, and
 * nothing else. No HR data, no platform role, no tenant-wide user directory —
 * only users who are actually members of THIS project appear.
 */
export async function listProjectMembers(tenantId: string, projectId: string): Promise<ProjectMemberRow[]> {
  const res = await tenantQuery<{ user_id: string; display_name: string | null; email: string | null; sources: string[] }>(
    tenantId,
    `SELECT m.user_id,
            u.display_name,
            u.email,
            ARRAY_AGG(m.source::text ORDER BY m.source::text) AS sources
       FROM project_members m
       JOIN users u ON u.id = m.user_id AND u.tenant_id = m.tenant_id
      WHERE m.tenant_id  = current_setting('app.current_tenant_id', true)::uuid
        AND m.project_id = $1
        AND m.active_from <= NOW()
        AND (m.active_to IS NULL OR m.active_to > NOW())
      GROUP BY m.user_id, u.display_name, u.email
      ORDER BY u.display_name NULLS LAST, m.user_id`,
    [projectId],
  )
  return res.rows.map(r => ({
    userId: r.user_id,
    displayName: r.display_name,
    email: r.email,
    sources: (r.sources ?? []) as MembershipSource[],
  }))
}

/**
 * A prospective member, validated against the CALLER's tenant.
 *
 * `null` for a user that does not exist, is inactive, or belongs to another
 * tenant — all three refuse before any write (§15). The tenant predicate is in
 * the query rather than compared afterwards, so a foreign user is simply not
 * found rather than found and then rejected.
 */
export async function findGrantableUser(
  tenantId: string,
  userId: string,
): Promise<{ id: string; isActive: boolean } | null> {
  const res = await tenantQuery<{ id: string; is_active: boolean }>(
    tenantId,
    `SELECT id, is_active FROM users
      WHERE id = $1
        AND tenant_id = current_setting('app.current_tenant_id', true)::uuid
      LIMIT 1`,
    [userId],
  )
  const row = res.rows[0]
  if (!row) return null
  return { id: row.id, isActive: row.is_active }
}
