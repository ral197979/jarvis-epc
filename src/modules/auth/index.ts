/**
 * JARVIS EPC — Auth Module
 * ─────────────────────────
 * JWT management, policy engine, role/persona definitions,
 * session timeout, CSRF, and ARIA live-region announcements.
 *
 * Dependencies: store, observability
 * Status: Server-enforced RBAC live in /api/v1/policy/check (now requireAuth-gated, P0-C).
 */

import {
  authToken as _tokenRef,
  authTokenExpiry as _expiryRef,
  setAuthToken as _storeSetToken,
  clearAuthToken as _storeClearToken,
  csrfToken,
  lastActivity,
  SESSION_TIMEOUT_MS,
  TOKEN_ROTATION_MS,
  gatewayMode,
} from '../store/index.js'

import { slog, logError } from '../observability/index.js'

// ─── Types ────────────────────────────────────────────────────────────────────
export type RoleKey = 'owner' | 'exec' | 'pm' | 'engineer' | 'viewer'

export interface Persona {
  label:     string
  tabs:      string[] | null
  canConfig: boolean
  canAudit:  boolean
  canWrite:  boolean
  icon:      string
}

export interface PolicyResult {
  allowed: boolean
  reason:  string
}

export interface OwnerConfig {
  chatEnabled?:     boolean
  writesEnabled?:   boolean
  exportsEnabled?:  boolean
  lockedCollections?: Record<string, boolean>
  [key: string]: unknown
}

// ─── Announce (ARIA live region) ──────────────────────────────────────────────
let _lastAnnounce = { msg: '', ts: 0 }

export function announce(msg: string, urgent = false): void {
  if (msg === _lastAnnounce.msg && Date.now() - _lastAnnounce.ts < 500) return
  _lastAnnounce = { msg, ts: Date.now() }
  const el = document.getElementById('jarvis-live-region')
  if (el) {
    el.setAttribute('aria-live', urgent ? 'assertive' : 'polite')
    el.textContent = ''
    setTimeout(() => { el.textContent = msg }, 50)
  }
}

if (typeof document !== 'undefined' && !document.getElementById('jarvis-live-region')) {
  const lr = document.createElement('div')
  lr.id = 'jarvis-live-region'
  lr.setAttribute('role', 'status')
  lr.setAttribute('aria-live', 'polite')
  lr.setAttribute('aria-atomic', 'true')
  lr.style.cssText = 'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0'
  document.body?.appendChild(lr)
}

// ─── Personas / Roles ─────────────────────────────────────────────────────────
export const PERSONAS: Record<RoleKey, Persona> = {
  owner:    { label: 'Owner',       tabs: null,                                                                                            canConfig: true,  canAudit: true,  canWrite: true,  icon: '👑' },
  exec:     { label: 'Executive',   tabs: ['dash', 'portfolio', 'predict', 'notifications'],                                              canConfig: false, canAudit: true,  canWrite: false, icon: '💼' },
  pm:       { label: 'Project Mgr', tabs: ['dash', 'crm', 'projects', 'construction', 'proposals', 'actions', 'docs', 'field', 'notifications'], canConfig: false, canAudit: false, canWrite: true,  icon: '📋' },
  engineer: { label: 'Engineer',    tabs: ['dash', 'projects', 'construction', 'calc', 'hub', 'feed', 'docs', 'actions', 'notifications'],  canConfig: false, canAudit: false, canWrite: true,  icon: '🔧' },
  viewer:   { label: 'Viewer',      tabs: ['dash', 'portfolio', 'notifications'],                                                         canConfig: false, canAudit: false, canWrite: false, icon: '👀' },
}

// ─── Policy Engine ────────────────────────────────────────────────────────────
type PolicyCheck = (cfg: OwnerConfig, role: RoleKey) => boolean

const POLICY_ACTIONS: Record<string, PolicyCheck> = {
  'ai:chat':       cfg         => cfg.chatEnabled !== false,
  'data:write':    (cfg, role) => { const p = PERSONAS[role] ?? PERSONAS.owner; return cfg.writesEnabled !== false && p.canWrite !== false },
  'data:export':   (cfg, role) => cfg.exportsEnabled !== false && role !== 'viewer',
  'data:import':   cfg         => cfg.writesEnabled !== false,
  'data:delete':   cfg         => cfg.writesEnabled !== false,
  'admin:config':  (_,  role)  => role === 'owner',
  'admin:audit':   (_,  role)  => role === 'owner' || role === 'exec',
  'view:all':      (_,  role)  => role === 'owner',
  'view:kpi':      ()          => true,
  'view:workflow': (_,  role)  => role !== 'viewer',
}

export function checkPolicy(action: string, ownerCfg: OwnerConfig, role: RoleKey = 'owner'): PolicyResult {
  const check = POLICY_ACTIONS[action]
  if (!check) {
    console.warn(`[JARVIS:Policy] Unknown action: ${action} — DENIED by default`)
    return { allowed: false, reason: `Unknown action: ${action}` }
  }
  const allowed = check(ownerCfg, role)
  if (!allowed) console.info(`[JARVIS:Policy] DENIED: ${action} (role=${role})`)
  return { allowed, reason: allowed ? 'ok' : `Policy denied: ${action}` }
}

export async function checkPolicyServer(
  action: string,
  role: RoleKey,
  backendUrlFn: (path: string) => string,
): Promise<PolicyResult> {
  if (gatewayMode !== 'proxied') return checkPolicy(action, {} as OwnerConfig, role)
  const jwt = getAuthToken()
  try {
    const r = await fetch(backendUrlFn('/api/v1/policy/check'), {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) },
      body:    JSON.stringify({ action, role }),
    })
    const d = await r.json() as PolicyResult
    return { allowed: d.allowed, reason: d.reason }
  } catch (err) {
    const e = err as Error
    console.warn('[JARVIS:Policy] Server check failed, falling back to client:', e.message)
    return checkPolicy(action, {} as OwnerConfig, role)
  }
}

// ─── JWT Token Management ─────────────────────────────────────────────────────
/**
 * setAuthToken — records token in the in-memory Zustand store only.
 * SEC-01: Raw JWT is no longer written to sessionStorage.
 * The httpOnly cookie is set by the server at login/refresh; JS has no read access.
 */
export function setAuthToken(token: string, expiresAt?: string): void {
  _storeSetToken(token, expiresAt)
  // sessionStorage write intentionally removed (SEC-01).
  slog('INFO', 'auth', `Token set, expires ${new Date(_expiryRef).toISOString()}`)
}

/**
 * getAuthToken — returns the in-memory access token if still valid.
 * SEC-01: sessionStorage fallback removed; token lives in httpOnly cookie server-side.
 * Frontend verifies auth state by calling /api/v1/auth/me (SEC-02).
 */
export function getAuthToken(): string | null {
  if (_tokenRef && Date.now() < _expiryRef) return _tokenRef
  return null
}

/**
 * clearAuthToken — wipes the in-memory token from the Zustand store.
 * SEC-01: sessionStorage removes intentionally omitted (no JWT was written there).
 * The httpOnly cookie is cleared by the server on /api/v1/auth/logout.
 */
export function clearAuthToken(): void {
  _storeClearToken()
  // sessionStorage.removeItem intentionally omitted — SEC-01.
}

// ─── Session Timeout ──────────────────────────────────────────────────────────
export function checkSessionTimeout(): boolean {
  if (Date.now() - lastActivity > SESSION_TIMEOUT_MS) {
    logError('session', 'Session expired after 30min inactivity')
    clearAuthToken()
    announce('Session expired due to inactivity')
    return true
  }
  return false
}

export function checkTokenRotation(): void {
  if (gatewayMode !== 'proxied' || !_tokenRef) return
  const remaining = _expiryRef - Date.now()
  if (remaining > 0 && remaining < TOKEN_ROTATION_MS) {
    slog('INFO', 'auth', `Token expires in ${Math.round(remaining / 1000)}s — rotation recommended`)
  }
}

// ─── Input Limits ─────────────────────────────────────────────────────────────
export const INPUT_LIMITS = {
  text:     1_024,
  textarea: 10_240,
  email:    254,
  phone:    20,
  id:       64,
  url:      2_048,
} as const

export type InputLimitKey = keyof typeof INPUT_LIMITS

// ─── Legacy aliases ───────────────────────────────────────────────────────────
export const _checkPolicy        = checkPolicy
export const _checkPolicyServer  = checkPolicyServer
export const _setAuthToken       = setAuthToken
export const _getAuthToken       = getAuthToken
export const _clearAuthToken     = clearAuthToken
export const _checkSessionTimeout = checkSessionTimeout
export const _announce           = announce
export const _PERSONAS           = PERSONAS
export const _INPUT_LIMITS       = INPUT_LIMITS
export { csrfToken as _csrfToken }
