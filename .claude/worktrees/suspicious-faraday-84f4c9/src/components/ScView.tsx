/**
 * JARVIS EPC — ScView  ·  Schedule Intelligence (EVM-driven schedule analysis)
 */
import React from 'react'
import { useBizStore, selectContracts, selectEVMProjects } from '../modules/biz/store'
import { KpiCard }     from './KpiCard'
import { StatusBadge } from './StatusBadge'
import type { PolicyConfig } from '../modules/biz/dispatch'

export interface ScViewProps { policy?: Partial<PolicyConfig> }

export function ScView({ policy: _p }: ScViewProps) {
  const contracts  = useBizStore(selectContracts)
  const evmProjects = useBizStore(selectEVMProjects)
  const evmMap     = new Map(evmProjects.map(e => [e.project, e]))

  const withEVM    = contracts.filter(c => evmMap.has(String(c['project'] ?? '')))
  const avgSPI     = evmProjects.length ? evmProjects.reduce((s, e) => s + e.spi, 0) / evmProjects.length : null
  const behindSchedule = evmProjects.filter(e => e.spi < 1).length
  const onSchedule     = evmProjects.filter(e => e.spi >= 1).length

  return (
    <div role="main" aria-label="Schedule Intelligence">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8, marginBottom: 20 }}>
        <KpiCard label="Avg SPI"        value={avgSPI != null ? avgSPI.toFixed(2) : '—'} color={avgSPI != null ? (avgSPI >= 1 ? 'var(--jarvis-grn)' : 'var(--jarvis-red)') : 'var(--jarvis-td)'} sub={avgSPI != null ? (avgSPI >= 1 ? 'on schedule' : 'behind') : 'no EVM data'} />
        <KpiCard label="On Schedule"    value={onSchedule}      color="var(--jarvis-grn)" />
        <KpiCard label="Behind"         value={behindSchedule}  color={behindSchedule > 0 ? 'var(--jarvis-red)' : 'var(--jarvis-grn)'} />
        <KpiCard label="Total Projects" value={contracts.length} />
        <KpiCard label="EVM Coverage"   value={evmProjects.length} sub={`of ${contracts.length} contracts`} color="var(--jarvis-blue)" />
      </div>
      {evmProjects.length === 0 ? (
        <div className="jarvis-empty"><span className="jarvis-empty-icon">📅</span><span>No EVM data — add EVM records to enable schedule intelligence</span></div>
      ) : (
        <div className="jarvis-card" style={{ padding: 16 }}>
          <h4 className="jarvis-label" style={{ marginBottom: 12 }}>Schedule Performance by Project</h4>
          <div className="jarvis-scroll-y jarvis-max-h-lg">
            <table className="jarvis-table" aria-label="Schedule performance">
              <thead><tr><th>Project</th><th>Period</th><th>SPI</th><th>EV</th><th>PV</th><th>Variance</th><th>Status</th></tr></thead>
              <tbody>
                {evmProjects.map(e => {
                  const c = contracts.find(c => String(c['project'] ?? '') === e.project)
                  return (
                    <tr key={String(e.id ?? e.project)}>
                      <td style={{ fontWeight: 600 }}>{e.project}</td>
                      <td style={{ fontFamily: 'var(--jarvis-font-mono)', fontSize: 11 }}>{e.period}</td>
                      <td style={{ fontFamily: 'var(--jarvis-font-mono)', fontWeight: 700, color: e.spi >= 1 ? 'var(--jarvis-grn)' : 'var(--jarvis-red)' }}>{e.spi.toFixed(2)}</td>
                      <td style={{ fontFamily: 'var(--jarvis-font-mono)', fontSize: 11 }}>${e.ev.toLocaleString()}</td>
                      <td style={{ fontFamily: 'var(--jarvis-font-mono)', fontSize: 11 }}>${e.pv.toLocaleString()}</td>
                      <td style={{ fontFamily: 'var(--jarvis-font-mono)', fontWeight: 700, color: e.sv >= 0 ? 'var(--jarvis-grn)' : 'var(--jarvis-red)' }}>${e.sv.toLocaleString()}</td>
                      <td><StatusBadge status={String(c?.['status'] ?? 'active')} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
export default ScView
