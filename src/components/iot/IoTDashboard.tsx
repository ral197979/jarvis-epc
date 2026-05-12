/**
 * Denver Engineering — IoT Sensor Dashboard (v10.5.0)
 * ──────────────────────────────────────────────────────
 * Real-time sensor monitoring: latest readings, sparklines,
 * threshold alerts, sensor registration, and ingest token generation.
 */
import React, { useState, useEffect, useCallback } from 'react'
import { useBizStore, selectProjects } from '../../modules/biz/store'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Sensor {
  id: string; sensorUid: string; name: string; sensorType: string; unit: string
  protocol: string; lastValue: number | null; lastReadingAt: string | null
  status: string; warnLow: number | null; warnHigh: number | null
  alertLow: number | null; alertHigh: number | null
}

interface Reading { id: string; ts: string; value: number; quality: string }
interface Alert {
  id: string; sensorId: string; sensor_name: string; alert_type: string
  severity: string; triggered_value: number | null; threshold: number | null
  triggered_at: string; acknowledged_at: string | null
}

// ─── Sparkline (SVG mini chart) ───────────────────────────────────────────────

function Sparkline({ readings, warnLow, warnHigh, alertLow, alertHigh }: {
  readings: Reading[]; warnLow?: number | null; warnHigh?: number | null
  alertLow?: number | null; alertHigh?: number | null
}) {
  if (readings.length < 2) return <div style={{ width: 120, height: 36, background: '#111', borderRadius: 3 }} />
  const W = 120, H = 36, PAD = 4
  const vals = readings.map(r => r.value)
  const min  = Math.min(...vals)
  const max  = Math.max(...vals)
  const rng  = max - min || 1
  const x = (i: number) => PAD + (i / (vals.length - 1)) * (W - PAD * 2)
  const y = (v: number) => H - PAD - ((v - min) / rng) * (H - PAD * 2)
  const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')

  // Last value colour
  const last = vals[vals.length - 1]!
  const color =
    (alertHigh != null && last > alertHigh) || (alertLow != null && last < alertLow) ? '#e74c3c'
    : (warnHigh != null && last > warnHigh)  || (warnLow  != null && last < warnLow)  ? '#f39c12'
    : '#2ecc71'

  return (
    <svg width={W} height={H} style={{ background: '#111', borderRadius: 3 }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} />
      <circle cx={x(vals.length - 1)} cy={y(last)} r={2.5} fill={color} />
    </svg>
  )
}

// ─── Sensor card ──────────────────────────────────────────────────────────────

function SensorCard({ sensor, readings, onSelect }: {
  sensor: Sensor; readings: Reading[]; onSelect: () => void
}) {
  const last = sensor.lastValue
  const alertColor =
    (sensor.alertHigh != null && last != null && last > sensor.alertHigh) ||
    (sensor.alertLow  != null && last != null && last < sensor.alertLow)  ? '#e74c3c'
    : (sensor.warnHigh != null && last != null && last > sensor.warnHigh) ||
      (sensor.warnLow  != null && last != null && last < sensor.warnLow)  ? '#f39c12'
    : '#2ecc71'

  const ageMs = sensor.lastReadingAt ? Date.now() - new Date(sensor.lastReadingAt).getTime() : null
  const ageStr = ageMs == null ? 'no data'
    : ageMs < 60000 ? `${Math.round(ageMs / 1000)}s ago`
    : ageMs < 3600000 ? `${Math.round(ageMs / 60000)}m ago`
    : `${Math.round(ageMs / 3600000)}h ago`

  return (
    <div onClick={onSelect} style={{
      border: `1px solid var(--jarvis-bd)`, borderRadius: 6, padding: 12,
      cursor: 'pointer', background: 'var(--jarvis-bg2)',
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 13 }}>{sensor.name}</div>
          <div style={{ fontSize: 10, color: 'var(--jarvis-ts)', textTransform: 'uppercase' }}>
            {sensor.sensorType} · {sensor.protocol}
          </div>
        </div>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: alertColor, marginTop: 4, display: 'inline-block', flexShrink: 0 }} />
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontSize: 22, fontWeight: 700, color: alertColor, fontVariantNumeric: 'tabular-nums' }}>
          {last != null ? last.toFixed(2) : '—'}
        </span>
        <span style={{ fontSize: 11, color: 'var(--jarvis-ts)' }}>{sensor.unit}</span>
      </div>

      <Sparkline readings={readings} warnLow={sensor.warnLow} warnHigh={sensor.warnHigh} alertLow={sensor.alertLow} alertHigh={sensor.alertHigh} />

      <div style={{ fontSize: 10, color: 'var(--jarvis-ts)' }}>{ageStr}</div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function IoTDashboard() {
  const projects = useBizStore(selectProjects)
  const [projectId, setProjectId] = useState(() => (projects as any[])?.[0]?.id ?? '')
  const [sensors, setSensors]     = useState<Sensor[]>([])
  const [readingsMap, setReadingsMap] = useState<Record<string, Reading[]>>({})
  const [alerts, setAlerts]       = useState<Alert[]>([])
  const [selected, setSelected]   = useState<Sensor | null>(null)
  const [selectedReadings, setSelectedReadings] = useState<Reading[]>([])
  const [loading, setLoading]     = useState(false)

  // Register form
  const [showForm, setShowForm]   = useState(false)
  const [draft, setDraft]         = useState({ sensorUid: '', name: '', sensorType: 'temperature', unit: '°C', protocol: 'mqtt', topic: '' })
  const [saving, setSaving]       = useState(false)

  // Token generation
  const [newToken, setNewToken]   = useState('')

  const load = useCallback(async (pid: string) => {
    if (!pid) return
    setLoading(true)
    try {
      const [sRes, aRes] = await Promise.all([
        fetch(`/api/v1/projects/${pid}/sensors`),
        fetch(`/api/v1/projects/${pid}/sensors/alerts`),
      ])
      const sList: Sensor[] = sRes.ok ? ((await sRes.json()).sensors ?? []) : []
      setSensors(sList)
      setAlerts(aRes.ok ? ((await aRes.json()).alerts ?? []) : [])

      // Fetch last 20 readings for each sensor (parallel)
      const entries = await Promise.all(
        sList.map(async s => {
          const r = await fetch(`/api/v1/sensors/${s.id}/readings?limit=20`)
          const data = r.ok ? ((await r.json()).readings ?? []) as Reading[] : []
          return [s.id, data.reverse()] as [string, Reading[]]
        })
      )
      setReadingsMap(Object.fromEntries(entries))
    } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    if (projects?.length && !projectId) setProjectId((projects as any[])[0].id)
  }, [projects])

  useEffect(() => { if (projectId) load(projectId) }, [projectId, load])

  // Auto-refresh every 30s
  useEffect(() => {
    const t = setInterval(() => { if (projectId) load(projectId) }, 30_000)
    return () => clearInterval(t)
  }, [projectId, load])

  const selectSensor = async (s: Sensor) => {
    setSelected(s)
    const r = await fetch(`/api/v1/sensors/${s.id}/readings?limit=100`)
    setSelectedReadings(r.ok ? ((await r.json()).readings ?? []).reverse() : [])
  }

  const registerSensor = async () => {
    setSaving(true)
    const res = await fetch(`/api/v1/projects/${projectId}/sensors`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    })
    setSaving(false)
    if (res.ok) { setShowForm(false); load(projectId) }
  }

  const genToken = async () => {
    const res = await fetch('/api/v1/sensors/tokens', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'dashboard-token' }),
    })
    if (res.ok) setNewToken((await res.json()).token as string)
  }

  const ackAlert = async (id: string) => {
    await fetch(`/api/v1/sensors/alerts/${id}/acknowledge`, { method: 'POST' })
    setAlerts(prev => prev.filter(a => a.id !== id))
  }

  const openAlerts = alerts.filter(a => !a.acknowledged_at)

  return (
    <div style={{ padding: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>📡 IoT Sensors</h2>
        <select value={projectId} onChange={e => { setProjectId(e.target.value); setSelected(null) }} style={{ padding: 6 }}>
          {(projects as any[])?.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={genToken} style={{ padding: '6px 12px', border: '1px solid var(--jarvis-bd)', borderRadius: 4, cursor: 'pointer', background: 'var(--jarvis-bg2)' }}>
            🔑 Ingest Token
          </button>
          <button onClick={() => setShowForm(true)} style={{ padding: '6px 12px', background: 'var(--jarvis-ac)', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
            + Register Sensor
          </button>
        </div>
      </div>

      {/* Ingest token display */}
      {newToken && (
        <div style={{ background: 'var(--jarvis-bg2)', border: '1px solid #f39c12', borderRadius: 6, padding: 12, marginBottom: 16, fontSize: 12 }}>
          <div style={{ color: '#f39c12', fontWeight: 600, marginBottom: 4 }}>⚠️ Copy this token — it won't be shown again</div>
          <code style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}>{newToken}</code>
          <div style={{ marginTop: 8, color: 'var(--jarvis-ts)' }}>
            Use as: <code>Authorization: Bearer {newToken.slice(0, 8)}…</code> on POST /api/v1/iot/ingest
          </div>
          <button onClick={() => setNewToken('')} style={{ marginTop: 8, fontSize: 11 }}>Dismiss</button>
        </div>
      )}

      {/* Active alerts banner */}
      {openAlerts.length > 0 && (
        <div style={{ background: 'rgba(231,76,60,0.1)', border: '1px solid #e74c3c', borderRadius: 6, padding: 12, marginBottom: 16 }}>
          <div style={{ fontWeight: 600, color: '#e74c3c', marginBottom: 8 }}>🚨 {openAlerts.length} active alert{openAlerts.length > 1 ? 's' : ''}</div>
          {openAlerts.map(a => (
            <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderTop: '1px solid rgba(231,76,60,0.2)', fontSize: 12 }}>
              <span>
                <strong>{a.sensor_name}</strong> — {a.alert_type === 'high' ? '↑ High' : '↓ Low'} {a.severity === 'critical' ? '🔴' : '🟡'}
                {a.triggered_value != null && ` (${a.triggered_value.toFixed(2)}`}
                {a.threshold != null && ` vs limit ${a.threshold.toFixed(2)})`}
              </span>
              <button onClick={() => ackAlert(a.id)} style={{ fontSize: 11, padding: '2px 8px' }}>Ack</button>
            </div>
          ))}
        </div>
      )}

      {/* Register sensor form */}
      {showForm && (
        <div style={{ border: '1px solid var(--jarvis-bd)', borderRadius: 6, padding: 14, marginBottom: 16, background: 'var(--jarvis-bg2)' }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Register Sensor</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 8 }}>
            <input placeholder="Sensor UID (e.g. temp-001)" value={draft.sensorUid} onChange={e => setDraft({ ...draft, sensorUid: e.target.value })} />
            <input placeholder="Display name" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} />
            <select value={draft.sensorType} onChange={e => setDraft({ ...draft, sensorType: e.target.value })}>
              {['temperature','pressure','flow','vibration','level','power','humidity','co2','custom'].map(t => <option key={t}>{t}</option>)}
            </select>
            <input placeholder="Unit (°C, bar, m³/h…)" value={draft.unit} onChange={e => setDraft({ ...draft, unit: e.target.value })} />
            <select value={draft.protocol} onChange={e => setDraft({ ...draft, protocol: e.target.value })}>
              {['mqtt','opcua','modbus','http','bacnet'].map(t => <option key={t}>{t}</option>)}
            </select>
            <input placeholder="Topic / Node ID (optional)" value={draft.topic} onChange={e => setDraft({ ...draft, topic: e.target.value })} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={registerSensor} disabled={saving} style={{ background: 'var(--jarvis-ac)', color: '#fff', border: 'none', padding: '6px 14px', borderRadius: 4, cursor: 'pointer' }}>
              {saving ? 'Saving…' : 'Register'}
            </button>
            <button onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      {loading && <div style={{ color: 'var(--jarvis-ts)', padding: 20 }}>Loading…</div>}

      {!loading && sensors.length === 0 && (
        <div style={{ background: 'var(--jarvis-bg2)', border: '1px solid var(--jarvis-bd)', borderRadius: 6, padding: 40, textAlign: 'center', color: 'var(--jarvis-ts)' }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>📡</div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>No sensors registered</div>
          <div style={{ fontSize: 12 }}>Register a sensor above, then POST readings to /api/v1/iot/ingest</div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 360px' : '1fr', gap: 16 }}>
        {/* Sensor grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
          {sensors.map(s => (
            <SensorCard
              key={s.id} sensor={s}
              readings={readingsMap[s.id] ?? []}
              onSelect={() => selected?.id === s.id ? setSelected(null) : selectSensor(s)}
            />
          ))}
        </div>

        {/* Detail panel */}
        {selected && (
          <div style={{ border: '1px solid var(--jarvis-bd)', borderRadius: 6, padding: 14, background: 'var(--jarvis-bg2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ fontWeight: 700 }}>{selected.name}</div>
              <button onClick={() => setSelected(null)} style={{ fontSize: 11 }}>✕</button>
            </div>
            <div style={{ fontSize: 11, color: 'var(--jarvis-ts)', marginBottom: 12 }}>
              UID: <code>{selected.sensorUid}</code> · {selected.protocol.toUpperCase()}
            </div>

            {/* Readings table */}
            <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 6 }}>Last 100 readings</div>
            <div style={{ maxHeight: 340, overflowY: 'auto', fontSize: 11 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#1a1a1a', textAlign: 'left' }}>
                    <th style={{ padding: '4px 6px' }}>Time</th>
                    <th style={{ padding: '4px 6px' }}>Value</th>
                    <th style={{ padding: '4px 6px' }}>Q</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedReadings.slice().reverse().map(r => (
                    <tr key={r.id} style={{ borderBottom: '1px solid #1a1a1a' }}>
                      <td style={{ padding: '3px 6px', color: 'var(--jarvis-ts)' }}>
                        {new Date(r.ts).toLocaleTimeString()}
                      </td>
                      <td style={{ padding: '3px 6px', fontFamily: 'monospace' }}>
                        {r.value.toFixed(4)} {selected.unit}
                      </td>
                      <td style={{ padding: '3px 6px', color: r.quality === 'good' ? '#2ecc71' : '#f39c12' }}>
                        {r.quality[0]!.toUpperCase()}
                      </td>
                    </tr>
                  ))}
                  {!selectedReadings.length && <tr><td colSpan={3} style={{ padding: 12, textAlign: 'center', color: 'var(--jarvis-ts)' }}>No readings yet</td></tr>}
                </tbody>
              </table>
            </div>

            {/* Thresholds summary */}
            <div style={{ marginTop: 12, fontSize: 11, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
              {[['Warn low', selected.warnLow],['Warn high', selected.warnHigh],['Alert low', selected.alertLow],['Alert high', selected.alertHigh]].map(([l, v]) => (
                <div key={l as string} style={{ color: 'var(--jarvis-ts)' }}>
                  {l as string}: <strong>{v != null ? (v as number).toFixed(2) + ' ' + selected.unit : '—'}</strong>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Ingest guide */}
      <div style={{ marginTop: 24, padding: 14, background: 'var(--jarvis-bg2)', border: '1px solid var(--jarvis-bd)', borderRadius: 6, fontSize: 11 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Ingest endpoints</div>
        <div style={{ display: 'grid', gap: 6, fontFamily: 'monospace', color: 'var(--jarvis-ts)' }}>
          <div><strong style={{ color: 'var(--jarvis-fg)' }}>Batch (Telegraf / EMQX webhook):</strong></div>
          <div style={{ paddingLeft: 12 }}>POST /api/v1/iot/ingest?project_id={"<id>"}</div>
          <div style={{ paddingLeft: 12 }}>Body: [{"{"}"sensorUid":"temp-001","value":23.5,"ts":"2024-01-15T10:00:00Z"{"}"}]</div>
          <div style={{ marginTop: 4 }}><strong style={{ color: 'var(--jarvis-fg)' }}>Single reading:</strong></div>
          <div style={{ paddingLeft: 12 }}>POST /api/v1/sensors/:uid/readings?project_id={"<id>"}</div>
          <div style={{ paddingLeft: 12 }}>Body: {"{"}"value":23.5,"ts":"2024-01-15T10:00:00Z"{"}"}</div>
          <div style={{ marginTop: 4 }}><strong style={{ color: 'var(--jarvis-fg)' }}>Auth:</strong> Authorization: Bearer {"<ingest-token>"} (or JWT)</div>
        </div>
      </div>
    </div>
  )
}

export default IoTDashboard
