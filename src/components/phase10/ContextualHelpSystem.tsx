// Denver Engineering — Contextual Help System (v10.0.0)
// In-app help tooltips, guided tours, and documentation links for operators.

import React, { useState, useRef, useEffect } from 'react'

interface HelpArticle {
  id: string
  title: string
  summary: string
  content: string
  tags: string[]
  docUrl?: string
}

interface HelpTooltipProps {
  articleId: string
  children: React.ReactNode
  position?: 'top' | 'bottom' | 'left' | 'right'
}

interface ContextualHelpPanelProps {
  context: string
  onClose?: () => void
}

const HELP_ARTICLES: Record<string, HelpArticle> = {
  'replay-divergence': {
    id: 'replay-divergence',
    title: 'Replay Divergence',
    summary: 'When two replays of the same event stream produce different results.',
    content: 'Replay divergence occurs when event handlers contain non-deterministic logic (e.g., Math.random(), Date.now(), external API calls). Zero divergence is the accepted tolerance in production.',
    tags: ['replay', 'determinism', 'incidents'],
    docUrl: '/docs/REPLAY_INTEGRITY_AUDIT',
  },
  'slo-breach': {
    id: 'slo-breach',
    title: 'SLO Breach',
    summary: 'The platform dropped below the 99.9% uptime target.',
    content: 'An SLO breach means the current uptime percentage is below the 99.9% target. Check the SLA Compliance Panel for active violations and their root causes.',
    tags: ['reliability', 'uptime', 'slo'],
  },
  'production-gate': {
    id: 'production-gate',
    title: 'Production Gate',
    summary: 'A pre-deployment check that must pass before releasing to production.',
    content: 'Production gates verify queue health, tenant isolation, billing correctness, and more. 90% of gates must pass for an overall pass status.',
    tags: ['gates', 'deployment', 'checks'],
  },
  'governance-fail': {
    id: 'governance-fail',
    title: 'Governance Failure',
    summary: 'A governance control is non-compliant.',
    content: 'Governance failures indicate a required control is not met. Common causes: missing audit log events, insufficient RLS policies, or no model card for an AI model.',
    tags: ['governance', 'compliance', 'ai'],
  },
}

export function HelpTooltip({ articleId, children, position = 'top' }: HelpTooltipProps) {
  const [visible, setVisible] = useState(false)
  const article = HELP_ARTICLES[articleId]

  if (!article) return <>{children}</>

  const positionClasses: Record<string, string> = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  }

  return (
    <span className="relative inline-block">
      <span
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        className="cursor-help"
      >
        {children}
      </span>
      {visible && (
        <div className={`absolute z-50 w-64 p-3 bg-gray-900 text-white rounded-lg shadow-xl text-sm ${positionClasses[position]}`}>
          <div className="font-semibold mb-1">{article.title}</div>
          <div className="text-gray-300 text-xs leading-relaxed">{article.summary}</div>
          {article.docUrl && (
            <a href={article.docUrl} className="text-blue-300 text-xs mt-1 block hover:underline">
              Read docs →
            </a>
          )}
        </div>
      )}
    </span>
  )
}

export function ContextualHelpPanel({ context, onClose }: ContextualHelpPanelProps) {
  const [search, setSearch] = useState('')

  const relevant = Object.values(HELP_ARTICLES).filter(a =>
    a.tags.some(t => context.toLowerCase().includes(t)) ||
    a.title.toLowerCase().includes(search.toLowerCase()) ||
    a.summary.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="contextual-help-panel w-80 bg-white rounded-xl shadow-xl border overflow-hidden">
      <div className="flex justify-between items-center px-4 py-3 border-b bg-gray-50">
        <div className="font-semibold text-gray-800">Help</div>
        {onClose && (
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        )}
      </div>

      <div className="p-3">
        <input
          className="w-full border rounded px-3 py-1.5 text-sm"
          placeholder="Search help..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      <div className="overflow-y-auto max-h-80 px-3 pb-3 space-y-2">
        {relevant.length === 0 ? (
          <div className="text-sm text-gray-400 text-center py-4">No articles found.</div>
        ) : (
          relevant.map(article => (
            <div key={article.id} className="p-3 border rounded-lg hover:bg-gray-50">
              <div className="font-medium text-sm text-gray-800 mb-1">{article.title}</div>
              <p className="text-xs text-gray-500 leading-relaxed">{article.content}</p>
              {article.docUrl && (
                <a href={article.docUrl} className="text-xs text-blue-600 mt-1 block hover:underline">
                  Full documentation →
                </a>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export function HelpButton({ context }: { context: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        className="w-6 h-6 rounded-full bg-gray-200 text-gray-600 text-xs font-bold hover:bg-gray-300"
        onClick={() => setOpen(prev => !prev)}
        title="Help"
      >
        ?
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-50">
          <ContextualHelpPanel context={context} onClose={() => setOpen(false)} />
        </div>
      )}
    </div>
  )
}

export default ContextualHelpPanel
