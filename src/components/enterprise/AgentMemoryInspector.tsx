// Denver Engineering — AgentMemoryInspector (v5.0.0)
// Inspect and manage the agent memory store for a tenant.

import React, { useState, useEffect } from 'react'

interface MemoryEntry {
  id: string
  agentType?: string
  scopeType: string
  scopeId?: string
  memoryType: 'fact' | 'pattern' | 'preference' | 'outcome'
  key: string
  value: Record<string, unknown>
  confidence?: number
  timesAccessed: number
  lastAccessed?: string
  expiresAt?: string
  createdAt: string
}

interface Props {
  tenantId: string
}

const MEMORY_TYPE_CONFIG = {
  fact:       { color: '#3b82f6', bg: '#eff6ff', label: 'Fact' },
  pattern:    { color: '#8b5cf6', bg: '#f5f3ff', label: 'Pattern' },
  preference: { color: '#f59e0b', bg: '#fffbeb', label: 'Preference' },
  outcome:    { color: '#22c55e', bg: '#f0fdf4', label: 'Outcome' },
}

export function AgentMemoryInspector({ tenantId }: Props) {
  const [entries, setEntries] = useState<MemoryEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [filterAgent, setFilterAgent] = useState('')
  const [filterType, setFilterType] = useState('')
  const [filterScope, setFilterScope] = useState('')
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => { void loadEntries() }, [tenantId, filterAgent, filterType, filterScope])

  async function loadEntries() {
    setLoading(true)
    try {
      const params = new URLSearchParams({ tenantId })
      if (filterAgent) params.set('agentType', filterAgent)
      if (filterType) params.set('memoryType', filterType)
      if (filterScope) params.set('scopeType', filterScope)
      const res = await fetch(`/api/v1/agents/memory?${params.toString()}`)
      const data = await res.json() as { entries: MemoryEntry[] }
      setEntries(data.entries ?? [])
    } finally {
      setLoading(false)
    }
  }

  async function handleForget(entry: MemoryEntry) {
    if (!entry.agentType) return
    await fetch(`/api/v1/agents/memory/${entry.agentType}/${entry.scopeType}/${entry.scopeId ?? '-'}/${entry.key}?tenantId=${tenantId}`, {
      method: 'DELETE',
    })
    setEntries(prev => prev.filter(e => e.id !== entry.id))
  }

  const filtered = entries.filter(e =>
    !search || e.key.toLowerCase().includes(search.toLowerCase()) ||
    JSON.stringify(e.value).toLowerCase().includes(search.toLowerCase())
  )

  const agentTypes = [...new Set(entries.map(e => e.agentType).filter(Boolean))] as string[]

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>Agent Memory Inspector</h3>
        <div style={{ color: '#6b7280', fontSize: '13px' }}>{entries.length} entries</div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <input
          placeholder="Search keys / values…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ padding: '7px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', flex: 1, minWidth: '160px' }}
        />
        <select
          value={filterAgent}
          onChange={e => setFilterAgent(e.target.value)}
          style={{ padding: '7px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px' }}
        >
          <option value="">All agents</option>
          {agentTypes.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select
          value={filterType}
          onChange={e => setFilterType(e.target.value)}
          style={{ padding: '7px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px' }}
        >
          <option value="">All types</option>
          <option value="fact">Fact</option>
          <option value="pattern">Pattern</option>
          <option value="preference">Preference</option>
          <option value="outcome">Outcome</option>
        </select>
        <select
          value={filterScope}
          onChange={e => setFilterScope(e.target.value)}
          style={{ padding: '7px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px' }}
        >
          <option value="">All scopes</option>
          <option value="project">Project</option>
          <option value="workflow">Workflow</option>
          <option value="action">Action</option>
          <option value="global">Global</option>
        </select>
        <button
          onClick={() => void loadEntries()}
          style={{ padding: '7px 14px', border: '1px solid #d1d5db', background: '#fff', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}
        >
          ↺
        </button>
      </div>

      {/* Entries */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '32px', color: '#9ca3af' }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '32px', color: '#9ca3af' }}>No memory entries found</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {filtered.map(entry => {
            const typeConfig = MEMORY_TYPE_CONFIG[entry.memoryType]
            const isExpanded = expandedId === entry.id
            const isExpiring = entry.expiresAt && new Date(entry.expiresAt) < new Date(Date.now() + 3600000)

            return (
              <div key={entry.id} style={{
                border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden',
                background: isExpiring ? '#fffbeb' : '#fff',
              }}>
                <div
                  onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                  style={{ padding: '12px 16px', cursor: 'pointer', display: 'flex', gap: '10px', alignItems: 'center' }}
                >
                  <span style={{
                    padding: '2px 7px', borderRadius: '4px', fontSize: '11px', fontWeight: 700,
                    background: typeConfig.bg, color: typeConfig.color,
                  }}>
                    {typeConfig.label}
                  </span>
                  <span style={{ fontFamily: 'monospace', fontSize: '13px', fontWeight: 600, flex: 1 }}>{entry.key}</span>
                  {entry.agentType && (
                    <span style={{ fontSize: '12px', color: '#6b7280' }}>{entry.agentType}</span>
                  )}
                  {entry.confidence != null && (
                    <span style={{ fontSize: '12px', color: '#9ca3af' }}>{entry.confidence}%</span>
                  )}
                  <span style={{ fontSize: '12px', color: '#9ca3af' }}>×{entry.timesAccessed}</span>
                  <span style={{ fontSize: '14px', color: '#9ca3af' }}>{isExpanded ? '▲' : '▼'}</span>
                </div>

                {isExpanded && (
                  <div style={{ borderTop: '1px solid #f1f5f9', padding: '12px 16px', background: '#f8fafc' }}>
                    <pre style={{ margin: 0, fontSize: '12px', overflow: 'auto', color: '#374151' }}>
                      {JSON.stringify(entry.value, null, 2)}
                    </pre>
                    <div style={{ marginTop: '10px', display: 'flex', gap: '16px', fontSize: '12px', color: '#9ca3af' }}>
                      <span>Scope: {entry.scopeType}{entry.scopeId ? ` / ${entry.scopeId.slice(0, 8)}` : ''}</span>
                      {entry.lastAccessed && <span>Last: {new Date(entry.lastAccessed).toLocaleString()}</span>}
                      {entry.expiresAt && <span>Expires: {new Date(entry.expiresAt).toLocaleString()}</span>}
                    </div>
                    {entry.agentType && (
                      <button
                        onClick={() => void handleForget(entry)}
                        style={{
                          marginTop: '10px', padding: '5px 12px', background: '#fef2f2',
                          border: '1px solid #fca5a5', color: '#ef4444', borderRadius: '6px',
                          cursor: 'pointer', fontSize: '12px',
                        }}
                      >
                        Forget this entry
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
