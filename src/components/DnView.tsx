/**
 * JARVIS EPC — DnView  ·  Design Notes
 */
import React, { useState } from 'react'
import { useBizStore } from '../modules/biz/store'
import { createDispatch, type PolicyConfig } from '../modules/biz/dispatch'

export interface DnViewProps { policy?: Partial<PolicyConfig>; onToast?: (msg: string, type: string) => void }
const DEF: PolicyConfig = { writesEnabled: false, chatEnabled: false, exportsEnabled: false, activeRole: 'viewer' }

export function DnView({ policy: pProp, onToast }: DnViewProps) {
  const policy = { ...DEF, ...pProp }
  const items  = useBizStore(s => (s.biz as Record<string,unknown>)['engineering_deliverables'] as Record<string,unknown>[] ?? [])
  const [search, setSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [text, setText] = useState('')
  const canWrite = policy.writesEnabled && policy.activeRole !== 'viewer'

  const filtered = items.filter(i => !search || String(i['notes'] ?? i['description'] ?? '').toLowerCase().includes(search.toLowerCase()))

  return (
    <div role="main" aria-label="Design Notes">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 className="jarvis-heading" style={{ margin: 0 }}>Design Notes</h3>
        {canWrite && <button className="jarvis-btn jarvis-btn-primary" onClick={() => setShowAdd(v => !v)}>+ Add Note</button>}
      </div>
      {showAdd && (
        <div className="jarvis-card" style={{ padding: 16, marginBottom: 16 }}>
          <h4 className="jarvis-label" style={{ marginBottom: 8 }}>New Note</h4>
          <textarea className="jarvis-input" rows={4} placeholder="Enter note…" value={text} onChange={e => setText(e.target.value)} style={{ width: '100%', resize: 'vertical', marginBottom: 8 }} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="jarvis-btn jarvis-btn-primary" onClick={() => { if (!text.trim()) return; onToast?.('Note saved', 'success'); setText(''); setShowAdd(false) }}>Save</button>
            <button className="jarvis-btn jarvis-btn-ghost" onClick={() => setShowAdd(false)}>Cancel</button>
          </div>
        </div>
      )}
      <div style={{ marginBottom: 10 }}>
        <input className="jarvis-input" type="search" placeholder="Search notes…" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search notes" />
      </div>
      {filtered.length === 0 ? (
        <div className="jarvis-empty"><span className="jarvis-empty-icon">✏️</span><span>{search ? 'No notes match' : 'No design notes recorded yet'}</span></div>
      ) : (
        <div className="jarvis-scroll-y jarvis-max-h-lg">
          {filtered.map((item, idx) => (
            <div key={String(item['id'] ?? idx)} className="jarvis-card" style={{ padding: '12px 16px', marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                <span className="jarvis-body" style={{ fontWeight: 600 }}>{String(item['title'] ?? item['subject'] ?? item['id'])}</span>
                <span className="jarvis-muted" style={{ fontSize: 10, flexShrink: 0 }}>{String(item['date'] ?? '—')}</span>
              </div>
              <p className="jarvis-body" style={{ margin: 0, color: 'var(--jarvis-ts)' }}>{String(item['notes'] ?? item['description'] ?? item['notes'] ?? '—')}</p>
              {!!item['author'] && <span className="jarvis-muted" style={{ fontSize: 10, display: 'block', marginTop: 4 }}>— {String(item['author'])}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
export default DnView
