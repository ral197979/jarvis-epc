/**
 * ADR-014 Phase 1 — behavioural proof that the projection and the guard agree.
 *
 * The registry unit tests prove `canSee()` is correct. These prove the two
 * consumers actually call it: that the rendered sidebar contains only permitted
 * destinations, and that reaching a blocked destination *without* the sidebar —
 * a deep link, a persisted tab from a prior role — renders 403 rather than the
 * screen. That second case is ADR-014 Finding 2, which had no guard at all.
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
import { canSee } from '../../config/capabilities'
import { NAVIGATION_ITEMS } from '../../config/navigation'

type Role = 'owner' | 'admin' | 'project_manager' | 'engineer' | 'viewer'

function signInAs(activeRole: unknown, activeTab = 'focus') {
  useAppStore.setState({
    ownerConfig: {
      chatEnabled: true, writesEnabled: true, exportsEnabled: true,
      authEnabled: true, pinHash: '', activeRole: activeRole as Role,
    },
    ui: {
      activeTab, ownerPanelOpen: false, cmdPaletteOpen: false, cmdQuery: '',
      navOrder: [], navHidden: {}, sidebarCollapsed: false,
      theme: 'dark', toasts: [], deepLink: null,
    },
  })
}

/** Nav labels actually rendered in the sidebar. */
function renderedNavIds(): string[] {
  const nav = screen.getByRole('navigation')
  return NAVIGATION_ITEMS
    .filter(item => nav.textContent?.includes(item.label))
    .map(item => item.id)
}

beforeEach(() => { signInAs('owner') })

// ─── Sidebar is a projection ──────────────────────────────────────────────────
describe('sidebar projects effective authorization', () => {
  it('renders every destination for owner', () => {
    signInAs('owner')
    render(<NavSidebar />)
    const shown = renderedNavIds()
    expect(shown.length).toBe(NAVIGATION_ITEMS.length)
  })

  it.each(['project_manager', 'engineer', 'viewer'] as Role[])(
    'renders exactly the permitted destinations for %s',
    role => {
      signInAs(role)
      render(<NavSidebar />)
      const shown = new Set(renderedNavIds())
      for (const item of NAVIGATION_ITEMS) {
        expect(shown.has(item.id), `${role} → ${item.id}`).toBe(canSee(item.id, role))
      }
    },
  )

  it('hides commercial and platform screens from procurement (ADR-014 Finding 1)', () => {
    // Under the previous filter this role matched no branch and fell through to
    // the full sidebar.
    signInAs('procurement')
    render(<NavSidebar />)
    const shown = new Set(renderedNavIds())
    for (const id of ['costcontrol', 'budget', 'evm', 'billing', 'portfolio', 'system', 'mcp']) {
      expect(shown.has(id), `procurement should not see ${id}`).toBe(false)
    }
    expect(shown.has('subcontracts')).toBe(true)
  })

  it('renders nothing for an unknown role rather than the full nav (Finding 1, fail-open)', () => {
    // The previous `_filtered.length ? _filtered : orderedItems` safety net made
    // a degraded auth state widen access.
    signInAs('not-a-real-role')
    render(<NavSidebar />)
    expect(renderedNavIds()).toEqual([])
  })

  it('renders nothing when the role is absent', () => {
    signInAs(undefined)
    render(<NavSidebar />)
    expect(renderedNavIds()).toEqual([])
  })
})

// ─── Route guard ──────────────────────────────────────────────────────────────
describe('route guard blocks destinations the sidebar hides', () => {
  it('renders 403 for a tab the role cannot open', async () => {
    // Simulates a stale bookmark / persisted tab: activeTab is set directly,
    // never via the sidebar.
    signInAs('engineer', 'costcontrol')
    render(<ContentRouter policy={{}} />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/403/)
    expect(screen.getByRole('alert')).toHaveTextContent(/cost\.view/)
  })

  it('names the destination and the missing capability', async () => {
    signInAs('viewer', 'portfolio')
    render(<ContentRouter policy={{}} />)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/portfolio/)
    expect(alert).toHaveTextContent(/portfolio\.view/)
    expect(alert).toHaveTextContent(/viewer/)
  })

  it('blocks the hidden TAB_MAP-only routes too', async () => {
    // `audit` is reachable but absent from the sidebar — exactly what a stale
    // deep link hits.
    signInAs('engineer', 'audit')
    render(<ContentRouter policy={{}} />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/403/)
  })

  it('blocks when the role is unknown', async () => {
    signInAs('pm', 'dash')
    render(<ContentRouter policy={{}} />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/403/)
  })

  it('lets a permitted destination through', () => {
    signInAs('owner', 'focus')
    render(<ContentRouter policy={{}} />)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('main')).toBeInTheDocument()
  })

  it('honours the policy prop overriding stored role, as the sidebar does', async () => {
    // NavSidebar computes { ...ownerConfig, ...policy }; the guard must agree or
    // the two surfaces disagree about who the user is.
    signInAs('owner', 'costcontrol')
    render(<ContentRouter policy={{ activeRole: 'viewer' as never }} />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/403/)
  })
})
