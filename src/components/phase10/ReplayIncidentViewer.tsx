// Denver Engineering — Replay Incident Viewer (v10.0.0)
// Browse, triage, and resolve replay divergence incidents.

import React, { useState, useEffect } from 'react'

interface ReplayIncident {
  id: string
  tenantId: string
  eventStreamId: string
  divergenceHash: string
  replayPassCount: number
  replayFailCount: number
  status: 'open' | 'investigating' | 'resolved'
  rootCause: string | null
  resolution: string | null
  resolvedAt: string | null
  createdAt: string
}

interface ReplayIncidentViewerProps {
  tenantId?: string
  onResolve?: (incidentId: string) => void
}

const ROOT_CAUSE_OPTIONS = [
  { value: 'nondeterministic_code', label: 'Non-deterministic code' },
  { value: 'missing_event', label: 'Missing event in stream' },
  { value: 'schema_mismatch', label: 'Schema mismatch' },
  { value: 'clock_skew', label: 'Clock skew' },
  { value: 'external_dependency', label: 'External dependency' },
  { value: 'unknown', label: 'Unknown' },
]

export function ReplayIncidentViewer({ tenantId, onResolve }: ReplayIncidentViewerProps) {
  const [incidents, setIncidents] = useState<ReplayIncident[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [resolveForm, setResolveForm] = useState<{ rootCause: string; resolution: string }>({
    rootCause: '',
    resolution: '',
  })
  const [loading, setLoading] = useState(true)
  const [resolving, setResolving] = useState(false)

  useEffect(() => {
    const fetchIncidents = async () => {
      try {
        const params = new URLSearchParams({ limit: '50' })
        if (tenantId) params.set('tenantId', tenantId)
        const res = await fetch(`/api/phase10/replay/incidents?${params}`)
        if (res.ok) setIncidents(await res.json())
      } finally {
        setLoading(false)
      }
    }
    void fetchIncidents()
  }, [tenantId])

  const handleResolve = async (incidentId: string) => {
    if (!resolveForm.rootCause || !resolveForm.resolution) return
    setResolving(true)
    try {
      await fetch(`/api/phase10/replay/incidents/${incidentId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(resolveForm),
      })
      setIncidents(prev => prev.map(i =>
        i.id === incidentId
          ? { ...i, status: 'resolved', ...resolveForm, resolvedAt: new Date().toISOString() }
          : i
      ))
      setSelectedId(null)
      onResolve?.(incidentId)
    } finally {
      setResolving(false)
    }
  }

  const openIncidents = incidents.filter(i => i.status !== 'resolved')
  const resolvedIncidents = incidents.filter(i => i.status === 'resolved')
  const selected = incidents.find(i => i.id === selectedId)

  return (
    <div className="replay-incident-viewer p-6 bg-white rounded-lg shadow">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold text-gray-900">Replay Incidents</h2>
        <div className="text-sm text-gray-500">
          <span className="text-red-600 font-medium">{openIncidents.length} open</span>
          {' · '}
          <span>{resolvedIncidents.length} resolved</span>
        </div>
      </div>

      <div className="flex gap-6">
        <div className="flex-1">
          {loading ? (
            <div className="text-gray-400 text-center py-6">Loading incidents...</div>
          ) : incidents.length === 0 ? (
            <div className="text-center py-10 text-gray-400">
              <div className="text-3xl mb-2">✓</div>
              <p>No replay incidents found.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {openIncidents.map(incident => (
                <button
                  key={incident.id}
                  className={`w-full text-left p-3 border rounded-lg transition-colors ${
                    selectedId === incident.id ? 'border-blue-400 bg-blue-50' : 'border-red-200 bg-red-50 hover:bg-red-100'
                  }`}
                  onClick={() => setSelectedId(selectedId === incident.id ? null : incident.id)}
                >
                  <div className="flex justify-between">
                    <div>
                      <div className="font-mono text-xs text-gray-500">{incident.eventStreamId}</div>
                      <div className="text-sm font-medium text-red-800 mt-0.5">
                        {incident.replayFailCount} divergence(s) / {incident.replayPassCount + incident.replayFailCount} replays
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5">
                        {incident.tenantId} · {new Date(incident.createdAt).toLocaleString()}
                      </div>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded h-fit ${
                      incident.status === 'investigating' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'
                    }`}>
                      {incident.status}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {selected && selected.status !== 'resolved' && (
          <div className="w-72 border rounded-lg p-4 bg-gray-50">
            <h3 className="font-semibold text-gray-800 mb-3">Resolve Incident</h3>
            <div className="mb-3">
              <label className="block text-xs text-gray-500 mb-1">Root Cause</label>
              <select
                className="w-full border rounded p-2 text-sm"
                value={resolveForm.rootCause}
                onChange={e => setResolveForm(prev => ({ ...prev, rootCause: e.target.value }))}
              >
                <option value="">Select root cause...</option>
                {ROOT_CAUSE_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div className="mb-3">
              <label className="block text-xs text-gray-500 mb-1">Resolution</label>
              <textarea
                className="w-full border rounded p-2 text-sm h-20"
                placeholder="Describe what was fixed..."
                value={resolveForm.resolution}
                onChange={e => setResolveForm(prev => ({ ...prev, resolution: e.target.value }))}
              />
            </div>
            <button
              className="w-full py-2 bg-green-600 text-white rounded text-sm font-medium hover:bg-green-700 disabled:opacity-50"
              disabled={resolving || !resolveForm.rootCause || !resolveForm.resolution}
              onClick={() => void handleResolve(selected.id)}
            >
              {resolving ? 'Resolving...' : 'Mark Resolved'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default ReplayIncidentViewer
