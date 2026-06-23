/**
 * Denver Engineering — SafetyMainView  ·  Safety Main Dashboard (full HSE overview)
 * Wraps SafetyView with additional executive-level stats
 */
import React from 'react'
import { useBizStore, selectIncidents, selectDaysSinceLastIncident, selectRecordableRate } from '../modules/biz/store'
import { KpiCard }     from './KpiCard'
import { SafetyView }  from './SafetyView'
import type { PolicyConfig } from '../modules/biz/dispatch'

export interface SafetyMainViewProps { policy?: Partial<PolicyConfig>; onNavigate?: (tab: string) => void; onAudit?: (e: unknown) => void; onToast?: (msg: string, type: string) => void }

export function SafetyMainView({ policy, onNavigate, onAudit, onToast }: SafetyMainViewProps) {
  const incidents      = useBizStore(selectIncidents) as Record<string,unknown>[]
  const daysSinceLast  = useBizStore(selectDaysSinceLastIncident)
  const recordableRate = useBizStore(selectRecordableRate)
  const permits        = useBizStore(s => s.biz.permits ?? []) as Record<string,unknown>[]
  const jhas           = useBizStore(s => s.biz.jhas    ?? []) as Record<string,unknown>[]

  const openIncidents  = incidents.filter(i => i['status'] !== 'closed')
  const activePermits  = permits.filter(p => p['status'] === 'active' || p['status'] === 'approved')
  const approvedJHAs   = jhas.filter(j => j['status'] === 'approved')

  const hseScore = Math.min(100, Math.round(
    (daysSinceLast >= 30 ? 25 : daysSinceLast >= 7 ? 15 : 0) +
    (openIncidents.length === 0 ? 25 : openIncidents.length <= 2 ? 15 : 5) +
    (recordableRate <= 1 ? 25 : recordableRate <= 3 ? 15 : 0) +
    (jhas.length > 0 && approvedJHAs.length / jhas.length >= 0.8 ? 25 : 10)
  ))

  return (
    <div role="main" aria-label="Safety Main Dashboard">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8, marginBottom: 20 }}>
        <KpiCard label="HSE Score"          value={`${hseScore}/100`} color={hseScore >= 80 ? 'var(--jarvis-grn)' : hseScore >= 60 ? 'var(--jarvis-amb)' : 'var(--jarvis-red)'} sub="composite" />
        <KpiCard label="Days Safe"          value={daysSinceLast}     color={daysSinceLast >= 30 ? 'var(--jarvis-grn)' : 'var(--jarvis-red)'} sub="since last incident" />
        <KpiCard label="TRIR"               value={recordableRate}    color={recordableRate <= 1 ? 'var(--jarvis-grn)' : 'var(--jarvis-red)'} />
        <KpiCard label="Open Incidents"     value={openIncidents.length} color={openIncidents.length === 0 ? 'var(--jarvis-grn)' : 'var(--jarvis-red)'} />
        <KpiCard label="Active Permits"     value={activePermits.length}  color="var(--jarvis-blue)" />
        <KpiCard label="Approved JHAs"      value={approvedJHAs.length}   color="var(--jarvis-grn)" sub={`${jhas.length} total`} />
      </div>
      <SafetyView policy={{ writesEnabled: false, chatEnabled: false, exportsEnabled: false, activeRole: 'viewer', ...policy }} onNavigate={onNavigate} onAudit={onAudit} onToast={onToast} />
    </div>
  )
}
export default SafetyMainView
