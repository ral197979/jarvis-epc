/**
 * ADR-014 Phase 3I — the `ai.govern` administrator-exposure ratchet.
 *
 * `ai.govern` is the one business-adjacent authority the PLATFORM administrator
 * holds (capabilities.ts, ADR-014 Phase 2A §22). D26 fixes what that means: it
 * authorizes AI governance operations. It is not `tenant.business.read.all`.
 *
 * Phase 3G found one route where that distinction had already been lost —
 * `GET /agent-actions/_stats` rolled up every project in the tenant for a
 * principal with no tenant-wide project scope. This file exists to hold the
 * whole surface, not that one route: the effective admission set, the payload
 * class of each admitted route, and the scope model each one uses.
 *
 * Structural rather than behavioural on purpose. Admin and Owner differ by
 * capability, so a behavioural suite proves what Admin sees today; a ratchet
 * proves the route still asks the question if the grants ever move.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { SERVER_ROLE_CAPS } from '../authz/capabilities'
import { TWIN_SCOPE_POLICIES } from '../authz/polymorphicScopePolicies'

const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')

const ADMIN = SERVER_ROLE_CAPS['admin'] as readonly string[]
const OWNER = SERVER_ROLE_CAPS['owner'] as readonly string[]

describe('ai.govern is governance authority, not business-data authority (D26)', () => {
  it('is held by exactly owner and admin, and Phase 3I moved no holder', () => {
    const holders = (Object.keys(SERVER_ROLE_CAPS) as string[])
      .filter(r => (SERVER_ROLE_CAPS[r as never] as readonly string[]).includes('ai.govern'))
      .sort()
    expect(holders).toEqual(['admin', 'owner'])
  })

  it('does not carry business-data authority with it', () => {
    // The whole threat model in one assertion: the platform administrator holds
    // ai.govern and NONE of the authorities that would let them read the
    // tenant's business records directly. Any route that hands them business
    // data is therefore doing it through ai.govern, which is the defect class.
    for (const business of [
      'crossdomain.read', 'crossdomain.write', 'project.view', 'project.list.all',
      'portfolio.view', 'personal.admin', 'cost.view', 'engineering.view',
      'quality.view', 'construction.view', 'docs.view', 'procurement.view',
    ]) {
      expect(ADMIN, `admin must not hold ${business}`).not.toContain(business)
    }
    // …and the distinction is real: the Owner does hold them.
    expect(OWNER).toContain('crossdomain.read')
    expect(OWNER).toContain('project.list.all')
  })

  it('leaves admin a platform administrator, not a tenant business superuser', () => {
    expect([...ADMIN].sort()).toEqual([
      'ai.govern', 'audit.view', 'platform.admin', 'platform.automation',
      'platform.export', 'platform.identity', 'platform.integrations',
    ])
  })
})

describe('the AI recommendation queue separates governance from payload (§14, §29, §30)', () => {
  const service = src('services/ai/aiGovernance.ts')
  const route   = src('routes/aiGovernance.ts')

  it('no longer selects the whole row', () => {
    // `SELECT *` was the defect: it returned every business column of every
    // pending recommendation in the tenant to any ai.govern holder.
    expect(service).not.toMatch(/SELECT \* FROM ai_recommendation_queue/)
  })

  it('classes the business columns as the ones /preview already gates', () => {
    const business = /RECOMMENDATION_BUSINESS_COLUMNS = \[([\s\S]*?)\]/.exec(service)?.[1] ?? ''
    for (const col of ['reason', 'data_signals', 'affected_entities', 'rollback_plan', 'preview_data']) {
      expect(business, `${col} is business payload`).toContain(`'${col}'`)
    }
    // previewRecommendation is the contract being matched: it returns these and
    // requires crossdomain.read. The list must not be a cheaper way to the same
    // fields.
    const preview = /previewRecommendation[\s\S]*?FROM ai_recommendation_queue/.exec(service)?.[0] ?? ''
    for (const col of ['affected_entities', 'rollback_plan', 'data_signals', 'reason']) {
      expect(preview).toContain(col)
    }
    expect(route).toMatch(/preview[\s\S]*?requireCapability\('crossdomain\.read'\)/)
  })

  it('keeps the governance columns free of business payload', () => {
    const gov = /RECOMMENDATION_GOVERNANCE_COLUMNS = \[([\s\S]*?)\] as const/.exec(service)?.[1] ?? ''
    expect(gov).toBeTruthy()
    for (const col of ['reason', 'data_signals', 'affected_entities', 'rollback_plan', 'preview_data']) {
      expect(gov, `${col} must not be a governance column`).not.toContain(`'${col}'`)
    }
    // Enough left to actually run the queue — otherwise the fix would have
    // closed the leak by making ai.govern useless (§56).
    for (const col of ['id', 'status', 'category', 'urgency_score', 'approval_required']) {
      expect(gov).toContain(`'${col}'`)
    }
  })

  it('decides on the LIVE role, not the token claim (§36)', () => {
    // req.auth.role is a JWT claim and survives a role change until the token
    // expires. resolveCurrentUser re-reads users.role on every request.
    expect(route).toMatch(/resolveCurrentUser/)
    expect(route).not.toMatch(/roleHasCapability\(\s*r?\.?auth\??\.role/)
  })

  it('composes the column list from literals, never from the request (§11)', () => {
    const fn = /export async function listPendingRecommendations[\s\S]*?\n}/.exec(service)?.[0] ?? ''
    expect(fn).toBeTruthy()
    for (const tainted of ['req.', 'params', 'query', 'body']) {
      expect(fn, `column list must not read ${tainted}`).not.toContain(tainted)
    }
    expect(fn).toMatch(/columns\.join/)
  })
})

describe('caller-selected AI targets are authorized, not believed (§15, §16, §24)', () => {
  const agents    = src('routes/agents.ts')
  const readiness = src('routes/agentReadiness.ts')
  const scope     = src('authz/recordScope.ts')

  it('authorizes the scope the caller names on plan and execute', () => {
    for (const path of ["'/plan'", "'/execute'"]) {
      const line = agents.split('\n').find(l => l.includes(`agentsRouter.post(${path}`)) ?? ''
      expect(line, `${path} must keep its functional capability`).toContain("requireCapability('ai.govern')")
      expect(line, `${path} must authorize the caller-supplied scope`)
        .toContain("requireBodyPolymorphicScope('scope', 'scopeId')")
      // Capability first: the functional gate refuses before any scope lookup.
      expect(line.indexOf('requireCapability')).toBeLessThan(line.indexOf('requireBodyPolymorphicScope'))
    }
  })

  it('authorizes the scope the caller names on readiness coordination', () => {
    const line = readiness.split('\n').find(l => l.includes("agentReadinessRouter.post('/coordinate'")) ?? ''
    expect(line).toContain("requireCapability('ai.govern')")
    expect(line).toContain("requireBodyPolymorphicScope('scopeType', 'scopeId')")
  })

  it('reuses the Phase-3H registry rather than inventing an AI parent rule (§41)', () => {
    const fn = /export function requireBodyPolymorphicScope[\s\S]*?\n}\n/.exec(scope)?.[0] ?? ''
    expect(fn).toBeTruthy()
    expect(fn, 'the kind is resolved through the canonical registry').toMatch(/twinScopePolicy\(/)
    expect(fn, 'the identifier through the canonical resolver').toMatch(/resolvePolymorphicScope\(/)
    // No second membership implementation, and no AI-specific project column.
    expect(fn).not.toMatch(/FROM project_members/)
    expect(fn).not.toMatch(/project_id/)
  })

  it('fails closed on a kind the registry does not model (§5)', () => {
    const fn = /export function requireBodyPolymorphicScope[\s\S]*?\n}\n/.exec(scope)?.[0] ?? ''
    expect(fn).toMatch(/UNSUPPORTED_KIND[\s\S]*?400/)
    expect(fn).not.toMatch(/TENANT_GLOBAL/)   // no default-to-tenant branch
    // `global` is the agent system's own catch-all scope and is deliberately
    // NOT a registry kind, so it denies rather than authorizing tenant-wide
    // autonomous work.
    expect(TWIN_SCOPE_POLICIES.map(p => p.kind)).not.toContain('global')
  })
})

describe('project-scoped AI operations use the canonical record scope (§17)', () => {
  const coord = src('routes/autoCoordination.ts')

  it('scopes approve exactly as it scopes dismiss', () => {
    const reg = (verb: string) => coord.split('\n')
      .find(l => l.includes(`router.post('/coordination/recommendations/:id/${verb}'`)) ?? ''
    const approve = reg('approve')
    const dismiss = reg('dismiss')
    for (const [name, line] of [['approve', approve], ['dismiss', dismiss]] as const) {
      expect(line, `${name} keeps ai.govern`).toContain("requireCapability('ai.govern')")
      expect(line, `${name} enforces record scope`)
        .toContain("requireRecordScope('coordination_recommendations')")
    }
  })
})

describe('the AI decision of record names its real author (§24, §25)', () => {
  it('takes the reviewer from the principal, not the body', () => {
    const approvals = src('routes/agentApprovals.ts')
    expect(approvals, 'reviewedBy must not be destructured from the body')
      .not.toMatch(/const \{ reviewedBy[^}]*\} = req\.body/)
    expect(approvals).toMatch(/const reviewedBy = r\.auth\?\.sub/)
    // Both verdict routes, not just the approving one.
    expect((approvals.match(/const reviewedBy = r\.auth\?\.sub/g) ?? []).length).toBe(2)
  })

  it('takes the optimization approver from the principal, not the body', () => {
    const opt = src('routes/optimization.ts')
    expect(opt).not.toMatch(/const \{ approvedBy \} = req\.body/)
    expect(opt).toMatch(/const approvedBy = uid\(req\)/)
  })
})

describe('the Phase-3G finding stays closed (§20, §48)', () => {
  it('keeps the collection predicate on the agent-action rollup', () => {
    const stats = src('routes/agentActionsRoutes.ts')
    expect(stats).toMatch(/_stats/)
    // The CALL, not the import. Asserting the identifier appears anywhere in
    // the file passes even when the predicate has been replaced by '' at the
    // call site, which is exactly the Phase-3G defect being held closed.
    expect(stats, 'the rollup is still scoped, not tenant-wide')
      .toMatch(/sql:\s*collectionScopeSql\(\s*principal,\s*'agent_actions',\s*'project_id'/)
    expect(stats, 'and its parameters travel with it')
      .toMatch(/params:\s*collectionScopeParams\(/)
  })
})
