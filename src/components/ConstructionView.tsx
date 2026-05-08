/**
 * Denver Engineering — ConstructionView  ·  Construction Overview (tabs: Work | Jobs | Equipment | Tracking)
 */
import React, { useState } from 'react'
import { WView }  from './WView'
import { JobsView }  from './JobsView'
import { EtView }    from './EtView'
import { CtView }    from './CtView'
import type { PolicyConfig } from '../modules/biz/dispatch'

type Tab = 'overview' | 'jobs' | 'equipment' | 'tracking'
export interface ConstructionViewProps { policy?: Partial<PolicyConfig>; biz?: Record<string,unknown>; onNavigate?: (t: string) => void; onToast?: (m: string, t: string) => void }

export function ConstructionView({ policy, biz: _b, onNavigate, onToast }: ConstructionViewProps) {
  const [tab, setTab] = useState<Tab>('overview')
  const TABS: {id: Tab; label: string; icon: string}[] = [
    { id: 'overview',  label: 'Overview',  icon: '🏗️' },
    { id: 'jobs',      label: 'Jobs',      icon: '📋' },
    { id: 'equipment', label: 'Equipment', icon: '🔧' },
    { id: 'tracking',  label: 'Tracking',  icon: '📊' },
  ]
  const defPolicy: PolicyConfig = { writesEnabled: false, chatEnabled: false, exportsEnabled: false, activeRole: 'viewer', ...policy }
  return (
    <div role="main" aria-label="Construction">
      <div role="tablist" style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid var(--jarvis-bd)' }}>
        {TABS.map(t => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} style={{ padding: '8px 14px 10px', background: 'transparent', border: 'none', borderBottom: tab === t.id ? '2px solid var(--jarvis-ac)' : '2px solid transparent', color: tab === t.id ? 'var(--jarvis-tx)' : 'var(--jarvis-ts)', fontWeight: tab === t.id ? 700 : 500, fontSize: 12, cursor: 'pointer' }}>{t.icon} {t.label}</button>
        ))}
      </div>
      {tab === 'overview'  && <WView policy={defPolicy} onNavigate={onNavigate} />}
      {tab === 'jobs'      && <JobsView policy={defPolicy} onToast={onToast} />}
      {tab === 'equipment' && <EtView policy={defPolicy} />}
      {tab === 'tracking'  && <CtView policy={defPolicy} />}
    </div>
  )
}
export default ConstructionView
