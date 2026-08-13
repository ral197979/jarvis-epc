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
import { NAVIGATION_ITEMS } from '../../config/navigation'
import { TAB_MAP } from '../../components/ContentRouter'

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

  it('gives owner and admin every capability', () => {
    expect([...ROLE_CAPS.owner].sort()).toEqual([...CAPABILITIES].sort())
    expect([...ROLE_CAPS.admin].sort()).toEqual([...CAPABILITIES].sort())
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
  it('every role sees something and only owner/admin see everything', () => {
    const total = Object.keys(SCREEN_CAP).length
    for (const role of USER_ROLES) {
      const n = visibleScreens(role).length
      expect(n, `${role} sees nothing`).toBeGreaterThan(0)
      if (role === 'owner' || role === 'admin') expect(n).toBe(total)
      else expect(n, `${role} sees everything`).toBeLessThan(total)
    }
  })

  it('viewer holds no write-adjacent or administrative capability', () => {
    expect(canSee('system', 'viewer')).toBe(false)
    expect(canSee('costcontrol', 'viewer')).toBe(false)
    expect(canSee('portfolio', 'viewer')).toBe(false)
    expect(canSee('audit', 'viewer')).toBe(false)
  })

  it('project_manager has project depth but no portfolio roll-up or cost authority', () => {
    // The distinction the prototype surfaced: portfolio.view ≠ project.view.
    expect(canSee('projects', 'project_manager')).toBe(true)
    expect(canSee('rfis', 'project_manager')).toBe(true)
    expect(canSee('portfolio', 'project_manager')).toBe(false)
    expect(canSee('costcontrol', 'project_manager')).toBe(false)
  })
})

describe('isUserRole', () => {
  it('accepts every enum value and nothing else', () => {
    for (const r of USER_ROLES) expect(isUserRole(r)).toBe(true)
    for (const r of ['pm', 'exec', 'Owner', '', null, undefined, 0]) expect(isUserRole(r)).toBe(false)
  })
})
