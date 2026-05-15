/**
 * Denver Engineering — Cost Entry View (v10.11.0)
 *
 * Post actual costs (labor, material, equipment…) against WBS codes.
 * Posted entries flow into evm_actuals and surface in Cost Control dashboard.
 */
import React, { useEffect, useState, useCallback } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

type CostEntryType   = 'labor' | 'material' | 'equipment' | 'subcontract' | 'other'
type CostEntryStatus = 'draft' | 'posted' | 'void'

interface CostEntry {
  id:          string
  entryDate:   string
  entryType:   CostEntryType
  wbsCode:     string | null
  description: string
  amount:      number
  quantity:    number | null
  unit:        string | null
  status:      CostEntryStatus
  postedAt:    string | null
  postedBy:    string | null
  createdAt:   string
}

interface Summary {
  totalPosted: number
  byType:      Record<CostEntryType, number>
  draftCount:  number
  postedCount: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number) => {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(1)}K`
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const TYPE_LABELS: Record<CostEntryType, string> = {
  labor:       'Labor',
  material:    'Material',
  equipment:   'Equipment',
  subcontract: 'Subcontract',
  other:       'Other',
}

const TYPE_COLOR: Record<CostEntryType, string> = {
  labor:       '#3b82f6',
  material:    '#f59e0b',
  equipment:   '#8b5cf6',
  subcontract: '#fb923c',
  other:       '#6b7280',
}

const STATUS_COLOR: Record<CostEntryStatus, string> = {
  draft:  '#f59e0b',
  posted: '#22c55e',
  void:   '#ef4444',
}

const BLANK_FORM = {
  entryDate:   new Date().toISOString().slice(0, 10),
  entryType:   'labor' as CostEntryType,
  wbsCode:     '',
  description: '',
  amount:      '',
  quantity:    '',
  unit:        '',
}

// ─── Summary bar ──────────────────────────────────────────────────────────────

function SummaryBar({ summary, onFilter }: { summary: Summary; onFilter: (type: CostEntryType | 'all') => void }) {
  const types: CostEntryType[] = ['labor', 'material', 'equipment', 'subcontract', 'other']
  const tile: React.CSSProperties = { borderRadius: 8, padding: '10px 16px', cursor: 'pointer' }
  const hover = (e: React.MouseEvent<HTMLDivElement>) => (e.currentTarget.style.opacity = '.75')
  const leave = (e: React.MouseEvent<HTMLDivElement>) => (e.currentTarget.style.opacity = '1')
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
      <div onClick={() => onFilter('all')} onMouseEnter={hover} onMouseLeave={leave}
        style={{ ...tile, background: 'var(--jarvis-s2)', border: '1px solid var(--jarvis-b)', flex: '1 1 120px' }}>
        <div style={{ fontSize: 10, color: 'var(--jarvis-ts)', textTransform: 'uppercase', letterSpacing: '.05em' }}>ACWP Posted</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: '#22c55e' }}>{fmt(summary.totalPosted)}</div>
        <div style={{ fontSize: 10, color: 'var(--jarvis-ts)', marginTop: 2 }}>{summary.postedCount} entries · {summary.draftCount} drafts</div>
      </div>
      {types.map(t => (
        <div key={t} onClick={() => onFilter(t)} onMouseEnter={hover} onMouseLeave={leave}
          style={{ ...tile, background: 'var(--jarvis-s2)', border: `1px solid ${TYPE_COLOR[t]}33`, flex: '1 1 100px' }}>
          <div style={{ fontSize: 10, color: TYPE_COLOR[t], textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 600 }}>{TYPE_LABELS[t]}</div>
          <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--jarvis-t)' }}>{fmt(summary.byType[t] ?? 0)}</div>
        </div>
      ))}
    </div>
  )
}

// ─── Create form ──────────────────────────────────────────────────────────────

function CreateForm({ projectId, onCreated }: { projectId: string; onCreated: () => void }) {
  const [form,    setForm]    = useState(BLANK_FORM)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const set = (k: keyof typeof BLANK_FORM, v: string) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.description || !form.amount || !form.entryDate) { setError('Description, amount, and date are required'); return }
    setSaving(true); setError(null)
    try {
      const body = {
        entryDate:   form.entryDate,
        entryType:   form.entryType,
        wbsCode:     form.wbsCode   || null,
        description: form.description,
        amount:      parseFloat(form.amount),
        quantity:    form.quantity ? parseFloat(form.quantity) : null,
        unit:        form.unit    || null,
      }
      const res = await fetch(`/api/v1/projects/${projectId}/cost-entries`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setForm(BLANK_FORM)
      onCreated()
    } catch {
      setError('Failed to create entry')
    } finally {
      setSaving(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '7px 10px', borderRadius: 6,
    border: '1px solid var(--jarvis-b)', background: 'var(--jarvis-s)',
    color: 'var(--jarvis-t)', fontSize: 13, boxSizing: 'border-box',
  }
  const labelStyle: React.CSSProperties = { fontSize: 11, color: 'var(--jarvis-ts)', marginBottom: 3, display: 'block' }

  return (
    <form onSubmit={handleSubmit} style={{ background: 'var(--jarvis-s2)', border: '1px solid var(--jarvis-b)', borderRadius: 10, padding: 16 }}>
      <h3 style={{ margin: '0 0 14px', fontSize: 13, fontWeight: 600, color: 'var(--jarvis-t)' }}>New Cost Entry</h3>

      {error && <div style={{ marginBottom: 10, padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, color: '#dc2626', fontSize: 12 }}>{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 12px' }}>
        <div>
          <label style={labelStyle}>Date *</label>
          <input type="date" value={form.entryDate} onChange={e => set('entryDate', e.target.value)} style={inputStyle} required />
        </div>
        <div>
          <label style={labelStyle}>Type</label>
          <select value={form.entryType} onChange={e => set('entryType', e.target.value as CostEntryType)} style={inputStyle}>
            {(Object.keys(TYPE_LABELS) as CostEntryType[]).map(t => (
              <option key={t} value={t}>{TYPE_LABELS[t]}</option>
            ))}
          </select>
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={labelStyle}>Description *</label>
          <input type="text" value={form.description} onChange={e => set('description', e.target.value)} placeholder="e.g. Concrete pour — Level 3 deck" style={inputStyle} required />
        </div>
        <div>
          <label style={labelStyle}>Amount ($) *</label>
          <input type="number" min="0.01" step="0.01" value={form.amount} onChange={e => set('amount', e.target.value)} placeholder="0.00" style={inputStyle} required />
        </div>
        <div>
          <label style={labelStyle}>WBS Code</label>
          <input type="text" value={form.wbsCode} onChange={e => set('wbsCode', e.target.value)} placeholder="e.g. 1.2.3" style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Quantity</label>
          <input type="number" min="0" step="any" value={form.quantity} onChange={e => set('quantity', e.target.value)} placeholder="—" style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Unit</label>
          <input type="text" value={form.unit} onChange={e => set('unit', e.target.value)} placeholder="hrs, SF, CY…" style={inputStyle} />
        </div>
      </div>

      <button
        type="submit"
        disabled={saving}
        style={{ marginTop: 14, width: '100%', padding: '9px 0', borderRadius: 7, border: 'none', background: 'var(--jarvis-a)', color: '#fff', fontWeight: 600, fontSize: 13, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}
      >
        {saving ? 'Saving…' : '+ Add Entry'}
      </button>
    </form>
  )
}

// ─── Entry row ────────────────────────────────────────────────────────────────

function EntryRow({ entry, onPost, onDelete }: {
  entry:    CostEntry
  onPost:   (id: string) => void
  onDelete: (id: string) => void
}) {
  return (
    <tr style={{ borderBottom: '1px solid var(--jarvis-b)' }}>
      <td style={{ padding: '8px 10px', color: 'var(--jarvis-ts)', fontSize: 11, whiteSpace: 'nowrap' }}>
        {new Date(entry.entryDate).toLocaleDateString()}
      </td>
      <td style={{ padding: '8px 10px' }}>
        <span style={{ padding: '2px 7px', borderRadius: 99, fontSize: 10, fontWeight: 600, color: '#fff', background: TYPE_COLOR[entry.entryType] }}>
          {TYPE_LABELS[entry.entryType]}
        </span>
      </td>
      <td style={{ padding: '8px 10px', color: 'var(--jarvis-t)', fontSize: 12, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {entry.description}
        {entry.wbsCode && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--jarvis-ts)' }}>{entry.wbsCode}</span>}
      </td>
      <td style={{ padding: '8px 10px', fontWeight: 600, color: 'var(--jarvis-t)', fontSize: 13, textAlign: 'right', whiteSpace: 'nowrap' }}>
        {fmt(entry.amount)}
        {entry.quantity && <span style={{ fontWeight: 400, color: 'var(--jarvis-ts)', fontSize: 11, marginLeft: 4 }}>{entry.quantity} {entry.unit}</span>}
      </td>
      <td style={{ padding: '8px 10px' }}>
        <span style={{ padding: '2px 8px', borderRadius: 99, fontSize: 10, fontWeight: 600, color: '#fff', background: STATUS_COLOR[entry.status] }}>
          {entry.status}
        </span>
      </td>
      <td style={{ padding: '8px 10px', textAlign: 'right' }}>
        {entry.status === 'draft' && (
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button
              onClick={() => onPost(entry.id)}
              title="Post to EVM Actuals"
              style={{ padding: '3px 10px', borderRadius: 5, border: '1px solid #22c55e', background: 'transparent', color: '#22c55e', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}
            >
              Post
            </button>
            <button
              onClick={() => onDelete(entry.id)}
              title="Delete draft"
              style={{ padding: '3px 8px', borderRadius: 5, border: '1px solid var(--jarvis-b)', background: 'transparent', color: '#ef4444', fontSize: 11, cursor: 'pointer' }}
            >
              ✕
            </button>
          </div>
        )}
        {entry.status === 'posted' && (
          <span style={{ fontSize: 10, color: 'var(--jarvis-ts)' }}>
            {entry.postedAt ? new Date(entry.postedAt).toLocaleDateString() : ''}
          </span>
        )}
      </td>
    </tr>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

interface Props {
  policy?:     Record<string, unknown>
  biz?:        Record<string, unknown>
  onNavigate?: (tab: string) => void
}

const DEMO_PROJECT = 'demo'

export default function CostEntryView({ biz }: Props) {
  const [projectId, setProjectId] = useState<string>(DEMO_PROJECT)
  const [entries,   setEntries]   = useState<CostEntry[]>([])
  const [summary,   setSummary]   = useState<Summary | null>(null)
  const [loading,   setLoading]   = useState(false)
  const [filterType, setFilterType] = useState<CostEntryType | 'all'>('all')
  const [filterStatus, setFilterStatus] = useState<CostEntryStatus | 'all'>('all')

  const projects = (() => {
    if (!biz?.projects) return []
    try { return biz.projects as { id: string; name: string }[] } catch { return [] }
  })()

  const load = useCallback(async (pid: string) => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filterType   !== 'all') params.set('type',   filterType)
      if (filterStatus !== 'all') params.set('status', filterStatus)

      const [entriesRes, summaryRes] = await Promise.all([
        fetch(`/api/v1/projects/${pid}/cost-entries?${params}`),
        fetch(`/api/v1/projects/${pid}/cost-entries/summary`),
      ])
      const entriesData = await entriesRes.json() as { entries: CostEntry[] }
      const summaryData = await summaryRes.json() as { summary: Summary }
      setEntries(entriesData.entries ?? [])
      setSummary(summaryData.summary)
    } catch { /* network error — entries stay empty */ } finally { setLoading(false) }
  }, [filterType, filterStatus])

  useEffect(() => { load(projectId) }, [load, projectId])
  useEffect(() => { setFilterType('all'); setFilterStatus('all') }, [projectId])

  const handlePost = async (id: string) => {
    try {
      await fetch(`/api/v1/cost-entries/${id}/post`, { method: 'POST' })
      load(projectId)
    } catch { /* ignore */ }
  }

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/v1/cost-entries/${id}`, { method: 'DELETE' })
      load(projectId)
    } catch { /* ignore */ }
  }

  const selectStyle: React.CSSProperties = {
    padding: '6px 10px', borderRadius: 6, border: '1px solid var(--jarvis-b)',
    background: 'var(--jarvis-s2)', color: 'var(--jarvis-t)', fontSize: 12,
  }

  return (
    <div style={{ padding: '24px', maxWidth: 1060, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--jarvis-t)' }}>Cost Entry</h2>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--jarvis-ts)' }}>Post actuals to EVM · Feeds Cost Control dashboard</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {projects.length > 0 && (
            <select value={projectId} onChange={e => setProjectId(e.target.value)} style={selectStyle}>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <select value={filterType} onChange={e => setFilterType(e.target.value as CostEntryType | 'all')} style={selectStyle}>
            <option value="all">All types</option>
            {(Object.keys(TYPE_LABELS) as CostEntryType[]).map(t => (
              <option key={t} value={t}>{TYPE_LABELS[t]}</option>
            ))}
          </select>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as CostEntryStatus | 'all')} style={selectStyle}>
            <option value="all">All status</option>
            <option value="draft">Draft</option>
            <option value="posted">Posted</option>
            <option value="void">Void</option>
          </select>
        </div>
      </div>

      {/* Summary */}
      {summary && <SummaryBar summary={summary} onFilter={setFilterType} />}

      {/* Layout: form left, table right */}
      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>

        {/* Create form */}
        <div style={{ flex: '0 0 280px', minWidth: 240 }}>
          <CreateForm projectId={projectId} onCreated={() => load(projectId)} />
        </div>

        {/* Entries table */}
        <div style={{ flex: '1 1 460px', background: 'var(--jarvis-s2)', border: '1px solid var(--jarvis-b)', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--jarvis-b)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--jarvis-t)' }}>
              {loading ? 'Loading…' : `${entries.length} entries`}
            </span>
            <button onClick={() => load(projectId)} style={{ ...selectStyle, cursor: 'pointer', border: 'none', fontSize: 11 }}>↻</button>
          </div>

          {entries.length === 0 && !loading ? (
            <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--jarvis-ts)', fontSize: 13 }}>
              No entries yet. Add one using the form.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--jarvis-b)' }}>
                    {['Date', 'Type', 'Description', 'Amount', 'Status', ''].map(h => (
                      <th key={h} style={{ padding: '8px 10px', textAlign: h === 'Amount' ? 'right' : 'left', color: 'var(--jarvis-ts)', fontWeight: 600, fontSize: 11, whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {entries.map(e => (
                    <EntryRow key={e.id} entry={e} onPost={handlePost} onDelete={handleDelete} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Explainer */}
      <div style={{ padding: '10px 14px', borderRadius: 8, background: 'var(--jarvis-s2)', border: '1px solid var(--jarvis-b)', fontSize: 12, color: 'var(--jarvis-ts)' }}>
        💡 <b style={{ color: 'var(--jarvis-t)' }}>How it works:</b> Draft entries are saved but not yet accounted for. Clicking <b>Post</b> locks the entry and writes it into EVM Actuals — it will immediately appear as ACWP in the Cost Control dashboard.
      </div>
    </div>
  )
}
