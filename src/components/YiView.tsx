/**
 * Denver Engineering — YiView  ·  Yield & Financial Performance KPIs
 */
import React from 'react'
import { useBizStore, selectEVMProjects, selectInvoices, selectExpenses } from '../modules/biz/store'
import { KpiCard } from './KpiCard'
import type { PolicyConfig } from '../modules/biz/dispatch'

export interface YiViewProps { policy?: Partial<PolicyConfig> }
function fmt(n: number) { if (n >= 1_000_000) return `$${(n/1_000_000).toFixed(1)}M`; if (n >= 1_000) return `$${(n/1_000).toFixed(0)}K`; return `$${n.toFixed(0)}` }
function pct(a: number, b: number) { return b > 0 ? `${((a/b)*100).toFixed(1)}%` : '—' }

export function YiView({ policy: _p }: YiViewProps) {
  const invoices    = useBizStore(selectInvoices)
  const expenses    = useBizStore(selectExpenses)
  const evmProjects = useBizStore(selectEVMProjects)

  const totalInvoiced  = invoices.reduce((s, i) => s + Number(i['amount'] ?? 0), 0)
  const totalCollected = invoices.filter(i => i['status'] === 'paid').reduce((s, i) => s + Number(i['amount'] ?? 0), 0)
  const totalExpenses  = expenses.reduce((s, e) => s + Number(e['amount'] ?? 0), 0)
  const grossProfit    = totalCollected - totalExpenses
  const margin         = totalCollected > 0 ? grossProfit / totalCollected : 0
  const collectionRate = totalInvoiced  > 0 ? totalCollected / totalInvoiced : 0
  const avgCPI         = evmProjects.length ? evmProjects.reduce((s, e) => s + e.cpi, 0) / evmProjects.length : null
  const avgSPI         = evmProjects.length ? evmProjects.reduce((s, e) => s + e.spi, 0) / evmProjects.length : null
  const totalBudget    = evmProjects.reduce((s, e) => s + (e.budget ?? 0), 0)
  const totalEAC       = evmProjects.reduce((s, e) => s + (e.eac ?? 0), 0)
  const budgetVariance = totalBudget - totalEAC

  const kpis = [
    { label: 'Total Invoiced',    value: fmt(totalInvoiced),            color: 'var(--jarvis-blue)', sub: `${invoices.length} invoices` },
    { label: 'Total Collected',   value: fmt(totalCollected),           color: 'var(--jarvis-grn)',  sub: pct(totalCollected, totalInvoiced) + ' collection rate' },
    { label: 'Total Expenses',    value: fmt(totalExpenses),            color: 'var(--jarvis-amb)',  sub: `${expenses.length} items` },
    { label: 'Gross Profit',      value: fmt(grossProfit),              color: grossProfit >= 0 ? 'var(--jarvis-grn)' : 'var(--jarvis-red)', sub: pct(grossProfit, totalCollected) + ' margin' },
    { label: 'Gross Margin',      value: `${(margin * 100).toFixed(1)}%`, color: margin >= 0.15 ? 'var(--jarvis-grn)' : margin >= 0.05 ? 'var(--jarvis-amb)' : 'var(--jarvis-red)' },
    { label: 'Collection Rate',   value: `${(collectionRate * 100).toFixed(1)}%`, color: collectionRate >= 0.9 ? 'var(--jarvis-grn)' : 'var(--jarvis-amb)' },
    { label: 'Portfolio CPI',     value: avgCPI != null ? avgCPI.toFixed(2) : '—', color: avgCPI != null ? (avgCPI >= 1 ? 'var(--jarvis-grn)' : 'var(--jarvis-red)') : 'var(--jarvis-td)', sub: avgCPI != null ? (avgCPI >= 1 ? 'on budget' : 'over budget') : 'no EVM data' },
    { label: 'Portfolio SPI',     value: avgSPI != null ? avgSPI.toFixed(2) : '—', color: avgSPI != null ? (avgSPI >= 1 ? 'var(--jarvis-grn)' : 'var(--jarvis-red)') : 'var(--jarvis-td)', sub: avgSPI != null ? (avgSPI >= 1 ? 'on schedule' : 'behind') : 'no EVM data' },
    { label: 'Budget Variance',   value: fmt(budgetVariance),           color: budgetVariance >= 0 ? 'var(--jarvis-grn)' : 'var(--jarvis-red)', sub: `across ${evmProjects.length} projects` },
  ]

  return (
    <div role="main" aria-label="Yield & Performance">
      <h3 className="jarvis-heading" style={{ marginBottom: 16 }}>Financial Performance Dashboard</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 24 }}>
        {kpis.map(k => <KpiCard key={k.label} label={k.label} value={k.value} color={k.color} sub={k.sub} />)}
      </div>

      {evmProjects.length > 0 && (
        <div className="jarvis-card" style={{ padding: 16 }}>
          <h4 className="jarvis-label" style={{ marginBottom: 12 }}>EVM Project Performance</h4>
          <div className="jarvis-scroll-y jarvis-max-h-lg">
            <table className="jarvis-table" aria-label="EVM project performance">
              <thead><tr><th>Project</th><th>Budget</th><th>EAC</th><th>CPI</th><th>SPI</th><th>VAC</th></tr></thead>
              <tbody>
                {evmProjects.map(e => (
                  <tr key={String(e.id ?? e.project)}>
                    <td style={{ fontWeight: 600 }}>{e.project}</td>
                    <td style={{ fontFamily: 'var(--jarvis-font-mono)' }}>{fmt(e.budget)}</td>
                    <td style={{ fontFamily: 'var(--jarvis-font-mono)', color: e.eac > e.budget ? 'var(--jarvis-red)' : 'var(--jarvis-grn)' }}>{fmt(e.eac)}</td>
                    <td style={{ fontFamily: 'var(--jarvis-font-mono)', fontWeight: 700, color: e.cpi >= 1 ? 'var(--jarvis-grn)' : 'var(--jarvis-red)' }}>{e.cpi.toFixed(2)}</td>
                    <td style={{ fontFamily: 'var(--jarvis-font-mono)', fontWeight: 700, color: e.spi >= 1 ? 'var(--jarvis-grn)' : 'var(--jarvis-red)' }}>{e.spi.toFixed(2)}</td>
                    <td style={{ fontFamily: 'var(--jarvis-font-mono)', color: e.vac >= 0 ? 'var(--jarvis-grn)' : 'var(--jarvis-red)' }}>{fmt(e.vac)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
export default YiView
