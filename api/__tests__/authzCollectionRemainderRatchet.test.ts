/**
 * ADR-014 Phase 3G — the collection remainder and direct-ID classifier ratchet.
 *
 * Phase 3F closed 79 of 108 collections and left five that a non-Owner could
 * still use to read across projects, plus a classifier defect it recorded but
 * did not fix. This file holds all of it:
 *
 *   §5/§6    the two member-keyed collections filter their ROWS, without
 *            hiding the member (the outer record keeps its own authority)
 *   §7       the member aggregates count only visible rows
 *   §10–§20  the three unpolicied collections have real policies
 *   §21/§22  every unresolved collection data surface has a verdict
 *   §25–§28  direct-ID project-boundness comes from the resource the PATH
 *            addresses, not from every table the payload query touches
 *
 * Every assertion derives from source and proves it FOUND its target first.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { censusWithEffectivePaths } from './helpers/endpointCensus'
import {
  COLLECTION_SCOPE_ADOPTION, collectionScopeCounters, policyFor,
  UNRESOLVED_COLLECTION_AUDIT, unresolvedCollectionCounters,
  RECORD_SCOPE_POLICIES,
} from '../authz/recordScopePolicies'
import { SERVER_ROLE_CAPS, USER_ROLES, type UserRole } from '../authz/capabilities'

const ROOT = process.cwd()
const src = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const registry = JSON.parse(src('audit/adr-014/scope-classification.json')) as {
  registry: { method: string; path: string; projectBound: boolean; operationType: string
              enforcesRecordScope: boolean; disposition: string; primaryTable: string | null
              capabilities: string[] }[]
}
const access = JSON.parse(src('audit/adr-014/route-data-access.json')) as {
  endpoints: { method: string; path: string; primaryReadTable: string | null }[]
}
const census = censusWithEffectivePaths()

const bodyOf = (method: string, mounted: string): string =>
  census.find(e => e.method === method && e.effective.includes(mounted))?.body ?? ''

/**
 * The handler with `//` comment lines removed.
 *
 * Ordering assertions below look for SQL keywords, and a comment EXPLAINING the
 * ordering contains those same words — the `/ops/readiness` note literally says
 * "before the LIMIT 20". Searching the raw body finds the prose first and fails
 * a correct route.
 */
const sqlOnly = (method: string, mounted: string): string =>
  bodyOf(method, mounted).split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n')

// ─── 1. The member-keyed collections (§4–§9) ─────────────────────────────────
describe('a member-keyed collection filters its rows, not its member', () => {
  const ASSIGNMENTS = '/api/v1/team/members/:id/assignments'
  const TIMESHEETS  = '/api/v1/team/members/:memberId/timesheets'
  const MEMBER      = '/api/v1/team/members/:id'

  it('filters the returned project rows on both routes', () => {
    for (const p of [ASSIGNMENTS, TIMESHEETS]) {
      const r = registry.registry.find(x => x.path === p && x.method === 'GET')
      expect(r, `${p} left the inventory`).toBeTruthy()
      expect(r!.enforcesRecordScope, `${p} still returns unfiltered project rows`).toBe(true)
      expect(bodyOf('GET', p)).toMatch(/collectionScopeSql\(/)
    }
  })

  it('never adds requireRecordScope on team_members, which would be a false guard (§9)', () => {
    // The path id addresses a `team_members` row and that table has no project
    // parent — guarding on it would deny a caller knowledge that Jane exists
    // because Jane works on a project they cannot reach, which §4 forbids.
    for (const p of [ASSIGNMENTS, TIMESHEETS, MEMBER]) {
      expect(bodyOf('GET', p), `${p} guards the member instead of filtering the rows`)
        .not.toMatch(/requireRecordScope\(\s*'team_members'/)
    }
    expect(policyFor('team_members'), 'team_members must stay out of the record-scope registry').toBeNull()
  })

  it('keeps the member visible by scoping the JOIN, not the member row (§4, §22)', () => {
    // `getMember` LEFT JOINs assignments; the predicate belongs on that join so
    // unauthorized assignments fail to join while the member row survives.
    const svc = src('api/services/team/teamService.ts')
    const fn = /export async function getMember\([\s\S]*?\n}/.exec(svc)?.[0] ?? ''
    expect(fn, 'getMember was not found').toContain('LEFT JOIN project_assignments')
    expect(fn, 'the scope predicate must sit on the JOIN, above the WHERE').toMatch(
      /LEFT JOIN project_assignments a ON[\s\S]{0,120}?\$\{scope\.sql/)
  })

  it('scopes the member aggregates, so a hidden project cannot raise a count (§7)', () => {
    const svc = src('api/services/team/teamService.ts')
    for (const fnName of ['listMembers', 'getMember']) {
      const fn = new RegExp(`export async function ${fnName}\\([\\s\\S]*?\\n}`).exec(svc)?.[0] ?? ''
      expect(fn, `${fnName} was not found`).toContain('active_projects')
      expect(fn, `${fnName} counts assignments the caller may not see`).toMatch(/\$\{scope\.sql/)
    }
  })

  it('binds the principal through the canonical helper, not a private query (§34)', () => {
    for (const p of [ASSIGNMENTS, TIMESHEETS, MEMBER]) {
      const b = bodyOf('GET', p)
      expect(b, `${p} resolves no live principal`).toMatch(/resolveCurrentUser\(/)
      expect(b, `${p} must not run its own membership SQL`).not.toMatch(/FROM\s+project_members/i)
    }
  })

  it('uses each resource’s own declared semantics', () => {
    // Both are PROJECT_REQUIRED — NOT NULL project_id in the migrations — so
    // neither gets a tenant-global branch it has no rows for.
    expect(policyFor('project_assignments')!.projectSemantics).toBe('PROJECT_REQUIRED')
    expect(policyFor('timesheets')!.projectSemantics).toBe('PROJECT_REQUIRED')
  })
})

// ─── 2. The three formerly unpolicied collections (§10–§20) ──────────────────
describe('every collection row model now has a scope policy', () => {
  it('leaves no collection deferred for want of one', () => {
    const c = collectionScopeCounters()
    expect(c.deferred, 'Phase 3F deferred three; Phase 3G must leave none').toBe(0)
    expect(c.unexplained).toBe(0)
    expect(c.candidates).toBe(115)
    expect(c.protected_).toBe(89)
  })

  it('gives document_folders and source_uploads dual semantics, with evidence', () => {
    for (const r of ['document_folders', 'source_uploads']) {
      const p = policyFor(r)
      expect(p, `${r} has no policy`).not.toBeNull()
      expect(p!.projectSemantics).toBe('DUAL_PROJECT_OR_TENANT')
      expect(p!.projectSemanticsEvidence!.length,
        `${r} claims tenant-global without arguing it`).toBeGreaterThan(120)
      // The claim is that a project-less row is DESIGNED, so the evidence must
      // point at the creation path, not merely at column nullability.
      expect(p!.projectSemanticsEvidence!).toMatch(/\?\?\s*null/)
    }
  })

  it('scopes the folder list AND the document count it reports (§19)', () => {
    const b = bodyOf('GET', '/api/v1/files/folders')
    expect(b).toMatch(/collectionScopeSql\(\s*principal,\s*'document_folders'/)
    expect(b, 'a visible folder must not report documents from a hidden project')
      .toMatch(/collectionScopeSql\(\s*principal,\s*'documents'/)
  })

  it('scopes the commissioning upload list before its LIMIT', () => {
    const b = sqlOnly('GET', '/api/v1/commissioning/uploads')
    expect(b).toMatch(/collectionScopeSql\(\s*principal,\s*'source_uploads'/)
    const scopeAt = b.search(/\$\{scopeSql\}/)
    const limitAt = b.search(/LIMIT\s+\$/)
    expect(scopeAt).toBeGreaterThan(-1)
    expect(scopeAt, 'filtering after LIMIT pages wrongly and leaks occupancy').toBeLessThan(limitAt)
  })

  it('resolves /ops/readiness as a PROJECT collection, inventing no relation model (§17)', () => {
    // Phase 3F reported `action_relations` for this route, which was an artefact
    // of following `computeReadiness` one service level down. Its outer query
    // selects FROM projects, so the caller receives projects — and the §17
    // relation-ownership contradiction never arises.
    const d = access.endpoints.find(e => e.path === '/api/v1/ops/readiness' && e.method === 'GET')
    expect(d, '/ops/readiness left the data-access inventory').toBeTruthy()
    expect(d!.primaryReadTable).toBe('projects')

    const b = bodyOf('GET', '/api/v1/ops/readiness')
    expect(b, 'it should reuse the membership predicate GET /projects already has')
      .toMatch(/projectScopeSql\(/)
    expect(policyFor('action_relations'),
      'no action_relations policy should have been invented for this route').toBeNull()
  })

  it('applies the project predicate before the LIMIT 20', () => {
    const b = sqlOnly('GET', '/api/v1/ops/readiness')
    const scopeAt = b.search(/\$\{scope\}/)
    const limitAt = b.search(/LIMIT 20/)
    expect(scopeAt).toBeGreaterThan(-1)
    expect(scopeAt, 'twenty tenant projects with holes cut in them is not a page').toBeLessThan(limitAt)
  })
})

// ─── 3. The unresolved collection surfaces (§21, §22) ────────────────────────
describe('every unresolved collection data surface has a verdict', () => {
  it('covers all thirteen, with nothing unexplained', () => {
    const c = unresolvedCollectionCounters()
    expect(c.total, 'Phase 3F left thirteen').toBe(15)
    expect(c.resolvedProjectBound + c.platform + c.tenantGlobal + c.nonProject
         + c.selfScoped + c.deferred).toBe(c.total)
    expect(c.unexplained, 'a verdict without an argument is a gap wearing a label').toBe(0)
  })

  it('names only endpoints that really are unresolved collections', () => {
    const unresolved = new Set(registry.registry
      .filter(r => r.disposition === 'UNRESOLVED_DATA_ACCESS' && r.operationType === 'READ_COLLECTION')
      .map(r => `${r.method} ${r.path}`))
    expect(unresolved.size).toBe(15)
    for (const a of UNRESOLVED_COLLECTION_AUDIT) {
      expect(unresolved.has(a.endpoint), `${a.endpoint} is not an unresolved collection`).toBe(true)
    }
  })

  it('closes the one that was genuinely reachable across projects', () => {
    // `ai.govern` reaches the platform administrator too, and an administrator
    // has no tenant-wide project scope — so this rollup really was counting
    // every project in the tenant for them.
    const stats = UNRESOLVED_COLLECTION_AUDIT.find(a => a.endpoint.includes('/agent-actions/_stats'))!
    expect(stats.disposition).toBe('PROJECT_BOUND_COLLECTION')
    const svc = src('api/services/agentActions.ts')
    const fn = /export async function stats\([\s\S]*?\n}/.exec(svc)?.[0] ?? ''
    expect(fn, 'stats() was not found').toContain('agent_actions')
    // One shared WHERE means no aggregate can be left behind while its
    // siblings are scoped.
    expect(fn).toMatch(/w\.scope\?\.sql/)
    expect(bodyOf('GET', '/api/v1/agent-actions/_stats'))
      .toMatch(/collectionScopeSql\(\s*principal,\s*'agent_actions'/)
  })

  it('defers only the surface whose scope key is polymorphic', () => {
    const deferred = UNRESOLVED_COLLECTION_AUDIT.filter(a => a.disposition === 'DEFERRED_SCOPE_MODEL')
    expect(deferred.map(a => a.endpoint)).toEqual(['GET /api/v1/ops/live-feed'])
    expect(deferred[0]!.reason).toMatch(/subscription_scope|polymorphic/)
  })
})

// ─── 4. The direct-ID classifier repair (§25–§29) ────────────────────────────
describe('direct-ID project-boundness comes from the path-addressed resource', () => {
  const classifier = src('scripts/adr014/classify-scope.mjs')

  it('keys the direct-ID rule on primaryReadTable for reads, and leaves writes alone', () => {
    const rule = /\['PROJECT_CHILD_RECORD_ID'[\s\S]*?\],/.exec(classifier)?.[0] ?? ''
    expect(rule, 'the direct-ID rule was not found').toContain('recordIdParams')
    expect(rule, 'a read must key on the resource its path addresses').toContain('ep.primaryReadTable')
    expect(rule, 'a write has no outer SELECT, so it keeps the old test').toContain('MUTATION.has(ep.method)')
  })

  it('reports the resource the path names, not a table the payload joins', () => {
    const expected: [string, string][] = [
      ['/api/v1/vendors/:id',         'vendors'],
      ['/api/v1/files/documents/:id', 'documents'],
      ['/api/v1/change-orders/:id',   'change_orders'],
    ]
    for (const [p, table] of expected) {
      const d = access.endpoints.find(e => e.path === p && e.method === 'GET')
      expect(d, `${p} left the data-access inventory`).toBeTruthy()
      expect(d!.primaryReadTable, `${p} is attributed the wrong resource`).toBe(table)
    }
  })

  it('separates the rows a sub-collection returns from the record its path names', () => {
    // `GET /knowledge/sources/:id/chunks` RETURNS chunks — so `primaryReadTable`
    // is knowledge_chunks, which is the honest description of the payload. The
    // id in the path addresses the SOURCE, and that is what the guard scopes.
    // The two are different questions and the repair must not collapse them:
    // scoping the chunk table would look up a source id in a table that has
    // never seen it and refuse every caller.
    const d = access.endpoints.find(
      e => e.path === '/api/v1/knowledge/sources/:id/chunks' && e.method === 'GET')!
    expect(d.primaryReadTable, 'the rows returned are chunks').toBe('knowledge_chunks')
    expect(bodyOf('GET', '/api/v1/knowledge/sources/:id/chunks'),
      'but the guard must scope the source the path names')
      .toMatch(/requireRecordScope\(\s*'knowledge_sources'/)
  })

  it('no longer calls the vendor registry a project child', () => {
    // The regression Phase 3F recorded as residual AL.4: the vendor detail JOINs
    // purchase orders for a count, and merged `reads` made that decide.
    const r = registry.registry.find(x => x.path === '/api/v1/vendors/:id' && x.method === 'GET')!
    expect(r.projectBound, 'a vendor registry is tenant master data').toBe(false)
    expect(r.primaryTable).toBe('vendors')
  })

  it('keeps the readiness-by-project route keyed on the project itself', () => {
    const r = registry.registry.find(x => x.path === '/api/v1/readiness/project/:id' && x.method === 'GET')!
    expect(r.primaryTable).toBe('projects')
    expect(r.enforcesRecordScope).toBe(true)
  })

  it('leaves the mutation surface exactly where Phase 3D certified it', () => {
    const mut = registry.registry.filter(r => r.projectBound && r.operationType.startsWith('MUTATION'))
    // Phase 3L: +2 for the exposure-hours writes (project and tenant).
    expect(mut.length, 'the classifier change must not move the mutation denominator').toBe(185)
    expect(mut.filter(r => r.enforcesRecordScope).length).toBe(177)
  })
})

// ─── 5. Direct-ID reconciliation, after the repair (§29, §30) ────────────────
describe('the direct-ID inventory reconciles with nothing unexplained', () => {
  const direct = registry.registry.filter(r => r.projectBound && r.operationType === 'READ_DIRECT_ID')

  it('reports the corrected candidate set', () => {
    // Phase 3K adds the 61st: `GET /files/download/:token`. It was always a
    // project-bound direct-ID read — the token names a `document_versions` row
    // — but the classifier could not see the table until the handler named it,
    // so it sat in UNRESOLVED_DATA_ACCESS instead. The denominator moves and
    // the numerator moves with it: the route arrives already scoped.
    // 62 with the repaired viewer route, which is also a project-bound
    // direct-ID read and is scoped from the moment it exists.
    expect(direct.length, '63 before the repair; two were falsely project-bound').toBe(65)
    // 55 after Phase 3G; Phase 3H closed the twin projection route, which is the
    // last project-bound direct-ID read that was open for a MODEL reason.
    // Phase 3M: +1 for GET /api/v1/contracts/:id, which arrives already scoped.
    expect(direct.filter(r => r.enforcesRecordScope).length).toBe(61)
  })

  it('leaves open only SELF surfaces, whose guard is narrower than membership', () => {
    // §30: a newly discovered DERIVABLE known-id bypass would have to be closed
    // here. There was none, and Phase 3H then closed the twin projection route
    // that had been open for a model reason — so what remains is four personal
    // records, each already carrying an ownership rule stricter than project
    // membership. Deliberately open, not merely unclosed.
    const open = direct.filter(r => !r.enforcesRecordScope).map(r => r.path).sort()
    expect(open).toEqual([
      '/api/v1/actions/:id',
      '/api/v1/actions/:id/relationships',
      '/api/v1/actions/:id/timeline',
      '/api/v1/ask/sessions/:id',
    ])
  })

  it('proves each of those keeps a narrower guard rather than none', () => {
    for (const [p, rule] of [
      ['/api/v1/actions/:id',               /requireActionAccess\(/],
      ['/api/v1/actions/:id/relationships', /requireActionAccess\(/],
      ['/api/v1/actions/:id/timeline',      /requireActionAccess\(/],
      ['/api/v1/ask/sessions/:id',          /user_id\s*=\s*\$2/],
    ] as [string, RegExp][]) {
      expect(bodyOf('GET', p), `${p} lost its ownership rule`).toMatch(rule)
    }
    expect(policyFor('action')!.projectSemantics).toBe('SELF_SCOPED')
  })

  it('still puts no operational_twins entry in the RECORD-scope registry (§32)', () => {
    // Phase 3H gave the twins a policy — in the POLYMORPHIC registry, keyed on
    // the entity a twin selects. The record-scope registry resolves a parent
    // through a declared foreign key, and `operational_twins` still has none,
    // so an entry here would still be an invention.
    expect(policyFor('operational_twins')).toBeNull()
  })
})

// ─── 6. What Phase 3F established stays established (§24, §50–§54) ───────────
describe('the previous slices’ controls are still load-bearing', () => {
  it('keeps every holder-neutral aggregate reachable only by tenant-wide principals (§54)', () => {
    // The claim is `holders(capability) ⊆ holders(tenant-wide project scope)`,
    // so it is COMPUTED, not compared against a hard-coded list of capability
    // names. A list would keep passing if `portfolio.view` were granted to the
    // platform administrator tomorrow — and an administrator has no tenant-wide
    // project scope, so the aggregate would silently stop being neutral.
    const holders = (cap: string): UserRole[] =>
      USER_ROLES.filter(r => (SERVER_ROLE_CAPS[r] as readonly string[]).includes(cap))
    const tenantWide = new Set(holders('project.list.all'))
    expect(tenantWide.size, 'nobody holds tenant-wide project scope — the check is vacuous')
      .toBeGreaterThan(0)

    const agg = COLLECTION_SCOPE_ADOPTION.filter(a => a.disposition === 'PROJECT_AGGREGATE')
    expect(agg.length).toBe(19)
    for (const a of agg) {
      // Reaching the route needs EVERY declared capability, so its holders are
      // the intersection — the narrowest capability decides.
      const reach = USER_ROLES.filter(r =>
        a.capabilities.every(c => (SERVER_ROLE_CAPS[r] as readonly string[]).includes(c)))
      expect(reach.length, `${a.endpoint} is reachable by nobody, so the claim is vacuous`)
        .toBeGreaterThan(0)
      const notNeutral = reach.filter(r => !tenantWide.has(r))
      expect(notNeutral, `${a.endpoint} is claimed holder-neutral but ${notNeutral.join(', ')} can reach it without tenant-wide project scope — it is now an unscoped collection defect`)
        .toEqual([])
    }
  })

  it('keeps SELF collections free of a project predicate', () => {
    const self = COLLECTION_SCOPE_ADOPTION.filter(a => a.disposition === 'SELF_SCOPED_COLLECTION')
    expect(self.length).toBe(7)
    for (const a of self) {
      expect(bodyOf('GET', a.endpoint.replace('GET ', '')),
        `${a.endpoint} was widened to project membership`).not.toMatch(/collectionScopeSql\(/)
    }
  })

  it('keeps every policy in exactly one semantic class', () => {
    for (const p of RECORD_SCOPE_POLICIES) {
      expect(['PROJECT_REQUIRED', 'DUAL_PROJECT_OR_TENANT', 'TENANT_GLOBAL', 'SELF_SCOPED'],
        `${p.resource} has no declared NULL-parent semantics`).toContain(p.projectSemantics)
    }
  })
})
