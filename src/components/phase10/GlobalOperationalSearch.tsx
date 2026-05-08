// Denver Engineering — Global Operational Search (v10.0.0)
// Cross-entity search: tenants, tickets, incidents, deployments, runs.

import React, { useState, useEffect, useRef } from 'react'

type EntityType = 'tenant' | 'ticket' | 'replay_incident' | 'deployment' | 'gate_run' | 'scan'

interface SearchResult {
  id: string
  entityType: EntityType
  title: string
  subtitle: string
  href?: string
  metadata?: Record<string, string>
}

interface GlobalOperationalSearchProps {
  onResultSelect?: (result: SearchResult) => void
  placeholder?: string
}

const ENTITY_ICONS: Record<EntityType, string> = {
  tenant: '🏢',
  ticket: '🎫',
  replay_incident: '🔄',
  deployment: '🚀',
  gate_run: '🔒',
  scan: '🔍',
}

const ENTITY_COLORS: Record<EntityType, string> = {
  tenant: 'bg-purple-100 text-purple-700',
  ticket: 'bg-blue-100 text-blue-700',
  replay_incident: 'bg-red-100 text-red-700',
  deployment: 'bg-green-100 text-green-700',
  gate_run: 'bg-gray-100 text-gray-700',
  scan: 'bg-indigo-100 text-indigo-700',
}

export function GlobalOperationalSearch({
  onResultSelect,
  placeholder = 'Search tenants, tickets, incidents...',
}: GlobalOperationalSearchProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [focused, setFocused] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    if (query.length < 2) {
      setResults([])
      return
    }
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/phase10/search?q=${encodeURIComponent(query)}&limit=12`)
        if (res.ok) setResults(await res.json())
      } finally {
        setLoading(false)
      }
    }, 200)
    return () => clearTimeout(debounceRef.current)
  }, [query])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex(i => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex(i => Math.max(i - 1, -1))
    } else if (e.key === 'Enter' && results[selectedIndex]) {
      handleSelect(results[selectedIndex])
    } else if (e.key === 'Escape') {
      setFocused(false)
      setQuery('')
    }
  }

  const handleSelect = (result: SearchResult) => {
    onResultSelect?.(result)
    setQuery('')
    setResults([])
    setFocused(false)
  }

  const groupedResults = results.reduce<Record<string, SearchResult[]>>((acc, r) => {
    acc[r.entityType] = acc[r.entityType] ?? []
    acc[r.entityType].push(r)
    return acc
  }, {})

  return (
    <div className="global-operational-search relative">
      <div className="relative">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</div>
        <input
          className="w-full pl-9 pr-4 py-2 border rounded-lg text-sm bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder={placeholder}
          value={query}
          onChange={e => { setQuery(e.target.value); setSelectedIndex(-1) }}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          onKeyDown={handleKeyDown}
        />
        {loading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs">
            Searching...
          </div>
        )}
      </div>

      {focused && (results.length > 0 || (query.length >= 2 && !loading)) && (
        <div className="absolute top-full mt-1 left-0 right-0 bg-white rounded-lg shadow-xl border z-40 max-h-80 overflow-y-auto">
          {results.length === 0 ? (
            <div className="py-4 text-center text-sm text-gray-400">No results for "{query}"</div>
          ) : (
            Object.entries(groupedResults).map(([entityType, groupResults]) => (
              <div key={entityType}>
                <div className="px-3 py-1 text-xs font-medium text-gray-400 uppercase bg-gray-50">
                  {ENTITY_ICONS[entityType as EntityType]} {entityType.replace('_', ' ')}s
                </div>
                {groupResults.map(result => {
                  const globalIdx = results.indexOf(result)
                  return (
                    <button
                      key={result.id}
                      className={`w-full text-left px-3 py-2 flex items-center gap-3 transition-colors ${
                        selectedIndex === globalIdx ? 'bg-blue-50' : 'hover:bg-gray-50'
                      }`}
                      onClick={() => handleSelect(result)}
                    >
                      <span className={`text-xs px-1.5 py-0.5 rounded font-mono ${ENTITY_COLORS[result.entityType]}`}>
                        {result.entityType.slice(0, 3).toUpperCase()}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-800 truncate">{result.title}</div>
                        <div className="text-xs text-gray-500 truncate">{result.subtitle}</div>
                      </div>
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

export default GlobalOperationalSearch
