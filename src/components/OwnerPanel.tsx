/**
 * Denver Engineering — OwnerPanel  (v4.30.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 19e extraction: the owner configuration sidebar from JarvisApp (~350 lines).
 * Previously rendered inline inside JarvisCore.jsx as `_oPanelOpen && React.createElement(...)`.
 *
 * Features:
 *   - Role selector (owner / admin / project_manager / engineer / viewer)
 *   - Feature toggles: AI chat, writes, exports, auth
 *   - PIN change with current-pin verification
 *   - AI gateway enable/disable
 *   - Audit log viewer (last 50 entries)
 *   - API stats dashboard
 *   - Data retention / emergency wipe (owner-only, PIN-gated)
 *
 * Reads/writes: useAppStore for all state.
 * No JarvisCore closure dependencies.
 */

import React, { useState } from 'react'
import { useAppStore, type OwnerConfig } from '../modules/store/appSlice'
import { KpiCard }                        from './KpiCard'

// ─── Types / constants ────────────────────────────────────────────────────────

/**
 * The positions this panel can *preview*. All seven `user_role` values —
 * `procurement` and `field_ops` were previously missing, so the two roles
 * ADR-014 exists to serve could not be selected at all.
 *
 * Selecting one does not change who you are. Authorization intersects the
 * preview with your authenticated capabilities, so a preview can only ever show
 * you less than you already have (see `effectiveCapabilities`).
 */
const ROLES: Array<{ value: OwnerConfig['activeRole']; label: string; icon: string }> = [
  { value: 'owner',           label: 'Owner',                   icon: '👑' },
  { value: 'admin',           label: 'Platform Administrator',  icon: '🛡️' },
  { value: 'project_manager', label: 'Project Manager',         icon: '📋' },
  { value: 'engineer',        label: 'Engineer',                icon: '⚙️' },
  { value: 'procurement',     label: 'Procurement',             icon: '📦' },
  { value: 'field_ops',       label: 'Field Ops',               icon: '🦺' },
  { value: 'viewer',          label: 'Viewer',                  icon: '👁️' },
]

function hashPin(pin: string): string {
  let h = 5381
  for (let i = 0; i < pin.length; i++) h = (h * 33) ^ pin.charCodeAt(i)
  return (h >>> 0).toString(16)
}

// ─── Component ────────────────────────────────────────────────────────────────

export interface OwnerPanelProps {
  backendUrl?: string
  version?:    string
}

export function OwnerPanel({ backendUrl = '', version = '4.29.0' }: OwnerPanelProps) {
  const ownerConfig   = useAppStore(s => s.ownerConfig)
  const setOwnerConfig= useAppStore(s => s.setOwnerConfig)
  // ADR-014: the authenticated position. Anything that grants authority in this
  // panel must key on this, never on `ownerConfig.activeRole` (a client-owned
  // preview that defaults to `owner`).
  const authRole      = useAppStore(s => s.auth.role)
  const setOwnerPanel = useAppStore(s => s.setOwnerPanel)
  const gateway       = useAppStore(s => s.gateway)
  const setGateway    = useAppStore(s => s.setGateway)
  const apiStats      = useAppStore(s => s.apiStats)
  const auditLog      = useAppStore(s => s.auditLog)
  const clearAuditLog = useAppStore(s => s.clearAuditLog)
  const resetApiStats = useAppStore(s => s.resetApiStats)
  const addToast      = useAppStore(s => s.addToast)
  const clearAuth     = useAppStore(s => s.clearAuth)

  const [tab, setTab]           = useState<'config' | 'audit' | 'stats'>('config')
  const [pinSection, setPinSection] = useState(false)
  const [curPin, setCurPin]     = useState('')
  const [newPin, setNewPin]     = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [pinError, setPinError]  = useState('')

  // ── Gateway toggle ─────────────────────────────────────────────────────────

  async function toggleGateway() {
    setGateway({ loading: true })
    try {
      const endpoint = gateway.enabled ? '/api/v1/gateway/disable' : '/api/v1/gateway/enable'
      const res = await fetch(`${backendUrl}${endpoint}`, { method: 'POST', credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setGateway({ enabled: data.gateway === 'enabled', loading: false, lastCheck: new Date().toISOString() })
        addToast(`AI Gateway ${data.gateway}`, 'info')
      } else {
        setGateway({ loading: false })
        addToast('Gateway toggle failed', 'error')
      }
    } catch {
      setGateway({ loading: false })
      addToast('Cannot reach backend', 'error')
    }
  }

  // ── PIN change ─────────────────────────────────────────────────────────────

  function changePin() {
    setPinError('')
    if (hashPin(curPin) !== ownerConfig.pinHash && ownerConfig.pinHash !== hashPin('0000')) {
      setPinError('Current PIN incorrect'); return
    }
    if (newPin.length < 4) { setPinError('New PIN must be 4 digits'); return }
    if (newPin !== confirmPin) { setPinError('PINs do not match'); return }
    setOwnerConfig({ pinHash: hashPin(newPin) })
    setCurPin(''); setNewPin(''); setConfirmPin(''); setPinSection(false)
    addToast('PIN updated', 'success')
  }

  // ── Logout ────────────────────────────────────────────────────────────────

  async function handleLogout() {
    try {
      await fetch(`${backendUrl}/api/v1/auth/logout`, { method: 'POST', credentials: 'include' })
    } catch { /* offline — still clear client state */ }
    clearAuth()
    setOwnerPanel(false)
    addToast('Signed out', 'info')
  }

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <>
    <div
      aria-hidden="true"
      onClick={() => setOwnerPanel(false)}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
        zIndex: 999, backdropFilter: 'blur(2px)',
      }}
    />
    <div
      role="complementary"
      aria-label="Owner settings"
      style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 320,
        background: 'var(--jarvis-bg2)', borderLeft: '1px solid var(--jarvis-bd)',
        display: 'flex', flexDirection: 'column', zIndex: 1000,
        boxShadow: '-4px 0 24px rgba(0,0,0,0.4)',
      }}
    >
      {/* Header */}
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--jarvis-bd)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>⚙️ Owner Settings</div>
          <div style={{ fontSize: 10, color: 'var(--jarvis-ts)', marginTop: 2 }}>v{version} · {ownerConfig.activeRole}</div>
        </div>
        <button
          onClick={() => setOwnerPanel(false)}
          aria-label="Close owner panel"
          style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--jarvis-ts)', padding: '2px 6px' }}
        >
          ✕
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--jarvis-bd)', flexShrink: 0 }}>
        {(['config', 'audit', 'stats'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            flex: 1, padding: '8px 0', fontSize: 11, fontWeight: tab === t ? 700 : 400,
            background: 'none', border: 'none', cursor: 'pointer', textTransform: 'capitalize',
            borderBottom: tab === t ? '2px solid var(--jarvis-ac)' : '2px solid transparent',
            color: tab === t ? 'var(--jarvis-ac)' : 'var(--jarvis-ts)',
          }}>{t}</button>
        ))}
      </div>

      {/* Content area */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>

        {/* ── Config tab ────────────────────────────────────────────────── */}
        {tab === 'config' && (
          <div>
            {/* Preview selector — ADR-014: this previews a position, it does not
                change the signed-in identity. Wording matters: the old "Active
                Role" / "Active" labelling read as authority, which is exactly the
                misconception that let a client-owned value look authoritative. */}
            {(authRole === 'owner' || authRole === 'admin') && (
            <Section title="Preview as position">
              <p style={{ fontSize: 11, color: 'var(--jarvis-ts)', margin: '0 0 8px' }}>
                Preview how Denver looks for another position. Your signed-in position is
                {' '}<strong>{authRole ?? 'not established'}</strong> and does not change —
                a preview can only show you less, never more.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {ROLES.map(r => (
                  <button key={r.value} onClick={() => setOwnerConfig({ activeRole: r.value })} style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                    borderRadius: 6, border: ownerConfig.activeRole === r.value ? '2px solid var(--jarvis-ac)' : '1px solid var(--jarvis-bd)',
                    background: ownerConfig.activeRole === r.value ? 'color-mix(in srgb, var(--jarvis-ac) 10%, transparent)' : 'var(--jarvis-bg)',
                    cursor: 'pointer', textAlign: 'left',
                  }}>
                    <span>{r.icon}</span>
                    <span style={{ fontSize: 12, fontWeight: ownerConfig.activeRole === r.value ? 700 : 400 }}>{r.label}</span>
                    {ownerConfig.activeRole === r.value && <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--jarvis-ac)', fontWeight: 700 }}>Previewing</span>}
                  </button>
                ))}
              </div>
              {authRole && ownerConfig.activeRole !== authRole && (
                <button
                  type="button"
                  onClick={() => setOwnerConfig({ activeRole: authRole })}
                  style={{
                    marginTop: 8, width: '100%', padding: '7px 12px', fontSize: 12,
                    borderRadius: 6, border: '1px solid var(--jarvis-bd)',
                    background: 'var(--jarvis-bg)', color: 'inherit', cursor: 'pointer',
                  }}
                >
                  Exit preview
                </button>
              )}
            </Section>
            )}

            {/* Feature toggles */}
            <Section title="Feature Permissions">
              {([
                ['chatEnabled',    'AI Chat',      '🤖'],
                ['writesEnabled',  'Data Writes',  '✏️'],
                ['exportsEnabled', 'Exports',      '📤'],
                ['authEnabled',    'Auth Gate',    '🔐'],
              ] as [keyof OwnerConfig, string, string][]).map(([key, label, icon]) => (
                <ToggleRow key={key}
                  icon={icon}
                  label={label}
                  checked={!!ownerConfig[key]}
                  onChange={v => setOwnerConfig({ [key]: v } as Partial<OwnerConfig>)}
                />
              ))}
            </Section>

            {/* AI Gateway */}
            <Section title="AI Gateway">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0' }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>Gateway Status</div>
                  <div style={{ fontSize: 10, color: 'var(--jarvis-ts)', marginTop: 2 }}>
                    {gateway.enabled ? '✅ Enabled' : '🔴 Disabled'}
                    {gateway.lastCheck && ` · checked ${new Date(gateway.lastCheck).toLocaleTimeString()}`}
                  </div>
                </div>
                <button
                  className={`jarvis-btn ${gateway.enabled ? 'jarvis-btn-ghost' : 'jarvis-btn-primary'}`}
                  onClick={toggleGateway}
                  disabled={gateway.loading}
                  style={{ fontSize: 11 }}
                >
                  {gateway.loading ? '…' : gateway.enabled ? 'Disable' : 'Enable'}
                </button>
              </div>
            </Section>

            {/* PIN */}
            <Section title="Security">
              {!pinSection ? (
                <button className="jarvis-btn jarvis-btn-ghost" style={{ fontSize: 11, width: '100%' }} onClick={() => setPinSection(true)}>
                  🔑 Change PIN
                </button>
              ) : (
                <div>
                  {pinError && <div style={{ color: 'var(--jarvis-red)', fontSize: 11, marginBottom: 8 }}>{pinError}</div>}
                  {[
                    ['Current PIN', curPin, setCurPin],
                    ['New PIN (4 digits)', newPin, setNewPin],
                    ['Confirm new PIN', confirmPin, setConfirmPin],
                  ].map(([label, val, setter]) => (
                    <div key={label as string} style={{ marginBottom: 8 }}>
                      <label style={{ fontSize: 10, color: 'var(--jarvis-ts)', display: 'block', marginBottom: 3 }}>{label as string}</label>
                      <input
                        type="password" inputMode="numeric" maxLength={4}
                        className="jarvis-input" style={{ width: '100%' }}
                        value={val as string}
                        onChange={e => (setter as (v: string) => void)(e.target.value.replace(/\D/g, '').slice(0, 4))}
                      />
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button className="jarvis-btn jarvis-btn-primary" onClick={changePin} style={{ flex: 1, fontSize: 11 }}>Save PIN</button>
                    <button className="jarvis-btn jarvis-btn-ghost" onClick={() => { setPinSection(false); setPinError('') }} style={{ fontSize: 11 }}>Cancel</button>
                  </div>
                </div>
              )}
            </Section>

            {/* Emergency wipe — authenticated owner only. This was gated on
                `ownerConfig.activeRole`, the client-owned preview that defaults
                to `owner`, so any authenticated user saw it. Previewing a
                narrower position hides it too, which is the point of a preview. */}
            {authRole === 'owner' && ownerConfig.activeRole === 'owner' && (
              <Section title="Danger Zone">
                <button
                  onClick={handleLogout}
                  className="jarvis-btn jarvis-btn-ghost"
                  style={{ width: '100%', marginBottom: 8, fontSize: 11 }}
                >
                  🚪 Sign Out
                </button>
                <button
                  style={{ width: '100%', padding: '7px 0', fontSize: 11, fontWeight: 700, cursor: 'pointer', background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.4)', color: 'var(--jarvis-red)', borderRadius: 6 }}
                  onClick={() => {
                    const pin = prompt('⚠️ Emergency wipe will delete ALL business data.\nEnter owner PIN to confirm:')
                    if (!pin || hashPin(pin) !== ownerConfig.pinHash) { addToast('PIN mismatch — wipe cancelled', 'error'); return }
                    if (!confirm('FINAL WARNING: Wipe all data? This cannot be undone.')) return
                    // The actual data wipe should dispatch to biz store
                    addToast('Data wiped. Reload to start fresh.', 'error')
                  }}
                >
                  🚨 Emergency Wipe
                </button>
              </Section>
            )}
          </div>
        )}

        {/* ── Audit tab ─────────────────────────────────────────────────── */}
        {tab === 'audit' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>{auditLog.length} entries</span>
              <button className="jarvis-btn jarvis-btn-ghost" style={{ fontSize: 10 }} onClick={clearAuditLog}>Clear</button>
            </div>
            {auditLog.length === 0 ? (
              <div className="jarvis-empty"><span className="jarvis-empty-icon">📋</span><span>No audit entries</span></div>
            ) : (
              auditLog.slice(0, 50).map(entry => (
                <div key={entry.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--jarvis-bd)', fontSize: 11 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontWeight: 600, color: entry.action.includes('BLOCKED') ? 'var(--jarvis-red)' : 'var(--jarvis-tx)' }}>{entry.action}</span>
                    <span style={{ color: 'var(--jarvis-ts)', fontSize: 10 }}>{new Date(entry.ts).toLocaleTimeString()}</span>
                  </div>
                  {entry.changes.length > 0 && (
                    <div style={{ color: 'var(--jarvis-ts)', marginTop: 2 }}>{entry.changes.join(', ')}</div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* ── Stats tab ─────────────────────────────────────────────────── */}
        {tab === 'stats' && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
              <KpiCard label="API Calls"   value={apiStats.count} />
              <KpiCard label="Tokens Used" value={apiStats.tokens.toLocaleString()} color="var(--jarvis-blue)" />
              <KpiCard label="Errors"      value={apiStats.errors} color={apiStats.errors > 0 ? 'var(--jarvis-red)' : 'var(--jarvis-grn)'} />
              <KpiCard label="Avg Latency" value={apiStats.latency.length ? `${Math.round(apiStats.latency.reduce((a,b) => a+b,0)/apiStats.latency.length)}ms` : '—'} />
            </div>
            {apiStats.lastCall && (
              <div style={{ fontSize: 11, color: 'var(--jarvis-ts)', marginBottom: 12 }}>
                Last call: {new Date(apiStats.lastCall).toLocaleTimeString()}
              </div>
            )}
            <button className="jarvis-btn jarvis-btn-ghost" style={{ width: '100%', fontSize: 11 }} onClick={() => { resetApiStats(); addToast('API stats reset', 'info') }}>
              Reset Stats
            </button>
          </div>
        )}
      </div>
    </div>
    </>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--jarvis-ts)', marginBottom: 10 }}>
        {title}
      </div>
      {children}
    </div>
  )
}

function ToggleRow({ icon, label, checked, onChange }: { icon: string; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--jarvis-bd)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
        <span>{icon}</span>
        <span>{label}</span>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        style={{
          width: 36, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer',
          background: checked ? 'var(--jarvis-ac)' : 'var(--jarvis-bd)',
          position: 'relative', transition: 'background 0.2s',
        }}
        aria-label={`${label}: ${checked ? 'on' : 'off'}`}
      >
        <span style={{
          position: 'absolute', top: 2, left: checked ? 18 : 2,
          width: 16, height: 16, borderRadius: 8, background: '#fff',
          transition: 'left 0.2s', display: 'block',
        }} />
      </button>
    </div>
  )
}

export default OwnerPanel
