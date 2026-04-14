/**
 * JARVIS EPC — LnView  ·  Lead Notifications
 */
import React, { useState } from 'react'
import { useBizStore, selectLeads, selectNotifications } from '../modules/biz/store'
import { StatusBadge } from './StatusBadge'
import { createDispatch, type PolicyConfig } from '../modules/biz/dispatch'
import { JARVIS_ACTIONS } from '../modules/biz/reducer'

export interface LnViewProps { policy?: Partial<PolicyConfig>; onToast?: (msg: string, type: string) => void }
const DEF: PolicyConfig = { writesEnabled: false, chatEnabled: false, exportsEnabled: false, activeRole: 'viewer' }

export function LnView({ policy: pProp, onToast }: LnViewProps) {
  const policy = { ...DEF, ...pProp }
  const leads  = useBizStore(selectLeads)
  const notifs = useBizStore(selectNotifications).filter(n => n['domain'] === 'crm' || n['category'] === 'lead')
  const [filter, setFilter] = useState<'all'|'unread'>('all')
  const { dispatch } = React.useMemo(() => createDispatch({ policy, toast: onToast ? (m,t) => onToast(m,t) : undefined }), [policy, onToast])

  const displayed = filter === 'unread' ? notifs.filter(n => !n['read']) : notifs
  const unreadCount = notifs.filter(n => !n['read']).length

  function markAll() {
    dispatch({ type: JARVIS_ACTIONS.MARK_ALL_READ, data: {} })
    onToast?.('All marked as read', 'success')
  }

  const recentLeads = leads.slice(0, 5)

  return (
    <div role="main" aria-label="Lead Notifications">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 className="jarvis-heading" style={{ margin: 0 }}>CRM Lead Notifications {unreadCount > 0 && <span style={{ background: 'var(--jarvis-red)', color: '#fff', borderRadius: 99, padding: '2px 8px', fontSize: 11, marginLeft: 8 }}>{unreadCount}</span>}</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['all','unread'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} className={`jarvis-btn ${filter === f ? 'jarvis-btn-primary' : 'jarvis-btn-ghost'}`} style={{ fontSize: 11, padding: '4px 10px', textTransform: 'capitalize' }}>{f}</button>
          ))}
          {unreadCount > 0 && <button className="jarvis-btn jarvis-btn-ghost" style={{ fontSize: 11 }} onClick={markAll}>Mark all read</button>}
        </div>
      </div>

      {displayed.length === 0 && notifs.length === 0 ? (
        <div>
          <div className="jarvis-empty" style={{ marginBottom: 24 }}><span className="jarvis-empty-icon">🔔</span><span>No lead notifications yet</span></div>
          {recentLeads.length > 0 && (
            <div className="jarvis-card" style={{ padding: 16 }}>
              <h4 className="jarvis-label" style={{ marginBottom: 10 }}>Recent Leads</h4>
              {recentLeads.map(l => (
                <div key={String(l.id)} className="jarvis-row">
                  <div className="jarvis-flex-1"><span className="jarvis-body" style={{ fontWeight: 600 }}>{String(l['name'] ?? l.id)}</span><span className="jarvis-small" style={{ display: 'block' }}>{String(l['company'] ?? '—')}</span></div>
                  <StatusBadge status={String(l['status'] ?? 'prospect')} />
                </div>
              ))}
            </div>
          )}
        </div>
      ) : displayed.length === 0 ? (
        <div className="jarvis-empty"><span className="jarvis-empty-icon">✅</span><span>No unread notifications</span></div>
      ) : (
        <div className="jarvis-scroll-y jarvis-max-h-lg">
          {displayed.map(n => (
            <div key={String(n.id)} className="jarvis-card" style={{ padding: '12px 16px', marginBottom: 8, opacity: n['read'] ? 0.6 : 1, borderLeft: n['read'] ? 'none' : '3px solid var(--jarvis-blue)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <span className="jarvis-body" style={{ fontWeight: n['read'] ? 400 : 700 }}>{String(n['message'] ?? n['title'] ?? 'Notification')}</span>
                {!n['read'] && <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--jarvis-blue)', flexShrink: 0, marginTop: 4 }} />}
              </div>
              <span className="jarvis-muted" style={{ fontSize: 10 }}>{String(n['date'] ?? n['ts'] ?? '—')}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
export default LnView
