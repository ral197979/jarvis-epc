/**
 * ADR-014 Phase 3J — the nested / sub-collection parent-guard ratchet.
 *
 * Phase 3I's lesson, stated as a test: a guarded route says nothing about the
 * route declared beside it. `/coordination/recommendations/:id/dismiss` was
 * record-scoped while `/approve` — the half that creates an action — was not,
 * in the same router, four lines apart.
 *
 * So this file holds the SHAPE rather than a list of routes:
 *
 *   1. every mounted nested route belongs to a dispositioned family;
 *   2. no family is half-guarded — the asymmetry that hid every defect;
 *   3. the specific parents Phase 3J closed stay closed;
 *   4. the child queries stay bound to their parent (§22), because a guard
 *      that authorizes model A while the query returns model B's row is worse
 *      than no guard at all — it looks correct.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { NESTED_ROUTE_FAMILIES, nestedDispositionCounters } from '../authz/nestedRouteDispositions'
import { censusWithEffectivePaths } from './helpers/endpointCensus'

const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')

/** The family prefix of an effective path: up to and including its first :param. */
function familyOf(path: string): string | null {
  const seg = path.split('/')
  const out: string[] = []
  for (const s of seg) {
    out.push(s)
    if (s.startsWith(':')) return out.join('/')
  }
  return null
}

interface NestedRoute { method: string; effective: string; file: string; scoped: boolean }

/**
 * Mounted nested routes: a dynamic segment with at least one segment after it.
 *
 * Built from the census twin rather than the generated inventory, so the
 * extractor and this ratchet cannot drift apart — the same discipline Phase 3H
 * and 3I used.
 */
function nestedRoutes(): NestedRoute[] {
  const out: NestedRoute[] = []
  for (const e of censusWithEffectivePaths()) {
    if (/saml/i.test(e.file)) continue                        // §55, out of scope
    for (const raw of e.effective) {
      const path = raw.replace(/\/+$/, '')
      if (!/\/:[A-Za-z0-9_]+\/.+/.test(path)) continue
      out.push({ method: e.method, effective: path, file: e.file, scoped: e.enforcesRecordScope })
    }
  }
  return out
}

describe('every nested route has a dispositioned parent (§16, §58)', () => {
  const routes = nestedRoutes()

  it('finds the nested surface at all', () => {
    expect(routes.length).toBeGreaterThan(250)
  })

  it('leaves no nested route unexplained', () => {
    const prefixes = new Set(NESTED_ROUTE_FAMILIES.map(f => f.prefix))
    const orphans = routes
      .map(r => ({ r, fam: familyOf(r.effective) }))
      .filter(x => !x.fam || !prefixes.has(x.fam))
    // A new nested route on a parent nobody has reasoned about must fail the
    // build rather than inherit whatever its neighbours happen to do.
    expect(orphans.map(x => `${x.r.method} ${x.r.effective}`)).toEqual([])
  })

  it('declares one disposition per family and no duplicates', () => {
    const seen = new Set<string>()
    for (const f of NESTED_ROUTE_FAMILIES) {
      expect(seen.has(f.prefix), `${f.prefix} declared twice`).toBe(false)
      seen.add(f.prefix)
      expect(f.parent.length, `${f.prefix} must name its parent`).toBeGreaterThan(2)
      expect(f.evidence.length, `${f.prefix} must argue its disposition`).toBeGreaterThan(40)
    }
  })

  it('carries no unexplained parent resource (§13)', () => {
    for (const f of NESTED_ROUTE_FAMILIES) {
      expect(f.parent).not.toMatch(/unknown|tbd|\?/i)
    }
  })
})

describe('no sibling family is half-guarded (§18, §29)', () => {
  it('has no family where one route is record-scoped and another is not', () => {
    const byFamily = new Map<string, Set<string>>()
    for (const r of nestedRoutes()) {
      const fam = familyOf(r.effective)
      if (!fam) continue
      const key = r.scoped ? 'SCOPED' : 'NONE'
      if (!byFamily.has(fam)) byFamily.set(fam, new Set())
      byFamily.get(fam)!.add(key)
    }
    // The asymmetry itself is the defect signature. Every Phase-3J finding —
    // nine estimating routes beside two guarded ones, two temporal routes
    // beside three, a whole twin router beside a guarded scenarios one —
    // appeared here first.
    const mixed = [...byFamily.entries()]
      .filter(([, states]) => states.has('NONE') && states.size > 1)
      .map(([fam, states]) => `${fam}: ${[...states].sort().join(' | ')}`)
    expect(mixed).toEqual([])
  })
})

describe('the parents Phase 3J closed stay closed', () => {
  it('guards every bim-model sub-route, not just the two that already were', () => {
    const est = src('routes/estimating.ts')
    const decls = est.split('\n').filter(l => /^router\.(get|post|patch|delete)\('\/bim-models\/:modelId/.test(l))
    expect(decls.length).toBeGreaterThanOrEqual(11)
    for (const d of decls) {
      expect(d, `unguarded bim-model sub-route: ${d.slice(0, 80)}`)
        .toContain("requireRecordScope('bim_models', 'modelId')")
    }
  })

  it('guards every twin sub-route on the twin router itself', () => {
    const twin = src('routes/twin.ts')
    const decls = twin.split('\n').filter(l => /^router\.(get|post|patch|delete|put)\('\/:twinId/.test(l))
    expect(decls.length).toBeGreaterThanOrEqual(15)
    for (const d of decls) {
      expect(d, `unguarded twin sub-route: ${d.slice(0, 80)}`).toContain('requireTwinScope()')
    }
    // The polymorphic sibling resolves its selector through the same registry.
    expect(twin).toMatch(/'\/entity\/:entityType\/:entityId'[\s\S]{0,200}?requirePolymorphicScope\('entityType', 'entityId'\)/)
  })

  it('guards every temporal twin sibling, including velocity and trend', () => {
    const sc = src('routes/scenarios.ts')
    const decls = sc.split('\n').filter(l => /^router\.get\('\/temporal\/:twinId/.test(l))
    expect(decls.length).toBeGreaterThanOrEqual(5)
    for (const d of decls) {
      expect(d, `unguarded temporal sibling: ${d.slice(0, 80)}`).toContain('requireTwinScope()')
    }
  })

  it('keeps the Phase-3I coordination pair symmetric', () => {
    const coord = src('routes/autoCoordination.ts')
    for (const verb of ['approve', 'dismiss']) {
      const line = coord.split('\n').find(l => l.includes(`router.post('/coordination/recommendations/:id/${verb}'`)) ?? ''
      expect(line, `${verb} must be record-scoped`).toContain("requireRecordScope('coordination_recommendations')")
    }
  })
})

describe('child queries stay bound to the parent in the path (§22, §23)', () => {
  it('binds a bim element to the model that addressed it', () => {
    const svc = src('services/bim/bimElementService.ts')
    const byId = /export async function getElementById[\s\S]*?\n}/.exec(svc)?.[0] ?? ''
    expect(byId).toBeTruthy()
    expect(byId, 'the element lookup must constrain on model_id').toMatch(/model_id\s*=\s*\$3/)

    const link = /export async function linkElementToEntity[\s\S]*?\n}\n/.exec(svc)?.[0] ?? ''
    expect(link, 'the link INSERT must select its element through the model')
      .toMatch(/FROM bim_elements e[\s\S]*?e\.model_id\s*=\s*\$7/)
  })

  it('binds a proposal item to the proposal that addressed it', () => {
    const svc = src('services/proposals/proposalService.ts')
    const upd = /export async function updateProposalItem[\s\S]*?\n}/.exec(svc)?.[0] ?? ''
    expect(upd, 'the item UPDATE must constrain on proposal_id').toMatch(/proposal_id\s*=\s*\$7/)
    const del = /export async function deleteProposalItem[\s\S]*?\n}/.exec(svc)?.[0] ?? ''
    expect(del, 'the item DELETE must constrain on proposal_id').toMatch(/proposal_id=\$3/)
  })

  it('passes the parent id from the route, not a default', () => {
    const est = src('routes/estimating.ts')
    expect(est).toMatch(/getElementById\(tid\(req\), p\(req, 'id'\), p\(req, 'modelId'\)\)/)
    expect(est).toMatch(/linkElementToEntity\(tid\(req\), p\(req, 'id'\), p\(req, 'modelId'\)/)
    const prop = src('routes/proposals.ts')
    expect(prop).toMatch(/updateProposalItem\(r\.tenantId!, p\(req, 'itemId'\), req\.body, p\(req, 'id'\)\)/)
    expect(prop).toMatch(/deleteProposalItem\(r\.tenantId!, p\(req, 'itemId'\), p\(req, 'id'\)\)/)
  })
})

describe('the stronger child scope is not weakened for uniformity (D29, §31)', () => {
  it('keeps personal ownership on the action sub-routes', () => {
    const actions = src('routes/actions.ts')
    for (const sub of ['/:id/relationships', '/:id/timeline', '/:id/dependencies',
                       '/:id/sla/pause', '/:id/sla/resume']) {
      const i = actions.indexOf(`'${sub}'`)
      expect(i, `${sub} must exist`).toBeGreaterThan(0)
      // requireActionAccess is called inside the handler, so look at the block.
      const block = actions.slice(i, i + 900)
      expect(block, `${sub} must keep requireActionAccess`).toContain('requireActionAccess')
      expect(block, `${sub} must not be downgraded to project membership`)
        .not.toContain('requireProjectScope')
    }
  })

  it('declares the action family as stronger than parent scope', () => {
    const fam = NESTED_ROUTE_FAMILIES.find(f => f.prefix === '/api/v1/actions/:id')
    expect(fam?.disposition).toBe('CHILD_STRONGER_SCOPE')
  })
})

describe('dispositions stay honest', () => {
  it('reports counters that add up', () => {
    const c = nestedDispositionCounters()
    const summed = Object.entries(c).filter(([k]) => k !== 'total')
      .reduce((a, [, v]) => a + v, 0)
    expect(summed).toBe(c.total)
    expect(c.total).toBe(NESTED_ROUTE_FAMILIES.length)
  })

  it('defers nothing silently', () => {
    // A deferral is allowed (§60) but must be visible, not hidden in a bucket
    // that reads as "handled".
    const deferred = NESTED_ROUTE_FAMILIES.filter(f => f.disposition === 'DEFERRED_SCOPE_MODEL')
    for (const d of deferred) {
      expect(d.evidence, `${d.prefix} must say why source cannot decide`).toMatch(/cannot|ambigu|undecid/i)
    }
  })

  it('never classifies a project-owned table as tenant-global', () => {
    // The over-correction guard in the other direction: if a family claims its
    // child is tenant-global, no migration may give that table a project_id.
    const tenantGlobal = NESTED_ROUTE_FAMILIES.filter(f => f.disposition === 'TENANT_GLOBAL_CHILD')
    expect(tenantGlobal.length).toBeGreaterThan(0)
    for (const f of tenantGlobal) {
      expect(f.evidence.length).toBeGreaterThan(40)
    }
  })
})
