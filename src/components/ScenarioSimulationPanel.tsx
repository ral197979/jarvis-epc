// Denver Engineering — Scenario Simulation Panel (v6.0.0)
// What-if simulation builder with event injection and result visualization.

import React, { useState, useCallback } from 'react'

interface ScenarioEvent {
  eventType: string
  targetEntityId: string
  payload: Record<string, unknown>
  offsetDays: number
}

interface ScenarioResult {
  readinessDelta: number
  slaBreachCount: number
  estimatedDelayDays: number
  resourceConflicts: number
  mitigationRecommendations: string[]
  bottlenecks: string[]
}

interface Scenario {
  id: string
  name: string
  scenarioType: string
  status: string
  results?: ScenarioResult
  projectedReadinessImpact?: number
  projectedSlaImpact?: number
  confidenceScore?: number
  createdAt: string
  completedAt?: string
}

const EVENT_TYPES = [
  'readiness_drop',
  'risk_spike',
  'resource_reduction',
  'blocker_injection',
] as const

function EventRow({ event, onRemove }: { event: ScenarioEvent; onRemove: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-zinc-800/60 border border-zinc-700 px-3 py-2">
      <span className="text-xs text-violet-400 font-mono">{event.eventType}</span>
      <span className="text-xs text-zinc-400 truncate flex-1">{event.targetEntityId || 'portfolio'}</span>
      <span className="text-xs text-zinc-500">+{event.offsetDays}d</span>
      <button onClick={onRemove} className="text-zinc-600 hover:text-red-400 text-xs">✕</button>
    </div>
  )
}

function ResultsPanel({ results, scenario: _scenario }: { results: ScenarioResult; scenario: Scenario }) {
  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-800/40 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-zinc-300">Simulation Results</span>
        <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400">completed</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {[
          {
            label: 'Readiness Delta',
            value: `${results.readinessDelta >= 0 ? '+' : ''}${results.readinessDelta.toFixed(1)}%`,
            color: results.readinessDelta >= 0 ? 'text-emerald-400' : 'text-red-400',
          },
          {
            label: 'SLA Breaches',
            value: results.slaBreachCount,
            color: results.slaBreachCount > 0 ? 'text-amber-400' : 'text-emerald-400',
          },
          {
            label: 'Est. Delay',
            value: `${results.estimatedDelayDays}d`,
            color: results.estimatedDelayDays > 0 ? 'text-amber-400' : 'text-zinc-300',
          },
          {
            label: 'Conflicts',
            value: results.resourceConflicts,
            color: results.resourceConflicts > 0 ? 'text-orange-400' : 'text-zinc-300',
          },
        ].map(s => (
          <div key={s.label} className="rounded-lg bg-zinc-800 border border-zinc-700 p-2 text-center">
            <div className={`text-xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-[10px] text-zinc-500 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>
      {results.mitigationRecommendations.length > 0 && (
        <div>
          <div className="text-xs text-zinc-400 mb-1">Mitigations</div>
          <ul className="space-y-1">
            {results.mitigationRecommendations.map((r, i) => (
              <li key={i} className="text-xs text-zinc-300 flex gap-1.5">
                <span className="text-violet-400">›</span> {r}
              </li>
            ))}
          </ul>
        </div>
      )}
      {results.bottlenecks.length > 0 && (
        <div>
          <div className="text-xs text-zinc-400 mb-1">Bottlenecks ({results.bottlenecks.length})</div>
          <div className="flex flex-wrap gap-1">
            {results.bottlenecks.map((b, i) => (
              <span key={i} className="text-[10px] bg-red-500/20 text-red-300 px-1.5 py-0.5 rounded font-mono">
                {b.slice(0, 12)}…
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function ScenarioSimulationPanel() {
  const [name, setName] = useState('')
  const [scenarioType, setScenarioType] = useState('resource_shock')
  const [events, setEvents] = useState<ScenarioEvent[]>([])
  const [newEvent, setNewEvent] = useState<Partial<ScenarioEvent>>({
    eventType: 'readiness_drop',
    targetEntityId: '',
    offsetDays: 7,
    payload: { amount: 15 },
  })
  const [scenario, setScenario] = useState<Scenario | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const addEvent = useCallback(() => {
    if (!newEvent.eventType) return
    setEvents(prev => [...prev, {
      eventType: newEvent.eventType!,
      targetEntityId: newEvent.targetEntityId ?? '',
      offsetDays: newEvent.offsetDays ?? 7,
      payload: newEvent.payload ?? {},
    }])
  }, [newEvent])

  const run = useCallback(async () => {
    if (!name || events.length === 0) return
    setLoading(true)
    setError(null)
    try {
      const createRes = await fetch('/api/v1/scenarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, scenarioType, config: { horizonDays: 30 }, injectedEvents: events }),
      })
      const created = await createRes.json() as Scenario
      setScenario(created)

      const runRes = await fetch(`/api/v1/scenarios/${created.id}/run`, { method: 'POST' })
      const completed = await runRes.json() as Scenario
      setScenario(completed)
    } catch (e) {
      setError((e as Error).message)
    }
    setLoading(false)
  }, [name, scenarioType, events])

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Scenario name"
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-violet-500"
        />
        <select
          value={scenarioType}
          onChange={e => setScenarioType(e.target.value)}
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white"
        >
          {['resource_shock', 'delay_cascade', 'vendor_failure', 'weather_disruption', 'scope_change'].map(t => (
            <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
          ))}
        </select>
      </div>

      {/* Event builder */}
      <div className="rounded-lg border border-zinc-700 bg-zinc-800/40 p-3 space-y-2">
        <div className="text-xs font-medium text-zinc-300">Add Event</div>
        <div className="grid grid-cols-2 gap-2">
          <select
            value={newEvent.eventType}
            onChange={e => setNewEvent(p => ({ ...p, eventType: e.target.value }))}
            className="bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-white col-span-2"
          >
            {EVENT_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
          </select>
          <input
            type="text"
            value={newEvent.targetEntityId}
            onChange={e => setNewEvent(p => ({ ...p, targetEntityId: e.target.value }))}
            placeholder="Target entity ID"
            className="bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-white"
          />
          <div className="flex gap-1 items-center">
            <span className="text-xs text-zinc-500">+</span>
            <input
              type="number"
              value={newEvent.offsetDays}
              onChange={e => setNewEvent(p => ({ ...p, offsetDays: Number(e.target.value) }))}
              className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-white"
            />
            <span className="text-xs text-zinc-500">days</span>
          </div>
        </div>
        <button
          onClick={addEvent}
          className="w-full py-1.5 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-xs text-white transition-colors"
        >
          + Add Event
        </button>
      </div>

      {/* Event list */}
      {events.length > 0 && (
        <div className="space-y-1.5">
          {events.map((e, i) => (
            <EventRow key={i} event={e} onRemove={() => setEvents(prev => prev.filter((_, j) => j !== i))} />
          ))}
        </div>
      )}

      {error && (
        <div className="text-sm text-red-400 bg-red-900/20 border border-red-700/30 rounded-lg p-3">{error}</div>
      )}

      <button
        onClick={run}
        disabled={!name || events.length === 0 || loading}
        className="w-full py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-sm text-white font-medium transition-colors"
      >
        {loading ? 'Running Simulation…' : 'Run Scenario'}
      </button>

      {scenario?.results && (
        <ResultsPanel results={scenario.results} scenario={scenario} />
      )}
    </div>
  )
}
