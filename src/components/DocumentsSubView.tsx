/**
 * Denver Engineering — DocumentsSubView  ·  Document Sub-Panel (compact recent docs list)
 */
import React from 'react'
import { useBizStore, selectDocuments } from '../modules/biz/store'
import { StatusBadge } from './StatusBadge'
import type { PolicyConfig } from '../modules/biz/dispatch'

export interface DocumentsSubViewProps { policy?: Partial<PolicyConfig>; project?: string; maxItems?: number }

export function DocumentsSubView({ policy: _p, project, maxItems = 6 }: DocumentsSubViewProps) {
  const docs = useBizStore(selectDocuments)
  const filtered = (project ? docs.filter(d => d['project'] === project || String(d['proj'] ?? '') === project) : docs).slice(0, maxItems)

  return (
    <div aria-label="Documents Sub-Panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span className="jarvis-label">Recent Documents</span>
        <span className="jarvis-badge jarvis-badge-blue">{filtered.length}</span>
      </div>
      {filtered.length === 0 ? (
        <p className="jarvis-muted" style={{ fontStyle: 'italic', fontSize: 12 }}>No documents</p>
      ) : (
        filtered.map((d, i) => (
          <div key={String(d['id'] ?? i)} className="jarvis-row" style={{ padding: '6px 0' }}>
            <div className="jarvis-flex-1">
              <div className="jarvis-body" style={{ fontWeight: 600, fontSize: 12 }}>{String(d['title'] ?? d['id'])}</div>
              <div className="jarvis-muted" style={{ fontSize: 10 }}>{String(d['disc'] ?? d['discipline'] ?? '—')} · Rev {String(d['rev'] ?? d['revision'] ?? '0')}</div>
            </div>
            <StatusBadge status={String(d['cde'] ?? d['status'] ?? 'draft')} />
          </div>
        ))
      )}
    </div>
  )
}
export default DocumentsSubView
