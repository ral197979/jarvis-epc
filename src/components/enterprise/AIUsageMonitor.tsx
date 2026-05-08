// Denver Engineering — AI Usage Monitor (v8.0.0)
// Tracks token consumption, cost by agent, and budget utilization with alerts.

import React, { useEffect, useState } from 'react'
import { AiBudgetStatus } from '../../../api/services/enterprise/enterpriseTypes'

interface AgentCostRow {
  agentType: string | null
  totalCost: number
  totalTokens: number
  callCount: number
}

interface Props {
  tenantId: string
}

function BudgetBar({ pct, isNear, isOver }: { pct: number; isNear: boolean; isOver: boolean }) {
  const color = isOver ? 'bg-red-500' : isNear ? 'bg-amber-500' : 'bg-emerald-500'
  return (
    <div className="w-full bg-gray-700 rounded-full h-2 overflow-hidden">
      <div className={`h-2 rounded-full transition-all ${color}`} style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  )
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

export function AIUsageMonitor({ tenantId }: Props) {
  const [budget, setBudget] = useState<AiBudgetStatus | null>(null)
  const [byAgent, setByAgent] = useState<AgentCostRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const headers = { 'X-Tenant-ID': tenantId }
    Promise.all([
      fetch('/api/v1/enterprise/ai-usage/budget', { headers }).then(r => r.json()),
      fetch('/api/v1/enterprise/ai-usage/by-agent', { headers }).then(r => r.json()),
    ])
      .then(([b, a]: [AiBudgetStatus, AgentCostRow[]]) => {
        setBudget(b)
        setByAgent(a)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [tenantId])

  if (loading) return <div className="p-4 text-gray-400 animate-pulse">Loading AI usage…</div>
  if (!budget) return null

  const pct = budget.utilizationPct ?? 0

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg p-5 space-y-5">
      <h2 className="text-white font-semibold">AI Usage & Budget</h2>

      {/* Budget overview */}
      <div className="bg-gray-800 rounded-lg p-4 space-y-3">
        <div className="flex justify-between items-baseline">
          <span className="text-sm text-gray-400">Monthly Budget</span>
          {budget.budgetMonthly != null
            ? <span className="text-white font-medium">${budget.budgetMonthly.toFixed(2)}</span>
            : <span className="text-gray-500 text-sm">Unlimited</span>}
        </div>
        <div className="flex justify-between items-baseline">
          <span className="text-sm text-gray-400">Spent</span>
          <span className={`font-medium ${budget.isOverBudget ? 'text-red-400' : 'text-white'}`}>
            ${budget.spendCurrent.toFixed(4)}
          </span>
        </div>
        {budget.budgetMonthly != null && (
          <>
            <BudgetBar pct={pct} isNear={budget.isNearLimit} isOver={budget.isOverBudget} />
            <div className="flex justify-between text-xs text-gray-500">
              <span>{pct.toFixed(1)}% used</span>
              {budget.remainingBudget != null && <span>${budget.remainingBudget.toFixed(2)} remaining</span>}
            </div>
            {budget.isOverBudget && (
              <p className="text-xs text-red-400 font-medium">⚠ Budget exceeded — AI operations may be throttled</p>
            )}
            {!budget.isOverBudget && budget.isNearLimit && (
              <p className="text-xs text-amber-400">⚠ Approaching budget limit</p>
            )}
          </>
        )}
      </div>

      {/* Cost by agent */}
      {byAgent.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Cost by Agent</p>
          {byAgent.slice(0, 8).map((row, i) => (
            <div key={i} className="flex items-center gap-3 text-sm">
              <span className="text-gray-300 flex-1 truncate">{row.agentType ?? 'unattributed'}</span>
              <span className="text-gray-400 text-xs">{fmt(row.totalTokens)} tok</span>
              <span className="text-white w-20 text-right">${row.totalCost.toFixed(4)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default AIUsageMonitor
