// Denver Engineering — Operational Search Assistant (Phase 11)
// Cross-entity search across tenants, incidents, imports, deployments, and partners

import React, { useState, useEffect, useRef } from 'react'

interface SearchResult {
  id: string
  entityType: 'tenant' | 'incident' | 'import' | 'deployment' | 'partner' | 'cluster'
  title: string
  subtitle: string
  status?: string
  url?: string
}

const ENTITY_COLORS: Record<string, string> = {
  tenant: '#3b82f6',
  incident: '#ef4444',
  import: '#8b5cf6',
  deployment: '#22c55e',
  partner: '#06b6d4',
  cluster: '#f59e0b',
}

const ENTITY_ICONS: Record<string, string> = {
  tenant: '🏢',
  incident: '🔴',
  import: '📥',
  deployment: '🚀',
  partner: '🤝',
  cluster: '⚡',
}

interface OperationalSearchAssistantProps {
  onNavigate?: (result: SearchResult) => void
}

export function OperationalSearchAssistant({ onNavigate }: OperationalSearchAssistantProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [focused, setFocused] = useState(false)
  const [selectedIdx, setSelectedIdx] = useState(-1)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!query.trim() || query.length < 2) {
      setResults([])
      return
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/phase11/search?q=${encodeURIComponent(query)}`)
        const data = await res.json()
        setResults(data.results ?? [])
        setSelectedIdx(-1)
      } finally {
        setLoading(false)
      }
    }, 200)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIdx(i => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIdx(i => Math.max(i - 1, -1))
    } else if (e.key === 'Enter' && selectedIdx >= 0) {
      handleSelect(results[selectedIdx])
    } else if (e.key === 'Escape') {
      setFocused(false)
      inputRef.current?.blur()
    }
  }

  const handleSelect = (result: SearchResult) => {
    setQuery('')
    setResults([])
    setFocused(false)
    onNavigate?.(result)
  }

  const groupedResults = results.reduce<Record<string, SearchResult[]>>((acc, r) => {
    if (!acc[r.entityType]) acc[r.entityType] = []
    acc[r.entityType].push(r)
    return acc
  }, {})

  const showDropdown = focused && (query.length >= 2)

  return (
    <div style={{ position: 'relative', width: '100%', maxWidth: 480 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        background: '#1e293b', border: `1px solid ${focused ? '#3b82f6' : '#334155'}`,
        borderRadius: 8, padding: '8px 14px',
      }}>
        <span style={{ color: '#64748b', fontSize: 14 }}>🔍</span>
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          onKeyDown={handleKeyDown}
          placeholder="Search tenants, incidents, deployments…"
          style={{
            flex: 1, background: 'transparent', border: 'none', outline: 'none',
            color: '#e2e8f0', fontSize: 13,
          }}
        />
        {loading && <span style={{ color: '#64748b', fontSize: 12 }}>…</span>}
        {query && !loading && (
          <button
            onClick={() => setQuery('')}
            style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 14 }}
          >
            ×
          </button>
        )}
      </div>

      {showDropdown && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0,
          background: '#1e293b', border: '1px solid #334155', borderRadius: 8,
          boxShadow: '0 8px 32px rgba(0,0,0,0.6)', zIndex: 1000, overflow: 'hidden',
          maxHeight: 400, overflowY: 'auto',
        }}>
          {results.length === 0 && !loading && query.length >= 2 && (
            <div style={{ padding: 16, textAlign: 'center', color: '#64748b', fontSize: 13 }}>
              No results for "{query}"
            </div>
          )}

          {Object.entries(groupedResults).map(([entityType, items]) => (
            <div key={entityType}>
              <div style={{
                padding: '8px 14px 4px', fontSize: 10, fontWeight: 700,
                color: ENTITY_COLORS[entityType] ?? '#64748b', textTransform: 'uppercase',
                letterSpacing: '0.08em',
              }}>
                {ENTITY_ICONS[entityType]} {entityType}s
              </div>
              {items.map((result, globalIdx) => {
                const overallIdx = results.indexOf(result)
                const isSelected = overallIdx === selectedIdx
                return (
                  <div
                    key={result.id}
                    onClick={() => handleSelect(result)}
                    onMouseEnter={() => setSelectedIdx(overallIdx)}
                    style={{
                      padding: '10px 14px', cursor: 'pointer',
                      background: isSelected ? '#334155' : 'transparent',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>{result.title}</div>
                      <div style={{ fontSize: 11, color: '#64748b' }}>{result.subtitle}</div>
                    </div>
                    {result.status && (
                      <span style={{ fontSize: 10, color: '#94a3b8', border: '1px solid #334155', borderRadius: 4, padding: '1px 6px' }}>
                        {result.status}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
