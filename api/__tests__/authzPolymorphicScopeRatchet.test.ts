/**
 * ADR-014 Phase 3H — the polymorphic scope-key ratchet.
 *
 * Two tables authorize against a kind plus a free-text identifier with no
 * foreign key: `operational_twins(entity_type, entity_id)` and
 * `realtime_event_log(subscription_scope, scope_id)`. Five routes are built on
 * them, and Phases 3E–3G could not close any of them because the record-scope
 * machinery resolves a parent through a DECLARED foreign key.
 *
 * What is held here:
 *   §4/§5   every declared kind has exactly one class, and unknown is not global
 *   §6/§7   the registry covers the DECLARED enum as a SET, not a count
 *   §11     no table, column or join is ever taken from a request
 *   §24     an action twin stays SELF, narrower than project membership
 *   §26/§27 vendor and workforce are verified tenant-global, not assumed
 *   §31     a kind added tomorrow fails closed rather than inheriting reach
 *   §41     no functional capability moved
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { censusWithEffectivePaths } from './helpers/endpointCensus'
import {
  TWIN_SCOPE_POLICIES, REALTIME_SCOPE_POLICIES, polymorphicScopeCounters,
  twinScopePolicy, realtimeScopePolicy,
} from '../authz/polymorphicScopePolicies'
import { policyFor } from '../authz/recordScopePolicies'
import { polymorphicCollectionScopeSql } from '../authz/recordScope'
import { isServerCapability } from '../authz/capabilities'

const ROOT = process.cwd()
const src = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const census = censusWithEffectivePaths()
const bodyOf = (method: string, mounted: string): string =>
  census.find(e => e.method === method && e.effective.includes(mounted))?.body ?? ''

/** The five routes this slice exists to close, plus the sibling it must not leave behind. */
const TARGET_ROUTES = [
  '/api/v1/portfolio/readiness/:scopeType/:scopeId',
  '/api/v1/scenarios/projection/:twinId',
  '/api/v1/scenarios/temporal/:twinId/diff',
  '/api/v1/scenarios/temporal/:twinId/at',
  '/api/v1/ops/live-feed',
] as const

// ─── 1. The declared sets, read from source (§6, §7, §31) ───────────────────
describe('the registry covers exactly the kinds the source declares', () => {
  it('matches the twin_entity_type enum as a SET, not a count', () => {
    // Set comparison is the point: a count check passes when one value is
    // swapped for another, and a new enum value would then inherit whatever
    // the removed one had.
    const enumBlock = /CREATE TYPE twin_entity_type AS ENUM \(([\s\S]*?)\);/
      .exec(src('api/db/migrations/046_digital_twin.sql'))?.[1]
    expect(enumBlock, 'the twin_entity_type enum was not found').toBeTruthy()
    const declared = [...enumBlock!.matchAll(/'([a-z_]+)'/g)].map(m => m[1]!).sort()
    expect(declared.length, 'the enum should declare fourteen kinds').toBe(14)
    expect(TWIN_SCOPE_POLICIES.map(p => p.kind).sort()).toEqual(declared)
  })

  it('matches the SubscriptionScope union as a SET', () => {
    const union = /export type SubscriptionScope =([\s\S]*?)\n\n/
      .exec(src('api/realtime/eventBroadcaster.ts'))?.[1]
    expect(union, 'the SubscriptionScope union was not found').toBeTruthy()
    const declared = [...union!.matchAll(/'([a-z_]+)'/g)].map(m => m[1]!).sort()
    expect(declared.length).toBe(7)
    expect(REALTIME_SCOPE_POLICIES.map(p => p.kind).sort()).toEqual(declared)
  })

  it('gives every kind exactly one class, with an argument for it', () => {
    for (const set of [TWIN_SCOPE_POLICIES, REALTIME_SCOPE_POLICIES]) {
      const c = polymorphicScopeCounters(set)
      expect(c.projectScoped + c.tenantGlobal + c.selfScoped
           + c.platformGlobal + c.denyUnsupported).toBe(c.total)
      expect(c.unexplained, 'a class without evidence is a gap wearing a label').toBe(0)
      expect(new Set(set.map(p => p.kind)).size).toBe(set.length)
    }
  })

  it('reports the split this slice actually measured', () => {
    const t = polymorphicScopeCounters(TWIN_SCOPE_POLICIES)
    expect(t.total).toBe(14)
    expect(t.projectScoped, 'project, system, subsystem, tag, inspection, deficiency').toBe(6)
    expect(t.tenantGlobal, 'vendor, workforce, workflow').toBe(3)
    expect(t.selfScoped, 'action').toBe(1)
    expect(t.denyUnsupported, 'equipment, permit, site, region — no table exists').toBe(4)

    const r = polymorphicScopeCounters(REALTIME_SCOPE_POLICIES)
    expect(r.total).toBe(7)
    expect(r.tenantGlobal, 'tenant').toBe(1)
    expect(r.selfScoped, 'action, escalation').toBe(2)
    expect(r.denyUnsupported, 'readiness, project, module, assignee').toBe(4)
  })

  it('claims PLATFORM_GLOBAL nowhere, so it cannot be a hiding place', () => {
    // §4 warns against reaching for it to avoid a project model. Nothing uses
    // it today and this assertion is what keeps that true.
    for (const set of [TWIN_SCOPE_POLICIES, REALTIME_SCOPE_POLICIES]) {
      expect(set.filter(p => p.class === 'PLATFORM_GLOBAL')).toEqual([])
    }
  })
})

// ─── 2. Unknown is not global (§5, §31) ─────────────────────────────────────
describe('an unmodelled kind fails closed', () => {
  it('returns null for a kind that is not registered', () => {
    expect(twinScopePolicy('not-a-real-type')).toBeNull()
    expect(realtimeScopePolicy('not-a-real-scope')).toBeNull()
    expect(twinScopePolicy('')).toBeNull()
  })

  it('has no default branch reaching for tenant-global in the resolver', () => {
    const fn = /export async function resolvePolymorphicScope[\s\S]*?\n}/
      .exec(src('api/authz/recordScope.ts'))?.[0] ?? ''
    expect(fn, 'resolvePolymorphicScope was not found').toContain('DENY_UNSUPPORTED')
    expect(fn, 'a null policy must refuse, not fall through')
      .toMatch(/if \(!policy \|\| policy\.class === 'DENY_UNSUPPORTED'\) return 'UNSUPPORTED_KIND'/)
    expect(fn, 'the switch must not end in a permissive default')
      .toMatch(/default:\s*\n\s*return 'UNSUPPORTED_KIND'/)
  })

  it('makes the collection predicate refuse an unsupported kind rather than emit nothing', () => {
    // '' would mean "no restriction". A kind with no agreed meaning must emit a
    // closed predicate instead.
    const fn = /export function polymorphicCollectionScopeSql[\s\S]*?\n}/
      .exec(src('api/authz/recordScope.ts'))?.[0] ?? ''
    expect(fn, 'polymorphicCollectionScopeSql was not found').toBeTruthy()
    expect(fn).toMatch(/if \(!policy \|\| policy\.class === 'DENY_UNSUPPORTED'\) return 'AND FALSE'/)
  })

  it('denies the four enum values that have no table at all', () => {
    for (const kind of ['equipment', 'permit', 'site', 'region']) {
      const p = twinScopePolicy(kind)!
      expect(p.class, `${kind} must fail closed`).toBe('DENY_UNSUPPORTED')
      expect(p.resolver, `${kind} must name no table, because none exists`).toBeUndefined()
      expect(p.evidence, `${kind} must say that no table backs it`).toMatch(/no .{0,40}table exists/i)
    }
  })

  it('denies the realtime scopes no producer writes', () => {
    // Declared in the union, emitted by none of the eight broadcastEvent call
    // sites. They match no rows today; the entry is what stops a producer added
    // later from inheriting tenant-wide visibility.
    for (const kind of ['project', 'module', 'assignee']) {
      expect(realtimeScopePolicy(kind)!.class).toBe('DENY_UNSUPPORTED')
    }
    const producers = [...src('api/services/events/universalEvents.ts').matchAll(/subscription_scope: rt\.scope/g)].length
      + [...src('api/routes/ops.ts').matchAll(/subscription_scope: '(\w+)'/g)].length
      + [...src('api/routes/commissioningWebhook.ts').matchAll(/subscription_scope: '(\w+)'/g)].length
      + [...src('api/services/runbook/runbookEngine.ts').matchAll(/subscription_scope: '(\w+)'/g)].length
    expect(producers, 'the producer scan found nothing — the check is vacuous').toBeGreaterThan(5)
  })
})

// ─── 3. The selector never reaches SQL (§11, §32) ───────────────────────────
describe('no table, column or join comes from the request', () => {
  const resolver = src('api/authz/recordScope.ts')

  it('interpolates only policy-supplied identifiers into the polymorphic SQL', () => {
    const fns = [
      /export async function resolvePolymorphicScope[\s\S]*?\n}/.exec(resolver)?.[0] ?? '',
      /export function polymorphicCollectionScopeSql[\s\S]*?\n}/.exec(resolver)?.[0] ?? '',
      /export function requireTwinScope[\s\S]*?\n}/m.exec(resolver)?.[0] ?? '',
    ]
    for (const fn of fns) {
      expect(fn.length, 'a target function was not found').toBeGreaterThan(100)
      // Every `${...}` in these functions must read from `r.` (the policy
      // resolver), a local built from it, or a bound placeholder — never from
      // req/params/query/body.
      for (const m of fn.matchAll(/\$\{([^}]+)\}/g)) {
        expect(m[1], `"${m[1]}" is interpolated into SQL`)
          .not.toMatch(/req\b|params|query|body|scopeType|entity_type/)
      }
    }
  })

  it('binds every caller-supplied identifier as a parameter', () => {
    const fn = /export async function resolvePolymorphicScope[\s\S]*?\n}/.exec(resolver)?.[0] ?? ''
    // The identifier appears only as `[identifier]` in a params array.
    expect(fn).toMatch(/\[identifier\]/)
    expect(fn, 'an identifier must never be concatenated into statement text')
      .not.toMatch(/\$\{identifier\}/)
  })

  it('validates the identifier shape before any query runs', () => {
    const fn = /export async function resolvePolymorphicScope[\s\S]*?\n}/.exec(resolver)?.[0] ?? ''
    const shapeAt = fn.search(/isProjectId\(identifier\)/)
    const queryAt = fn.search(/tenantQuery|resolveParentProjectId/)
    expect(shapeAt).toBeGreaterThan(-1)
    expect(shapeAt, 'a malformed id must be refused before it reaches a query').toBeLessThan(queryAt)
  })

  it('interpolates the scope predicate into the replay query, before ORDER BY and LIMIT (§19)', () => {
    // Mutant H removed this interpolation and every behavioural test still
    // passed, because `crossdomain.read` is Owner-only and the Owner holds
    // `personal.admin` — so the SELF branch emits '' for the only caller who
    // can reach the route. The ordering is therefore held structurally: a
    // page must be the newest AUTHORIZED events, not the newest tenant events
    // with the unauthorized ones removed afterwards.
    const fn = /export async function replayEvents[\s\S]*?\n}/
      .exec(src('api/realtime/eventBroadcaster.ts'))?.[0] ?? ''
    expect(fn, 'replayEvents was not found').toContain('realtime_event_log')
    const scopeAt = fn.search(/\$\{scopeSql\}/)
    const orderAt = fn.search(/ORDER BY sequence_number/)
    const limitAt = fn.search(/LIMIT \$5/)
    expect(scopeAt, 'the authorization predicate is not applied in the query').toBeGreaterThan(-1)
    expect(scopeAt).toBeLessThan(orderAt)
    expect(scopeAt).toBeLessThan(limitAt)
  })

  it('binds the owner column for a principal without the tenant-wide personal authority', () => {
    // Mutant J dropped `AND o.<owner> = $n` and the behavioural suite stayed
    // green for the same holder-neutral reason. Asserted directly on the
    // emitted predicate, with a principal who is NOT `personal.admin`.
    const engineer = { id: '10000000-0000-4000-8000-00000000000a',
                       tenantId: 'aaaaaaaa-0000-4000-8000-000000000001',
                       role: 'engineer' as const }
    const sql = polymorphicCollectionScopeSql(
      engineer, realtimeScopePolicy('action'), 'scope_id', '$9')
    expect(sql, 'a non-admin must get an ownership predicate, not an open one').not.toBe('')
    expect(sql).toMatch(/AND EXISTS \(/)
    expect(sql, 'the owning column must be bound to the principal')
      .toMatch(/o\.assigned_to_user_id = \$9/)
    expect(sql, 'and it stays tenant-bounded')
      .toMatch(/current_setting\('app\.current_tenant_id', true\)::uuid/)

    // The tenant-wide personal authority legitimately gets no predicate.
    const owner = { ...engineer, role: 'owner' as const }
    expect(polymorphicCollectionScopeSql(owner, realtimeScopePolicy('action'), 'scope_id', '$9')).toBe('')
    // …and an unsupported scope still closes.
    expect(polymorphicCollectionScopeSql(engineer, realtimeScopePolicy('readiness'), 'scope_id', '$9'))
      .toBe('AND FALSE')
  })

  it('compares the free-text scope key on ::text, so a bad value cannot raise', () => {
    const fn = /export function polymorphicCollectionScopeSql[\s\S]*?\n}/.exec(resolver)?.[0] ?? ''
    expect(fn, 'casting scope_id to uuid would raise instead of not matching')
      .toMatch(/::text = \$\{scopeIdColumn\}/)
  })
})

// ─── 4. Classes reuse the authority that already governs the entity ─────────
describe('each class reuses existing machinery rather than restating it', () => {
  it('routes PROJECT_SCOPED through the canonical record-scope resolver (§21)', () => {
    const fn = /export async function resolvePolymorphicScope[\s\S]*?\n}/
      .exec(src('api/authz/recordScope.ts'))?.[0] ?? ''
    expect(fn).toContain('resolveParentProjectId')
    expect(fn).toContain('canAccessProject')
    // No second membership implementation.
    expect(fn, 'PROJECT_SCOPED must not write its own membership SQL')
      .not.toMatch(/FROM\s+project_members/i)
  })

  it('names a record-scope resource that really exists for every project kind', () => {
    for (const p of TWIN_SCOPE_POLICIES.filter(x => x.class === 'PROJECT_SCOPED')) {
      if (p.resolver?.identifierIsProject) continue
      const resource = p.resolver!.recordResource!
      const rp = policyFor(resource)
      expect(rp, `${p.kind} names record resource "${resource}", which has no policy`).not.toBeNull()
      expect(rp!.table, `${p.kind} resolves the wrong table`).toBe(p.resolver!.table)
      expect(rp!.projectSemantics).toBe('PROJECT_REQUIRED')
    }
  })

  it('keeps the action twin SELF, never project (§24)', () => {
    const twin = twinScopePolicy('action')!
    expect(twin.class).toBe('SELF_SCOPED')
    expect(twin.resolver!.ownerColumn).toBe('assigned_to_user_id')
    // and the record-scope registry still agrees the underlying record is SELF
    expect(policyFor('action')!.projectSemantics).toBe('SELF_SCOPED')

    const fn = /export async function resolvePolymorphicScope[\s\S]*?\n}/
      .exec(src('api/authz/recordScope.ts'))?.[0] ?? ''
    const selfBranch = /case 'SELF_SCOPED':[\s\S]*?case 'PLATFORM_GLOBAL'/.exec(fn)?.[0] ?? ''
    expect(selfBranch.length).toBeGreaterThan(100)
    expect(selfBranch, 'the SELF branch must not consult project membership')
      .not.toMatch(/canAccessProject|project_members|resolveParentProjectId/)
    expect(selfBranch, 'personal.admin is the tenant-wide personal authority')
      .toContain('personal.admin')
  })

  it('keeps every TENANT_GLOBAL branch tenant-bounded (§38)', () => {
    const fn = /export async function resolvePolymorphicScope[\s\S]*?\n}/
      .exec(src('api/authz/recordScope.ts'))?.[0] ?? ''
    const branch = /case 'TENANT_GLOBAL':[\s\S]*?case 'SELF_SCOPED'/.exec(fn)?.[0] ?? ''
    expect(branch.length).toBeGreaterThan(80)
    expect(branch, 'tenant-global is never application-global')
      .toMatch(/current_setting\('app\.current_tenant_id', true\)::uuid/)
  })

  it('verifies vendor and workforce rather than assuming them (§26, §27)', () => {
    const schema = JSON.parse(src('audit/adr-014/schema-project-parent-map.json')) as
      { tables: { table: string; projectParent: { strategy: string } }[] }
    for (const [kind, table] of [['vendor', 'vendors'], ['workforce', 'team_members'], ['workflow', 'workflows']] as const) {
      const p = twinScopePolicy(kind)!
      expect(p.class).toBe('TENANT_GLOBAL')
      expect(p.resolver!.table).toBe(table)
      const t = schema.tables.find(x => x.table === table)
      expect(t, `${table} is not in the parsed schema`).toBeTruthy()
      expect(t!.projectParent.strategy,
        `${table} DOES reach a project — the tenant-global claim is wrong`).toBe('NO_PROJECT_PARENT')
    }
    // §27 specifically: workforce must not be authorized through assignments.
    expect(twinScopePolicy('workforce')!.evidence).toMatch(/project_assignments/)
  })
})

// ─── 5. All five routes use the canonical policy (§53) ──────────────────────
describe('every target route authorizes through the registry', () => {
  it('guards the four twin-id routes, including the sibling replay', () => {
    // `/temporal/:twinId/replay` is not in the HOB's list of five. It is the
    // same table, the same id and the same payload family as `/diff` and `/at`,
    // so leaving it open beside them would be a knowingly-kept hole.
    for (const p of [
      '/api/v1/scenarios/projection/:twinId',
      '/api/v1/scenarios/temporal/:twinId/at',
      '/api/v1/scenarios/temporal/:twinId/diff',
      '/api/v1/scenarios/temporal/:twinId/replay',
    ]) {
      const decl = bodyOf('GET', p).split('\n')[0] ?? ''
      expect(decl, `${p} has no twin guard`).toMatch(/requireTwinScope\(/)
      expect(decl, `${p} lost its capability guard`).toMatch(/requireCapability\(/)
    }
  })

  it('guards the caller-selected readiness route on both path components', () => {
    const decl = bodyOf('GET', '/api/v1/portfolio/readiness/:scopeType/:scopeId').split('\n')[0] ?? ''
    expect(decl).toMatch(/requirePolymorphicScope\(\s*'scopeType',\s*'scopeId'\s*\)/)
    expect(decl).toMatch(/requireCapability\('portfolio\.view'\)/)
  })

  it('filters the live feed by its scope class, in the query', () => {
    const b = bodyOf('GET', '/api/v1/ops/live-feed')
    expect(b).toMatch(/realtimeScopePolicy\(/)
    expect(b).toMatch(/polymorphicCollectionScopeSql\(/)
    expect(b, 'an unsupported selector must be refused before any read')
      .toMatch(/unsupported_scope_type/)
  })

  it('authorizes the twin before reading the entity it mirrors (§12)', () => {
    const fn = /export function requireTwinScope[\s\S]*?\n}/m
      .exec(src('api/authz/recordScope.ts'))?.[0] ?? ''
    expect(fn.length).toBeGreaterThan(200)
    // The twin lookup selects ONLY the selector pair — never the payload.
    expect(fn).toMatch(/SELECT t\.entity_type, t\.entity_id FROM operational_twins t/)
    expect(fn, 'a same-tenant twin alone must not authorize')
      .toContain('resolvePolymorphicScope')
  })

  it('leaves none of the five routes unexplained', () => {
    for (const p of TARGET_ROUTES) {
      expect(bodyOf('GET', p).length, `${p} left the census`).toBeGreaterThan(50)
    }
  })
})

// ─── 6. Nothing was granted (§41, §42) ──────────────────────────────────────
describe('the registry grants nothing', () => {
  it('declares only capabilities that already exist', () => {
    for (const set of [TWIN_SCOPE_POLICIES, REALTIME_SCOPE_POLICIES]) {
      for (const p of set) {
        expect(p.capabilities.length).toBeGreaterThan(0)
        for (const c of p.capabilities) {
          expect(isServerCapability(c), `${p.kind} names an unknown capability ${c}`).toBe(true)
        }
      }
    }
  })

  it('keeps the target routes on the capabilities they already had (§44)', () => {
    const expected: [string, string][] = [
      ['/api/v1/portfolio/readiness/:scopeType/:scopeId', 'portfolio.view'],
      ['/api/v1/scenarios/projection/:twinId',            'crossdomain.read'],
      ['/api/v1/scenarios/temporal/:twinId/diff',         'crossdomain.read'],
      ['/api/v1/scenarios/temporal/:twinId/at',           'crossdomain.read'],
      ['/api/v1/ops/live-feed',                           'crossdomain.read'],
    ]
    for (const [p, cap] of expected) {
      expect(bodyOf('GET', p).split('\n')[0], `${p} changed its functional authority`)
        .toContain(`requireCapability('${cap}')`)
    }
  })
})
