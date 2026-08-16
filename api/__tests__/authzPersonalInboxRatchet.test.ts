/**
 * ADR-014 Phase 2C-4A — the Personal Inbox authorization ratchet.
 *
 * The invariant is not "these 29 routes have a guard". `personal.write` is held
 * by five of seven roles, so a capability check on its own would let any project
 * manager complete, reassign or delegate anyone else's work. What this file
 * defends is the pair:
 *
 *   a capability that says the caller may change Personal Inbox state at all,
 *   AND an ownership rule that says the record is theirs.
 *
 * So it asserts the *shape* of each decision: a self-scoped route that lost its
 * ownership call is a failure even though it still has a capability; a
 * tenant-wide read that drifted to `personal.view` is a failure even though it
 * looks guarded; and `viewer` gaining `personal.write` is a failure even though
 * every route would still appear protected.
 *
 * Set comparison, not counts.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  PERSONAL_INBOX_ENDPOINTS,
  DEFERRED_NOTIFICATIONS,
  ACTION_ASSIGNMENT_FIELDS,
  CLOSED_LIVE_DEFECTS,
  KNOWN_SHADOWED_ROUTES,
  NOTIFICATION_OWNERSHIP_RESOLUTION,
} from '../authz/personalInboxAuthorization'
import { DEFERRED_DELIVERY_READS } from '../authz/projectDeliveryReads'
import { AI_CROSS_DOMAIN_MUTATIONS } from '../authz/aiCrossDomainMutations'
import { PROJECT_DELIVERY_MUTATIONS } from '../authz/projectDeliveryMutations'
import { HIGH_SENSITIVITY_MUTATIONS } from '../authz/highSensitivityMutations'
import { ENDPOINT_EXCEPTIONS, endpointKey } from '../authz/routeManifest'
import {
  isServerCapability, SERVER_ROLE_CAPS, USER_ROLES, ACTION_CAPABILITIES, type UserRole,
} from '../authz/capabilities'
import { ROLE_CAPS as CLIENT_ROLE_CAPS } from '../../src/config/capabilities'
import { censusWithEffectivePaths } from './helpers/endpointCensus'

const endpoints = censusWithEffectivePaths()
const byKey = new Map(endpoints.map(e => [e.key, e]))
const key = (r: { file: string; router: string; method: string; path: string }) =>
  `${r.file} ${r.router}.${r.method} ${r.path}`

const holders = (capability: string): UserRole[] =>
  USER_ROLES.filter(r => (SERVER_ROLE_CAPS[r] as readonly string[]).includes(capability))

const src = (file: string) => fs.readFileSync(path.join(process.cwd(), 'api', 'routes', file), 'utf8')

/** Source with comment lines removed — a comment must never satisfy an assertion. */
const stripComments = (s: string) => s
  .split('\n')
  .filter(l => { const t = l.trim(); return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*') })
  .join('\n')

/** The declaration + handler body of one route. */
function handlerBody(m: { file: string; router: string; method: string; path: string }): string {
  const esc = m.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // The closing `})` may be indented when the route spreads its guards over
  // several lines, so do not anchor it to column 0.
  const re = new RegExp(
    `${m.router}\\s*\\.\\s*${m.method.toLowerCase()}\\s*\\(\\s*'${esc}'[\\s\\S]*?\\n\\s*\\}\\)`,
  )
  return re.exec(src(m.file))?.[0] ?? ''
}

const PI_FILES = ['actions.ts', 'personalAgent.ts', 'myWork.ts'] as const
const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

// ─── 1. Scope reconciles ──────────────────────────────────────────────────────
describe('the Phase 2C-4A entry set', () => {
  it('covers all 36 Personal Inbox endpoints after Phase 2C-4B', () => {
    // 29 closed by Phase 2C-4A + the 7 notification routes closed by 2C-4B.
    expect(PERSONAL_INBOX_ENDPOINTS.length).toBe(36)
    const reads = PERSONAL_INBOX_ENDPOINTS.filter(e => e.kind === 'READ').length
    const muts  = PERSONAL_INBOX_ENDPOINTS.filter(e => e.kind === 'MUTATION').length
    expect(reads, '14 actions + 2 personalAgent + 1 myWork + 2 notifications').toBe(19)
    expect(muts, '9 actions + 3 personalAgent + 5 notifications').toBe(17)
  })

  it('reconciles by file', () => {
    const byFile: Record<string, number> = {}
    for (const e of PERSONAL_INBOX_ENDPOINTS) byFile[e.file] = (byFile[e.file] ?? 0) + 1
    expect(byFile).toEqual({
      'actions.ts': 23, 'personalAgent.ts': 5, 'myWork.ts': 1, 'notifications.ts': 7,
    })
  })

  it('names only endpoints that exist in source', () => {
    for (const e of PERSONAL_INBOX_ENDPOINTS) {
      expect(byKey.get(key(e)), `${key(e)}: no such endpoint`).toBeDefined()
    }
  })

  it('leaves no endpoint in the three in-scope files unclassified', () => {
    const registered = new Set(PERSONAL_INBOX_ENDPOINTS.map(key))
    const unaccounted = endpoints
      .filter(e => (PI_FILES as readonly string[]).includes(e.file))
      .filter(e => !registered.has(e.key))
      .map(e => e.key)
    expect(unaccounted,
      `Personal Inbox endpoints with no disposition:\n  ${unaccounted.join('\n  ')}`).toEqual([])
  })

  it('registers no endpoint twice', () => {
    const seen = PERSONAL_INBOX_ENDPOINTS.map(key)
    expect(seen.length).toBe(new Set(seen).size)
  })

  it('overlaps no earlier slice registry', () => {
    const earlier = new Set<string>([
      ...PROJECT_DELIVERY_MUTATIONS.map(key),
      ...HIGH_SENSITIVITY_MUTATIONS.map(key),
      ...AI_CROSS_DOMAIN_MUTATIONS.map(key),
    ])
    const overlap = PERSONAL_INBOX_ENDPOINTS.map(key).filter(k => earlier.has(k))
    expect(overlap, `already owned by an earlier slice: ${overlap.join(', ')}`).toEqual([])
  })

  it('accounts for all 36 Personal Inbox endpoints, with nothing left deferred', () => {
    expect(DEFERRED_NOTIFICATIONS.length, 'Phase 2C-4B closed the deferral').toBe(0)
    expect(PERSONAL_INBOX_ENDPOINTS.length + DEFERRED_NOTIFICATIONS.length).toBe(36)
    expect(NOTIFICATION_OWNERSHIP_RESOLUTION.endpointsClosed).toBe(7)
  })

  it('closes every Phase 2B-2 PERSONAL_INBOX deferred read except the notification pair', () => {
    const deferredReads = DEFERRED_DELIVERY_READS.filter(d => d.category === 'PERSONAL_INBOX')
    expect(deferredReads.length, 'the Phase 2B-2 deferral').toBe(19)

    const closedReads = new Set(
      PERSONAL_INBOX_ENDPOINTS.filter(e => e.kind === 'READ').map(e => `${e.file} ${e.method} ${e.path}`),
    )
    const stillOpen = deferredReads
      .filter(d => !closedReads.has(`${d.file} ${d.method} ${d.path}`))
      .map(d => `${d.file} ${d.method} ${d.path}`)
    expect(stillOpen, 'every Phase 2B-2 PERSONAL_INBOX read is now closed').toEqual([])
  })
})

// ─── 2. Source agrees with the registry ───────────────────────────────────────
describe('every Personal Inbox route carries its declared guard', () => {
  it.each(PERSONAL_INBOX_ENDPOINTS.map(e => [key(e), e] as const))('%s', (_label, e) => {
    const live = byKey.get(key(e))!
    expect(live.allCapabilities,
      `registry requires ${e.capabilities.join(' AND ')}, route declares ` +
      `${live.allCapabilities?.join(' AND ') ?? 'nothing'}`).toEqual([...e.capabilities])
  })

  it('declares only registered capabilities', () => {
    for (const e of PERSONAL_INBOX_ENDPOINTS) {
      for (const c of e.capabilities) {
        expect(isServerCapability(c), `${key(e)}: unknown capability ${c}`).toBe(true)
      }
    }
  })

  it('parses every handler body — the source checks are not vacuous', () => {
    const empty = PERSONAL_INBOX_ENDPOINTS
      .filter(e => handlerBody(e).length < 80)
      .map(key)
    expect(empty, `handler body not extracted:\n  ${empty.join('\n  ')}`).toEqual([])
  })
})

// ─── 3. Self-scope is enforced, not merely declared ───────────────────────────
describe('self-scoped routes prove ownership, not just capability', () => {
  const selfScoped = PERSONAL_INBOX_ENDPOINTS.filter(
    e => e.scope === 'SELF' || e.scope === 'SELF_OR_ADMIN')

  it('exists — the slice did not collapse everything into tenant administration', () => {
    expect(selfScoped.length).toBeGreaterThan(15)
  })

  it('confines SHARED_POLICY_READ to reads that genuinely have no per-user rows', () => {
    const shared = PERSONAL_INBOX_ENDPOINTS.filter(e => e.scope === 'SHARED_POLICY_READ')
    expect(shared.map(key)).toEqual(['actions.ts actionsRouter.GET /sla-rules'])
    for (const e of shared) {
      expect(e.kind, 'a shared-policy scope may never carry a mutation').toBe('READ')
      expect(e.capabilities).toEqual(['personal.view'])
    }
  })

  it('declares a real ownership rule, never capability-only', () => {
    for (const e of selfScoped) {
      expect(e.ownershipRule.length, `${key(e)}: ownership rule too thin`).toBeGreaterThan(20)
      expect(e.ownershipRule, `${key(e)}: self scope cannot be capability-only`)
        .not.toContain('capability-only')
    }
  })

  it('calls the shared ownership helper on every SELF_OR_ADMIN route about an action', () => {
    // Delegations are a different resource with a different owner column, so they
    // prove ownership with their own SQL predicate — asserted separately below.
    const missing = PERSONAL_INBOX_ENDPOINTS
      .filter(e => e.scope === 'SELF_OR_ADMIN' && e.file === 'actions.ts')
      .filter(e => !e.path.startsWith('/delegations'))
      .filter(e => !/requireActionAccess\(/.test(handlerBody(e)))
      .map(key)
    expect(missing,
      `a SELF_OR_ADMIN action route with no ownership check:\n  ${missing.join('\n  ')}`).toEqual([])
  })

  it('scopes delegation update to the delegator, widened only by personal.admin', () => {
    const body = handlerBody(PERSONAL_INBOX_ENDPOINTS.find(
      e => e.method === 'PATCH' && e.path === '/delegations/:id')!)
    expect(body, 'identity must come from the live principal').toMatch(/personalPrincipal\(/)
    expect(body, 'cross-user widening must be a capability check, not a token role')
      .toMatch(/isPersonalAdmin\(/)
    expect(body, 'the SQL must still bind the delegator').toMatch(/user_id\s*=\s*\$3/)
  })

  it('resolves the delete-relationship parent action before deleting', () => {
    const body = handlerBody(PERSONAL_INBOX_ENDPOINTS.find(
      e => e.path === '/relationships/:relId')!)
    expect(body, 'must resolve the parent action').toMatch(/source_action_id/)
    expect(body.indexOf('requireActionAccess'),
      'ownership must be proved before deleteRelation runs')
      .toBeLessThan(body.indexOf('deleteRelation('))
  })

  it('binds SELF routes to the live principal, never to a token field or body', () => {
    const problems: string[] = []
    for (const e of PERSONAL_INBOX_ENDPOINTS.filter(x => x.scope === 'SELF')) {
      const body = stripComments(handlerBody(e))
      if (/req\.auth\??\.userId/.test(body)) problems.push(`${key(e)} uses req.auth.userId`)
      if (/req\.auth\??\.role/.test(body))   problems.push(`${key(e)} uses req.auth.role`)
      // Any of the three approved live-principal paths: the helper itself, the
      // personalAgent wrapper around it, or the action-access guard that
      // resolves it. What is banned is deriving identity from the token.
      if (!/personalPrincipal\(|personalIds\(|principalOf\(|requireActionAccess\(/.test(body)) {
        problems.push(`${key(e)} never resolves the live principal`)
      }
    }
    expect(problems, problems.join('\n  ')).toEqual([])
  })
})

// ─── 4. Tenant-wide routes are owner-only ─────────────────────────────────────
describe('tenant-wide Personal Inbox routes require personal.admin', () => {
  const tenantWide = PERSONAL_INBOX_ENDPOINTS.filter(e => e.scope === 'TENANT_ADMIN')

  it('covers the seven tenant-wide reads and the two SLA policy mutations', () => {
    expect(tenantWide.filter(e => e.kind === 'READ').length).toBe(7)
    // 2 SLA policy mutations + the notification scan closed by Phase 2C-4B.
    expect(tenantWide.filter(e => e.kind === 'MUTATION').length).toBe(3)
  })

  it('requires personal.admin and nothing weaker', () => {
    for (const e of tenantWide) {
      expect(e.capabilities, `${key(e)}`).toEqual(['personal.admin'])
    }
  })

  it('puts every SLA policy mutation behind personal.admin', () => {
    const slaPolicy = PERSONAL_INBOX_ENDPOINTS.filter(
      e => e.kind === 'MUTATION' && e.path.startsWith('/sla-rules'))
    expect(slaPolicy.length).toBe(2)
    for (const e of slaPolicy) expect(e.capabilities).toEqual(['personal.admin'])
  })

  it('keeps action-local SLA pause/resume on personal.write, not personal.admin', () => {
    const local = PERSONAL_INBOX_ENDPOINTS.filter(e => /\/sla\/(pause|resume)$/.test(e.path))
    expect(local.length).toBe(2)
    for (const e of local) expect(e.capabilities, `${key(e)}`).toEqual(['personal.write'])
  })
})

// ─── 5. Ordinary mutations, and the assignment-field split ────────────────────
describe('ordinary Personal Inbox mutations', () => {
  it('require personal.write', () => {
    const ordinary = PERSONAL_INBOX_ENDPOINTS.filter(
      e => e.kind === 'MUTATION' && e.classification === 'PERSONAL_SELF_MUTATION')
    expect(ordinary.length).toBeGreaterThan(0)
    for (const e of ordinary) {
      expect(e.capabilities, `${key(e)}`).toContain('personal.write')
    }
  })

  it('never guards a true mutation with personal.view alone', () => {
    const bad = PERSONAL_INBOX_ENDPOINTS
      .filter(e => e.kind === 'MUTATION')
      .filter(e => e.capabilities.length === 1 && e.capabilities[0] === 'personal.view')
      .map(key)
    expect(bad, `a write authorized by a read capability:\n  ${bad.join('\n  ')}`).toEqual([])
  })

  it('gates the assignment fields on personal.admin at PATCH /actions/:id', () => {
    const patch = PERSONAL_INBOX_ENDPOINTS.find(
      e => e.file === 'actions.ts' && e.method === 'PATCH' && e.path === '/:id')!
    const body = handlerBody(patch)
    expect(body, 'must field-guard the assignment fields')
      .toMatch(/requireCapabilityForFields\(\s*ASSIGNMENT_FIELDS\s*,\s*'personal\.admin'\s*\)/)
    const decl = src('actions.ts')
    for (const f of ACTION_ASSIGNMENT_FIELDS) {
      expect(decl, `ASSIGNMENT_FIELDS must list ${f}`).toContain(`'${f}'`)
    }
  })

  it('validates the reassignment target and the role literal', () => {
    const body = handlerBody(PERSONAL_INBOX_ENDPOINTS.find(
      e => e.file === 'actions.ts' && e.method === 'PATCH' && e.path === '/:id')!)
    expect(body, 'assignee must be proved a tenant member').toMatch(/isTenantMember\(/)
    expect(body, 'role must be validated against the canonical set').toMatch(/USER_ROLES/)
    expect(body.indexOf('isTenantMember('), 'validation must precede the UPDATE')
      .toBeLessThan(body.indexOf('UPDATE actions'))
  })

  it('binds the delegation delegator server-side and refuses caller-supplied ones', () => {
    const body = handlerBody(PERSONAL_INBOX_ENDPOINTS.find(
      e => e.method === 'POST' && e.path === '/delegations')!)
    expect(body, 'delegator comes from the live principal').toMatch(/personalPrincipal\(/)
    for (const f of ['user_id', 'delegator_id', 'created_by']) {
      expect(body, `a caller-supplied ${f} must be refused`).toContain(`'${f}'`)
    }
    expect(body, 'delegate must be proved a tenant member').toMatch(/isTenantMember\(/)
  })

  it('requires both authorities for the personal-agent assistant route', () => {
    const ask = PERSONAL_INBOX_ENDPOINTS.find(e => e.path === '/me/agent/ask')!
    expect([...ask.capabilities].sort()).toEqual(['assistant.use', 'personal.write'])
    expect(handlerBody(ask)).toMatch(/requireAllCapabilities\(/)
    // The conjunction must be behaviourally real, not two names for one set.
    const both = USER_ROLES.filter(r => ask.capabilities.every(
      c => (SERVER_ROLE_CAPS[r] as readonly string[]).includes(c)))
    const writeOnly = holders('personal.write').filter(r => !both.includes(r))
    expect(writeOnly.length,
      'at least one role must hold personal.write but not assistant.use').toBeGreaterThan(0)
  })
})

// ─── 6. The holder matrix — D10-R and D11 ─────────────────────────────────────
describe('Personal Inbox capability holders', () => {
  it('keeps personal.view exactly as the certified baseline had it', () => {
    expect(holders('personal.view')).toEqual(
      ['owner', 'project_manager', 'engineer', 'procurement', 'field_ops', 'viewer'])
  })

  it('grants personal.write to the personal.view holders MINUS viewer (D10-R)', () => {
    const expected = holders('personal.view').filter(r => r !== 'viewer')
    expect(holders('personal.write')).toEqual(expected)
  })

  it('grants personal.admin to the owner alone (D11)', () => {
    expect(holders('personal.admin')).toEqual(['owner'])
  })

  it('does not give the platform administrator any Personal Inbox authority', () => {
    for (const cap of ['personal.view', 'personal.write', 'personal.admin']) {
      expect((SERVER_ROLE_CAPS.admin as readonly string[]).includes(cap),
        `admin must not hold ${cap}`).toBe(false)
    }
  })

  it('keeps ADR-014 D3 intact — viewer holds no action capability at all', () => {
    const viewerActions = (SERVER_ROLE_CAPS.viewer as readonly string[])
      .filter(c => (ACTION_CAPABILITIES as readonly string[]).includes(c))
    expect(viewerActions, 'ADR-014 D3 must survive Phase 2C-4A').toEqual([])
    expect((SERVER_ROLE_CAPS.viewer as readonly string[]).includes('personal.write')).toBe(false)
  })

  it('keeps both new capabilities server-only', () => {
    for (const role of USER_ROLES) {
      for (const cap of ['personal.write', 'personal.admin']) {
        expect((CLIENT_ROLE_CAPS[role] as readonly string[]).includes(cap)).toBe(false)
      }
    }
  })
})

// ─── 7. Stale-token closure across the touched surface ────────────────────────
describe('no in-scope route authorizes from the token', () => {
  it('has removed every stale JWT role guard from the Personal Inbox files', () => {
    const problems: string[] = []
    for (const file of PI_FILES) {
      const s = src(file)
      for (const pattern of [
        /_requireAdminOrPm/, /requireRole\(/, /_requireAdmin\(/,
        /req\.auth\??\.role/, /req\.auth\??\.userId/,
      ]) {
        // Comments explaining what was removed are fine; code is not.
        if (pattern.test(stripComments(s))) problems.push(`${file} still matches ${pattern}`)
      }
    }
    expect(problems, problems.join('\n  ')).toEqual([])
  })

  it('records the pre-existing route shadowing, and does not let it grow', () => {
    // Derived from source: a literal single-segment GET declared AFTER GET /:id
    // is unreachable. Asserting the derived set equals the recorded one means a
    // newly shadowed route fails here instead of silently answering 404.
    const s = src('actions.ts')
    const order = [...s.matchAll(/actionsRouter\.get\('([^']+)'/g)].map(m => m[1]!)
    const idIndex = order.indexOf('/:id')
    expect(idIndex, 'GET /:id must exist for this check to mean anything').toBeGreaterThan(-1)

    const shadowed = order
      .slice(idIndex + 1)
      .filter(p => /^\/[^/:]+$/.test(p))   // single literal segment, no param
      .sort()
    expect(shadowed, 'a NEW shadowed Personal Inbox route appeared')
      .toEqual([...KNOWN_SHADOWED_ROUTES].map(r => r.path).sort())
  })

  it('records every live defect this slice closed', () => {
    expect(CLOSED_LIVE_DEFECTS.length).toBe(7)
    for (const d of CLOSED_LIVE_DEFECTS) {
      expect(d.route.length).toBeGreaterThan(5)
      expect(d.wasReachableBy.length).toBeGreaterThan(5)
    }
  })
})

// ─── 8. The notification deferral is closed by building the model ────────────
describe('the notification ownership model', () => {
  const notif = PERSONAL_INBOX_ENDPOINTS.filter(e => e.file === 'notifications.ts')

  it('closes all seven routes', () => {
    expect(notif.length).toBe(7)
    expect(notif.filter(e => e.kind === 'READ').length).toBe(2)
    expect(notif.filter(e => e.kind === 'MUTATION').length).toBe(5)
  })

  it('guards reads with personal.view, personal state with personal.write, scan with personal.admin', () => {
    const cap = (path: string) => notif.find(e => e.path === path)!.capabilities
    expect(cap('/notifications')).toEqual(['personal.view'])
    expect(cap('/notifications/count')).toEqual(['personal.view'])
    for (const path of ['/notifications/:id/read', '/notifications/:id/dismiss',
                        '/notifications/read-all', '/notifications/clear']) {
      expect(cap(path), path).toEqual(['personal.write'])
    }
    expect(cap('/notifications/scan')).toEqual(['personal.admin'])
  })

  it('leaves none of them PENDING_PHASE2', () => {
    for (const e of notif) {
      const live = byKey.get(key(e))
      expect(live, `${key(e)}: no such endpoint`).toBeDefined()
      expect(live!.capability, `${key(e)} must be guarded`).not.toBeNull()
      expect(ENDPOINT_EXCEPTIONS[endpointKey(e.file, e.router, e.method, e.path)],
        `${key(e)} must be genuinely guarded, not excepted out of the census`).toBeUndefined()
    }
  })

  it('binds every notification route to the live principal and its delivery row', () => {
    const s = stripComments(src('notifications.ts'))
    expect(s, 'identity must come from the live principal').toMatch(/personalPrincipal\(/)
    expect(s, 'no token-derived identity').not.toMatch(/req\.auth\??\.userId/)
    expect(s, 'no token-derived authority').not.toMatch(/req\.auth\??\.role/)
  })

  it('accepts no caller-supplied recipient, audience or capability set', () => {
    // Comments stripped: the header explains that these cannot be submitted,
    // and an explanation must never satisfy the assertion.
    const s = stripComments(src('notifications.ts'))
    for (const forbidden of ['recipient_id', 'required_capabilities', 'audience',
                             'read_for_user', 'dismiss_for_user']) {
      expect(s, `${forbidden} must not be readable from a request`).not.toContain(forbidden)
    }
  })

  it('records how the deferral was resolved', () => {
    expect(NOTIFICATION_OWNERSHIP_RESOLUTION.decision).toBe('D13')
    expect(NOTIFICATION_OWNERSHIP_RESOLUTION.migration).toMatch(/085/)
    expect(NOTIFICATION_OWNERSHIP_RESOLUTION.legacyBackfill).toMatch(/LEGACY_OWNER_ONLY/)
  })
})

// ─── 9. Exit backlog ──────────────────────────────────────────────────────────
describe('the Phase 2C-4A exit backlog', () => {
  it('has been fully drained by Phase 2C-5, and the seven are accounted for', () => {
    // At Phase 2C-4A exit this asserted exactly 7 pending ordinary mutations in
    // three named groups: scim.ts 4, iot.ts 2, denverMcp.ts 1. ADR-014
    // Phase 2C-5 closed all seven by establishing a trust boundary for each
    // rather than by inventing a user capability, so the pending count is now
    // zero. The group decomposition is still asserted below — against the
    // endpoints that carry a boundary exception — so "drained" cannot be
    // achieved by the endpoints quietly disappearing.
    const pending = endpoints
      .filter(e => MUTATION_METHODS.has(e.method) && !e.capability)
      .filter(e => !ENDPOINT_EXCEPTIONS[endpointKey(e.file, e.router, e.method, e.path)])
    expect(pending.map(e => e.key), 'Phase 2C-5 exit: zero pending ordinary mutations').toEqual([])

    const closed = endpoints
      .filter(e => MUTATION_METHODS.has(e.method) && !e.capability)
      .filter(e => ENDPOINT_EXCEPTIONS[endpointKey(e.file, e.router, e.method, e.path)])
      .filter(e => ['scim.ts', 'iot.ts', 'denverMcp.ts'].includes(e.file))
    expect(closed.length, 'the same seven, now boundary-classified').toBe(7)

    const byFile: Record<string, number> = {}
    for (const e of closed) byFile[e.file] = (byFile[e.file] ?? 0) + 1
    expect(byFile).toEqual({ 'scim.ts': 4, 'iot.ts': 2, 'denverMcp.ts': 1 })
  })

  it('leaves no pending endpoint in the three closed files', () => {
    const stillPending = endpoints
      .filter(e => [...PI_FILES, 'notifications.ts'].includes(e.file) && !e.capability)
      .map(e => e.key)
    expect(stillPending,
      `actions/personalAgent/myWork must be fully closed:\n  ${stillPending.join('\n  ')}`).toEqual([])
  })
})
