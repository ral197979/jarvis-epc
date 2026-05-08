// Denver Engineering — Governance Stability Panel (Phase 12)
// Shows continuous governance audit results and regression alerts

import React, { useState, useEffect } from 'react'

interface AuditCycle {
  id: string
  environment: string
  passed: number
  failed: number
  warnings: number
  overallStatus: 'compliant' | 'warning' | 'non_compliant'
  auditHash: string
  ranAt: string
}

interface RegressionAlert {
  id: string
  checkType: string
  severity: 'critical' | 'warning'
  detail: string
  detectedAt: string
  resolvedAt: string | null
}

const STATUS_COLORS = { compliant: '#22c55e', warning: '#eab308', non_compliant: '#ef4444' }
const STATUS_LABELS = { compliant: '✅ Compliant', warning: '⚠️ Warning', non_compliant: '🚨 Non-Compliant' }

export function GovernanceStabilityPanel() {
  const [cycles, setCycles] = useState<AuditCycle[]>([])
  const [alerts, setAlerts] = useState<RegressionAlert[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const [cyclesRes, alertsRes] = await Promise.all([
          fetch('/api/phase12/governance/audit-cycles'),
          fetch('/api/phase12/governance/regression-alerts'),
        ])
        const cyclesData = await cyclesRes.json()
        const alertsData = await alertsRes.json()
        setCycles(cyclesData.cycles ?? [])
        setAlerts(alertsData.alerts ?? [])
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const latest = cycles[0]
  const openAlerts = alerts.filter(a => !a.resolvedAt)

  return (
    <div style={{ background: '#0a0f1e', fontFamily: 'sans-serif', padding: 24 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0', marginBottom: 20 }}>🏛️ Governance Stability</div>

      {loading ? (
        <div style={{ color: '#64748b', textAlign: 'center', padding: 40 }}>Loading…</div>
      ) : (
        <>
          {/* Latest Cycle */}
          {latest && (
            <div style={{
              background: '#0f172a', border: `1px solid ${STATUS_COLORS[latest.overallStatus]}40`,
              borderRadius: 8, padding: 16, marginBottom: 16,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: STATUS_COLORS[latest.overallStatus] }}>
                  {STATUS_LABELS[latest.overallStatus]}
                </div>
                <div style={{ fontSize: 11, color: '#64748b' }}>{new Date(latest.ranAt).toLocaleString()}</div>
              </div>
              <div style={{ display: 'flex', gap: 16 }}>
                {[['Passed', latest.passed, '#22c55e'], ['Warnings', latest.warnings, '#eab308'], ['Failed', latest.failed, '#ef4444']].map(([l, v, c]) => (
                  <div key={l as string}>
                    <div style={{ fontSize: 20, fontWeight: 700, color: c as string }}>{v}</div>
                    <div style={{ fontSize: 11, color: '#64748b' }}>{l}</div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 10, color: '#334155', marginTop: 10, fontFamily: 'monospace' }}>
                hash: {latest.auditHash}
              </div>
            </div>
          )}

          {/* Open Regression Alerts */}
          {openAlerts.length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 8, textTransform: 'uppercase' }}>
                Open Alerts ({openAlerts.length})
              </div>
              {openAlerts.map(alert => (
                <div key={alert.id} style={{
                  background: alert.severity === 'critical' ? '#ef444410' : '#eab30810',
                  border: `1px solid ${alert.severity === 'critical' ? '#ef444430' : '#eab30830'}`,
                  borderRadius: 6, padding: '10px 14px', marginBottom: 8,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: alert.severity === 'critical' ? '#ef4444' : '#eab308', textTransform: 'uppercase' }}>
                      {alert.severity}
                    </div>
                    <div style={{ fontSize: 11, color: '#64748b' }}>{new Date(alert.detectedAt).toLocaleTimeString()}</div>
                  </div>
                  <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 3 }}>
                    [{alert.checkType}] {alert.detail}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Cycle History */}
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 8, textTransform: 'uppercase' }}>
              Recent Cycles
            </div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {cycles.slice(0, 20).map(c => (
                <div
                  key={c.id}
                  title={`${STATUS_LABELS[c.overallStatus]} — ${new Date(c.ranAt).toLocaleString()}`}
                  style={{
                    width: 12, height: 12, borderRadius: 2,
                    background: STATUS_COLORS[c.overallStatus],
                  }}
                />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
