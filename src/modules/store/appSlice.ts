/**
 * Denver Engineering — App State Slice  (v4.29.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 19 pre-condition: migrates the 8 JarvisApp closure state variables
 * that were blocking the JarvisApp decomposition into Zustand.
 *
 * Previously trapped in JarvisCore.jsx JarvisApp function closure:
 *   _authOk / _authSet          → appStore.auth.isAuthenticated
 *   _oCfg / _oCfgSet            → appStore.ownerConfig
 *   _oPanelOpen / _oPanelSet    → appStore.ui.ownerPanelOpen
 *   _apiStats / _apiStatsSet    → appStore.apiStats
 *   _auditLog / _auditLogSet    → appStore.auditLog
 *   _gwEnabled / _gwSet         → appStore.gateway.enabled
 *   _cmdOpen / _cmdSetOpen      → appStore.ui.cmdPaletteOpen
 *   active tab (m / p)          → appStore.ui.activeTab
 *
 * Usage:
 *   import { useAppStore, type OwnerConfig } from '../modules/store/appSlice'
 *
 *   const isAuth      = useAppStore(s => s.auth.isAuthenticated)
 *   const setAuth     = useAppStore(s => s.setAuth)
 *   const activeTab   = useAppStore(s => s.ui.activeTab)
 *   const setTab      = useAppStore(s => s.setTab)
 *
 * In JarvisCore.jsx — replace closure vars with store selectors:
 *   var _authOk    = useAppStore(s => s.auth.isAuthenticated)
 *   var _authSet   = useAppStore(s => s.setAuth)
 *   var m          = useAppStore(s => s.ui.activeTab)
 *   var p          = useAppStore(s => s.setTab)
 *   ... etc
 */

import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import type { UserRole } from '../../config/capabilities'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OwnerConfig {
  chatEnabled:    boolean
  writesEnabled:  boolean
  exportsEnabled: boolean
  authEnabled:    boolean
  pinHash:        string
  /**
   * The OwnerPanel *preview* position — not authorization identity.
   *
   * ADR-014: this is client-owned (a UI picker, persisted to localStorage), so
   * authorization never reads it alone. `effectiveCapabilities(auth.role, this)`
   * intersects it with the authenticated role, so it can only narrow.
   *
   * Typed as `UserRole` so all seven `user_role` enum values are representable.
   * It was previously a five-value union that could not hold `procurement` or
   * `field_ops`, which made those roles unreachable in the running app and
   * forced `as never` casts in tests.
   */
  activeRole:     UserRole
}

export interface AuthState {
  isAuthenticated: boolean
  userId?:         string
  tenantId?:       string
  /** The authenticated role, as issued by the server in the JWT. The subject of every authorization decision. */
  role?:           UserRole
  loginAt?:        string
}

export interface ApiStats {
  count:    number
  tokens:   number
  lastCall: string | null
  errors:   number
  latency:  number[]
}

export interface AuditEntry {
  id:      string
  ts:      string
  actor:   string
  action:  string
  changes: string[]
  meta?:   Record<string, unknown>
}

export interface GatewayState {
  enabled:  boolean
  loading:  boolean
  lastCheck:string | null
}

/** A pending deep-link: the destination view claims it on mount to open a record. */
export interface DeepLinkTarget {
  source:    string         // 'rfi' | 'submittal' | 'risk' | 'inspection' | 'punch' | ...
  sourceId:  string | null  // record id to open, if any
  projectId: string | null  // project the record belongs to
  parentId?: string | null  // parent record (e.g. punch item's list) so the view can pre-select it
}

export interface UIState {
  activeTab:       string
  ownerPanelOpen:  boolean
  cmdPaletteOpen:  boolean
  cmdQuery:        string
  navOrder:        string[]
  navHidden:       Record<string, boolean>
  sidebarCollapsed:boolean
  theme:           'dark' | 'light' | 'auto'
  toasts:          Toast[]
  deepLink:        DeepLinkTarget | null  // ephemeral — set by openRecord, cleared on claim
}

export interface Toast {
  id:      string
  message: string
  type:    'success' | 'error' | 'warn' | 'info'
  ts:      string
}

// ─── Default values ───────────────────────────────────────────────────────────

const DEFAULT_OWNER_CONFIG: OwnerConfig = {
  chatEnabled:    true,
  writesEnabled:  true,
  exportsEnabled: true,
  authEnabled:    true,
  pinHash:        '',
  activeRole:     'owner',
}

const DEFAULT_AUTH: AuthState = { isAuthenticated: false }

const DEFAULT_API_STATS: ApiStats = { count: 0, tokens: 0, lastCall: null, errors: 0, latency: [] }

const DEFAULT_GATEWAY: GatewayState = { enabled: true, loading: false, lastCheck: null }

const DEFAULT_UI: UIState = {
  activeTab:       'focus',
  ownerPanelOpen:  false,
  cmdPaletteOpen:  false,
  cmdQuery:        '',
  navOrder:        [],
  navHidden:       {},
  sidebarCollapsed:false,
  theme:           'dark',
  toasts:          [],
  deepLink:        null,
}

// ─── Store interface ──────────────────────────────────────────────────────────

interface AppStore {
  auth:        AuthState
  ownerConfig: OwnerConfig
  apiStats:    ApiStats
  auditLog:    AuditEntry[]
  gateway:     GatewayState
  ui:          UIState

  // ── Auth ──────────────────────────────────────────────────────────────────
  setAuth:     (auth: Partial<AuthState>) => void
  clearAuth:   () => void

  // ── Owner config ──────────────────────────────────────────────────────────
  setOwnerConfig: (cfg: Partial<OwnerConfig>) => void

  // ── Navigation / UI ───────────────────────────────────────────────────────
  setTab:          (tab: string) => void
  openRecord:      (target: { tab: string } & DeepLinkTarget) => void
  clearDeepLink:   () => void
  setOwnerPanel:   (open: boolean) => void
  setCmdPalette:   (open: boolean, query?: string) => void
  setCmdQuery:     (q: string) => void
  setNavOrder:     (order: string[]) => void
  toggleNavHidden: (id: string) => void
  setSidebarCollapsed: (v: boolean) => void
  setTheme:        (theme: UIState['theme']) => void

  // ── API stats ─────────────────────────────────────────────────────────────
  recordApiCall: (tokens: number, latencyMs: number, error?: boolean) => void
  resetApiStats: () => void

  // ── Audit log ─────────────────────────────────────────────────────────────
  addAuditEntry:  (entry: Omit<AuditEntry, 'id' | 'ts'>) => void
  clearAuditLog:  () => void

  // ── Gateway ───────────────────────────────────────────────────────────────
  setGateway:  (s: Partial<GatewayState>) => void

  // ── Toasts ────────────────────────────────────────────────────────────────
  addToast:    (message: string, type?: Toast['type']) => void
  removeToast: (id: string) => void
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useAppStore = create<AppStore>()(
  devtools(
    persist(
      (set, get) => ({
        auth:        DEFAULT_AUTH,
        ownerConfig: DEFAULT_OWNER_CONFIG,
        apiStats:    DEFAULT_API_STATS,
        auditLog:    [],
        gateway:     DEFAULT_GATEWAY,
        ui:          DEFAULT_UI,

        // ── Auth ────────────────────────────────────────────────────────────
        setAuth: (auth) => set(s => ({ auth: { ...s.auth, ...auth } }), false, 'setAuth'),
        clearAuth: () => set({ auth: DEFAULT_AUTH }, false, 'clearAuth'),

        // ── Owner config ────────────────────────────────────────────────────
        setOwnerConfig: (cfg) => set(s => ({ ownerConfig: { ...s.ownerConfig, ...cfg } }), false, 'setOwnerConfig'),

        // ── Navigation / UI ─────────────────────────────────────────────────
        setTab: (tab) => {
          set(s => ({ ui: { ...s.ui, activeTab: tab } }), false, 'setTab')
          try { window.location.hash = tab } catch { /* SSR safe */ }
        },
        openRecord: ({ tab, source, sourceId, projectId, parentId = null }) => {
          // Pre-select the project via the shared convention destination views read.
          if (projectId) { try { localStorage.setItem('jarvis-active-project', projectId) } catch { /* ignore */ } }
          set(s => ({ ui: { ...s.ui, activeTab: tab, deepLink: { source, sourceId, projectId, parentId } } }), false, 'openRecord')
          try { window.location.hash = tab } catch { /* SSR safe */ }
        },
        clearDeepLink: () => set(s => ({ ui: { ...s.ui, deepLink: null } }), false, 'clearDeepLink'),
        setOwnerPanel:   (open) => set(s => ({ ui: { ...s.ui, ownerPanelOpen: open } }), false, 'setOwnerPanel'),
        setCmdPalette:   (open, query) => set(s => ({
          ui: { ...s.ui, cmdPaletteOpen: open, cmdQuery: query ?? s.ui.cmdQuery }
        }), false, 'setCmdPalette'),
        setCmdQuery:     (q) => set(s => ({ ui: { ...s.ui, cmdQuery: q } }), false, 'setCmdQuery'),
        setNavOrder:     (order) => set(s => ({ ui: { ...s.ui, navOrder: order } }), false, 'setNavOrder'),
        toggleNavHidden: (id) => set(s => ({
          ui: { ...s.ui, navHidden: { ...s.ui.navHidden, [id]: !s.ui.navHidden[id] } }
        }), false, 'toggleNavHidden'),
        setSidebarCollapsed: (v) => set(s => ({ ui: { ...s.ui, sidebarCollapsed: v } }), false, 'setSidebarCollapsed'),
        setTheme:        (theme) => set(s => ({ ui: { ...s.ui, theme } }), false, 'setTheme'),

        // ── API stats ────────────────────────────────────────────────────────
        recordApiCall: (tokens, latencyMs, error = false) => set(s => ({
          apiStats: {
            count:    s.apiStats.count + 1,
            tokens:   s.apiStats.tokens + tokens,
            lastCall: new Date().toISOString(),
            errors:   s.apiStats.errors + (error ? 1 : 0),
            latency:  [...s.apiStats.latency.slice(-99), latencyMs],
          }
        }), false, 'recordApiCall'),
        resetApiStats: () => set({ apiStats: DEFAULT_API_STATS }, false, 'resetApiStats'),

        // ── Audit log ────────────────────────────────────────────────────────
        addAuditEntry: (entry) => set(s => {
          const newEntry: AuditEntry = {
            ...entry,
            id: `AUD-${Date.now()}`,
            ts: new Date().toISOString(),
          }
          return { auditLog: [newEntry, ...s.auditLog.slice(0, 499)] }
        }, false, 'addAuditEntry'),
        clearAuditLog: () => set({ auditLog: [] }, false, 'clearAuditLog'),

        // ── Gateway ──────────────────────────────────────────────────────────
        setGateway: (s) => set(st => ({ gateway: { ...st.gateway, ...s } }), false, 'setGateway'),

        // ── Toasts ───────────────────────────────────────────────────────────
        addToast: (message, type = 'info') => {
          const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`
          set(s => ({ ui: { ...s.ui, toasts: [...(s.ui.toasts || []), { id, message, type, ts: new Date().toISOString() }] } }),
            false, 'addToast')
          // Auto-remove after 4s
          setTimeout(() => get().removeToast(id), 4000)
        },
        removeToast: (id) => set(s => ({
          ui: { ...s.ui, toasts: (s.ui.toasts || []).filter(t => t.id !== id) }
        }), false, 'removeToast'),
      }),
      {
        name:    'jarvis-app-state',
        version: 2,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        migrate: (persisted: any, from: number) => {
          if (from < 2 && persisted && persisted.ui) {
            persisted.ui.navHidden = {}
            persisted.ui.navOrder  = []
          }
          return persisted
        },
        // Only persist non-ephemeral UI state
        partialize: (s) => ({
          ownerConfig: s.ownerConfig,
          ui: {
            activeTab:       s.ui.activeTab,
            navOrder:        s.ui.navOrder,
            navHidden:       s.ui.navHidden,
            sidebarCollapsed:s.ui.sidebarCollapsed,
            theme:           s.ui.theme,
          },
        }),
        merge: (persisted, current) => {
          const p = (persisted || {}) as Partial<AppStore>
          return {
            ...current,
            ...p,
            ui: { ...current.ui, ...(p.ui || {}), toasts: current.ui.toasts || [] },
          } as AppStore
        },
      }
    ),
    { name: 'AppStore' }
  )
)

// ─── Selectors ────────────────────────────────────────────────────────────────

export const selectIsAuthenticated = (s: AppStore) => s.auth.isAuthenticated
export const selectActiveTab       = (s: AppStore) => s.ui.activeTab
export const selectOwnerConfig     = (s: AppStore) => s.ownerConfig
export const selectGatewayEnabled  = (s: AppStore) => s.gateway.enabled
export const selectCmdOpen         = (s: AppStore) => s.ui.cmdPaletteOpen
export const selectOwnerPanelOpen  = (s: AppStore) => s.ui.ownerPanelOpen
export const selectApiStats        = (s: AppStore) => s.apiStats
export const selectAuditLog        = (s: AppStore) => s.auditLog
export const selectToasts          = (s: AppStore) => s.ui.toasts
export const selectTheme           = (s: AppStore) => s.ui.theme
export const selectNavOrder        = (s: AppStore) => s.ui.navOrder
export const selectNavHidden       = (s: AppStore) => s.ui.navHidden

/**
 * Drop-in compatibility shim for JarvisCore.jsx.
 * Returns the same shape as the old useJarvis() context hook but reads from Zustand.
 * Phase 19 migration: replace useJarvis() calls with this shim, then remove the shim.
 */
export function useJarvisAppShim() {
  const auth        = useAppStore(s => s.auth)
  const ownerConfig = useAppStore(s => s.ownerConfig)
  const gateway     = useAppStore(s => s.gateway)
  const ui          = useAppStore(s => s.ui)
  const setTab      = useAppStore(s => s.setTab)
  const setOwnerPanel = useAppStore(s => s.setOwnerPanel)
  const addToast    = useAppStore(s => s.addToast)

  return {
    isAuthenticated: auth.isAuthenticated,
    policy:          ownerConfig,
    activeTab:       ui.activeTab,
    gwEnabled:       gateway.enabled,
    ownerPanelOpen:  ui.ownerPanelOpen,
    setTab,
    setOwnerPanel,
    toast:           (msg: string, type = 'info') => addToast(msg, type as Toast['type']),
  }
}
