/**
 * FixLibraryView — v4.31.0
 *
 * Tenant-owned troubleshooting corpus. Engineers log resolutions they
 * verified; the arbiter retrieves them during failures; the library
 * grows over time into the team's operational memory.
 *
 * Tabs:
 *   Browse — paginated list + filters (asset system, confidence, project)
 *   Search — structured search (symptoms / asset / free-text)
 *   New    — create form
 */

import React, { useState, useEffect, useMemo } from 'react'

interface FixRow {
  id: string
  project_id: string | null
  asset_system: string | null
  asset_tag: string | null
  symptoms: string[]
  root_cause: string
  resolution_steps: string
  confidence: 'confirmed' | 'probable' | 'suspected'
  verified_by: string | null
  verified_at: string | null
  source_url: string | null
  source_note: string | null
  created_at: string
  updated_at: string
}

interface SearchHit {
  fix:              FixRow
  score:            number
  symptom_overlap:  number
  why:              string
}

interface Pagination { page: number; limit: number; total: number; pages: number }
const EMPTY_PAGE: Pagination = { page: 1, limit: 25, total: 0, pages: 0 }

type Tab = 'browse' | 'search' | 'new'

interface Props {
  onToast?: (m: string, t?: string) => void
}

interface NewTabPrefill {
  sourceUrl?:   string
  sourceNote?: string
  title?:      string
}

export default function FixLibraryView({ onToast }: Props) {
  const [tab, setTab] = useState<Tab>('browse')
  const [prefill, setPrefill] = useState<NewTabPrefill | null>(null)
  const [showSetup, setShowSetup] = useState(false)

  const token = useMemo(() => {
    try { return localStorage.getItem('jarvis_token') || '' } catch { return '' }
  }, [])
  const authHeaders = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token])

  // v4.31.0: "Save to Fix Library" bookmarklet deep-link.
  // URL pattern:  /?tab=fixlibrary&source_url=<u>&source_note=<n>&title=<t>
  // On first mount, if any of those are present, switch to the New tab,
  // hand them to the form, and scrub the URL so a refresh doesn't repeat
  // the pre-fill.
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const p = new URLSearchParams(window.location.search)
      const sourceUrl  = p.get('source_url')  ?? undefined
      const sourceNote = p.get('source_note') ?? undefined
      const title      = p.get('title')       ?? undefined
      if (sourceUrl || sourceNote || title) {
        setPrefill({ sourceUrl, sourceNote, title })
        setTab('new')
        // Clean the URL without triggering a reload.
        const clean = window.location.pathname + window.location.hash
        window.history.replaceState({}, '', clean)
      }
    } catch { /* URL parse failures ignored */ }
  }, [])

  return (
    <div className="p-6">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Fix Library</h2>
          <p className="text-sm text-gray-600">
            Engineer-authored resolutions. The arbiter surfaces relevant fixes when tests fail or are flagged
            as novel; growing the library improves that assistance.
          </p>
        </div>
        <button onClick={() => setShowSetup(v => !v)}
          className="text-xs text-indigo-600 hover:text-indigo-800 whitespace-nowrap">
          {showSetup ? 'Hide setup' : '💡 Install bookmarklet'}
        </button>
      </div>

      {showSetup && <BookmarkletSetup onClose={() => setShowSetup(false)} />}

      <div className="mb-4 border-b border-gray-200 flex gap-0">
        {(['browse','search','new'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm border-b-2 ${
              tab === t
                ? 'border-indigo-600 text-indigo-700 font-medium'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            {t === 'browse' ? 'Browse' : t === 'search' ? 'Search' : '+ New Fix'}
          </button>
        ))}
      </div>

      {tab === 'browse' && <BrowseTab authHeaders={authHeaders} onToast={onToast} />}
      {tab === 'search' && <SearchTab authHeaders={authHeaders} onToast={onToast} />}
      {tab === 'new'    && <NewTab    authHeaders={authHeaders} onToast={onToast}
        initial={prefill ?? undefined}
        onCreated={() => { setPrefill(null); setTab('browse') }} />}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Bookmarklet setup panel
// ═══════════════════════════════════════════════════════════════════════════

function BookmarkletSetup({ onClose }: { onClose: () => void }) {
  // Build the bookmarklet against THIS deployment's origin so drag-and-drop
  // works out of the box regardless of dev/staging/prod domain.
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const bookmarkletHref =
    `javascript:(function(){` +
      `var sel=window.getSelection().toString().slice(0,500);` +
      `var u='${origin}/?tab=fixlibrary`
        + `&source_url='+encodeURIComponent(location.href)` +
        `+'&source_note='+encodeURIComponent(sel)` +
        `+'&title='+encodeURIComponent(document.title);` +
      `window.open(u,'_blank');` +
    `})()`

  return (
    <div className="mb-4 p-4 bg-indigo-50 border border-indigo-200 rounded text-sm">
      <div className="flex items-start justify-between mb-2">
        <h3 className="font-semibold text-indigo-900">Save to Fix Library — browser bookmarklet</h3>
        <button onClick={onClose} className="text-indigo-400 hover:text-indigo-600">&times;</button>
      </div>
      <p className="text-indigo-800 mb-3">
        Drag the button below to your bookmarks bar. On any forum thread or manufacturer page,
        highlight the sentence you want to paraphrase, then click the bookmark. Jarvis opens in a
        new tab with the URL + your selection pre-filled. You write the fix; the source text never
        hits Jarvis&apos;s servers.
      </p>
      <div className="flex items-center gap-3 mb-3">
        { }
        <a href={bookmarkletHref}
          className="inline-block px-3 py-2 bg-indigo-600 text-white rounded text-sm font-medium shadow hover:bg-indigo-700 cursor-grab active:cursor-grabbing"
          onClick={(e) => {
            e.preventDefault()
            alert('Drag this button to your browser\'s bookmarks bar — clicking it here just navigates.')
          }}
        >
          📌 Save to Fix Library
        </a>
        <span className="text-xs text-indigo-700">← drag me to your bookmarks bar</span>
      </div>
      <details className="text-xs text-indigo-700">
        <summary className="cursor-pointer">Source (for manual install)</summary>
        <pre className="mt-2 bg-white border border-indigo-200 rounded p-2 text-xs overflow-x-auto whitespace-pre-wrap break-all">
{bookmarkletHref}
        </pre>
      </details>
      <p className="mt-3 text-xs text-indigo-700">
        <strong>Note:</strong> Jarvis never fetches forum content server-side. You paste the takeaway in
        your own words; the URL is stored only as a citation. This stays within personal-use terms of
        every forum we&apos;ve reviewed.
      </p>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Browse tab
// ═══════════════════════════════════════════════════════════════════════════

function BrowseTab({ authHeaders, onToast }: { authHeaders: Record<string,string>; onToast?: (m:string,t?:string)=>void }) {
  const [rows, setRows] = useState<FixRow[]>([])
  const [pagination, setPagination] = useState<Pagination>(EMPTY_PAGE)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [selected, setSelected] = useState<FixRow | null>(null)

  async function load(page = 1) {
    setLoading(true); setErr(null)
    try {
      const r = await fetch(`/api/v1/knowledge-fixes?page=${page}`, { headers: authHeaders })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = await r.json()
      setRows(j.data || [])
      setPagination(j.pagination || EMPTY_PAGE)
    } catch (e) { setErr(String(e)); onToast?.('Failed to load fixes', 'error') }
    finally { setLoading(false) }
  }

  useEffect(() => { load(1)   }, [])

  return (
    <>
      {err && <div className="mb-3 p-3 bg-red-50 border border-red-200 text-red-800 text-sm rounded">{err}</div>}

      <div className="bg-white border border-gray-200 rounded overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              {['Asset','Symptoms','Root cause','Confidence','Added',''].map(h => (
                <th key={h} className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {loading && <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-500">Loading…</td></tr>}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-500">
                No fixes yet. Capture one when you resolve the next tricky failure.
              </td></tr>
            )}
            {!loading && rows.map(r => (
              <tr key={r.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setSelected(r)}>
                <td className="px-3 py-2 text-xs font-mono">
                  {r.asset_system ?? '—'}{r.asset_tag ? ` · ${r.asset_tag}` : ''}
                </td>
                <td className="px-3 py-2 text-xs">
                  <div className="flex flex-wrap gap-1">
                    {r.symptoms.slice(0, 3).map(s => (
                      <span key={s} className="bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded text-xs">{s}</span>
                    ))}
                    {r.symptoms.length > 3 && <span className="text-gray-400 text-xs">+{r.symptoms.length - 3}</span>}
                  </div>
                </td>
                <td className="px-3 py-2 text-sm max-w-md truncate">{r.root_cause}</td>
                <td className="px-3 py-2 text-xs"><ConfidenceBadge c={r.confidence} /></td>
                <td className="px-3 py-2 text-xs text-gray-600 whitespace-nowrap">
                  {new Date(r.created_at).toLocaleDateString()}
                </td>
                <td className="px-3 py-2 text-right">
                  <button onClick={(e) => { e.stopPropagation(); setSelected(r) }}
                    className="text-indigo-600 hover:text-indigo-800 text-xs">Open</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="px-3 py-2 bg-gray-50 border-t border-gray-200 flex items-center justify-between text-xs text-gray-600">
          <span>Page {pagination.page} of {pagination.pages || 1} · {pagination.total.toLocaleString()} fixes</span>
          <div className="flex gap-1">
            <button disabled={pagination.page <= 1 || loading} onClick={() => load(pagination.page - 1)}
              className="px-2 py-1 border border-gray-300 rounded disabled:opacity-50 hover:bg-gray-100">Prev</button>
            <button disabled={pagination.page >= pagination.pages || loading} onClick={() => load(pagination.page + 1)}
              className="px-2 py-1 border border-gray-300 rounded disabled:opacity-50 hover:bg-gray-100">Next</button>
          </div>
        </div>
      </div>

      {selected && <FixDetailModal fix={selected} authHeaders={authHeaders} onToast={onToast}
        onClose={() => setSelected(null)} onChange={() => { setSelected(null); load(pagination.page) }} />}
    </>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Search tab — structured
// ═══════════════════════════════════════════════════════════════════════════

function SearchTab({ authHeaders, onToast }: { authHeaders: Record<string,string>; onToast?: (m:string,t?:string)=>void }) {
  const [symptoms, setSymptoms] = useState('')
  const [assetSystem, setAssetSystem] = useState('')
  const [assetTag, setAssetTag] = useState('')
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [loading, setLoading] = useState(false)
  const [symptomSuggestions, setSymptomSuggestions] = useState<string[]>([])

  useEffect(() => {
    fetch('/api/v1/knowledge-fixes/_meta/symptoms', { headers: authHeaders })
      .then(r => r.ok ? r.json() : { data: [] })
      .then(j => setSymptomSuggestions(j.data ?? []))
      .catch(() => {})
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [])

  async function run() {
    setLoading(true)
    try {
      const r = await fetch('/api/v1/knowledge-fixes/search', {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symptoms:     symptoms.split(',').map(s => s.trim()).filter(Boolean),
          asset_system: assetSystem || undefined,
          asset_tag:    assetTag || undefined,
          query:        query || undefined,
          limit:        10,
        }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = await r.json()
      setHits(j.data ?? [])
    } catch (e) { onToast?.(String(e), 'error') }
    finally { setLoading(false) }
  }

  return (
    <>
      <div className="mb-4 p-4 bg-white border border-gray-200 rounded">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Symptoms (comma-separated)</label>
            <input value={symptoms} onChange={e => setSymptoms(e.target.value)}
              placeholder="oil_pressure_trip, startup_fail"
              list="symptom-suggestions"
              className="w-full border border-gray-300 rounded px-2 py-1 text-sm font-mono" />
            <datalist id="symptom-suggestions">
              {symptomSuggestions.map(s => <option key={s} value={s} />)}
            </datalist>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Asset system</label>
            <input value={assetSystem} onChange={e => setAssetSystem(e.target.value)}
              placeholder="chiller, vfd, ro_skid"
              className="w-full border border-gray-300 rounded px-2 py-1 text-sm font-mono" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Asset tag</label>
            <input value={assetTag} onChange={e => setAssetTag(e.target.value)}
              placeholder="CH-01"
              className="w-full border border-gray-300 rounded px-2 py-1 text-sm font-mono" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Free text (optional)</label>
            <input value={query} onChange={e => setQuery(e.target.value)}
              placeholder="filter replacement, pump priming, etc."
              className="w-full border border-gray-300 rounded px-2 py-1 text-sm" />
          </div>
        </div>
        <div className="mt-3">
          <button onClick={run} disabled={loading}
            className="px-3 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded disabled:opacity-50">
            {loading ? 'Searching…' : 'Search'}
          </button>
        </div>
      </div>

      {hits.length === 0 && !loading && (
        <div className="p-4 text-center text-gray-500 text-sm">
          Enter at least one of: symptoms, asset system, asset tag, or free text.
        </div>
      )}

      <div className="space-y-3">
        {hits.map(h => (
          <div key={h.fix.id} className="p-4 bg-white border border-gray-200 rounded">
            <div className="flex items-start justify-between mb-2">
              <div>
                <div className="text-sm font-semibold text-gray-900">{h.fix.root_cause}</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {h.fix.asset_system ?? 'no system'}{h.fix.asset_tag ? ' · ' + h.fix.asset_tag : ''}
                  {' · '}<ConfidenceBadge c={h.fix.confidence} />
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs font-mono text-indigo-700">score {h.score.toFixed(2)}</div>
                <div className="text-xs text-gray-400">{h.why}</div>
              </div>
            </div>
            <div className="flex flex-wrap gap-1 mb-2">
              {h.fix.symptoms.map(s => (
                <span key={s} className="bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded text-xs">{s}</span>
              ))}
            </div>
            <div className="text-sm text-gray-700 whitespace-pre-line">{h.fix.resolution_steps}</div>
            {h.fix.source_url && (
              <a href={h.fix.source_url} target="_blank" rel="noreferrer"
                className="text-xs text-indigo-600 hover:text-indigo-800 mt-2 inline-block">
                ↗ source
              </a>
            )}
          </div>
        ))}
      </div>
    </>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// New-fix tab
// ═══════════════════════════════════════════════════════════════════════════

function NewTab({
  authHeaders, onToast, onCreated, initial,
}: {
  authHeaders: Record<string,string>
  onToast?: (m:string,t?:string)=>void
  onCreated: () => void
  initial?: { sourceUrl?: string; sourceNote?: string; title?: string }
}) {
  // If a title came in from the bookmarklet but the engineer didn't
  // highlight anything, fall back to the page title as the source note
  // so there's some context to anchor the fix writeup to.
  const initialNote = initial?.sourceNote && initial.sourceNote.trim().length > 0
    ? initial.sourceNote
    : (initial?.title ?? '')

  const [assetSystem, setAssetSystem] = useState('')
  const [assetTag, setAssetTag] = useState('')
  const [symptoms, setSymptoms] = useState('')
  const [rootCause, setRootCause] = useState('')
  const [resolution, setResolution] = useState('')
  const [confidence, setConfidence] = useState<'confirmed'|'probable'|'suspected'>('probable')
  const [sourceUrl, setSourceUrl] = useState(initial?.sourceUrl ?? '')
  const [sourceNote, setSourceNote] = useState(initialNote)
  const [submitting, setSubmitting] = useState(false)

  // If the bookmarklet fires while the user is already in the New tab
  // (tab stays mounted), sync the incoming pre-fill rather than creating
  // a second instance. Only update empty fields so in-progress edits stick.
  useEffect(() => {
    if (!initial) return
    if (initial.sourceUrl && !sourceUrl) setSourceUrl(initial.sourceUrl)
    if (initialNote && !sourceNote) setSourceNote(initialNote)
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [initial?.sourceUrl, initial?.sourceNote, initial?.title])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const syms = symptoms.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
    if (syms.length === 0 || !rootCause.trim() || !resolution.trim()) {
      onToast?.('Need symptoms, root cause, and resolution', 'error'); return
    }
    setSubmitting(true)
    try {
      const r = await fetch('/api/v1/knowledge-fixes', {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asset_system:     assetSystem || null,
          asset_tag:        assetTag || null,
          symptoms:         syms,
          root_cause:       rootCause.trim(),
          resolution_steps: resolution.trim(),
          confidence,
          source_url:       sourceUrl || null,
          source_note:      sourceNote || null,
        }),
      })
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.message || `HTTP ${r.status}`) }
      onToast?.('Fix saved to library', 'success')
      onCreated()
    } catch (e) { onToast?.(String(e), 'error') }
    finally { setSubmitting(false) }
  }

  return (
    <form onSubmit={submit} className="p-4 bg-white border border-gray-200 rounded space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Asset system</label>
          <input value={assetSystem} onChange={e => setAssetSystem(e.target.value)}
            placeholder="chiller, vfd, pump, ro_skid…"
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm font-mono" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Asset tag (optional)</label>
          <input value={assetTag} onChange={e => setAssetTag(e.target.value)}
            placeholder="CH-01"
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm font-mono" />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Symptoms (comma-separated) *</label>
        <input value={symptoms} onChange={e => setSymptoms(e.target.value)}
          placeholder="oil_pressure_trip, startup_fail, low_inlet_pressure_psig"
          className="w-full border border-gray-300 rounded px-2 py-1 text-sm font-mono" />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Root cause *</label>
        <textarea value={rootCause} onChange={e => setRootCause(e.target.value)}
          rows={2}
          placeholder="One sentence. What was actually wrong."
          className="w-full border border-gray-300 rounded px-2 py-1 text-sm" />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Resolution steps *</label>
        <textarea value={resolution} onChange={e => setResolution(e.target.value)}
          rows={5}
          placeholder={`1. Isolate the line at V-04.
2. Drain residual oil.
3. Replace filter cartridge with part XYZ.
4. Re-prime per manufacturer sequence.
5. Verify pressure returns to spec before restart.`}
          className="w-full border border-gray-300 rounded px-2 py-1 text-sm" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Confidence</label>
          <select value={confidence} onChange={e => setConfidence(e.target.value as any)}
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm">
            <option value="suspected">Suspected — one occurrence, unverified</option>
            <option value="probable">Probable — worked once or twice</option>
            <option value="confirmed">Confirmed — repeatedly verified</option>
          </select>
        </div>
        <div className="md:col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">Source URL (optional forum/manual)</label>
          <input value={sourceUrl} onChange={e => setSourceUrl(e.target.value)}
            placeholder="https://forum.example/thread/123"
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm" />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Source note (optional)</label>
        <input value={sourceNote} onChange={e => setSourceNote(e.target.value)}
          placeholder="What the source contributed — not a copy of its text."
          className="w-full border border-gray-300 rounded px-2 py-1 text-sm" />
      </div>

      <div>
        <button type="submit" disabled={submitting}
          className="px-3 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded disabled:opacity-50">
          {submitting ? 'Saving…' : 'Save fix'}
        </button>
      </div>
    </form>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Detail modal
// ═══════════════════════════════════════════════════════════════════════════

function FixDetailModal({
  fix, authHeaders, onToast, onClose, onChange,
}: {
  fix: FixRow
  authHeaders: Record<string,string>
  onToast?: (m:string,t?:string) => void
  onClose: () => void
  onChange: () => void
}) {
  async function verify() {
    try {
      const r = await fetch(`/api/v1/knowledge-fixes/${fix.id}/verify`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ confidence: 'confirmed' }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      onToast?.('Promoted to confirmed', 'success')
      onChange()
    } catch (e) { onToast?.(String(e), 'error') }
  }

  async function remove() {
    if (!confirm('Delete this fix? This cannot be undone.')) return
    try {
      const r = await fetch(`/api/v1/knowledge-fixes/${fix.id}`, { method: 'DELETE', headers: authHeaders })
      if (!r.ok && r.status !== 204) throw new Error(`HTTP ${r.status}`)
      onToast?.('Fix deleted', 'success')
      onChange()
    } catch (e) { onToast?.(String(e), 'error') }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full mx-4 max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b flex items-center justify-between">
          <h3 className="text-lg font-semibold">{fix.root_cause}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
        </div>
        <div className="p-5 space-y-3 text-sm">
          <div className="text-xs text-gray-600">
            {fix.asset_system ?? 'no system'}{fix.asset_tag ? ' · ' + fix.asset_tag : ''}
            {' · '}<ConfidenceBadge c={fix.confidence} />
          </div>
          <div className="flex flex-wrap gap-1">
            {fix.symptoms.map(s => (
              <span key={s} className="bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded text-xs font-mono">{s}</span>
            ))}
          </div>
          <div>
            <div className="text-xs font-medium text-gray-500 mb-1">Resolution</div>
            <div className="text-sm whitespace-pre-line">{fix.resolution_steps}</div>
          </div>
          {fix.source_url && (
            <div>
              <div className="text-xs font-medium text-gray-500 mb-1">Source</div>
              <a href={fix.source_url} target="_blank" rel="noreferrer"
                className="text-xs text-indigo-600 hover:text-indigo-800 break-all">{fix.source_url}</a>
              {fix.source_note && <div className="text-xs text-gray-600 mt-1">{fix.source_note}</div>}
            </div>
          )}
          <div className="text-xs text-gray-500 pt-2 border-t">
            Added {new Date(fix.created_at).toLocaleString()}
            {fix.verified_at && ` · Verified ${new Date(fix.verified_at).toLocaleString()}`}
          </div>
          <div className="flex gap-2 pt-2">
            {fix.confidence !== 'confirmed' && (
              <button onClick={verify}
                className="px-3 py-1.5 text-sm bg-green-600 hover:bg-green-700 text-white rounded">
                Promote to Confirmed
              </button>
            )}
            <button onClick={remove}
              className="px-3 py-1.5 text-sm bg-red-600 hover:bg-red-700 text-white rounded">
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Small helpers ────────────────────────────────────────────────────────────

function ConfidenceBadge({ c }: { c: 'confirmed'|'probable'|'suspected' }) {
  const cls = c === 'confirmed' ? 'bg-green-100 text-green-800'
            : c === 'probable'  ? 'bg-blue-100 text-blue-800'
            :                      'bg-yellow-100 text-yellow-800'
  return <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${cls}`}>{c}</span>
}
