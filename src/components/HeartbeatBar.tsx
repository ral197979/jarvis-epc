/**
 * Denver Engineering — HeartbeatBar  (v4.30.0)
 * ──────────────────────────────────────────────────────────────────────────────
 * System status header bar — amber-accent refresh, lucide icons.
 */
import React, { useEffect, useState } from 'react'
import { useAppStore }                  from '../modules/store/appSlice'
import {
  Activity, Clock, Radio, Cpu, Command, ShieldCheck,
} from 'lucide-react'

export interface HeartbeatBarProps {
  backendUrl?:  string
  version?:     string
}

export function HeartbeatBar({ backendUrl = '', version = '4.30.0' }: HeartbeatBarProps) {
  const apiStats   = useAppStore(s => s.apiStats)
  const gateway    = useAppStore(s => s.gateway)
  const ownerCfg   = useAppStore(s => s.ownerConfig)
  const setGateway = useAppStore(s => s.setGateway)
  const setCmdPalette = useAppStore(s => s.setCmdPalette)

  const [healthy, setHealthy] = useState(true)
  const [uptime,  setUptime]  = useState(0)
  const startTime = useState(() => Date.now())[0]

  useEffect(() => {
    const id = setInterval(() => setUptime(Math.round((Date.now() - startTime) / 1000)), 10000)
    return () => clearInterval(id)
  }, [startTime])

  useEffect(() => {
    const check = async () => {
      try {
        const r = await fetch(`${backendUrl}/api/v1/health`, { credentials: 'include' })
        setHealthy(r.ok)
      } catch { setHealthy(false) }
    }
    check()
    const id = setInterval(check, 30000)
    return () => clearInterval(id)
  }, [backendUrl])

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

  const pill: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '3px 10px', borderRadius: 999, fontSize: 11,
    background: 'var(--jarvis-sf)',
    border: '1px solid var(--jarvis-bd)',
    color: 'var(--jarvis-tx2)',
    fontVariantNumeric: 'tabular-nums',
  }

  return (
    <header
      role="banner"
      aria-label="System status bar"
      style={{
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-between',
        padding:        '8px 18px',
        background:     'var(--jarvis-bg2)',
        borderBottom:   '1px solid var(--jarvis-bd)',
        fontSize:       12,
        color:          'var(--jarvis-tx2)',
        flexShrink:     0,
        gap:            16,
        flexWrap:       'wrap',
        height:         44,
      }}
    >
      {/* Brand */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 600, color: 'var(--jarvis-tx)', fontSize: 13, letterSpacing: '-0.01em' }}>
        <ShieldCheck size={16} color='var(--jarvis-ac)' strokeWidth={2.2} />
        <span>Denver Engineering</span>
        <span style={{
          fontSize: 10, fontWeight: 500, color: 'var(--jarvis-ac)',
          padding: '2px 8px', borderRadius: 4,
          background: 'color-mix(in srgb, var(--jarvis-ac) 12%, transparent)',
          letterSpacing: '0.03em',
        }}>v{version}</span>
      </div>

      {/* Status pills */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {/* Health */}
        <span style={{ ...pill, color: healthy ? 'var(--jarvis-grn)' : 'var(--jarvis-red)' }} title={healthy ? 'System healthy' : 'System issues'}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: healthy ? 'var(--jarvis-grn)' : 'var(--jarvis-red)',
            boxShadow: `0 0 6px ${healthy ? 'var(--jarvis-grn)' : 'var(--jarvis-red)'}`,
          }} />
          {healthy ? 'Healthy' : 'Degraded'}
        </span>

        {/* Uptime */}
        <span style={pill} title="Session uptime">
          <Clock size={12} strokeWidth={2} />
          {uptime < 60 ? `${uptime}s` : `${Math.round(uptime / 60)}m`}
        </span>

        {/* API calls */}
        <span style={pill} title="API calls this session">
          <Radio size={12} strokeWidth={2} />
          {apiStats.count} {apiStats.tokens > 0 ? `· ${(apiStats.tokens / 1000).toFixed(1)}k` : ''}
        </span>

        {/* Latency */}
        {avgLatency !== null && (
          <span style={{ ...pill, color: avgLatency > 2000 ? 'var(--jarvis-red)' : avgLatency > 500 ? 'var(--jarvis-amb)' : 'var(--jarvis-tx2)' }} title="Avg latency">
            <Activity size={12} strokeWidth={2} />
            {avgLatency}ms
          </span>
        )}

        {/* Gateway */}
        <span
          style={{ ...pill, color: gateway.enabled ? 'var(--jarvis-grn)' : 'var(--jarvis-red)', fontWeight: 600 }}
          title={`AI Gateway ${gateway.enabled ? 'enabled' : 'disabled'}`}
        >
          <Cpu size={12} strokeWidth={2.2} />
          {gateway.enabled ? 'AI on' : 'AI off'}
        </span>

        {/* Role */}
        <span style={{
          padding: '3px 10px', borderRadius: 999, fontWeight: 600, fontSize: 10,
          textTransform: 'uppercase', letterSpacing: '0.05em',
          background: 'color-mix(in srgb, var(--jarvis-ac) 12%, transparent)',
          color: 'var(--jarvis-ac)',
          border: '1px solid color-mix(in srgb, var(--jarvis-ac) 25%, transparent)',
        }}>
          {ownerCfg.activeRole}
        </span>

        {/* Cmd palette */}
        <button
          onClick={() => setCmdPalette(true)}
          aria-label="Open command palette"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
            background: 'var(--jarvis-sf)',
            border: '1px solid var(--jarvis-bd)',
            color: 'var(--jarvis-tx2)',
            cursor: 'pointer',
            fontFamily: 'var(--jarvis-font-mono)',
          }}
        >
          <Command size={11} strokeWidth={2.2} />K
        </button>
      </div>
    </header>
  )
}

export default HeartbeatBar
