/**
 * The shell says when the figures are demonstration data.
 *
 * This is the finding the `dash` survey turned up, and it inverts what the
 * registry recorded. The registry said these screens "aggregate non-hydrated
 * store collections", which implies they render EMPTY. They do not.
 *
 * JarvisCore initialises its `biz` state from DEFAULT_BIZ_STATE — the shipped
 * Lusaka WTP / Maputo PM sample — hands it to ContentRouter, and every
 * store-backed view renders it. The only things that ever replace it are a
 * persisted `bizState` blob and a user-uploaded backup file; no domain API is
 * consulted anywhere in that path. So a fresh session shows a $425,000 active
 * contract for "US DOS", $63,750 of invoices and two open safety incidents, in
 * exactly the styling real figures would use.
 *
 * An empty screen understates. This OVERSTATES, which is worse: there is no
 * cue distinguishing the sample project from the reader's own operations. The
 * banner is that cue, and these tests hold that it appears whenever the state
 * still descends from the seed — including after a persist/restore round trip,
 * which is exactly when provenance would otherwise be lost.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'

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
import { ContentRouter } from '../../components/ContentRouter'
import { DEFAULT_BIZ_STATE, isDemoSeed, DEMO_SEED_MARKER } from '../../config/defaultState'

vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('no network in this test') }))

/**
 * A real session. ContentRouter reads the tab and the authenticated role from
 * the app store and 403s a tab the role may not see, so a bare render would
 * never reach the banner at all.
 */
function signIn(activeTab = 'dash'): void {
  useAppStore.setState({
    auth: {
      isAuthenticated: true, userId: 'u-1', tenantId: 't-1',
      role: 'owner', loginAt: '2026-08-14T00:00:00.000Z',
    },
    ownerConfig: {
      chatEnabled: true, writesEnabled: true, exportsEnabled: true,
      authEnabled: true, pinHash: '', activeRole: 'owner',
    },
    ui: {
      activeTab, ownerPanelOpen: false, cmdPaletteOpen: false, cmdQuery: '',
      navOrder: [], navHidden: {}, sidebarCollapsed: false,
      theme: 'dark', toasts: [], deepLink: null,
    },
  } as never)
}

beforeEach(() => signIn())

const banner = () => screen.queryByText(/Demonstration data/i)

describe('the shipped seed is recognisable as a sample', () => {
  it('marks the seed itself', () => {
    expect(isDemoSeed(DEFAULT_BIZ_STATE)).toBe(true)
  })

  it('does not mark real state', () => {
    expect(isDemoSeed({ company: { name: 'Acme', type: 'EPC' }, leads: [] })).toBe(false)
    expect(isDemoSeed({})).toBe(false)
    expect(isDemoSeed(null)).toBe(false)
    expect(isDemoSeed(undefined)).toBe(false)
  })

  it('survives the persist/restore round trip that would otherwise lose it', () => {
    // JarvisCore persists `biz` with io.set('bizState', d) and restores it with
    // io.get. A marker held outside the data would not survive that, and the
    // restored demo figures would then look like real ones.
    const restored = JSON.parse(JSON.stringify(DEFAULT_BIZ_STATE)) as unknown
    expect(isDemoSeed(restored)).toBe(true)
  })
})

describe('the shell discloses it on every view', () => {
  it('shows the banner when the state is the demo seed', () => {
    render(<ContentRouter policy={{}} biz={DEFAULT_BIZ_STATE as unknown as Record<string, unknown>} />)
    expect(banner()).not.toBeNull()
  })

  it('names the sample project rather than hinting vaguely', () => {
    render(<ContentRouter policy={{}} biz={DEFAULT_BIZ_STATE as unknown as Record<string, unknown>} />)
    expect(screen.getByText(/built-in sample project/i)).toBeDefined()
    expect(screen.getByText(/not\s+from your organisation/i)).toBeDefined()
  })

  it('shows no banner once the state is genuinely the tenant\'s', () => {
    render(<ContentRouter policy={{}} biz={{ company: { name: 'Acme', type: 'EPC' }, leads: [] }} />)
    expect(banner()).toBeNull()
  })

  it('shows no banner when there is no biz state at all', () => {
    render(<ContentRouter policy={{}} />)
    expect(banner()).toBeNull()
  })

  it('discloses on whichever tab is open, not just the dashboard', () => {
    // The seed reaches every store-backed view, so the disclosure has to be in
    // the shell rather than in any one screen.
    for (const tab of ['dash', 'crm', 'portfolio']) {
      signIn(tab)
      const view = render(
        <ContentRouter policy={{}}
          biz={DEFAULT_BIZ_STATE as unknown as Record<string, unknown>} />,
      )
      expect(banner(), `tab ${tab} must disclose`).not.toBeNull()
      view.unmount()
    }
  })
})

describe('the marker is data, not presentation', () => {
  it('uses a key that will not collide with a domain collection', () => {
    expect(DEMO_SEED_MARKER).toBe('__demoSeed')
    // The seed's real collections are all plain domain names; the marker is
    // deliberately underscore-prefixed so no reducer or selector picks it up.
    const keys = Object.keys(DEFAULT_BIZ_STATE)
    expect(keys.filter(k => k.startsWith('__'))).toEqual([DEMO_SEED_MARKER])
  })
})
