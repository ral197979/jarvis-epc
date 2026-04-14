/**
 * JARVIS EPC — HtView  ·  HSE Tracking (incident pipeline by stage)
 */
import React, { useState } from 'react'
import { useBizStore, selectIncidents } from '../modules/biz/store'
import { createDispatch, type PolicyConfig } from '../modules/biz/dispatch'
import { JARVIS_ACTIONS } from '../modules/biz/reducer'
import { StatusBadge } from './StatusBadge'
import { KpiCard }     from './KpiCard'

export interface HtViewProps { policy?: Partial<PolicyConfig>; onToast?: (msg: string, type: string) => void; onAudit?: (e: unknown) => void }
const DEF: PolicyConfig = { writesEnabled: false, chatEnabled: false, exportsEnabled: false, activeRole: 'viewer' }

const STAGES = ['reported','investigation','corrective','reviewed','closed']

export function HtView({ policy: pProp, onToast, onAudit }: HtViewProps) {
  const policy    = { ...DEF, ...pProp }
  const incidents = useBizStore(selectIncidents) as Record<string,unknown>[]
  const canWrite  = policy.writesEnabled && policy.activeRole !== 'viewer'
  const [selected, setSelected] = useState<Record<string,unknown> | null>(null)
  const { dispatch } = React.useMemo(() => createDispatch({ policy, audit: onAudit ? e => onAudit(e) : undefined, toast: onToast ? (m,t) => onToast(m,t) : undefined }), [policy])

  function advance(inc: Record<string,unknown>) {
    const idx = STAGES.indexOf(String(inc['status'] ?? 'reported'))
    if (idx < STAGES.length - 1) {
      dispatch({ type: JARVIS_ACTIONS.UPDATE_STATUS, data: { id: inc['id'] as string, collection: 'incidents', status: STAGES[idx + 1] } })
      onToast?.('Status advanced', 'success')
    }
  }

  return (
    <div role="main" aria-label="HSE Tracking">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 8, marginBottom: 16 }}>
        {STAGES.map(stage => (
          <KpiCard key={stage} label={stage.charAt(0).toUpperCase() + stage.slice(1)} value={incidents.filter(i => (i['status'] ?? 'reported') === stage).length}
            color={stage === 'closed' ? 'var(--jarvis-grn)' : stage === 'reported' ? 'var(--jarvis-red)' : 'var(--jarvis-amb)'} />
        ))}
      </div>
      {selected ? (
        <div className="jarvis-card" style={{ padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h4 className="jarvis-heading" style={{ margin: 0 }}>{String(selected['title'] ?? selected['description'] ?? selected['id'])}</h4>
            <button className="jarvis-btn jarvis-btn-ghost jarvis-btn-sm" onClick={() => setSelected(null)}>← Back</button>
          </div>
          <div style={{ display: 'flex', gap: 0, marginBottom: 16 }}>
            {STAGES.map((s, i) => {
              const cur = String(selected['status'] ?? 'reported')
              const curIdx = STAGES.indexOf(cur)
              const isPast = i < curIdx, isActive = s === cur
              return <div key={s} style={{ flex: 1, padding: '6px 4px', background: isActive ? 'var(--jarvis-ac)' : isPast ? 'var(--jarvis-grn)' : 'var(--jarvis-bd)', color: isActive || isPast ? '#fff' : 'var(--jarvis-td)', fontSize: 10, fontWeight: isActive ? 700 : 500, textAlign: 'center', borderRight: i < STAGES.length-1 ? '1px solid rgba(0,0,0,0.1)' : 'none', borderRadius: i === 0 ? '6px 0 0 6px' : i === STAGES.length-1 ? '0 6px 6px 0' : 0, textTransform: 'capitalize' }}>{s}</div>
            })}
          </div>
          <p className="jarvis-body">{String(selected['description'] ?? '—')}</p>
          {canWrite && selected['status'] !== 'closed' && (
            <button className="jarvis-btn jarvis-btn-primary" style={{ marginTop: 12 }} onClick={() => advance(selected)}>Advance to Next Stage →</button>
          )}
        </div>
      ) : (
        incidents.length === 0 ? (
          <div className="jarvis-empty"><span className="jarvis-empty-icon">✅</span><span>No incidents to track</span></div>
        ) : (
          <div className="jarvis-scroll-y jarvis-max-h-lg">
            {incidents.map((inc, idx) => (
              <div key={String(inc['id'] ?? idx)} className="jarvis-row" style={{ cursor: 'pointer' }} onClick={() => setSelected(inc)}>
                <div className="jarvis-flex-1">
                  <span className="jarvis-body" style={{ fontWeight: 600 }}>{String(inc['title'] ?? inc['description'] ?? inc['id'])}</span>
                  <span className="jarvis-small" style={{ display: 'block' }}>{String(inc['date'] ?? '—')} · {String(inc['location'] ?? '—')}</span>
                </div>
                <StatusBadge status={String(inc['status'] ?? 'reported')} />
              </div>
            ))}
          </div>
        )
      )}
    </div>
  )
}
export default HtView
