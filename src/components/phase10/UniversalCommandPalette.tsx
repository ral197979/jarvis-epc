// Denver Engineering — Universal Command Palette (v10.0.0)
// Keyboard-driven command palette for operators: search, navigate, act.

import React, { useState, useEffect, useRef, useCallback } from 'react'

interface Command {
  id: string
  label: string
  description?: string
  icon?: string
  category: string
  action: () => void
  keywords?: string[]
}

interface UniversalCommandPaletteProps {
  commands?: Command[]
  onClose?: () => void
  isOpen: boolean
}

export function UniversalCommandPalette({
  commands = [],
  onClose,
  isOpen,
}: UniversalCommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const filtered = query.trim() === ''
    ? commands.slice(0, 8)
    : commands.filter(cmd => {
        const q = query.toLowerCase()
        return (
          cmd.label.toLowerCase().includes(q) ||
          cmd.category.toLowerCase().includes(q) ||
          cmd.description?.toLowerCase().includes(q) ||
          cmd.keywords?.some(k => k.toLowerCase().includes(q))
        )
      }).slice(0, 10)

  useEffect(() => {
    if (isOpen) {
      setQuery('')
      setSelectedIndex(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [isOpen])

  useEffect(() => { setSelectedIndex(0) }, [query])

  const executeCommand = useCallback((cmd: Command) => {
    cmd.action()
    onClose?.()
  }, [onClose])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex(i => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && filtered[selectedIndex]) {
      executeCommand(filtered[selectedIndex])
    } else if (e.key === 'Escape') {
      onClose?.()
    }
  }

  if (!isOpen) return null

  const categories = [...new Set(filtered.map(c => c.category))]

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 px-4">
      <div
        className="fixed inset-0 bg-black/40"
        onClick={onClose}
      />
      <div className="relative w-full max-w-xl bg-white rounded-xl shadow-2xl overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b">
          <span className="text-gray-400">⌘</span>
          <input
            ref={inputRef}
            className="flex-1 text-gray-900 placeholder-gray-400 text-sm outline-none"
            placeholder="Type a command or search..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <span className="text-xs text-gray-400 border rounded px-1.5 py-0.5">ESC</span>
        </div>

        <div ref={listRef} className="max-h-80 overflow-y-auto py-2">
          {filtered.length === 0 ? (
            <div className="text-center py-8 text-gray-400 text-sm">No commands found.</div>
          ) : (
            categories.map(category => (
              <div key={category}>
                <div className="px-4 py-1 text-xs font-medium text-gray-400 uppercase tracking-wide">
                  {category}
                </div>
                {filtered.filter(c => c.category === category).map((cmd, _idx) => {
                  const globalIdx = filtered.indexOf(cmd)
                  return (
                    <button
                      key={cmd.id}
                      className={`w-full text-left px-4 py-2 flex items-center gap-3 transition-colors ${
                        globalIdx === selectedIndex ? 'bg-blue-50' : 'hover:bg-gray-50'
                      }`}
                      onMouseEnter={() => setSelectedIndex(globalIdx)}
                      onClick={() => executeCommand(cmd)}
                    >
                      {cmd.icon && <span className="text-lg">{cmd.icon}</span>}
                      <div className="flex-1">
                        <div className="text-sm font-medium text-gray-800">{cmd.label}</div>
                        {cmd.description && (
                          <div className="text-xs text-gray-500">{cmd.description}</div>
                        )}
                      </div>
                      {globalIdx === selectedIndex && (
                        <span className="text-xs text-gray-400 border rounded px-1">↵</span>
                      )}
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

export function useCommandPalette() {
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setIsOpen(prev => !prev)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  return { isOpen, open: () => setIsOpen(true), close: () => setIsOpen(false) }
}

export default UniversalCommandPalette
