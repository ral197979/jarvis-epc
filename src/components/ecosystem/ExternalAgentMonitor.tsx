// Denver Engineering — External Agent Monitor (v9.0.0)
// Real-time monitoring of registered external agents: status, executions, approval requirements.

import React, { useEffect, useState } from 'react'

interface ExternalAgent {
  id: string
  name: string
  description: string | null
  status: 'registered' | 'active' | 'suspended' | 'revoked'
  capabilities: string[]
  allowedScopes: string[]
  lastExecutedAt: string | null
  createdAt: string
}

interface AgentExecution {
  id: string
  agentId: string
  tenantId: string
  validationPassed: boolean
  approvalRequired: boolean
  executionMs: number | null
  error: string | null
  createdAt: string
}

const STATUS_COLORS: Record<string, string> = {
  active: 'text-emerald-400 bg-emerald-900/30 border-emerald-800',
  registered: 'text-blue-400 bg-blue-900/30 border-blue-800',
  suspended: 'text-amber-400 bg-amber-900/30 border-amber-800',
  revoked: 'text-zinc-400 bg-zinc-800 border-zinc-600',
}

export function ExternalAgentMonitor() {
  const [agents, setAgents] = useState<ExternalAgent[]>([])
  const [selected, setSelected] = useState<ExternalAgent | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [suspending, setSuspending] = useState<string | null>(null)

  useEffect(() => {
    loadAgents()
  }, [])

  function loadAgents() {
    setLoading(true)
    fetch('/api/v1/ecosystem/external-agents/register')
      .then(r => r.json())
      .then((data) => {
        // API returns list of agents
        const list = Array.isArray(data) ? data : (data.agents ?? [])
        setAgents(list)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }

  async function suspendAgent(agentId: string) {
    setSuspending(agentId)
    try {
      await fetch(`/api/v1/ecosystem/external-agents/${agentId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'suspended' }),
      })
      setAgents(prev => prev.map(a => a.id === agentId ? { ...a, status: 'suspended' } : a))
      if (selected?.id === agentId) {
        setSelected(prev => prev ? { ...prev, status: 'suspended' } : null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Suspend failed')
    } finally {
      setSuspending(null)
    }
  }

  const stats = {
    total: agents.length,
    active: agents.filter(a => a.status === 'active').length,
    suspended: agents.filter(a => a.status === 'suspended').length,
    revoked: agents.filter(a => a.status === 'revoked').length,
  }

  if (loading) return <div className="animate-pulse text-zinc-500 text-sm">Loading agents…</div>
  if (error) return <div className="text-red-500 text-sm">{error}</div>

  return (
    <div className="space-y-4">
      {/* Stats row */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Total Agents', value: stats.total },
          { label: 'Active', value: stats.active, color: 'emerald' },
          { label: 'Suspended', value: stats.suspended, color: 'amber' },
          { label: 'Revoked', value: stats.revoked, color: 'red' },
        ].map(s => (
          <div key={s.label} className="bg-zinc-800 rounded-lg p-3 border border-zinc-700">
            <p className="text-xs text-zinc-400">{s.label}</p>
            <p className={`text-xl font-semibold mt-1 ${
              s.color === 'emerald' ? 'text-emerald-400'
                : s.color === 'amber' ? 'text-amber-400'
                : s.color === 'red' ? 'text-red-400'
                : 'text-white'
            }`}>
              {s.value}
            </p>
          </div>
        ))}
      </div>

      {/* Agent list + detail */}
      <div className="grid grid-cols-2 gap-4">
        {/* List */}
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Registered Agents</h3>
          {agents.length === 0 ? (
            <p className="text-zinc-500 text-sm">No agents registered</p>
          ) : (
            agents.map(agent => (
              <button
                key={agent.id}
                onClick={() => setSelected(agent)}
                className={`w-full text-left p-3 rounded-lg border transition-colors ${
                  selected?.id === agent.id
                    ? 'bg-zinc-700 border-blue-500'
                    : 'bg-zinc-800 border-zinc-700 hover:border-zinc-500'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-white truncate">{agent.name}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${STATUS_COLORS[agent.status]}`}>
                    {agent.status}
                  </span>
                </div>
                <p className="text-xs text-zinc-500 mt-0.5">
                  {agent.capabilities.length} capabilities · {agent.allowedScopes.length} scopes
                </p>
                {agent.lastExecutedAt && (
                  <p className="text-xs text-zinc-600 mt-0.5">
                    Last: {new Date(agent.lastExecutedAt).toLocaleString()}
                  </p>
                )}
              </button>
            ))
          )}
        </div>

        {/* Detail */}
        <div>
          {selected == null ? (
            <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
              Select an agent to inspect
            </div>
          ) : (
            <div className="bg-zinc-800 rounded-lg border border-zinc-700 p-4 space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-base font-semibold text-white">{selected.name}</h3>
                  {selected.description && (
                    <p className="text-xs text-zinc-400 mt-0.5">{selected.description}</p>
                  )}
                </div>
                {selected.status === 'active' && (
                  <button
                    onClick={() => suspendAgent(selected.id)}
                    disabled={suspending === selected.id}
                    className="px-3 py-1.5 rounded text-xs font-medium bg-amber-900/40 text-amber-400 border border-amber-800 hover:bg-amber-900/60 disabled:opacity-50 transition-colors"
                  >
                    {suspending === selected.id ? 'Suspending…' : 'Suspend Agent'}
                  </button>
                )}
              </div>

              {/* Capabilities */}
              <div>
                <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
                  Capabilities
                </h4>
                <div className="flex flex-wrap gap-1">
                  {selected.capabilities.map(cap => (
                    <span key={cap} className="text-xs px-2 py-0.5 rounded bg-zinc-700 text-zinc-300">
                      {cap}
                    </span>
                  ))}
                  {selected.capabilities.length === 0 && (
                    <span className="text-xs text-zinc-500">None declared</span>
                  )}
                </div>
              </div>

              {/* Allowed scopes */}
              <div>
                <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
                  Allowed Scopes
                </h4>
                <div className="flex flex-wrap gap-1">
                  {selected.allowedScopes.map(scope => (
                    <span key={scope} className={`text-xs px-2 py-0.5 rounded font-mono ${
                      scope === '*'
                        ? 'bg-red-900/40 text-red-400 border border-red-800'
                        : 'bg-zinc-700 text-zinc-300'
                    }`}>
                      {scope}
                    </span>
                  ))}
                  {selected.allowedScopes.length === 0 && (
                    <span className="text-xs text-zinc-500">No scopes</span>
                  )}
                </div>
              </div>

              <div className="text-xs text-zinc-500 font-mono bg-zinc-900 rounded p-2">
                id: {selected.id}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
