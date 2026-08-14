/**
 * ADR-014 Phase 1 — capability registry.
 *
 * These tests exist to stop the four defects ADR-014 documents from returning:
 *   1. a role that matches no branch and falls through to full access,
 *   2. an empty filter result that restores the full navigation,
 *   3. a route reachable without an authorization check,
 *   4. a second permission table drifting from the first.
 */

import { describe, it, expect } from 'vitest'
import {
  USER_ROLES,
  CAPABILITIES,
  SCREEN_CAP,
  ROLE_CAPS,
  canSee,
  capabilityForScreen,
  isUserRole,
  visibleScreens,
  type UserRole,
} from '../../config/capabilities'
import { effectiveCapabilities, effectiveWriteRole } from '../../config/capabilities'
import { NAVIGATION_ITEMS } from '../../config/navigation'
import { TAB_MAP } from '../../components/ContentRouter'
import type { AuthState, OwnerConfig } from '../../modules/store/appSlice'

// ─── Registry completeness ────────────────────────────────────────────────────
describe('SCREEN_CAP completeness', () => {
  it('covers every sidebar destination', () => {
    const missing = NAVIGATION_ITEMS.map(i => i.id).filter(id => !capabilityForScreen(id))
    expect(missing, `nav ids with no capability: ${missing.join(', ')}`).toEqual([])
  })

  it('covers every router destination, including the hidden ones', () => {
    // The hidden TAB_MAP-only routes (commissioning, audit, overview, plan,
    // resources, jobs, engineering, procurement) are precisely what a stale deep
    // link reaches. Leaving them unmapped would reopen the gap.
    const missing = Object.keys(TAB_MAP).filter(id => !capabilityForScreen(id))
    expect(missing, `router tabs with no capability: ${missing.join(', ')}`).toEqual([])
  })

  it('maps no destination the router cannot render', () => {
    const navIds = new Set(NAVIGATION_ITEMS.map(i => i.id))
    const phantom = Object.keys(SCREEN_CAP).filter(id => !(id in TAB_MAP) && !navIds.has(id))
    expect(phantom, `registry entries with no route: ${phantom.join(', ')}`).toEqual([])
  })

  it('uses only declared capabilities', () => {
    const declared = new Set<string>(CAPABILITIES)
    const unknown = [...new Set(Object.values(SCREEN_CAP))].filter(c => !declared.has(c))
    expect(unknown).toEqual([])
  })
})

// ─── Role table matches the database ──────────────────────────────────────────
describe('ROLE_CAPS', () => {
  it('is keyed on exactly the seven user_role enum values', () => {
    // Mirrors api/db/migrations/001_tenants_and_users.sql:17-25. A role present
    // in the DB but absent here is the fall-through bug ADR-014 Finding 1.
    expect(Object.keys(ROLE_CAPS).sort()).toEqual([...USER_ROLES].sort())
    expect(USER_ROLES).toHaveLength(7)
  })

  it('grants only declared capabilities', () => {
    const declared = new Set<string>(CAPABILITIES)
    for (const role of USER_ROLES) {
      const unknown = ROLE_CAPS[role].filter(c => !declared.has(c))
      expect(unknown, `${role} grants unknown capability`).toEqual([])
    }
  })

  it('gives the tenant owner every capability', () => {
    expect([...ROLE_CAPS.owner].sort()).toEqual([...CAPABILITIES].sort())
  })

  it('does not make Platform Administrator a second owner', () => {
    // `admin` aliased ALL_CAPS, so a platform administrator silently held every
    // project, commercial and portfolio capability in the tenant.
    expect([...ROLE_CAPS.admin].sort()).not.toEqual([...CAPABILITIES].sort())
    expect(ROLE_CAPS.admin.length).toBeLessThan(ROLE_CAPS.owner.length)
  })
})

// ─── Role-universe parity: the guard that would have caught F2 ────────────────
describe('role universes cannot drift apart', () => {
  // F2: the DB had seven roles and the client store type had five, so
  // `procurement` and `field_ops` were unreachable in the running app while the
  // registry happily computed projections for them that nothing could request.
  // Every universe that participates in an authorization decision is asserted
  // here against the database, which is the authority.
  const DB_USER_ROLE_ENUM = [
    'owner', 'admin', 'project_manager', 'engineer', 'procurement', 'field_ops', 'viewer',
  ] as const

  it('matches the user_role enum in migration 001 verbatim', async () => {
    // Read the migration rather than trusting a copy of it: if an eighth role is
    // ever added to the database, this fails until authorization is updated.
    const fs  = await import('node:fs/promises')
    const sql = await fs.readFile('api/db/migrations/001_tenants_and_users.sql', 'utf8')
    const body = sql.slice(sql.indexOf('CREATE TYPE user_role AS ENUM'))
    const enumValues = [...body.slice(0, body.indexOf(');')).matchAll(/'([a-z_]+)'/g)].map(m => m[1])
    expect(enumValues.sort()).toEqual([...DB_USER_ROLE_ENUM].sort())
    expect([...USER_ROLES].sort()).toEqual(enumValues.sort())
  })

  it('is keyed identically in USER_ROLES, ROLE_CAPS and the client role types', () => {
    expect([...USER_ROLES].sort()).toEqual([...DB_USER_ROLE_ENUM].sort())
    expect(Object.keys(ROLE_CAPS).sort()).toEqual([...DB_USER_ROLE_ENUM].sort())

    // The authenticated role type and the preview role type are both `UserRole`.
    // These compile-time assignments fail the build — with no casts — if either
    // narrows again the way `OwnerConfig['activeRole']` had to five values.
    for (const role of DB_USER_ROLE_ENUM) {
      const authRole:    NonNullable<AuthState['role']>  = role
      const previewRole: OwnerConfig['activeRole']       = role
      expect(isUserRole(authRole)).toBe(true)
      expect(isUserRole(previewRole)).toBe(true)
    }
  })
})

// ─── Fail closed ──────────────────────────────────────────────────────────────
describe('canSee fails closed', () => {
  it('denies an unknown role', () => {
    // The previous filter's trailing `return true`.
    expect(canSee('costcontrol', 'procurement_manager')).toBe(false)
    expect(canSee('costcontrol', 'pm')).toBe(false)
    expect(canSee('costcontrol', 'exec')).toBe(false)
  })

  it('denies an absent or malformed role', () => {
    // The previous filter treated a falsy role as owner.
    expect(canSee('portfolio', undefined)).toBe(false)
    expect(canSee('portfolio', null)).toBe(false)
    expect(canSee('portfolio', '')).toBe(false)
    expect(canSee('portfolio', 42)).toBe(false)
    expect(canSee('portfolio', { role: 'owner' })).toBe(false)
  })

  it('denies an unregistered destination even for owner', () => {
    expect(canSee('some-future-screen', 'owner')).toBe(false)
  })

  it('is not fooled by inherited Object properties', () => {
    expect(capabilityForScreen('constructor')).toBeUndefined()
    expect(canSee('toString', 'owner')).toBe(false)
  })

  it('never returns the full navigation as a fallback', () => {
    // The `_filtered.length ? _filtered : orderedItems` safety net.
    expect(visibleScreens('not-a-role')).toEqual([])
    expect(visibleScreens(undefined)).toEqual([])
  })
})

// ─── Regressions for the specific roles that fell through ─────────────────────
describe('procurement and field_ops are gated (ADR-014 Finding 1)', () => {
  const commercial = ['costcontrol', 'budget', 'evm', 'billing', 'changeorders', 'costentry', 'costiq']
  const platform   = ['system', 'automation', 'integrations', 'mcp']

  for (const role of ['procurement', 'field_ops'] as UserRole[]) {
    it(`${role} cannot open commercial screens`, () => {
      for (const id of commercial) expect(canSee(id, role), `${role} → ${id}`).toBe(false)
    })

    it(`${role} cannot open platform administration`, () => {
      for (const id of platform) expect(canSee(id, role), `${role} → ${id}`).toBe(false)
    })

    it(`${role} cannot open the portfolio roll-up`, () => {
      expect(canSee('portfolio', role)).toBe(false)
      expect(canSee('portfolioiq', role)).toBe(false)
    })

    it(`${role} still opens its own work`, () => {
      expect(canSee('mywork', role)).toBe(true)
      expect(canSee('notifications', role)).toBe(true)
    })
  }
})

describe('role projections are non-empty and bounded', () => {
  it('every role sees something and only the owner sees everything', () => {
    const total = Object.keys(SCREEN_CAP).length
    for (const role of USER_ROLES) {
      const n = visibleScreens(role).length
      expect(n, `${role} sees nothing`).toBeGreaterThan(0)
      if (role === 'owner') expect(n).toBe(total)
      else expect(n, `${role} sees everything`).toBeLessThan(total)
    }
  })

  it('viewer holds no write-adjacent or administrative capability', () => {
    expect(canSee('system', 'viewer')).toBe(false)
    expect(canSee('costcontrol', 'viewer')).toBe(false)
    expect(canSee('portfolio', 'viewer')).toBe(false)
    expect(canSee('audit', 'viewer')).toBe(false)
  })

  it('project_manager has project depth but is not a portfolio role', () => {
    // portfolio.view ≠ project.view, and project.list.all ≠ project.view. A PM
    // manages assigned projects; it does not read the organisation-wide registry
    // or the portfolio roll-up.
    expect(canSee('rfis',        'project_manager')).toBe(true)
    expect(canSee('lifecycle',   'project_manager')).toBe(true)
    expect(canSee('projects',    'project_manager')).toBe(false)
    expect(canSee('portfolio',   'project_manager')).toBe(false)
    expect(canSee('portfolioiq', 'project_manager')).toBe(false)
    expect(canSee('executive',   'project_manager')).toBe(false)
    expect(canSee('costcontrol', 'project_manager')).toBe(false)
    expect(canSee('system',      'project_manager')).toBe(false)
    expect(canSee('integrations','project_manager')).toBe(false)
  })

  it('Platform Administrator administers the platform and nothing else', () => {
    for (const id of ['system', 'automation', 'integrations', 'mcp', 'audit']) {
      expect(canSee(id, 'admin'), `admin should open ${id}`).toBe(true)
    }
    // Everything Decision C says a platform administrator must not receive.
    for (const id of [
      'portfolio', 'portfolioiq', 'executive', 'predict', 'dash', 'overview', // portfolio
      'projects', 'jobs',                                                     // org-wide registry
      'setup', 'lifecycle', 'construction', 'meetings',                       // project delivery
      'feed', 'processdesign', 'calc', 'drawings', 'bim', 'engineering',      // engineering
      'dailylogs', 'rfis', 'submittals',                                      // construction
      'commissioning', 'turnover',                                            // commissioning
      'budget', 'costcontrol', 'evm', 'billing', 'changeorders', 'costiq',    // commercial
      'subcontracts', 'vendorscore', 'procurement', 'plan',                   // procurement delivery
      'crm', 'proposals',                                                     // business development
    ]) {
      expect(canSee(id, 'admin'), `admin must not open ${id}`).toBe(false)
    }
  })
})

// ─── Preview is intersection, never elevation (Decision B) ────────────────────
describe('preview narrows and can never widen', () => {
  it('returns the authenticated capabilities when there is no valid preview', () => {
    expect(effectiveCapabilities('engineer')).toEqual(ROLE_CAPS.engineer)
    expect(effectiveCapabilities('engineer', 'not-a-role')).toEqual(ROLE_CAPS.engineer)
    expect(effectiveCapabilities('engineer', undefined)).toEqual(ROLE_CAPS.engineer)
  })

  it('returns nothing when the authenticated role is absent or unknown', () => {
    expect(effectiveCapabilities(undefined, 'owner')).toEqual([])
    expect(effectiveCapabilities('superadmin', 'owner')).toEqual([])
    expect(effectiveCapabilities(null, 'owner')).toEqual([])
  })

  it('is exactly set intersection for every ordered pair of roles', () => {
    for (const auth of USER_ROLES) {
      for (const preview of USER_ROLES) {
        const got = effectiveCapabilities(auth, preview)
        const want = ROLE_CAPS[auth].filter(c => ROLE_CAPS[preview].includes(c))
        expect([...got].sort(), `${auth} previewing ${preview}`).toEqual([...want].sort())
        // The invariant that matters: a preview never adds anything.
        for (const cap of got) {
          expect(ROLE_CAPS[auth], `${auth} previewing ${preview} gained ${cap}`).toContain(cap)
        }
      }
    }
  })

  it('does not let a viewer become an owner by previewing one', () => {
    expect(canSee('costcontrol', 'viewer', 'owner')).toBe(false)
    expect(canSee('system',      'viewer', 'owner')).toBe(false)
    expect(visibleScreens('viewer', 'owner')).toEqual(visibleScreens('viewer'))
  })

  it('does not transfer capabilities between incomparable roles', () => {
    // Engineer and procurement are not subsets of one another: each holds
    // something the other lacks. A count- or rank-based "downgrade" would leak
    // the smaller role's capabilities into the larger one. Intersection cannot.
    expect(canSee('subcontracts', 'engineer')).toBe(false)      // engineer lacks procurement.view
    expect(canSee('subcontracts', 'engineer', 'procurement')).toBe(false)
    expect(canSee('drawings', 'procurement')).toBe(false)       // procurement lacks engineering.view
    expect(canSee('drawings', 'procurement', 'engineer')).toBe(false)
    // What survives is only what both hold.
    expect(canSee('docs', 'engineer', 'procurement')).toBe(true)
  })

  it('narrows an owner previewing a field role', () => {
    expect(canSee('costcontrol', 'owner')).toBe(true)
    expect(canSee('costcontrol', 'owner', 'field_ops')).toBe(false)
    expect(canSee('dailylogs',   'owner', 'field_ops')).toBe(true)
    expect(visibleScreens('owner', 'field_ops')).toEqual(visibleScreens('field_ops'))
  })
})

// ─── Write affordances follow the same rule ───────────────────────────────────
describe('effectiveWriteRole', () => {
  it('fails closed to viewer without a valid authenticated role', () => {
    expect(effectiveWriteRole(undefined)).toBe('viewer')
    expect(effectiveWriteRole('exec')).toBe('viewer')
    expect(effectiveWriteRole(undefined, 'owner')).toBe('viewer')
  })

  it('keeps an authenticated viewer read-only whatever the preview claims', () => {
    expect(effectiveWriteRole('viewer', 'owner')).toBe('viewer')
    expect(effectiveWriteRole('viewer', 'project_manager')).toBe('viewer')
  })

  it('lets a preview of viewer make a privileged session read-only', () => {
    expect(effectiveWriteRole('owner', 'viewer')).toBe('viewer')
    expect(effectiveWriteRole('owner', 'engineer')).toBe('owner')
    expect(effectiveWriteRole('owner')).toBe('owner')
  })
})

// ─── Hidden destinations are guarded on what they render ──────────────────────
describe('hidden TAB_MAP-only destinations', () => {
  const navIds = new Set(NAVIGATION_ITEMS.map(i => i.id))
  const hidden = Object.keys(TAB_MAP).filter(id => !navIds.has(id))

  it('is the expected set of eight', () => {
    expect(hidden.sort()).toEqual(
      ['audit', 'commissioning', 'engineering', 'jobs', 'overview', 'plan', 'procurement', 'resources'].sort(),
    )
  })

  it('grants no hidden destination to every role', () => {
    // Five of these shared the generic `project.view`, which all seven roles
    // hold — so a stale bookmark opened the procurement and engineering module
    // hubs, the labour register and the jobs register for a viewer.
    for (const id of hidden) {
      const holders = USER_ROLES.filter(r => canSee(id, r))
      expect(holders.length, `${id} is open to every role`).toBeLessThan(USER_ROLES.length)
    }
  })

  it('keeps privileged hubs away from viewer and field roles', () => {
    for (const role of ['viewer', 'field_ops'] as UserRole[]) {
      for (const id of ['procurement', 'plan', 'engineering', 'jobs', 'overview', 'audit', 'resources']) {
        expect(canSee(id, role), `${role} must not deep-link ${id}`).toBe(false)
      }
    }
  })

  it('routes each hidden destination to the capability matching its content', () => {
    expect(capabilityForScreen('engineering')).toBe('engineering.view')
    expect(capabilityForScreen('procurement')).toBe('procurement.view')
    expect(capabilityForScreen('plan')).toBe('procurement.view')
    expect(capabilityForScreen('resources')).toBe('team.view')
    expect(capabilityForScreen('jobs')).toBe('project.list.all')
    expect(capabilityForScreen('overview')).toBe('portfolio.view')
    expect(capabilityForScreen('audit')).toBe('audit.view')
    expect(capabilityForScreen('commissioning')).toBe('commissioning.view')
  })
})

describe('isUserRole', () => {
  it('accepts every enum value and nothing else', () => {
    for (const r of USER_ROLES) expect(isUserRole(r)).toBe(true)
    for (const r of ['pm', 'exec', 'Owner', '', null, undefined, 0]) expect(isUserRole(r)).toBe(false)
  })
})
