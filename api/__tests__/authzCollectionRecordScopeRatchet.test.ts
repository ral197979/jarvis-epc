/**
 * ADR-014 Phase 3F — the collection record-scope ratchet.
 *
 * Phase 3E closed the direct-ID reads and Phase 3E-R settled what a NULL project
 * parent means. This file holds the surface they left: a LIST that returns rows
 * from projects the caller has no relationship to.
 *
 * It also pins the three extractor defects this slice had to fix before the
 * candidate set could be trusted at all (§56), because each of them made the
 * inventory understate the problem:
 *
 *   1  a collection with NO path parameter whose rows reach a project fell into
 *      a `NO_PROJECT_PARENT` catch-all whose stated reason was false for it;
 *   2  `api/routes/procurement.ts` declares four routers that each serve
 *      `GET /`, and the data-access extractor keyed handlers by method+path, so
 *      the last one parsed won — `GET /vendors` was reported as reading
 *      `submittals`;
 *   3  the path-project rule was anchored to `/projects/:projectId/`, so the
 *      four `/schedule/:projectId/*` routes — and three sibling mutations —
 *      were never seen as project-bound at all.
 *
 * Every assertion derives from source and proves it FOUND its target first.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { censusWithEffectivePaths } from './helpers/endpointCensus'
import {
  COLLECTION_SCOPE_ADOPTION, collectionScopeCounters, policyFor,
} from '../authz/recordScopePolicies'

const ROOT = process.cwd()
const src = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const registry = JSON.parse(src('audit/adr-014/scope-classification.json')) as {
  registry: { method: string; path: string; projectBound: boolean; operationType: string
              enforcesRecordScope: boolean; disposition: string; primaryReadTable?: string }[]
}
const access = JSON.parse(src('audit/adr-014/route-data-access.json')) as {
  endpoints: { method: string; path: string; readsFrom: string[]; primaryReadTable: string | null }[]
}

const census = censusWithEffectivePaths()
const collections = registry.registry.filter(r => r.projectBound && r.operationType === 'READ_COLLECTION')
const protectedEntries = COLLECTION_SCOPE_ADOPTION.filter(
  a => a.disposition === 'PROTECTED_PHASE3B' || a.disposition === 'PROTECTED_PHASE3F')

function endpointsFor(entry: { endpoint: string }) {
  const [method, mounted] = entry.endpoint.split(' ')
  return census.filter(e => e.method === method && e.effective.includes(mounted!))
}

// ─── 1. Every collection has exactly one disposition (§5, §58) ───────────────
describe('every project-bound collection is dispositioned', () => {
  it('covers the machine-derived candidate set with nothing unexplained', () => {
    const c = collectionScopeCounters()
    expect(c.candidates, 'the registry must name every candidate the inventory finds')
      .toBe(collections.length)
    expect(c.protected_ + c.selfScoped + c.aggregate + c.deferred).toBe(c.candidates)
    expect(c.unexplained, 'a disposition without an argument is a gap wearing a label').toBe(0)
  })

  it('names each endpoint exactly once, and only endpoints that are mounted', () => {
    const keys = COLLECTION_SCOPE_ADOPTION.map(a => a.endpoint)
    expect(new Set(keys).size).toBe(keys.length)
    for (const a of COLLECTION_SCOPE_ADOPTION) {
      expect(endpointsFor(a).length, `${a.endpoint} is not mounted`).toBeGreaterThan(0)
    }
  })

  it('reports the split this slice actually achieved', () => {
    const c = collectionScopeCounters()
    expect(c.candidates, 'the corrected denominator, not the 58 Phase 3E-R reported').toBe(115)
    expect(c.protected_).toBe(89)
    expect(c.selfScoped).toBe(7)
    expect(c.aggregate).toBe(19)
    expect(c.deferred, 'Phase 3G closed the last three').toBe(0)
  })

  it('agrees with the inventory about which collections enforce scope', () => {
    const enforced = new Set(collections.filter(r => r.enforcesRecordScope).map(r => `${r.method} ${r.path}`))
    for (const a of protectedEntries) {
      expect(enforced.has(a.endpoint), `${a.endpoint} claims protection the source does not show`).toBe(true)
    }
    expect(enforced.size, 'the registry must not understate adoption either').toBe(protectedEntries.length)
  })
})

// ─── 2. Path-project collections are guarded AND filtered (§10, §11) ─────────
describe('a path-project collection is guarded and its query is constrained', () => {
  const pathProject = protectedEntries.filter(a => a.shape === 'PATH_PROJECT_COLLECTION')

  it('carries requireProjectScope on the route declaration', () => {
    expect(pathProject.length).toBeGreaterThan(50)
    for (const a of pathProject) {
      const decl = endpointsFor(a)[0]!.body.split('\n')[0] ?? ''
      expect(decl, `${a.endpoint} has no project guard`).toMatch(/requireProjectScope\(/)
    }
  })

  it('keeps its existing functional capability beside the guard', () => {
    for (const a of pathProject) {
      const e = endpointsFor(a)[0]!
      expect(e.allCapabilities, `${a.endpoint} lost its capability guard`).not.toBeNull()
    }
  })

  it('also constrains the rows to the path project, which the guard alone does not', () => {
    // §11 is load-bearing: `requireProjectScope` proves the caller may reach
    // project A, and proves nothing about whether the handler then selects
    // project B's rows. Both have to hold.
    //
    // Matching the bare string `project_id` is NOT enough — every one of these
    // routes has `:projectId` in its declared path, so that test passes even
    // when the predicate has been removed. It must be a real SQL comparison, or
    // the path project must be passed into the service that builds the query.
    const ROWS_HAVE_NO_PROJECT = new Set([
      // Tenant-level inspection templates listed in a project's context. The
      // path names a project so the caller must be able to reach it, but the
      // rows are master data — `inspection_templates` is NO_PROJECT_PARENT —
      // so there is nothing to constrain them to.
      'GET /api/v1/projects/:projectId/inspection-templates',
    ])

    let constrained = 0
    for (const a of pathProject) {
      if (ROWS_HAVE_NO_PROJECT.has(a.endpoint)) continue
      const body = endpointsFor(a)[0]!.body
      const inSql     = /project_id\s*=\s*\$/.test(body)
      const toService = /req\.params(\[['"]projectId|\.projectId)/.test(body)
                     || /p\(req, 'projectId'\)/.test(body)
                     || /params\.projectId/.test(body)
      expect(inSql || toService,
        `${a.endpoint} carries the guard but never constrains its rows to :projectId`).toBe(true)
      constrained++
    }
    expect(constrained, 'the check found nothing to check').toBeGreaterThan(50)
  })
})

// ─── 3. Tenant collections use the registry-driven predicate (§39) ───────────
describe('a tenant-wide collection scopes in SQL, from the resource policy', () => {
  const tenantScoped = protectedEntries.filter(
    a => a.shape === 'TENANT_COLLECTION_PROJECT_ROWS' && a.disposition === 'PROTECTED_PHASE3F')

  it('applies a scope predicate builder rather than filtering after the fact', () => {
    expect(tenantScoped.length).toBeGreaterThan(4)
    for (const a of tenantScoped) {
      const body = endpointsFor(a)[0]!.body
      expect(body, `${a.endpoint} does not build a collection scope predicate`)
        .toMatch(/collectionScopeSql\(/)
    }
  })

  it('resolves every scoped resource to a policy with declared semantics', () => {
    for (const a of tenantScoped) {
      const m = /collectionScopeSql\(\s*principal,\s*'([a-z_]+)'/.exec(endpointsFor(a)[0]!.body)
      expect(m, `${a.endpoint} does not name a resource`).toBeTruthy()
      const p = policyFor(m![1]!)
      expect(p, `${m![1]} has no record-scope policy, so the predicate would fail closed`).not.toBeNull()
      expect(['PROJECT_REQUIRED', 'DUAL_PROJECT_OR_TENANT', 'TENANT_GLOBAL'])
        .toContain(p!.projectSemantics)
    }
  })

  it('scopes the COUNT with the same predicate as the rows (§15)', () => {
    // A scoped page with a tenant-wide total reports "3 of 27" and leaks the
    // occupancy of projects the caller cannot see.
    for (const a of tenantScoped) {
      const body = endpointsFor(a)[0]!.body
      // Per STATEMENT, not per COUNT: one aggregate query may carry several
      // COUNTs under a single predicate, while a paginated route issues a
      // separate COUNT query that needs its own copy. What must hold is that
      // every statement counting these rows carries the predicate.
      const statements = body.split('tenantQuery').slice(1)
      const counting = statements.filter(q => /COUNT\s*\(/i.test(q))
      if (!counting.length) continue
      for (const q of counting) {
        // Any interpolated identifier naming a scope predicate. Routes name
        // theirs for what they scope — `scope`, `countScopeSql`, `folderScope`,
        // `docScope` — and pinning one spelling would fail the product for its
        // choice of variable name rather than for an unscoped COUNT.
        expect(q, `${a.endpoint} has a COUNT statement with no scope predicate`)
          .toMatch(/\$\{[A-Za-z]*[sS]cope[A-Za-z]*\}/)
      }
    }
  })

  it('applies the predicate before LIMIT, not after (§14)', () => {
    for (const a of tenantScoped) {
      const body = endpointsFor(a)[0]!.body
      const scopeAt = body.search(/\$\{scope(Sql)?\}/)
      // The SQL keyword, not the `limit` variable every paginated handler also
      // declares — matching the identifier would put "LIMIT" before the query.
      const limitAt = body.search(/LIMIT\s+\$/)
      if (scopeAt < 0 || limitAt < 0) continue
      expect(scopeAt, `${a.endpoint} filters after LIMIT, which pages wrongly and leaks occupancy`)
        .toBeLessThan(limitAt)
    }
  })
})

// ─── 4. SELF stays SELF, and the helper refuses to widen it (§28, §39) ──────
describe('a SELF collection is not converted to project membership', () => {
  const selfEntries = COLLECTION_SCOPE_ADOPTION.filter(a => a.disposition === 'SELF_SCOPED_COLLECTION')

  it('leaves the personal collections free of a project predicate', () => {
    expect(selfEntries.length).toBe(7)
    for (const a of selfEntries) {
      expect(endpointsFor(a)[0]!.body, `${a.endpoint} was converted to project scope, which WIDENS it`)
        .not.toMatch(/collectionScopeSql\(/)
    }
  })

  it('makes the helper itself refuse a SELF resource rather than trusting callers', () => {
    // Structural: even if a later slice pointed the helper at `action`, it
    // returns a closed predicate rather than a membership one.
    const resolver = src('api/authz/recordScope.ts')
    const fn = /export function collectionScopeSql[\s\S]*?\n}/.exec(resolver)?.[0] ?? ''
    expect(fn, 'collectionScopeSql was not found').toContain('SELF_SCOPED')
    expect(fn).toMatch(/case 'SELF_SCOPED':[\s\S]{0,400}?return 'AND FALSE'/)
    expect(policyFor('action')!.projectSemantics).toBe('SELF_SCOPED')
  })

  it('fails closed for a resource with no policy at all', () => {
    const fn = /export function collectionScopeSql[\s\S]*?\n}/.exec(src('api/authz/recordScope.ts'))?.[0] ?? ''
    expect(fn).toMatch(/if \(!policy\) return 'AND FALSE'/)
  })
})

// ─── 5. What stays open, stays open for a stated reason (§70, §95) ──────────
describe('the collections this slice does not close are classified, not ignored', () => {
  const aggregate = COLLECTION_SCOPE_ADOPTION.filter(a => a.disposition === 'PROJECT_AGGREGATE')
  const deferred  = COLLECTION_SCOPE_ADOPTION.filter(a => a.disposition === 'DEFERRED_SCOPE_MODEL')

  it('claims holder-neutrality only where every capability really is Owner-only', () => {
    // The claim in §70 is checkable, so it is checked: if any of these routes
    // is ever granted to a second role, the predicate stops being neutral and
    // this assertion fails rather than the gap staying quietly open.
    const OWNER_ONLY = new Set(['portfolio.view', 'crossdomain.read', 'personal.admin', 'cost.view'])
    for (const a of aggregate) {
      const neutral = a.capabilities.some(c => OWNER_ONLY.has(c))
      expect(neutral, `${a.endpoint} is claimed holder-neutral but holds none of the Owner-only capabilities`).toBe(true)
    }
  })

  it('defers nothing: every returned row model now has a record-scope policy', () => {
    // Phase 3F deferred three for want of a policy. Phase 3G wrote two of them
    // — `document_folders` and `source_uploads` — and dissolved the third:
    // `/ops/readiness` returns PROJECTS, not `action_relations`, so it needed
    // the membership predicate `GET /projects` already had rather than a
    // relation-graph model.
    expect(deferred.length).toBe(0)
  })
})

// ─── 6. The extractor defects this slice had to fix (§55, §56) ──────────────
describe('the collection classifier reads what a query RETURNS', () => {
  it('records the outer FROM separately from every joined table', () => {
    const docs = access.endpoints.find(e => e.path === '/api/v1/files/documents' && e.method === 'GET')!
    expect(docs.primaryReadTable, 'documents is what the route returns').toBe('documents')
    expect(docs.readsFrom, 'a JOINed users table is not what it returns').not.toContain('users')
  })

  it('does not mistake a scalar subquery for the outer query', () => {
    // `SELECT t.*, (SELECT count(*) FROM transmittal_items …) FROM transmittals t`
    // — the subquery's FROM comes FIRST in source order, so "first FROM wins"
    // would report the wrong entity for both of these.
    const tx = access.endpoints.find(e => e.path === '/api/v1/transmittals' && e.method === 'GET')!
    expect(tx.primaryReadTable).toBe('transmittals')
    const vendors = access.endpoints.find(e => e.path === '/api/v1/vendors' && e.method === 'GET')!
    expect(vendors.primaryReadTable, 'a vendor registry is not a purchase-order collection').toBe('vendors')
  })

  it('attributes handlers per router in a multi-router file', () => {
    // procurement.ts declares four routers that each serve `GET /`.
    for (const [p, table] of [
      ['/api/v1/vendors', 'vendors'], ['/api/v1/rfis', 'rfis'],
      ['/api/v1/submittals', 'submittals'], ['/api/v1/purchase-orders', 'purchase_orders'],
    ] as const) {
      const e = access.endpoints.find(x => x.path === p && x.method === 'GET')!
      expect(e.primaryReadTable, `${p} was attributed another router's SQL`).toBe(table)
    }
  })

  it('treats `:projectId` as a path project wherever it appears, not only under /projects/', () => {
    for (const p of ['/api/v1/schedule/:projectId/tasks', '/api/v1/schedule/:projectId/dependencies']) {
      const r = registry.registry.find(x => x.path === p && x.method === 'GET')
      expect(r, `${p} left the inventory`).toBeTruthy()
      expect(r!.projectBound, `${p} names a project in its path`).toBe(true)
      expect(r!.disposition).toBe('PROJECT_CHILD_PATH_PROJECT')
    }
  })

  it('keeps the vendor MUTATIONS non-project, which Phase 3D had to say by hand', () => {
    // Before the multi-router fix these read `submittals` — another router's
    // SQL — and so looked project-bound. Phase 3D corrected them in prose; the
    // extractor now agrees mechanically.
    //
    // `GET /api/v1/vendors/:id` is deliberately NOT asserted here. It is still
    // flagged project-bound because the direct-ID rule tests every table the
    // route touches, and the vendor detail JOINs purchase orders. That is the
    // same reads-vs-FROM distinction fixed here for collections, left unfixed
    // for direct-ID reads because changing it would move Phase-3E counters that
    // are not this slice's to move. Phase 3E already classified that route
    // NON_PROJECT_RESOURCE by hand; the gap is recorded as a residual.
    const mutations = registry.registry.filter(
      x => x.path.startsWith('/api/v1/vendors') && x.method !== 'GET')
    expect(mutations.length, 'the vendor mutations left the inventory').toBeGreaterThan(1)
    for (const r of mutations) {
      expect(r.projectBound, `${r.method} ${r.path} is a tenant vendor registry`).toBe(false)
    }
  })
})
