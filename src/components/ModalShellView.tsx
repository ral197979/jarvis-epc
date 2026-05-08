/**
 * Denver Engineering — ModalShellView  ·  Modal Shell (generic detail/form host)
 */
import React from 'react'
import type { PolicyConfig } from '../modules/biz/dispatch'
export interface ModalShellViewProps { policy?: Partial<PolicyConfig>; biz?: Record<string,unknown>; title?: string; children?: React.ReactNode; onClose?: () => void; open?: boolean; width?: number }
export function ModalShellView({ policy: _p, title, children, onClose, open, width }: ModalShellViewProps) {
  if (open === false) return null
  return (
    <div role="dialog" aria-modal="true" aria-label={title ?? 'Modal'} style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 1000, background: 'var(--jarvis-bg)', border: '1px solid var(--jarvis-bd)', borderRadius: 10, padding: 24, maxWidth: width ?? 800, width: '100%', boxShadow: '0 8px 32px rgba(0,0,0,0.32)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h3 className="jarvis-heading" style={{ margin: 0 }}>{title ?? 'Detail View'}</h3>
        {onClose && <button className="jarvis-btn jarvis-btn-ghost jarvis-btn-sm" onClick={onClose} aria-label="Close">✕</button>}
      </div>
      {children ?? <p className="jarvis-muted" style={{ fontStyle: 'italic' }}>No content provided</p>}
    </div>
  )
}
export default ModalShellView
