/**
 * AutomationView — v4.31.0
 *
 * Admin UI for the scheduler:
 *   Tab 1 — Scheduled Jobs : recurring definitions (cron-style)
 *   Tab 2 — Background Jobs: recent job runs + retry failed
 *
 * Requires owner/admin role (backend 403s otherwise).
 */

import React, { useState, useEffect, useMemo } from 'react'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  Tooltip, CartesianGrid, Legend,
} from 'recharts'

interface ScheduledJob {
  id: string
  name: string
  job_type: string
  payload_json: Record<string, unknown>
  interval_seconds: number | null
  cron_expression: string | null
  enabled: boolean
  max_attempts: number
  next_run_at: string
  last_run_at: string | null
  last_job_id: string | null
  created_at: string
}

interface BackgroundJob {
  id: string
  scheduled_job_id: string | null
  job_type: string
  status: string
  attempts: number
  max_attempts: number
  payload_json: Record<string, unknown>
  result_json: Record<string, unknown> | null
  error_text: string | null
  run_after: string
  locked_at: string | null
  locked_by: string | null
  created_at: string
}

interface Pagination { page: number; limit: number; total: number; pages: number }
const EMPTY_PAGE: Pagination = { page: 1, limit: 50, total: 0, pages: 0 }

interface AutomationViewProps {
  onToast?: (m: string, t?: string) => void
  onAudit?: (e: unknown) => void
}

type Tab = 'scheduled' | 'background' | 'kpi' | 'mcp' | 'rules' | 'actions' | 'baselines'

interface KpiSnapshotRow {
  id: string
  captured_at: string
  metrics: Record<string, number>
}

export default function AutomationView({ onToast }: AutomationViewProps) {
  const [tab, setTab] = useState<Tab>('scheduled')
  const token = useMemo(() => {
    try { return localStorage.getItem('jarvis_token') || '' } catch { return '' }
  }, [])
  const authHeaders = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token])

  return (
    <div className="p-6">
      <div className="mb-4">
        <h2 className="text-2xl font-bold text-gray-900">Automation</h2>
        <p className="text-sm text-gray-600">
          Recurring job definitions and background worker queue. Owner/admin only.
        </p>
      </div>

      <div className="mb-4 border-b border-gray-200 flex gap-0 flex-wrap">
        {(['scheduled','background','kpi','mcp','rules','actions','baselines'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm border-b-2 ${
              tab === t
                ? 'border-indigo-600 text-indigo-700 font-medium'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            {t === 'scheduled'    ? 'Scheduled Jobs'
              : t === 'background' ? 'Background Jobs'
              : t === 'kpi'        ? 'KPI History'
              : t === 'mcp'        ? 'MCP Marketplace'
              : t === 'rules'      ? 'Autosign Rules'
              : t === 'actions'    ? 'Agent Actions'
              : 'Baselines'}
          </button>
        ))}
      </div>

      {tab === 'scheduled'  && <ScheduledJobsTab    authHeaders={authHeaders} onToast={onToast} />}
      {tab === 'background' && <BackgroundJobsTab   authHeaders={authHeaders} onToast={onToast} />}
      {tab === 'kpi'        && <KpiHistoryTab       authHeaders={authHeaders} onToast={onToast} />}
      {tab === 'mcp'        && <McpMarketplaceTab   authHeaders={authHeaders} onToast={onToast} />}
      {tab === 'rules'      && <AutosignRulesTab    authHeaders={authHeaders} onToast={onToast} />}
      {tab === 'actions'    && <AgentActionsTab     authHeaders={authHeaders} onToast={onToast} />}
      {tab === 'baselines'  && <BaselinesTab        authHeaders={authHeaders} onToast={onToast} />}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Scheduled Jobs tab
// ═══════════════════════════════════════════════════════════════════════════

function ScheduledJobsTab({
  authHeaders, onToast,
}: { authHeaders: Record<string, string>; onToast?: (m: string, t?: string) => void }) {
  const [rows, setRows] = useState<ScheduledJob[]>([])
  const [pagination, setPagination] = useState<Pagination>(EMPTY_PAGE)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [handlers, setHandlers] = useState<string[]>([])
  const [showCreate, setShowCreate] = useState(false)

  async function load(page = 1) {
    setLoading(true); setErr(null)
    try {
      const r = await fetch(
        `/api/v1/admin/automation/scheduled?page=${page}&limit=${pagination.limit}`,
        { headers: authHeaders },
      )
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = await r.json()
      setRows(j.data || [])
      setPagination(j.pagination || EMPTY_PAGE)
    } catch (e) {
      setErr(String(e)); onToast?.('Failed to load scheduled jobs', 'error')
    } finally { setLoading(false) }
  }

  async function loadHandlers() {
    try {
      const r = await fetch('/api/v1/admin/automation/handlers', { headers: authHeaders })
      if (!r.ok) return
      const j = await r.json()
      if (Array.isArray(j.data)) setHandlers(j.data)
    } catch { /* best-effort */ }
  }

  useEffect(() => { loadHandlers(); load(1) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [])

  async function toggle(row: ScheduledJob) {
    try {
      const r = await fetch(`/api/v1/admin/automation/scheduled/${row.id}`, {
        method: 'PATCH',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !row.enabled }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      onToast?.(`${row.enabled ? 'Paused' : 'Enabled'}: ${row.name}`, 'success')
      load(pagination.page)
    } catch (e) { onToast?.(String(e), 'error') }
  }

  async function remove(row: ScheduledJob) {
    if (!confirm(`Delete scheduled job "${row.name}"?`)) return
    try {
      const r = await fetch(`/api/v1/admin/automation/scheduled/${row.id}`, {
        method: 'DELETE', headers: authHeaders,
      })
      if (!r.ok && r.status !== 204) throw new Error(`HTTP ${r.status}`)
      onToast?.(`Deleted ${row.name}`, 'success')
      load(pagination.page)
    } catch (e) { onToast?.(String(e), 'error') }
  }

  return (
    <>
      <div className="mb-3 flex gap-2">
        <button onClick={() => setShowCreate(v => !v)}
          className="px-3 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded">
          {showCreate ? 'Cancel' : '+ New Scheduled Job'}
        </button>
        <button onClick={() => load(pagination.page)}
          className="px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded border border-gray-300">
          Refresh
        </button>
      </div>

      {showCreate && (
        <CreateScheduledJobForm
          handlers={handlers} authHeaders={authHeaders} onToast={onToast}
          onCreated={() => { setShowCreate(false); load(1) }}
        />
      )}

      {err && <div className="mb-3 p-3 bg-red-50 border border-red-200 text-red-800 text-sm rounded">{err}</div>}

      <div className="bg-white border border-gray-200 rounded overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                {['Name','Job Type','Cadence','Next Run','Last Run','Enabled',''].map(h => (
                  <th key={h} className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {loading && <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-500">Loading…</td></tr>}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-500">
                  No scheduled jobs. Create one to start automating.
                </td></tr>
              )}
              {!loading && rows.map(r => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-medium text-gray-900">{r.name}</td>
                  <td className="px-3 py-2 text-gray-700"><code className="text-xs">{r.job_type}</code></td>
                  <td className="px-3 py-2 text-gray-600 text-xs">
                    {r.interval_seconds
                      ? `every ${formatInterval(r.interval_seconds)}`
                      : r.cron_expression
                        ? <code>{r.cron_expression}</code>
                        : 'one-shot'}
                  </td>
                  <td className="px-3 py-2 text-gray-700 text-xs">{new Date(r.next_run_at).toLocaleString()}</td>
                  <td className="px-3 py-2 text-gray-600 text-xs">
                    {r.last_run_at ? new Date(r.last_run_at).toLocaleString() : '—'}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                      r.enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
                    }`}>
                      {r.enabled ? 'enabled' : 'paused'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => toggle(r)}
                      className="text-indigo-600 hover:text-indigo-800 text-xs mr-3">
                      {r.enabled ? 'Pause' : 'Enable'}
                    </button>
                    <button onClick={() => remove(r)} className="text-red-600 hover:text-red-800 text-xs">
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

function CreateScheduledJobForm({
  handlers, authHeaders, onToast, onCreated,
}: {
  handlers: string[]
  authHeaders: Record<string, string>
  onToast?: (m: string, t?: string) => void
  onCreated: () => void
}) {
  const [name, setName] = useState('')
  const [jobType, setJobType] = useState(handlers[0] ?? '')
  const [intervalSecs, setIntervalSecs] = useState('3600')
  const [payloadText, setPayloadText] = useState('{}')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => { if (!jobType && handlers[0]) setJobType(handlers[0]) }, [handlers, jobType])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name || !jobType) { onToast?.('Name and job type required', 'error'); return }
    let payload: Record<string, unknown>
    try { payload = JSON.parse(payloadText) }
    catch { onToast?.('Payload must be valid JSON', 'error'); return }
    setSubmitting(true)
    try {
      const r = await fetch('/api/v1/admin/automation/scheduled', {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, job_type: jobType,
          interval_seconds: Number(intervalSecs) || null,
          payload_json: payload,
        }),
      })
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.message || `HTTP ${r.status}`) }
      onToast?.('Scheduled job created', 'success')
      onCreated()
    } catch (e) { onToast?.(String(e), 'error') }
    finally { setSubmitting(false) }
  }

  return (
    <form onSubmit={submit} className="mb-4 p-4 bg-white border border-gray-200 rounded">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
          <input value={name} onChange={e => setName(e.target.value)}
            placeholder="e.g. nightly-kpi-snapshot"
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Job Type</label>
          <select value={jobType} onChange={e => setJobType(e.target.value)}
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm">
            {handlers.length === 0 && <option value="">(no handlers registered)</option>}
            {handlers.map(h => <option key={h} value={h}>{h}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Interval (seconds)</label>
          <input value={intervalSecs} onChange={e => setIntervalSecs(e.target.value)}
            type="number" min={1}
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm" />
        </div>
      </div>
      <div className="mt-3">
        <label className="block text-xs font-medium text-gray-600 mb-1">Payload (JSON)</label>
        <textarea value={payloadText} onChange={e => setPayloadText(e.target.value)}
          rows={3}
          className="w-full border border-gray-300 rounded px-2 py-1 text-xs font-mono" />
      </div>
      <div className="mt-3">
        <button type="submit" disabled={submitting}
          className="px-3 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded disabled:opacity-50">
          {submitting ? 'Creating…' : 'Create'}
        </button>
      </div>
    </form>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Background Jobs tab
// ═══════════════════════════════════════════════════════════════════════════

function BackgroundJobsTab({
  authHeaders, onToast,
}: { authHeaders: Record<string, string>; onToast?: (m: string, t?: string) => void }) {
  const [rows, setRows] = useState<BackgroundJob[]>([])
  const [pagination, setPagination] = useState<Pagination>(EMPTY_PAGE)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [selected, setSelected] = useState<BackgroundJob | null>(null)

  async function load(page = 1) {
    setLoading(true); setErr(null)
    try {
      const params = new URLSearchParams()
      params.set('page', String(page))
      params.set('limit', String(pagination.limit))
      if (statusFilter) params.set('status', statusFilter)
      if (typeFilter)   params.set('job_type', typeFilter)
      const r = await fetch(`/api/v1/admin/automation/background?${params}`, { headers: authHeaders })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = await r.json()
      setRows(j.data || [])
      setPagination(j.pagination || EMPTY_PAGE)
    } catch (e) {
      setErr(String(e)); onToast?.('Failed to load background jobs', 'error')
    } finally { setLoading(false) }
  }

  useEffect(() => { load(1) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [])

  async function retry(row: BackgroundJob) {
    try {
      const r = await fetch(`/api/v1/admin/automation/background/${row.id}/retry`, {
        method: 'POST', headers: authHeaders,
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      onToast?.('Job requeued', 'success')
      load(pagination.page)
    } catch (e) { onToast?.(String(e), 'error') }
  }

  const statusCls = (s: string) => ({
    queued:   'bg-blue-100 text-blue-800',
    running:  'bg-yellow-100 text-yellow-800',
    complete: 'bg-green-100 text-green-800',
    failed:   'bg-red-100 text-red-800',
  } as Record<string, string>)[s] ?? 'bg-gray-100 text-gray-800'

  return (
    <>
      <div className="mb-3 p-3 bg-white border border-gray-200 rounded flex gap-3 items-end">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1 text-sm">
            <option value="">All</option>
            {['queued','running','complete','failed'].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Job Type</label>
          <input value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
            placeholder="e.g. webhook_dispatch"
            className="border border-gray-300 rounded px-2 py-1 text-sm" />
        </div>
        <button onClick={() => load(1)}
          className="px-3 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded">
          Apply
        </button>
        <button onClick={() => { setStatusFilter(''); setTypeFilter(''); setTimeout(() => load(1), 0) }}
          className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded border border-gray-300">
          Clear
        </button>
      </div>

      {err && <div className="mb-3 p-3 bg-red-50 border border-red-200 text-red-800 text-sm rounded">{err}</div>}

      <div className="bg-white border border-gray-200 rounded overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                {['Created','Job Type','Status','Attempts','Run After',''].map(h => (
                  <th key={h} className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {loading && <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-500">Loading…</td></tr>}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-500">No jobs match these filters.</td></tr>
              )}
              {!loading && rows.map(r => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 text-gray-700 text-xs whitespace-nowrap">
                    {new Date(r.created_at).toLocaleString()}
                  </td>
                  <td className="px-3 py-2"><code className="text-xs">{r.job_type}</code></td>
                  <td className="px-3 py-2">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${statusCls(r.status)}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-gray-700 text-xs">{r.attempts}/{r.max_attempts}</td>
                  <td className="px-3 py-2 text-gray-600 text-xs whitespace-nowrap">
                    {new Date(r.run_after).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button onClick={() => setSelected(r)}
                      className="text-indigo-600 hover:text-indigo-800 text-xs mr-3">
                      Details
                    </button>
                    {r.status === 'failed' && (
                      <button onClick={() => retry(r)} className="text-amber-600 hover:text-amber-800 text-xs">
                        Retry
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="px-3 py-2 bg-gray-50 border-t border-gray-200 flex items-center justify-between text-xs text-gray-600">
          <span>Page {pagination.page} of {pagination.pages || 1} · {pagination.total.toLocaleString()} jobs</span>
          <div className="flex gap-1">
            <button disabled={pagination.page <= 1 || loading} onClick={() => load(pagination.page - 1)}
              className="px-2 py-1 border border-gray-300 rounded disabled:opacity-50 hover:bg-gray-100">Prev</button>
            <button disabled={pagination.page >= pagination.pages || loading} onClick={() => load(pagination.page + 1)}
              className="px-2 py-1 border border-gray-300 rounded disabled:opacity-50 hover:bg-gray-100">Next</button>
          </div>
        </div>
      </div>

      {selected && <JobDetailsModal job={selected} onClose={() => setSelected(null)} />}
    </>
  )
}

function JobDetailsModal({ job, onClose }: { job: BackgroundJob; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full mx-4 max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
          <h3 className="text-lg font-semibold"><code>{job.job_type}</code> · {job.status}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
        </div>
        <div className="p-5 space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div><div className="text-gray-500">Job ID</div><div className="font-mono">{job.id}</div></div>
            <div><div className="text-gray-500">Attempts</div><div>{job.attempts} / {job.max_attempts}</div></div>
            <div><div className="text-gray-500">Created</div><div>{new Date(job.created_at).toLocaleString()}</div></div>
            <div><div className="text-gray-500">Run After</div><div>{new Date(job.run_after).toLocaleString()}</div></div>
            <div><div className="text-gray-500">Locked By</div><div className="font-mono">{job.locked_by || '—'}</div></div>
            <div><div className="text-gray-500">Scheduled Job</div>
              <div className="font-mono">{job.scheduled_job_id ? job.scheduled_job_id.slice(0, 8) : 'ad-hoc'}</div></div>
          </div>
          <div>
            <div className="text-xs font-medium text-gray-500 mb-1">Payload</div>
            <pre className="bg-gray-50 border border-gray-200 rounded p-2 text-xs overflow-x-auto">
{JSON.stringify(job.payload_json, null, 2)}
            </pre>
          </div>
          {job.result_json && (
            <div>
              <div className="text-xs font-medium text-gray-500 mb-1">Result</div>
              <pre className="bg-green-50 border border-green-100 rounded p-2 text-xs overflow-x-auto">
{JSON.stringify(job.result_json, null, 2)}
              </pre>
            </div>
          )}
          {job.error_text && (
            <div>
              <div className="text-xs font-medium text-gray-500 mb-1">Error</div>
              <pre className="bg-red-50 border border-red-100 rounded p-2 text-xs overflow-x-auto whitespace-pre-wrap">
{job.error_text}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// KPI History tab
// ═══════════════════════════════════════════════════════════════════════════

function KpiHistoryTab({
  authHeaders, onToast,
}: { authHeaders: Record<string, string>; onToast?: (m: string, t?: string) => void }) {
  const [rows, setRows] = useState<KpiSnapshotRow[]>([])
  const [pagination, setPagination] = useState<Pagination>({ ...EMPTY_PAGE, limit: 30 })
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function load(page = 1) {
    setLoading(true); setErr(null)
    try {
      const params = new URLSearchParams()
      params.set('page', String(page))
      params.set('limit', String(pagination.limit))
      const r = await fetch(`/api/v1/admin/automation/kpi-snapshots?${params}`, { headers: authHeaders })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = await r.json()
      setRows(j.data || [])
      setPagination(j.pagination || { ...EMPTY_PAGE, limit: 30 })
    } catch (e) {
      setErr(String(e)); onToast?.('Failed to load KPI snapshots', 'error')
    } finally { setLoading(false) }
  }

  useEffect(() => { load(1) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [])

  // Pick the union of metric keys across rows so new fields show up automatically
  // when the handler starts emitting them.
  const metricKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const row of rows) Object.keys(row.metrics || {}).forEach(k => keys.add(k))
    return Array.from(keys).sort()
  }, [rows])

  // Default-select a reasonable starting metric (first financial if present).
  const [selectedMetric, setSelectedMetric] = useState<string>('')
  useEffect(() => {
    if (!selectedMetric && metricKeys.length) {
      const preferred = metricKeys.find(k => /budget|actual/.test(k)) ?? metricKeys[0]!
      setSelectedMetric(preferred)
    }
  }, [metricKeys, selectedMetric])

  // Recharts needs chronological order; our rows arrive DESC so reverse.
  const chartData = useMemo(() => {
    if (!selectedMetric) return []
    return [...rows].reverse().map(r => ({
      t: new Date(r.captured_at).toLocaleDateString(),
      v: Number(r.metrics?.[selectedMetric] ?? 0),
    }))
  }, [rows, selectedMetric])

  return (
    <>
      <div className="mb-3 flex gap-2 items-center">
        <button onClick={() => load(pagination.page)}
          className="px-3 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded">
          Refresh
        </button>
        <span className="text-xs text-gray-600">
          Create a scheduled job with type <code className="bg-gray-100 px-1 rounded">snapshot_kpis</code> and
          interval 86400 (daily) to start capturing.
        </span>
      </div>

      {err && <div className="mb-3 p-3 bg-red-50 border border-red-200 text-red-800 text-sm rounded">{err}</div>}

      {metricKeys.length > 0 && (
        <div className="mb-4 bg-white border border-gray-200 rounded p-3">
          <div className="flex items-center gap-3 mb-2">
            <label className="text-xs font-medium text-gray-600">Chart metric:</label>
            <select value={selectedMetric} onChange={e => setSelectedMetric(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1 text-sm">
              {metricKeys.map(k => <option key={k} value={k}>{k.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
          <div style={{ width: '100%', height: 240 }}>
            <ResponsiveContainer>
              <LineChart data={chartData} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="t" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="v" name={selectedMetric} stroke="#4f46e5" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase sticky left-0 bg-gray-50">Captured</th>
                {metricKeys.map(k => (
                  <th key={k} className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase whitespace-nowrap">
                    {k.replace(/_/g, ' ')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {loading && <tr><td colSpan={metricKeys.length + 1} className="px-3 py-6 text-center text-gray-500">Loading…</td></tr>}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={Math.max(1, metricKeys.length + 1)} className="px-3 py-6 text-center text-gray-500">
                  No snapshots yet. Schedule a <code>snapshot_kpis</code> job to begin.
                </td></tr>
              )}
              {!loading && rows.map(r => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 text-xs text-gray-700 whitespace-nowrap sticky left-0 bg-white">
                    {new Date(r.captured_at).toLocaleString()}
                  </td>
                  {metricKeys.map(k => (
                    <td key={k} className="px-3 py-2 text-right text-xs text-gray-800 font-mono whitespace-nowrap">
                      {formatKpi(k, r.metrics?.[k])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="px-3 py-2 bg-gray-50 border-t border-gray-200 flex items-center justify-between text-xs text-gray-600">
          <span>Page {pagination.page} of {pagination.pages || 1} · {pagination.total.toLocaleString()} snapshots</span>
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

function formatKpi(key: string, v: number | undefined): string {
  if (v == null) return '—'
  // Financial fields — format as currency-ish. Everything else is a count.
  if (/budget|cost|committed|actual|forecast/i.test(key)) {
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
    if (v >= 1_000)     return `$${(v / 1_000).toFixed(1)}k`
    return `$${v.toFixed(0)}`
  }
  return v.toLocaleString()
}

// ═══════════════════════════════════════════════════════════════════════════
// MCP Marketplace tab
// ═══════════════════════════════════════════════════════════════════════════

interface McpTool {
  name:         string
  description?: string
  category?:    string
}

function McpMarketplaceTab({
  authHeaders, onToast,
}: { authHeaders: Record<string, string>; onToast?: (m: string, t?: string) => void }) {
  const [tools,    setTools]    = useState<McpTool[]>([])
  const [disabled, setDisabled] = useState<Set<string>>(new Set())
  const [loading,  setLoading]  = useState(false)
  const [err,      setErr]      = useState<string | null>(null)

  async function load() {
    setLoading(true); setErr(null)
    try {
      const [cat, dis] = await Promise.all([
        fetch('/api/v1/mcp/tools',                       { headers: authHeaders }).then(r => r.json()),
        fetch('/api/v1/admin/automation/mcp-tools',      { headers: authHeaders }).then(r => r.json()),
      ])
      setTools(Array.isArray(cat.tools) ? cat.tools : [])
      setDisabled(new Set((dis.data ?? []).map((r: { tool_name: string }) => r.tool_name)))
    } catch (e) {
      setErr(String(e)); onToast?.('Failed to load MCP marketplace', 'error')
    } finally { setLoading(false) }
  }

  useEffect(() => { load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [])

  async function toggle(name: string) {
    const isDisabled = disabled.has(name)
    try {
      const url = `/api/v1/admin/automation/mcp-tools/${encodeURIComponent(name)}/disable`
      const r = await fetch(url, {
        method: isDisabled ? 'DELETE' : 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body:    isDisabled ? undefined : JSON.stringify({}),
      })
      if (!r.ok && r.status !== 204) throw new Error(`HTTP ${r.status}`)
      onToast?.(`${isDisabled ? 'Enabled' : 'Disabled'} ${name}`, 'success')
      load()
    } catch (e) { onToast?.(String(e), 'error') }
  }

  const visible = tools

  return (
    <>
      <div className="mb-3 flex gap-2 items-center">
        <button onClick={load}
          className="px-3 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded">
          Refresh
        </button>
        <span className="text-xs text-gray-600">
          Disabled tools return 403 from <code className="bg-gray-100 px-1 rounded">POST /api/v1/mcp/execute</code>.
          Default is enabled.
        </span>
      </div>

      {err && <div className="mb-3 p-3 bg-red-50 border border-red-200 text-red-800 text-sm rounded">{err}</div>}

      <div className="bg-white border border-gray-200 rounded overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              {['Tool','Category','Description','State',''].map(h => (
                <th key={h} className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {loading && <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-500">Loading…</td></tr>}
            {!loading && visible.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-500">No MCP tools found.</td></tr>
            )}
            {!loading && visible.map(t => {
              const off = disabled.has(t.name)
              return (
                <tr key={t.name} className="hover:bg-gray-50">
                  <td className="px-3 py-2"><code className="text-xs font-mono">{t.name}</code></td>
                  <td className="px-3 py-2 text-xs text-gray-600">{t.category ?? '—'}</td>
                  <td className="px-3 py-2 text-xs text-gray-700 max-w-md truncate">{t.description ?? '—'}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                      off ? 'bg-gray-100 text-gray-600' : 'bg-green-100 text-green-800'
                    }`}>{off ? 'disabled' : 'enabled'}</span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => toggle(t.name)}
                      className={`text-xs ${off
                        ? 'text-green-600 hover:text-green-800'
                        : 'text-red-600 hover:text-red-800'}`}>
                      {off ? 'Enable' : 'Disable'}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Autosign Rules tab
// ═══════════════════════════════════════════════════════════════════════════

interface AutosignRule {
  id: string
  scope: 'global'|'client'|'project'
  client_id: string | null
  project_id: string | null
  system_type: string
  criteria_name: string
  criteria_kind: 'numeric'|'boolean'
  target_value: string | null
  tolerance_pct: string | null
  tolerance_abs: string | null
  unit: string | null
  expected_bool: boolean | null
  enabled: boolean
  baseline_min_samples: number
  novelty_z_threshold: string
}

function AutosignRulesTab({
  authHeaders, onToast,
}: { authHeaders: Record<string, string>; onToast?: (m: string, t?: string) => void }) {
  const [rows, setRows] = useState<AutosignRule[]>([])
  const [pagination, setPagination] = useState<Pagination>(EMPTY_PAGE)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function load(page = 1) {
    setLoading(true); setErr(null)
    try {
      const r = await fetch(`/api/v1/commissioning/autosign-rules?page=${page}`, { headers: authHeaders })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = await r.json()
      setRows(j.data || [])
      setPagination(j.pagination || EMPTY_PAGE)
    } catch (e) {
      setErr(String(e)); onToast?.('Failed to load rules', 'error')
    } finally { setLoading(false) }
  }

  useEffect(() => { load(1) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [])

  async function toggle(row: AutosignRule) {
    try {
      const r = await fetch(`/api/v1/commissioning/autosign-rules/${row.id}`, {
        method: 'PATCH',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !row.enabled }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      onToast?.(`${row.enabled ? 'Disabled' : 'Enabled'}: ${row.criteria_name}`, 'success')
      load(pagination.page)
    } catch (e) { onToast?.(String(e), 'error') }
  }

  return (
    <>
      <div className="mb-3 flex gap-2 items-center">
        <button onClick={() => load(pagination.page)}
          className="px-3 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded">Refresh</button>
        <span className="text-xs text-gray-600">
          Create rules via <code className="bg-gray-100 px-1 rounded">POST /api/v1/commissioning/autosign-rules</code>.
          Scope precedence: project &gt; client &gt; global.
        </span>
      </div>

      {err && <div className="mb-3 p-3 bg-red-50 border border-red-200 text-red-800 text-sm rounded">{err}</div>}

      <div className="bg-white border border-gray-200 rounded overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              {['Scope','System','Criterion','Kind','Target / Expected','Tolerance','z-thresh','Warmup','State',''].map(h => (
                <th key={h} className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {loading && <tr><td colSpan={10} className="px-3 py-6 text-center text-gray-500">Loading…</td></tr>}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={10} className="px-3 py-6 text-center text-gray-500">No rules yet.</td></tr>
            )}
            {!loading && rows.map(r => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td className="px-3 py-2 text-xs"><code>{r.scope}</code></td>
                <td className="px-3 py-2 text-xs font-mono">{r.system_type}</td>
                <td className="px-3 py-2 text-xs font-mono">{r.criteria_name}</td>
                <td className="px-3 py-2 text-xs">{r.criteria_kind}</td>
                <td className="px-3 py-2 text-xs font-mono">
                  {r.criteria_kind === 'boolean'
                    ? String(r.expected_bool)
                    : `${r.target_value}${r.unit ? ' ' + r.unit : ''}`}
                </td>
                <td className="px-3 py-2 text-xs font-mono">
                  {r.criteria_kind === 'numeric'
                    ? (r.tolerance_pct != null ? `±${r.tolerance_pct}%` : `±${r.tolerance_abs}`)
                    : '—'}
                </td>
                <td className="px-3 py-2 text-xs font-mono">{r.novelty_z_threshold}σ</td>
                <td className="px-3 py-2 text-xs font-mono">{r.baseline_min_samples}</td>
                <td className="px-3 py-2">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                    r.enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                    {r.enabled ? 'enabled' : 'disabled'}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  <button onClick={() => toggle(r)}
                    className="text-indigo-600 hover:text-indigo-800 text-xs">
                    {r.enabled ? 'Disable' : 'Enable'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="px-3 py-2 bg-gray-50 border-t border-gray-200 flex items-center justify-between text-xs text-gray-600">
          <span>Page {pagination.page} of {pagination.pages || 1} · {pagination.total.toLocaleString()} rules</span>
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
// Agent Actions tab (review queue)
// ═══════════════════════════════════════════════════════════════════════════

interface AgentAction {
  id: string
  agent_name: string
  action_type: string
  decision: string
  rationale: string
  target_type: string | null
  target_id: string | null
  evidence: Record<string, unknown>
  confidence: number | null
  human_reviewable: boolean
  reviewed_at: string | null
  review_outcome: string | null
  created_at: string
}

function AgentActionsTab({
  authHeaders, onToast,
}: { authHeaders: Record<string, string>; onToast?: (m: string, t?: string) => void }) {
  const [rows, setRows] = useState<AgentAction[]>([])
  const [pagination, setPagination] = useState<Pagination>(EMPTY_PAGE)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [showUnreviewed, setShowUnreviewed] = useState(true)
  const [selected, setSelected] = useState<AgentAction | null>(null)

  async function load(page = 1) {
    setLoading(true); setErr(null)
    try {
      const params = new URLSearchParams()
      params.set('page', String(page))
      if (showUnreviewed) params.set('reviewed', 'false')
      const r = await fetch(`/api/v1/agent-actions?${params}`, { headers: authHeaders })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = await r.json()
      setRows(j.data || [])
      setPagination(j.pagination || EMPTY_PAGE)
    } catch (e) {
      setErr(String(e)); onToast?.('Failed to load actions', 'error')
    } finally { setLoading(false) }
  }

  useEffect(() => { load(1) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [showUnreviewed])

  async function review(row: AgentAction, outcome: 'confirmed'|'overridden'|'reversed') {
    try {
      const r = await fetch(`/api/v1/agent-actions/${row.id}/review`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ outcome }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      onToast?.(`Marked ${outcome}`, 'success')
      setSelected(null); load(pagination.page)
    } catch (e) { onToast?.(String(e), 'error') }
  }

  const decisionCls = (d: string) => ({
    auto_pass:  'bg-green-100 text-green-800',
    auto_fail:  'bg-red-100 text-red-800',
    queued:     'bg-yellow-100 text-yellow-800',
    sent:       'bg-blue-100 text-blue-800',
    suppressed: 'bg-gray-100 text-gray-600',
  } as Record<string, string>)[d] ?? 'bg-gray-100 text-gray-800'

  return (
    <>
      <div className="mb-3 flex gap-3 items-center">
        <label className="text-xs flex items-center gap-1">
          <input type="checkbox" checked={showUnreviewed}
            onChange={e => setShowUnreviewed(e.target.checked)} />
          Unreviewed only
        </label>
        <button onClick={() => load(pagination.page)}
          className="px-3 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded">Refresh</button>
      </div>

      {err && <div className="mb-3 p-3 bg-red-50 border border-red-200 text-red-800 text-sm rounded">{err}</div>}

      <div className="bg-white border border-gray-200 rounded overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              {['Time','Agent','Action','Decision','Rationale','Confidence',''].map(h => (
                <th key={h} className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {loading && <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-500">Loading…</td></tr>}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-500">
                {showUnreviewed ? 'Nothing needs your review.' : 'No agent actions yet.'}
              </td></tr>
            )}
            {!loading && rows.map(r => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td className="px-3 py-2 text-xs text-gray-600 whitespace-nowrap">
                  {new Date(r.created_at).toLocaleString()}
                </td>
                <td className="px-3 py-2 text-xs font-mono">{r.agent_name}</td>
                <td className="px-3 py-2 text-xs font-mono">{r.action_type}</td>
                <td className="px-3 py-2">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${decisionCls(r.decision)}`}>
                    {r.decision}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs text-gray-700 max-w-md truncate">{r.rationale}</td>
                <td className="px-3 py-2 text-xs text-gray-600">
                  {r.confidence != null ? r.confidence.toFixed(2) : '—'}
                </td>
                <td className="px-3 py-2 text-right">
                  <button onClick={() => setSelected(r)}
                    className="text-indigo-600 hover:text-indigo-800 text-xs">Review</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="px-3 py-2 bg-gray-50 border-t border-gray-200 flex items-center justify-between text-xs text-gray-600">
          <span>Page {pagination.page} of {pagination.pages || 1} · {pagination.total.toLocaleString()} actions</span>
          <div className="flex gap-1">
            <button disabled={pagination.page <= 1 || loading} onClick={() => load(pagination.page - 1)}
              className="px-2 py-1 border border-gray-300 rounded disabled:opacity-50 hover:bg-gray-100">Prev</button>
            <button disabled={pagination.page >= pagination.pages || loading} onClick={() => load(pagination.page + 1)}
              className="px-2 py-1 border border-gray-300 rounded disabled:opacity-50 hover:bg-gray-100">Next</button>
          </div>
        </div>
      </div>

      {selected && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50"
          onClick={() => setSelected(null)}>
          <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full mx-4 max-h-[85vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}>
            <div className="px-5 py-3 border-b flex items-center justify-between">
              <h3 className="text-lg font-semibold">
                <code className="text-sm">{selected.agent_name}</code> ·{' '}
                <span className={`inline-block px-2 py-0.5 rounded text-xs ${decisionCls(selected.decision)}`}>
                  {selected.decision}
                </span>
              </h3>
              <button onClick={() => setSelected(null)}
                className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>
            <div className="p-5 space-y-3 text-sm">
              <div>
                <div className="text-xs font-medium text-gray-500 mb-1">Rationale</div>
                <p className="text-sm">{selected.rationale}</p>
              </div>
              {selected.evidence && Object.keys(selected.evidence).length > 0 && (
                <div>
                  <div className="text-xs font-medium text-gray-500 mb-1">Evidence</div>
                  <pre className="bg-gray-50 border border-gray-200 rounded p-2 text-xs overflow-x-auto">
{JSON.stringify(selected.evidence, null, 2)}
                  </pre>
                </div>
              )}
              <div className="flex gap-2 pt-3 border-t">
                {!selected.reviewed_at ? (
                  <>
                    <button onClick={() => review(selected, 'confirmed')}
                      className="px-3 py-1.5 text-sm bg-green-600 hover:bg-green-700 text-white rounded">
                      Confirm
                    </button>
                    <button onClick={() => review(selected, 'overridden')}
                      className="px-3 py-1.5 text-sm bg-amber-600 hover:bg-amber-700 text-white rounded">
                      Override
                    </button>
                    <button onClick={() => review(selected, 'reversed')}
                      className="px-3 py-1.5 text-sm bg-red-600 hover:bg-red-700 text-white rounded">
                      Reverse
                    </button>
                  </>
                ) : (
                  <div className="text-xs text-gray-600">
                    Already reviewed: <strong>{selected.review_outcome}</strong> on {new Date(selected.reviewed_at).toLocaleString()}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Baselines tab — confidence and warmup state
// ═══════════════════════════════════════════════════════════════════════════

interface Baseline {
  id: string
  scope: string
  system_type: string
  criteria_name: string
  sample_count: number
  mean_value: string | null
  std_dev: string | null
  p25_value: string | null
  p75_value: string | null
  min_observed: string | null
  max_observed: string | null
  window_days: number
  last_sample_at: string | null
  updated_at: string
  is_warm: boolean
}

function BaselinesTab({
  authHeaders, onToast,
}: { authHeaders: Record<string, string>; onToast?: (m: string, t?: string) => void }) {
  const [rows, setRows] = useState<Baseline[]>([])
  const [pagination, setPagination] = useState<Pagination>(EMPTY_PAGE)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function load(page = 1) {
    setLoading(true); setErr(null)
    try {
      const r = await fetch(`/api/v1/commissioning/baselines?page=${page}`, { headers: authHeaders })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = await r.json()
      setRows(j.data || [])
      setPagination(j.pagination || EMPTY_PAGE)
    } catch (e) {
      setErr(String(e)); onToast?.('Failed to load baselines', 'error')
    } finally { setLoading(false) }
  }

  useEffect(() => { load(1) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [])

  async function reset(row: Baseline) {
    if (!confirm(`Reset baseline for ${row.system_type} · ${row.criteria_name}? This drops all observations and restarts warmup.`)) return
    try {
      const r = await fetch(`/api/v1/commissioning/baselines/${row.id}`, {
        method: 'DELETE', headers: authHeaders,
      })
      if (!r.ok && r.status !== 204) throw new Error(`HTTP ${r.status}`)
      onToast?.('Baseline reset', 'success')
      load(pagination.page)
    } catch (e) { onToast?.(String(e), 'error') }
  }

  return (
    <>
      <div className="mb-3 flex gap-2 items-center">
        <button onClick={() => load(pagination.page)}
          className="px-3 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded">Refresh</button>
        <span className="text-xs text-gray-600">
          Statistical baselines for numeric criteria. Boolean criteria do not appear here.
        </span>
      </div>

      {err && <div className="mb-3 p-3 bg-red-50 border border-red-200 text-red-800 text-sm rounded">{err}</div>}

      <div className="bg-white border border-gray-200 rounded overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              {['Scope','System','Criterion','Samples','Mean','Std','IQR (p25 – p75)','Min / Max','Last sample','State',''].map(h => (
                <th key={h} className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {loading && <tr><td colSpan={11} className="px-3 py-6 text-center text-gray-500">Loading…</td></tr>}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={11} className="px-3 py-6 text-center text-gray-500">
                No baselines yet. They bootstrap on the first passing observation for any numeric rule.
              </td></tr>
            )}
            {!loading && rows.map(r => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td className="px-3 py-2 text-xs"><code>{r.scope}</code></td>
                <td className="px-3 py-2 text-xs font-mono">{r.system_type}</td>
                <td className="px-3 py-2 text-xs font-mono">{r.criteria_name}</td>
                <td className="px-3 py-2 text-xs font-mono">{r.sample_count}</td>
                <td className="px-3 py-2 text-xs font-mono">{fmtNum(r.mean_value)}</td>
                <td className="px-3 py-2 text-xs font-mono">{fmtNum(r.std_dev)}</td>
                <td className="px-3 py-2 text-xs font-mono text-gray-600">
                  {fmtNum(r.p25_value)} – {fmtNum(r.p75_value)}
                </td>
                <td className="px-3 py-2 text-xs font-mono text-gray-600">
                  {fmtNum(r.min_observed)} / {fmtNum(r.max_observed)}
                </td>
                <td className="px-3 py-2 text-xs text-gray-600 whitespace-nowrap">
                  {r.last_sample_at ? new Date(r.last_sample_at).toLocaleString() : '—'}
                </td>
                <td className="px-3 py-2">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                    r.is_warm ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
                    {r.is_warm ? 'warm' : 'warmup'}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  <button onClick={() => reset(r)}
                    className="text-red-600 hover:text-red-800 text-xs">Reset</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="px-3 py-2 bg-gray-50 border-t border-gray-200 flex items-center justify-between text-xs text-gray-600">
          <span>Page {pagination.page} of {pagination.pages || 1} · {pagination.total.toLocaleString()} baselines</span>
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

function fmtNum(v: string | null): string {
  if (v == null) return '—'
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return Math.abs(n) >= 1_000 ? n.toFixed(0) : n.toFixed(3).replace(/\.?0+$/, '')
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function formatInterval(secs: number): string {
  if (secs < 60)    return `${secs}s`
  if (secs < 3600)  return `${Math.round(secs / 60)}m`
  if (secs < 86400) return `${Math.round(secs / 3600)}h`
  return `${Math.round(secs / 86400)}d`
}
