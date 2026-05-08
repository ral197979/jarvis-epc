/**
 * Denver Engineering — EngineeringView  ·  Engineering Overview
 */
import React, { useState } from 'react'
import { useBizStore }  from '../modules/biz/store'
import { KpiCard }      from './KpiCard'
import { StatusBadge }  from './StatusBadge'
import { AoView }       from './AoView'
import { AtView }       from './AtView'
import { CalcView }     from './CalcView'
import type { PolicyConfig } from '../modules/biz/dispatch'

type Tab = 'summary' | 'deliverables' | 'transmittals' | 'calculator'
export interface EngineeringViewProps { policy?: Partial<PolicyConfig>; biz?: Record<string,unknown> }

export function EngineeringView({ policy, biz: _b }: EngineeringViewProps) {
  const eng  = useBizStore(s => s.biz.engineering_deliverables ?? [])
  const inst = useBizStore(s => s.biz.installation ?? [])
  const man  = useBizStore(s => s.biz.manpower ?? [])
  const tx   = useBizStore(s => s.biz.transmittals ?? [])
  const [tab, setTab] = useState<Tab>('summary')

  const approved  = eng.filter(e => e['status'] === 'approved' || e['status'] === 'issued').length
  const inReview  = eng.filter(e => e['status'] === 'in-review').length
  const disciplines = [...new Set(eng.map(e => String(e['discipline'] ?? e['category'] ?? 'General')))].length

  const TABS: {id: Tab; label: string}[] = [
    {id:'summary', label:'Summary'},
    {id:'deliverables', label:'Deliverables'},
    {id:'transmittals', label:'Transmittals'},
    {id:'calculator', label:'Calculator'},
  ]
  const defPolicy: PolicyConfig = { writesEnabled: false, chatEnabled: false, exportsEnabled: false, activeRole: 'viewer', ...policy }

  return (
    <div role="main" aria-label="Engineering Overview">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8, marginBottom: 16 }}>
        <KpiCard label="Deliverables"  value={eng.length}         sub={`${approved} approved`} />
        <KpiCard label="In Review"     value={inReview}            color="var(--jarvis-amb)" />
        <KpiCard label="Disciplines"   value={disciplines}          color="var(--jarvis-blue)" />
        <KpiCard label="Installation"  value={inst.length}          color="var(--jarvis-pur)" />
        <KpiCard label="Transmittals"  value={tx.length}            color="var(--jarvis-grn)" />
        <KpiCard label="Manpower"      value={man.length}           color="var(--jarvis-td)" />
      </div>
      <div role="tablist" style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid var(--jarvis-bd)' }}>
        {TABS.map(t => <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} style={{ padding: '8px 14px 10px', background: 'transparent', border: 'none', borderBottom: tab === t.id ? '2px solid var(--jarvis-ac)' : '2px solid transparent', color: tab === t.id ? 'var(--jarvis-tx)' : 'var(--jarvis-ts)', fontWeight: tab === t.id ? 700 : 500, fontSize: 12, cursor: 'pointer' }}>{t.label}</button>)}
      </div>
      {tab === 'summary' && (
        eng.length === 0 ? (
          <div className="jarvis-empty"><span className="jarvis-empty-icon">⚙️</span><span>No engineering deliverables yet</span></div>
        ) : (
          <div className="jarvis-card" style={{ padding: 16 }}>
            <h4 className="jarvis-label" style={{ marginBottom: 12 }}>Recent Deliverables</h4>
            {eng.slice(0, 10).map((e, i) => (
              <div key={String(e['id'] ?? i)} className="jarvis-row">
                <div className="jarvis-flex-1"><span className="jarvis-body" style={{ fontWeight: 600 }}>{String(e['title'] ?? e['deliverable'] ?? e['id'])}</span><span className="jarvis-small" style={{ display:'block' }}>{String(e['discipline'] ?? '—')} · Rev {String(e['rev'] ?? e['revision'] ?? '0')}</span></div>
                <StatusBadge status={String(e['status'] ?? 'draft')} />
              </div>
            ))}
          </div>
        )
      )}
      {tab === 'deliverables'  && <AoView policy={defPolicy} />}
      {tab === 'transmittals'  && <AtView policy={defPolicy} />}
      {tab === 'calculator'    && <CalcView policy={defPolicy} />}
    </div>
  )
}
export default EngineeringView
