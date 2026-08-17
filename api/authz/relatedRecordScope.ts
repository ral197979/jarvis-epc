/**
 * Denver Engineering — record scope for the related-records aggregator
 * ─────────────────────────────────────────────────────────────────────────────
 * ADR-014 Phase 3A §18–§25.
 *
 * `/related/:source/:id` is not one domain. It spans rfi, submittal, drawing,
 * inspection, punch, ncr, capa, changeorder and action, and one response can
 * mix construction, engineering, quality, commercial and personal records. That
 * is exactly why Phase 2 deferred it: no single capability is both safe and
 * useful across that set.
 *
 * Two independent authorizations are therefore required, and neither implies
 * the other:
 *
 *   1. THE SOURCE. The caller must be able to read the record they are asking
 *      about. Otherwise `/related` becomes a way to probe records you cannot
 *      open directly — the relationships of a record are information about it.
 *
 *   2. EVERY TARGET. Access to the source says nothing about the targets. A
 *      caller who may read an RFI under `construction.view` must not receive
 *      the change order it produced, because that is `cost.view` data, and must
 *      not receive a target hanging off a project they are not scoped to.
 *
 * Filtering happens BEFORE the response is assembled, so an unauthorized target
 * contributes nothing at all — not its id, type, title, status or identifier,
 * and not a slot in any count.
 */
import { tenantQuery } from '../db/pool'
import type { CurrentUser } from './currentUser'
import { roleHasCapability } from './capabilities'
import { filterAccessibleProjectIds, isProjectId } from './recordScope'
import { policyFor, type RecordScopePolicy } from './recordScopePolicies'

/** Where each `/related` resource type keeps its rows. Mirrors the policy registry. */
const TABLE_OF: Record<string, string> = {
  rfi: 'rfis', submittal: 'submittals', changeorder: 'change_orders',
  ncr: 'ncrs', capa: 'corrective_actions', punch: 'punch_items',
  drawing: 'drawings', inspection: 'inspections', action: 'actions',
}

/** Table names are looked up from the map above, never interpolated from input. */
function tableFor(resource: string): string | null {
  return Object.prototype.hasOwnProperty.call(TABLE_OF, resource) ? TABLE_OF[resource]! : null
}

export interface SourceAuthorization {
  ok: boolean
  /** The parent project of the source record, when it has one. */
  projectId: string | null
  /** Why it was refused — for logging and tests, never for the response body. */
  reason?: 'UNKNOWN_TYPE' | 'NO_POLICY' | 'MISSING_CAPABILITY' | 'NOT_FOUND' | 'OUT_OF_SCOPE'
}

/**
 * Whether the caller may read the record `/related` was asked about.
 *
 * Fails closed on an unknown type and on a type with no policy — a `/related`
 * source added without a `recordScopePolicies` entry is refused, not admitted.
 */
export async function authorizeSource(
  principal: CurrentUser,
  resource: string,
  id: string,
): Promise<SourceAuthorization> {
  const policy = policyFor(resource)
  if (!policy) return { ok: false, projectId: null, reason: 'NO_POLICY' }

  const table = tableFor(resource)
  if (!table) return { ok: false, projectId: null, reason: 'UNKNOWN_TYPE' }

  // Functional authority first: cheapest check, and a caller without it has no
  // business causing a lookup of the record at all.
  if (!hasAllCapabilities(principal, policy)) {
    return { ok: false, projectId: null, reason: 'MISSING_CAPABILITY' }
  }

  const row = await loadScopeRow(principal, table, id)
  if (!row) return { ok: false, projectId: null, reason: 'NOT_FOUND' }

  if (policy.strategy === 'SELF') {
    return ownsSelfScopedRecord(principal, row)
      ? { ok: true, projectId: row.project_id ?? null }
      : { ok: false, projectId: null, reason: 'OUT_OF_SCOPE' }
  }

  // PARENT_PROJECT: an unparented record has nothing to inherit from, so it is
  // out of scope rather than tenant-wide.
  if (!isProjectId(row.project_id)) return { ok: false, projectId: null, reason: 'OUT_OF_SCOPE' }
  const allowed = await filterAccessibleProjectIds(principal, [row.project_id])
  return allowed.has(row.project_id)
    ? { ok: true, projectId: row.project_id }
    : { ok: false, projectId: null, reason: 'OUT_OF_SCOPE' }
}

interface ScopeRow { project_id: string | null; assigned_to_user_id: string | null }

/**
 * The scope-bearing columns of one record, tenant-scoped.
 *
 * `actions` is the only Phase 3A resource with an owner column, so it is the
 * only one asked for it; selecting a non-existent column elsewhere would throw.
 */
async function loadScopeRow(principal: CurrentUser, table: string, id: string): Promise<ScopeRow | null> {
  const owner = table === 'actions' ? 'assigned_to_user_id' : 'NULL::uuid AS assigned_to_user_id'
  try {
    const res = await tenantQuery<ScopeRow>(
      principal.tenantId,
      `SELECT project_id, ${owner} FROM ${table}
        WHERE id = $1
          AND tenant_id = current_setting('app.current_tenant_id', true)::uuid
        LIMIT 1`,
      [id],
    )
    return res.rows[0] ?? null
  } catch {
    return null   // malformed id or missing column — never an implicit grant
  }
}

function hasAllCapabilities(principal: CurrentUser, policy: RecordScopePolicy): boolean {
  return policy.capabilities.every(c => roleHasCapability(principal.role, c))
}

/**
 * ADR-014 Phase 2C-4A's Personal Inbox rule, reused verbatim: the assignee owns
 * the action, and `personal.admin` is the tenant-wide authority over all of them.
 */
function ownsSelfScopedRecord(principal: CurrentUser, row: ScopeRow): boolean {
  if (roleHasCapability(principal.role, 'personal.admin')) return true
  return row.assigned_to_user_id != null && row.assigned_to_user_id === principal.id
}

/** The minimum a related item must expose for authorization to be decidable. */
export interface ScopedRelatedItem {
  source:    string
  sourceId:  string
  projectId: string | null
}

/**
 * The subset of related targets the caller may actually receive.
 *
 * Batched: the distinct parent projects across every target are resolved in a
 * single query, so a response with a hundred targets costs one authorization
 * round-trip rather than a hundred. Self-scoped targets need no extra query at
 * all — their owner travels with them.
 */
export async function filterAuthorizedTargets<T extends ScopedRelatedItem>(
  principal: CurrentUser,
  items: readonly T[],
  ownerOf: (item: T) => string | null,
): Promise<T[]> {
  if (items.length === 0) return []

  // Capability first — it removes whole domains without touching the database.
  const capabilityPassed = items.filter(i => {
    const policy = policyFor(i.source)
    return policy != null && hasAllCapabilities(principal, policy)
  })
  if (capabilityPassed.length === 0) return []

  const needsProject = capabilityPassed.filter(i => policyFor(i.source)!.strategy === 'PARENT_PROJECT')
  const allowedProjects = await filterAccessibleProjectIds(
    principal,
    needsProject.map(i => i.projectId).filter(isProjectId),
  )

  return capabilityPassed.filter(i => {
    const policy = policyFor(i.source)!
    if (policy.strategy === 'SELF') {
      if (roleHasCapability(principal.role, 'personal.admin')) return true
      const owner = ownerOf(i)
      return owner != null && owner === principal.id
    }
    return isProjectId(i.projectId) && allowedProjects.has(i.projectId)
  })
}
