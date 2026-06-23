/**
 * Denver Engineering — FeedView  ·  Finance Feed (journal/transaction activity stream)
 */
import React, { useState, useMemo } from 'react'
import { useBizStore } from '../modules/biz/store'
import { createDispatch, type PolicyConfig } from '../modules/biz/dispatch'
import { JARVIS_ACTIONS } from '../modules/biz/reducer'

export interface FeedViewProps { policy?: Partial<PolicyConfig>; onAudit?: (e: unknown) => void; onToast?: (msg: string, type: string) => void }
const DEF: PolicyConfig = { writesEnabled: false, chatEnabled: false, exportsEnabled: false, activeRole: 'viewer' }
function fmt(n: number) { if (n >= 1_000_000) return `$${(n/1_000_000).toFixed(1)}M`; if (n >= 1_000) return `$${(n/1_000).toFixed(0)}K`; return `$${n.toFixed(0)}` }

export function FeedView({ policy: pProp, onAudit, onToast }: FeedViewProps) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const policy = { ...DEF, ...pProp }
  const invoices = useBizStore(s => s.biz.invoices ?? [])
  const expenses = useBizStore(s => s.biz.expenses ?? [])
  const journal  = useBizStore(s => s.biz.journal  ?? [])
  const [filter, setFilter] = useState<'all'|'invoice'|'expense'|'journal'>('all')
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState<Record<string,string>>({})
  const canWrite = policy.writesEnabled && policy.activeRole !== 'viewer'

  const { dispatch } = useMemo(() => createDispatch({ policy, audit: onAudit ? e => onAudit(e) : undefined, toast: onToast ? (m,t) => onToast(m,t) : undefined }), [policy, onAudit, onToast])

  type FeedItem = { id: string; type: string; description: string; amount?: number; date?: string; status?: string }
  const feed = useMemo<FeedItem[]>(() => {
    const items: FeedItem[] = [
      ...invoices.map(i => ({ id: String(i.id), type: 'invoice',  description: String(i['description'] ?? i.id), amount: Number(i['amount'] ?? 0), date: String(i['date'] ?? ''), status: String(i['status'] ?? 'unpaid') })),
      ...expenses.map(e => ({ id: String(e.id), type: 'expense',  description: String(e['description'] ?? e.id), amount: Number(e['amount'] ?? 0), date: String(e['date'] ?? '') })),
      ...journal .map(j => ({ id: String(j.id), type: 'journal',  description: String(j['description'] ?? j.id), amount: Number(j['debit'] ?? j['credit'] ?? 0), date: String(j['date'] ?? '') })),
    ].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
    return filter === 'all' ? items : items.filter(i => i.type === filter)
  }, [invoices, expenses, journal, filter])

  const typeIcon: Record<string, string> = { invoice: '🧾', expense: '💸', journal: '📒' }
  const typeColor: Record<string, string> = { invoice: 'var(--jarvis-blue)', expense: 'var(--jarvis-amb)', journal: 'var(--jarvis-pur)' }

  function submitJournal() {
    if (!form.description) return
    dispatch({ type: JARVIS_ACTIONS.ADD_JOURNAL, data: { id: `JRN-${Date.now()}`, ...form, debit: Number(form.debit ?? 0), credit: Number(form.credit ?? 0), date: new Date().toISOString().slice(0, 10) } })
    setForm({}); setShowAdd(false); onToast?.('Journal entry added', 'success')
  }

  return (
    <div role="main" aria-label="Finance Feed">
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['all','invoice','expense','journal'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} className={`jarvis-btn ${filter === f ? 'jarvis-btn-primary' : 'jarvis-btn-ghost'}`} style={{ fontSize: 11, padding: '4px 10px', textTransform: 'capitalize' }}>{f}</button>
          ))}
        </div>
        {canWrite && <button className="jarvis-btn jarvis-btn-primary" style={{ fontSize: 11 }} onClick={() => setShowAdd(v => !v)}>+ Journal Entry</button>}
      </div>

      {showAdd && (
        <div className="jarvis-card" style={{ padding: 16, marginBottom: 16 }}>
          <h4 className="jarvis-label" style={{ marginBottom: 10 }}>New Journal Entry</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 10, marginBottom: 12 }}>
            {[['description','Description'],['account','Account'],['debit','Debit ($)'],['credit','Credit ($)']].map(([k,l]) => (
              <div key={k}><label className="jarvis-small" htmlFor={`jrn-${k}`}>{l}</label>
                <input id={`jrn-${k}`} className="jarvis-input" value={form[k] ?? ''} onChange={e => setForm(f => ({...f,[k]:e.target.value}))} /></div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="jarvis-btn jarvis-btn-primary" onClick={submitJournal}>Save</button>
            <button className="jarvis-btn jarvis-btn-ghost" onClick={() => setShowAdd(false)}>Cancel</button>
          </div>
        </div>
      )}

      {feed.length === 0 ? (
        <div className="jarvis-empty"><span className="jarvis-empty-icon">📊</span><span>No financial activity yet</span></div>
      ) : (
        <div className="jarvis-scroll-y jarvis-max-h-lg">
          {feed.map(item => (
            <div key={`${item.type}-${item.id}`} className="jarvis-row" style={{ padding: '10px 0' }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', background: `color-mix(in srgb, ${typeColor[item.type]} 15%, transparent)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>
                {typeIcon[item.type]}
              </div>
              <div className="jarvis-flex-1">
                <span className="jarvis-body" style={{ fontWeight: 600 }}>{item.description}</span>
                <span className="jarvis-small" style={{ display: 'block', textTransform: 'capitalize' }}>{item.type} · {item.date || 'Unknown date'}</span>
              </div>
              {item.amount != null && item.amount !== 0 && (
                <span style={{ fontFamily: 'var(--jarvis-font-mono)', fontWeight: 700, color: typeColor[item.type], flexShrink: 0 }}>{fmt(item.amount)}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
export default FeedView
