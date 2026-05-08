/**
 * Denver Engineering — FieldOperationsView  ·  Field Operations
 */
import React, { useState } from 'react'
import { FeView }  from './FeView'
import { WtView }  from './WtView'
import type { PolicyConfig } from '../modules/biz/dispatch'

type Tab = 'field' | 'tracking'
export interface FieldOperationsViewProps { policy?: Partial<PolicyConfig>; biz?: Record<string,unknown> }

export function FieldOperationsView({ policy, biz: _b }: FieldOperationsViewProps) {
  const [tab, setTab] = useState<Tab>('field')
  const defPolicy: PolicyConfig = { writesEnabled: false, chatEnabled: false, exportsEnabled: false, activeRole: 'viewer', ...policy }
  return (
    <div role="main" aria-label="Field Operations">
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid var(--jarvis-bd)' }}>
        {(['field','tracking'] as Tab[]).map(t => <button key={t} onClick={() => setTab(t)} style={{ padding: '8px 16px 10px', background: 'transparent', border: 'none', borderBottom: tab === t ? '2px solid var(--jarvis-ac)' : '2px solid transparent', color: tab === t ? 'var(--jarvis-tx)' : 'var(--jarvis-ts)', fontWeight: tab === t ? 700 : 500, fontSize: 12, cursor: 'pointer', textTransform: 'capitalize' }}>{t}</button>)}
      </div>
      {tab === 'field'    && <FeView policy={defPolicy} />}
      {tab === 'tracking' && <WtView policy={defPolicy} />}
    </div>
  )
}
export default FieldOperationsView
