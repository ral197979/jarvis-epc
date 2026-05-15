/**
 * Denver Engineering — Change Orders View (v10.7.0)
 * ────────────────────────────────────────────────────
 * List, create, submit, approve, reject, and void change orders.
 * Workflow: draft → submitted → approved | rejected → (void)
 */
import React, { useState, useEffect, useCallback } from 'react'
import { useBizStore, selectProjects } from '../../modules/biz/store'

// ─── Types ────────────────────────────────────────────────────────────────────

type CoStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'void'
type CoType   = 'scope' | 'time' | 'cost' | 'scope_time_cost'

interface ChangeOrder {
  id: string
  coNumber: number
  title: string
  description: string | null
  type: CoType
  status: CoStatus
  costImpact: number
  scheduleImpactDays: number
  reason: string | null
  submittedBy: string | null
  submittedAt: string | null
  reviewedBy: string | null
  reviewedAt: string | null
  reviewNotes: string | null
  createdAt: string
  linkedTaskCount?: number
}

interface CoSummary {
  total: number
  byStatus: Record<CoStatus, number>
  approvedCostImpact: number
  pendingCostImpact: number
  approvedScheduleImpact: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<CoStatus, string> = {
  draft:     '#6c757d',
  submitted: '#0d6efd',
  approved:  '#198754',
  rejected:  '#dc3545',
  void:      '#adb5bd',
}

const TYPE_LABELS: Record<CoType, string> = {
  scope:           'Scope',
  time:            'Time',
  cost:            'Cost',
  scope_time_cost: 'Scope + Time + Cost',
}

function fmt$(n: number) {
  const abs = Math.abs(n)
  const s = abs >= 1e6
    ? `$${(abs / 1e6).toFixed(2)}M`
    : abs >= 1e3
    ? `$${(abs / 1e3).toFixed(1)}K`
    : `$${abs.toFixed(2)}`
  return n < 0 ? `-${s}` : s
}

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ─── Badge ────────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: CoStatus }) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 10,
      fontSize: 11, fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase',
      background: STATUS_COLORS[status] + '22', color: STATUS_COLORS[status], border: `1px solid ${STATUS_COLORS[status]}44`,
    }}>
      {status}
    </span>
  )
}

// ─── Summary bar ─────────────────────────────────────────────────────────────

function SummaryBar({ summary, onFilter }: { summary: CoSummary; onFilter: (status: string) => void }) {
  const tiles = [
    { label: 'Total COs',          value: summary.total,                        color: '#aaa',    filter: 'all' },
    { label: 'Submitted',          value: summary.byStatus.submitted,            color: '#0d6efd', filter: 'submitted' },
    { label: 'Approved',           value: summary.byStatus.approved,             color: '#198754', filter: 'approved' },
    { label: 'Approved Cost Δ',    value: fmt$(summary.approvedCostImpact),      color: summary.approvedCostImpact >= 0 ? '#e74c3c' : '#27ae60', filter: '' },
    { label: 'Pending Cost Δ',     value: fmt$(summary.pendingCostImpact),       color: '#f39c12', filter: '' },
    { label: 'Schedule Δ (days)',  value: summary.approvedScheduleImpact + 'd',  color: summary.approvedScheduleImpact > 0 ? '#e74c3c' : '#27ae60', filter: '' },
  ]
  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
      {tiles.map(t => (
        <div key={t.label} onClick={t.filter ? () => onFilter(t.filter) : undefined}
          style={{
            background: 'var(--jarvis-surface, #1a1a1a)', border: '1px solid var(--jarvis-border, #333)',
            borderRadius: 8, padding: '10px 16px', minWidth: 110,
            cursor: t.filter ? 'pointer' : 'default',
          }}
          onMouseEnter={t.filter ? e => (e.currentTarget.style.opacity = '.75') : undefined}
          onMouseLeave={t.filter ? e => (e.currentTarget.style.opacity = '1') : undefined}
        >
          <div style={{ fontSize: 11, color: 'var(--jarvis-ts, #888)', marginBottom: 4 }}>{t.label}</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: t.color }}>{t.value}</div>
        </div>
      ))}
    </div>
  )
}

// ─── CO row ───────────────────────────────────────────────────────────────────

function CoRow({ co, onSelect }: { co: ChangeOrder; onSelect: () => void }) {
  return (
    <tr
      onClick={onSelect}
      style={{ cursor: 'pointer', borderBottom: '1px solid var(--jarvis-border, #2a2a2a)' }}
    >
      <td style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--jarvis-accent, #3b82f6)' }}>
        CO-{String(co.coNumber).padStart(3, '0')}
      </td>
      <td style={{ padding: '10px 12px' }}>{co.title}</td>
      <td style={{ padding: '10px 12px', color: '#aaa', fontSize: 12 }}>{TYPE_LABELS[co.type]}</td>
      <td style={{ padding: '10px 12px' }}><StatusBadge status={co.status} /></td>
      <td style={{ padding: '10px 12px', textAlign: 'right', color: co.costImpact > 0 ? '#e74c3c' : co.costImpact < 0 ? '#27ae60' : '#aaa' }}>
        {co.costImpact !== 0 ? fmt$(co.costImpact) : '—'}
      </td>
      <td style={{ padding: '10px 12px', textAlign: 'right', color: co.scheduleImpactDays > 0 ? '#e74c3c' : co.scheduleImpactDays < 0 ? '#27ae60' : '#aaa' }}>
        {co.scheduleImpactDays !== 0 ? `${co.scheduleImpactDays > 0 ? '+' : ''}${co.scheduleImpactDays}d` : '—'}
      </td>
      <td style={{ padding: '10px 12px', color: '#888', fontSize: 12 }}>{fmtDate(co.createdAt)}</td>
    </tr>
  )
}

// ─── Create modal ─────────────────────────────────────────────────────────────

function CreateModal({ projectId, onClose, onCreated }: { projectId: string; onClose: () => void; onCreated: (co: ChangeOrder) => void }) {
  const [form, setForm] = useState({
    title: '', description: '', type: 'scope' as CoType,
    costImpact: '', scheduleImpactDays: '', reason: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const submit = async () => {
    if (!form.title.trim()) { setError('Title is required'); return }
    setSaving(true); setError('')
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/change-orders`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title.trim(),
          description: form.description.trim() || undefined,
          type: form.type,
          costImpact: form.costImpact ? Number(form.costImpact) : undefined,
          scheduleImpactDays: form.scheduleImpactDays ? Number(form.scheduleImpactDays) : undefined,
          reason: form.reason.trim() || undefined,
        }),
      })
      if (!res.ok) throw new Error(await res.text())
      const json = await res.json()
      onCreated(json.changeOrder)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'var(--jarvis-bg, #111)', border: '1px solid var(--jarvis-border, #333)', borderRadius: 12, padding: 24, width: 540, maxWidth: '95vw' }}>
        <h3 style={{ margin: '0 0 20px', fontSize: 16, color: 'var(--jarvis-text, #eee)' }}>New Change Order</h3>
        {error && <div style={{ color: '#e74c3c', fontSize: 12, marginBottom: 12 }}>{error}</div>}

        {([
          { label: 'Title *', key: 'title', type: 'text' },
        ] as const).map(f => (
          <div key={f.key} style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: 11, color: '#888', marginBottom: 4 }}>{f.label}</label>
            <input value={form[f.key]} onChange={set(f.key)} type={f.type}
              style={{ width: '100%', background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, padding: '7px 10px', color: '#eee', fontSize: 13, boxSizing: 'border-box' }} />
          </div>
        ))}

        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', fontSize: 11, color: '#888', marginBottom: 4 }}>Type</label>
          <select value={form.type} onChange={set('type')}
            style={{ width: '100%', background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, padding: '7px 10px', color: '#eee', fontSize: 13 }}>
            <option value="scope">Scope</option>
            <option value="time">Time</option>
            <option value="cost">Cost</option>
            <option value="scope_time_cost">Scope + Time + Cost</option>
          </select>
        </div>

        <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', fontSize: 11, color: '#888', marginBottom: 4 }}>Cost Impact ($)</label>
            <input value={form.costImpact} onChange={set('costImpact')} type="number"
              placeholder="0 (negative = credit)"
              style={{ width: '100%', background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, padding: '7px 10px', color: '#eee', fontSize: 13, boxSizing: 'border-box' }} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', fontSize: 11, color: '#888', marginBottom: 4 }}>Schedule Impact (days)</label>
            <input value={form.scheduleImpactDays} onChange={set('scheduleImpactDays')} type="number"
              placeholder="0 (negative = acceleration)"
              style={{ width: '100%', background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, padding: '7px 10px', color: '#eee', fontSize: 13, boxSizing: 'border-box' }} />
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', fontSize: 11, color: '#888', marginBottom: 4 }}>Description</label>
          <textarea value={form.description} onChange={set('description')} rows={2}
            style={{ width: '100%', background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, padding: '7px 10px', color: '#eee', fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }} />
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', fontSize: 11, color: '#888', marginBottom: 4 }}>Reason / Justification</label>
          <textarea value={form.reason} onChange={set('reason')} rows={2}
            style={{ width: '100%', background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, padding: '7px 10px', color: '#eee', fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }} />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={{ padding: '8px 16px', background: 'transparent', border: '1px solid #444', borderRadius: 6, color: '#aaa', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
          <button onClick={submit} disabled={saving}
            style={{ padding: '8px 16px', background: '#3b82f6', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer', fontSize: 13, opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Creating…' : 'Create CO'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Detail / action panel ────────────────────────────────────────────────────

function DetailPanel({ co, onClose, onUpdated }: { co: ChangeOrder; onClose: () => void; onUpdated: (co: ChangeOrder) => void }) {
  const [reviewNotes, setReviewNotes] = useState('')
  const [acting, setActing] = useState(false)
  const [error, setError] = useState('')

  const action = async (verb: string) => {
    setActing(true); setError('')
    try {
      const res = await fetch(`/api/v1/change-orders/${co.id}/${verb}`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reviewNotes ? { reviewNotes } : {}),
      })
      if (!res.ok) throw new Error(await res.text())
      const json = await res.json()
      onUpdated(json.changeOrder)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setActing(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end' }}>
      <div style={{ background: 'var(--jarvis-bg, #111)', border: '1px solid var(--jarvis-border, #333)', borderLeft: '1px solid #2a2a2a', width: 460, minHeight: '100vh', padding: 24, overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 15, color: 'var(--jarvis-text, #eee)' }}>
            CO-{String(co.coNumber).padStart(3, '0')} — {co.title}
          </h3>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#aaa', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>✕</button>
        </div>

        <div style={{ marginBottom: 16 }}><StatusBadge status={co.status} /></div>

        {error && <div style={{ color: '#e74c3c', fontSize: 12, marginBottom: 12 }}>{error}</div>}

        <dl style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: '8px 12px', fontSize: 13, margin: '0 0 20px' }}>
          {[
            ['Type',           TYPE_LABELS[co.type]],
            ['Cost Impact',    co.costImpact !== 0 ? fmt$(co.costImpact) : '—'],
            ['Schedule Δ',     co.scheduleImpactDays !== 0 ? `${co.scheduleImpactDays > 0 ? '+' : ''}${co.scheduleImpactDays} days` : '—'],
            ['Created',        fmtDate(co.createdAt)],
            ['Submitted',      co.submittedAt ? fmtDate(co.submittedAt) : '—'],
            ['Reviewed',       co.reviewedAt  ? fmtDate(co.reviewedAt)  : '—'],
            ['Linked Tasks',   co.linkedTaskCount ?? 0],
          ].map(([k, v]) => (
            <React.Fragment key={String(k)}>
              <dt style={{ color: '#888', margin: 0 }}>{k}</dt>
              <dd style={{ color: '#eee', margin: 0 }}>{v}</dd>
            </React.Fragment>
          ))}
        </dl>

        {co.description && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Description</div>
            <div style={{ fontSize: 13, color: '#ccc', lineHeight: 1.5 }}>{co.description}</div>
          </div>
        )}

        {co.reason && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Reason / Justification</div>
            <div style={{ fontSize: 13, color: '#ccc', lineHeight: 1.5 }}>{co.reason}</div>
          </div>
        )}

        {co.reviewNotes && (
          <div style={{ marginBottom: 16, padding: 12, background: '#1a1a1a', borderRadius: 6, border: '1px solid #2a2a2a' }}>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Review Notes</div>
            <div style={{ fontSize: 13, color: '#ccc', lineHeight: 1.5 }}>{co.reviewNotes}</div>
          </div>
        )}

        {/* Workflow actions */}
        {(co.status === 'submitted') && (
          <div style={{ marginTop: 20 }}>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>Review Notes</div>
            <textarea value={reviewNotes} onChange={e => setReviewNotes(e.target.value)} rows={3}
              placeholder="Optional notes for the submitter…"
              style={{ width: '100%', background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, padding: '7px 10px', color: '#eee', fontSize: 13, resize: 'vertical', boxSizing: 'border-box', marginBottom: 12 }} />
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => action('approve')} disabled={acting}
                style={{ flex: 1, padding: '8px 0', background: '#198754', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer', fontSize: 13, opacity: acting ? 0.6 : 1 }}>
                ✓ Approve
              </button>
              <button onClick={() => action('reject')} disabled={acting}
                style={{ flex: 1, padding: '8px 0', background: '#dc3545', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer', fontSize: 13, opacity: acting ? 0.6 : 1 }}>
                ✕ Reject
              </button>
            </div>
          </div>
        )}

        {co.status === 'draft' && (
          <div style={{ marginTop: 20 }}>
            <button onClick={() => action('submit')} disabled={acting}
              style={{ width: '100%', padding: '9px 0', background: '#0d6efd', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer', fontSize: 13, opacity: acting ? 0.6 : 1 }}>
              Submit for Review
            </button>
          </div>
        )}

        {(co.status === 'approved' || co.status === 'rejected') && (
          <div style={{ marginTop: 20 }}>
            <button onClick={() => action('void')} disabled={acting}
              style={{ width: '100%', padding: '9px 0', background: '#6c757d', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer', fontSize: 13, opacity: acting ? 0.6 : 1 }}>
              Void CO
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main view ────────────────────────────────────────────────────────────────

export function ChangeOrdersView() {
  const projects = useBizStore(selectProjects)

  const [projectId, setProjectId] = useState<string>('')
  const [items, setItems]         = useState<ChangeOrder[]>([])
  const [summary, setSummary]     = useState<CoSummary | null>(null)
  const [loading, setLoading]     = useState(false)
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [showCreate, setShowCreate]     = useState(false)
  const [selected, setSelected]         = useState<ChangeOrder | null>(null)

  // Restore persisted project
  useEffect(() => {
    const saved = localStorage.getItem('jarvis-active-project')
    if (saved && projects.some(p => p.id === saved)) {
      setProjectId(saved)
    } else if (projects.length > 0 && projects[0]) {
      setProjectId(projects[0].id)
    }
  }, [projects])

  const load = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const qs = filterStatus !== 'all' ? `?status=${filterStatus}` : ''
      const [listRes, sumRes] = await Promise.all([
        fetch(`/api/v1/projects/${projectId}/change-orders${qs}`, { credentials: 'include' }),
        fetch(`/api/v1/projects/${projectId}/change-orders/summary`, { credentials: 'include' }),
      ])
      if (listRes.ok) { const j = await listRes.json(); setItems(j.items ?? []) }
      if (sumRes.ok)  { const j = await sumRes.json();  setSummary(j.summary) }
    } finally {
      setLoading(false)
    }
  }, [projectId, filterStatus])

  useEffect(() => { load() }, [load])

  const handleCreated = (co: ChangeOrder) => {
    setShowCreate(false)
    setItems(prev => [co, ...prev])
    load()
  }

  const handleUpdated = (co: ChangeOrder) => {
    setItems(prev => prev.map(c => c.id === co.id ? co : c))
    setSelected(co)
    load()
  }

  return (
    <div style={{ padding: '20px 24px', color: 'var(--jarvis-text, #eee)', fontFamily: 'inherit' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>🔄 Change Orders</h2>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: '#888' }}>Track scope, cost, and schedule deviations from the contract</p>
        </div>
        <button onClick={() => setShowCreate(true)}
          style={{ padding: '8px 16px', background: '#3b82f6', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
          + New CO
        </button>
      </div>

      {/* Project selector */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center' }}>
        <select value={projectId} onChange={e => { setProjectId(e.target.value); localStorage.setItem('jarvis-active-project', e.target.value) }}
          style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, padding: '6px 10px', color: '#eee', fontSize: 13 }}>
          {projects.map(p => <option key={p.id} value={p.id}>{p['name'] as string}</option>)}
        </select>

        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, padding: '6px 10px', color: '#eee', fontSize: 13 }}>
          <option value="all">All Statuses</option>
          <option value="draft">Draft</option>
          <option value="submitted">Submitted</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="void">Void</option>
        </select>
      </div>

      {/* Summary tiles */}
      {summary && <SummaryBar summary={summary} onFilter={setFilterStatus} />}

      {/* Table */}
      {loading ? (
        <div style={{ textAlign: 'center', color: '#888', padding: 40 }}>Loading…</div>
      ) : items.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#555', padding: 60 }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🔄</div>
          <div style={{ fontSize: 14 }}>No change orders found</div>
          <div style={{ fontSize: 12, color: '#444', marginTop: 6 }}>Create the first CO for this project</div>
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #2a2a2a' }}>
              {['#', 'Title', 'Type', 'Status', 'Cost Δ', 'Sched. Δ', 'Created'].map(h => (
                <th key={h} style={{ padding: '8px 12px', textAlign: h === 'Cost Δ' || h === 'Sched. Δ' ? 'right' : 'left', color: '#888', fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map(co => (
              <CoRow key={co.id} co={co} onSelect={() => setSelected(co)} />
            ))}
          </tbody>
        </table>
      )}

      {showCreate && <CreateModal projectId={projectId} onClose={() => setShowCreate(false)} onCreated={handleCreated} />}
      {selected && <DetailPanel co={selected} onClose={() => setSelected(null)} onUpdated={handleUpdated} />}
    </div>
  )
}

export default ChangeOrdersView
