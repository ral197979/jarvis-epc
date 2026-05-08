/**
 * JARVIS EPC — PlannerView  ·  Procurement Planner
 */
import React, { useState } from 'react'
import { LoView }  from './LoView'
import { BiView }  from './BiView'
import type { PolicyConfig } from '../modules/biz/dispatch'

type Tab = 'logistics' | 'bids'
export interface PlannerViewProps { policy?: Partial<PolicyConfig>; biz?: Record<string,unknown>; onToast?: (m: string, t: string) => void }
export function PlannerView({ policy, biz: _b, onToast }: PlannerViewProps) {
  const [tab, setTab] = useState<Tab>('logistics')
  const defPolicy: PolicyConfig = { writesEnabled: false, chatEnabled: false, exportsEnabled: false, activeRole: 'viewer', ...policy }
  return (
    <div role="main" aria-label="Procurement Planner">
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid var(--jarvis-bd)' }}>
        {(['logistics','bids'] as Tab[]).map(t => <button key={t} onClick={() => setTab(t)} style={{ padding: '8px 16px 10px', background: 'transparent', border: 'none', borderBottom: tab === t ? '2px solid var(--jarvis-ac)' : '2px solid transparent', color: tab === t ? 'var(--jarvis-tx)' : 'var(--jarvis-ts)', fontWeight: tab === t ? 700 : 500, fontSize: 12, cursor: 'pointer', textTransform: 'capitalize' }}>{t}</button>)}
      </div>
      {tab === 'logistics' && <LoView policy={defPolicy} />}
      {tab === 'bids'      && <BiView policy={defPolicy} onToast={onToast} />}
    </div>
  )
}
export default PlannerView
