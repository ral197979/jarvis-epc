/**
 * JARVIS EPC — HeartbeatBar  (v4.29.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 19d: System status header bar extracted from JarvisApp.
 * Shows auth status, API stats, gateway state, and active role.
 */

import React, { useEffect, useState } from 'react'
import { useAppStore }                  from '../modules/store/appSlice'

export interface HeartbeatBarProps {
  backendUrl?:  string
  version?:     string
}

export function HeartbeatBar({ backendUrl = '', version = '4.29.0' }: HeartbeatBarProps) {
  const apiStats   = useAppStore(s => s.apiStats)
  const gateway    = useAppStore(s => s.gateway)
  const auth       = useAppStore(s => s.auth)
  const ownerCfg   = useAppStore(s => s.ownerConfig)
  const setGateway = useAppStore(s => s.setGateway)
  const setCmdPalette = useAppStore(s => s.setCmdPalette)

  const [healthy, setHealthy] = useState(true)
  const [uptime,  setUptime]  = useState(0)
  const startTime = useState(() => Date.now())[0]

  // Uptime ticker
  useEffect(() => {
    const interval = setInterval(() => setUptime(Math.round((Date.now() - startTime) / 1000)), 10000)
    return () => clearInterval(interval)
  }, [startTime])

  // Heartbeat: ping /api/v1/health every 30s
  useEffect(() => {
    const check = async () => {
      try {
        const r = await fetch(`${backendUrl}/api/v1/health`, { credentials: 'include' })
        setHealthy(r.ok)
      } catch { setHealthy(false) }
    }
    check()
    const interval = setInterval(check, 30000)
    return () => clearInterval(interval)
  }, [backendUrl])

  // Poll gateway status
  useEffect(() => {
    if (!backendUrl) return
    fetch(`${backendUrl}/api/v1/gateway/status`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setGateway({ enabled: d.enabled !== false }) })
      .catch(() => {})
  }, [backendUrl])

  const avgLatency = apiStats.latency.length
    ? Math.round(apiStats.latency.slice(-10).reduce((a, b) => a + b, 0) / Math.min(apiStats.latency.length, 10))
    : null

  return (
    <header
      role="banner"
      aria-label="System status bar"
      style={{
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-between',
        padding:        '4px 16px',
        background:     'var(--jarvis-bg2)',
        borderBottom:   '1px solid var(--jarvis-bd)',
        fontSize:       11,
        color:          'var(--jarvis-ts)',
        flexShrink:     0,
        gap:            16,
        flexWrap:       'wrap',
      }}
    >
      {/* Brand */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 700, color: 'var(--jarvis-tx)', fontSize: 13 }}>
        <span aria-hidden>🔧</span>
        JARVIS EPC
        <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--jarvis-ts)' }}>v{version}</span>
      </div>

      {/* Status pills */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>

        {/* System health */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span
            role="img"
            aria-label={healthy ? 'System healthy' : 'System issues detected'}
            style={{
              width: 7, height: 7, borderRadius: '50%', display: 'inline-block',
              background: healthy ? 'var(--jarvis-grn)' : 'var(--jarvis-red)',
              boxShadow:  `0 0 4px ${healthy ? 'var(--jarvis-grn)' : 'var(--jarvis-red)'}`,
            }}
          />
          <span>{healthy ? 'Healthy' : 'Degraded'}</span>
        </div>

        {/* Uptime */}
        <span title="Session uptime" style={{ color: 'var(--jarvis-ts)' }}>
          ⏱ {uptime < 60 ? `${uptime}s` : `${Math.round(uptime / 60)}m`}
        </span>

        {/* API calls */}
        <span title="API calls this session">
          📡 {apiStats.count} call{apiStats.count !== 1 ? 's' : ''}
          {apiStats.tokens > 0 && ` · ${(apiStats.tokens / 1000).toFixed(1)}k tokens`}
        </span>

        {/* Avg latency */}
        {avgLatency !== null && (
          <span title="Average API latency" style={{ color: avgLatency > 2000 ? 'var(--jarvis-red)' : avgLatency > 500 ? 'var(--jarvis-amb)' : 'var(--jarvis-ts)' }}>
            {avgLatency}ms
          </span>
        )}

        {/* Gateway */}
        <span
          title={`AI Gateway ${gateway.enabled ? 'enabled' : 'disabled'}`}
          style={{ color: gateway.enabled ? 'var(--jarvis-grn)' : 'var(--jarvis-red)', fontWeight: 600 }}
        >
          🤖 {gateway.enabled ? 'AI on' : 'AI off'}
        </span>

        {/* Role badge */}
        <span style={{
          padding: '1px 8px', borderRadius: 10, fontWeight: 700, fontSize: 10,
          background: 'color-mix(in srgb, var(--jarvis-ac) 12%, transparent)',
          color:      'var(--jarvis-ac)',
        }}>
          {ownerCfg.activeRole}
        </span>

        {/* Cmd palette shortcut */}
        <button
          onClick={() => setCmdPalette(true)}
          aria-label="Open command palette (⌘K)"
          style={{
            padding: '1px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600,
            background: 'var(--jarvis-bd)', border: 'none', cursor: 'pointer',
            color: 'var(--jarvis-ts)',
          }}
        >
          ⌘K
        </button>
      </div>
    </header>
  )
}

export default HeartbeatBar
