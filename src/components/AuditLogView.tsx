/**
 * AuditLogView — v4.30.0
 * Tenant-scoped audit_log reader.
 * Filters: action, resource, user, date range, free text search.
 * CSV export via shared src/utils/csv.ts.
 */
import React, { useState, useEffect, useMemo } from 'react';
import { downloadCsv } from '../utils/csv';

interface AuditRow {
  id: string;
  tenant_id: string;
  user_id: string | null;
  user_name: string | null;
  user_email: string | null;
  action: string;
  resource: string;
  resource_id: string | null;
  old_data: unknown;
  new_data: unknown;
  ip_address: string | null;
  user_agent: string | null;
  request_id: string | null;
  created_at: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

const DEFAULT_ACTIONS = [
  'create','read','update','delete','login','logout','export',
  'approve','reject','upload','download','integrate_push','integrate_pull',
];

interface AuditLogViewProps {
  onToast?: (m: string, t?: string) => void;
  onAudit?: (e: unknown) => void;
}

export default function AuditLogView({ onToast, onAudit }: AuditLogViewProps) {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 50, total: 0, pages: 0 });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<AuditRow | null>(null);

  // Filters
  const [action, setAction] = useState('');
  const [resource, setResource] = useState('');
  const [userId, setUserId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [actions, setActions] = useState<string[]>(DEFAULT_ACTIONS);

  const token = useMemo(() => {
    try { return localStorage.getItem('jarvis_token') || ''; } catch { return ''; }
  }, []);

  async function load(page = 1) {
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', String(pagination.limit));
      if (action)   params.set('action', action);
      if (resource) params.set('resource', resource);
      if (userId)   params.set('user_id', userId);
      if (from)     params.set('from', new Date(from).toISOString());
      if (to)       params.set('to', new Date(to).toISOString());
      if (search)   params.set('search', search);

      const res = await fetch(`/api/v1/audit?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      setRows(j.data || []);
      setPagination(j.pagination || { page, limit: 50, total: 0, pages: 0 });
      onAudit?.({ kind: 'audit.view.list', count: (j.data || []).length, filters: { action, resource, userId, from, to, search } });
    } catch (e) {
      setErr(String(e));
      onToast?.('Failed to load audit log', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function loadActions() {
    try {
      const res = await fetch('/api/v1/audit/_meta/actions', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const j = await res.json();
      if (Array.isArray(j.actions) && j.actions.length) setActions(j.actions);
    } catch { /* keep DEFAULT_ACTIONS */ }
  }

  useEffect(() => { loadActions(); load(1);   }, []);

  function applyFilters(e: React.FormEvent) {
    e.preventDefault();
    load(1);
  }

  function clearFilters() {
    setAction(''); setResource(''); setUserId(''); setFrom(''); setTo(''); setSearch('');
    setTimeout(() => load(1), 0);
  }

  function exportCsv() {
    if (!rows.length) { onToast?.('No rows to export', 'info'); return; }
    const flat = rows.map(r => ({
      id: r.id,
      created_at: r.created_at,
      action: r.action,
      resource: r.resource,
      resource_id: r.resource_id || '',
      user_id: r.user_id || '',
      user_name: r.user_name || '',
      user_email: r.user_email || '',
      ip_address: r.ip_address || '',
      user_agent: r.user_agent || '',
      request_id: r.request_id || '',
    }));
    downloadCsv(`audit_log_${new Date().toISOString().slice(0,10)}`, flat);
    onAudit?.({ kind: 'audit.export', count: flat.length });
    onToast?.(`Exported ${flat.length} rows`, 'success');
  }

  const badgeCls = (a: string) => {
    switch (a) {
      case 'create':         return 'bg-green-100 text-green-800';
      case 'update':         return 'bg-blue-100 text-blue-800';
      case 'delete':         return 'bg-red-100 text-red-800';
      case 'approve':        return 'bg-emerald-100 text-emerald-800';
      case 'reject':         return 'bg-rose-100 text-rose-800';
      case 'login':          return 'bg-indigo-100 text-indigo-800';
      case 'logout':         return 'bg-slate-100 text-slate-800';
      case 'export':
      case 'download':       return 'bg-amber-100 text-amber-800';
      case 'upload':         return 'bg-cyan-100 text-cyan-800';
      case 'integrate_push':
      case 'integrate_pull': return 'bg-purple-100 text-purple-800';
      default:               return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Audit Log</h2>
          <p className="text-sm text-gray-600">
            Tenant-scoped activity trail. {pagination.total.toLocaleString()} events.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={exportCsv}
            className="px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded border border-gray-300"
          >
            Export CSV
          </button>
          <button
            onClick={() => load(pagination.page)}
            className="px-3 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded"
          >
            Refresh
          </button>
        </div>
      </div>

      <form onSubmit={applyFilters} className="mb-4 p-4 bg-white border border-gray-200 rounded">
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Action</label>
            <select value={action} onChange={e => setAction(e.target.value)}
                    className="w-full border border-gray-300 rounded px-2 py-1 text-sm">
              <option value="">All</option>
              {actions.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Resource</label>
            <input value={resource} onChange={e => setResource(e.target.value)}
                   placeholder="e.g. projects"
                   className="w-full border border-gray-300 rounded px-2 py-1 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">User ID</label>
            <input value={userId} onChange={e => setUserId(e.target.value)}
                   placeholder="uuid"
                   className="w-full border border-gray-300 rounded px-2 py-1 text-sm font-mono" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">From</label>
            <input type="datetime-local" value={from} onChange={e => setFrom(e.target.value)}
                   className="w-full border border-gray-300 rounded px-2 py-1 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">To</label>
            <input type="datetime-local" value={to} onChange={e => setTo(e.target.value)}
                   className="w-full border border-gray-300 rounded px-2 py-1 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Search</label>
            <input value={search} onChange={e => setSearch(e.target.value)}
                   placeholder="resource / request-id / UA"
                   className="w-full border border-gray-300 rounded px-2 py-1 text-sm" />
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <button type="submit"
                  className="px-3 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded">
            Apply
          </button>
          <button type="button" onClick={clearFilters}
                  className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded border border-gray-300">
            Clear
          </button>
        </div>
      </form>

      {err && (
        <div className="mb-3 p-3 bg-red-50 border border-red-200 text-red-800 text-sm rounded">
          {err}
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Time</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Action</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Resource</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Resource ID</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">IP</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Request</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {loading && (
                <tr><td colSpan={8} className="px-3 py-6 text-center text-gray-500">Loading…</td></tr>
              )}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-6 text-center text-gray-500">No events.</td></tr>
              )}
              {!loading && rows.map(r => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 whitespace-nowrap text-gray-700">
                    {new Date(r.created_at).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${badgeCls(r.action)}`}>
                      {r.action}
                    </span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-900">{r.resource}</td>
                  <td className="px-3 py-2 whitespace-nowrap font-mono text-xs text-gray-600">
                    {r.resource_id ? r.resource_id.slice(0, 8) : '—'}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-700">
                    {r.user_name || r.user_email || (r.user_id ? r.user_id.slice(0, 8) : 'system')}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-600 font-mono text-xs">
                    {r.ip_address || '—'}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-600 font-mono text-xs">
                    {r.request_id || '—'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => setSelected(r)}
                      className="text-indigo-600 hover:text-indigo-800 text-xs">
                      Details
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="px-3 py-2 bg-gray-50 border-t border-gray-200 flex items-center justify-between text-xs text-gray-600">
          <span>
            Page {pagination.page} of {pagination.pages || 1} · {pagination.total.toLocaleString()} events
          </span>
          <div className="flex gap-1">
            <button
              disabled={pagination.page <= 1 || loading}
              onClick={() => load(pagination.page - 1)}
              className="px-2 py-1 border border-gray-300 rounded disabled:opacity-50 hover:bg-gray-100">
              Prev
            </button>
            <button
              disabled={pagination.page >= pagination.pages || loading}
              onClick={() => load(pagination.page + 1)}
              className="px-2 py-1 border border-gray-300 rounded disabled:opacity-50 hover:bg-gray-100">
              Next
            </button>
          </div>
        </div>
      </div>

      {selected && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50"
             onClick={() => setSelected(null)}>
          <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full mx-4 max-h-[85vh] overflow-y-auto"
               onClick={e => e.stopPropagation()}>
            <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold">
                <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium mr-2 ${badgeCls(selected.action)}`}>
                  {selected.action}
                </span>
                {selected.resource}
              </h3>
              <button onClick={() => setSelected(null)}
                      className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>
            <div className="p-5 space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div><div className="text-xs text-gray-500">Event ID</div><div className="font-mono text-xs">{selected.id}</div></div>
                <div><div className="text-xs text-gray-500">Time</div><div>{new Date(selected.created_at).toLocaleString()}</div></div>
                <div><div className="text-xs text-gray-500">Resource ID</div><div className="font-mono text-xs">{selected.resource_id || '—'}</div></div>
                <div><div className="text-xs text-gray-500">Request ID</div><div className="font-mono text-xs">{selected.request_id || '—'}</div></div>
                <div><div className="text-xs text-gray-500">User</div><div>{selected.user_name || selected.user_email || '—'}</div></div>
                <div><div className="text-xs text-gray-500">IP</div><div className="font-mono text-xs">{selected.ip_address || '—'}</div></div>
                <div className="col-span-2">
                  <div className="text-xs text-gray-500">User Agent</div>
                  <div className="font-mono text-xs break-all">{selected.user_agent || '—'}</div>
                </div>
              </div>
              {(selected.old_data !== null && selected.old_data !== undefined) && (
                <div>
                  <div className="text-xs font-medium text-gray-500 mb-1">Old Data</div>
                  <pre className="bg-red-50 border border-red-100 rounded p-2 text-xs overflow-x-auto">
{JSON.stringify(selected.old_data, null, 2)}
                  </pre>
                </div>
              )}
              {(selected.new_data !== null && selected.new_data !== undefined) && (
                <div>
                  <div className="text-xs font-medium text-gray-500 mb-1">New Data</div>
                  <pre className="bg-green-50 border border-green-100 rounded p-2 text-xs overflow-x-auto">
{JSON.stringify(selected.new_data, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
