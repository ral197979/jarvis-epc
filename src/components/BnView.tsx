/**
 * JARVIS EPC — BnView  ·  Build Notes
 */
import React, { useState } from 'react'
import { useBizStore } from '../modules/biz/store'
import type { PolicyConfig } from '../modules/biz/dispatch'

export interface BnViewProps { policy?: Partial<PolicyConfig>; projectId?: string }

export function BnView({ policy: _p, projectId }: BnViewProps) {
  const docs = useBizStore(s => s.biz.documents ?? [])
  const notes = docs.filter(d => !projectId || d['project'] === projectId)
  const [search, setSearch] = useState('')
  const filtered = notes.filter(n => !search || String(n['title'] ?? n['description'] ?? '').toLowerCase().includes(search.toLowerCase()))

  return (
    <div role="main" aria-label="Build Notes">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h3 className="jarvis-heading" style={{ margin: 0 }}>Build Notes</h3>
        <span className="jarvis-small" style={{ color: 'var(--jarvis-ts)' }}>{filtered.length} records</span>
      </div>
      <div style={{ marginBottom: 10 }}>
        <input className="jarvis-input" type="search" placeholder="Search build notes…" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search Build Notes" />
      </div>
      {filtered.length === 0 ? (
        <div className="jarvis-empty"><span className="jarvis-empty-icon">🏗️</span><span>{search ? 'No notes match' : 'No build notes recorded'}</span></div>
      ) : (
        <div className="jarvis-scroll-y jarvis-max-h-lg">
          {filtered.map((n, idx) => (
            <div key={String(n['id'] ?? idx)} className="jarvis-card" style={{ padding: '12px 16px', marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span className="jarvis-body" style={{ fontWeight: 600 }}>{String(n['title'] ?? n['description'] ?? n['id'])}</span>
                <span className="jarvis-muted" style={{ fontSize: 10 }}>{String(n['date'] ?? '—')}</span>
              </div>
              <p className="jarvis-body" style={{ margin: 0, color: 'var(--jarvis-ts)' }}>{String(n['description'] ?? n['notes'] ?? '—')}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
export default BnView
