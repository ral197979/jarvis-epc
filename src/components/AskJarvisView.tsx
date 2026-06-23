/**
 * AskJarvisView — v4.31.0
 *
 * Grounded RAG chat surface. User asks questions, Claude answers using
 * retrieved chunks from the tenant's knowledge corpus + Fix Library,
 * with schema-enforced structured output (answer / procedure /
 * possible_causes / confidence / citations).
 *
 * Citation badges are hoverable (preview chunk) + clickable (full
 * source modal). Every message is persisted; sessions can be flagged
 * resolved, which is the learning-loop signal for future fine-tuning.
 */

import React, { useState, useEffect, useMemo, useRef } from 'react'

// ─── Types (match askBuilder.ts) ──────────────────────────────────────────────

interface Citation {
  source:    string
  chunk_id:  string
  page_ref?: string | null
  tier:      string
}

interface StructuredAnswer {
  answer:           string
  procedure:        string[]
  possible_causes:  string[]
  confidence:       number
  citations:        Citation[]
}

interface RetrievedChunk {
  chunk_id:      string
  source_title:  string
  tier:          string
  page_ref:      string | null
  text:          string
  score:         number
}

interface Message {
  id:                  string
  ordinal:             number
  role:                'user' | 'assistant' | 'system'
  content:             string
  structured_answer:   StructuredAnswer | null
  retrieved_chunk_ids: string[]
  created_at:          string
  error_text?:         string | null
}

interface Session {
  id:                    string
  title:                 string | null
  resolved_flag:         boolean
  message_count:         number
  created_at:            string
  updated_at:            string
  linked_work_order_id:  string | null
}

interface ChunkDetail {
  id:            string
  source_id:     string
  source_title:  string
  source_kind:   string
  license_type:  string
  page_ref:      string | null
  ordinal:       number
  text:          string
  tokens_est:    number
  source_path:   string | null
}

interface AskResponse {
  session_id:        string
  message_id:        string
  structured:        StructuredAnswer
  retrieved_chunks:  RetrievedChunk[]
  model:             string
  input_tokens:      number
  output_tokens:     number
  elapsed_ms:        number
}

interface Props {
  onToast?: (m: string, t?: string) => void
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AskJarvisView({ onToast }: Props) {
  const token = useMemo(() => {
    try { return localStorage.getItem('jarvis_token') || '' } catch { return '' }
  }, [])
  const authHeaders = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token])

  const [sessions, setSessions]   = useState<Session[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [messages, setMessages]   = useState<Message[]>([])
  const [question, setQuestion]   = useState('')
  const [asking, setAsking]       = useState(false)
  // Chunk-id → loaded detail cache for hover/modal
  const [chunkCache, setChunkCache] = useState<Record<string, ChunkDetail>>({})
  const [modalChunkId, setModalChunkId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  async function loadSessions() {
    try {
      const r = await fetch('/api/v1/ask/sessions', { headers: authHeaders })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = await r.json()
      setSessions(j.data ?? [])
    } catch { /* silent — offline or auth issue */ }
  }

  async function loadSession(id: string) {
    try {
      const r = await fetch(`/api/v1/ask/sessions/${id}`, { headers: authHeaders })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = await r.json()
      setMessages(j.data?.messages ?? [])
      setActiveSessionId(id)
    } catch (e) { onToast?.(String(e), 'error') }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadSessions()   }, [])

  // Auto-scroll to bottom when messages update.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, asking])

  async function ask() {
    const q = question.trim()
    if (!q || asking) return
    setAsking(true)
    // Optimistic local-echo of the user turn
    const optimistic: Message = {
      id: `pending-${Date.now()}`, ordinal: (messages[messages.length - 1]?.ordinal ?? -1) + 1,
      role: 'user', content: q, structured_answer: null, retrieved_chunk_ids: [],
      created_at: new Date().toISOString(),
    }
    setMessages(m => [...m, optimistic])
    setQuestion('')

    try {
      const r = await fetch('/api/v1/ask', {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: q,
          session_id: activeSessionId ?? undefined,
        }),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j.message || `HTTP ${r.status}`)
      }
      const result = (await r.json()).data as AskResponse
      // Reload the session to get the persisted messages in correct order.
      setActiveSessionId(result.session_id)
      await loadSession(result.session_id)
      // Refresh session list so new session shows up in the sidebar.
      if (!activeSessionId) loadSessions()
    } catch (e) {
      onToast?.(String(e), 'error')
      // Remove optimistic echo on error
      setMessages(m => m.filter(x => x.id !== optimistic.id))
    } finally {
      setAsking(false)
    }
  }

  async function loadChunk(chunkId: string): Promise<ChunkDetail | null> {
    if (chunkCache[chunkId]) return chunkCache[chunkId]
    try {
      const r = await fetch(`/api/v1/ask/chunks/${chunkId}`, { headers: authHeaders })
      if (!r.ok) return null
      const j = await r.json()
      const detail = j.data as ChunkDetail
      setChunkCache(c => ({ ...c, [chunkId]: detail }))
      return detail
    } catch { return null }
  }

  async function resolveSession() {
    if (!activeSessionId) return
    try {
      const r = await fetch(`/api/v1/ask/sessions/${activeSessionId}/resolve`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      onToast?.('Session marked resolved — will feed the learning loop', 'success')
      loadSessions()
    } catch (e) { onToast?.(String(e), 'error') }
  }

  function newSession() {
    setActiveSessionId(null)
    setMessages([])
  }

  const activeSession = sessions.find(s => s.id === activeSessionId)

  return (
    <div className="h-full flex">
      {/* ── Session sidebar ───────────────────────────────────── */}
      <div className="w-64 border-r border-gray-200 bg-gray-50 flex flex-col">
        <div className="p-3 border-b border-gray-200">
          <button onClick={newSession}
            className="w-full px-3 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded">
            + New question
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {sessions.length === 0 && (
            <p className="text-xs text-gray-500 p-3">No prior questions. Ask one on the right.</p>
          )}
          {sessions.map(s => (
            <button key={s.id} onClick={() => loadSession(s.id)}
              className={`w-full text-left px-3 py-2 text-xs rounded mb-1 truncate
                ${activeSessionId === s.id ? 'bg-indigo-100 text-indigo-900' : 'hover:bg-gray-100 text-gray-700'}`}>
              <div className="flex items-center gap-1">
                {s.resolved_flag && <span className="text-green-600">✓</span>}
                <span className="truncate">{s.title || 'Untitled'}</span>
              </div>
              <div className="text-[10px] text-gray-500 mt-0.5">
                {new Date(s.updated_at).toLocaleString()}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ── Main chat pane ───────────────────────────────────── */}
      <div className="flex-1 flex flex-col">
        <div className="p-4 border-b border-gray-200 bg-white flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Ask Jarvis</h2>
            <p className="text-xs text-gray-500">
              Grounded answers from your tenant corpus (1,240 PDFs · 61k chunks) + Fix Library. Every claim is cited.
            </p>
          </div>
          {activeSession && !activeSession.resolved_flag && (
            <button onClick={resolveSession}
              className="px-3 py-1.5 text-sm bg-green-600 hover:bg-green-700 text-white rounded">
              Mark resolved
            </button>
          )}
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-6 bg-gray-50">
          {messages.length === 0 && !asking && (
            <EmptyState />
          )}
          {messages.map(m => (
            <MessageBubble key={m.id} message={m} loadChunk={loadChunk}
              openChunkModal={id => setModalChunkId(id)} />
          ))}
          {asking && (
            <div className="flex items-center gap-3 text-sm text-gray-500">
              <Spinner /> Retrieving sources and thinking...
            </div>
          )}
        </div>

        <div className="p-4 border-t border-gray-200 bg-white">
          <form onSubmit={e => { e.preventDefault(); ask() }} className="flex gap-2">
            <textarea value={question} onChange={e => setQuestion(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) ask() }}
              placeholder="Ask about a startup procedure, trouble code, valve sequence… (⌘/Ctrl+Enter to send)"
              className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm resize-none"
              rows={2} />
            <button type="submit" disabled={!question.trim() || asking}
              className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded disabled:opacity-50">
              Ask
            </button>
          </form>
        </div>
      </div>

      {/* ── Chunk detail modal ──────────────────────────────── */}
      {modalChunkId && (
        <ChunkModal chunkId={modalChunkId} loadChunk={loadChunk}
          onClose={() => setModalChunkId(null)} />
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Subcomponents
// ═══════════════════════════════════════════════════════════════════════════

function EmptyState() {
  return (
    <div className="max-w-2xl mx-auto mt-12 text-center">
      <div className="text-5xl mb-4">📚</div>
      <h3 className="text-lg font-semibold text-gray-800 mb-2">Ask me anything from your corpus.</h3>
      <p className="text-sm text-gray-600 mb-6">
        Example questions that work well given your ingested manuals:
      </p>
      <div className="grid grid-cols-1 gap-2 text-left text-sm">
        {[
          'How do I start up a Carrier 30XA after an oil pump trip?',
          'What is the correct pre-functional checklist for a booster pump?',
          'What causes a Yaskawa P1000 FDBKL fault?',
          'Hach SC200 calibration procedure for chlorine?',
        ].map(q => (
          <div key={q} className="p-3 bg-white border border-gray-200 rounded italic text-gray-700">
            &quot;{q}&quot;
          </div>
        ))}
      </div>
    </div>
  )
}

function MessageBubble({
  message, loadChunk, openChunkModal,
}: {
  message:        Message
  loadChunk:      (id: string) => Promise<ChunkDetail | null>
  openChunkModal: (id: string) => void
}) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-2xl px-4 py-3 bg-indigo-600 text-white rounded-2xl rounded-tr-sm text-sm">
          {message.content}
        </div>
      </div>
    )
  }

  const s = message.structured_answer
  if (!s) {
    return (
      <div className="max-w-2xl px-4 py-3 bg-gray-100 text-gray-700 rounded-2xl rounded-tl-sm text-sm">
        {message.content}
      </div>
    )
  }

  const confPct = Math.round(s.confidence * 100)
  const confCls = s.confidence >= 0.7 ? 'bg-green-100 text-green-800'
                : s.confidence >= 0.3 ? 'bg-yellow-100 text-yellow-800'
                :                         'bg-red-100 text-red-800'

  return (
    <div className="max-w-3xl bg-white border border-gray-200 rounded-2xl rounded-tl-sm p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-3 text-xs text-gray-500">
        <span className={`px-2 py-0.5 rounded font-medium ${confCls}`}>
          confidence {confPct}%
        </span>
        <span>·</span>
        <span>{s.citations.length} citation{s.citations.length === 1 ? '' : 's'}</span>
      </div>

      <p className="text-sm text-gray-900 font-medium mb-3">{s.answer}</p>

      {s.procedure.length > 0 && (
        <div className="mb-3">
          <div className="text-xs font-semibold uppercase text-gray-500 mb-1">Procedure</div>
          <ol className="list-decimal list-inside space-y-1 text-sm text-gray-800">
            {s.procedure.map((step, i) => <li key={i}>{step}</li>)}
          </ol>
        </div>
      )}

      {s.possible_causes.length > 0 && (
        <div className="mb-3">
          <div className="text-xs font-semibold uppercase text-gray-500 mb-1">Possible causes</div>
          <ul className="list-disc list-inside space-y-1 text-sm text-gray-800">
            {s.possible_causes.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
        </div>
      )}

      {s.citations.length > 0 && (
        <div className="pt-3 border-t border-gray-100">
          <div className="text-xs font-semibold uppercase text-gray-500 mb-2">Sources</div>
          <div className="flex flex-wrap gap-2">
            {s.citations.map((c, i) => (
              <CitationBadge key={`${c.chunk_id}-${i}`} citation={c}
                loadChunk={loadChunk} onOpen={() => openChunkModal(c.chunk_id)} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function CitationBadge({
  citation, loadChunk, onOpen,
}: {
  citation:  Citation
  loadChunk: (id: string) => Promise<ChunkDetail | null>
  onOpen:    () => void
}) {
  const [preview, setPreview] = useState<string | null>(null)
  const [showPreview, setShowPreview] = useState(false)

  async function handleHover() {
    if (preview || !showPreview) return
    const detail = await loadChunk(citation.chunk_id)
    if (detail) {
      // First 3-5 lines, approx 300 chars
      const lines = detail.text.split('\n').slice(0, 5).join('\n')
      setPreview(lines.slice(0, 400))
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (showPreview) handleHover()   }, [showPreview])

  const tierCls = citation.tier === 'oem'    ? 'bg-indigo-100 text-indigo-800'
                : citation.tier === 'record' ? 'bg-blue-100 text-blue-800'
                : citation.tier === 'form'   ? 'bg-gray-100 text-gray-600'
                :                              'bg-gray-100 text-gray-700'

  return (
    <div className="relative inline-block"
      onMouseEnter={() => setShowPreview(true)}
      onMouseLeave={() => setShowPreview(false)}>
      <button onClick={onOpen}
        className={`text-xs px-2 py-1 rounded font-medium ${tierCls} hover:ring-2 hover:ring-indigo-300`}>
        {citation.tier}: {citation.source.slice(0, 40)}{citation.source.length > 40 ? '…' : ''}
        {citation.page_ref && <span className="ml-1 text-[10px] opacity-70">{citation.page_ref}</span>}
      </button>
      {showPreview && preview && (
        <div className="absolute z-40 top-full mt-2 left-0 w-96 p-3 bg-white border border-gray-200 rounded shadow-lg text-xs text-gray-700 whitespace-pre-wrap max-h-48 overflow-y-auto">
          {preview}
          <div className="mt-2 text-[10px] text-indigo-600 italic">Click for full source →</div>
        </div>
      )}
    </div>
  )
}

function ChunkModal({
  chunkId, loadChunk, onClose,
}: {
  chunkId:   string
  loadChunk: (id: string) => Promise<ChunkDetail | null>
  onClose:   () => void
}) {
  const [chunk, setChunk] = useState<ChunkDetail | null>(null)
  useEffect(() => {
    loadChunk(chunkId).then(d => setChunk(d))
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [chunkId])

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full mx-4 max-h-[85vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">
              {chunk?.source_title ?? 'Loading...'}
            </h3>
            {chunk && (
              <div className="text-xs text-gray-500 mt-1">
                chunk #{chunk.ordinal} · {chunk.source_kind} · license: {chunk.license_type}
                {chunk.page_ref && ` · ${chunk.page_ref}`}
              </div>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl">&times;</button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {chunk ? (
            <pre className="whitespace-pre-wrap text-sm text-gray-800 font-sans">{chunk.text}</pre>
          ) : (
            <div className="text-center text-gray-500">Loading chunk...</div>
          )}
        </div>
        {chunk?.source_path && (
          <div className="px-5 py-3 border-t border-gray-200 bg-gray-50 text-xs text-gray-600">
            <code>{chunk.source_path}</code>
          </div>
        )}
      </div>
    </div>
  )
}

function Spinner() {
  return (
    <span className="inline-block w-4 h-4 border-2 border-gray-300 border-t-indigo-600 rounded-full animate-spin" />
  )
}
