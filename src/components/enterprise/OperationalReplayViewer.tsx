/**
 * Denver Engineering — Operational Replay Viewer (v4.40.0)
 * ──────────────────────────────────────────────────────────
 * Ava Phase 4 — Launches and monitors simulation/replay sessions.
 * Supports replay from timestamp range and what-if scenario injection.
 */
import React, { useState } from 'react'
import { SimulationResultViewer } from './SimulationResultViewer'

interface OperationalReplayViewerProps {
  defaultFrom?: string
  defaultTo?:   string
}

interface SyntheticEvent {
  event_type: string
  payload:    string  // JSON string in UI
  inject_at?: number
}

export function OperationalReplayViewer({ defaultFrom, defaultTo }: OperationalReplayViewerProps) {
  const [from, setFrom]             = useState(defaultFrom ?? '')
  const [to, setTo]                 = useState(defaultTo ?? '')
  const [mode, setMode]             = useState<'replay' | 'what_if'>('replay')
  const [synthEvents, setSynthEvents] = useState<SyntheticEvent[]>([])
  const [sessionId, setSessionId]   = useState<string | null>(null)
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState<string | null>(null)

  const addSynthEvent = () =>
    setSynthEvents(prev => [...prev, { event_type: 'action_escalated', payload: '{}' }])
  const removeSynthEvent = (i: number) =>
    setSynthEvents(prev => prev.filter((_, idx) => idx !== i))

  const handleRun = async () => {
    setLoading(true)
    setError(null)
    setSessionId(null)
    try {
      const endpoint = mode === 'what_if' ? '/api/v1/simulation/what-if' : '/api/v1/simulation/replay'
      const body: Record<string, unknown> = { replay_from: from || undefined, replay_to: to || undefined }
      if (mode === 'what_if') {
        body['synthetic_events'] = synthEvents.map(e => ({
          event_type: e.event_type,
          payload:    JSON.parse(e.payload || '{}'),
          inject_at:  e.inject_at,
        }))
      }
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const j = await res.json()
      if (j.data?.session_id) setSessionId(j.data.session_id)
      else if (j.data?.sessionId) setSessionId(j.data.sessionId)
      else if (j.error) setError(j.error)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run simulation')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid #e5e7eb' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>Operational Replay Viewer</div>
        <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>Replay events or run what-if scenarios in isolation</div>
      </div>

      <div style={{ padding: '12px 14px' }}>
        {/* Mode tabs */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 12, border: '1px solid #d1d5db', borderRadius: 6, overflow: 'hidden', width: 'fit-content' }}>
          {(['replay', 'what_if'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)}
              style={{ padding: '5px 14px', fontSize: 12, cursor: 'pointer', border: 'none',
                background: mode === m ? '#2563eb' : '#fff',
                color: mode === m ? '#fff' : '#374151', fontWeight: mode === m ? 600 : 400 }}>
              {m === 'replay' ? '⏮ Replay' : '✦ What-If'}
            </button>
          ))}
        </div>

        {/* Time range */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
          <div>
            <label style={{ fontSize: 10, color: '#6b7280', display: 'block', marginBottom: 3 }}>From</label>
            <input type="datetime-local" value={from} onChange={e => setFrom(e.target.value)}
              style={{ width: '100%', padding: '5px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12 }} />
          </div>
          <div>
            <label style={{ fontSize: 10, color: '#6b7280', display: 'block', marginBottom: 3 }}>To</label>
            <input type="datetime-local" value={to} onChange={e => setTo(e.target.value)}
              style={{ width: '100%', padding: '5px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12 }} />
          </div>
        </div>

        {/* Synthetic events for what-if */}
        {mode === 'what_if' && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
              Synthetic Events
            </div>
            {synthEvents.map((ev, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                <input value={ev.event_type} onChange={e => setSynthEvents(prev => prev.map((x, idx) => idx === i ? { ...x, event_type: e.target.value } : x))}
                  placeholder="event_type" style={{ flex: 1, padding: '4px 6px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 11 }} />
                <input value={ev.payload} onChange={e => setSynthEvents(prev => prev.map((x, idx) => idx === i ? { ...x, payload: e.target.value } : x))}
                  placeholder='{"key":"value"}' style={{ flex: 2, padding: '4px 6px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 11 }} />
                <button onClick={() => removeSynthEvent(i)}
                  style={{ color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14 }}>×</button>
              </div>
            ))}
            <button onClick={addSynthEvent}
              style={{ fontSize: 11, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer' }}>
              + Add Event
            </button>
          </div>
        )}

        {error && <div style={{ marginBottom: 8, fontSize: 12, color: '#dc2626' }}>{error}</div>}

        <button onClick={handleRun} disabled={loading}
          style={{ padding: '7px 18px', borderRadius: 6, background: '#2563eb', color: '#fff',
            border: 'none', fontSize: 12, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer' }}>
          {loading ? 'Starting…' : mode === 'replay' ? '▶ Run Replay' : '▶ Run What-If'}
        </button>
      </div>

      {/* Results */}
      {sessionId && (
        <div style={{ borderTop: '1px solid #e5e7eb' }}>
          <SimulationResultViewer sessionId={sessionId} />
        </div>
      )}
    </div>
  )
}
