/**
 * ADR-014 Phase 2C-2A §16 — the owner-policy closure ratchet.
 *
 * Phase 2C-2 ended with four routes deliberately unresolved and one live
 * privilege-escalation path through SCIM. This asserts, from source, that each
 * owner decision was actually applied — and keeps asserting it, so a future
 * change that reverts a guard, re-grants `project.delete`, restores the
 * permissive ingest fall-through, or re-opens `owner` to SCIM fails the build
 * rather than quietly undoing the decision.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { censusWithEffectivePaths } from './helpers/endpointCensus'
import {
  OWNER_POLICY_RESOLUTIONS,
  HYBRID_AUTH_MUTATIONS,
  POLICY_DEPENDENT_MUTATIONS,
} from '../authz/highSensitivityMutations'
import { SERVER_ROLE_CAPS, isServerCapability, ALL_ROLES_FOR_TEST } from './helpers/capabilityHolders'

const census = censusWithEffectivePaths()
const byKey = new Map(census.map(e => [e.key, e]))
const key = (m: { file: string; router: string; method: string; path: string }) =>
  `${m.file} ${m.router}.${m.method.toUpperCase()} ${m.path}`

const src = (file: string) => fs.readFileSync(path.join(process.cwd(), 'api', 'routes', file), 'utf8')
const holders = (cap: string) =>
  ALL_ROLES_FOR_TEST.filter(r => (SERVER_ROLE_CAPS[r] as readonly string[]).includes(cap))

// ─── the ledger itself ────────────────────────────────────────────────────────
describe('§16 every owner decision is recorded and applied', () => {
  it('records all five decisions exactly once', () => {
    expect(OWNER_POLICY_RESOLUTIONS.map(r => r.decision)).toEqual(['D3', 'D4', 'D5', 'D6', 'D7'])
  })

  it('leaves no owner-policy dependency outstanding', () => {
    expect(POLICY_DEPENDENT_MUTATIONS).toEqual([])
  })

  it('gives every resolution a real before/after and a substantive rationale', () => {
    for (const r of OWNER_POLICY_RESOLUTIONS) {
      expect(r.before.length, `${r.decision} needs a before`).toBeGreaterThan(20)
      expect(r.after.length,  `${r.decision} needs an after`).toBeGreaterThan(20)
      expect(r.rationale.length, `${r.decision} needs a rationale`).toBeGreaterThan(30)
      if (r.capability) expect(isServerCapability(r.capability), `${r.decision}: unknown capability`).toBe(true)
    }
  })
})

// ─── D3 · commissioning credits ───────────────────────────────────────────────
describe('D3 credit issuance is platform entitlement administration', () => {
  const route = 'commissioning.ts router.POST /credits'

  it('requires platform.admin at the route', () => {
    expect(byKey.get(route)?.capability).toBe('platform.admin')
  })

  it('holds platform.admin at exactly the legacy role set, so authority did not move', () => {
    expect(holders('platform.admin')).toEqual(['owner', 'admin'])
  })

  it('no longer decides authority from the JWT role', () => {
    const s = src('commissioning.ts')
    expect(s, 'the _requireRole helper survived its last caller').not.toMatch(/_requireRole/)
    expect(s).not.toMatch(/\['owner','admin'\]\.includes\(req\.auth/)
  })
})

// ─── D4 · project hard delete ─────────────────────────────────────────────────
describe('D4 hard deletion carries its own authority', () => {
  const route = 'projects.ts router.DELETE /:id'

  it('requires project.delete at the route', () => {
    expect(byKey.get(route)?.capability).toBe('project.delete')
  })

  it('grants project.delete to owner and to nobody else', () => {
    // An exact equality: a future accidental grant fails here, not in production.
    expect(holders('project.delete')).toEqual(['owner'])
  })

  it('withholds it from every other role individually', () => {
    for (const role of ['admin', 'project_manager', 'engineer', 'procurement', 'field_ops', 'viewer'] as const) {
      expect((SERVER_ROLE_CAPS[role] as readonly string[]),
        `${role} must not hold project.delete`).not.toContain('project.delete')
    }
  })

  it('does not reuse project.write or project.approve, whose holders are wider', () => {
    expect(holders('project.write').length).toBeGreaterThan(1)
    expect(holders('project.approve')).toContain('project_manager')
    expect(holders('project.delete')).not.toContain('project_manager')
  })

  it('no longer decides deletion from the JWT role', () => {
    const s = src('projects.ts')
    const deleteHandler = s.slice(s.indexOf("router.delete('/:id'"), s.indexOf("router.delete('/:id'") + 900)
    expect(deleteHandler).not.toMatch(/req\.auth\?\.role/)
    expect(deleteHandler).toMatch(/requireCapability\('project\.delete'\)/)
  })
})

// ─── D5 / D6 · hybrid ingest ──────────────────────────────────────────────────
describe('D5/D6 the hybrid ingest boundary is deterministic and fail-closed', () => {
  const s = src('iot.ts')

  it('registers exactly the two hybrid routes', () => {
    expect(HYBRID_AUTH_MUTATIONS.map(key)).toEqual([
      'iot.ts iotRouter.POST /iot/ingest',
      'iot.ts iotRouter.POST /sensors/:uid/readings',
    ])
  })

  it('proves each registered route actually carries the declared middleware and capability', () => {
    // This is what stops the registry becoming a suppression bucket: a route may
    // only be listed here if source really applies hybridIngestAuth('<cap>').
    for (const h of HYBRID_AUTH_MUTATIONS) {
      const decl = `${h.router}.${h.method.toLowerCase()}('${h.path}', ${h.middleware}('${h.userCapability}')`
      expect(s.includes(decl), `${key(h)}: source does not declare ${decl}`).toBe(true)
      expect(isServerCapability(h.userCapability)).toBe(true)
    }
  })

  it('requires platform.integrations of a human caller, not platform.security', () => {
    for (const h of HYBRID_AUTH_MUTATIONS) expect(h.userCapability).toBe('platform.integrations')
    // Credential ISSUANCE stays separate and narrower — the two must not collapse.
    expect(byKey.get('iot.ts authRouter.POST /sensors/tokens')?.capability).toBe('platform.security')
    expect(holders('platform.integrations')).toEqual(['owner', 'admin'])
    expect(holders('platform.security')).toEqual(['owner'])
  })

  it('has removed the permissive fall-through the old middleware performed', () => {
    // The defect: try the machine token, and on failure silently reconsider the
    // request as a session. A credential that claims to be an ingest token and is
    // not must now be refused outright.
    expect(s, 'the old fall-through middleware is still present').not.toMatch(/async function ingestAuth/)
    expect(s).not.toMatch(/Fall through to normal auth/)
    expect(s).toMatch(/INGEST_TOKEN_SHAPE/)
    // The service branch returns after refusing; it never continues to the chain.
    const branch = s.slice(s.indexOf('if (INGEST_TOKEN_SHAPE.test(bearer))'))
    const refusal = branch.slice(0, branch.indexOf('runChain'))
    expect(refusal).toMatch(/res\.status\(401\)\.json\(\{ error: 'Invalid ingest token' \}\); return/)
  })

  it('no longer runs an unconditional requireAuth ahead of the machine path', () => {
    for (const h of HYBRID_AUTH_MUTATIONS) {
      const decl = `${h.router}.${h.method.toLowerCase()}('${h.path}',`
      const tail = s.slice(s.indexOf(decl) + decl.length, s.indexOf(decl) + decl.length + 120)
      expect(tail, `${key(h)} still authenticates as a session before classifying`).not.toMatch(/requireAuth/)
    }
  })

  it('states the census consequence rather than hiding it', () => {
    // Truth over counter: these stay PENDING_PHASE2 because no existing class
    // means "verified service credential OR user capability".
    for (const h of HYBRID_AUTH_MUTATIONS) {
      expect(h.censusClass).toBe('PENDING_PHASE2')
      expect(byKey.get(key(h))?.capability,
        `${key(h)} must not claim a plain capability class`).toBeNull()
      expect(h.serviceCredential.length).toBeGreaterThan(60)
    }
  })
})

// ─── D7 · SCIM owner boundary ─────────────────────────────────────────────────
describe('D7 SCIM can never assign owner', () => {
  const s = src('scim.ts')

  it('validates the role on every SCIM path that writes one', () => {
    // POST create, PUT replace, PATCH roles — three call sites, no more, no fewer.
    const calls = s.match(/_rejectScimRole\(/g) ?? []
    expect(calls.length, 'a role-writing path lost its validation').toBe(4) // 1 definition + 3 call sites
  })

  it('refuses owner by name and refuses roles the repository does not define', () => {
    expect(s).toMatch(/const SCIM_FORBIDDEN_ROLE = 'owner'/)
    expect(s).toMatch(/USER_ROLES as readonly string\[\]\)\.includes\(role\)/)
  })

  it('refuses the whole PatchOp rather than skipping the offending operation', () => {
    const patch = s.slice(s.indexOf("path === 'roles'"))
    const guard = patch.slice(0, patch.indexOf('sets.push(`role='))
    expect(guard).toMatch(/_scimError\(400/)
    expect(guard).toMatch(/return/)
  })

  it('leaves the protocol-token authentication model intact', () => {
    // This slice narrows what SCIM may create, not whether SCIM exists.
    expect(s).toMatch(/scimRouter\.use\(requireScimToken\)/)
    expect(s).toMatch(/token_hash=\$1/)
    expect(s).toMatch(/is_active=true/)
    expect(s).toMatch(/expires_at IS NULL OR expires_at > NOW\(\)/)
  })

  it('leaves SCIM token administration on platform.identity', () => {
    expect(byKey.get('scim.ts adminRouter.POST /tokens')?.capability).toBe('platform.identity')
    expect(byKey.get('scim.ts adminRouter.DELETE /tokens/:id')?.capability).toBe('platform.identity')
  })
})
