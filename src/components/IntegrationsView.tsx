/**
 * Denver Engineering — Integrations View (P2-6)
 * ────────────────────────────────────────────────
 * Replaces the ComingSoonView stub. Connects to the real /api/v1/integrations
 * backend (integrationsRouter) to list, create, test, and trigger sync on
 * outbound connectors (QuickBooks, Slack, Tractian, BACnet, etc.)
 *
 * Backend: GET/POST /api/v1/integrations, POST /:id/test, POST /:id/sync,
 *          PATCH /:id (toggle sync_enabled, update config)
 */

import React, { useEffect, useState, useCallback } from 'react'
import { useAppStore } from '../modules/store/appSlice'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Integration {
  id:             string
  name:           string
  type:           string          // 'quickbooks' | 'slack' | 'tractian' | 'bacnet' | etc.
  status:         'active' | 'inactive' | 'error' | 'pending'
  direction:      'inbound' | 'outbound' | 'bidirectional'
  base_url:       string | null
  sync_enabled:   boolean
  sync_interval:  number | null   // minutes
  last_sync_at:   string | null
  last_error:     string | null
  created_at:     string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TYPE_ICONS: Record<string, string> = {
  quickbooks:  '💰',
  slack:       '💬',
  tractian:    '🔩',
  bacnet:      '🏭',
  procore:     '🏗️',
  salesforce:  '☁️',
  ms_teams:    '👥',
  jira:        '🐛',
  github:      '🐙',
  default:     '🔗',
}

const STATUS_COLOR: Record<string, string> = {
  active:   '#16a34a',
  inactive: '#6b7280',
  error:    '#dc2626',
  pending:  '#d97706',
}

const DIR_LABEL: Record<string, string> = {
  inbound:       '← Inbound',
  outbound:      '→ Outbound',
  bidirectional: '↔ Bidirectional',
}

function icon(type: string) { return TYPE_ICONS[type] ?? TYPE_ICONS['default'] }

function badge(color: string): React.CSSProperties {
  return {
    display: 'inline-block', padding: '2px 8px', borderRadius: 10,
    fontSize: 11, fontWeight: 600,
    background: color + '22', color, border: `1px solid ${color}44`,
  }
}

function fmtDate(iso: string | null) {
  if (!iso) return 'Never'
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' +
         d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function IntegrationsView() {
  const tenantId = useAppStore(s => s.auth?.tenantId)

  const [integrations, setIntegrations] = useState<Integration[]>([])
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState<string | null>(null)
  const [toast, setToast]               = useState<string | null>(null)
  const [busy, setBusy]                 = useState<Record<string, boolean>>({})
  const [selected, setSelected]         = useState<Integration | null>(null)
  const [filter, setFilter]             = useState<string>('all')

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3500)
  }

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/v1/integrations', {
        headers: { 'x-tenant-id': tenantId ?? '' },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const ct = res.headers.get('content-type') ?? ''
      if (!ct.includes('application/json')) throw new Error('API not reachable — backend is offline')
      const json = await res.json() as { data: Integration[] }
      setIntegrations(json.data ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load integrations')
    } finally {
      setLoading(false)
    }
  }, [tenantId])

  useEffect(() => { void load() }, [load])

  const handleTest = async (id: string) => {
    setBusy(b => ({ ...b, [id]: true }))
    try {
      const res = await fetch(`/api/v1/integrations/${id}/test`, {
        method: 'POST',
        headers: { 'x-tenant-id': tenantId ?? '', 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const json = await res.json() as { data?: { success: boolean; message?: string }; error?: string; message?: string }
      if (!res.ok) throw new Error(json.message ?? json.error ?? `HTTP ${res.status}`)
      showToast(json.data?.message ?? 'Connection test passed ✓')
      void load()
    } catch (e) {
      showToast(`Test failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(b => ({ ...b, [id]: false }))
    }
  }

  const handleSync = async (id: string) => {
    setBusy(b => ({ ...b, [`sync-${id}`]: true }))
    try {
      const res = await fetch(`/api/v1/integrations/${id}/sync`, {
        method: 'POST',
        headers: { 'x-tenant-id': tenantId ?? '', 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      showToast('Sync triggered — check status in a moment.')
      setTimeout(() => void load(), 2000)
    } catch (e) {
      showToast(`Sync failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(b => ({ ...b, [`sync-${id}`]: false }))
    }
  }

  const handleToggle = async (intg: Integration) => {
    setBusy(b => ({ ...b, [`toggle-${intg.id}`]: true }))
    try {
      const res = await fetch(`/api/v1/integrations/${intg.id}`, {
        method: 'PATCH',
        headers: { 'x-tenant-id': tenantId ?? '', 'Content-Type': 'application/json' },
        body: JSON.stringify({ sync_enabled: !intg.sync_enabled }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      showToast(intg.sync_enabled ? 'Sync disabled.' : 'Sync enabled.')
      void load()
    } catch (e) {
      showToast(`Toggle failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(b => ({ ...b, [`toggle-${intg.id}`]: false }))
    }
  }

  // KPI summary
  const kpis = {
    total:    integrations.length,
    active:   integrations.filter(i => i.status === 'active').length,
    errors:   integrations.filter(i => i.status === 'error').length,
    syncing:  integrations.filter(i => i.sync_enabled).length,
  }

  const filtered = integrations.filter(i => {
    if (filter === 'all') return true
    return i.status === filter
  })

  // ── Render ──────────────────────────────────────────────────────────────────

  const S = {
    page: { padding: 24, fontFamily: 'var(--jarvis-font,system-ui)', color: 'var(--jarvis-text,#e2e8f0)', maxWidth: 1100 } as React.CSSProperties,
    tile: { background: 'var(--jarvis-surface,#1e293b)', border: '1px solid var(--jarvis-border,#334155)', borderRadius: 8, padding: '16px 20px', flex: '1 1 140px', minWidth: 140 } as React.CSSProperties,
    card: { background: 'var(--jarvis-surface,#1e293b)', border: '1px solid var(--jarvis-border,#334155)', borderRadius: 8, padding: 20, display: 'flex', flexDirection: 'column' as const, gap: 12 } as React.CSSProperties,
    btn: (color: string) => ({ padding: '5px 12px', background: color, color: '#fff', border: 'none', borderRadius: 5, cursor: 'pointer', fontSize: 12, fontWeight: 600 } as React.CSSProperties),
  }

  return (
    <div style={S.page}>

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', top: 20, right: 20, background: '#16a34a', color: '#fff', padding: '10px 20px', borderRadius: 8, zIndex: 9999, fontSize: 13, boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }}>
          {toast}
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>🔗 Integrations</h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--jarvis-ts,#94a3b8)' }}>
            Outbound connectors — QuickBooks, Slack, Tractian, BACnet and more
          </p>
        </div>
        <button
          style={S.btn('#2563eb')}
          onClick={() => showToast('Connect new integration — form coming soon')}
        >
          + Connect
        </button>
      </div>

      {/* KPI tiles */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 24 }}>
        {[
          { label: 'Total',       value: kpis.total,   color: '#94a3b8' },
          { label: 'Active',      value: kpis.active,  color: '#16a34a' },
          { label: 'Errors',      value: kpis.errors,  color: '#dc2626' },
          { label: 'Auto-Sync',   value: kpis.syncing, color: '#2563eb' },
        ].map(t => (
          <div key={t.label} style={{ ...S.tile, borderTop: `3px solid ${t.color}` }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: t.color }}>{loading ? '—' : t.value}</div>
            <div style={{ fontSize: 12, color: 'var(--jarvis-ts,#94a3b8)', marginTop: 2 }}>{t.label}</div>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {(['all', 'active', 'inactive', 'error', 'pending'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: '4px 12px', borderRadius: 20, fontSize: 12,
            border: '1px solid var(--jarvis-border,#334155)', cursor: 'pointer',
            background: filter === f ? '#2563eb' : 'transparent',
            color:      filter === f ? '#fff' : 'var(--jarvis-ts,#94a3b8)',
            fontWeight: filter === f ? 600 : 400,
          }}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Error state */}
      {error && (
        <div style={{ background: '#7f1d1d22', border: '1px solid #dc2626', borderRadius: 6, padding: 12, marginBottom: 16, fontSize: 13, color: '#fca5a5' }}>
          {error} — <button onClick={() => void load()} style={{ color: '#93c5fd', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>retry</button>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--jarvis-ts,#94a3b8)', fontSize: 13 }}>
          Loading integrations…
        </div>
      )}

      {/* Empty state */}
      {!loading && filtered.length === 0 && !error && (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--jarvis-ts,#94a3b8)' }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>🔌</div>
          <div style={{ fontSize: 14 }}>No integrations{filter !== 'all' ? ` with status "${filter}"` : ' connected yet'}.</div>
          <button
            style={{ ...S.btn('#2563eb'), marginTop: 16 }}
            onClick={() => showToast('Connect integration — form coming soon')}
          >
            + Connect first integration
          </button>
        </div>
      )}

      {/* Integration cards */}
      {!loading && filtered.length > 0 && (
        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
          {filtered.map(intg => {
            const isTestBusy   = busy[intg.id] ?? false
            const isSyncBusy   = busy[`sync-${intg.id}`] ?? false
            const isToggleBusy = busy[`toggle-${intg.id}`] ?? false

            return (
              <div
                key={intg.id}
                style={{ ...S.card, cursor: 'pointer' }}
                onClick={() => setSelected(intg)}
              >
                {/* Card header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 24 }}>{icon(intg.type)}</span>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{intg.name}</div>
                      <div style={{ fontSize: 11, color: '#64748b', textTransform: 'capitalize' }}>{intg.type.replace(/_/g, ' ')}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexDirection: 'column', alignItems: 'flex-end' }}>
                    <span style={badge(STATUS_COLOR[intg.status] ?? '#6b7280')}>
                      {intg.status}
                    </span>
                    <span style={{ fontSize: 11, color: '#64748b' }}>{DIR_LABEL[intg.direction] ?? intg.direction}</span>
                  </div>
                </div>

                {/* Last sync */}
                <div style={{ fontSize: 12, color: '#64748b' }}>
                  Last sync: <span style={{ color: intg.last_error ? '#fca5a5' : '#94a3b8' }}>
                    {fmtDate(intg.last_sync_at)}
                  </span>
                  {intg.sync_interval && (
                    <span style={{ marginLeft: 8, color: '#64748b' }}>· every {intg.sync_interval}m</span>
                  )}
                </div>

                {/* Error */}
                {intg.last_error && (
                  <div style={{ fontSize: 11, color: '#fca5a5', background: '#7f1d1d22', borderRadius: 4, padding: '4px 8px' }}>
                    {intg.last_error.slice(0, 120)}
                  </div>
                )}

                {/* Actions */}
                <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }} onClick={e => e.stopPropagation()}>
                  <button
                    disabled={isTestBusy}
                    onClick={() => void handleTest(intg.id)}
                    style={{ ...S.btn('#374151'), opacity: isTestBusy ? 0.6 : 1 }}
                  >
                    {isTestBusy ? 'Testing…' : '⚡ Test'}
                  </button>
                  {intg.sync_enabled ? (
                    <button
                      disabled={isSyncBusy}
                      onClick={() => void handleSync(intg.id)}
                      style={{ ...S.btn('#1e40af'), opacity: isSyncBusy ? 0.6 : 1 }}
                    >
                      {isSyncBusy ? 'Syncing…' : '🔄 Sync now'}
                    </button>
                  ) : null}
                  <button
                    disabled={isToggleBusy}
                    onClick={() => void handleToggle(intg)}
                    style={{ ...S.btn(intg.sync_enabled ? '#374151' : '#374151'), opacity: isToggleBusy ? 0.6 : 1 }}
                  >
                    {intg.sync_enabled ? 'Disable sync' : 'Enable sync'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Detail drawer */}
      {selected && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', justifyContent: 'flex-end' }}
          onClick={() => setSelected(null)}
        >
          <div
            style={{ width: 440, background: 'var(--jarvis-surface,#1e293b)', height: '100%', overflowY: 'auto', padding: 24, boxShadow: '-4px 0 24px rgba(0,0,0,0.4)' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 28 }}>{icon(selected.type)}</span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>{selected.name}</div>
                  <div style={{ fontSize: 12, color: '#94a3b8', textTransform: 'capitalize' }}>{selected.type.replace(/_/g, ' ')}</div>
                </div>
              </div>
              <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 20, lineHeight: 1 }}>×</button>
            </div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
              <span style={badge(STATUS_COLOR[selected.status] ?? '#6b7280')}>{selected.status}</span>
              <span style={badge('#64748b')}>{DIR_LABEL[selected.direction] ?? selected.direction}</span>
              {selected.sync_enabled && <span style={badge('#16a34a')}>Auto-sync on</span>}
            </div>

            {[
              ['Base URL',      selected.base_url ?? '—'],
              ['Sync interval', selected.sync_interval ? `${selected.sync_interval} min` : '—'],
              ['Last sync',     fmtDate(selected.last_sync_at)],
              ['Connected',     fmtDate(selected.created_at)],
            ].map(([label, value]) => (
              <div key={label} style={{ marginBottom: 14, fontSize: 13 }}>
                <div style={{ color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>{label}</div>
                <div style={{ wordBreak: 'break-all' }}>{value}</div>
              </div>
            ))}

            {selected.last_error && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ color: '#dc2626', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Last error</div>
                <div style={{ fontSize: 12, color: '#fca5a5', background: '#7f1d1d22', borderRadius: 6, padding: 10 }}>{selected.last_error}</div>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 24 }}>
              <button
                disabled={busy[selected.id]}
                onClick={() => void handleTest(selected.id)}
                style={{ ...S.btn('#1e40af'), padding: '9px 16px', fontSize: 13 }}
              >
                {busy[selected.id] ? 'Testing…' : '⚡ Test connection'}
              </button>
              {selected.sync_enabled && (
                <button
                  disabled={busy[`sync-${selected.id}`]}
                  onClick={() => void handleSync(selected.id)}
                  style={{ ...S.btn('#1e3a8a'), padding: '9px 16px', fontSize: 13 }}
                >
                  {busy[`sync-${selected.id}`] ? 'Syncing…' : '🔄 Sync now'}
                </button>
              )}
              <button
                disabled={busy[`toggle-${selected.id}`]}
                onClick={() => void handleToggle(selected)}
                style={{ ...S.btn('#374151'), padding: '9px 16px', fontSize: 13 }}
              >
                {busy[`toggle-${selected.id}`] ? '…' : selected.sync_enabled ? 'Disable auto-sync' : 'Enable auto-sync'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
