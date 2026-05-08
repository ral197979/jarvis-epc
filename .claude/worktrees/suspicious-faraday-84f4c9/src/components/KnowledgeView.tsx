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

type Tab = 'search' | 'sources' | 'bulk'

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
        {(['search','sources','bulk'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm border-b-2 ${
              tab === t
                ? 'border-indigo-600 text-indigo-700 font-medium'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            {t === 'search' ? 'Search' : t === 'sources' ? 'Sources' : 'Bulk Load'}
          </button>
        ))}
      </div>

      {tab === 'search'  && <SearchTab  authHeaders={authHeaders} onToast={onToast} />}
      {tab === 'sources' && <SourcesTab authHeaders={authHeaders} onToast={onToast} />}
      {tab === 'bulk'    && <BulkLoadTab authHeaders={authHeaders} onToast={onToast} />}
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

  async function mineFixes(row: SourceRow) {
    try {
      const r = await fetch(`/api/v1/knowledge/sources/${row.id}/mine-fixes`, {
        method: 'POST', headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.message || `HTTP ${r.status}`) }
      onToast?.(`Queued fix extraction for "${row.title.slice(0, 40)}"`, 'success')
    } catch (e) { onToast?.(String(e), 'error') }
  }

  async function bulkMine() {
    if (!confirm('Queue fix extraction for up to 100 OEM/record sources (uses Anthropic tokens, ~$0.05-$0.15 per source)?')) return
    try {
      const r = await fetch('/api/v1/knowledge/mine-fixes-bulk', {
        method: 'POST', headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 100 }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = await r.json()
      onToast?.(`Bulk extraction queued: ${j.data.enqueued} sources (${j.data.skipped} skipped)`, 'success')
    } catch (e) { onToast?.(String(e), 'error') }
  }

  async function embedSource(row: SourceRow) {
    try {
      const r = await fetch(`/api/v1/knowledge/sources/${row.id}/embed`, {
        method: 'POST', headers: authHeaders,
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      onToast?.(`Embedding queued for ${row.title.slice(0, 40)}`, 'success')
    } catch (e) { onToast?.(String(e), 'error') }
  }

  async function bulkEmbed() {
    if (!confirm('Embed all un-embedded chunks (OpenAI text-embedding-3-small, ~$0.43 for full 61k-chunk corpus)?')) return
    try {
      const r = await fetch('/api/v1/knowledge/embed-bulk', {
        method: 'POST', headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 500 }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = await r.json()
      onToast?.(`Embedding queued for ${j.data.enqueued} sources`, 'success')
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
        <button onClick={bulkMine}
          className="px-3 py-2 text-sm bg-amber-600 hover:bg-amber-700 text-white rounded">
          ⚗ Mine fixes (bulk)
        </button>
        <button onClick={bulkEmbed}
          className="px-3 py-2 text-sm bg-purple-600 hover:bg-purple-700 text-white rounded">
          ✨ Embed corpus
        </button>
        <span className="text-xs text-gray-600">
          Claude reads OEM / record sources and extracts <code>{`{symptoms, root_cause, resolution}`}</code>
          &nbsp;into the Fix Library at <em>suspected</em> confidence — engineers verify later.
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
                    {r.status === 'ready' && (
                      <button onClick={() => mineFixes(r)}
                        className="text-indigo-600 hover:text-indigo-800 text-xs mr-3">⚗ Mine fixes</button>
                    )}
                    {r.status === 'ready' && (
                      <button onClick={() => embedSource(r)}
                        className="text-purple-600 hover:text-purple-800 text-xs mr-3">✨ Embed</button>
                    )}
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

// ═══════════════════════════════════════════════════════════════════════════
// Bulk Load tab — admin server-side directory walk
// ═══════════════════════════════════════════════════════════════════════════

interface BulkResult {
  rootPath:        string
  dryRun:          boolean
  candidatesFound: number
  queued:          number
  duplicates:      number
  errors:          number
  truncated:       boolean
  errorSamples:    Array<{ path: string; message: string }>
  queuedSourceIds: string[]
  plan?:           Array<{ path: string; size: number; name: string; ext: string }>
}

function BulkLoadTab({
  authHeaders, onToast,
}: { authHeaders: Record<string,string>; onToast?: (m:string,t?:string)=>void }) {
  const [rootPath, setRootPath]         = useState('')
  const [extensions, setExtensions]     = useState('pdf')
  const [tags, setTags]                 = useState('')
  const [assetSystem, setAssetSystem]   = useState('')
  const [licenseType, setLicenseType]   = useState('owned')
  const [limit, setLimit]               = useState('5000')
  const [running, setRunning]           = useState(false)
  const [result, setResult]             = useState<BulkResult | null>(null)
  const [err, setErr]                   = useState<string | null>(null)

  async function run(dryRun: boolean) {
    if (!rootPath.trim()) { onToast?.('root path required', 'error'); return }
    setRunning(true); setErr(null); setResult(null)
    try {
      const r = await fetch('/api/v1/knowledge/bulk-ingest', {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          root_path:    rootPath.trim(),
          extensions:   extensions.split(',').map(s => s.trim()).filter(Boolean),
          tags:         tags.split(',').map(s => s.trim()).filter(Boolean),
          license_type: licenseType,
          asset_system: assetSystem || undefined,
          limit:        Number(limit) || undefined,
          dry_run:      dryRun,
        }),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j.message || `HTTP ${r.status}`)
      }
      const j = await r.json()
      setResult(j.data as BulkResult)
      onToast?.(
        dryRun
          ? `Preview: ${j.data.candidatesFound} candidates`
          : `Queued ${j.data.queued} · ${j.data.duplicates} dupes · ${j.data.errors} errors`,
        dryRun ? 'info' : 'success',
      )
    } catch (e) {
      setErr(String(e)); onToast?.(String(e), 'error')
    } finally {
      setRunning(false)
    }
  }

  return (
    <>
      <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded text-sm">
        <div className="font-semibold text-amber-900 mb-1">⚠ Admin-only server-side walk</div>
        <div className="text-amber-800 text-xs">
          This tells the API server to read a directory on the server&apos;s filesystem. In production,
          set <code className="bg-white px-1 rounded">KNOWLEDGE_INGEST_ROOTS</code> to restrict which paths are
          accepted. In dev (e.g. macOS), any path the server can read works — mounted drives like
          <code className="bg-white px-1 rounded">/Volumes/A/...</code> are fine.
        </div>
      </div>

      <div className="p-4 bg-white border border-gray-200 rounded space-y-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Root path *</label>
          <input value={rootPath} onChange={e => setRootPath(e.target.value)}
            placeholder="/Volumes/A/My_Folder/Technical"
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm font-mono" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Extensions (comma)</label>
            <input value={extensions} onChange={e => setExtensions(e.target.value)}
              className="w-full border border-gray-300 rounded px-2 py-1 text-sm font-mono" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Tags (comma)</label>
            <input value={tags} onChange={e => setTags(e.target.value)}
              placeholder="engineering,reference"
              className="w-full border border-gray-300 rounded px-2 py-1 text-sm font-mono" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Asset system (optional)</label>
            <input value={assetSystem} onChange={e => setAssetSystem(e.target.value)}
              placeholder="chiller"
              className="w-full border border-gray-300 rounded px-2 py-1 text-sm font-mono" />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">License</label>
            <select value={licenseType} onChange={e => setLicenseType(e.target.value)}
              className="w-full border border-gray-300 rounded px-2 py-1 text-sm">
              <option value="owned">owned</option>
              <option value="purchased">purchased</option>
              <option value="public_domain">public_domain</option>
              <option value="cc-by">cc-by</option>
              <option value="cc-by-sa">cc-by-sa</option>
              <option value="gov">gov</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Max files</label>
            <input type="number" min={1} max={10000} value={limit}
              onChange={e => setLimit(e.target.value)}
              className="w-full border border-gray-300 rounded px-2 py-1 text-sm font-mono" />
          </div>
        </div>

        <div className="flex gap-2 pt-2 border-t">
          <button onClick={() => run(true)} disabled={running || !rootPath.trim()}
            className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 text-gray-800 rounded border border-gray-300 disabled:opacity-50">
            {running ? 'Working…' : 'Preview (dry run)'}
          </button>
          <button onClick={() => run(false)} disabled={running || !rootPath.trim()}
            className="px-3 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded disabled:opacity-50">
            {running ? 'Working…' : 'Queue ingest'}
          </button>
        </div>
      </div>

      {err && <div className="mt-4 p-3 bg-red-50 border border-red-200 text-red-800 text-sm rounded">{err}</div>}

      {result && (
        <div className="mt-4 p-4 bg-white border border-gray-200 rounded">
          <div className="flex items-center gap-4 mb-3 text-sm">
            <StatCard label="Candidates"  value={result.candidatesFound} />
            <StatCard label="Queued"      value={result.queued}      tone="good" />
            <StatCard label="Duplicates"  value={result.duplicates}  tone="muted" />
            <StatCard label="Errors"      value={result.errors}      tone={result.errors > 0 ? 'bad' : 'muted'} />
            {result.truncated && (
              <div className="text-xs text-amber-700">⚠ truncated by limit — raise limit + re-run to continue</div>
            )}
            {result.dryRun && <div className="text-xs text-indigo-700">dry run · no changes written</div>}
          </div>

          {result.errorSamples.length > 0 && (
            <details className="mb-3 text-xs">
              <summary className="cursor-pointer text-red-700">Error samples ({result.errorSamples.length})</summary>
              <ul className="mt-2 space-y-1">
                {result.errorSamples.map((e, i) => (
                  <li key={i} className="font-mono text-red-700 break-all">
                    <span className="text-red-400">{e.path}</span> — {e.message}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {result.plan && result.plan.length > 0 && (
            <details>
              <summary className="cursor-pointer text-sm text-gray-700">
                Preview plan ({result.plan.length} files{result.truncated ? '+ truncated' : ''})
              </summary>
              <div className="mt-2 max-h-96 overflow-y-auto">
                <table className="min-w-full text-xs">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-2 py-1 text-left">Name</th>
                      <th className="px-2 py-1 text-right">Size</th>
                      <th className="px-2 py-1 text-left">Path</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.plan.map((p, i) => (
                      <tr key={i} className="border-t border-gray-100">
                        <td className="px-2 py-1">{p.name}</td>
                        <td className="px-2 py-1 text-right font-mono">{fmtBytes(p.size)}</td>
                        <td className="px-2 py-1 font-mono text-gray-500 truncate max-w-md" title={p.path}>{p.path}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}

          {!result.dryRun && result.queued > 0 && (
            <div className="mt-3 text-xs text-gray-600">
              Processing is async — switch to <strong>Sources</strong> and filter by <code>ingesting</code> to watch progress.
              Each PDF extracts in ~1–5 s; a 1300-file batch finishes in 20–60 min.
            </div>
          )}
        </div>
      )}
    </>
  )
}

function StatCard({ label, value, tone }: { label: string; value: number; tone?: 'good'|'bad'|'muted' }) {
  const cls = tone === 'good'  ? 'text-green-700'
           : tone === 'bad'    ? 'text-red-700'
           : tone === 'muted'  ? 'text-gray-500'
           :                     'text-indigo-700'
  return (
    <div>
      <div className="text-xs text-gray-500 uppercase">{label}</div>
      <div className={`text-xl font-bold ${cls}`}>{value.toLocaleString()}</div>
    </div>
  )
}

function fmtBytes(n: number | null): string {
  if (n == null) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}
