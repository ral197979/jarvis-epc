/**
 * JARVIS EPC — JnSubView  ·  Job Notes Detail (sub-panel)
 */
import React from 'react'
import { useBizStore } from '../modules/biz/store'
import type { PolicyConfig } from '../modules/biz/dispatch'

export interface JnSubViewProps { policy?: Partial<PolicyConfig>; jobId?: string; maxItems?: number }

export function JnSubView({ policy: _p, jobId, maxItems = 5 }: JnSubViewProps) {
  const docs  = useBizStore(s => s.biz.documents ?? [])
  const notes = docs.filter(d => !jobId || d['project'] === jobId).slice(0, maxItems)

  return (
    <div aria-label="Job Notes Panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span className="jarvis-label">Recent Notes</span>
        <span className="jarvis-small" style={{ color: 'var(--jarvis-ts)' }}>{notes.length} shown</span>
      </div>
      {notes.length === 0 ? (
        <p className="jarvis-muted" style={{ fontStyle: 'italic', fontSize: 12 }}>No notes for this job</p>
      ) : (
        notes.map((n, idx) => (
          <div key={String(n['id'] ?? idx)} style={{ borderBottom: '1px solid var(--jarvis-bd)', padding: '8px 0' }}>
            <div className="jarvis-body" style={{ fontWeight: 600, fontSize: 12 }}>{String(n['title'] ?? n['description'] ?? n['id'])}</div>
            <div className="jarvis-muted" style={{ fontSize: 10 }}>{String(n['date'] ?? '—')} {n['author'] ? `· ${n['author']}` : ''}</div>
          </div>
        ))
      )}
    </div>
  )
}
export default JnSubView
