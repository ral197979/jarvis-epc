/**
 * ComplianceView — v4.31.0
 *
 * List + create + mark-complete UI for compliance_tasks. Pairs with the
 * complianceWatcher service: any task this page creates will auto-fire
 * webhook events (`compliance.task_due`, `compliance.task_overdue`)
 * as it crosses its notify window and due date.
 */

import React, { useState, useEffect, useMemo } from 'react'

interface ComplianceTask {
  id:                 string
  project_id:         string | null
  title:              string
  description:        string | null
  category:           string
  due_date:           string
  notify_days_before: number
  status:             'pending' | 'notified' | 'overdue' | 'completed' | 'waived'
  last_notified_at:   string | null
  completed_at:       string | null
  assigned_to:        string | null
  created_at:         string
  updated_at:         string
}

interface Pagination { page: number; limit: number; total: number; pages: number }
const EMPTY_PAGE: Pagination = { page: 1, limit: 50, total: 0, pages: 0 }

const CATEGORIES = ['general','jha','sds','permit','training','inspection','audit']

interface ComplianceViewProps {
  onToast?: (m: string, t?: string) => void
}

export default function ComplianceView({ onToast }: ComplianceViewProps) {
  const [rows, setRows] = useState<ComplianceTask[]>([])
  const [pagination, setPagination] = useState<Pagination>(EMPTY_PAGE)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [showCreate, setShowCreate] = useState(false)

  const token = useMemo(() => {
    try { return localStorage.getItem('jarvis_token') || '' } catch { return '' }
  }, [])
  const authHeaders = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token])

  async function load(page = 1) {
    setLoading(true); setErr(null)
    try {
      const params = new URLSearchParams()
      params.set('page', String(page))
      params.set('limit', String(pagination.limit))
      if (statusFilter)   params.set('status',   statusFilter)
      if (categoryFilter) params.set('category', categoryFilter)
      const r = await fetch(`/api/v1/compliance-tasks?${params}`, { headers: authHeaders })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = await r.json()
      setRows(j.data || [])
      setPagination(j.pagination || EMPTY_PAGE)
    } catch (e) {
      setErr(String(e)); onToast?.('Failed to load compliance tasks', 'error')
    } finally { setLoading(false) }
  }

  useEffect(() => { load(1) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [])

  const stats = useMemo(() => ({
    pending:   rows.filter(r => r.status === 'pending').length,
    due_soon:  rows.filter(r => r.status === 'notified').length,
    overdue:   rows.filter(r => r.status === 'overdue').length,
    completed: rows.filter(r => r.status === 'completed').length,
  }), [rows])

  async function complete(row: ComplianceTask) {
    try {
      const r = await fetch(`/api/v1/compliance-tasks/${row.id}/complete`, {
        method: 'POST', headers: authHeaders,
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      onToast?.(`Completed: ${row.title}`, 'success')
      load(pagination.page)
    } catch (e) { onToast?.(String(e), 'error') }
  }

  async function waive(row: ComplianceTask) {
    if (!confirm(`Waive "${row.title}"? This is admin-only and terminal.`)) return
    try {
      const r = await fetch(`/api/v1/compliance-tasks/${row.id}/waive`, {
        method: 'POST', headers: authHeaders,
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      onToast?.(`Waived: ${row.title}`, 'success')
      load(pagination.page)
    } catch (e) { onToast?.(String(e), 'error') }
  }

  async function remove(row: ComplianceTask) {
    if (!confirm(`Delete "${row.title}"? This cannot be undone.`)) return
    try {
      const r = await fetch(`/api/v1/compliance-tasks/${row.id}`, {
        method: 'DELETE', headers: authHeaders,
      })
      if (!r.ok && r.status !== 204) throw new Error(`HTTP ${r.status}`)
      onToast?.(`Deleted: ${row.title}`, 'success')
      load(pagination.page)
    } catch (e) { onToast?.(String(e), 'error') }
  }

  const statusCls = (s: ComplianceTask['status']) => ({
    pending:   'bg-gray-100 text-gray-700',
    notified:  'bg-yellow-100 text-yellow-800',
    overdue:   'bg-red-100 text-red-800',
    completed: 'bg-green-100 text-green-800',
    waived:    'bg-purple-100 text-purple-800',
  }[s])

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Compliance Tasks</h2>
          <p className="text-sm text-gray-600">
            JHAs, permits, training, inspections. Events fire via webhooks when tasks enter
            the notify window or become overdue.
          </p>
        </div>
        <button onClick={() => setShowCreate(v => !v)}
          className="px-3 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded">
          {showCreate ? 'Cancel' : '+ New Task'}
        </button>
      </div>

      <div className="grid grid-cols-4 gap-3 mb-4">
        <StatCard label="Pending"   value={stats.pending}   />
        <StatCard label="Due Soon"  value={stats.due_soon}  tone="yellow" />
        <StatCard label="Overdue"   value={stats.overdue}   tone="red" />
        <StatCard label="Completed" value={stats.completed} tone="green" />
      </div>

      {showCreate && (
        <CreateTaskForm authHeaders={authHeaders} onToast={onToast}
          onCreated={() => { setShowCreate(false); load(1) }} />
      )}

      <div className="mb-3 p-3 bg-white border border-gray-200 rounded flex gap-3 items-end">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1 text-sm">
            <option value="">All</option>
            {['pending','notified','overdue','completed','waived'].map(s =>
              <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Category</label>
          <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1 text-sm">
            <option value="">All</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <button onClick={() => load(1)}
          className="px-3 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded">Apply</button>
        <button onClick={() => { setStatusFilter(''); setCategoryFilter(''); setTimeout(() => load(1), 0) }}
          className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded border border-gray-300">Clear</button>
      </div>

      {err && <div className="mb-3 p-3 bg-red-50 border border-red-200 text-red-800 text-sm rounded">{err}</div>}

      <div className="bg-white border border-gray-200 rounded overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                {['Title','Category','Due','Notify -n days','Status','Last Notified',''].map(h => (
                  <th key={h} className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {loading && <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-500">Loading…</td></tr>}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-500">No tasks. Create one to start tracking.</td></tr>
              )}
              {!loading && rows.map(r => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-medium text-gray-900">{r.title}</td>
                  <td className="px-3 py-2 text-gray-700 text-xs"><code>{r.category}</code></td>
                  <td className="px-3 py-2 text-gray-700 text-xs whitespace-nowrap">
                    {r.due_date ? new Date(r.due_date).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-3 py-2 text-gray-600 text-xs text-center">{r.notify_days_before}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${statusCls(r.status)}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-gray-600 text-xs whitespace-nowrap">
                    {r.last_notified_at ? new Date(r.last_notified_at).toLocaleString() : '—'}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {r.status !== 'completed' && r.status !== 'waived' && (
                      <>
                        <button onClick={() => complete(r)}
                          className="text-green-600 hover:text-green-800 text-xs mr-3">Complete</button>
                        <button onClick={() => waive(r)}
                          className="text-purple-600 hover:text-purple-800 text-xs mr-3">Waive</button>
                      </>
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
          <span>Page {pagination.page} of {pagination.pages || 1} · {pagination.total.toLocaleString()} tasks</span>
          <div className="flex gap-1">
            <button disabled={pagination.page <= 1 || loading} onClick={() => load(pagination.page - 1)}
              className="px-2 py-1 border border-gray-300 rounded disabled:opacity-50 hover:bg-gray-100">Prev</button>
            <button disabled={pagination.page >= pagination.pages || loading} onClick={() => load(pagination.page + 1)}
              className="px-2 py-1 border border-gray-300 rounded disabled:opacity-50 hover:bg-gray-100">Next</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Subcomponents ────────────────────────────────────────────────────────────

function StatCard({ label, value, tone }: { label: string; value: number; tone?: string }) {
  const toneCls = tone === 'yellow' ? 'text-yellow-700'
    : tone === 'red'   ? 'text-red-700'
    : tone === 'green' ? 'text-green-700'
    : 'text-gray-900'
  return (
    <div className="bg-white border border-gray-200 rounded p-3">
      <div className="text-xs text-gray-500 uppercase">{label}</div>
      <div className={`text-2xl font-bold ${toneCls}`}>{value}</div>
    </div>
  )
}

function CreateTaskForm({
  authHeaders, onToast, onCreated,
}: {
  authHeaders: Record<string, string>
  onToast?: (m: string, t?: string) => void
  onCreated: () => void
}) {
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('general')
  const [dueDate, setDueDate] = useState('')
  const [notifyDays, setNotifyDays] = useState('7')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!title || !dueDate) { onToast?.('Title and due date required', 'error'); return }
    setSubmitting(true)
    try {
      const r = await fetch('/api/v1/compliance-tasks', {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title, category, due_date: dueDate,
          notify_days_before: Number(notifyDays) || 7,
          description: description || undefined,
        }),
      })
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.message || `HTTP ${r.status}`) }
      onToast?.('Task created', 'success')
      onCreated()
    } catch (e) { onToast?.(String(e), 'error') }
    finally { setSubmitting(false) }
  }

  return (
    <form onSubmit={submit} className="mb-4 p-4 bg-white border border-gray-200 rounded">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="md:col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">Title</label>
          <input value={title} onChange={e => setTitle(e.target.value)}
            placeholder="e.g. Annual JHA review — Site A"
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Category</label>
          <select value={category} onChange={e => setCategory(e.target.value)}
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm">
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Due Date</label>
          <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm" />
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Notify -n days</label>
          <input type="number" min={0} value={notifyDays} onChange={e => setNotifyDays(e.target.value)}
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm" />
        </div>
        <div className="md:col-span-3">
          <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
          <input value={description} onChange={e => setDescription(e.target.value)}
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm" />
        </div>
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
