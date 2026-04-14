/**
 * JARVIS EPC — JnView  ·  Job Notes
 */
import React, { useState } from 'react'
import { useBizStore } from '../modules/biz/store'
import type { PolicyConfig } from '../modules/biz/dispatch'

export interface JnViewProps { policy?: Partial<PolicyConfig>; jobId?: string }

export function JnView({ policy: _p, jobId }: JnViewProps) {
  const docs = useBizStore(s => s.biz.documents ?? [])
  const notes = docs.filter(d => d['type'] === 'job-note' || d['category'] === 'note' || (jobId && d['project'] === jobId))
  const [search, setSearch] = useState('')
  const filtered = notes.filter(n => !search || String(n['title'] ?? n['description'] ?? '').toLowerCase().includes(search.toLowerCase()))

  return (
    <div role="main" aria-label="Job Notes">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h3 className="jarvis-heading" style={{ margin: 0 }}>Job Notes {jobId && <span className="jarvis-muted" style={{ fontSize: 12 }}>— {jobId}</span>}</h3>
        <span className="jarvis-small" style={{ color: 'var(--jarvis-ts)' }}>{filtered.length} notes</span>
      </div>
      <div style={{ marginBottom: 10 }}>
        <input className="jarvis-input" type="search" placeholder="Search notes…" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search job notes" />
      </div>
      {filtered.length === 0 ? (
        <div className="jarvis-empty"><span className="jarvis-empty-icon">📝</span><span>{search ? 'No notes match' : 'No job notes recorded'}</span></div>
      ) : (
        <div className="jarvis-scroll-y jarvis-max-h-lg">
          {filtered.map((n, idx) => (
            <div key={String(n['id'] ?? idx)} className="jarvis-card" style={{ padding: '12px 16px', marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span className="jarvis-body" style={{ fontWeight: 600 }}>{String(n['title'] ?? n['description'] ?? n['id'])}</span>
                <span className="jarvis-muted" style={{ fontSize: 10 }}>{String(n['date'] ?? '—')}</span>
              </div>
              <p className="jarvis-body" style={{ margin: 0, color: 'var(--jarvis-ts)' }}>{String(n['description'] ?? n['notes'] ?? '—')}</p>
              {!!n['author'] && <span className="jarvis-muted" style={{ fontSize: 10 }}>— {String(n['author'])}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
export default JnView
