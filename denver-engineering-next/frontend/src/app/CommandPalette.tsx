import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Dialog, DialogContent, Icon } from '@ds'
import { NAV } from './navigation'
import { useUi } from '../lib/store'

/** ⌘K command palette — quick navigation across modules. */
export function CommandPalette() {
  const { commandOpen, setCommandOpen } = useUi()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setCommandOpen(!commandOpen)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [commandOpen, setCommandOpen])

  const results = NAV.filter((n) => n.label.toLowerCase().includes(query.toLowerCase()))

  const go = (path: string) => {
    navigate(path)
    setCommandOpen(false)
    setQuery('')
  }

  return (
    <Dialog open={commandOpen} onOpenChange={setCommandOpen}>
      <DialogContent className="top-[20%] max-w-xl p-0">
        <div className="flex items-center gap-2 border-b border-outline-variant px-4 py-3">
          <Icon name="search" className="text-on-surface-variant" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Jump to module, project, or action…"
            className="flex-1 bg-transparent text-body-md outline-none placeholder:text-on-surface-variant"
          />
          <kbd className="rounded border border-outline-variant px-1.5 py-0.5 font-mono-tag text-label-sm text-on-surface-variant">ESC</kbd>
        </div>
        <ul className="custom-scrollbar max-h-80 overflow-y-auto p-2">
          {results.map((n) => (
            <li key={n.path}>
              <button
                onClick={() => go(n.path)}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-body-sm font-medium text-on-surface hover:bg-surface-container-low"
              >
                <Icon name={n.icon} size={20} className="text-on-surface-variant" />
                {n.label}
                {n.preview && <span className="ml-auto font-mono-tag text-label-sm text-on-surface-variant">preview</span>}
              </button>
            </li>
          ))}
          {results.length === 0 && (
            <li className="px-3 py-6 text-center text-body-sm text-on-surface-variant">No matches.</li>
          )}
        </ul>
      </DialogContent>
    </Dialog>
  )
}
