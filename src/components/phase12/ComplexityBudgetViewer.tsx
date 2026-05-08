// Denver Engineering — Complexity Budget Viewer (Phase 12)
// Tracks platform complexity against budget limits

import React, { useState, useEffect } from 'react'

interface ComplexityBudget {
  id: string
  environment: string
  serviceCount: number
  averageDependencies: number
  replaySurface: number
  pluginCount: number
  totalComplexityScore: number
  budgetLimit: number
  isOverBudget: boolean
  measuredAt: string
}

interface GuardCheck {
  checkName: string
  category: string
  passed: boolean
  currentValue: number
  threshold: number
  detail: string
}

export function ComplexityBudgetViewer() {
  const [budget, setBudget] = useState<ComplexityBudget | null>(null)
  const [trend, setTrend] = useState<ComplexityBudget[]>([])
  const [guardChecks, setGuardChecks] = useState<GuardCheck[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const [budgetRes, guardRes] = await Promise.all([
          fetch('/api/phase12/complexity/budget?environment=production'),
          fetch('/api/phase12/complexity/guard-checks'),
        ])
        const budgetData = await budgetRes.json()
        setBudget(budgetData.latest)
        setTrend(budgetData.trend ?? [])
        const guardData = await guardRes.json()
        setGuardChecks(guardData.checks ?? [])
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) return <div style={{ color: '#64748b', padding: 24 }}>Loading…</div>

  const utilizationPct = budget ? Math.round((budget.totalComplexityScore / budget.budgetLimit) * 100) : 0
  const utilizationColor = utilizationPct > 100 ? '#ef4444' : utilizationPct > 85 ? '#f97316' : utilizationPct > 65 ? '#eab308' : '#22c55e'

  return (
    <div style={{ background: '#0a0f1e', fontFamily: 'sans-serif', padding: 24 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0', marginBottom: 20 }}>📐 Complexity Budget</div>

      {budget && (
        <>
          {/* Budget Gauge */}
          <div style={{ background: '#0f172a', border: `1px solid ${utilizationColor}30`, borderRadius: 8, padding: 20, marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 28, fontWeight: 700, color: utilizationColor }}>
                  {budget.totalComplexityScore}
                  <span style={{ fontSize: 14, color: '#64748b' }}> / {budget.budgetLimit}</span>
                </div>
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                  Complexity Score — {utilizationPct}% of budget
                </div>
              </div>
              {budget.isOverBudget && (
                <span style={{ padding: '4px 10px', borderRadius: 4, background: '#ef444420', color: '#ef4444', fontSize: 11, fontWeight: 700 }}>
                  OVER BUDGET
                </span>
              )}
            </div>
            <div style={{ background: '#1e293b', borderRadius: 6, height: 8 }}>
              <div style={{
                width: `${Math.min(utilizationPct, 100)}%`, height: '100%', borderRadius: 6,
                background: utilizationColor, transition: 'width 0.4s',
              }} />
            </div>
          </div>

          {/* Breakdown */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
            {[
              ['Services', budget.serviceCount, '× 3'],
              ['Avg Deps', budget.averageDependencies.toFixed(1), '× 10'],
              ['Replay Surface', budget.replaySurface, '× 5'],
              ['Plugins', budget.pluginCount, '× 2'],
            ].map(([label, val, mult]) => (
              <div key={label as string} style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 6, padding: '10px 12px' }}>
                <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase' }}>{label}</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0', marginTop: 2 }}>{val}</div>
                <div style={{ fontSize: 10, color: '#334155' }}>{mult}</div>
              </div>
            ))}
          </div>

          {/* Guard Checks */}
          {guardChecks.length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 8, textTransform: 'uppercase' }}>
                Evolution Guard Checks
              </div>
              {guardChecks.map(check => (
                <div key={check.checkName} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '8px 12px', background: '#0f172a', border: '1px solid #1e293b',
                  borderRadius: 6, marginBottom: 6,
                }}>
                  <div>
                    <div style={{ fontSize: 12, color: '#e2e8f0' }}>{check.checkName}</div>
                    <div style={{ fontSize: 10, color: '#64748b' }}>{check.detail}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 12, color: check.passed ? '#22c55e' : '#ef4444', fontWeight: 700 }}>
                      {check.passed ? '✓ Pass' : '✗ Fail'}
                    </div>
                    <div style={{ fontSize: 10, color: '#64748b' }}>{check.currentValue} / {check.threshold}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
