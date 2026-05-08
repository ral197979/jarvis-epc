/**
 * Denver Engineering — FinanceView  ·  Finance Overview
 * Tabs: Summary | Invoices | Expenses | Journal
 */
import React, { useState, useMemo } from 'react'
import { useBizStore } from '../modules/biz/store'
import { createDispatch, type PolicyConfig } from '../modules/biz/dispatch'
import { JARVIS_ACTIONS } from '../modules/biz/reducer'
import { StatusBadge } from './StatusBadge'
import { KpiCard }     from './KpiCard'

export interface FinanceViewProps {
  policy?:   Partial<PolicyConfig>
  onAudit?:  (e: unknown) => void
  onToast?:  (msg: string, type: string) => void
}

type Tab = 'summary' | 'invoices' | 'expenses' | 'journal'
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'summary',  label: 'Summary',  icon: '📊' },
  { id: 'invoices', label: 'Invoices', icon: '🧾' },
  { id: 'expenses', label: 'Expenses', icon: '💸' },
  { id: 'journal',  label: 'Journal',  icon: '📒' },
]

const DEFAULT_POLICY: PolicyConfig = { writesEnabled: false, chatEnabled: false, exportsEnabled: false, activeRole: 'viewer' }

function fmt(n: number) {
  if (n >= 1_000_000) return `$${(n/1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `$${(n/1_000).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}

function GenericTable({ rows, cols, ariaLabel, emptyIcon, emptyText }: {
  rows: Record<string, unknown>[]
  cols: { key: string; label: string; render?: (r: Record<string, unknown>) => React.ReactNode }[]
  ariaLabel: string
  emptyIcon: string
  emptyText: string
}) {
  const [q, setQ] = useState('')
  const filtered = useMemo(() => {
    if (!q) return rows
    const ql = q.toLowerCase()
    return rows.filter(r => Object.values(r).some(v => String(v ?? '').toLowerCase().includes(ql)))
  }, [rows, q])
  return (
    <div>
      <div style={{ marginBottom: 10 }}>
        <input className="jarvis-input" type="search" placeholder={`Filter ${ariaLabel.toLowerCase()}…`}
          value={q} onChange={e => setQ(e.target.value)} aria-label={`Search ${ariaLabel}`} />
      </div>
      {filtered.length === 0 ? (
        <div className="jarvis-empty" role="status">
          <span className="jarvis-empty-icon">{emptyIcon}</span>
          <span>{q ? 'No items match' : emptyText}</span>
        </div>
      ) : (
        <div className="jarvis-scroll-y jarvis-max-h-lg">
          <table className="jarvis-table" aria-label={ariaLabel}>
            <thead><tr>{cols.map(c => <th key={c.key}>{c.label}</th>)}</tr></thead>
            <tbody>
              {filtered.map((row, i) => (
                <tr key={String(row.id ?? i)}>
                  {cols.map(c => (
                    <td key={c.key}>{c.render ? c.render(row) : String(row[c.key] ?? '—')}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export function FinanceView({ policy: policyProp, onAudit, onToast }: FinanceViewProps) {
  const policy = { ...DEFAULT_POLICY, ...policyProp }
  const invoices = useBizStore(s => s.biz.invoices ?? [])
  const expenses = useBizStore(s => s.biz.expenses ?? [])
  const journal  = useBizStore(s => s.biz.journal  ?? [])
  const [tab, setTab] = useState<Tab>('summary')
  const [showAddInv, setShowAddInv] = useState(false)
  const [showAddExp, setShowAddExp] = useState(false)
  const [form, setForm] = useState<Record<string, string>>({})

  const { dispatch } = useMemo(() => createDispatch({
    policy, audit: onAudit ? e => onAudit(e) : undefined,
    toast: onToast ? (m, t) => onToast(m, t) : undefined,
  }), [policy, onAudit, onToast])

  const canWrite = policy.writesEnabled && policy.activeRole !== 'viewer'

  const totalInvoiced = invoices.reduce((s, i) => s + Number(i['amount'] ?? 0), 0)
  const totalPaid     = invoices.filter(i => i['status'] === 'paid').reduce((s, i) => s + Number(i['amount'] ?? 0), 0)
  const totalExpenses = expenses.reduce((s, e) => s + Number(e['amount'] ?? 0), 0)
  const totalJournal  = journal.reduce((s, j) => s + Number(j['debit'] ?? 0), 0)
  const outstanding   = invoices.filter(i => i['status'] !== 'paid')

  function submitInvoice() {
    if (!form.description || !form.amount) return
    dispatch({ type: JARVIS_ACTIONS.ADD_INVOICE, data: { id: `INV-${Date.now()}`, ...form, amount: Number(form.amount), status: 'unpaid', date: new Date().toISOString().slice(0, 10) } })
    setForm({}); setShowAddInv(false)
    onToast?.('Invoice added', 'success')
  }

  function submitExpense() {
    if (!form.description || !form.amount) return
    dispatch({ type: JARVIS_ACTIONS.ADD_EXPENSE, data: { id: `EXP-${Date.now()}`, ...form, amount: Number(form.amount), date: new Date().toISOString().slice(0, 10) } })
    setForm({}); setShowAddExp(false)
    onToast?.('Expense recorded', 'success')
  }

  return (
    <div role="main" aria-label="Finance">
      <div role="tablist" aria-label="Finance sections" style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid var(--jarvis-bd)', paddingBottom: 0 }}>
        {TABS.map(t => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
            style={{ padding: '8px 14px', background: 'transparent', border: 'none', borderBottom: tab === t.id ? '2px solid var(--jarvis-ac)' : '2px solid transparent', color: tab === t.id ? 'var(--jarvis-tx)' : 'var(--jarvis-ts)', fontWeight: tab === t.id ? 700 : 500, fontSize: 12, cursor: 'pointer', paddingBottom: 10 }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab === 'summary' && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginBottom: 16 }}>
            <KpiCard label="Total Invoiced"  value={fmt(totalInvoiced)}  color="var(--jarvis-blue)" />
            <KpiCard label="Collected"        value={fmt(totalPaid)}      color="var(--jarvis-grn)" />
            <KpiCard label="Outstanding"      value={fmt(totalInvoiced - totalPaid)} color={outstanding.length ? 'var(--jarvis-red)' : 'var(--jarvis-grn)'} sub={`${outstanding.length} invoices`} />
            <KpiCard label="Total Expenses"   value={fmt(totalExpenses)}  color="var(--jarvis-amb)" />
            <KpiCard label="Net Position"     value={fmt(totalPaid - totalExpenses)} color={(totalPaid - totalExpenses) >= 0 ? 'var(--jarvis-grn)' : 'var(--jarvis-red)'} />
            <KpiCard label="Journal Entries"  value={journal.length}       color="var(--jarvis-pur)" />
          </div>
          {outstanding.length > 0 && (
            <div className="jarvis-card" style={{ padding: 16 }}>
              <h4 className="jarvis-label" style={{ marginBottom: 10 }}>Outstanding Invoices</h4>
              {outstanding.slice(0, 6).map(inv => (
                <div key={String(inv.id)} className="jarvis-row">
                  <div className="jarvis-flex-1"><span className="jarvis-body" style={{ fontWeight: 600 }}>{String(inv['description'] ?? inv.id)}</span><span className="jarvis-small" style={{ display: 'block' }}>{String(inv['client'] ?? '—')} · {String(inv['date'] ?? '—')}</span></div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontFamily: 'var(--jarvis-font-mono)', fontWeight: 700, color: 'var(--jarvis-amb)' }}>{fmt(Number(inv['amount'] ?? 0))}</span>
                    <StatusBadge status={String(inv['status'] ?? 'unpaid')} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'invoices' && (
        <div>
          {canWrite && !showAddInv && (
            <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'flex-end' }}>
              <button className="jarvis-btn jarvis-btn-primary" onClick={() => setShowAddInv(true)}>+ New Invoice</button>
            </div>
          )}
          {showAddInv && (
            <div className="jarvis-card" style={{ padding: 16, marginBottom: 16 }}>
              <h4 className="jarvis-label" style={{ marginBottom: 12 }}>New Invoice</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 12 }}>
                {[['description','Description'],['client','Client'],['amount','Amount ($)']].map(([k,l]) => (
                  <div key={k}><label className="jarvis-small" htmlFor={`inv-${k}`}>{l}</label>
                    <input id={`inv-${k}`} className="jarvis-input" value={form[k] ?? ''} onChange={e => setForm(f => ({...f,[k]:e.target.value}))} /></div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="jarvis-btn jarvis-btn-primary" onClick={submitInvoice}>Save</button>
                <button className="jarvis-btn jarvis-btn-ghost" onClick={() => { setShowAddInv(false); setForm({}) }}>Cancel</button>
              </div>
            </div>
          )}
          <GenericTable rows={invoices} ariaLabel="Invoices" emptyIcon="🧾" emptyText="No invoices yet"
            cols={[
              { key: 'id', label: 'Invoice #' },
              { key: 'description', label: 'Description' },
              { key: 'client', label: 'Client' },
              { key: 'date', label: 'Date' },
              { key: 'amount', label: 'Amount', render: r => <span style={{ fontFamily: 'var(--jarvis-font-mono)', fontWeight: 700 }}>{fmt(Number(r['amount'] ?? 0))}</span> },
              { key: 'status', label: 'Status', render: r => <StatusBadge status={String(r['status'] ?? 'unpaid')} /> },
            ]} />
        </div>
      )}

      {tab === 'expenses' && (
        <div>
          {canWrite && !showAddExp && (
            <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'flex-end' }}>
              <button className="jarvis-btn jarvis-btn-primary" onClick={() => setShowAddExp(true)}>+ Record Expense</button>
            </div>
          )}
          {showAddExp && (
            <div className="jarvis-card" style={{ padding: 16, marginBottom: 16 }}>
              <h4 className="jarvis-label" style={{ marginBottom: 12 }}>Record Expense</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10, marginBottom: 12 }}>
                {[['description','Description'],['category','Category'],['amount','Amount ($)'],['project','Project']].map(([k,l]) => (
                  <div key={k}><label className="jarvis-small" htmlFor={`exp-${k}`}>{l}</label>
                    <input id={`exp-${k}`} className="jarvis-input" value={form[k] ?? ''} onChange={e => setForm(f => ({...f,[k]:e.target.value}))} /></div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="jarvis-btn jarvis-btn-primary" onClick={submitExpense}>Save</button>
                <button className="jarvis-btn jarvis-btn-ghost" onClick={() => { setShowAddExp(false); setForm({}) }}>Cancel</button>
              </div>
            </div>
          )}
          <GenericTable rows={expenses} ariaLabel="Expenses" emptyIcon="💸" emptyText="No expenses recorded"
            cols={[
              { key: 'id', label: 'ID' },
              { key: 'description', label: 'Description' },
              { key: 'category', label: 'Category' },
              { key: 'project', label: 'Project' },
              { key: 'date', label: 'Date' },
              { key: 'amount', label: 'Amount', render: r => <span style={{ fontFamily: 'var(--jarvis-font-mono)', fontWeight: 700, color: 'var(--jarvis-amb)' }}>{fmt(Number(r['amount'] ?? 0))}</span> },
            ]} />
        </div>
      )}

      {tab === 'journal' && (
        <GenericTable rows={journal} ariaLabel="Journal Entries" emptyIcon="📒" emptyText="No journal entries"
          cols={[
            { key: 'id', label: 'Entry #' },
            { key: 'date', label: 'Date' },
            { key: 'account', label: 'Account' },
            { key: 'description', label: 'Description' },
            { key: 'debit', label: 'Debit', render: r => r['debit'] ? <span style={{ fontFamily: 'var(--jarvis-font-mono)', color: 'var(--jarvis-red)' }}>{fmt(Number(r['debit']))}</span> : <span className="jarvis-muted">—</span> },
            { key: 'credit', label: 'Credit', render: r => r['credit'] ? <span style={{ fontFamily: 'var(--jarvis-font-mono)', color: 'var(--jarvis-grn)' }}>{fmt(Number(r['credit']))}</span> : <span className="jarvis-muted">—</span> },
          ]} />
      )}
    </div>
  )
}

export default FinanceView
