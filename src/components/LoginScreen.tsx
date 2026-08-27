/**
 * Denver Engineering — LoginScreen  (v4.30.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 19a extraction: The auth gate from JarvisApp function.
 * Reads from / writes to useAppStore instead of JarvisApp closure state.
 *
 * Handles two auth modes:
 *   - Multi-tenant (VITE_GATEWAY_MODE=proxied): JWT email+password via /api/v1/auth/login
 *   - Local PIN mode: 4-digit owner PIN verified against stored hash
 *
 * Usage:
 *   import { LoginScreen } from '../components/LoginScreen'
 *   if (!isAuthenticated) return <LoginScreen onSuccess={() => setAuth({ isAuthenticated: true })} />
 */

import React, { useState, useRef, useEffect } from 'react'
import { useAppStore }                          from '../modules/store/appSlice'
import { isUserRole }                           from '../config/capabilities'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LoginScreenProps {
  onSuccess?:    () => void
  gatewayMode?:  'proxied' | 'local' | 'demo'
  backendUrl?:   string
}

// v4.31.0 TS fix: ImportMeta doesn't directly cast to the target shape under
// strict mode — double-cast via `unknown` is the standard escape.
const IS_PROXIED = (typeof import.meta !== 'undefined' && (import.meta as unknown as Record<string, Record<string, string>>).env?.['VITE_GATEWAY_MODE']) === 'proxied'

// ─── PIN utilities (mirrors JarvisCore _hashPin) ─────────────────────────────

function hashPin(pin: string): string {
  let h = 5381
  for (let i = 0; i < pin.length; i++) h = (h * 33) ^ pin.charCodeAt(i)
  return (h >>> 0).toString(16)
}

// ─── Component ────────────────────────────────────────────────────────────────

export function LoginScreen({ onSuccess, gatewayMode, backendUrl = '' }: LoginScreenProps) {
  const setAuth     = useAppStore(s => s.setAuth)
  const ownerConfig = useAppStore(s => s.ownerConfig)
  const addToast    = useAppStore(s => s.addToast)

  const proxied = gatewayMode === 'proxied' || (gatewayMode === undefined && IS_PROXIED)

  // Proxied mode: email + password
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [tenant,   setTenant]   = useState('')
  // Local PIN mode
  const [pin, setPin] = useState('')

  const [loading, setLoading]   = useState(false)
  const [error,   setError]     = useState('')
  const [attempts,setAttempts]  = useState(0)
  const emailRef  = useRef<HTMLInputElement>(null)
  const pinRef    = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // Demo mode: auto-auth
    if (gatewayMode === 'demo') {
      setAuth({ isAuthenticated: true, role: 'owner' })
      onSuccess?.()
    }
    // Focus the first input
    setTimeout(() => {
      if (proxied) emailRef.current?.focus()
      else pinRef.current?.focus()
    }, 100)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── JWT login (proxied mode) ────────────────────────────────────────────────

  async function handleJwtLogin() {
    if (!email.trim() || !password) { setError('Email and password are required'); return }
    setLoading(true); setError('')
    try {
      const res = await fetch(`${backendUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password, tenantSlug: tenant || undefined }),
        credentials: 'include',
      })
      const data = await res.json()
      if (res.ok) {
        // ADR-014: `auth.role` is the subject of every client authorization
        // decision, so only a value the registry recognises may be stored. An
        // unexpected server value is left undefined, which fails closed (an
        // absent role grants nothing) rather than being persisted as an opaque
        // string nobody can reason about.
        const serverRole = data.user?.role
        setAuth({
          isAuthenticated: true,
          userId:    data.user?.id,
          tenantId:  data.user?.tenant_id,
          role:      isUserRole(serverRole) ? serverRole : undefined,
          loginAt:   new Date().toISOString(),
        })
        addToast(`Welcome back, ${data.user?.name ?? email}`, 'success')
        onSuccess?.()
      } else {
        setAttempts(a => a + 1)
        setError(data.message ?? data.error ?? 'Login failed')
        if (attempts >= 2) setError((data.message ?? 'Login failed') + ' — check credentials and try again')
      }
    } catch (e: unknown) {
      setError('Cannot reach the server. Check your connection.')
    } finally {
      setLoading(false)
    }
  }

  // ── PIN login (local mode) ──────────────────────────────────────────────────

  function handlePinLogin() {
    if (!pin || pin.length < 4) { setError('Enter your 4-digit PIN'); return }
    const expected = ownerConfig.pinHash || hashPin('0000')
    if (hashPin(pin) === expected) {
      // Local PIN mode has no server to consult, so the stored position is the
      // only available authority — the PIN itself is the gate. This is a real
      // limit of local mode, recorded in ADR-014: only proxied (multi-tenant)
      // mode has a server-issued role. It is not a fallback for proxied mode.
      setAuth({ isAuthenticated: true, role: ownerConfig.activeRole, loginAt: new Date().toISOString() })
      addToast('Access granted', 'success')
      onSuccess?.()
    } else {
      setAttempts(a => a + 1)
      setError(attempts >= 2 ? 'Incorrect PIN — default is 0000' : 'Incorrect PIN')
      setPin('')
      pinRef.current?.focus()
    }
  }

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div role="main" aria-label="Login" style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--jarvis-bg)',
    }}>
      <div style={{
        width: '100%', maxWidth: 380, padding: '2rem',
        background: 'var(--jarvis-bg2)', borderRadius: 12,
        border: '1px solid var(--jarvis-bd)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
      }}>
        {/* Logo / brand */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }} aria-hidden>🔧</div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: 'var(--jarvis-tx)' }}>Denver Engineering</h1>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--jarvis-ts)' }}>
            {proxied ? 'Enterprise Project Controls' : 'Owner Access'}
          </p>
        </div>

        {error && (
          <div role="alert" style={{
            padding: '10px 14px', marginBottom: 16, borderRadius: 6,
            background: '#FEE2E2', color: '#991B1B', fontSize: 13, fontWeight: 500,
          }}>
            {error}
          </div>
        )}

        {proxied ? (
          /* JWT email+password form */
          <div>
            {[
              { id: 'email',    label: 'Email',       type: 'email',    value: email,    setter: setEmail,    ref: emailRef },
              { id: 'password', label: 'Password',    type: 'password', value: password, setter: setPassword, ref: undefined },
            ].map(({ id, label, type, value, setter, ref }) => (
              <div key={id} style={{ marginBottom: 14 }}>
                <label htmlFor={`login-${id}`} style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 5, color: 'var(--jarvis-ts)' }}>
                  {label}
                </label>
                <input
                  id={`login-${id}`}
                  ref={ref as React.RefObject<HTMLInputElement>}
                  type={type}
                  className="jarvis-input"
                  style={{ width: '100%' }}
                  value={value}
                  onChange={e => setter(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleJwtLogin()}
                  autoComplete={type === 'password' ? 'current-password' : 'username'}
                  disabled={loading}
                />
              </div>
            ))}
            <div style={{ marginBottom: 20 }}>
              <label htmlFor="login-tenant" style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 5, color: 'var(--jarvis-ts)' }}>
                Organisation Slug <span style={{ fontWeight: 400, opacity: 0.6 }}>(optional)</span>
              </label>
              <input
                id="login-tenant"
                type="text"
                className="jarvis-input"
                style={{ width: '100%' }}
                value={tenant}
                onChange={e => setTenant(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleJwtLogin()}
                placeholder="e.g. fluid-solutions"
                disabled={loading}
                autoComplete="organization"
              />
            </div>
            <button
              className="jarvis-btn jarvis-btn-primary"
              style={{ width: '100%', padding: '10px 0', fontSize: 14, fontWeight: 700 }}
              onClick={handleJwtLogin}
              disabled={loading}
              aria-label="Sign in"
            >
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </div>
        ) : (
          /* PIN mode */
          <div>
            <label htmlFor="login-pin" style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 5, color: 'var(--jarvis-ts)', textAlign: 'center' }}>
              Enter 4-Digit PIN
            </label>
            <input
              id="login-pin"
              ref={pinRef}
              type="password"
              inputMode="numeric"
              maxLength={4}
              className="jarvis-input"
              style={{ width: '100%', fontSize: 28, letterSpacing: 16, textAlign: 'center', marginBottom: 16 }}
              value={pin}
              onChange={e => { setPin(e.target.value.replace(/\D/g, '').slice(0, 4)); if (e.target.value.length === 4) handlePinLogin() }}
              onKeyDown={e => e.key === 'Enter' && handlePinLogin()}
              disabled={loading}
              aria-label="PIN"
            />
            <button
              className="jarvis-btn jarvis-btn-primary"
              style={{ width: '100%', padding: '10px 0', fontSize: 14, fontWeight: 700 }}
              onClick={handlePinLogin}
              disabled={loading || pin.length < 4}
              aria-label="Unlock"
            >
              Unlock
            </button>
            <p style={{ textAlign: 'center', fontSize: 11, color: 'var(--jarvis-ts)', marginTop: 12 }}>
              Default PIN: <code>0000</code>
            </p>
          </div>
        )}

        <p style={{ textAlign: 'center', fontSize: 11, color: 'var(--jarvis-ts)', marginTop: 24, marginBottom: 0 }}>
          Denver Engineering v4.30 · Ava Systems LLC
        </p>
      </div>
    </div>
  )
}

export default LoginScreen
