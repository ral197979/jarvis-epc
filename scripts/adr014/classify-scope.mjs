#!/usr/bin/env node
/**
 * ADR-014 — project-scope classification (HOB §5 mutation inventory, §9
 * direct-ID read inventory, §41 adoption registry shape).
 *
 * Joins the three machine-derived inputs:
 *   endpoint-inventory.json        route surface + guards in force
 *   route-data-access.json         tables each route reads/writes
 *   schema-project-parent-map.json how each table reaches a project
 *
 * and assigns every endpoint EXACTLY ONE disposition from the HOB §5 vocabulary
 * via an ordered, explicit rule list. Each verdict carries the rule that fired,
 * so a disposition can be argued with rather than taken on faith.
 *
 * IMPORTANT — this repository has NO ADR-014 authorization layer at this commit
 * (no api/authz, no capability gates, no project_members). Statuses are
 * therefore CANDIDATE_*, never PROTECTED_PHASE3*. Nothing here claims coverage
 * that does not exist.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const A    = join(ROOT, 'audit', 'adr-014')
const rd   = f => JSON.parse(readFileSync(join(A, f), 'utf8'))

const inv    = rd('endpoint-inventory.json')
const access = rd('route-data-access.json')
const schema = rd('schema-project-parent-map.json')

const tableMap  = new Map(schema.tables.map(t => [t.table, t]))
const accessMap = new Map(access.endpoints.map(e => [`${e.method} ${e.path} ${e.file}:${e.line}`, e]))

const MUTATION = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const projectParentOf = t => tableMap.get(t)?.projectParent ?? null
const hasProjectParent = t => {
  const p = projectParentOf(t)
  return !!p && p.strategy !== 'NO_PROJECT_PARENT'
}

/** Consequential-transition verbs, matched on the final path segment only. */
const TRANSITION_VERBS = [
  'approve', 'reject', 'void', 'post', 'close', 'waive', 'accept', 'publish',
  'finalize', 'mark-paid', 'submit', 'sign', 'issue', 'cancel', 'revoke',
  'execute', 'release', 'authorize', 'complete', 'archive', 'suspend',
]
const lastSegment = p => p.split('/').filter(Boolean).pop() ?? ''
const isTransition = p => TRANSITION_VERBS.includes(lastSegment(p))

/** An :id-style path parameter that is not itself the project. */
const recordIdParams = ep => ep.pathParams.filter(p => !/^projectId$/i.test(p))

// ── ordered rules; first match wins, and records why ─────────────────────────
const RULES = [
  ['DEAD_OR_UNMOUNTED', ep => !ep.mounted,
    'router is never mounted from api/server.ts'],

  ['SERVICE_BOUNDARY', ep =>
    /^\/scim\/|^\/api\/v1\/scim|^\/saml\/|^\/api\/v1\/auth\/saml|^\/api\/cx\/webhook/.test(ep.path) ||
    ep.file.includes('scim') || ep.file.includes('saml') || ep.file.includes('Webhook'),
    'service/IdP trust boundary — authenticates by service token, HMAC or SAML, not by user session (HOB §33)'],

  ['PLATFORM_GLOBAL', ep => ep.guards.includes('requirePlatformAdmin') ||
    /^\/api\/v1\/enterprise\//.test(ep.path),
    'platform-administration surface, above tenant scope'],

  ['PUBLIC_UNAUTHENTICATED', ep => !ep.guards.length,
    'no session guard and not a recognised service boundary'],

  // The project RECORD itself: /projects/:id, or a transition acting on it
  // (/projects/:id/approve). A child collection under the same prefix
  // (/projects/:id/bid-packages) is NOT the project record — it is rule
  // PROJECT_CHILD_PATH_PROJECT below, which carries the same :projectId scope
  // requirement but a different functional capability.
  ['PROJECT_ROOT_EXISTING', ep =>
    /^\/api\/v1\/projects\/:(id|projectId)$/.test(ep.path) ||
    (/^\/api\/v1\/projects\/:(id|projectId)\/[^/]+$/.test(ep.path) && isTransition(ep.path)),
    'operates on the existing project record identified in the path (HOB §13/§14)'],

  ['PROJECT_CREATE_NO_EXISTING_SCOPE', ep =>
    ep.method === 'POST' && ep.path === '/api/v1/projects',
    'creates the project itself — no pre-existing project to be a member of (HOB §13)'],

  ['PROJECT_CHILD_PATH_PROJECT', ep => /\/projects\/:(projectId|id)\//.test(ep.path),
    'project identified directly by a path parameter'],

  ['SELF_SCOPED', ep =>
    /\/me\/|\/me$|\/my-|\/inbox/.test(ep.path) ||
    ep.writes.some(w => w.scopeColumns.includes('user_id') && !w.scopeColumns.includes('project_id')),
    'record is scoped to the calling principal, not to a project (HOB §31 — SELF remains SELF)'],

  ['PROJECT_CHILD_BODY_PROJECT', ep =>
    MUTATION.has(ep.method) && ep.bodyProjectRefs.length > 0,
    'project selected by a project id in the request body (HOB §16)'],

  ['PROJECT_CHILD_RECORD_ID', ep =>
    recordIdParams(ep).length > 0 &&
    (ep.writeTables.some(hasProjectParent) || ep.reads.some(hasProjectParent)),
    'child record addressed by its own id; the record\'s table reaches a project'],

  ['CROSSDOMAIN', ep => /\/related|\/cross-domain|\/correlations/.test(ep.path),
    'cross-domain synthesised record — provenance unresolved (HOB §32)'],

  ['TENANT_GLOBAL', ep =>
    (ep.writeTables.length || ep.reads.length) &&
    ![...ep.writeTables, ...ep.reads].some(hasProjectParent),
    'every table this route touches has no project parent — tenant-level configuration or registry'],

  // Visible, not silently declared project-free: no table could be resolved for
  // this route, so its project relationship is UNKNOWN rather than absent.
  // HOB §64 requires these be reported as deferred-for-scope-model, not closed.
  ['UNRESOLVED_DATA_ACCESS', ep => ep.resolvedVia === 'UNRESOLVED',
    'no SQL table resolved from handler or one-level service delegation — project relationship undetermined, manual review required'],

  ['NO_PROJECT_PARENT', () => true,
    'tables resolved, and none of them reaches a project'],
]

function classify (ep) {
  for (const [disposition, test, reason] of RULES) {
    if (test(ep)) return { disposition, reason }
  }
  return { disposition: 'UNEXPLAINED', reason: 'no rule matched' }
}

// ── build the registry ───────────────────────────────────────────────────────
const registry = []
for (const e of inv.endpoints) {
  const acc = accessMap.get(`${e.method} ${e.path} ${e.file}:${e.line}`) ?? { writes: [], reads: [], writeTables: [], delegatesTo: [], resolvedVia: 'UNRESOLVED' }
  const ep = { ...e, ...acc }
  const { disposition, reason } = classify(ep)

  const projectTables = [...new Set([...ep.writeTables, ...ep.reads])].filter(hasProjectParent)

  /**
   * Pick the table this route is ABOUT. Preferring a table whose name matches the
   * resource segment of the path avoids naming a joined-in table as primary —
   * without it, GET /change-orders/:id reports `change_order_tasks` because that
   * join appears first in the SQL.
   */
  const resourceSegment = e.path.split('/').filter(s => s && !s.startsWith(':')).pop() ?? ''
  const slug = resourceSegment.replace(/-/g, '_')
  const nameMatches = t =>
    t === slug || t === slug + 's' || t === slug.replace(/s$/, '') ||
    t === slug.replace(/ies$/, 'y') || t.replace(/_/g, '') === slug.replace(/_/g, '')
  const candidates = [...ep.writeTables, ...ep.reads]
  const primaryTable =
    candidates.find(t => nameMatches(t) && hasProjectParent(t)) ??
    candidates.find(nameMatches) ??
    ep.writeTables.find(hasProjectParent) ?? projectTables[0] ??
    ep.writeTables[0] ?? ep.reads[0] ?? null

  // Does the route already constrain by project anywhere in its SQL?
  const scopesByProject = ep.writes.some(w => w.scopeColumns.includes('project_id'))
  const scopesByTenant  = ep.writes.some(w => w.scopeColumns.includes('tenant_id'))

  const operationType =
    !MUTATION.has(e.method) ? (recordIdParams(e).length ? 'READ_DIRECT_ID' : 'READ_COLLECTION')
    : isTransition(e.path)  ? 'MUTATION_CONSEQUENTIAL'
    : e.method === 'POST'   ? 'MUTATION_CREATE'
    : e.method === 'DELETE' ? 'MUTATION_DELETE'
    :                         'MUTATION_UPDATE'

  const projectBound = [
    'PROJECT_ROOT_EXISTING', 'PROJECT_CHILD_PATH_PROJECT',
    'PROJECT_CHILD_RECORD_ID', 'PROJECT_CHILD_BODY_PROJECT',
  ].includes(disposition)

  registry.push({
    method: e.method,
    path: e.path,
    file: e.file,
    line: e.line,
    operationType,
    disposition,
    dispositionReason: reason,
    projectBound,
    // functional authority actually in force at this commit
    functionalAuthority: e.guards.length ? e.guards : ['(none)'],
    // primaryTable is a HEURISTIC (first written table that reaches a project);
    // writeTables/readTables carry the full resolved set so the heuristic can be
    // checked rather than trusted.
    primaryTable,
    writeTables: ep.writeTables,
    writeScopeColumns: [...new Set(ep.writes.flatMap(w => w.scopeColumns))].sort(),
    projectScopeStrategy: primaryTable ? (projectParentOf(primaryTable)?.strategy ?? 'UNKNOWN_TABLE') : 'NO_TABLE_RESOLVED',
    projectParent: primaryTable ? projectParentOf(primaryTable) : null,
    sqlScopesByProject: scopesByProject,
    sqlScopesByTenant: scopesByTenant,
    bodyProjectRefs: e.bodyProjectRefs,
    tableResolution: ep.resolvedVia,
    status: projectBound ? 'CANDIDATE_PHASE3C' : `OUT_OF_PHASE3C_${disposition}`,
  })
}

registry.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method))

// ── counters (HOB §42 / §62 shape, honestly labelled for this commit) ───────
const by = (arr, f) => arr.reduce((a, x) => (a[f(x)] = (a[f(x)] || 0) + 1, a), {})
const mut  = registry.filter(r => MUTATION.has(r.method))
const read = registry.filter(r => !MUTATION.has(r.method))
const pb   = registry.filter(r => r.projectBound)

const counters = {
  TOTAL_API_ENDPOINTS: registry.length,
  DISPOSITIONS: by(registry, r => r.disposition),
  UNEXPLAINED: registry.filter(r => r.disposition === 'UNEXPLAINED').length,

  PROJECT_BOUND_TOTAL: pb.length,
  PROJECT_BOUND_BY_OPERATION: by(pb, r => r.operationType),

  MUTATIONS: {
    total: mut.length,
    projectBound: mut.filter(r => r.projectBound).length,
    byDisposition: by(mut, r => r.disposition),
    consequentialProjectBound: mut.filter(r => r.projectBound && r.operationType === 'MUTATION_CONSEQUENTIAL').length,
    projectBoundWithNoProjectPredicateInSql:
      mut.filter(r => r.projectBound && !r.sqlScopesByProject).length,
  },
  DIRECT_ID_READS: {
    total: read.filter(r => r.operationType === 'READ_DIRECT_ID').length,
    projectBound: read.filter(r => r.operationType === 'READ_DIRECT_ID' && r.projectBound).length,
  },
  READ_COLLECTIONS: {
    total: read.filter(r => r.operationType === 'READ_COLLECTION').length,
    projectBound: read.filter(r => r.operationType === 'READ_COLLECTION' && r.projectBound).length,
  },
  SELF_SCOPED: registry.filter(r => r.disposition === 'SELF_SCOPED').length,
  DEFERRED_SCOPE_MODEL_UNRESOLVED: registry.filter(r => r.disposition === 'UNRESOLVED_DATA_ACCESS').length,
  RECORD_SCOPE_PROTECTED_AT_THIS_COMMIT: 0,
  RECORD_SCOPE_PROTECTED_NOTE:
    'zero — this commit has no ADR-014 authorization layer (no api/authz, no capability gate, no project_members table)',
}

writeFileSync(join(A, 'scope-classification.json'),
  JSON.stringify({ generatedFrom: 'endpoint-inventory + route-data-access + schema-project-parent-map', counters, registry }, null, 2) + '\n')
console.log(JSON.stringify(counters, null, 2))
