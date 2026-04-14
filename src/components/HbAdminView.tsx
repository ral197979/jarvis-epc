/**
 * JARVIS EPC — HbAdminView  ·  Hub Admin / Settings
 */
import React, { useState } from 'react'
import { useBizStore } from '../modules/biz/store'
import type { PolicyConfig } from '../modules/biz/dispatch'

export interface HbAdminViewProps { policy?: Partial<PolicyConfig>; onToast?: (m: string, t: string) => void }

export function HbAdminView({ policy: _p, onToast }: HbAdminViewProps) {
  const company   = useBizStore(s => s.biz.company)
  const totalBiz  = useBizStore(s => {
    const biz = s.biz
    return Object.entries(biz).filter(([, v]) => Array.isArray(v)).map(([k, v]) => ({ collection: k, count: (v as unknown[]).length })).filter(x => x.count > 0)
  })
  const [tab, setTab] = useState<'overview'|'data'>('overview')

  return (
    <div role="main" aria-label="Hub Admin">
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid var(--jarvis-bd)' }}>
        {(['overview','data'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: '8px 16px 10px', background: 'transparent', border: 'none', borderBottom: tab === t ? '2px solid var(--jarvis-ac)' : '2px solid transparent', color: tab === t ? 'var(--jarvis-tx)' : 'var(--jarvis-ts)', fontWeight: tab === t ? 700 : 500, fontSize: 12, cursor: 'pointer', textTransform: 'capitalize' }}>{t}</button>
        ))}
      </div>

      {tab === 'overview' && (
        <div>
          <div className="jarvis-card" style={{ padding: 16, marginBottom: 16 }}>
            <h4 className="jarvis-label" style={{ marginBottom: 12 }}>Company Profile</h4>
            {Object.entries(company).length === 0 ? (
              <p className="jarvis-muted" style={{ fontStyle: 'italic' }}>No company profile configured — dispatch company/set to set company data</p>
            ) : (
              Object.entries(company).slice(0, 8).map(([k, v]) => (
                <div key={k} className="jarvis-row">
                  <span className="jarvis-small" style={{ textTransform: 'capitalize' }}>{k.replace(/_/g,' ')}</span>
                  <span className="jarvis-body" style={{ fontWeight: 600 }}>{String(v)}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {tab === 'data' && (
        <div className="jarvis-card" style={{ padding: 16 }}>
          <h4 className="jarvis-label" style={{ marginBottom: 12 }}>Data Inventory</h4>
          {totalBiz.length === 0 ? (
            <p className="jarvis-muted" style={{ fontStyle: 'italic' }}>No data loaded</p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
              {totalBiz.map(({ collection, count }) => (
                <div key={collection} className="jarvis-card" style={{ padding: '10px 12px', background: 'var(--jarvis-bl)' }}>
                  <div className="jarvis-muted" style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 2 }}>{collection.replace(/_/g,' ')}</div>
                  <div style={{ fontFamily: 'var(--jarvis-font-mono)', fontWeight: 700, fontSize: 18 }}>{count}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
export default HbAdminView
