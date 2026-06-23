// Denver Engineering — Incident Replay Workbench (Phase 12)
// UI for replay-assisted incident investigation and timeline reconstruction

import React, { useState, useEffect } from 'react'

interface ReplaySession {
  id: string
  incidentId: string
  tenantId: string
  eventsReplayed: number
  timelineReconstructed: boolean
  rootCauseIdentified: boolean
  rootCauseSummary: string | null
  replayHash: string
  sessionAt: string
}

interface IncidentReplayWorkbenchProps {
  incidentId: string
  tenantId: string
}

export function IncidentReplayWorkbench({ incidentId, tenantId }: IncidentReplayWorkbenchProps) {
  const [sessions, setSessions] = useState<ReplaySession[]>([])
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)

  const loadSessions = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/phase12/incidents/${incidentId}/replay-sessions`)
      const data = await res.json()
      setSessions(data.sessions ?? [])
    } finally {
      setLoading(false)
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadSessions() }, [incidentId])

  const startSession = async () => {
    setStarting(true)
    try {
      await fetch(`/api/phase12/incidents/${incidentId}/replay-sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId }),
      })
      await loadSessions()
    } finally {
      setStarting(false)
    }
  }

  return (
    <div style={{ background: '#0a0f1e', fontFamily: 'sans-serif', padding: 24, minHeight: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0' }}>🔁 Replay Workbench</div>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>Incident: {incidentId}</div>
        </div>
        <button
          onClick={startSession}
          disabled={starting}
          style={{
            padding: '8px 16px', borderRadius: 6, border: 'none', cursor: 'pointer',
            background: '#3b82f6', color: '#fff', fontSize: 13, fontWeight: 600,
          }}
        >
          {starting ? 'Starting…' : '+ New Replay Session'}
        </button>
      </div>

      {loading ? (
        <div style={{ color: '#64748b', textAlign: 'center', padding: 40 }}>Loading…</div>
      ) : sessions.length === 0 ? (
        <div style={{
          background: '#1e293b', borderRadius: 8, padding: 32, textAlign: 'center', color: '#64748b',
        }}>
          No replay sessions yet. Start one to reconstruct the incident timeline.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {sessions.map(session => (
            <div key={session.id} style={{
              background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: 16,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                    <span style={{
                      fontSize: 10, padding: '2px 6px', borderRadius: 3,
                      background: session.timelineReconstructed ? '#22c55e20' : '#64748b20',
                      color: session.timelineReconstructed ? '#22c55e' : '#64748b',
                    }}>
                      {session.timelineReconstructed ? '✅ Timeline Reconstructed' : '⏳ Partial'}
                    </span>
                    <span style={{
                      fontSize: 10, padding: '2px 6px', borderRadius: 3,
                      background: session.rootCauseIdentified ? '#3b82f620' : '#64748b20',
                      color: session.rootCauseIdentified ? '#3b82f6' : '#64748b',
                    }}>
                      {session.rootCauseIdentified ? '🔍 Root Cause Found' : '🔍 Investigating'}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, color: '#e2e8f0' }}>
                    {session.eventsReplayed} events replayed
                  </div>
                  {session.rootCauseSummary && (
                    <div style={{
                      marginTop: 8, padding: '8px 12px', background: '#3b82f610',
                      border: '1px solid #3b82f630', borderRadius: 6,
                      fontSize: 12, color: '#94a3b8', lineHeight: 1.5,
                    }}>
                      <strong style={{ color: '#3b82f6' }}>Root Cause:</strong> {session.rootCauseSummary}
                    </div>
                  )}
                </div>
                <div style={{ fontSize: 11, color: '#64748b', textAlign: 'right' }}>
                  <div>{new Date(session.sessionAt).toLocaleString()}</div>
                  <div style={{ marginTop: 2, fontFamily: 'monospace', fontSize: 10 }}>
                    {session.replayHash.slice(0, 12)}…
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
