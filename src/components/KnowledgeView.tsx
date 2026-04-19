/**
 * KnowledgeView — v4.31.0
 *
 * Admin UI for the ingested-document corpus.
 *   Search  — full-text over chunks with source citations
 *   Sources — list, status, reingest, delete
 *
 * Owner/admin only; link lives in the System sidebar group.
 */

import React, { useState, useEffect, useMemo } from 'react'

interface SourceRow {
  id:                string
  title:             string
  kind:              string
  storage_path:      string | null
  original_filename: string | null
  byte_size:         number | null
  page_count:        number | null
  license_type:      string
  status:            'pending'|'ingesting'|'ready'|'failed'
  error_text:        string | null
  chunk_count:       number
  tags:              string[]
  asset_system:      string | null
  ingested_at:       string | null
  created_at:        string
  updated_at:        string
}

interface SearchHit {
  chunk_id:      string
  source_id:     string
  source_title:  string
  source_kind:   string
  license_type:  string
  page_ref:      string | null
  ordinal:       number
  text:          string
  score:         number
  rank_type:     string
}

interface Pagination { page: number; limit: number; total: number; pages: number }
const EMPTY_PAGE: Pagination = { page: 1, limit: 25, total: 0, pages: 0 }

type Tab = 'search' | 'sources'

interface Props {
  onToast?: (m: string, t?: string) => void
}

export default function KnowledgeView({ onToast }: Props) {
  const [tab, setTab] = useState<Tab>('search')
  const token = useMemo(() => {
    try { return localStorage.getItem('jarvis_token') || '' } catch { return '' }
  }, [])
  const authHeaders = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token])

  return (
    <div className="p-6">
      <div className="mb-4">
        <h2 className="text-2xl font-bold text-gray-900">Knowledge Base</h2>
        <p className="text-sm text-gray-600">
          Ingested technical documents (manuals, IOMs, specs, standards). Retrieval uses full-text
          search; add an embedding provider (Ava / OpenAI / Voyage) later for semantic retrieval —
          the schema is ready.
        </p>
      </div>

      <div className="mb-4 border-b border-gray-200 flex gap-0">
        {(['search','sources'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm border-b-2 ${
              tab === t
                ? 'border-indigo-600 text-indigo-700 font-medium'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            {t === 'search' ? 'Search' : 'Sources'}
          </button>
        ))}
      </div>

      {tab === 'search'  && <SearchTab  authHeaders={authHeaders} onToast={onToast} />}
      {tab === 'sources' && <SourcesTab authHeaders={authHeaders} onToast={onToast} />}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Search tab
// ═══════════════════════════════════════════════════════════════════════════

function SearchTab({
  authHeaders, onToast,
}: { authHeaders: Record<string,string>; onToast?: (m:string,t?:string)=>void }) {
  const [query, setQuery] = useState('')
  const [topK, setTopK] = useState('8')
  const [assetSystem, setAssetSystem] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function run() {
    if (!query.trim()) return
    setLoading(true); setErr(null)
    try {
      const r = await fetch('/api/v1/knowledge/search', {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          topK: Number(topK) || 8,
          asset_system: assetSystem || undefined,
        }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = await r.json()
      setHits(j.data ?? [])
    } catch (e) { setErr(String(e)); onToast?.(String(e), 'error') }
    finally { setLoading(false) }
  }

  function highlight(text: string, q: string): React.ReactElement {
    // Lightweight snippet highlight; no XSS since we split on plain text.
    const terms = q.split(/\s+/).filter(t => t.length >= 3)
    if (terms.length === 0) return <>{text}</>
    const pattern = new RegExp(`(${terms.map(escapeRegex).join('|')})`, 'gi')
    const parts = text.split(pattern)
    return <>{parts.map((p, i) =>
      pattern.test(p)
        ? <mark key={i} className="bg-yellow-200">{p}</mark>
        : <span key={i}>{p}</span>
    )}</>
  }

  return (
    <>
      <div className="mb-4 p-4 bg-white border border-gray-200 rounded">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto_auto] gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Query</label>
            <input value={query} onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') run() }}
              placeholder="oil pressure trip chiller startup"
              className="w-full border border-gray-300 rounded px-2 py-1 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">topK</label>
            <input type="number" min={1} max={50} value={topK}
              onChange={e => setTopK(e.target.value)}
              className="w-20 border border-gray-300 rounded px-2 py-1 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Asset system</label>
            <input value={assetSystem} onChange={e => setAssetSystem(e.target.value)}
              placeholder="chiller"
              className="w-32 border border-gray-300 rounded px-2 py-1 text-sm font-mono" />
          </div>
          <button onClick={run} disabled={loading || !query.trim()}
            className="px-3 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded disabled:opacity-50">
            {loading ? 'Searching…' : 'Search'}
          </button>
        </div>
      </div>

      {err && <div className="mb-3 p-3 bg-red-50 border border-red-200 text-red-800 text-sm rounded">{err}</div>}

      {hits.length === 0 && !loading && query.trim() && (
        <div className="p-4 text-center text-gray-500 text-sm">
          No matches. Try different keywords or ingest more sources.
        </div>
      )}

      <div className="space-y-3">
        {hits.map(h => (
          <div key={h.chunk_id} className="p-4 bg-white border border-gray-200 rounded">
            <div className="flex items-start justify-between mb-2">
              <div className="text-sm font-semibold text-gray-900">
                {h.source_title}
                {h.page_ref && <span className="text-xs text-gray-500 ml-2">{h.page_ref}</span>}
                <span className="text-xs text-gray-400 ml-2">· chunk #{h.ordinal}</span>
              </div>
              <div className="text-right">
                <div className="text-xs font-mono text-indigo-700">score {h.score.toFixed(3)}</div>
                <div className="text-xs text-gray-400">{h.rank_type} · {h.license_type}</div>
              </div>
            </div>
            <div className="text-sm text-gray-700 whitespace-pre-line">{highlight(h.text, query)}</div>
          </div>
        ))}
      </div>
    </>
  )
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ═══════════════════════════════════════════════════════════════════════════
// Sources tab
// ═══════════════════════════════════════════════════════════════════════════

function SourcesTab({
  authHeaders, onToast,
}: { authHeaders: Record<string,string>; onToast?: (m:string,t?:string)=>void }) {
  const [rows, setRows] = useState<SourceRow[]>([])
  const [pagination, setPagination] = useState<Pagination>(EMPTY_PAGE)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState('')

  async function load(page = 1) {
    setLoading(true); setErr(null)
    try {
      const params = new URLSearchParams()
      params.set('page', String(page))
      if (statusFilter) params.set('status', statusFilter)
      const r = await fetch(`/api/v1/knowledge/sources?${params}`, { headers: authHeaders })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = await r.json()
      setRows(j.data || [])
      setPagination(j.pagination || EMPTY_PAGE)
    } catch (e) { setErr(String(e)); onToast?.('Failed to load sources', 'error') }
    finally { setLoading(false) }
  }

  useEffect(() => { load(1) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [statusFilter])

  async function reingest(row: SourceRow) {
    try {
      const r = await fetch(`/api/v1/knowledge/sources/${row.id}/reingest`, {
        method: 'POST', headers: authHeaders,
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      onToast?.('Queued for re-ingest', 'success')
      load(pagination.page)
    } catch (e) { onToast?.(String(e), 'error') }
  }

  async function remove(row: SourceRow) {
    if (!confirm(`Delete "${row.title}" and all its chunks?`)) return
    try {
      const r = await fetch(`/api/v1/knowledge/sources/${row.id}`, {
        method: 'DELETE', headers: authHeaders,
      })
      if (!r.ok && r.status !== 204) throw new Error(`HTTP ${r.status}`)
      onToast?.('Source deleted', 'success')
      load(pagination.page)
    } catch (e) { onToast?.(String(e), 'error') }
  }

  const statusCls = (s: string) => ({
    pending:    'bg-gray-100 text-gray-700',
    ingesting:  'bg-yellow-100 text-yellow-800',
    ready:      'bg-green-100 text-green-800',
    failed:     'bg-red-100 text-red-800',
  } as Record<string, string>)[s] ?? 'bg-gray-100 text-gray-800'

  return (
    <>
      <div className="mb-3 flex gap-3 items-center">
        <label className="text-xs flex items-center gap-2">
          Status
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1 text-sm">
            <option value="">All</option>
            {['pending','ingesting','ready','failed'].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <button onClick={() => load(pagination.page)}
          className="px-3 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded">Refresh</button>
        <span className="text-xs text-gray-600">
          Bulk load with <code className="bg-gray-100 px-1 rounded">npm run knowledge:ingest -- /path/to/folder</code>
        </span>
      </div>

      {err && <div className="mb-3 p-3 bg-red-50 border border-red-200 text-red-800 text-sm rounded">{err}</div>}

      <div className="bg-white border border-gray-200 rounded overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                {['Title','Status','Chunks','Pages','Size','License','Asset','Ingested',''].map(h => (
                  <th key={h} className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {loading && <tr><td colSpan={9} className="px-3 py-6 text-center text-gray-500">Loading…</td></tr>}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={9} className="px-3 py-6 text-center text-gray-500">
                  No sources yet. Ingest a folder or register files via <code>POST /api/v1/knowledge/sources</code>.
                </td></tr>
              )}
              {!loading && rows.map(r => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2">
                    <div className="text-sm font-medium truncate max-w-md" title={r.title}>{r.title}</div>
                    {r.error_text && (
                      <div className="text-xs text-red-600 truncate max-w-md" title={r.error_text}>{r.error_text}</div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${statusCls(r.status)}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs font-mono">{r.chunk_count}</td>
                  <td className="px-3 py-2 text-xs font-mono">{r.page_count ?? '—'}</td>
                  <td className="px-3 py-2 text-xs text-gray-600">{fmtBytes(r.byte_size)}</td>
                  <td className="px-3 py-2 text-xs"><code>{r.license_type}</code></td>
                  <td className="px-3 py-2 text-xs text-gray-600">{r.asset_system ?? '—'}</td>
                  <td className="px-3 py-2 text-xs text-gray-600 whitespace-nowrap">
                    {r.ingested_at ? new Date(r.ingested_at).toLocaleString() : '—'}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {r.status !== 'ingesting' && (
                      <button onClick={() => reingest(r)}
                        className="text-amber-600 hover:text-amber-800 text-xs mr-3">Re-ingest</button>
                    )}
                    <button onClick={() => remove(r)}
                      className="text-red-600 hover:text-red-800 text-xs">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-3 py-2 bg-gray-50 border-t border-gray-200 flex items-center justify-between text-xs text-gray-600">
          <span>Page {pagination.page} of {pagination.pages || 1} · {pagination.total.toLocaleString()} sources</span>
          <div className="flex gap-1">
            <button disabled={pagination.page <= 1 || loading} onClick={() => load(pagination.page - 1)}
              className="px-2 py-1 border border-gray-300 rounded disabled:opacity-50 hover:bg-gray-100">Prev</button>
            <button disabled={pagination.page >= pagination.pages || loading} onClick={() => load(pagination.page + 1)}
              className="px-2 py-1 border border-gray-300 rounded disabled:opacity-50 hover:bg-gray-100">Next</button>
          </div>
        </div>
      </div>
    </>
  )
}

function fmtBytes(n: number | null): string {
  if (n == null) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}
