// Denver Engineering — Plugin Permission Review (v9.0.0)
// Admin review of plugin permission grants: scopes, tenant installs, kill switch.

import React, { useEffect, useState } from 'react'

interface Plugin {
  id: string
  slug: string
  name: string
  pluginType: string
  author: string
  status: string
  requiredScopes: string[]
  killSwitch: boolean
  currentVersion: string
}

interface _PluginInstall {
  id: string
  tenantId: string
  pluginId: string
  version: string
  grantedScopes: string[]
  isActive: boolean
  installedAt: string
}

export function PluginPermissionReview() {
  const [plugins, setPlugins] = useState<Plugin[]>([])
  const [selectedPlugin, setSelectedPlugin] = useState<Plugin | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [killSwitchLoading, setKillSwitchLoading] = useState<string | null>(null)
  const [killSwitchTriggered, setKillSwitchTriggered] = useState<Set<string>>(new Set())

  useEffect(() => {
    fetch('/api/v1/ecosystem/plugins?status=published')
      .then(r => r.json())
      .then(setPlugins)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  async function handleKillSwitch(pluginId: string) {
    if (!confirm('Trigger kill switch? This will immediately disable this plugin for ALL tenants.')) return
    setKillSwitchLoading(pluginId)
    try {
      await fetch(`/api/v1/ecosystem/plugins/${pluginId}/kill-switch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actor: 'admin' }),
      })
      setKillSwitchTriggered(prev => new Set([...prev, pluginId]))
      setPlugins(prev => prev.map(p => p.id === pluginId ? { ...p, killSwitch: true } : p))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kill switch failed')
    } finally {
      setKillSwitchLoading(null)
    }
  }

  if (loading) return <div className="animate-pulse text-zinc-500 text-sm">Loading plugins…</div>
  if (error) return <div className="text-red-500 text-sm">{error}</div>

  const scopeRiskLevel = (scopes: string[]): 'low' | 'medium' | 'high' => {
    const highRisk = ['*', 'admin', 'write_all', 'delete']
    const medRisk = ['write', 'mutate', 'policy']
    if (scopes.some(s => highRisk.some(h => s.includes(h)))) return 'high'
    if (scopes.some(s => medRisk.some(m => s.includes(m)))) return 'medium'
    return 'low'
  }

  return (
    <div className="grid grid-cols-3 gap-4">
      {/* Plugin list */}
      <div className="col-span-1 space-y-2">
        <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Published Plugins</h3>
        {plugins.length === 0 ? (
          <p className="text-zinc-500 text-sm">No published plugins</p>
        ) : (
          plugins.map(plugin => {
            const risk = scopeRiskLevel(plugin.requiredScopes)
            return (
              <button
                key={plugin.id}
                onClick={() => setSelectedPlugin(plugin)}
                className={`w-full text-left p-3 rounded-lg border transition-colors ${
                  selectedPlugin?.id === plugin.id
                    ? 'bg-zinc-700 border-blue-500'
                    : 'bg-zinc-800 border-zinc-700 hover:border-zinc-500'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-white truncate">{plugin.name}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                    risk === 'high' ? 'bg-red-900/40 text-red-400'
                      : risk === 'medium' ? 'bg-amber-900/40 text-amber-400'
                      : 'bg-emerald-900/40 text-emerald-400'
                  }`}>
                    {risk}
                  </span>
                </div>
                <p className="text-xs text-zinc-500 mt-0.5">{plugin.pluginType}</p>
                {(plugin.killSwitch || killSwitchTriggered.has(plugin.id)) && (
                  <p className="text-xs text-red-500 mt-1">⚠ Kill switch active</p>
                )}
              </button>
            )
          })
        )}
      </div>

      {/* Plugin detail */}
      <div className="col-span-2">
        {selectedPlugin == null ? (
          <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
            Select a plugin to review permissions
          </div>
        ) : (
          <div className="bg-zinc-800 rounded-lg border border-zinc-700 p-4 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-base font-semibold text-white">{selectedPlugin.name}</h3>
                <p className="text-xs text-zinc-400">
                  by {selectedPlugin.author} · v{selectedPlugin.currentVersion} · {selectedPlugin.pluginType}
                </p>
              </div>
              <button
                onClick={() => handleKillSwitch(selectedPlugin.id)}
                disabled={
                  killSwitchLoading === selectedPlugin.id ||
                  selectedPlugin.killSwitch ||
                  killSwitchTriggered.has(selectedPlugin.id)
                }
                className="px-3 py-1.5 rounded text-xs font-medium bg-red-900/40 text-red-400 border border-red-800 hover:bg-red-900/60 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {killSwitchLoading === selectedPlugin.id ? 'Activating…'
                  : (selectedPlugin.killSwitch || killSwitchTriggered.has(selectedPlugin.id)) ? 'Kill Switch Active'
                  : '🔴 Trigger Kill Switch'}
              </button>
            </div>

            {/* Required scopes */}
            <div>
              <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
                Required Scopes ({selectedPlugin.requiredScopes.length})
              </h4>
              {selectedPlugin.requiredScopes.length === 0 ? (
                <p className="text-xs text-zinc-500">No scopes declared</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {selectedPlugin.requiredScopes.map(scope => {
                    const isHigh = ['*', 'admin', 'write_all'].some(h => scope.includes(h))
                    return (
                      <span
                        key={scope}
                        className={`text-xs px-2 py-1 rounded-full font-mono ${
                          isHigh
                            ? 'bg-red-900/40 text-red-400 border border-red-800'
                            : 'bg-zinc-700 text-zinc-300 border border-zinc-600'
                        }`}
                      >
                        {scope}
                        {isHigh && ' ⚠'}
                      </span>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Slug / metadata */}
            <div className="text-xs text-zinc-500 font-mono bg-zinc-900 rounded p-2">
              slug: {selectedPlugin.slug}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
