/**
 * JARVIS EPC — HnView  ·  Hub Notifications
 */
import React, { useState } from 'react'
import { useBizStore, selectNotifications } from '../modules/biz/store'
import { createDispatch, type PolicyConfig } from '../modules/biz/dispatch'
import { JARVIS_ACTIONS } from '../modules/biz/reducer'
import { StatusBadge } from './StatusBadge'
import { KpiCard }     from './KpiCard'

export interface HnViewProps { policy?: Partial<PolicyConfig>; biz?: Record<string,unknown>; onToast?: (m: string, t: string) => void }
const DEF: PolicyConfig = { writesEnabled: false, chatEnabled: false, exportsEnabled: false, activeRole: 'viewer' }

export function HnView({ policy: pProp, biz: _b, onToast }: HnViewProps) {
  const policy = { ...DEF, ...pProp }
  const notifs  = useBizStore(selectNotifications)
  const [filter, setFilter] = useState<'all'|'unread'>('all')
  const { dispatch } = React.useMemo(() => createDispatch({ policy, toast: onToast ? (m,t) => onToast(m,t) : undefined }), [policy])

  const unread    = notifs.filter(n => !n['read'])
  const displayed = filter === 'unread' ? unread : notifs

  const domainIcon: Record<string,string> = { crm: '🎯', safety: '🦺', finance: '💰', procurement: '🛒', engineering: '⚙️', default: '🔔' }

  function markAll() { dispatch({ type: JARVIS_ACTIONS.MARK_ALL_READ, data: {} }); onToast?.('All marked read', 'success') }

  return (
    <div role="main" aria-label="Hub Notifications">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 8, marginBottom: 16 }}>
        <KpiCard label="Total"  value={notifs.length} />
        <KpiCard label="Unread" value={unread.length} color={unread.length > 0 ? 'var(--jarvis-blue)' : 'var(--jarvis-grn)'} />
        <KpiCard label="Read"   value={notifs.filter(n => n['read']).length} color="var(--jarvis-td)" />
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'center' }}>
        {(['all','unread'] as const).map(f => <button key={f} onClick={() => setFilter(f)} className={`jarvis-btn ${filter === f ? 'jarvis-btn-primary' : 'jarvis-btn-ghost'}`} style={{ fontSize: 11, padding: '4px 10px', textTransform: 'capitalize' }}>{f}</button>)}
        {unread.length > 0 && <button className="jarvis-btn jarvis-btn-ghost" style={{ fontSize: 11, marginLeft: 'auto' }} onClick={markAll}>Mark all read</button>}
      </div>
      {displayed.length === 0 ? (
        <div className="jarvis-empty"><span className="jarvis-empty-icon">🔔</span><span>{filter === 'unread' ? 'No unread notifications' : 'No notifications'}</span></div>
      ) : (
        <div className="jarvis-scroll-y jarvis-max-h-lg">
          {displayed.map((n, i) => (
            <div key={String(n['id'] ?? i)} className="jarvis-card" style={{ padding: '12px 16px', marginBottom: 8, opacity: n['read'] ? 0.6 : 1, borderLeft: n['read'] ? 'none' : '3px solid var(--jarvis-blue)' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <span style={{ fontSize: 18 }}>{domainIcon[String(n['domain'] ?? '')] ?? domainIcon.default}</span>
                <div className="jarvis-flex-1">
                  <span className="jarvis-body" style={{ fontWeight: n['read'] ? 400 : 700 }}>{String(n['message'] ?? n['title'] ?? 'Notification')}</span>
                  <span className="jarvis-muted" style={{ fontSize: 10, display: 'block' }}>{String(n['domain'] ?? '').toUpperCase() || 'SYSTEM'} · {String(n['date'] ?? n['ts'] ?? '—')}</span>
                </div>
                {!n['read'] && <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--jarvis-blue)', flexShrink: 0, marginTop: 4 }} />}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
export default HnView
