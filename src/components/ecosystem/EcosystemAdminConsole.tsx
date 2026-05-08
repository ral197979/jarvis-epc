// Denver Engineering — Ecosystem Admin Console (Phase 9)
// Tabbed admin overview: Federated Intelligence, Marketplace, Plugins, External Agents.

import React, { useState, useEffect } from 'react'

// ── Federated Intelligence ─────────────────────────────────────────────────

interface FederatedPattern {
  id: string
  name: string
  contributorCount: number
  kAnonymityStatus: 'met' | 'not_met' | 'pending'
  recordCount: number
}

// ── Marketplace ────────────────────────────────────────────────────────────

interface Playbook {
  id: string
  name: string
  type: string
  installCount: number
  avgRating: number | null
  author: string
}

// ── Plugins ────────────────────────────────────────────────────────────────

interface Plugin {
  id: string
  name: string
  version: string
  author: string
  installCount: number
  killSwitchActive: boolean
}

// ── External Agents ────────────────────────────────────────────────────────

interface ExternalAgent {
  id: string
  name: string
  type: string
  status: 'active' | 'inactive' | 'suspended'
  lastContact: string
}

// ── Tabs ───────────────────────────────────────────────────────────────────

type Tab = 'federated' | 'marketplace' | 'plugins' | 'agents'

const TABS: { id: Tab; label: string }[] = [
  { id: 'federated', label: 'Federated Intelligence' },
  { id: 'marketplace', label: 'Marketplace' },
  { id: 'plugins', label: 'Plugins' },
  { id: 'agents', label: 'External Agents' },
]

const K_ANONYMITY_STYLES: Record<FederatedPattern['kAnonymityStatus'], string> = {
  met: 'bg-emerald-700 text-emerald-100',
  not_met: 'bg-red-700 text-red-100',
  pending: 'bg-amber-700 text-amber-100',
}

const K_ANONYMITY_LABELS: Record<FederatedPattern['kAnonymityStatus'], string> = {
  met: 'k-anon met',
  not_met: 'k-anon not met',
  pending: 'pending',
}

const AGENT_STATUS_STYLES: Record<ExternalAgent['status'], string> = {
  active: 'bg-emerald-700 text-emerald-100',
  inactive: 'bg-zinc-700 text-zinc-300',
  suspended: 'bg-red-700 text-red-100',
}

// ── Skeleton ───────────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      {[1, 2, 3].map(i => (
        <div key={i} className="h-14 bg-zinc-800 rounded" />
      ))}
    </div>
  )
}

// ── Sub-panels ─────────────────────────────────────────────────────────────

function FederatedPanel() {
  const [patterns, setPatterns] = useState<FederatedPattern[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/v1/ecosystem/federated/patterns')
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((data: FederatedPattern[]) => setPatterns(data))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <Skeleton />
  if (error != null) return <p className="text-red-400 text-sm border border-red-800 rounded p-3">{error}</p>

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <div className="border border-zinc-700 rounded-lg p-3 bg-zinc-800/40 text-center">
          <p className="text-2xl font-bold text-zinc-100">{patterns.length}</p>
          <p className="text-xs text-zinc-400 mt-0.5">Active Patterns</p>
        </div>
        <div className="border border-emerald-800 rounded-lg p-3 bg-emerald-900/10 text-center">
          <p className="text-2xl font-bold text-emerald-400">
            {patterns.filter(p => p.kAnonymityStatus === 'met').length}
          </p>
          <p className="text-xs text-zinc-400 mt-0.5">k-Anon Met</p>
        </div>
        <div className="border border-red-800 rounded-lg p-3 bg-red-900/10 text-center">
          <p className="text-2xl font-bold text-red-400">
            {patterns.filter(p => p.kAnonymityStatus === 'not_met').length}
          </p>
          <p className="text-xs text-zinc-400 mt-0.5">k-Anon Violations</p>
        </div>
      </div>

      {patterns.length === 0 ? (
        <p className="text-zinc-500 text-sm">No active patterns.</p>
      ) : (
        <div className="space-y-2">
          {patterns.map(p => (
            <div key={p.id} className="border border-zinc-700 rounded-lg p-3 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-zinc-100 truncate">{p.name}</p>
                <p className="text-xs text-zinc-500 mt-0.5">
                  {p.contributorCount} contributors · {p.recordCount.toLocaleString()} records
                </p>
              </div>
              <span className={`shrink-0 text-xs font-medium rounded-full px-2 py-0.5 ${K_ANONYMITY_STYLES[p.kAnonymityStatus]}`}>
                {K_ANONYMITY_LABELS[p.kAnonymityStatus]}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function MarketplacePanel() {
  const [playbooks, setPlaybooks] = useState<Playbook[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/v1/ecosystem/marketplace/playbooks?status=published')
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((data: Playbook[]) => setPlaybooks(data))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <Skeleton />
  if (error != null) return <p className="text-red-400 text-sm border border-red-800 rounded p-3">{error}</p>

  return (
    <div className="space-y-2">
      {playbooks.length === 0 ? (
        <p className="text-zinc-500 text-sm">No published playbooks.</p>
      ) : (
        playbooks.map(pb => (
          <div key={pb.id} className="border border-zinc-700 rounded-lg p-3 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-zinc-100 truncate">{pb.name}</p>
              <p className="text-xs text-zinc-500 mt-0.5">
                {pb.type} · by {pb.author}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-sm text-zinc-300 font-medium">{pb.installCount.toLocaleString()} installs</p>
              <p className="text-xs text-amber-400">
                {pb.avgRating != null ? `★ ${pb.avgRating.toFixed(1)}` : 'No rating'}
              </p>
            </div>
          </div>
        ))
      )}
    </div>
  )
}

function PluginsPanel() {
  const [plugins, setPlugins] = useState<Plugin[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toggling, setToggling] = useState<string | null>(null)
  const [toggleError, setToggleError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/v1/ecosystem/plugins?status=published')
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((data: Plugin[]) => setPlugins(data))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  function handleKillSwitch(plugin: Plugin) {
    const action = plugin.killSwitchActive ? 'disable' : 'enable'
    setToggling(plugin.id)
    setToggleError(null)
    fetch(`/api/v1/ecosystem/plugins/${plugin.id}/kill-switch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !plugin.killSwitchActive }),
    })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(() => {
        setPlugins(prev =>
          prev.map(p => p.id === plugin.id ? { ...p, killSwitchActive: !p.killSwitchActive } : p)
        )
      })
      .catch(e => setToggleError(e.message))
      .finally(() => setToggling(null))
  }

  if (loading) return <Skeleton />
  if (error != null) return <p className="text-red-400 text-sm border border-red-800 rounded p-3">{error}</p>

  return (
    <div className="space-y-3">
      {toggleError != null && (
        <p className="text-red-400 text-sm border border-red-800 rounded p-3">{toggleError}</p>
      )}
      {plugins.length === 0 ? (
        <p className="text-zinc-500 text-sm">No published plugins.</p>
      ) : (
        plugins.map(plugin => (
          <div key={plugin.id} className="border border-zinc-700 rounded-lg p-3 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-zinc-100 truncate">{plugin.name}</p>
              <p className="text-xs text-zinc-500 mt-0.5">
                v{plugin.version} · by {plugin.author} · {plugin.installCount.toLocaleString()} installs
              </p>
            </div>
            <button
              onClick={() => handleKillSwitch(plugin)}
              disabled={toggling === plugin.id}
              className={`shrink-0 text-xs font-medium rounded px-3 py-1.5 border transition-colors disabled:opacity-40 ${
                plugin.killSwitchActive
                  ? 'border-red-700 text-red-400 hover:border-red-500 hover:text-red-200'
                  : 'border-zinc-600 text-zinc-400 hover:border-zinc-400 hover:text-zinc-200'
              }`}
            >
              {toggling === plugin.id
                ? 'Updating...'
                : plugin.killSwitchActive
                  ? 'Kill Switch ON — Disable'
                  : 'Kill Switch OFF — Enable'}
            </button>
          </div>
        ))
      )}
    </div>
  )
}

const MOCK_AGENTS: ExternalAgent[] = [
  { id: 'agent-1', name: 'Procore Sync Agent', type: 'integration', status: 'active', lastContact: new Date(Date.now() - 60000).toISOString() },
  { id: 'agent-2', name: 'Safety AI Monitor', type: 'compliance', status: 'active', lastContact: new Date(Date.now() - 300000).toISOString() },
  { id: 'agent-3', name: 'Autodesk BIM Bridge', type: 'bim', status: 'inactive', lastContact: new Date(Date.now() - 86400000).toISOString() },
  { id: 'agent-4', name: 'Schedule Optimizer', type: 'scheduling', status: 'suspended', lastContact: new Date(Date.now() - 3600000).toISOString() },
]

function AgentsPanel() {
  return (
    <div className="space-y-2">
      {MOCK_AGENTS.map(agent => (
        <div key={agent.id} className="border border-zinc-700 rounded-lg p-3 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-zinc-100 truncate">{agent.name}</p>
            <p className="text-xs text-zinc-500 mt-0.5">
              {agent.type} · Last contact: {new Date(agent.lastContact).toLocaleString()}
            </p>
          </div>
          <span className={`shrink-0 text-xs font-medium rounded-full px-2 py-0.5 ${AGENT_STATUS_STYLES[agent.status]}`}>
            {agent.status}
          </span>
        </div>
      ))}
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────

export function EcosystemAdminConsole() {
  const [activeTab, setActiveTab] = useState<Tab>('federated')

  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-zinc-100">Ecosystem Admin Console</h2>
        <p className="text-xs text-zinc-500 mt-0.5">Phase 9 — Platform Governance Overview</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-zinc-700 pb-0">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`text-xs font-medium px-3 py-2 rounded-t border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-sky-500 text-sky-400'
                : 'border-transparent text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'federated' && <FederatedPanel />}
      {activeTab === 'marketplace' && <MarketplacePanel />}
      {activeTab === 'plugins' && <PluginsPanel />}
      {activeTab === 'agents' && <AgentsPanel />}
    </div>
  )
}
