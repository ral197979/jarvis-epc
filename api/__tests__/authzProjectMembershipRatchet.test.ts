/**
 * ADR-014 Phase 3B — the membership ratchet (§56).
 *
 * Structural counterpart to the behavioural suites. Everything here is derived
 * from source or from the migration file, and each assertion proves it FOUND
 * its target before asserting anything about it, so a renamed column or a moved
 * file fails loudly instead of passing vacuously.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { classifiedCensus, ALL_ROUTE_CLASSES } from './helpers/endpointCensus'
import { SERVER_ROLE_CAPS, USER_ROLES, isServerCapability, type UserRole } from '../authz/capabilities'
import { SYSTEM_SOURCES, MANUAL_SOURCE, isSystemSource } from '../services/projects/projectMembershipService'
import { COLLECTION_ADOPTION, phase3Counters } from '../authz/recordScopePolicies'

const src = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
const holders = (c: string): UserRole[] =>
  USER_ROLES.filter(r => (SERVER_ROLE_CAPS[r] as readonly string[]).includes(c))

const migration = src('api/db/migrations/086_project_members.sql')
const resolver  = src('api/authz/recordScope.ts')
const projects  = src('api/routes/projects.ts')
const service   = src('api/services/projects/projectMembershipService.ts')
const endpoints = classifiedCensus()

// ─── 1. The relation exists, with the constraints that make it safe ──────────
describe('project_members is a real, constrained relation', () => {
  it('is created with tenant, project, user, source and a lifecycle', () => {
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS project_members/)
    for (const col of ['tenant_id', 'project_id', 'user_id', 'source', 'active_from', 'active_to', 'created_by']) {
      expect(migration, `${col} must exist`).toMatch(new RegExp(`^\\s*${col}\\s`, 'm'))
    }
  })

  it('references the real tables, so a membership cannot point at nothing', () => {
    expect(migration).toMatch(/project_id\s+UUID\s+NOT NULL REFERENCES projects\(id\)/)
    expect(migration).toMatch(/user_id\s+UUID\s+NOT NULL REFERENCES users\(id\)/)
  })

  it('makes cross-tenant membership unrepresentable, not merely rejected (§54)', () => {
    // Composite foreign keys, so the membership tenant must equal BOTH the
    // project's and the user's. Enforced by the database, not by a route.
    expect(migration).toMatch(/project_members_project_in_tenant[\s\S]{0,200}FOREIGN KEY \(project_id, tenant_id\) REFERENCES projects \(id, tenant_id\)/)
    expect(migration).toMatch(/project_members_user_in_tenant[\s\S]{0,200}FOREIGN KEY \(user_id, tenant_id\) REFERENCES users \(id, tenant_id\)/)
  })

  it('permits one ACTIVE row per source and no more', () => {
    expect(migration).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS project_members_one_active_per_source[\s\S]{0,160}WHERE active_to IS NULL/)
  })

  it('rejects a reversed lifetime', () => {
    expect(migration).toMatch(/CHECK \(active_to IS NULL OR active_to > active_from\)/)
  })

  it('isolates by tenant like every other table', () => {
    expect(migration).toMatch(/ALTER TABLE project_members ENABLE ROW LEVEL SECURITY/)
    expect(migration).toMatch(/CREATE POLICY project_members_tenant_isolation/)
  })

  it('indexes the two queries the resolver actually runs', () => {
    expect(migration).toMatch(/project_members_active_lookup/)
    expect(migration).toMatch(/project_members_roster/)
  })
})

// ─── 2. Legacy backfill (D19) ─────────────────────────────────────────────────
describe('the backfill preserves history without inventing authorization', () => {
  it('backfills all three legacy responsibility columns', () => {
    for (const col of ['created_by', 'project_manager', 'lead_engineer']) {
      expect(migration, `${col} must be backfilled`)
        .toMatch(new RegExp(`'${col}'::project_member_source`))
    }
  })

  it('refuses to create a cross-tenant membership from historical data (§7)', () => {
    const inserts = migration.match(/INSERT INTO project_members[\s\S]*?ON CONFLICT DO NOTHING/g) ?? []
    expect(inserts.length, 'expected the three backfill statements').toBe(3)
    for (const stmt of inserts) {
      expect(stmt, 'each backfill must join users on the SAME tenant')
        .toMatch(/JOIN users u ON u\.id = p\.\w+ AND u\.tenant_id = p\.tenant_id/)
    }
  })

  it('attributes the backfill to the migration, not to a fabricated user (§39)', () => {
    const inserts = migration.match(/SELECT p\.tenant_id[\s\S]*?FROM projects p/g) ?? []
    expect(inserts.length).toBe(3)
    for (const stmt of inserts) {
      expect(stmt, 'created_by must be NULL for backfilled rows').toMatch(/,\s*NULL\s*$/m)
    }
  })

  it('leaves the legacy columns in place as business data', () => {
    expect(migration, 'the columns must NOT be dropped').not.toMatch(/ALTER TABLE projects[\s\S]{0,80}DROP COLUMN/)
    expect(migration).toMatch(/COMMENT ON COLUMN projects\.project_manager/)
  })
})

// ─── 3. ONE authorization truth (§20, §21) ────────────────────────────────────
describe('membership is the only non-Owner project-scope source', () => {
  it('the resolver reads project_members', () => {
    expect(resolver).toMatch(/FROM project_members m/)
  })

  it('and only ACTIVE membership counts', () => {
    expect(resolver).toMatch(/m\.active_from <= NOW\(\)/)
    expect(resolver).toMatch(/m\.active_to IS NULL OR m\.active_to > NOW\(\)/)
  })

  it('the resolver no longer authorizes from the legacy columns', () => {
    for (const col of ['project_manager', 'lead_engineer', 'created_by']) {
      expect(resolver, `${col} must not appear in a scope predicate`)
        .not.toMatch(new RegExp(`${col}\\s*=\\s*\\$`))
    }
  })

  it('remains the sole canonical resolver — no second implementation appeared', () => {
    const dir = path.join(process.cwd(), 'api', 'authz')
    const others = fs.readdirSync(dir)
      .filter(f => f.endsWith('.ts') && f !== 'recordScope.ts')
      .filter(f => /FROM project_members/.test(fs.readFileSync(path.join(dir, f), 'utf8')))
    expect(others, `a second membership resolver appeared: ${others.join(', ')}`).toEqual([])
  })

  it('keeps the tenant predicate on every branch — the Owner is not global', () => {
    const predicates = [...resolver.matchAll(/tenant_id = current_setting\('app\.current_tenant_id', true\)::uuid/g)]
    expect(predicates.length).toBeGreaterThanOrEqual(3)
  })

  it('decides tenant-wide from a capability, not a hard-coded role name', () => {
    expect(resolver).toMatch(/TENANT_WIDE_CAPABILITY = 'project\.list\.all'/)
    expect(resolver, 'no role literal in the authorization decision').not.toMatch(/role === 'owner'/)
  })
})

// ─── 4. Membership grants scope, never capability (§1) ────────────────────────
describe('membership confers no functional authority', () => {
  it('the service writes only membership rows', () => {
    expect(service, 'no capability or role write may appear here')
      .not.toMatch(/UPDATE users SET|INSERT INTO users|role\s*=/)
  })

  it('leaves every capability holder set untouched (§44)', () => {
    expect(holders('crossdomain.read')).toEqual(['owner'])
    expect(holders('crossdomain.write')).toEqual(['owner'])
    expect(holders('cost.view')).toEqual(['owner'])
    expect(holders('project.list.all')).toEqual(['owner'])
    expect(holders('construction.view')).toEqual(['owner', 'project_manager', 'engineer', 'field_ops'])
    expect(holders('engineering.view')).toEqual(['owner', 'project_manager', 'engineer'])
  })
})

// ─── 5. project.members.manage (D20) ──────────────────────────────────────────
describe('membership administration has its own authority', () => {
  it('is a registered capability held by exactly owner and project_manager', () => {
    expect(isServerCapability('project.members.manage')).toBe(true)
    expect(holders('project.members.manage')).toEqual(['owner', 'project_manager'])
  })

  it('is held by nobody else', () => {
    for (const role of ['admin', 'engineer', 'procurement', 'field_ops', 'viewer'] as UserRole[]) {
      expect(SERVER_ROLE_CAPS[role] as readonly string[], `${role} must not hold it`)
        .not.toContain('project.members.manage')
    }
  })

  it('guards both membership mutations', () => {
    expect(projects).toMatch(/router\.post\('\/:id\/members', requireCapability\('project\.members\.manage'\)/)
    expect(projects).toMatch(/router\.delete\('\/:id\/members\/:userId', requireCapability\('project\.members\.manage'\)/)
  })

  it('is ALSO record-scoped, which is what closes self-bootstrap (§11, §12)', () => {
    // Both mutations must call the record-scope layer in their own handler.
    for (const decl of ["router.post('/:id/members'", "router.delete('/:id/members/:userId'"]) {
      const at = projects.indexOf(decl)
      expect(at, `${decl} must exist`).toBeGreaterThan(-1)
      const body = projects.slice(at, projects.indexOf('\n})', at))
      expect(body, `${decl} must enforce record scope`).toMatch(/canAccessProject\(principal, String\(id\)\)/)
    }
  })
})

// ─── 6. Provenance cannot be forged (§16) ─────────────────────────────────────
describe('system membership sources are server-owned', () => {
  it('names exactly the four sources the enum declares', () => {
    expect([...SYSTEM_SOURCES].sort()).toEqual(['created_by', 'lead_engineer', 'project_manager'])
    expect(MANUAL_SOURCE).toBe('manual')
    for (const s of SYSTEM_SOURCES) expect(isSystemSource(s)).toBe(true)
    expect(isSystemSource(MANUAL_SOURCE)).toBe(false)
    expect(migration).toMatch(/CREATE TYPE project_member_source AS ENUM \(\s*\n?\s*'created_by',/)
  })

  it('the grant route hard-codes the manual source and reads none from the body', () => {
    const at = projects.indexOf("router.post('/:id/members'")
    const body = projects.slice(at, projects.indexOf('\n})', at))
    expect(body).toMatch(/source: MANUAL_SOURCE/)
    expect(body, 'no caller-supplied source may reach the write')
      .not.toMatch(/source:\s*(req\.body|source|membership_source)/)
  })

  it('the granting actor is the live principal, never a body field (§39)', () => {
    const at = projects.indexOf("router.post('/:id/members'")
    const body = projects.slice(at, projects.indexOf('\n})', at))
    expect(body).toMatch(/grantedBy: principal\.id/)
    expect(body).not.toMatch(/grantedBy:\s*req\.body/)
  })
})

// ─── 7. Workflow synchronisation (§17, §18, §55) ──────────────────────────────
describe('the project workflows keep membership in step, transactionally', () => {
  it('project creation writes its memberships in the SAME transaction', () => {
    const at = projects.indexOf("router.post('/', requireCapability('project.write')")
    expect(at, 'the create route must exist').toBeGreaterThan(-1)
    const body = projects.slice(at, projects.indexOf('\n})', at))
    expect(body, 'one transaction').toMatch(/tenantTransaction\(/)
    expect(body).toMatch(/syncMembershipsForNewProject\(client/)
  })

  it('reassignment moves the system source inside the same transaction', () => {
    const at = projects.indexOf("router.patch('/:id', requireCapability('project.write')")
    const body = projects.slice(at, projects.indexOf('\n})', at))
    expect(body).toMatch(/tenantTransaction\(/)
    expect(body, 'the previous holder must be read under FOR UPDATE').toMatch(/FOR UPDATE/)
    expect(body).toMatch(/source: 'project_manager'/)
    expect(body).toMatch(/source: 'lead_engineer'/)
  })

  it('closes only the source being moved, never the whole user (§19)', () => {
    expect(service).toMatch(/AND source\s*=\s*\$4::project_member_source/)
    expect(service, 'revocation is scoped to one source').toMatch(/AND active_to IS NULL/)
  })

  it('revokes by closing the window, never by deleting (§9)', () => {
    expect(service).toMatch(/SET active_to = NOW\(\)/)
    expect(service, 'history must survive revocation').not.toMatch(/DELETE FROM project_members/)
  })

  it('is a no-op when the assignment did not change', () => {
    expect(service).toMatch(/if \(previousUserId === nextUserId\) return \{ closed: 0, opened: 0 \}/)
  })
})

// ─── 8. Collections are scoped server-side (§26, §27) ─────────────────────────
describe('the project collection filters in SQL, and counts what it shows', () => {
  it('applies the membership predicate to the DATA query', () => {
    const at = projects.indexOf("router.get('/', requireCapability('project.view')")
    expect(at, 'the collection route must exist').toBeGreaterThan(-1)
    const body = projects.slice(at, projects.indexOf('\n})', at))
    expect(body).toMatch(/projectScopeSql\(principal/)
    expect(body, 'the predicate must be in the data query').toMatch(/LEFT JOIN users pm[\s\S]{0,400}\$\{scope\}/)
  })

  it('applies the SAME predicate to the COUNT query', () => {
    const at = projects.indexOf("router.get('/', requireCapability('project.view')")
    const body = projects.slice(at, projects.indexOf('\n})', at))
    expect(body, 'a tenant-wide count would be a side channel')
      .toMatch(/COUNT\(\*\)::text AS count FROM projects p[\s\S]{0,200}\$\{scope\}/)
  })

  it('uses a single-capability guard, not an "any of" that the perimeter forbids', () => {
    expect(projects).toMatch(/router\.get\('\/', requireCapability\('project\.view'\)/)
    // Checked against the DECLARATION, not the file — the rejected alternative
    // is named in the comment above the route and must not trip this.
    const decls = [...projects.matchAll(/router\.(get|post|patch|delete)\('[^']*',\s*require\w+\(/g)]
      .map(m => m[0])
    expect(decls.filter(d => d.includes('requireAnyCapability')),
      'no route on this router may use an "any of" guard').toEqual([])
  })

  it('keeps project.list.all meaningful rather than deleting it (§25)', () => {
    expect(isServerCapability('project.list.all')).toBe(true)
    expect(resolver).toMatch(/project\.list\.all/)
  })

  it('scopes the domain-child collections through the canonical guard', () => {
    const SCOPED: Array<[string, string]> = [
      ['drawings.ts',     '/projects/:projectId/drawings'],
      ['inspections.ts',  '/projects/:projectId/inspections'],
      ['ncr.ts',          '/projects/:projectId/ncrs'],
      ['punchLists.ts',   '/projects/:projectId/punch-lists'],
      ['changeOrders.ts', '/projects/:projectId/change-orders'],
    ]
    for (const [file, route] of SCOPED) {
      const text = src(`api/routes/${file}`)
      // Anchored on the .get( DECLARATION: every one of these files lists its
      // routes in a header comment, and matching that would prove nothing.
      const decl = new RegExp(`\\.get\\(\\s*'${route.replace(/[/:]/g, m => '\\' + m)}'[\\s\\S]{0,220}`)
      const m = decl.exec(text)
      expect(m, `${file} ${route} declaration must exist`).toBeTruthy()
      expect(m![0], `${route} must be record-scoped`).toMatch(/requireProjectScope\(\)/)
    }
  })
})

// ─── 9. Census and adoption stay honest (§66) ─────────────────────────────────
describe('the Phase-2 classification stays closed and adoption is not overclaimed', () => {
  it('leaves nothing pending and nothing unclassified', () => {
    expect(endpoints.filter(e => e.klass === 'PENDING_PHASE2').map(e => e.key)).toEqual([])
    const counted = ALL_ROUTE_CLASSES
      .map(k => endpoints.filter(e => e.klass === k).length)
      .reduce((a, b) => a + b, 0)
    expect(counted).toBe(endpoints.length)
  })

  it('reports record-scope adoption as partial, because it is', () => {
    const scoped = endpoints.filter(e => e.klass === 'CAPABILITY_RECORD_SCOPE').length
    // Phase 3B scoped 15. Phase 3C added the direct-ID guard and applied it to
    // the drawings, inspections and punch-list routers, taking it to 39 of 747.
    // Phase 3D took it to 190 by closing the project-bound mutation surface.
    // Phase 3E adds 46: the 44 derivable project-bound direct-ID reads, plus
    // two sibling reads on the same records (the Monte-Carlo distribution and
    // the readiness history) that would otherwise have been left open beside a
    // route this slice closed.
    // Phase 3F adds 72: the 56 project-path collections, thirteen tenant-wide
    // collections whose rows reach a project, and the three
    // `/schedule/:projectId/*` mutations that the classifier's old
    // `/projects/:projectId/`-anchored regex had hidden from Phase 3D.
    // Adoption is real and still partial, and the assertion says so out loud so
    // that a later slice cannot quietly imply full coverage.
    // Phase 3K adds one: `GET /files/download/:token`, which had no record
    // scope because its record id is inside the token rather than in the path.
    // It is the only endpoint that moves — and it moves out of
    // UNRESOLVED_DATA_ACCESS at the same time, because the handler now names
    // the table it was always reading.
    // And one more with the repaired viewer route,
    // `GET /files/documents/:id/content`, which arrives already scoped.
    // Phase 3L adds five: the TRIR surface — recordability classification, the
    // two project exposure-hours routes, and the two rate routes.
    expect(scoped, 'Phase 3N scoped 365 endpoints').toBe(365)
    expect(endpoints.length, 'out of ~747').toBeGreaterThan(700)
    // Phase 3B asserted adoption was under 10%, which measured how little had
    // been done rather than guarding a property — it necessarily fails as the
    // rollout succeeds. What stays true is that adoption is still PARTIAL, and
    // the exact count above is what stops it being overstated.
    expect(scoped, 'adoption is real but still partial').toBeLessThan(endpoints.length)
  })

  it('scopes the membership routes themselves', () => {
    const keys = endpoints.filter(e => e.klass === 'CAPABILITY_RECORD_SCOPE').map(e => e.key)
    for (const k of [
      'projects.ts router.GET /',
      'projects.ts router.GET /:id',
      'projects.ts router.GET /:id/members',
      'projects.ts router.POST /:id/members',
      'projects.ts router.DELETE /:id/members/:userId',
    ]) {
      expect(keys, `${k} must be record-scoped`).toContain(k)
    }
  })
})

// ─── 10. agents.ts audit actor (§40, §41) ─────────────────────────────────────
describe('the agents audit actor comes from the session', () => {
  const agents = src('api/routes/agents.ts')

  it('never passes a body-supplied actor to orchestrate()', () => {
    expect(agents).not.toMatch(/requestedBy,\s*$/m)
    const actors = [...agents.matchAll(/requestedBy:\s*([^,\n]+)/g)].map(m => m[1]!.trim())
    expect(actors.length, 'both routes must be found').toBe(2)
    for (const a of actors) expect(a).toMatch(/r\.auth\?\.sub/)
  })

  it('no longer destructures an actor out of the body', () => {
    expect(agents).not.toMatch(/const \{ objective, scope, scopeId, context, requestedBy \} = req\.body/)
  })
})

// ─── 11. Adoption counters are machine-derived (§42, §43) ─────────────────────
describe('Phase-3 adoption is counted, not narrated', () => {
  const counters = phase3Counters()

  it('explains every recorded surface', () => {
    expect(counters.unexplained, 'a surface with no substantive reason').toBe(0)
    for (const a of COLLECTION_ADOPTION) {
      expect(a.reason.length, `${a.surface} needs a reason`).toBeGreaterThan(30)
    }
  })

  it('defers exactly the two surfaces whose project parent is not derivable', () => {
    // Through Phase 3D this list was empty, and the assertion said so. Phase 3E
    // adds two: both are keyed on `operational_twins`, whose `entity_id` is a
    // bare text column with no foreign key to anything, spanning fourteen
    // entity types. A guard cannot be written until a per-entity-type scope
    // policy exists, so they are deferred for a MODEL reason and the slice is
    // PARTIAL rather than COMPLETE (§61).
    //
    // Pinned by name so a THIRD model deferral cannot appear silently: adding
    // one is a decision that must be argued, not a side effect of a later slice.
    const noModel = COLLECTION_ADOPTION.filter(a => a.status === 'DEFERRED_PHASE3_SCOPE_MODEL')
    expect(noModel.map(a => a.surface).sort()).toEqual([
      'portfolio.ts GET /readiness/:scopeType/:scopeId',
      'scenarios.ts GET /projection/:twinId',
    ])
    for (const a of noModel) {
      expect(a.reason, `${a.surface} must say what is missing`).toMatch(/operational_twins/)
    }
  })

  it('reports the deferrals it does have, rather than hiding them', () => {
    const deferred = COLLECTION_ADOPTION.filter(a => a.status !== 'SCOPED')
    expect(deferred.length).toBe(counters.deferred)
    expect(deferred.every(a => a.kind === 'DOMAIN_CHILD_DETAIL'),
      'the only deferrals are detail routes, deferred by scope discipline').toBe(true)
  })

  it('matches the scoped surfaces to the census', () => {
    // Non-vacuity: the registry must not claim a surface the census disagrees
    // with. Every SCOPED project/membership surface is a record-scoped endpoint.
    const scopedKeys = new Set(endpoints.filter(e => e.klass === 'CAPABILITY_RECORD_SCOPE').map(e => e.key))
    const claimed = COLLECTION_ADOPTION
      .filter(a => a.status === 'SCOPED' && a.surface.startsWith('projects.ts '))
      .map(a => a.surface.replace('projects.ts ', 'projects.ts router.'))
    for (const k of claimed) expect(scopedKeys, `${k} claimed SCOPED`).toContain(k)
    expect(claimed.length).toBe(5)
  })
})
