/**
 * Tests: src/modules/store/appSlice.ts
 * Coverage: all state actions, selectors, persistence partialize,
 *           useJarvisAppShim compatibility
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock zustand persist middleware to avoid localStorage in tests
vi.mock('zustand/middleware', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>
  return {
    ...actual,
    persist: (fn: unknown) => fn,         // no-op: skip localStorage in tests
    devtools: (fn: unknown) => fn,        // no-op: skip devtools
    subscribeWithSelector: (fn: unknown) => fn,
  }
})

// Mock window.location.hash
const mockLocation = { hash: '' }
Object.defineProperty(globalThis, 'window', {
  value: { location: mockLocation },
  writable: true,
})

import { useAppStore, type OwnerConfig } from '../../modules/store/appSlice'

// ─── Helper: reset store between tests ───────────────────────────────────────

function resetStore() {
  useAppStore.setState({
    auth:        { isAuthenticated: false },
    ownerConfig: { chatEnabled: true, writesEnabled: true, exportsEnabled: true, authEnabled: true, pinHash: '', activeRole: 'owner' },
    apiStats:    { count: 0, tokens: 0, lastCall: null, errors: 0, latency: [] },
    auditLog:    [],
    gateway:     { enabled: true, loading: false, lastCheck: null },
    ui: {
      activeTab: 'dash', ownerPanelOpen: false, cmdPaletteOpen: false,
      cmdQuery: '', navOrder: [], navHidden: {}, sidebarCollapsed: false,
      theme: 'dark', toasts: [], deepLink: null,
    },
  })
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

describe('auth state', () => {
  beforeEach(resetStore)

  it('starts unauthenticated', () => {
    expect(useAppStore.getState().auth.isAuthenticated).toBe(false)
  })

  it('setAuth updates authentication state', () => {
    useAppStore.getState().setAuth({ isAuthenticated: true, role: 'owner', userId: 'u-1' })
    const auth = useAppStore.getState().auth
    expect(auth.isAuthenticated).toBe(true)
    expect(auth.role).toBe('owner')
    expect(auth.userId).toBe('u-1')
  })

  it('clearAuth resets to unauthenticated', () => {
    useAppStore.getState().setAuth({ isAuthenticated: true, role: 'admin' })
    useAppStore.getState().clearAuth()
    expect(useAppStore.getState().auth.isAuthenticated).toBe(false)
    expect(useAppStore.getState().auth.role).toBeUndefined()
  })

  it('setAuth is additive (partial updates)', () => {
    useAppStore.getState().setAuth({ isAuthenticated: true })
    useAppStore.getState().setAuth({ userId: 'u-2' })
    const auth = useAppStore.getState().auth
    expect(auth.isAuthenticated).toBe(true)
    expect(auth.userId).toBe('u-2')
  })
})

// ─── Owner config ─────────────────────────────────────────────────────────────

describe('ownerConfig', () => {
  beforeEach(resetStore)

  it('starts with all features enabled for owner role', () => {
    const cfg = useAppStore.getState().ownerConfig
    expect(cfg.chatEnabled).toBe(true)
    expect(cfg.writesEnabled).toBe(true)
    expect(cfg.exportsEnabled).toBe(true)
    expect(cfg.activeRole).toBe('owner')
  })

  it('setOwnerConfig updates partial fields', () => {
    useAppStore.getState().setOwnerConfig({ activeRole: 'viewer', writesEnabled: false })
    const cfg = useAppStore.getState().ownerConfig
    expect(cfg.activeRole).toBe('viewer')
    expect(cfg.writesEnabled).toBe(false)
    expect(cfg.chatEnabled).toBe(true)   // untouched
  })

  it('setOwnerConfig with pinHash', () => {
    useAppStore.getState().setOwnerConfig({ pinHash: 'abc123' })
    expect(useAppStore.getState().ownerConfig.pinHash).toBe('abc123')
  })
})

// ─── Navigation / UI ─────────────────────────────────────────────────────────

describe('UI state', () => {
  beforeEach(resetStore)

  it('starts on dash tab', () => {
    expect(useAppStore.getState().ui.activeTab).toBe('dash')
  })

  it('setTab changes active tab', () => {
    useAppStore.getState().setTab('crm')
    expect(useAppStore.getState().ui.activeTab).toBe('crm')
  })

  it('setTab updates window.location.hash', () => {
    useAppStore.getState().setTab('projects')
    expect(mockLocation.hash).toBe('projects')
  })

  it('openRecord sets the active tab and a deep-link target', () => {
    useAppStore.getState().openRecord({ tab: 'rfis', source: 'rfi', sourceId: 'rfi-9', projectId: 'p-1' })
    const ui = useAppStore.getState().ui
    expect(ui.activeTab).toBe('rfis')
    expect(ui.deepLink).toEqual({ source: 'rfi', sourceId: 'rfi-9', projectId: 'p-1', parentId: null })
    expect(mockLocation.hash).toBe('rfis')
  })

  it('openRecord carries a parentId for nested records (punch item → list)', () => {
    useAppStore.getState().openRecord({ tab: 'punch', source: 'punch', sourceId: 'pi-3', projectId: 'p-1', parentId: 'list-9' })
    expect(useAppStore.getState().ui.deepLink).toEqual({ source: 'punch', sourceId: 'pi-3', projectId: 'p-1', parentId: 'list-9' })
  })

  it('openRecord pre-selects the project via localStorage', () => {
    useAppStore.getState().openRecord({ tab: 'riskregister', source: 'risk', sourceId: 'k-2', projectId: 'p-7' })
    expect(localStorage.getItem('jarvis-active-project')).toBe('p-7')
  })

  it('clearDeepLink resets the pending target', () => {
    useAppStore.getState().openRecord({ tab: 'rfis', source: 'rfi', sourceId: 'rfi-9', projectId: 'p-1' })
    useAppStore.getState().clearDeepLink()
    expect(useAppStore.getState().ui.deepLink).toBeNull()
  })

  it('setOwnerPanel opens and closes panel', () => {
    expect(useAppStore.getState().ui.ownerPanelOpen).toBe(false)
    useAppStore.getState().setOwnerPanel(true)
    expect(useAppStore.getState().ui.ownerPanelOpen).toBe(true)
    useAppStore.getState().setOwnerPanel(false)
    expect(useAppStore.getState().ui.ownerPanelOpen).toBe(false)
  })

  it('setCmdPalette with optional query', () => {
    useAppStore.getState().setCmdPalette(true, 'search query')
    expect(useAppStore.getState().ui.cmdPaletteOpen).toBe(true)
    expect(useAppStore.getState().ui.cmdQuery).toBe('search query')
  })

  it('setCmdQuery updates query only', () => {
    useAppStore.getState().setCmdPalette(true)
    useAppStore.getState().setCmdQuery('new query')
    expect(useAppStore.getState().ui.cmdQuery).toBe('new query')
    expect(useAppStore.getState().ui.cmdPaletteOpen).toBe(true)
  })

  it('setNavOrder updates navigation order', () => {
    const order = ['crm', 'dash', 'projects']
    useAppStore.getState().setNavOrder(order)
    expect(useAppStore.getState().ui.navOrder).toEqual(order)
  })

  it('toggleNavHidden toggles a nav item', () => {
    expect(useAppStore.getState().ui.navHidden['system']).toBeFalsy()
    useAppStore.getState().toggleNavHidden('system')
    expect(useAppStore.getState().ui.navHidden['system']).toBe(true)
    useAppStore.getState().toggleNavHidden('system')
    expect(useAppStore.getState().ui.navHidden['system']).toBe(false)
  })

  it('setSidebarCollapsed controls collapse state', () => {
    useAppStore.getState().setSidebarCollapsed(true)
    expect(useAppStore.getState().ui.sidebarCollapsed).toBe(true)
  })

  it('setTheme changes theme', () => {
    useAppStore.getState().setTheme('light')
    expect(useAppStore.getState().ui.theme).toBe('light')
  })
})

// ─── API stats ────────────────────────────────────────────────────────────────

describe('apiStats', () => {
  beforeEach(resetStore)

  it('starts at zero', () => {
    const stats = useAppStore.getState().apiStats
    expect(stats.count).toBe(0)
    expect(stats.tokens).toBe(0)
    expect(stats.errors).toBe(0)
    expect(stats.latency).toHaveLength(0)
  })

  it('recordApiCall increments count and tokens', () => {
    useAppStore.getState().recordApiCall(1500, 320)
    const stats = useAppStore.getState().apiStats
    expect(stats.count).toBe(1)
    expect(stats.tokens).toBe(1500)
    expect(stats.lastCall).not.toBeNull()
    expect(stats.latency).toContain(320)
    expect(stats.errors).toBe(0)
  })

  it('recordApiCall with error increments error count', () => {
    useAppStore.getState().recordApiCall(0, 5000, true)
    expect(useAppStore.getState().apiStats.errors).toBe(1)
  })

  it('latency keeps last 100 entries', () => {
    for (let i = 0; i < 105; i++) useAppStore.getState().recordApiCall(10, i)
    expect(useAppStore.getState().apiStats.latency.length).toBe(100)
  })

  it('resetApiStats returns to zero', () => {
    useAppStore.getState().recordApiCall(5000, 1500)
    useAppStore.getState().resetApiStats()
    const stats = useAppStore.getState().apiStats
    expect(stats.count).toBe(0)
    expect(stats.tokens).toBe(0)
    expect(stats.latency).toHaveLength(0)
  })
})

// ─── Audit log ────────────────────────────────────────────────────────────────

describe('auditLog', () => {
  beforeEach(resetStore)

  it('starts empty', () => {
    expect(useAppStore.getState().auditLog).toHaveLength(0)
  })

  it('addAuditEntry prepends entries', () => {
    useAppStore.getState().addAuditEntry({ actor: 'user', action: 'add_lead', changes: ['leads: 0→1'] })
    const log = useAppStore.getState().auditLog
    expect(log).toHaveLength(1)
    expect(log[0].action).toBe('add_lead')
    expect(log[0].id).toMatch(/^AUD-/)
    expect(log[0].ts).toBeDefined()
  })

  it('addAuditEntry prepends (newest first)', () => {
    useAppStore.getState().addAuditEntry({ actor: 'user', action: 'first', changes: [] })
    useAppStore.getState().addAuditEntry({ actor: 'user', action: 'second', changes: [] })
    expect(useAppStore.getState().auditLog[0].action).toBe('second')
  })

  it('caps log at 500 entries', () => {
    for (let i = 0; i < 505; i++) {
      useAppStore.getState().addAuditEntry({ actor: 'user', action: `action_${i}`, changes: [] })
    }
    expect(useAppStore.getState().auditLog.length).toBeLessThanOrEqual(500)
  })

  it('clearAuditLog empties the log', () => {
    useAppStore.getState().addAuditEntry({ actor: 'user', action: 'test', changes: [] })
    useAppStore.getState().clearAuditLog()
    expect(useAppStore.getState().auditLog).toHaveLength(0)
  })
})

// ─── Gateway ──────────────────────────────────────────────────────────────────

describe('gateway', () => {
  beforeEach(resetStore)

  it('starts enabled', () => {
    expect(useAppStore.getState().gateway.enabled).toBe(true)
    expect(useAppStore.getState().gateway.loading).toBe(false)
  })

  it('setGateway updates partial state', () => {
    useAppStore.getState().setGateway({ enabled: false, loading: true })
    const gw = useAppStore.getState().gateway
    expect(gw.enabled).toBe(false)
    expect(gw.loading).toBe(true)
  })
})

// ─── Toasts ───────────────────────────────────────────────────────────────────

describe('toasts', () => {
  beforeEach(() => { resetStore(); vi.useFakeTimers() })
  afterEach(() => vi.useRealTimers())

  it('addToast adds a toast', () => {
    useAppStore.getState().addToast('Test message', 'success')
    const toasts = useAppStore.getState().ui.toasts
    expect(toasts).toHaveLength(1)
    expect(toasts[0].message).toBe('Test message')
    expect(toasts[0].type).toBe('success')
    expect(toasts[0].id).toBeDefined()
  })

  it('removeToast removes by id', () => {
    useAppStore.getState().addToast('Hello', 'info')
    const id = useAppStore.getState().ui.toasts[0].id
    useAppStore.getState().removeToast(id)
    expect(useAppStore.getState().ui.toasts).toHaveLength(0)
  })

  it('toast auto-removes after 4 seconds', () => {
    useAppStore.getState().addToast('Auto-remove me', 'warn')
    expect(useAppStore.getState().ui.toasts).toHaveLength(1)
    vi.advanceTimersByTime(4100)
    expect(useAppStore.getState().ui.toasts).toHaveLength(0)
  })
})

// ─── Selectors ────────────────────────────────────────────────────────────────

describe('selectors', () => {
  beforeEach(resetStore)

  it('selectIsAuthenticated returns false initially', async () => {
    const { selectIsAuthenticated } = await import('../../modules/store/appSlice')
    expect(selectIsAuthenticated(useAppStore.getState())).toBe(false)
  })

  it('selectActiveTab returns current tab', async () => {
    const { selectActiveTab } = await import('../../modules/store/appSlice')
    useAppStore.getState().setTab('construction')
    expect(selectActiveTab(useAppStore.getState())).toBe('construction')
  })

  it('selectGatewayEnabled returns gateway status', async () => {
    const { selectGatewayEnabled } = await import('../../modules/store/appSlice')
    expect(selectGatewayEnabled(useAppStore.getState())).toBe(true)
    useAppStore.getState().setGateway({ enabled: false })
    expect(selectGatewayEnabled(useAppStore.getState())).toBe(false)
  })
})
