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
 * A non-Owner reaches a project through an ACTIVE row in `project_members`:
 *
 *     project_members (tenant_id, project_id, user_id, source, active_from, active_to)
 *
 * ADR-014 Phase 3B replaced the previous rule, which read three columns on the
 * project row itself — `project_manager`, `lead_engineer`, `created_by`. That
 * rule was correct enforcement on an insufficient model: it could express at
 * most three principals per project, so every other legitimate participant was
 * refused. Those columns remain truthful BUSINESS fields and are still written
 * and displayed; they are simply no longer the authorization source. The
 * project write workflows keep a corresponding membership row in step
 * transactionally, and migration 086 backfilled every historical link, so there
 * is ONE runtime authorization truth rather than two (§21).
 *
 * Membership is additive by SOURCE. A user who both created a project and is
 * its lead engineer holds two rows, and revoking one leaves the other standing.
 * Access requires at least one active source; it does not require any
 * particular one.
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
import type { RequestHandler } from 'express'
import { tenantQuery } from '../db/pool'
import { resolveCurrentUser, type CurrentUser, type AuthorizedRequest } from './currentUser'
import { roleHasCapability } from './capabilities'
import { policyFor, type ProjectDerivation } from './recordScopePolicies'

/**
 * What a principal may reach.
 *
 * `ALL_IN_TENANT` is not "global": the caller still only ever sees rows the
 * tenant-scoped query returns.
 */
export type ProjectScope =
  | { kind: 'ALL_IN_TENANT' }
  | { kind: 'PROJECT_SET'; projectIds: ReadonlySet<string> }

/**
 * The authority that reaches every project in its own tenant.
 *
 * A CAPABILITY, not a role name. `project.list.all` is the explicit authority
 * to see the whole tenant portfolio (owner-only today), so keying on it keeps
 * the authorization layer free of hard-coded role special cases and states the
 * reason rather than the holder. It is still tenant-BOUNDED: every query below
 * carries the tenant predicate on both branches.
 */
const TENANT_WIDE_CAPABILITY = 'project.list.all'

const reachesWholeTenant = (principal: CurrentUser): boolean =>
  roleHasCapability(principal.role, TENANT_WIDE_CAPABILITY)

/**
 * Project ids are `uuid` columns. A malformed id cannot match one, and passing
 * it to `= ANY($1::uuid[])` would raise rather than return no rows — so it is
 * filtered out here and treated as inaccessible. Fail closed, never throw.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The active-membership test, with ONE definition of what "active" means.
 *
 * Correlated against `p` (the projects row) so the membership tenant and the
 * project tenant must agree at query time as well as at write time, and
 * parameterised by position because the two callers below number their
 * arguments differently.
 */
const activeMembershipExists = (userParam: string): string => `
          EXISTS (
                SELECT 1 FROM project_members m
                 WHERE m.project_id = p.id
                   AND m.user_id    = ${userParam}
                   AND m.tenant_id  = p.tenant_id
                   AND m.active_from <= NOW()
                   AND (m.active_to IS NULL OR m.active_to > NOW()))`

export const isProjectId = (v: unknown): v is string => typeof v === 'string' && UUID.test(v)

/**
 * The record-scope predicate for a COLLECTION query, as a SQL fragment.
 *
 * Collections cannot use `filterAccessibleProjectIds`: filtering after the fact
 * would mean loading rows the caller may not see, and would make `COUNT(*)`,
 * `LIMIT` and `OFFSET` describe the wrong set. So the same membership rule is
 * expressed as a predicate the query applies itself — one definition of
 * "active member", shared with the batched resolver above.
 *
 * Returns `''` for a tenant-wide principal, whose scope is already the tenant
 * predicate the caller's query carries.
 *
 * The fragment correlates on `p`, so the query MUST alias `projects` as `p`.
 * `userParam` is the caller-chosen placeholder for the principal id; the value
 * is bound by the caller, never interpolated here.
 */
export function projectScopeSql(principal: CurrentUser, userParam: string): string {
  if (reachesWholeTenant(principal)) return ''
  return `AND ${activeMembershipExists(userParam)}`
}

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

  const isTenantWide = reachesWholeTenant(principal)

  // The tenant predicate is present on BOTH branches. An Owner is tenant-wide,
  // not global — a project in another tenant is not reachable by anyone.
  const sql = isTenantWide
    ? `SELECT id FROM projects
        WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
          AND id = ANY($1::uuid[])`
    : `SELECT p.id FROM projects p
        WHERE p.tenant_id = current_setting('app.current_tenant_id', true)::uuid
          AND p.id = ANY($1::uuid[])
          AND ${activeMembershipExists('$2')}`

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
  if (reachesWholeTenant(principal)) return { kind: 'ALL_IN_TENANT' }
  try {
    const res = await tenantQuery<{ id: string }>(
      principal.tenantId,
      `SELECT p.id FROM projects p
        WHERE p.tenant_id = current_setting('app.current_tenant_id', true)::uuid
          AND ${activeMembershipExists('$1')}`,
      [principal.id],
    )
    return { kind: 'PROJECT_SET', projectIds: new Set(res.rows.map(r => r.id)) }
  } catch {
    return { kind: 'PROJECT_SET', projectIds: new Set() }
  }
}

/**
 * Express guard for a route whose PATH carries the project it operates on.
 *
 * ADR-014 Phase 3B. Roughly fifty project-child collections share one shape —
 * `/projects/:projectId/<something>` — and for all of them record scope is the
 * same question: may this caller reach that project? Expressing it once, as a
 * guard, keeps the rule in the canonical resolver instead of scattering
 * membership SQL through fifty handlers.
 *
 * Ordering matters. This runs AFTER the route's functional capability guard, so
 * a caller lacking the domain capability is refused 403 on the functional
 * dimension and never causes a scope lookup; a caller holding it but not
 * scoped to the project gets 404, the same answer as a project that does not
 * exist.
 *
 * The project id is read from the route parameter — never from the body, the
 * query string, or a header.
 */
export function requireProjectScope(param = 'projectId'): RequestHandler {
  return async (req, res, next): Promise<void> => {
    const projectId = (req.params as Record<string, string | undefined>)[param]
    const principal = await resolveCurrentUser(req as AuthorizedRequest)
    if (!principal) { res.status(401).json({ error: 'unauthenticated' }); return }

    if (!projectId || !await canAccessProject(principal, projectId)) {
      res.status(404).json({ error: 'not_found', message: 'Project not found.' })
      return
    }
    next()
  }
}

/**
 * Resolve ONE record's parent project id, or `null` when it has none.
 *
 * The SQL is composed from `recordScopePolicies.ts` alone — table and column
 * names come from the registry, the record id is always bound as a parameter —
 * so there is no path by which a request value reaches the statement text.
 *
 * Deliberately narrow: it selects the parent key and nothing else. ADR-014
 * Phase 3C §20 requires the scope decision to be made before the payload is
 * loaded, so this must not be tempted into fetching the row the handler wants.
 */
export async function resolveParentProjectId(
  principal: CurrentUser,
  derivation: ProjectDerivation,
  recordId: string,
): Promise<string | null> {
  if (!isProjectId(recordId)) return null

  const sql = derivation.kind === 'DIRECT_COLUMN'
    ? `SELECT r.${derivation.projectColumn} AS project_id
         FROM ${derivation.table} r
        WHERE r.${derivation.idColumn} = $1
          AND r.${derivation.tenantColumn} = current_setting('app.current_tenant_id', true)::uuid`
    : `SELECT p.${derivation.parentProjectColumn} AS project_id
         FROM ${derivation.table} r
         JOIN ${derivation.parentTable} p ON p.${derivation.parentIdColumn} = r.${derivation.via}
        WHERE r.${derivation.idColumn} = $1
          AND r.${derivation.tenantColumn} = current_setting('app.current_tenant_id', true)::uuid`

  try {
    const res = await tenantQuery<{ project_id: string | null }>(principal.tenantId, sql, [recordId])
    return res.rows[0]?.project_id ?? null
  } catch {
    // A failed lookup is not an implicit grant, exactly as in
    // `filterAccessibleProjectIds`.
    return null
  }
}

/**
 * Express guard for a route whose path carries only the RECORD id.
 *
 * ADR-014 Phase 3C. This is the guard that closes the bypass Phase 3B left
 * open: holding the domain capability and knowing a record's UUID was, by
 * itself, enough to read or change it, because nothing ever asked which project
 * the record belonged to.
 *
 * Ordering mirrors `requireProjectScope`, and for the same reasons:
 *
 *   401  no live principal
 *   403  the route's own capability guard already refused (this never runs)
 *   404  record absent, unparented, or in a project the caller cannot reach
 *
 * The three 404 cases are deliberately indistinguishable. A caller who may not
 * reach a record learns only that it is not there, so the endpoint cannot be
 * used to confirm that a given UUID exists.
 *
 * A record whose parent is NULL is refused rather than allowed. An unparented
 * row has no project to inherit authority from, and defaulting it to tenant-wide
 * is precisely the widening Phase 3 exists to remove.
 *
 * Because this is middleware it runs BEFORE the handler, so a refusal happens
 * before any payload query, any write, and any side effect (§20, §34).
 */
export function requireRecordScope(resource: string, param = 'id'): RequestHandler {
  return async (req, res, next): Promise<void> => {
    const policy = policyFor(resource)
    const notFound = (): void => { res.status(404).json({ error: 'not_found' }) }

    // An unregistered resource fails closed. There is no permissive default:
    // adding a direct-ID route without a policy denies rather than inherits
    // tenant-wide reach.
    if (!policy?.derivation) { notFound(); return }

    const principal = await resolveCurrentUser(req as AuthorizedRequest)
    if (!principal) { res.status(401).json({ error: 'unauthenticated' }); return }

    const recordId = (req.params as Record<string, string | undefined>)[param]
    if (!recordId) { notFound(); return }

    const projectId = await resolveParentProjectId(principal, policy.derivation, recordId)
    if (!projectId || !await canAccessProject(principal, projectId)) { notFound(); return }

    next()
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
