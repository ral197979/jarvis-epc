/**
 * JARVIS EPC — DetailPanelView  ·  Detail Panel (generic record viewer)
 */
import React from 'react'
import { useBizStore } from '../modules/biz/store'
import { StatusBadge } from './StatusBadge'
import type { PolicyConfig } from '../modules/biz/dispatch'

export interface DetailPanelViewProps { policy?: Partial<PolicyConfig>; biz?: Record<string,unknown>; collection?: string; recordId?: string }

export function DetailPanelView({ policy: _p, collection, recordId }: DetailPanelViewProps) {
  const biz = useBizStore(s => s.biz)
  const items = collection ? (biz as Record<string,unknown>)[collection] as Record<string,unknown>[] ?? [] : []
  const record = recordId ? items.find(i => i['id'] === recordId) : null

  if (!collection) {
    return <div className="jarvis-empty"><span className="jarvis-empty-icon">🔍</span><span>Select a collection to browse records</span></div>
  }
  if (!record && recordId) {
    return <div className="jarvis-empty"><span className="jarvis-empty-icon">❓</span><span>Record {recordId} not found in {collection}</span></div>
  }
  if (!record) {
    return (
      <div role="main" aria-label="Detail Panel">
        <h3 className="jarvis-heading" style={{ marginBottom: 12 }}>{collection}</h3>
        <div className="jarvis-scroll-y jarvis-max-h-lg">
          {items.slice(0, 20).map((item, i) => (
            <div key={String(item['id'] ?? i)} className="jarvis-row">
              <span className="jarvis-body" style={{ fontWeight: 600, flex: 1 }}>{String(item['id'] ?? item['title'] ?? item['name'] ?? i)}</span>
              {!!item["status"] && <StatusBadge status={String(item['status'])} />}
            </div>
          ))}
        </div>
      </div>
    )
  }
  return (
    <div role="main" aria-label="Record Detail">
      <h3 className="jarvis-heading" style={{ marginBottom: 16 }}>{String(record['title'] ?? record['name'] ?? record['id'])}</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
        {Object.entries(record).filter(([k]) => !k.startsWith('_')).map(([k, v]) => (
          <div key={k} className="jarvis-card" style={{ padding: '8px 10px', background: 'var(--jarvis-bl)' }}>
            <div className="jarvis-muted" style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 2 }}>{k.replace(/_/g,' ')}</div>
            <div className="jarvis-body" style={{ fontWeight: 600, fontSize: 12 }}>{String(v as string ?? '—')}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
export default DetailPanelView
