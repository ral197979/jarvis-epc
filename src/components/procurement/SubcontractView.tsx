/**
 * Denver Engineering — Subcontract Management View (v10.8.0)
 * ────────────────────────────────────────────────────────────
 * Three tabs:
 *   Bid Packages  — issue, close, award bid solicitations
 *   Subcontracts  — active contracts with invoiced vs contract value
 *   Invoices      — progress billing across all subcontracts
 */
import React, { useState, useEffect, useCallback } from 'react'
import { useBizStore, selectProjects } from '../../modules/biz/store'

// ─── Types ────────────────────────────────────────────────────────────────────

type BidPkgStatus = 'draft' | 'issued' | 'closed' | 'awarded' | 'cancelled'
type ScStatus     = 'active' | 'suspended' | 'complete' | 'terminated'
type InvStatus    = 'draft' | 'submitted' | 'approved' | 'rejected'

interface BidPackage {
  id: string; pkgNumber: number; title: string; csiCode: string | null
  status: BidPkgStatus; budgetAmount: number | null; bidDueDate: string | null
  createdAt: string; submissionCount?: number
}
interface BidSubmission {
  id: string; vendorId: string; vendorName?: string
  status: string; bidAmount: number | null; submittedAt: string
}
interface Subcontract {
  id: string; scNumber: number; title: string; vendorName?: string
  status: ScStatus; contractValue: number; retentionPct: number
  startDate: string | null; endDate: string | null
  invoicedTotal?: number; approvedTotal?: number
}
interface ScInvoice {
  id: string; subcontractId: string; invNumber: number
  periodStart: string; periodEnd: string
  grossAmount: number; retentionHeld: number; netAmount: number
  status: InvStatus; submittedAt: string | null
}
interface Summary {
  totalSubcontracts: number; totalContractValue: number
  totalInvoiced: number; totalApproved: number; activeBidPackages: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PKG_STATUS_COLOR: Record<BidPkgStatus, string> = {
  draft:     '#6c757d', issued:  '#0d6efd',
  closed:    '#f39c12', awarded: '#198754', cancelled: '#adb5bd',
}
const SC_STATUS_COLOR: Record<ScStatus, string> = {
  active: '#198754', suspended: '#f39c12', complete: '#0d6efd', terminated: '#dc3545',
}
const INV_STATUS_COLOR: Record<InvStatus, string> = {
  draft: '#6c757d', submitted: '#0d6efd', approved: '#198754', rejected: '#dc3545',
}

function fmt$(n: number) {
  const abs = Math.abs(n)
  const s = abs >= 1e6 ? `$${(abs/1e6).toFixed(2)}M` : abs >= 1e3 ? `$${(abs/1e3).toFixed(1)}K` : `$${abs.toFixed(0)}`
  return n < 0 ? `-${s}` : s
}
function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 10,
      fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4,
      background: color + '22', color, border: `1px solid ${color}44`,
    }}>{label}</span>
  )
}

function ProgressBar({ value, max, color = '#0d6efd' }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div style={{ background: '#2a2a2a', borderRadius: 4, height: 6, width: '100%' }}>
      <div style={{ background: color, borderRadius: 4, height: 6, width: `${pct}%`, transition: 'width 0.3s' }} />
    </div>
  )
}

// ─── Summary bar ──────────────────────────────────────────────────────────────

function SummaryBar({ s }: { s: Summary }) {
  const tiles = [
    { label: 'Active Subcontracts', value: s.totalSubcontracts,            color: '#eee' },
    { label: 'Contract Value',      value: fmt$(s.totalContractValue),      color: '#3b82f6' },
    { label: 'Invoiced',            value: fmt$(s.totalInvoiced),           color: '#f39c12' },
    { label: 'Approved',            value: fmt$(s.totalApproved),           color: '#198754' },
    { label: 'Open Bid Packages',   value: s.activeBidPackages,             color: '#0d6efd' },
  ]
  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
      {tiles.map(t => (
        <div key={t.label} style={{ background: 'var(--jarvis-surface,#1a1a1a)', border: '1px solid var(--jarvis-border,#333)', borderRadius: 8, padding: '10px 16px', minWidth: 120 }}>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>{t.label}</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: t.color }}>{t.value}</div>
        </div>
      ))}
    </div>
  )
}

// ─── Bid Packages tab ─────────────────────────────────────────────────────────

function BidPackagesTab({ projectId, tenantId: _tenantId }: { projectId: string; tenantId?: string }) {
  const [packages, setPackages]   = useState<BidPackage[]>([])
  const [selected, setSelected]   = useState<BidPackage | null>(null)
  const [subs, setSubs]           = useState<BidSubmission[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [loading, setLoading]     = useState(false)
  const [acting, setActing]       = useState(false)
  const [form, setForm] = useState({ title: '', csiCode: '', budgetAmount: '', bidDueDate: '', scope: '' })

  const load = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/bid-packages`, { credentials: 'include' })
      if (res.ok) { const j = await res.json(); setPackages(j.bidPackages ?? []) }
    } finally { setLoading(false) }
  }, [projectId])

  useEffect(() => { load() }, [load])

  const loadSubs = async (pkg: BidPackage) => {
    setSelected(pkg)
    const res = await fetch(`/api/v1/bid-packages/${pkg.id}/submissions`, { credentials: 'include' })
    if (res.ok) { const j = await res.json(); setSubs(j.submissions ?? []) }
  }

  const doAction = async (verb: string, id: string) => {
    setActing(true)
    try {
      await fetch(`/api/v1/bid-packages/${id}/${verb}`, { method: 'POST', credentials: 'include' })
      await load()
      setSelected(null)
    } finally { setActing(false) }
  }

  const create = async () => {
    if (!form.title.trim()) return
    setActing(true)
    try {
      await fetch(`/api/v1/projects/${projectId}/bid-packages`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title, csiCode: form.csiCode || undefined,
          budgetAmount: form.budgetAmount ? Number(form.budgetAmount) : undefined,
          bidDueDate: form.bidDueDate || undefined, scope: form.scope || undefined,
        }),
      })
      setShowCreate(false)
      setForm({ title: '', csiCode: '', budgetAmount: '', bidDueDate: '', scope: '' })
      await load()
    } finally { setActing(false) }
  }

  const inputStyle: React.CSSProperties = { width: '100%', background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, padding: '7px 10px', color: '#eee', fontSize: 13, boxSizing: 'border-box' }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
        <button onClick={() => setShowCreate(true)} style={{ padding: '7px 14px', background: '#3b82f6', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer', fontSize: 13 }}>+ Bid Package</button>
      </div>

      {showCreate && (
        <div style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, padding: 16, marginBottom: 16 }}>
          <h4 style={{ margin: '0 0 12px', fontSize: 14 }}>New Bid Package</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            {[['Title *', 'title', 'text'], ['CSI Code', 'csiCode', 'text'], ['Budget ($)', 'budgetAmount', 'number'], ['Bid Due Date', 'bidDueDate', 'date']].map(([label, key, type]) => (
              <div key={key}>
                <label style={{ display: 'block', fontSize: 11, color: '#888', marginBottom: 3 }}>{label}</label>
                <input value={form[key as keyof typeof form]} type={type} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} style={inputStyle} />
              </div>
            ))}
          </div>
          <div style={{ marginBottom: 10 }}>
            <label style={{ display: 'block', fontSize: 11, color: '#888', marginBottom: 3 }}>Scope</label>
            <textarea value={form.scope} onChange={e => setForm(f => ({ ...f, scope: e.target.value }))} rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => setShowCreate(false)} style={{ padding: '6px 12px', background: 'transparent', border: '1px solid #444', borderRadius: 6, color: '#aaa', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
            <button onClick={create} disabled={acting || !form.title} style={{ padding: '6px 12px', background: '#3b82f6', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer', fontSize: 13, opacity: acting ? 0.6 : 1 }}>Create</button>
          </div>
        </div>
      )}

      {loading ? <div style={{ color: '#888', padding: 30, textAlign: 'center' }}>Loading…</div> : packages.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#555', padding: 50 }}>No bid packages yet</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #2a2a2a' }}>
              {['#', 'Title', 'CSI', 'Status', 'Budget', 'Due Date', 'Bids'].map(h => (
                <th key={h} style={{ padding: '7px 10px', textAlign: 'left', color: '#888', fontWeight: 500, fontSize: 11, textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {packages.map(pkg => (
              <tr key={pkg.id} onClick={() => loadSubs(pkg)} style={{ cursor: 'pointer', borderBottom: '1px solid #1e1e1e' }}>
                <td style={{ padding: '9px 10px', color: '#3b82f6', fontWeight: 600 }}>BP-{String(pkg.pkgNumber).padStart(3, '0')}</td>
                <td style={{ padding: '9px 10px' }}>{pkg.title}</td>
                <td style={{ padding: '9px 10px', color: '#aaa', fontSize: 12 }}>{pkg.csiCode ?? '—'}</td>
                <td style={{ padding: '9px 10px' }}><Badge label={pkg.status} color={PKG_STATUS_COLOR[pkg.status]} /></td>
                <td style={{ padding: '9px 10px', color: '#ccc' }}>{pkg.budgetAmount != null ? fmt$(pkg.budgetAmount) : '—'}</td>
                <td style={{ padding: '9px 10px', color: '#aaa', fontSize: 12 }}>{fmtDate(pkg.bidDueDate)}</td>
                <td style={{ padding: '9px 10px', color: '#aaa' }}>{pkg.submissionCount ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Detail panel */}
      {selected && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end' }}>
          <div style={{ background: '#111', border: '1px solid #2a2a2a', width: 440, minHeight: '100vh', padding: 24, overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 15 }}>BP-{String(selected.pkgNumber).padStart(3, '0')} — {selected.title}</h3>
              <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', color: '#aaa', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <div style={{ marginBottom: 16 }}><Badge label={selected.status} color={PKG_STATUS_COLOR[selected.status]} /></div>

            <h4 style={{ fontSize: 12, color: '#888', margin: '16px 0 8px', textTransform: 'uppercase' }}>Bid Submissions ({subs.length})</h4>
            {subs.length === 0 ? <div style={{ color: '#555', fontSize: 13 }}>No submissions yet</div> : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginBottom: 16 }}>
                <thead><tr style={{ borderBottom: '1px solid #2a2a2a' }}>
                  {['Vendor', 'Amount', 'Status', ''].map(h => <th key={h} style={{ padding: '5px 8px', textAlign: 'left', color: '#888', fontSize: 11 }}>{h}</th>)}
                </tr></thead>
                <tbody>{subs.map(s => (
                  <tr key={s.id} style={{ borderBottom: '1px solid #1e1e1e' }}>
                    <td style={{ padding: '7px 8px' }}>{s.vendorName ?? s.vendorId.slice(0,8)}</td>
                    <td style={{ padding: '7px 8px', color: '#3b82f6' }}>{s.bidAmount != null ? fmt$(s.bidAmount) : '—'}</td>
                    <td style={{ padding: '7px 8px' }}><Badge label={s.status} color={s.status === 'accepted' ? '#198754' : '#888'} /></td>
                    <td style={{ padding: '7px 8px' }}>
                      {s.status === 'pending' && selected.status === 'closed' && (
                        <button onClick={async () => {
                          setActing(true)
                          try {
                            await fetch(`/api/v1/bid-submissions/${s.id}/award`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contractValue: s.bidAmount }) })
                            await load(); setSelected(null)
                          } finally { setActing(false) }
                        }} disabled={acting} style={{ padding: '3px 8px', background: '#198754', border: 'none', borderRadius: 4, color: '#fff', cursor: 'pointer', fontSize: 11 }}>Award</button>
                      )}
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              {selected.status === 'draft'  && <button onClick={() => doAction('issue', selected.id)}  disabled={acting} style={{ padding: '7px 14px', background: '#0d6efd', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer', fontSize: 13 }}>Issue to Vendors</button>}
              {selected.status === 'issued' && <button onClick={() => doAction('close', selected.id)}  disabled={acting} style={{ padding: '7px 14px', background: '#f39c12', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer', fontSize: 13 }}>Close Bidding</button>}
              {['draft','issued','closed'].includes(selected.status) && <button onClick={() => doAction('cancel', selected.id)} disabled={acting} style={{ padding: '7px 14px', background: '#6c757d', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer', fontSize: 13 }}>Cancel</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Subcontracts tab ─────────────────────────────────────────────────────────

function SubcontractsTab({ projectId }: { projectId: string }) {
  const [subcontracts, setSubcontracts] = useState<Subcontract[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/subcontracts`, { credentials: 'include' })
      if (res.ok) { const j = await res.json(); setSubcontracts(j.subcontracts ?? []) }
    } finally { setLoading(false) }
  }, [projectId])

  useEffect(() => { load() }, [load])

  return loading ? <div style={{ color: '#888', padding: 30, textAlign: 'center' }}>Loading…</div> : subcontracts.length === 0 ? (
    <div style={{ textAlign: 'center', color: '#555', padding: 50 }}>
      <div style={{ fontSize: 28, marginBottom: 10 }}>📋</div>
      <div>No subcontracts yet — award a bid package or create one directly</div>
    </div>
  ) : (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {subcontracts.map(sc => {
        const invoicedPct = sc.contractValue > 0 ? Math.min(100, ((sc.invoicedTotal ?? 0) / sc.contractValue) * 100) : 0
        const approvedPct = sc.contractValue > 0 ? Math.min(100, ((sc.approvedTotal ?? 0) / sc.contractValue) * 100) : 0
        return (
          <div key={sc.id} style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, padding: '14px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
              <div>
                <span style={{ color: '#3b82f6', fontWeight: 600, marginRight: 8, fontSize: 12 }}>SC-{String(sc.scNumber).padStart(3, '0')}</span>
                <span style={{ fontWeight: 600, fontSize: 14 }}>{sc.title}</span>
                <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{sc.vendorName ?? 'Unknown vendor'}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <Badge label={sc.status} color={SC_STATUS_COLOR[sc.status]} />
                <div style={{ fontSize: 16, fontWeight: 700, color: '#eee', marginTop: 4 }}>{fmt$(sc.contractValue)}</div>
              </div>
            </div>
            <div style={{ marginBottom: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#888', marginBottom: 3 }}>
                <span>Invoiced: {fmt$(sc.invoicedTotal ?? 0)}</span>
                <span>{invoicedPct.toFixed(0)}%</span>
              </div>
              <ProgressBar value={sc.invoicedTotal ?? 0} max={sc.contractValue} color="#f39c12" />
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#888', marginBottom: 3 }}>
                <span>Approved: {fmt$(sc.approvedTotal ?? 0)}</span>
                <span>{approvedPct.toFixed(0)}%</span>
              </div>
              <ProgressBar value={sc.approvedTotal ?? 0} max={sc.contractValue} color="#198754" />
            </div>
            {(sc.startDate || sc.endDate) && (
              <div style={{ fontSize: 11, color: '#666', marginTop: 8 }}>
                {fmtDate(sc.startDate)} → {fmtDate(sc.endDate)}  ·  {sc.retentionPct}% retention
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Invoices tab ─────────────────────────────────────────────────────────────

function InvoicesTab({ projectId }: { projectId: string }) {
  const [subcontracts, setSubcontracts] = useState<Subcontract[]>([])
  const [selectedSc, setSelectedSc]     = useState<string>('')
  const [invoices, setInvoices]         = useState<ScInvoice[]>([])
  const [loading, setLoading]           = useState(false)
  const [acting, setActing]             = useState(false)
  const [showCreate, setShowCreate]     = useState(false)
  const [form, setForm] = useState({ periodStart: '', periodEnd: '', grossAmount: '' })

  useEffect(() => {
    if (!projectId) return
    fetch(`/api/v1/projects/${projectId}/subcontracts`, { credentials: 'include' })
      .then(r => r.json()).then(j => {
        const scs = j.subcontracts ?? []
        setSubcontracts(scs)
        if (scs.length > 0 && !selectedSc) setSelectedSc(scs[0].id)
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  const loadInvoices = useCallback(async () => {
    if (!selectedSc) return
    setLoading(true)
    try {
      const res = await fetch(`/api/v1/subcontracts/${selectedSc}/invoices`, { credentials: 'include' })
      if (res.ok) { const j = await res.json(); setInvoices(j.invoices ?? []) }
    } finally { setLoading(false) }
  }, [selectedSc])

  useEffect(() => { loadInvoices() }, [loadInvoices])

  const doAction = async (verb: string, id: string) => {
    setActing(true)
    try {
      await fetch(`/api/v1/sc-invoices/${id}/${verb}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
      await loadInvoices()
    } finally { setActing(false) }
  }

  const createInv = async () => {
    if (!form.periodStart || !form.periodEnd || !form.grossAmount) return
    setActing(true)
    try {
      await fetch(`/api/v1/subcontracts/${selectedSc}/invoices`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ periodStart: form.periodStart, periodEnd: form.periodEnd, grossAmount: Number(form.grossAmount) }),
      })
      setShowCreate(false)
      setForm({ periodStart: '', periodEnd: '', grossAmount: '' })
      await loadInvoices()
    } finally { setActing(false) }
  }

  const inputStyle: React.CSSProperties = { background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, padding: '6px 10px', color: '#eee', fontSize: 13 }

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, alignItems: 'center' }}>
        <select value={selectedSc} onChange={e => setSelectedSc(e.target.value)} style={{ ...inputStyle, flex: 1 }}>
          {subcontracts.map(sc => <option key={sc.id} value={sc.id}>SC-{String(sc.scNumber).padStart(3,'0')} — {sc.title}</option>)}
        </select>
        <button onClick={() => setShowCreate(true)} style={{ padding: '7px 14px', background: '#3b82f6', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer', fontSize: 13, whiteSpace: 'nowrap' }}>+ Invoice</button>
      </div>

      {showCreate && (
        <div style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, padding: 14, marginBottom: 14 }}>
          <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
            {[['Period Start', 'periodStart', 'date'], ['Period End', 'periodEnd', 'date'], ['Gross Amount ($)', 'grossAmount', 'number']].map(([lbl, key, type]) => (
              <div key={key} style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: 11, color: '#888', marginBottom: 3 }}>{lbl}</label>
                <input value={form[key as keyof typeof form]} type={type} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }} />
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => setShowCreate(false)} style={{ padding: '6px 12px', background: 'transparent', border: '1px solid #444', borderRadius: 6, color: '#aaa', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
            <button onClick={createInv} disabled={acting} style={{ padding: '6px 12px', background: '#3b82f6', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer', fontSize: 13 }}>Create</button>
          </div>
        </div>
      )}

      {loading ? <div style={{ color: '#888', textAlign: 'center', padding: 30 }}>Loading…</div> : invoices.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#555', padding: 40 }}>No invoices for this subcontract</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ borderBottom: '1px solid #2a2a2a' }}>
            {['#', 'Period', 'Gross', 'Retention', 'Net', 'Status', 'Actions'].map(h => (
              <th key={h} style={{ padding: '7px 10px', textAlign: 'left', color: '#888', fontSize: 11, textTransform: 'uppercase' }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {invoices.map(inv => (
              <tr key={inv.id} style={{ borderBottom: '1px solid #1e1e1e' }}>
                <td style={{ padding: '8px 10px', color: '#3b82f6', fontWeight: 600 }}>#{inv.invNumber}</td>
                <td style={{ padding: '8px 10px', fontSize: 12, color: '#aaa' }}>{fmtDate(inv.periodStart)} – {fmtDate(inv.periodEnd)}</td>
                <td style={{ padding: '8px 10px' }}>{fmt$(inv.grossAmount)}</td>
                <td style={{ padding: '8px 10px', color: '#e74c3c' }}>{fmt$(inv.retentionHeld)}</td>
                <td style={{ padding: '8px 10px', fontWeight: 600 }}>{fmt$(inv.netAmount)}</td>
                <td style={{ padding: '8px 10px' }}><Badge label={inv.status} color={INV_STATUS_COLOR[inv.status]} /></td>
                <td style={{ padding: '8px 10px' }}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {inv.status === 'draft'      && <button onClick={() => doAction('submit', inv.id)} disabled={acting} style={{ padding: '3px 8px', background: '#0d6efd', border: 'none', borderRadius: 4, color: '#fff', cursor: 'pointer', fontSize: 11 }}>Submit</button>}
                    {inv.status === 'submitted'  && <button onClick={() => doAction('approve', inv.id)} disabled={acting} style={{ padding: '3px 8px', background: '#198754', border: 'none', borderRadius: 4, color: '#fff', cursor: 'pointer', fontSize: 11 }}>Approve</button>}
                    {inv.status === 'submitted'  && <button onClick={() => doAction('reject', inv.id)}  disabled={acting} style={{ padding: '3px 8px', background: '#dc3545', border: 'none', borderRadius: 4, color: '#fff', cursor: 'pointer', fontSize: 11 }}>Reject</button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// ─── Main view ────────────────────────────────────────────────────────────────

export function SubcontractView() {
  const projects  = useBizStore(selectProjects)
  const [projectId, setProjectId] = useState('')
  const [summary, setSummary]     = useState<Summary | null>(null)
  const [tab, setTab]             = useState<'bid' | 'subcontracts' | 'invoices'>('bid')

  useEffect(() => {
    const saved = localStorage.getItem('jarvis-active-project')
    if (saved && projects.some(p => p.id === saved)) setProjectId(saved)
    else if (projects.length > 0 && projects[0]) setProjectId(projects[0].id)
  }, [projects])

  useEffect(() => {
    if (!projectId) return
    fetch(`/api/v1/projects/${projectId}/bid-packages/summary`, { credentials: 'include' })
      .then(r => r.json()).then(j => setSummary(j.summary ?? null)).catch(() => {})
  }, [projectId])

  const TABS = [
    { id: 'bid' as const,           label: '📦 Bid Packages' },
    { id: 'subcontracts' as const,  label: '📋 Subcontracts' },
    { id: 'invoices' as const,      label: '🧾 Invoices' },
  ]

  return (
    <div style={{ padding: '20px 24px', color: 'var(--jarvis-text,#eee)', fontFamily: 'inherit' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>🏗️ Subcontracts</h2>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: '#888' }}>Bid packages, awards, subcontracts, and progress billing</p>
        </div>
        <select value={projectId} onChange={e => { setProjectId(e.target.value); localStorage.setItem('jarvis-active-project', e.target.value) }}
          style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, padding: '6px 10px', color: '#eee', fontSize: 13 }}>
          {projects.map(p => <option key={p.id} value={p.id}>{p['name'] as string}</option>)}
        </select>
      </div>

      {summary && <SummaryBar s={summary} />}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 20, borderBottom: '1px solid #2a2a2a' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ padding: '8px 16px', background: 'transparent', border: 'none', borderBottom: tab === t.id ? '2px solid #3b82f6' : '2px solid transparent', color: tab === t.id ? '#3b82f6' : '#888', cursor: 'pointer', fontSize: 13, fontWeight: tab === t.id ? 600 : 400, marginBottom: -1 }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'bid'          && <BidPackagesTab  projectId={projectId} />}
      {tab === 'subcontracts' && <SubcontractsTab projectId={projectId} />}
      {tab === 'invoices'     && <InvoicesTab     projectId={projectId} />}
    </div>
  )
}

export default SubcontractView
