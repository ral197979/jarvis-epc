/**
 * ADR-014 Phase 3A — the record-scope ratchet.
 *
 * Structural counterpart to the two behavioural suites. Every assertion here is
 * derived from source and proves it FOUND its target first, so a renamed
 * function, a moved file or a regex that stops matching fails loudly instead of
 * passing vacuously.
 *
 * Three things are held:
 *   §43  the Phase-3A endpoint set, its enforcement, and the invariants around it
 *   §44  ONE classification engine — the private parser cannot come back
 *   §45  the agent-risk audit actor cannot be supplied by the caller
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  classifiedCensus, classifyEndpoint, censusWithEffectivePaths, ALL_ROUTE_CLASSES,
} from './helpers/endpointCensus'
import {
  RECORD_SCOPE_POLICIES, PROJECT_SCOPE_CANDIDATES, CANONICAL_PROJECT_SCOPE,
  PENDING_PHASE3_POLICY, policyFor, recordScopeAdoption, PHASE_3A_ENDPOINT_CANDIDATES,
} from '../authz/recordScopePolicies'
import { RELATED_SOURCES } from '../services/related/relatedService'
import { isServerCapability, SERVER_ROLE_CAPS, USER_ROLES, type UserRole } from '../authz/capabilities'

const endpoints = classifiedCensus()
const src = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
const holders = (c: string): UserRole[] =>
  USER_ROLES.filter(r => (SERVER_ROLE_CAPS[r] as readonly string[]).includes(c))

const PHASE_3A_ENDPOINTS = [
  'projects.ts router.GET /:id',
  'related.ts router.GET /related/:source/:id',
] as const

// ─── 1. The Phase-3A endpoint set (§43) ───────────────────────────────────────
describe('the Phase 3A endpoint set is exactly the two former deferrals', () => {
  it('still classifies both former deferrals as record-scoped', () => {
    // ADR-014 Phase 3B extended record scope to the project collection, the
    // membership routes and seven domain-child collections, so the scoped set
    // is no longer exactly these two. The Phase 3A invariant that survives is
    // that neither of them regressed — asserted as a SUBSET, with the exact
    // Phase 3B set pinned by the Phase 3B ratchet.
    const scoped = new Set(endpoints.filter(e => e.klass === 'CAPABILITY_RECORD_SCOPE').map(e => e.key))
    for (const key of PHASE_3A_ENDPOINTS) {
      expect(scoped.has(key), `${key} must remain record-scoped`).toBe(true)
    }
    expect(scoped.size, 'Phase 3B widened the scoped set').toBeGreaterThan(PHASE_3A_ENDPOINTS.length)
  })

  it('leaves nothing pending and nothing unclassified', () => {
    expect(endpoints.filter(e => e.klass === 'PENDING_PHASE2').map(e => e.key)).toEqual([])
    const counted = ALL_ROUTE_CLASSES
      .map(k => endpoints.filter(e => e.klass === k).length)
      .reduce((a, b) => a + b, 0)
    expect(counted).toBe(endpoints.length)
  })

  it('keeps both endpoints mounted, so the closure is not vacuous', () => {
    for (const key of PHASE_3A_ENDPOINTS) {
      const e = endpoints.find(x => x.key === key)
      expect(e, `${key} must exist`).toBeTruthy()
      expect(e!.effective.length, `${key} must be mounted`).toBeGreaterThan(0)
    }
  })

  it('awards the class only where source really calls the record-scope layer', () => {
    // The class is DERIVED. A manifest label without enforcement must not earn it.
    for (const e of endpoints.filter(x => x.klass === 'CAPABILITY_RECORD_SCOPE')) {
      expect(e.enforcesRecordScope, `${e.key} must call the record-scope layer`).toBe(true)
      expect(e.body.length, `${e.key} handler body must have been found`).toBeGreaterThan(50)
    }
  })

  it('refuses to award the class to a capability route that does not enforce scope', () => {
    // Mutation-proof of the classifier itself: strip the scope call and the
    // class must fall back to a plain CAPABILITY.
    const real = endpoints.find(e => e.key === 'projects.ts router.GET /:id')!
    const withoutScope = { ...real, enforcesRecordScope: false, enforcesPolicyCapability: false }
    expect(classifyEndpoint(withoutScope)).toBe('CAPABILITY')
  })

  it('refuses to award the class to an unguarded route that only checks scope', () => {
    // A route with no capability guard AND no policy-driven capability is still
    // Phase-2 debt, however much record scope it applies.
    const real = endpoints.find(e => e.key === 'related.ts router.GET /related/:source/:id')!
    const scopeOnly = { ...real, capability: null, enforcesPolicyCapability: false }
    expect(classifyEndpoint(scopeOnly)).toBe('PENDING_PHASE2')
  })
})

// ─── 2. projects GET /:id enforcement (§43) ───────────────────────────────────
describe('GET /projects/:id composes capability, scope and field authority', () => {
  const projects = src('api/routes/projects.ts')

  it('carries a functional capability guard', () => {
    expect(projects).toMatch(/router\.get\('\/:id', requireCapability\('project\.view'\)/)
  })

  it('resolves the LIVE principal, not the token role', () => {
    expect(projects).toMatch(/resolveCurrentUser\(req\)/)
  })

  it('decides record scope before loading the payload', () => {
    const handler = /router\.get\('\/:id'[\s\S]*?\n\}\)/.exec(projects)?.[0]
    expect(handler, 'the handler must be found').toBeTruthy()
    const scopeAt   = handler!.indexOf('canAccessProject(')
    const payloadAt = handler!.indexOf('FROM projects p')
    expect(scopeAt, 'record scope must be enforced').toBeGreaterThan(-1)
    expect(payloadAt, 'the payload query must exist').toBeGreaterThan(-1)
    expect(scopeAt, 'scope must precede the payload query').toBeLessThan(payloadAt)
  })

  it('gates the commercial columns on cost.view', () => {
    expect(projects).toMatch(/PROJECT_COST_FIELDS/)
    for (const f of ['budget', 'committed_cost', 'actual_cost', 'forecast_cost', 'contingency_pct']) {
      expect(projects, `${f} must be in the withheld set`).toMatch(new RegExp(`'${f}'`))
    }
    expect(projects).toMatch(/roleHasCapability\(role, 'cost\.view'\)/)
  })

  it('answers a refused record the same way as a missing one', () => {
    const handler = /router\.get\('\/:id'[\s\S]*?\n\}\)/.exec(projects)![0]
    const notFounds = [...handler.matchAll(/status\(404\)\.json\(\{ error: 'not_found', message: 'Project not found\.' \}\)/g)]
    expect(notFounds.length, 'both the scope refusal and the missing row use one body').toBe(2)
  })
})

// ─── 3. /related enforcement (§43) ────────────────────────────────────────────
describe('GET /related/:source/:id authorizes the source and every target', () => {
  const related = src('api/routes/related.ts')

  it('authorizes the source before loading anything related', () => {
    const sourceAt  = related.indexOf('authorizeSource(')
    const loadAt    = related.indexOf('getRelated(')
    expect(sourceAt).toBeGreaterThan(-1)
    expect(loadAt).toBeGreaterThan(-1)
    expect(sourceAt, 'source authorization must precede target loading').toBeLessThan(loadAt)
  })

  it('filters every group through target authorization', () => {
    expect(related).toMatch(/filterAuthorizedTargets\(/)
  })

  it('drops groups that become empty, so the group list is not a side channel', () => {
    expect(related).toMatch(/if \(permitted\.length > 0\)/)
  })

  it('strips the internal authorization field from returned items', () => {
    expect(related).toMatch(/function publicItem/)
    expect(related).toMatch(/assignedToUserId: _internal/)
  })

  it('resolves the live principal', () => {
    expect(related).toMatch(/resolveCurrentUser\(r\)/)
  })
})

// ─── 4. Policy registry integrity (§26) ───────────────────────────────────────
describe('the record-scope policy registry is complete and fails closed', () => {
  it('declares only registered capabilities', () => {
    for (const p of RECORD_SCOPE_POLICIES) {
      expect(p.capabilities.length, `${p.resource} needs a capability`).toBeGreaterThan(0)
      for (const c of p.capabilities) {
        expect(isServerCapability(c), `${p.resource}: unknown capability ${c}`).toBe(true)
      }
    }
  })

  it('covers every /related source type', () => {
    const missing = [...RELATED_SOURCES].filter(s => policyFor(s) === null)
    expect(missing, `a /related source with no scope policy would fail closed silently: ${missing.join(', ')}`).toEqual([])
    expect(RELATED_SOURCES.size, 'expected the eight declared sources').toBe(8)
  })

  it('covers the action target, which is reachable but not a source', () => {
    expect(policyFor('action')).toBeTruthy()
    expect(policyFor('action')!.strategy).toBe('SELF')
  })

  it('denies an unknown resource type rather than defaulting it open', () => {
    for (const unknown of ['bogus', '', 'project;drop', 'contract', 'invoice']) {
      expect(policyFor(unknown), `${unknown} must have no policy`).toBeNull()
    }
  })

  it('offers no ALLOW_ALL strategy', () => {
    const strategies = new Set(RECORD_SCOPE_POLICIES.map(p => p.strategy))
    expect([...strategies].sort())
      .toEqual(['PARENT_PROJECT', 'SELF', 'TENANT_OWNER_OR_PROJECT_ASSIGNMENT'])
    expect(src('api/authz/recordScopePolicies.ts')).not.toMatch(/'ALLOW_ALL'/)
  })

  it('gives every policy a substantive reason', () => {
    for (const p of RECORD_SCOPE_POLICIES) {
      expect(p.reason.length, `${p.resource} needs a reason`).toBeGreaterThan(40)
      expect(p.tenantRule.length, `${p.resource} needs a tenant rule`).toBeGreaterThan(10)
    }
  })

  it('records an empty deferred-policy set, or the slice is PARTIAL', () => {
    expect([...PENDING_PHASE3_POLICY]).toEqual([])
  })
})

// ─── 5. The canonical scope source is recorded and enforced (§5) ──────────────
describe('the canonical project-scope source is the one the resolver uses', () => {
  const resolver = src('api/authz/recordScope.ts')

  it('records the discovery, with the rejected alternatives and why', () => {
    expect(PROJECT_SCOPE_CANDIDATES.length, 'expected the candidates that were actually found').toBe(3)
    const canonical = PROJECT_SCOPE_CANDIDATES.filter(c => c.verdict === 'CANONICAL')
    expect(canonical, 'exactly one canonical source').toHaveLength(1)
    expect(canonical[0]!.table).toBe('projects')
    for (const c of PROJECT_SCOPE_CANDIDATES) {
      expect(c.why.length, `${c.candidate} needs evidence, not a label`).toBeGreaterThan(80)
    }
  })

  it('rejects project_assignments for the reason that actually disqualifies it', () => {
    const rejected = PROJECT_SCOPE_CANDIDATES.find(c => c.table === 'project_assignments')!
    expect(rejected.verdict).toBe('REJECTED')
    expect(rejected.userKey, 'its user key does not reference users(id)').toMatch(/team_members/)
    // Non-vacuity against the schema itself: the table really does point at the
    // workforce roster, and team_members really has no user_id.
    const migration = src('api/db/migrations/063_team.sql')
    expect(migration).toMatch(/member_id\s+UUID\s+NOT NULL REFERENCES team_members\(id\)/)
    const teamMembers = /CREATE TABLE IF NOT EXISTS team_members \(([\s\S]*?)\n\);/.exec(migration)
    expect(teamMembers, 'team_members must be found').toBeTruthy()
    expect(teamMembers![1], 'team_members must have no user_id').not.toMatch(/^\s*user_id\s/m)
  })

  it('no longer authorizes from the legacy responsible-user columns', () => {
    // ADR-014 Phase 3B §21 — ONE runtime authorization truth. The three project
    // columns are still business data and are still written and displayed, but
    // the resolver must not consult them; `project_members` is the source.
    for (const col of ['project_manager', 'lead_engineer', 'created_by']) {
      expect(resolver, `${col} must not appear in a scope predicate`)
        .not.toMatch(new RegExp(`${col}\\s*=\\s*\\$`))
    }
    expect(resolver, 'membership is the scope source').toMatch(/FROM project_members m/)
    expect(resolver, 'and only ACTIVE membership counts')
      .toMatch(/active_from <= NOW\(\)[\s\S]{0,80}active_to IS NULL OR m\.active_to > NOW\(\)/)
  })

  it('keeps the owner tenant-bounded on both branches', () => {
    const predicates = [...resolver.matchAll(/tenant_id = current_setting\('app\.current_tenant_id', true\)::uuid/g)]
    expect(predicates.length, 'every scope query must be tenant-scoped').toBeGreaterThanOrEqual(3)
    // The owner branch must not be a bare "return true".
    expect(resolver).not.toMatch(/role === 'owner'\s*\)\s*return true/)
  })

  it('takes no scope input from the caller', () => {
    // The resolver must never touch the request. `projectIds` appears as a
    // PARAMETER name, which is fine — what matters is where the values come
    // from, and the resolver is handed ids by the route, never by the client.
    for (const forbidden of ['req.body', 'req.query', 'req.headers']) {
      expect(resolver, `record scope must not read ${forbidden}`).not.toContain(forbidden)
    }
    // `requireProjectScope` is an express guard and legitimately reads the route
    // PARAMETER, which is server-controlled routing, not caller-supplied scope.
    // What must never appear is body/query/header-derived scope, asserted above.

    // And the route layer must not hand caller-supplied ids to it either: the
    // project id comes from the path, and the related ids from the database.
    const projects = src('api/routes/projects.ts')
    expect(projects).toMatch(/canAccessProject\(principal, String\(id\)\)/)
    expect(projects, 'the id is the route parameter, not a body field')
      .toMatch(/const \{ id \} = req\.params/)
  })

  it('fails closed on a database error rather than granting', () => {
    expect(resolver).toMatch(/catch \{\s*\n?\s*\/\/[\s\S]{0,200}?return new Set\(\)/)
  })
})

// ─── 6. Role is not record scope (§7), and admin gains nothing (§8) ───────────
describe('roles confer function, never records', () => {
  it('keeps project.view a functional capability held by the delivery roles', () => {
    expect(holders('project.view'))
      .toEqual(['owner', 'project_manager', 'engineer', 'procurement', 'field_ops', 'viewer'])
  })

  it('gives the platform administrator no project read authority at all', () => {
    expect(holders('project.view'), 'ADR-014 D2').not.toContain('admin')
    expect(SERVER_ROLE_CAPS['admin'] as readonly string[]).not.toContain('project.view')
  })

  it('leaves the viewer read-only and unwidened', () => {
    const viewerCaps = SERVER_ROLE_CAPS['viewer'] as readonly string[]
    expect(viewerCaps.filter(c => !c.endsWith('.view')), 'the viewer holds only *.view').toEqual([])
  })

  it('does not broaden the temporary crossdomain policy (§34)', () => {
    expect(holders('crossdomain.read')).toEqual(['owner'])
    expect(holders('crossdomain.write')).toEqual(['owner'])
  })

  it('keeps cost.view owner-only, which is what makes field gating meaningful', () => {
    expect(holders('cost.view')).toEqual(['owner'])
  })

  it('adds no capability to the registry', () => {
    // Phase 3A reused existing capabilities everywhere. The discriminating pair
    // the /related tests rely on must stay discriminating.
    expect(holders('construction.view')).toEqual(['owner', 'project_manager', 'engineer', 'field_ops'])
    expect(holders('cost.view')).toEqual(['owner'])
  })
})

// ─── 7. ONE classification engine (§44) ───────────────────────────────────────
describe('classification has a single implementation', () => {
  it('leaves no private route parser in authzCoverage', () => {
    const coverage = src('api/__tests__/authzCoverage.test.ts')
    expect(coverage, 'the private guard regex must be gone').not.toMatch(/requireCapability\\\(/)
    expect(coverage, 'no local census function').not.toMatch(/function censusEndpoints/)
    expect(coverage, 'no direct routes-directory read').not.toMatch(/readdirSync/)
    expect(coverage, 'it must consume the canonical engine').toMatch(/classifiedCensus\(\)/)
  })

  it('leaves no private classifier in the residual-taxonomy ratchet', () => {
    const residual = src('api/__tests__/authzResidualTaxonomyRatchet.test.ts')
    expect(residual).toMatch(/classifiedCensus\(\)/)
    expect(residual, 'must not re-derive the class from exceptions')
      .not.toMatch(/ex \? ex\.klass :/)
  })

  it('produces identical endpoint sets and classifications from one engine', () => {
    const raw = censusWithEffectivePaths()
    const classified = classifiedCensus()
    expect(classified.map(e => e.key)).toEqual(raw.map(e => e.key))
    for (const e of classified) {
      expect(e.klass, `${e.key} must match the single classifier`).toBe(classifyEndpoint(e))
    }
    expect(classified.length).toBe(raw.length)
  })
})

// ─── 8. Audit actor cannot be forged (§45) ────────────────────────────────────
describe('the agent-risk audit actor comes from the session', () => {
  const agentRisk = src('api/routes/agentRisk.ts')

  it('never persists a body-supplied actor', () => {
    expect(agentRisk, 'createdBy must not read the request body')
      .not.toMatch(/createdBy:\s*requestedBy/)
    const createdBy = [...agentRisk.matchAll(/createdBy:\s*([^,\n]+)/g)].map(m => m[1]!.trim())
    expect(createdBy.length, 'both mutation routes must be found').toBe(2)
    for (const c of createdBy) {
      expect(c, 'the actor is the authenticated subject').toMatch(/r\.auth\?\.sub/)
    }
  })

  it('no longer destructures an actor out of the body at all', () => {
    expect(agentRisk).not.toMatch(/const \{ scopeType, scopeId, requestedBy \} = req\.body/)
  })
})

// ─── 9. Phase-3 adoption counters (§29) ───────────────────────────────────────
describe('Phase-3 adoption is counted honestly and not overclaimed', () => {
  const adoption = recordScopeAdoption([...RELATED_SOURCES])

  it('protects every resource in the bounded candidate set', () => {
    expect(adoption.unexplained,
      `a resource type with no scope policy: ${adoption.unexplained.join(', ')}`).toEqual([])
    expect(adoption.deferred, 'a deferred type downgrades the slice to PARTIAL').toEqual([])
  })

  it('counts the two endpoints plus the ten resource types, and no more', () => {
    // 8 /related sources + project + action. Deliberately NOT the whole API:
    // claiming 744 endpoints were record-scoped would be false.
    expect(adoption.protectedBy.length).toBe(10)
    expect(adoption.candidates.length).toBe(12)
    expect([...PHASE_3A_ENDPOINT_CANDIDATES]).toEqual([...PHASE_3A_ENDPOINTS])
  })

  it('reports an unexplained type the moment a policy disappears', () => {
    // Non-vacuity: the counter must actually detect a gap, not always be empty.
    const withUnknown = recordScopeAdoption([...RELATED_SOURCES, 'contract'])
    expect(withUnknown.unexplained).toEqual(['contract'])
  })

  it('does not claim record scope for the rest of the API', () => {
    const scoped = endpoints.filter(e => e.klass === 'CAPABILITY_RECORD_SCOPE').length
    const plain  = endpoints.filter(e => e.klass === 'CAPABILITY').length
    // Phase 3B scoped 15 of ~747. Adoption is real but partial, and saying so
    // is the point — a later slice must not be able to imply full coverage.
    expect(scoped).toBe(15)
    expect(plain, 'the rest remain capability-only, which is the honest state').toBeGreaterThan(700)
  })
})

// ─── 10. denverMcp non-regression (§33) ───────────────────────────────────────
describe('denverMcp stays owner-decided dormant', () => {
  const server = src('api/server.ts')

  it('is neither imported nor mounted', () => {
    expect(server).not.toMatch(/from '\.\/routes\/denverMcp'/)
    expect(server).not.toMatch(/denverMcpRouter/)
  })

  it('has no effective route path and stays UNMOUNTED', () => {
    const mcp = endpoints.filter(e => e.file === 'denverMcp.ts')
    expect(mcp.length).toBe(2)
    for (const e of mcp) {
      expect(e.effective).toEqual([])
      expect(e.klass).toBe('UNMOUNTED')
    }
  })

  it('stays flag-gated off in every environment file', () => {
    for (const f of ['.env.example', 'fly.toml', 'fly.staging.toml']) {
      expect(src(f), `${f}`).toMatch(/DENVER_MCP_SERVER\s*=\s*"?false"?/)
    }
  })
})
