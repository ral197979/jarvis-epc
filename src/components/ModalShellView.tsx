/**
 * JARVIS EPC — ModalShellView  ·  Modal Shell (generic detail/form host)
 */
import React from 'react'
import type { PolicyConfig } from '../modules/biz/dispatch'
export interface ModalShellViewProps { policy?: Partial<PolicyConfig>; biz?: Record<string,unknown>; title?: string; children?: React.ReactNode; onClose?: () => void }
export function ModalShellView({ policy: _p, title, children, onClose }: ModalShellViewProps) {
  return (
    <div role="dialog" aria-modal="true" aria-label={title ?? 'Modal'} style={{ background: 'var(--jarvis-bg)', borderRadius: 10, padding: 24, maxWidth: 800, width: '100%', boxShadow: '0 8px 32px rgba(0,0,0,0.32)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h3 className="jarvis-heading" style={{ margin: 0 }}>{title ?? 'Detail View'}</h3>
        {onClose && <button className="jarvis-btn jarvis-btn-ghost jarvis-btn-sm" onClick={onClose} aria-label="Close">✕</button>}
      </div>
      {children ?? <p className="jarvis-muted" style={{ fontStyle: 'italic' }}>No content provided</p>}
    </div>
  )
}
export default ModalShellView
