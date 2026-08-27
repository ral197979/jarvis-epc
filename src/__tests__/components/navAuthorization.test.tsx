/**
 * ADR-014 Phase 1 — behavioural proof that the projection and the guard agree,
 * and that both read the AUTHENTICATED role.
 *
 * The registry unit tests prove `canSee()` is correct. These prove the two
 * consumers call it with the right subject: that the rendered sidebar contains
 * only permitted destinations, and that reaching a blocked destination *without*
 * the sidebar — a deep link, a persisted tab from a prior role, a hand-edited
 * localStorage preview — renders 403 rather than the screen.
 *
 * Every case signs in through `auth.role`, the value the server issues. None of
 * them casts: all seven `user_role` values are type-legal here, which is the
 * point of the F2 fix. The earlier version of this file set only
 * `ownerConfig.activeRole` and cast `procurement`/`field_ops` through `as Role`,
 * so it proved the registry agreed with itself and never noticed that an
 * authenticated viewer saw all 62 destinations.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('zustand/middleware', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>
  return {
    ...actual,
    persist: (fn: unknown) => fn,
    devtools: (fn: unknown) => fn,
    subscribeWithSelector: (fn: unknown) => fn,
  }
})

import { useAppStore } from '../../modules/store/appSlice'
import { NavSidebar } from '../../components/NavSidebar'
import { ContentRouter } from '../../components/ContentRouter'
import { canSee, visibleScreens, USER_ROLES, type UserRole } from '../../config/capabilities'
import { NAVIGATION_ITEMS, NAV_SECTIONS } from '../../config/navigation'

/**
 * Establish a session the way the app does: `auth.role` carries the
 * server-issued position, `ownerConfig.activeRole` carries the OwnerPanel
 * preview. They are deliberately independent so the tests can drive them apart.
 */
function signIn(opts: { authRole?: unknown; preview?: UserRole; activeTab?: string }) {
  const { authRole, preview = 'owner', activeTab = 'focus' } = opts
  useAppStore.setState({
    auth: {
      isAuthenticated: true,
      userId: 'u-1',
      tenantId: 't-1',
      role: authRole as UserRole | undefined,
      loginAt: '2026-08-14T00:00:00.000Z',
    },
    ownerConfig: {
      chatEnabled: true, writesEnabled: true, exportsEnabled: true,
      authEnabled: true, pinHash: '', activeRole: preview,
    },
    ui: {
      activeTab, ownerPanelOpen: false, cmdPaletteOpen: false, cmdQuery: '',
      navOrder: [], navHidden: {}, sidebarCollapsed: false,
      theme: 'dark', toasts: [], deepLink: null,
    },
  })
}

/** Nav ids actually rendered in the sidebar. */
function renderedNavIds(): string[] {
  const nav = screen.getByRole('navigation')
  return NAVIGATION_ITEMS
    .filter(item => nav.textContent?.includes(item.label))
    .map(item => item.id)
}

beforeEach(() => { signIn({ authRole: 'owner' }) })

// ─── The subject is the authenticated role (F1) ───────────────────────────────
describe('the sidebar projects the AUTHENTICATED role', () => {
  it.each([...USER_ROLES])('renders exactly the permitted destinations for %s', role => {
    signIn({ authRole: role, preview: role })
    render(<NavSidebar />)
    const shown = new Set(renderedNavIds())
    for (const item of NAVIGATION_ITEMS) {
      expect(shown.has(item.id), `${role} → ${item.id}`).toBe(canSee(item.id, role))
    }
  })

  it('ignores a stale owner preview for an authenticated viewer (F1 regression)', () => {
    // The exact production state that failed: JWT login writes auth.role=viewer
    // while ownerConfig keeps its persisted default of owner. This rendered all
    // 62 destinations, including costcontrol, budget, evm, billing and system.
    signIn({ authRole: 'viewer', preview: 'owner' })
    render(<NavSidebar />)
    const shown = new Set(renderedNavIds())

    expect(shown.size).toBe(visibleScreens('viewer').filter(id =>
      NAVIGATION_ITEMS.some(i => i.id === id)).length)
    expect(shown.size).toBeLessThan(NAVIGATION_ITEMS.length)
    for (const id of ['costcontrol', 'budget', 'evm', 'billing', 'system', 'mcp', 'integrations', 'portfolio']) {
      expect(shown.has(id), `authenticated viewer must not see ${id}`).toBe(false)
    }
  })

  it('renders nothing when no authenticated role is established', () => {
    // No Owner fallback: an unauthenticated or degraded session grants nothing,
    // even though the stored preview still says owner.
    signIn({ authRole: undefined, preview: 'owner' })
    render(<NavSidebar />)
    expect(renderedNavIds()).toEqual([])
  })

  it('renders nothing for an unknown authenticated role', () => {
    signIn({ authRole: 'superadmin', preview: 'owner' })
    render(<NavSidebar />)
    expect(renderedNavIds()).toEqual([])
  })

  it('drops section headings that have no permitted destination', () => {
    // The contract is disappearance, not greying out: a section with nothing in
    // it must not leave an empty heading advertising what the user cannot reach.
    // Section headings are the collapse toggles, so read those rather than the
    // sidebar's raw text (the brand block also says "Denver Engineering").
    signIn({ authRole: 'admin', preview: 'admin' })
    const { container } = render(<NavSidebar />)
    const renderedSections = [...container.querySelectorAll('button[aria-expanded]')]
      .map(b => b.textContent?.trim())

    const permitted = new Set(visibleScreens('admin'))
    const expected = NAV_SECTIONS
      .filter(sec => NAVIGATION_ITEMS.some(i => i.section === sec.id && permitted.has(i.id)))
      .map(sec => sec.label)

    expect(renderedSections).toEqual(expected)
    expect(renderedSections.length).toBeGreaterThan(0)
    expect(renderedSections.length).toBeLessThan(NAV_SECTIONS.length)
  })
})

// ─── Preview cannot elevate (Decision B) ──────────────────────────────────────
describe('preview narrows the sidebar and never widens it', () => {
  it('an owner previewing field_ops sees the field_ops rail', () => {
    signIn({ authRole: 'owner', preview: 'field_ops' })
    render(<NavSidebar />)
    const shown = new Set(renderedNavIds())
    expect(shown.has('dailylogs')).toBe(true)
    expect(shown.has('costcontrol')).toBe(false)
    expect(shown.has('system')).toBe(false)
  })

  it('an engineer previewing procurement gains no procurement destination', () => {
    // Incomparable roles: procurement holds procurement.view, engineer does not.
    // A rank- or count-based downgrade would hand it over. Intersection does not.
    signIn({ authRole: 'engineer', preview: 'procurement' })
    render(<NavSidebar />)
    const shown = new Set(renderedNavIds())
    for (const id of ['subcontracts', 'vendorscore', 'procurementrisk', 'directory']) {
      expect(shown.has(id), `engineer gained ${id} by previewing procurement`).toBe(false)
    }
  })

  it('a procurement user previewing engineer gains no engineering destination', () => {
    signIn({ authRole: 'procurement', preview: 'engineer' })
    render(<NavSidebar />)
    const shown = new Set(renderedNavIds())
    for (const id of ['drawings', 'bim', 'calc', 'processdesign']) {
      expect(shown.has(id), `procurement gained ${id} by previewing engineer`).toBe(false)
    }
  })
})

// ─── Route guard ──────────────────────────────────────────────────────────────
describe('route guard blocks destinations the sidebar hides', () => {
  it('renders 403 for a tab the authenticated role cannot open', () => {
    signIn({ authRole: 'engineer', preview: 'engineer', activeTab: 'costcontrol' })
    render(<ContentRouter policy={{}} />)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(/403/)
    expect(alert).toHaveTextContent(/cost\.view/)
  })

  it('blocks a viewer deep-linking cost control despite a stored owner preview (F1)', () => {
    signIn({ authRole: 'viewer', preview: 'owner', activeTab: 'costcontrol' })
    render(<ContentRouter policy={{}} />)
    expect(screen.getByRole('alert')).toHaveTextContent(/403/)
  })

  it('names the destination, the missing capability and the authenticated role', () => {
    signIn({ authRole: 'viewer', preview: 'viewer', activeTab: 'portfolio' })
    render(<ContentRouter policy={{}} />)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(/portfolio/)
    expect(alert).toHaveTextContent(/portfolio\.view/)
    expect(alert).toHaveTextContent(/viewer/)
  })

  it.each([
    ['viewer',      'procurement'],
    ['viewer',      'engineering'],
    ['viewer',      'jobs'],
    ['viewer',      'resources'],
    ['field_ops',   'plan'],
    ['field_ops',   'audit'],
    ['procurement', 'overview'],
    ['engineer',    'commissioning'],
  ] as [UserRole, string][])(
    'blocks %s deep-linking the hidden route %s',
    (role, tab) => {
      // Hidden routes are absent from the sidebar, so a stale bookmark is the
      // only way in — which is exactly why they need the same guard.
      signIn({ authRole: role, preview: role, activeTab: tab })
      render(<ContentRouter policy={{}} />)
      expect(screen.getByRole('alert')).toHaveTextContent(/403/)
    },
  )

  it('blocks when no authenticated role is established', () => {
    signIn({ authRole: undefined, preview: 'owner', activeTab: 'dash' })
    render(<ContentRouter policy={{}} />)
    expect(screen.getByRole('alert')).toHaveTextContent(/403/)
  })

  it('blocks when the authenticated role is unknown', () => {
    signIn({ authRole: 'pm', preview: 'owner', activeTab: 'dash' })
    render(<ContentRouter policy={{}} />)
    expect(screen.getByRole('alert')).toHaveTextContent(/403/)
  })

  it('lets a permitted destination through', () => {
    signIn({ authRole: 'owner', preview: 'owner', activeTab: 'focus' })
    render(<ContentRouter policy={{}} />)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('main')).toBeInTheDocument()
  })

  it('offers an escape hatch only to a destination the user may actually open', () => {
    // admin holds no personal.view, so the old hard-coded "Back to My Work"
    // would have landed on a second denial.
    signIn({ authRole: 'admin', preview: 'admin', activeTab: 'costcontrol' })
    const onNavigate = vi.fn()
    render(<ContentRouter policy={{}} onNavigate={onNavigate} />)
    const button = screen.queryByRole('button', { name: /available screen/i })
    if (button) {
      button.click()
      const target = onNavigate.mock.calls[0]?.[0] as string
      expect(canSee(target, 'admin')).toBe(true)
    }
  })

  it('narrows the guard when previewing, without widening it', () => {
    signIn({ authRole: 'owner', preview: 'viewer', activeTab: 'costcontrol' })
    render(<ContentRouter policy={{}} />)
    expect(screen.getByRole('alert')).toHaveTextContent(/403/)
  })
})
