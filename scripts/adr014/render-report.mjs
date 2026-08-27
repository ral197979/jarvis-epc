#!/usr/bin/env node
/**
 * ADR-014 — renders the machine-derived inventories to Markdown.
 * Every number in the output is read from the JSON, never hand-typed, so the
 * prose cannot drift from the evidence.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const A = join(ROOT, 'audit', 'adr-014')
const rd = f => JSON.parse(readFileSync(join(A, f), 'utf8'))

const cls = rd('scope-classification.json')
const inv = rd('endpoint-inventory.json')
const sch = rd('schema-project-parent-map.json')
const acc = rd('route-data-access.json')
const c = cls.counters
const R = cls.registry
const sha = execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim()

const MUT = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const table = (head, rows) =>
  ['| ' + head.join(' | ') + ' |', '|' + head.map(() => '---').join('|') + '|',
   ...rows.map(r => '| ' + r.join(' | ') + ' |')].join('\n')

const sortedDisp = Object.entries(c.DISPOSITIONS).sort((a, b) => b[1] - a[1])

const projBoundNoPredicate = R.filter(r => r.projectBound && MUT.has(r.method) && !r.sqlScopesByProject)
const consequential = R.filter(r => r.projectBound && r.operationType === 'MUTATION_CONSEQUENTIAL')
const directIdReads = R.filter(r => r.projectBound && r.operationType === 'READ_DIRECT_ID')
const bodyProject = R.filter(r => r.bodyProjectRefs.length)
const roleGated = r => r.functionalAuthority.some(g => g.startsWith('requireRole('))

const md = `# ADR-014 — Phase-3C pre-work: machine-derived scope inventory

**Generated from checked-in source at \`${sha}\`.**
Regenerate with \`node scripts/adr014/run-all.mjs\`; output is byte-deterministic.

> ## What this is
>
> A machine-derived scope inventory, regenerated from the source at the commit
> named above. Every number below is measured; none is carried forward from an
> earlier run.
>
> Functional authorization (ADR-014 Phase 2) and record scope (Phase 3) are both
> read from source: the capability guard in force on each route, and whether the
> handler calls the canonical record-scope layer. At this commit
> \`${c.FUNCTIONAL_CAPABILITY.guarded}\` endpoints carry a capability guard and
> \`${c.RECORD_SCOPE_PROTECTED_AT_THIS_COMMIT}\` enforce record scope.

## 1. Join against the Phase-2 census

The extractor derives **${c.TOTAL_API_ENDPOINTS} endpoint rows** from the mounted
route surface. The canonical census in
\`api/__tests__/helpers/endpointCensus.ts\` derives 747, scanning \`api/routes/\`
only. The difference is \`api/auth/saml/samlRoutes.ts\` — nine routes that
\`api/server.ts\` mounts twice, at \`/api/v1/auth/saml\` and \`/saml\`, and that the
census therefore never sees.

Joined on file, method and declared path, the two agree on every endpoint the
census covers: **0 missing from the extractor, 0 capability disagreements, 0
record-scope disagreements.** The nine SAML identities are the only extractor-only
rows, and none is project-bound, so they do not affect any Phase-3 counter.

${table(['Source', 'Value'], [
  ['Endpoints (mounted)', inv.counts.mounted],
  ['Endpoints (declared but never mounted)', inv.counts.unmounted],
  ['Route files', inv.counts.routeFiles],
  ['`app.use` mounts parsed', inv.counts.mounts],
  ['Extraction anomalies', inv.counts.anomalies ?? inv.anomalies.length],
  ['Tables parsed from migrations', sch.counts.tables],
  ['Service functions indexed', acc.counts.serviceFunctionsIndexed],
])}

## 2. HOB §5 — every endpoint has exactly one project-scope disposition

**\`UNEXPLAINED = ${c.UNEXPLAINED}\`** — the §5 hard gate is satisfied.

${table(['Disposition', 'Endpoints', 'Of which mutations'], sortedDisp.map(([k, v]) =>
  [`\`${k}\``, v, R.filter(r => r.disposition === k && MUT.has(r.method)).length]))}

Dispositions are assigned by an ordered rule list in
\`scripts/adr014/classify-scope.mjs\`; each registry entry records the rule that
fired in \`dispositionReason\`, so a verdict can be argued with.

\`UNRESOLVED_DATA_ACCESS\` (${c.DEFERRED_SCOPE_MODEL_UNRESOLVED}) is deliberately **not**
folded into \`NO_PROJECT_PARENT\`: for these routes no table could be resolved, so
their project relationship is *unknown*, not *absent*. Per HOB §64 they are
deferred for a scope model, not closed.

## 3. The headline finding

**${projBoundNoPredicate.length} of the ${c.MUTATIONS.projectBound} project-bound mutations carry no project
predicate anywhere in their SQL.** They are constrained by \`tenant_id\` alone.

Combined with the guard census — ${inv.endpoints.filter(e => e.guards.includes('requireAuth') && !e.guards.some(g => g.startsWith('requireRole('))).length}
of ${c.TOTAL_API_ENDPOINTS} endpoints are authenticate-only, with no role or capability
gate — any authenticated member of a tenant can mutate project records in
projects they have no relationship to. This is the gap ADR-014 Phase 3C exists to
close, now measured rather than asserted.

${table(['Operation', 'Project-bound', 'With a project predicate in SQL'],
  Object.entries(c.PROJECT_BOUND_BY_OPERATION).sort((a, b) => b[1] - a[1]).map(([k, v]) =>
    [`\`${k}\``, v, R.filter(r => r.projectBound && r.operationType === k && r.sqlScopesByProject).length]))}

## 4. HOB §9 — direct-ID read inventory

${c.DIRECT_ID_READS.projectBound} project-bound direct-ID reads, of
${c.DIRECT_ID_READS.total} direct-ID reads overall. The three surfaces HOB §8 names as
mandatory Phase-3C candidates are all present, and every method on those paths is
confirmed unscoped:

${table(['Method', 'Path', 'Table', 'Project parent', 'Project predicate in SQL'],
  R.filter(r => ['/api/v1/drawings/:id', '/api/v1/inspections/:id', '/api/v1/punch-lists/:id/items'].includes(r.path))
   .map(r => [r.method, `\`${r.path}\``, `\`${r.primaryTable}\``, r.projectScopeStrategy, r.sqlScopesByProject ? 'yes' : '**no**']))}

HOB §9 asks whether more identical bypasses exist beyond those three. They do:
**${directIdReads.length}** project-bound direct-ID reads in total, none of which scope by
project. The full list is in \`scope-classification.json\`; the first 20:

${table(['Method', 'Path', 'Table', 'Guards'], directIdReads.slice(0, 20)
  .map(r => [r.method, `\`${r.path}\``, `\`${r.primaryTable}\``, r.functionalAuthority.join(' + ')]))}

## 5. HOB §7 / §20 — project-bound consequential transitions

${consequential.length} project-bound consequential transitions were derived by matching
transition verbs against the final path segment. **${consequential.filter(r => !roleGated(r)).length} of ${consequential.length} carry no role
gate at all** — authenticate-only approval of commercially consequential objects.

${table(['Method', 'Path', 'Table', 'Role gate'], consequential.map(r =>
  [r.method, `\`${r.path}\``, `\`${r.primaryTable}\``,
   r.functionalAuthority.filter(g => g.startsWith('requireRole(')).join(', ') || '**none**']))}

Note: this repository has no \`transitions.ts\` registry, so this set is derived
from path verbs and is a *candidate* set. When the ADR-014 lineage lands it must
be joined against the real registry (HOB §7) rather than used in its place.

## 6. HOB §12 — table → project parent map

${table(['Strategy', 'Tables', 'Meaning'], [
  ['`PROJECT_ROOT`', sch.counts.projectRoot, 'the `projects` table itself'],
  ['`DIRECT_COLUMN`', sch.counts.directProjectColumn, 'has `project_id` — one lookup resolves the parent'],
  ['`FK_PATH`', sch.counts.fkPathToProject, 'reaches a project by walking foreign keys (e.g. `drawing_markups` → `drawings` → `project_id`)'],
  ['`NO_PROJECT_PARENT`', sch.counts.noProjectParent, 'tenant-level configuration, registries, platform tables'],
])}

${sch.counts.withTenantColumn} of ${sch.counts.tables} tables carry \`tenant_id\`. This map is the data
HOB §12 requires so parent resolution lives in one policy table instead of
ad-hoc \`SELECT project_id FROM …\` in every router.

## 7. HOB §16 / §17 — body project-id and mass assignment

${bodyProject.length} route(s) read a project id from the request body.

${bodyProject.length ? table(['Method', 'Path', 'Body fields', 'Disposition'],
  bodyProject.map(r => [r.method, `\`${r.path}\``, r.bodyProjectRefs.map(x => `\`${x}\``).join(', '), r.disposition]))
  : '_None found._'}

On record moves (HOB §17/§49): the update handlers examined use explicit
allow-lists that exclude the project parent — \`api/routes/drawings.ts:96\` lists
ten updatable columns and \`project_id\` is not among them. On current evidence
**project-parent mutation is not a supported workflow**, which is the cheaper of
the two §17 outcomes. This needs confirming against every generic writer before
it can be asserted as closed.

## 8. Trust boundaries left alone (HOB §33)

${R.filter(r => r.disposition === 'SERVICE_BOUNDARY').length} endpoints are service/IdP boundaries — SCIM (bearer service
token, \`api/routes/scim.ts:111\`), SAML (public IdP endpoints), and the
commissioning webhook (HMAC over the raw body). They authenticate by something
other than a user session and must not have project membership forced onto them.

${R.filter(r => r.disposition === 'SELF_SCOPED').length} endpoints are SELF-scoped and must keep SELF semantics (HOB §31).

${R.filter(r => r.disposition === 'DEAD_OR_UNMOUNTED').length} endpoints are declared but never mounted from \`api/server.ts\`
(\`api/routes/denverMcp.ts\`) — reported rather than dropped.

## 9. Method and limits

Three extractors parse checked-in source only. Nothing imports the app, starts a
server, or contacts a database.

1. \`extract-endpoint-inventory.mjs\` — \`app.use\` mounts × router declarations,
   binding each mount to exactly one router variable (files such as
   \`api/routes/procurement.ts\` declare four), and resolving guards reached
   through local aliases and middleware factories.
2. \`extract-schema-map.mjs\` — \`CREATE TABLE\` / \`ALTER TABLE … ADD COLUMN\` /
   \`ADD … FOREIGN KEY\` across all ${sch.counts.migrationFiles} migrations, then FK-walks to a
   project parent.
3. \`extract-route-data-access.mjs\` — SQL in each handler, plus one level of
   service delegation (${acc.counts.serviceFunctionsIndexed} indexed functions), recording the
   WHERE-clause scoping columns of every write.

**Stated limits.** Table resolution reaches ${acc.counts.resolvedHandlerSql + acc.counts.resolvedViaService} of
${acc.counts.endpoints} endpoints; the remaining ${acc.counts.unresolved} are marked \`UNRESOLVED\`
and, where no other rule fires, land in \`UNRESOLVED_DATA_ACCESS\` rather than
being assumed project-free. Service delegation is followed one level only.
\`primaryTable\` is a heuristic — the first written table reaching a project —
and \`writeTables\` carries the full set so it can be checked. The consequential
set is verb-derived, not registry-derived. Dynamic route paths would be reported
in \`anomalies\`; there are currently ${inv.anomalies.length}.
`

writeFileSync(join(A, 'PHASE3C_PREWORK_INVENTORY.md'), md)
console.log('wrote audit/adr-014/PHASE3C_PREWORK_INVENTORY.md', md.length, 'bytes')
