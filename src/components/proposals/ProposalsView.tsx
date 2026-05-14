/**
 * Denver Engineering — Proposals & Bid Pipeline (v10.12.0)
 *
 * Kanban pipeline (Draft → Submitted → Won/Lost) + list view toggle.
 * Itemized line-item breakdown per proposal.
 */
import React, { useEffect, useState, useCallback } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

type ProposalStatus = 'draft' | 'submitted' | 'won' | 'lost' | 'no_bid'

interface Proposal {
  id:             string
  proposalNumber: number
  title:          string
  clientName:     string
  clientContact:  string | null
  bidDueDate:     string | null
  submittedDate:  string | null
  decidedDate:    string | null
  status:         ProposalStatus
  estimatedValue: number
  probabilityPct: number
  notes:          string | null
  itemCount:      number
  itemsTotal:     number
  createdAt:      string
}

interface ProposalItem {
  id:          string
  sortOrder:   number
  description: string
  quantity:    number
  unit:        string | null
  unitCost:    number
  total:       number
}

interface PipelineSummary {
  totalProposals:   number
  byStatus:         Record<ProposalStatus, { count: number; value: number }>
  weightedPipeline: number
  winRate:          number
  avgDealSize:      number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number) => {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(1)}K`
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 0 })}`
}

const STATUS_LABEL: Record<ProposalStatus, string> = {
  draft:     'Draft',
  submitted: 'Submitted',
  won:       'Won',
  lost:      'Lost',
  no_bid:    'No Bid',
}

const STATUS_COLOR: Record<ProposalStatus, string> = {
  draft:     '#6b7280',
  submitted: '#3b82f6',
  won:       '#22c55e',
  lost:      '#ef4444',
  no_bid:    '#f59e0b',
}

const PIPELINE_COLS: ProposalStatus[] = ['draft', 'submitted', 'won', 'lost']

function daysUntil(date: string | null): string {
  if (!date) return '—'
  const d = Math.round((new Date(date).getTime() - Date.now()) / 86_400_000)
  if (d < 0)  return `${Math.abs(d)}d overdue`
  if (d === 0) return 'Today'
  return `${d}d`
}

// ─── Kanban card ─────────────────────────────────────────────────────────────

function KanbanCard({ p, onClick }: { p: Proposal; onClick: () => void }) {
  const overdue = p.bidDueDate && new Date(p.bidDueDate) < new Date() && p.status === 'submitted'
  return (
    <div
      onClick={onClick}
      style={{
        background: 'var(--jarvis-s)', border: '1px solid var(--jarvis-b)',
        borderRadius: 8, padding: '10px 12px', cursor: 'pointer',
        transition: 'border-color .15s',
        borderLeft: `3px solid ${STATUS_COLOR[p.status]}`,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
        <span style={{ fontSize: 10, color: 'var(--jarvis-ts)' }}>P-{String(p.proposalNumber).padStart(3, '0')}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#22c55e' }}>{fmt(p.estimatedValue)}</span>
      </div>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--jarvis-t)', margin: '4px 0 2px', lineHeight: 1.3 }}>{p.title}</div>
      <div style={{ fontSize: 11, color: 'var(--jarvis-ts)' }}>{p.clientName}</div>
      {p.bidDueDate && (
        <div style={{ marginTop: 6, fontSize: 10, color: overdue ? '#ef4444' : 'var(--jarvis-ts)' }}>
          📅 Due {daysUntil(p.bidDueDate)}
        </div>
      )}
      <div style={{ marginTop: 6, display: 'flex', gap: 6, alignItems: 'center' }}>
        <div style={{ height: 4, flex: 1, borderRadius: 2, background: 'var(--jarvis-b)', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${p.probabilityPct}%`, background: STATUS_COLOR[p.status], borderRadius: 2 }} />
        </div>
        <span style={{ fontSize: 10, color: 'var(--jarvis-ts)' }}>{p.probabilityPct}%</span>
      </div>
    </div>
  )
}

// ─── Detail panel ─────────────────────────────────────────────────────────────

function DetailPanel({
  proposal, onClose, onAction, onRefresh,
}: {
  proposal:  Proposal
  onClose:   () => void
  onAction:  (id: string, action: string) => Promise<void>
  onRefresh: () => void
}) {
  const [items,       setItems]       = useState<ProposalItem[]>([])
  const [loadingItems, setLoadingItems] = useState(false)
  const [newItem,     setNewItem]     = useState({ description: '', quantity: '1', unit: '', unitCost: '' })
  const [addingItem,  setAddingItem]  = useState(false)
  const [acting,      setActing]      = useState(false)

  useEffect(() => {
    setLoadingItems(true)
    fetch(`/api/v1/proposals/${proposal.id}/items`)
      .then(r => r.json() as Promise<{ items: ProposalItem[] }>)
      .then(d => setItems(d.items ?? []))
      .catch(() => {})
      .finally(() => setLoadingItems(false))
  }, [proposal.id])

  const doAction = async (action: string) => {
    setActing(true)
    await onAction(proposal.id, action)
    setActing(false)
    onClose()
  }

  const addItem = async () => {
    if (!newItem.description || !newItem.unitCost) return
    setAddingItem(true)
    try {
      await fetch(`/api/v1/proposals/${proposal.id}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: newItem.description,
          quantity:    parseFloat(newItem.quantity) || 1,
          unit:        newItem.unit || null,
          unitCost:    parseFloat(newItem.unitCost),
        }),
      })
      setNewItem({ description: '', quantity: '1', unit: '', unitCost: '' })
      const res = await fetch(`/api/v1/proposals/${proposal.id}/items`)
      const d = await res.json() as { items: ProposalItem[] }
      setItems(d.items ?? [])
      onRefresh()
    } catch { /* ignore */ } finally { setAddingItem(false) }
  }

  const deleteItem = async (itemId: string) => {
    await fetch(`/api/v1/proposals/${proposal.id}/items/${itemId}`, { method: 'DELETE' })
    setItems(prev => prev.filter(i => i.id !== itemId))
    onRefresh()
  }

  const inputS: React.CSSProperties = {
    padding: '5px 8px', borderRadius: 5, border: '1px solid var(--jarvis-b)',
    background: 'var(--jarvis-s)', color: 'var(--jarvis-t)', fontSize: 12,
  }

  const actions: { label: string; action: string; color: string; show: boolean }[] = [
    { label: 'Submit', action: 'submit', color: '#3b82f6', show: proposal.status === 'draft' },
    { label: '🏆 Won',  action: 'won',    color: '#22c55e', show: ['draft','submitted'].includes(proposal.status) },
    { label: '✗ Lost', action: 'lost',   color: '#ef4444', show: ['draft','submitted'].includes(proposal.status) },
    { label: 'No Bid', action: 'no-bid', color: '#f59e0b', show: proposal.status === 'draft' },
  ].filter(a => a.show)

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 100,
      display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end',
    }} onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 480, height: '100vh', overflowY: 'auto',
          background: 'var(--jarvis-s2)', borderLeft: '1px solid var(--jarvis-b)',
          padding: 24, display: 'flex', flexDirection: 'column', gap: 18,
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--jarvis-ts)' }}>P-{String(proposal.proposalNumber).padStart(3, '0')}</div>
            <h3 style={{ margin: '2px 0 0', fontSize: 16, fontWeight: 700, color: 'var(--jarvis-t)' }}>{proposal.title}</h3>
            <div style={{ fontSize: 12, color: 'var(--jarvis-ts)', marginTop: 2 }}>{proposal.clientName}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--jarvis-ts)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>✕</button>
        </div>

        {/* Status badge */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600, color: '#fff', background: STATUS_COLOR[proposal.status] }}>
            {STATUS_LABEL[proposal.status]}
          </span>
          <span style={{ fontSize: 20, fontWeight: 700, color: '#22c55e' }}>{fmt(proposal.estimatedValue)}</span>
          <span style={{ fontSize: 12, color: 'var(--jarvis-ts)' }}>{proposal.probabilityPct}% probability</span>
        </div>

        {/* Dates */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
          {[
            ['Bid Due',    proposal.bidDueDate     ? new Date(proposal.bidDueDate).toLocaleDateString()     : '—'],
            ['Submitted',  proposal.submittedDate   ? new Date(proposal.submittedDate).toLocaleDateString()  : '—'],
            ['Decided',    proposal.decidedDate     ? new Date(proposal.decidedDate).toLocaleDateString()    : '—'],
            ['Contact',    proposal.clientContact ?? '—'],
          ].map(([label, val]) => (
            <div key={label as string}>
              <div style={{ color: 'var(--jarvis-ts)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
              <div style={{ color: 'var(--jarvis-t)', marginTop: 1 }}>{val}</div>
            </div>
          ))}
        </div>

        {/* Notes */}
        {proposal.notes && (
          <div style={{ fontSize: 12, color: 'var(--jarvis-ts)', background: 'var(--jarvis-s)', borderRadius: 6, padding: '8px 12px', lineHeight: 1.5 }}>
            {proposal.notes}
          </div>
        )}

        {/* Line items */}
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--jarvis-t)', marginBottom: 8 }}>
            Line Items
            <span style={{ fontWeight: 400, color: '#22c55e', marginLeft: 8 }}>{fmt(items.reduce((s, i) => s + i.total, 0))}</span>
          </div>
          {loadingItems ? (
            <div style={{ fontSize: 12, color: 'var(--jarvis-ts)' }}>Loading…</div>
          ) : (
            <>
              {items.length > 0 && (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, marginBottom: 10 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--jarvis-b)' }}>
                      {['Description', 'Qty', 'Unit Cost', 'Total', ''].map(h => (
                        <th key={h} style={{ padding: '4px 6px', textAlign: 'left', color: 'var(--jarvis-ts)', fontWeight: 600 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(item => (
                      <tr key={item.id} style={{ borderBottom: '1px solid var(--jarvis-b)' }}>
                        <td style={{ padding: '5px 6px', color: 'var(--jarvis-t)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.description}</td>
                        <td style={{ padding: '5px 6px', color: 'var(--jarvis-ts)' }}>{item.quantity}{item.unit ? ` ${item.unit}` : ''}</td>
                        <td style={{ padding: '5px 6px', color: 'var(--jarvis-ts)' }}>{fmt(item.unitCost)}</td>
                        <td style={{ padding: '5px 6px', fontWeight: 600, color: 'var(--jarvis-t)' }}>{fmt(item.total)}</td>
                        <td style={{ padding: '5px 6px' }}>
                          {['draft','submitted'].includes(proposal.status) && (
                            <button onClick={() => deleteItem(item.id)}
                              style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 12 }}>✕</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {/* Add item form */}
              {['draft','submitted'].includes(proposal.status) && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <input value={newItem.description} onChange={e => setNewItem(n => ({ ...n, description: e.target.value }))}
                    placeholder="Description" style={{ ...inputS, flex: '2 1 120px' }} />
                  <input value={newItem.quantity} onChange={e => setNewItem(n => ({ ...n, quantity: e.target.value }))}
                    placeholder="Qty" type="number" style={{ ...inputS, width: 52 }} />
                  <input value={newItem.unit} onChange={e => setNewItem(n => ({ ...n, unit: e.target.value }))}
                    placeholder="Unit" style={{ ...inputS, width: 52 }} />
                  <input value={newItem.unitCost} onChange={e => setNewItem(n => ({ ...n, unitCost: e.target.value }))}
                    placeholder="$/unit" type="number" style={{ ...inputS, width: 72 }} />
                  <button onClick={addItem} disabled={addingItem || !newItem.description || !newItem.unitCost}
                    style={{ padding: '5px 10px', borderRadius: 5, border: 'none', background: 'var(--jarvis-a)', color: '#fff', fontSize: 12, cursor: 'pointer', opacity: addingItem ? .6 : 1 }}>
                    {addingItem ? '…' : '+ Add'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Action buttons */}
        {actions.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', borderTop: '1px solid var(--jarvis-b)', paddingTop: 16 }}>
            {actions.map(a => (
              <button key={a.action} onClick={() => doAction(a.action)} disabled={acting}
                style={{ padding: '8px 16px', borderRadius: 7, border: `1px solid ${a.color}`, background: 'transparent', color: a.color, fontWeight: 600, fontSize: 13, cursor: 'pointer', opacity: acting ? .6 : 1 }}>
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Create modal ─────────────────────────────────────────────────────────────

function CreateModal({ onClose, onCreate }: { onClose: () => void; onCreate: () => void }) {
  const [form,   setForm]   = useState({ title: '', clientName: '', clientContact: '', bidDueDate: '', estimatedValue: '', probabilityPct: '50', notes: '' })
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState<string | null>(null)

  const set = (k: keyof typeof form, v: string) => setForm(f => ({ ...f, [k]: v }))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.title || !form.clientName) { setError('Title and client name are required'); return }
    setSaving(true); setError(null)
    try {
      const res = await fetch('/api/v1/proposals', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title:          form.title,
          clientName:     form.clientName,
          clientContact:  form.clientContact  || null,
          bidDueDate:     form.bidDueDate      || null,
          estimatedValue: form.estimatedValue  ? parseFloat(form.estimatedValue) : 0,
          probabilityPct: parseInt(form.probabilityPct) || 50,
          notes:          form.notes           || null,
        }),
      })
      if (!res.ok) throw new Error()
      onCreate()
      onClose()
    } catch { setError('Failed to create proposal') } finally { setSaving(false) }
  }

  const inputS: React.CSSProperties = {
    width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid var(--jarvis-b)',
    background: 'var(--jarvis-s)', color: 'var(--jarvis-t)', fontSize: 13, boxSizing: 'border-box',
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}>
      <form onClick={e => e.stopPropagation()} onSubmit={submit}
        style={{ width: 440, background: 'var(--jarvis-s2)', borderRadius: 12, padding: 24, display: 'flex', flexDirection: 'column', gap: 12, border: '1px solid var(--jarvis-b)' }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--jarvis-t)' }}>New Proposal</h3>
        {error && <div style={{ color: '#dc2626', fontSize: 12 }}>{error}</div>}
        {([
          ['Title *',          'title',          'text',   'Bridge Expansion — Phase 2'],
          ['Client *',         'clientName',      'text',   'City of Denver'],
          ['Contact',          'clientContact',   'text',   'Jane Smith'],
          ['Bid Due Date',     'bidDueDate',      'date',   ''],
          ['Estimated Value',  'estimatedValue',  'number', '0'],
          ['Probability (%)',  'probabilityPct',  'number', '50'],
        ] as [string, keyof typeof form, string, string][]).map(([label, key, type, ph]) => (
          <div key={key}>
            <label style={{ fontSize: 11, color: 'var(--jarvis-ts)', display: 'block', marginBottom: 3 }}>{label}</label>
            <input type={type} value={form[key]} onChange={e => set(key, e.target.value)} placeholder={ph} style={inputS} />
          </div>
        ))}
        <div>
          <label style={{ fontSize: 11, color: 'var(--jarvis-ts)', display: 'block', marginBottom: 3 }}>Notes</label>
          <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={3}
            style={{ ...inputS, resize: 'vertical', fontFamily: 'inherit' }} />
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <button type="button" onClick={onClose}
            style={{ padding: '8px 16px', borderRadius: 7, border: '1px solid var(--jarvis-b)', background: 'none', color: 'var(--jarvis-t)', cursor: 'pointer' }}>
            Cancel
          </button>
          <button type="submit" disabled={saving}
            style={{ padding: '8px 18px', borderRadius: 7, border: 'none', background: 'var(--jarvis-a)', color: '#fff', fontWeight: 600, cursor: 'pointer', opacity: saving ? .7 : 1 }}>
            {saving ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

interface Props {
  policy?:     Record<string, unknown>
  biz?:        Record<string, unknown>
  onNavigate?: (tab: string) => void
}

export default function ProposalsView(_: Props) {
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [summary,   setSummary]   = useState<PipelineSummary | null>(null)
  const [selected,  setSelected]  = useState<Proposal | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [view,      setView]      = useState<'kanban' | 'list'>('kanban')
  const [loading,   setLoading]   = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [pRes, sRes] = await Promise.all([
        fetch('/api/v1/proposals'),
        fetch('/api/v1/proposals/summary'),
      ])
      const pData = await pRes.json() as { proposals: Proposal[] }
      const sData = await sRes.json() as { summary: PipelineSummary }
      setProposals(pData.proposals ?? [])
      setSummary(sData.summary)
    } catch { /* ignore */ } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const doAction = async (id: string, action: string) => {
    await fetch(`/api/v1/proposals/${id}/${action}`, { method: 'POST' })
    await load()
  }

  const byStatus = (status: ProposalStatus) => proposals.filter(p => p.status === status)

  const btnS = (active: boolean): React.CSSProperties => ({
    padding: '5px 12px', borderRadius: 5, fontSize: 12, cursor: 'pointer',
    border: '1px solid var(--jarvis-b)', fontWeight: active ? 600 : 400,
    background: active ? 'var(--jarvis-a)' : 'var(--jarvis-s2)',
    color:      active ? '#fff'            : 'var(--jarvis-t)',
  })

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--jarvis-t)' }}>Proposals & Bid Pipeline</h2>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--jarvis-ts)' }}>Track bids from pursuit to award</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={btnS(view === 'kanban')} onClick={() => setView('kanban')}>⬛ Kanban</button>
          <button style={btnS(view === 'list')}   onClick={() => setView('list')}>≡ List</button>
          <button onClick={() => setShowCreate(true)}
            style={{ padding: '7px 16px', borderRadius: 7, border: 'none', background: 'var(--jarvis-a)', color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
            + New Proposal
          </button>
        </div>
      </div>

      {/* Summary strip */}
      {summary && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {([
            ['Weighted Pipeline', fmt(summary.weightedPipeline), '#6366f1', 'Prob-adjusted open bids'],
            ['Won',              fmt(summary.byStatus.won.value),  '#22c55e', `${summary.byStatus.won.count} deals`],
            ['Submitted',        fmt(summary.byStatus.submitted.value), '#3b82f6', `${summary.byStatus.submitted.count} open`],
            ['Win Rate',         `${summary.winRate}%`,               summary.winRate >= 50 ? '#22c55e' : '#ef4444', 'Won vs decided'],
            ['Avg Deal',         fmt(summary.avgDealSize),            'var(--jarvis-t)', 'Won deals avg'],
          ] as [string, string, string, string][]).map(([label, val, color, sub]) => (
            <div key={label} style={{ flex: '1 1 120px', background: 'var(--jarvis-s2)', border: '1px solid var(--jarvis-b)', borderRadius: 8, padding: '10px 14px' }}>
              <div style={{ fontSize: 10, color: 'var(--jarvis-ts)', textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color, margin: '2px 0' }}>{val}</div>
              <div style={{ fontSize: 10, color: 'var(--jarvis-ts)' }}>{sub}</div>
            </div>
          ))}
        </div>
      )}

      {loading && <div style={{ color: 'var(--jarvis-ts)', fontSize: 13 }}>Loading…</div>}

      {/* Kanban */}
      {view === 'kanban' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
          {PIPELINE_COLS.map(status => {
            const cols = byStatus(status)
            return (
              <div key={status}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLOR[status], display: 'inline-block' }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--jarvis-t)' }}>{STATUS_LABEL[status]}</span>
                  <span style={{ fontSize: 11, color: 'var(--jarvis-ts)', marginLeft: 'auto' }}>{cols.length}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {cols.map(p => (
                    <KanbanCard key={p.id} p={p} onClick={() => setSelected(p)} />
                  ))}
                  {cols.length === 0 && (
                    <div style={{ fontSize: 12, color: 'var(--jarvis-ts)', textAlign: 'center', padding: '20px 0', border: '1px dashed var(--jarvis-b)', borderRadius: 8 }}>
                      None
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* List */}
      {view === 'list' && (
        <div style={{ background: 'var(--jarvis-s2)', border: '1px solid var(--jarvis-b)', borderRadius: 10, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--jarvis-b)' }}>
                {['#', 'Title', 'Client', 'Value', 'Prob.', 'Due', 'Status'].map(h => (
                  <th key={h} style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--jarvis-ts)', fontWeight: 600, fontSize: 11 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {proposals.map(p => (
                <tr key={p.id} onClick={() => setSelected(p)}
                  style={{ borderBottom: '1px solid var(--jarvis-b)', cursor: 'pointer' }}>
                  <td style={{ padding: '9px 12px', color: 'var(--jarvis-ts)' }}>P-{String(p.proposalNumber).padStart(3,'0')}</td>
                  <td style={{ padding: '9px 12px', color: 'var(--jarvis-t)', fontWeight: 500 }}>{p.title}</td>
                  <td style={{ padding: '9px 12px', color: 'var(--jarvis-ts)' }}>{p.clientName}</td>
                  <td style={{ padding: '9px 12px', fontWeight: 600, color: '#22c55e' }}>{fmt(p.estimatedValue)}</td>
                  <td style={{ padding: '9px 12px', color: 'var(--jarvis-ts)' }}>{p.probabilityPct}%</td>
                  <td style={{ padding: '9px 12px', color: 'var(--jarvis-ts)', whiteSpace: 'nowrap' }}>
                    {p.bidDueDate ? new Date(p.bidDueDate).toLocaleDateString() : '—'}
                  </td>
                  <td style={{ padding: '9px 12px' }}>
                    <span style={{ padding: '2px 8px', borderRadius: 99, fontSize: 10, fontWeight: 600, color: '#fff', background: STATUS_COLOR[p.status] }}>
                      {STATUS_LABEL[p.status]}
                    </span>
                  </td>
                </tr>
              ))}
              {proposals.length === 0 && !loading && (
                <tr><td colSpan={7} style={{ padding: '32px', textAlign: 'center', color: 'var(--jarvis-ts)' }}>No proposals yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Modals */}
      {selected && (
        <DetailPanel
          proposal={selected}
          onClose={() => setSelected(null)}
          onAction={doAction}
          onRefresh={load}
        />
      )}
      {showCreate && (
        <CreateModal onClose={() => setShowCreate(false)} onCreate={load} />
      )}
    </div>
  )
}
