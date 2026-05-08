/**
 * JARVIS EPC — BudgetView · Project Budget + Change Orders  (v4.31.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * Procore Financials-parity: cost-code line items (original / revised /
 * committed / actual / forecast), rollup KPIs, change order register.
 */
import React, { useState, useEffect, useCallback } from 'react'
import { useBizStore, selectProjects } from '../modules/biz/store'
import type { PolicyConfig } from '../modules/biz/dispatch'

interface Budget {
  id: string; name: string; currency: string; status: string
  original_total: number; revised_total: number; committed_total: number
  actual_total: number; forecast_total: number; baseline_date?: string
}
interface BudgetItem {
  id: string; cost_code: string; description: string; category?: string; unit?: string
  qty: number; unit_cost: number; original_amount: number; revised_amount: number
  committed_amount: number; actual_amount: number; forecast_amount: number; notes?: string
}
interface ChangeOrder {
  id: string; co_number: string; co_type: string; title: string; description?: string
  reason_code?: string; amount: number; schedule_days: number; status: string; created_at: string
}
interface Rollup { original_total: number; revised_total: number; committed_total: number; actual_total: number; forecast_total: number; item_count: number }

export interface BudgetViewProps { policy?: Partial<PolicyConfig> }

const fmt = (n: number, cur = 'USD') => new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(n || 0)

export function BudgetView({ policy }: BudgetViewProps) {
  const projects = useBizStore(selectProjects)
  const [projectId, setProjectId] = useState('')
  const [budget, setBudget] = useState<Budget | null>(null)
  const [items, setItems] = useState<BudgetItem[]>([])
  const [rollup, setRollup] = useState<Rollup | null>(null)
  const [cos, setCos] = useState<ChangeOrder[]>([])
  const [tab, setTab] = useState<'items'|'change_orders'>('items')
  const [newItem, setNewItem] = useState({ cost_code: '', description: '', category: 'labor', unit: 'LS', qty: 1, unit_cost: 0 })
  const [newCO, setNewCO] = useState({ co_type: 'PCO', title: '', description: '', reason_code: 'owner_request', amount: 0, schedule_days: 0 })
  const [creatingItem, setCreatingItem] = useState(false)
  const [creatingCO, setCreatingCO] = useState(false)

  useEffect(() => { if (projects?.length && !projectId) setProjectId(projects[0].id) }, [projects])

  const reload = useCallback(async () => {
    if (!projectId) return
    const [b, r, c] = await Promise.all([
      fetch(`/api/v1/projects/${projectId}/budget`).then(r => r.json()),
      fetch(`/api/v1/projects/${projectId}/budget/rollup`).then(r => r.json()),
      fetch(`/api/v1/projects/${projectId}/change-orders`).then(r => r.json()),
    ])
    let bud = b.budget
    if (!bud) {
      const nb = await fetch(`/api/v1/projects/${projectId}/budget`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(r => r.json())
      bud = nb.budget
    }
    setBudget(bud); setRollup(r.rollup); setCos(c.change_orders ?? [])
    if (bud) {
      const it = await fetch(`/api/v1/budgets/${bud.id}/items`).then(r => r.json())
      setItems(it.items ?? [])
    }
  }, [projectId])

  useEffect(() => { reload() }, [reload])

  const addItem = async () => {
    if (!budget) return
    const res = await fetch(`/api/v1/budgets/${budget.id}/items`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newItem),
    })
    if (res.ok) { setCreatingItem(false); setNewItem({ cost_code: '', description: '', category: 'labor', unit: 'LS', qty: 1, unit_cost: 0 }); reload() }
  }

  const addCO = async () => {
    const res = await fetch(`/api/v1/projects/${projectId}/change-orders`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newCO),
    })
    if (res.ok) { setCreatingCO(false); setNewCO({ co_type: 'PCO', title: '', description: '', reason_code: 'owner_request', amount: 0, schedule_days: 0 }); reload() }
  }

  const updateCO = async (id: string, status: string) => {
    await fetch(`/api/v1/change-orders/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) })
    reload()
  }

  const canWrite = policy?.writesEnabled !== false
  const cur = budget?.currency ?? 'USD'
  const variance = rollup ? (rollup.revised_total - rollup.forecast_total) : 0

  return (
    <div role="main" aria-label="Budget" style={{ padding: 16 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>💰 Budget & Change Orders</h2>
        <select value={projectId} onChange={e => setProjectId(e.target.value)} style={{ padding: 6 }}>
          {projects?.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {/* KPI strip */}
      {rollup && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: 16 }}>
          {[
            { label: 'Original', v: rollup.original_total, color: '#3498db' },
            { label: 'Revised', v: rollup.revised_total, color: '#9b59b6' },
            { label: 'Committed', v: rollup.committed_total, color: '#f39c12' },
            { label: 'Actual', v: rollup.actual_total, color: '#e67e22' },
            { label: 'Variance', v: variance, color: variance >= 0 ? '#27ae60' : '#e74c3c' },
          ].map(k => (
            <div key={k.label} style={{ padding: 12, background: 'var(--jarvis-bg2)', border: '1px solid var(--jarvis-bd)', borderRadius: 6, borderLeft: `4px solid ${k.color}` }}>
              <div style={{ fontSize: 11, color: 'var(--jarvis-ts)' }}>{k.label}</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{fmt(k.v, cur)}</div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--jarvis-bd)', marginBottom: 12 }}>
        {(['items','change_orders'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: '8px 16px', background: 'transparent', border: 'none', borderBottom: tab === t ? '2px solid var(--jarvis-ac)' : '2px solid transparent', color: tab === t ? 'var(--jarvis-tx)' : 'var(--jarvis-ts)', fontWeight: tab === t ? 700 : 500, cursor: 'pointer' }}>
            {t === 'items' ? 'Line Items' : 'Change Orders'}
          </button>
        ))}
        {canWrite && (
          <button onClick={() => tab === 'items' ? setCreatingItem(true) : setCreatingCO(true)} style={{ marginLeft: 'auto', padding: '6px 12px', background: 'var(--jarvis-ac)', color: '#fff', border: 'none', borderRadius: 4 }}>
            + {tab === 'items' ? 'Item' : 'Change Order'}
          </button>
        )}
      </div>

      {tab === 'items' && (
        <>
          {creatingItem && (
            <div style={{ border: '1px solid var(--jarvis-bd)', padding: 10, marginBottom: 10, background: 'var(--jarvis-bg2)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8 }}>
                <input placeholder="Cost code" value={newItem.cost_code} onChange={e => setNewItem({ ...newItem, cost_code: e.target.value })} />
                <input placeholder="Description" value={newItem.description} onChange={e => setNewItem({ ...newItem, description: e.target.value })} style={{ gridColumn: 'span 2' }} />
                <select value={newItem.category} onChange={e => setNewItem({ ...newItem, category: e.target.value })}>
                  {['labor','material','equipment','subcontract','other'].map(c => <option key={c}>{c}</option>)}
                </select>
                <input type="number" placeholder="Qty" value={newItem.qty} onChange={e => setNewItem({ ...newItem, qty: +e.target.value })} />
                <input type="number" placeholder="Unit cost" value={newItem.unit_cost} onChange={e => setNewItem({ ...newItem, unit_cost: +e.target.value })} />
              </div>
              <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                <button onClick={addItem} style={{ background: 'var(--jarvis-ac)', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: 4 }}>Save</button>
                <button onClick={() => setCreatingItem(false)}>Cancel</button>
              </div>
            </div>
          )}
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr style={{ background: 'var(--jarvis-bg2)', textAlign: 'left' }}>
              <th style={{ padding: 6 }}>Cost Code</th><th>Description</th><th>Cat</th><th>Qty</th><th style={{ textAlign: 'right' }}>Unit $</th>
              <th style={{ textAlign: 'right' }}>Original</th><th style={{ textAlign: 'right' }}>Revised</th>
              <th style={{ textAlign: 'right' }}>Committed</th><th style={{ textAlign: 'right' }}>Actual</th>
            </tr></thead>
            <tbody>
              {items.map(i => (
                <tr key={i.id} style={{ borderBottom: '1px solid var(--jarvis-bd)' }}>
                  <td style={{ padding: 6, fontWeight: 600 }}>{i.cost_code}</td>
                  <td>{i.description}</td>
                  <td>{i.category}</td>
                  <td>{i.qty} {i.unit}</td>
                  <td style={{ textAlign: 'right' }}>{fmt(i.unit_cost, cur)}</td>
                  <td style={{ textAlign: 'right' }}>{fmt(i.original_amount, cur)}</td>
                  <td style={{ textAlign: 'right' }}>{fmt(i.revised_amount, cur)}</td>
                  <td style={{ textAlign: 'right' }}>{fmt(i.committed_amount, cur)}</td>
                  <td style={{ textAlign: 'right' }}>{fmt(i.actual_amount, cur)}</td>
                </tr>
              ))}
              {!items.length && <tr><td colSpan={9} style={{ padding: 20, textAlign: 'center', color: 'var(--jarvis-ts)' }}>No line items yet.</td></tr>}
            </tbody>
          </table>
        </>
      )}

      {tab === 'change_orders' && (
        <>
          {creatingCO && (
            <div style={{ border: '1px solid var(--jarvis-bd)', padding: 10, marginBottom: 10, background: 'var(--jarvis-bg2)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                <select value={newCO.co_type} onChange={e => setNewCO({ ...newCO, co_type: e.target.value })}>
                  {['PCO','OCO','subcontract_co'].map(t => <option key={t}>{t}</option>)}
                </select>
                <input placeholder="Title" value={newCO.title} onChange={e => setNewCO({ ...newCO, title: e.target.value })} style={{ gridColumn: 'span 3' }} />
                <select value={newCO.reason_code} onChange={e => setNewCO({ ...newCO, reason_code: e.target.value })}>
                  {['owner_request','design_error','ff_conditions','scope_add','schedule'].map(r => <option key={r}>{r}</option>)}
                </select>
                <input type="number" placeholder="Amount" value={newCO.amount} onChange={e => setNewCO({ ...newCO, amount: +e.target.value })} />
                <input type="number" placeholder="Schedule days" value={newCO.schedule_days} onChange={e => setNewCO({ ...newCO, schedule_days: +e.target.value })} />
              </div>
              <textarea placeholder="Description" value={newCO.description} onChange={e => setNewCO({ ...newCO, description: e.target.value })} style={{ width: '100%', marginTop: 8, minHeight: 50 }} />
              <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                <button onClick={addCO} style={{ background: 'var(--jarvis-ac)', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: 4 }}>Save</button>
                <button onClick={() => setCreatingCO(false)}>Cancel</button>
              </div>
            </div>
          )}
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr style={{ background: 'var(--jarvis-bg2)', textAlign: 'left' }}>
              <th style={{ padding: 6 }}>CO #</th><th>Type</th><th>Title</th><th>Reason</th>
              <th style={{ textAlign: 'right' }}>Amount</th><th>Days</th><th>Status</th><th></th>
            </tr></thead>
            <tbody>
              {cos.map(c => (
                <tr key={c.id} style={{ borderBottom: '1px solid var(--jarvis-bd)' }}>
                  <td style={{ padding: 6, fontWeight: 600 }}>{c.co_number}</td>
                  <td>{c.co_type}</td>
                  <td>{c.title}</td>
                  <td>{c.reason_code}</td>
                  <td style={{ textAlign: 'right' }}>{fmt(c.amount, cur)}</td>
                  <td>{c.schedule_days}</td>
                  <td><span style={{ padding: '2px 8px', background: c.status === 'approved' ? '#27ae60' : c.status === 'rejected' ? '#e74c3c' : '#3498db', color: '#fff', borderRadius: 10, fontSize: 11 }}>{c.status}</span></td>
                  <td>
                    {canWrite && c.status === 'draft' && <button onClick={() => updateCO(c.id, 'submitted')}>Submit</button>}
                    {canWrite && c.status === 'submitted' && <>
                      <button onClick={() => updateCO(c.id, 'approved')}>✓</button>
                      <button onClick={() => updateCO(c.id, 'rejected')}>✗</button>
                    </>}
                    {canWrite && c.status === 'approved' && <button onClick={() => updateCO(c.id, 'executed')}>Execute</button>}
                  </td>
                </tr>
              ))}
              {!cos.length && <tr><td colSpan={8} style={{ padding: 20, textAlign: 'center', color: 'var(--jarvis-ts)' }}>No change orders.</td></tr>}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}

export default BudgetView
