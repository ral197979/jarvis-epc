// Denver Engineering — Contextual Operational Help (Phase 11)
// Context-aware help tooltips and articles for GA operational workflows

import React, { useState, useRef, useEffect } from 'react'

interface HelpArticle {
  id: string
  title: string
  content: string
  tags: string[]
  context: string
}

interface OperationalHelpTooltipProps {
  topic: string
  children: React.ReactNode
}

interface ContextualHelpPanelProps {
  context: string
  onClose?: () => void
}

// ─── Inline Tooltip ───────────────────────────────────────────────────────────

export function OperationalHelpTooltip({ topic, children }: OperationalHelpTooltipProps) {
  const [visible, setVisible] = useState(false)
  const [article, setArticle] = useState<HelpArticle | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showTooltip = async () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/phase11/help/articles?topic=${encodeURIComponent(topic)}&limit=1`)
        const data = await res.json()
        setArticle(data.articles?.[0] ?? null)
        setVisible(true)
      } catch {
        setVisible(true)
      }
    }, 400)
  }

  const hideTooltip = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    setVisible(false)
  }

  return (
    <span
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
    >
      {children}
      {visible && (
        <div style={{
          position: 'absolute', bottom: 'calc(100% + 8px)', left: '50%',
          transform: 'translateX(-50%)', zIndex: 1000,
          background: '#1e293b', border: '1px solid #334155', borderRadius: 8,
          padding: '10px 14px', minWidth: 220, maxWidth: 320,
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
        }}>
          {article ? (
            <>
              <div style={{ fontWeight: 700, fontSize: 12, color: '#3b82f6', marginBottom: 4 }}>
                {article.title}
              </div>
              <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.5 }}>
                {article.content.slice(0, 200)}{article.content.length > 200 ? '…' : ''}
              </div>
            </>
          ) : (
            <div style={{ fontSize: 11, color: '#94a3b8' }}>
              Help: <strong style={{ color: '#e2e8f0' }}>{topic}</strong>
            </div>
          )}
          {/* Arrow */}
          <div style={{
            position: 'absolute', bottom: -5, left: '50%',
            width: 10, height: 10, background: '#1e293b',
            borderRight: '1px solid #334155', borderBottom: '1px solid #334155',
            transform: 'translateX(-50%) rotate(45deg)',
          }} />
        </div>
      )}
    </span>
  )
}

// ─── Help Sidebar Panel ───────────────────────────────────────────────────────

export function ContextualHelpPanel({ context, onClose }: ContextualHelpPanelProps) {
  const [articles, setArticles] = useState<HelpArticle[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    const fetchArticles = async () => {
      setLoading(true)
      try {
        const url = searchQuery.trim()
          ? `/api/phase11/help/articles?context=${context}&q=${encodeURIComponent(searchQuery)}`
          : `/api/phase11/help/articles?context=${context}`
        const res = await fetch(url)
        const data = await res.json()
        setArticles(data.articles ?? [])
      } finally {
        setLoading(false)
      }
    }
    const t = setTimeout(fetchArticles, searchQuery ? 200 : 0)
    return () => clearTimeout(t)
  }, [context, searchQuery])

  return (
    <div style={{
      width: 320, background: '#0f172a', borderLeft: '1px solid #1e293b',
      height: '100%', display: 'flex', flexDirection: 'column', fontFamily: 'sans-serif',
    }}>
      <div style={{
        padding: '14px 16px', borderBottom: '1px solid #1e293b',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: '#e2e8f0' }}>
          📚 Help: {context}
        </div>
        {onClose && (
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 18 }}
          >
            ×
          </button>
        )}
      </div>

      <div style={{ padding: '12px 16px', borderBottom: '1px solid #1e293b' }}>
        <input
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search help articles…"
          style={{
            width: '100%', padding: '8px 10px', background: '#1e293b',
            border: '1px solid #334155', borderRadius: 6, color: '#e2e8f0',
            fontSize: 12, boxSizing: 'border-box', outline: 'none',
          }}
        />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        {loading ? (
          <div style={{ color: '#64748b', textAlign: 'center', padding: 24, fontSize: 13 }}>Loading…</div>
        ) : articles.length === 0 ? (
          <div style={{ color: '#64748b', textAlign: 'center', padding: 24, fontSize: 13 }}>
            No articles found.
          </div>
        ) : (
          articles.map(article => (
            <div
              key={article.id}
              onClick={() => setExpandedId(expandedId === article.id ? null : article.id)}
              style={{
                padding: '12px 16px', cursor: 'pointer',
                borderBottom: '1px solid #1e293b',
                background: expandedId === article.id ? '#1e293b' : 'transparent',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: '#e2e8f0', flex: 1 }}>
                  {article.title}
                </div>
                <span style={{ color: '#64748b', marginLeft: 8 }}>
                  {expandedId === article.id ? '▲' : '▼'}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                {article.tags.map(tag => (
                  <span key={tag} style={{
                    background: '#3b82f620', color: '#3b82f6', border: '1px solid #3b82f633',
                    borderRadius: 4, padding: '1px 6px', fontSize: 10,
                  }}>
                    {tag}
                  </span>
                ))}
              </div>
              {expandedId === article.id && (
                <div style={{ marginTop: 8, fontSize: 12, color: '#94a3b8', lineHeight: 1.6 }}>
                  {article.content}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// ─── Help Button ──────────────────────────────────────────────────────────────

interface HelpButtonProps {
  context: string
}

export function HelpButton({ context }: HelpButtonProps) {
  const [panelOpen, setPanelOpen] = useState(false)

  return (
    <>
      <button
        onClick={() => setPanelOpen(o => !o)}
        title={`Help: ${context}`}
        style={{
          width: 28, height: 28, borderRadius: '50%', background: '#1e293b',
          border: `1px solid ${panelOpen ? '#3b82f6' : '#334155'}`,
          color: panelOpen ? '#3b82f6' : '#64748b', cursor: 'pointer',
          fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        ?
      </button>
      {panelOpen && (
        <div style={{
          position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 2000,
          boxShadow: '-4px 0 24px rgba(0,0,0,0.5)',
        }}>
          <ContextualHelpPanel context={context} onClose={() => setPanelOpen(false)} />
        </div>
      )}
    </>
  )
}
