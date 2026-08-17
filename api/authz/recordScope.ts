/**
 * Denver Engineering — record-scope authorization (ADR-014 Phase 3A)
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 2 answered "may this principal use this API function?". This module
 * answers the independent second question:
 *
 *     MAY THIS PRINCIPAL ACCESS THIS SPECIFIC RECORD?
 *
 * The two are conjunctive and neither implies the other. `project.view` means
 * "may perform project-read functions"; it does NOT mean "may read every
 * project in the tenant". A project manager holding `project.write` still has
 * no access to an unrelated project.
 *
 * ─── The canonical project-scope relationship ────────────────────────────────
 *
 * A non-Owner reaches a project only through a responsible-user assignment
 * recorded ON THE PROJECT ROW ITSELF:
 *
 *     projects.project_manager  → users(id)
 *     projects.lead_engineer    → users(id)
 *     projects.created_by       → users(id)
 *
 * These are real foreign keys to the login principal table, written by the
 * project write routes and read back by `projects.ts` today. They are the only
 * authoritative user↔project relationship the repository contains.
 *
 * `project_assignments` was considered and REJECTED: its `member_id` references
 * `team_members`, an HR/workforce roster (first/last name, phone, trade,
 * hourly_rate) with no `user_id` column and no authoritative bridge to a login
 * principal. Joining it to `users` on email would be inventing a relationship,
 * not finding one. See `recordScopePolicies.ts` for the full evidence table.
 *
 * ─── Owner is tenant-bounded, not global ─────────────────────────────────────
 *
 * An Owner reaches every project inside their own tenant and none outside it.
 * Every query below is tenant-scoped through `tenantQuery`, so the tenant
 * predicate applies to the Owner exactly as it does to everyone else.
 *
 * ─── Live authority only ─────────────────────────────────────────────────────
 *
 * Scope is resolved from current database state on every request. Nothing here
 * reads a project list from the JWT, the request body, the query string, or a
 * cache. Revoking a membership therefore takes effect on the next request,
 * without waiting for a token to expire.
 */
import { tenantQuery } from '../db/pool'
import type { CurrentUser } from './currentUser'

/**
 * What a principal may reach.
 *
 * `ALL_IN_TENANT` is not "global": the caller still only ever sees rows the
 * tenant-scoped query returns.
 */
export type ProjectScope =
  | { kind: 'ALL_IN_TENANT' }
  | { kind: 'PROJECT_SET'; projectIds: ReadonlySet<string> }

/** The role that reaches every project in its own tenant. */
const TENANT_WIDE_ROLE = 'owner'

/**
 * Project ids are `uuid` columns. A malformed id cannot match one, and passing
 * it to `= ANY($1::uuid[])` would raise rather than return no rows — so it is
 * filtered out here and treated as inaccessible. Fail closed, never throw.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const isProjectId = (v: unknown): v is string => typeof v === 'string' && UUID.test(v)

/**
 * The accessible subset of `projectIds`, in ONE database round-trip regardless
 * of how many ids are supplied.
 *
 * Batched deliberately: `/related` can surface up to a hundred targets, and a
 * per-record authorization query would make an N+1 of the authorization layer
 * itself. Every caller below funnels through this function.
 */
export async function filterAccessibleProjectIds(
  principal: CurrentUser,
  projectIds: readonly string[],
): Promise<ReadonlySet<string>> {
  const candidates = [...new Set(projectIds.filter(isProjectId))]
  if (candidates.length === 0) return new Set()

  const isTenantWide = principal.role === TENANT_WIDE_ROLE

  // The tenant predicate is present on BOTH branches. An Owner is tenant-wide,
  // not global — a project in another tenant is not reachable by anyone.
  const sql = isTenantWide
    ? `SELECT id FROM projects
        WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
          AND id = ANY($1::uuid[])`
    : `SELECT id FROM projects
        WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
          AND id = ANY($1::uuid[])
          AND (project_manager = $2 OR lead_engineer = $2 OR created_by = $2)`

  const params: unknown[] = isTenantWide ? [candidates] : [candidates, principal.id]

  try {
    const res = await tenantQuery<{ id: string }>(principal.tenantId, sql, params)
    return new Set(res.rows.map(r => r.id))
  } catch {
    // A failed lookup must never become an implicit grant — the same rule
    // `resolveCurrentUser` applies to principal resolution.
    return new Set()
  }
}

/** Whether one project is reachable. Thin wrapper so there is one implementation. */
export async function canAccessProject(
  principal: CurrentUser,
  projectId: string,
): Promise<boolean> {
  if (!isProjectId(projectId)) return false
  return (await filterAccessibleProjectIds(principal, [projectId])).has(projectId)
}

/**
 * The principal's scope, for callers that need the shape rather than a decision.
 *
 * The `PROJECT_SET` branch is deliberately NOT used to build an `IN (…)` filter
 * for collection endpoints in Phase 3A — collection filtering is a later slice.
 * It exists so a caller can report scope truthfully without re-deriving it.
 */
export async function resolveProjectScope(principal: CurrentUser): Promise<ProjectScope> {
  if (principal.role === TENANT_WIDE_ROLE) return { kind: 'ALL_IN_TENANT' }
  try {
    const res = await tenantQuery<{ id: string }>(
      principal.tenantId,
      `SELECT id FROM projects
        WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
          AND (project_manager = $1 OR lead_engineer = $1 OR created_by = $1)`,
      [principal.id],
    )
    return { kind: 'PROJECT_SET', projectIds: new Set(res.rows.map(r => r.id)) }
  } catch {
    return { kind: 'PROJECT_SET', projectIds: new Set() }
  }
}

/**
 * Parent-project scope for records that hang off a project.
 *
 * A record with a NULL `project_id` has no parent to inherit from and is
 * therefore NOT reachable by this strategy. That is deliberate: defaulting an
 * unparented record to tenant-wide visibility is exactly the widening Phase 3
 * exists to remove.
 */
export async function filterByParentProject<T>(
  principal: CurrentUser,
  items: readonly T[],
  projectIdOf: (item: T) => string | null | undefined,
): Promise<T[]> {
  const ids = items.map(projectIdOf).filter(isProjectId)
  const allowed = await filterAccessibleProjectIds(principal, ids)
  return items.filter(i => {
    const pid = projectIdOf(i)
    return isProjectId(pid) && allowed.has(pid)
  })
}
