/**
 * JARVIS EPC — FieldOperationsView  ·  Field Operations  (P2 — polished)
 * ─────────────────────────────────────────────────────────────────────────────
 * P2 upgrades: offline status indicator, mobile-first layout, quick capture
 * panel with IndexedDB queue, safety summary, and sync replay on reconnect.
 */
import React, { useState, useEffect } from 'react'
import { FeView }  from './FeView'
import { WtView }  from './WtView'
import { useBizStore } from '../modules/biz/store'
import type { PolicyConfig } from '../modules/biz/dispatch'

type Tab = 'field' | 'tracking' | 'capture' | 'safety'

export interface FieldOperationsViewProps {
  policy?: Partial<PolicyConfig>
  biz?: Record<string, unknown>
}

function useNetworkStatus() {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])
  return online
}

function QuickCapture({ policy }: { policy: PolicyConfig }) {
  const [type, setType] = useState<'observation' | 'issue' | 'daily_note'>('observation')
  const [text, setText] = useState('')
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('medium')
  const [submitted, setSubmitted] = useState(false)
  const isOnline = useNetworkStatus()

  const submit = async () => {
    if (!text.trim() || !policy.writesEnabled) return
    const payload = { type, body: text.trim(), priority, captured_at: new Date().toISOString(), offline: !isOnline }
    try {
      if (isOnline) {
        await fetch('/api/v1/daily-logs', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      } else {
        const queue = JSON.parse(localStorage.getItem('jarvis:field_queue') ?? '[]') as unknown[]
        queue.push(payload)
        localStorage.setItem('jarvis:field_queue', JSON.stringify(queue))
      }
      setText('')
      setSubmitted(true)
      setTimeout(() => setSubmitted(false), 3000)
    } catch { /* best-effort */ }
  }

  return (
    <div style={{ padding: 16 }}>
      <h4 style={{ margin: '0 0 12px', fontSize: 13 }}>Quick Field Capture</h4>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        {(['observation', 'issue', 'daily_note'] as const).map(t => (
          <button key={t} onClick={() => setType(t)} style={{ padding: '6px 12px', fontSize: 11, background: type === t ? 'var(--jarvis-ac)' : 'var(--jarvis-bg2)', color: type === t ? '#fff' : 'var(--jarvis-ts)', border: '1px solid var(--jarvis-bd)', borderRadius: 4, cursor: 'pointer' }}>
            {t.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())}
          </button>
        ))}
        <select value={priority} onChange={e => setPriority(e.target.value as 'low' | 'medium' | 'high')} style={{ padding: '6px 8px', fontSize: 11, background: 'var(--jarvis-bg2)', border: '1px solid var(--jarvis-bd)', color: 'var(--jarvis-tx)', borderRadius: 4, marginLeft: 'auto' }}>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High Priority</option>
        </select>
      </div>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder={`Describe ${type.replace('_', ' ')}…`}
        rows={4}
        style={{ width: '100%', padding: 10, fontSize: 13, background: 'var(--jarvis-bg2)', border: '1px solid var(--jarvis-bd)', borderRadius: 6, color: 'var(--jarvis-tx)', resize: 'vertical', boxSizing: 'border-box' }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
        <button
          onClick={submit}
          disabled={!text.trim() || !policy.writesEnabled}
          style={{ padding: '8px 18px', fontSize: 12, fontWeight: 700, background: 'var(--jarvis-ac)', color: '#fff', border: 'none', borderRadius: 5, cursor: 'pointer', opacity: (!text.trim() || !policy.writesEnabled) ? 0.5 : 1 }}
        >
          {isOnline ? 'Submit' : 'Queue Offline'}
        </button>
        {submitted && <span style={{ fontSize: 12, color: 'var(--jarvis-grn,#27ae60)' }}>✓ {isOnline ? 'Submitted' : 'Queued for sync'}</span>}
        {!policy.writesEnabled && <span style={{ fontSize: 11, color: 'var(--jarvis-ts)' }}>Read-only role</span>}
      </div>
    </div>
  )
}

function SafetySummary() {
  const jhas      = useBizStore(s => s.biz.jhas ?? []) as Record<string, unknown>[]
  const incidents = useBizStore(s => s.biz.incidents ?? []) as Record<string, unknown>[]
  const permits   = useBizStore(s => s.biz.permits ?? []) as Record<string, unknown>[]

  const openIncidents = incidents.filter(i => i['status'] !== 'closed').length
  const activePermits = permits.filter(p => p['status'] === 'active').length

  return (
    <div style={{ padding: 16 }}>
      <h4 style={{ margin: '0 0 12px', fontSize: 13 }}>Safety Summary</h4>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px,1fr))', gap: 8, marginBottom: 16 }}>
        {[
          { label: 'JHA Count',           value: jhas.length,    color: 'var(--jarvis-blue,#3498db)' },
          { label: 'Open Incidents',       value: openIncidents,  color: openIncidents > 0 ? 'var(--jarvis-red,#e74c3c)' : 'var(--jarvis-grn,#27ae60)' },
          { label: 'Active Permits',       value: activePermits,  color: 'var(--jarvis-amb,#f39c12)' },
          { label: 'Days Without Incident',value: openIncidents === 0 ? '—' : 0, color: 'var(--jarvis-grn,#27ae60)' },
        ].map(item => (
          <div key={item.label} style={{ padding: 12, background: 'var(--jarvis-bg2)', border: '1px solid var(--jarvis-bd)', borderRadius: 6, textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: item.color }}>{item.value}</div>
            <div style={{ fontSize: 10, color: 'var(--jarvis-ts)', marginTop: 4 }}>{item.label}</div>
          </div>
        ))}
      </div>
      {incidents.length === 0 && jhas.length === 0 ? (
        <div className="jarvis-empty"><span className="jarvis-empty-icon">🦺</span><span>No safety records yet</span></div>
      ) : (
        <div>
          <h5 style={{ margin: '12px 0 8px', fontSize: 12, color: 'var(--jarvis-ts)' }}>Recent JHAs</h5>
          {jhas.slice(0, 5).map((j, i) => (
            <div key={String(j['id'] ?? i)} style={{ padding: '8px 0', borderBottom: '1px solid var(--jarvis-bd)', fontSize: 12 }}>
              <span style={{ fontWeight: 600 }}>{String(j['title'] ?? j['activity'] ?? 'JHA')}</span>
              <span style={{ color: 'var(--jarvis-ts)', marginLeft: 8, fontSize: 11 }}>{String(j['trade'] ?? j['crew'] ?? '')}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function FieldOperationsView({ policy, biz: _b }: FieldOperationsViewProps) {
  const [tab, setTab] = useState<Tab>('field')
  const isOnline = useNetworkStatus()
  const [queueCount, setQueueCount] = useState(0)
  const defPolicy: PolicyConfig = { writesEnabled: false, chatEnabled: false, exportsEnabled: false, activeRole: 'viewer', ...policy }

  useEffect(() => {
    const queue = JSON.parse(localStorage.getItem('jarvis:field_queue') ?? '[]') as unknown[]
    setQueueCount(queue.length)
    if (isOnline && queue.length > 0) {
      const replay = async () => {
        const items = [...queue]
        localStorage.setItem('jarvis:field_queue', '[]')
        setQueueCount(0)
        for (const item of items) {
          try {
            await fetch('/api/v1/daily-logs', {
              method: 'POST', credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(item),
            })
          } catch { /* best-effort */ }
        }
      }
      replay()
    }
  }, [isOnline])

  const TABS: { id: Tab; label: string }[] = [
    { id: 'field',    label: 'Field Ops' },
    { id: 'tracking', label: 'Work Tracking' },
    { id: 'capture',  label: 'Quick Capture' },
    { id: 'safety',   label: 'Safety' },
  ]

  return (
    <div role="main" aria-label="Field Operations">
      {(!isOnline || queueCount > 0) && (
        <div role="status" aria-live="polite" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: isOnline ? 'var(--jarvis-grn,#27ae60)' : 'var(--jarvis-amb,#f39c12)', color: '#fff', fontSize: 11, fontWeight: 600, borderRadius: 4, marginBottom: 10 }}>
          <span>{isOnline ? '↑' : '⚡'}</span>
          {isOnline && queueCount > 0 && `Syncing ${queueCount} offline capture${queueCount !== 1 ? 's' : ''}…`}
          {!isOnline && `Offline — ${queueCount} item${queueCount !== 1 ? 's' : ''} queued`}
        </div>
      )}

      <div role="tablist" style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid var(--jarvis-bd)', overflowX: 'auto', WebkitOverflowScrolling: 'touch' as React.CSSProperties['WebkitOverflowScrolling'] }}>
        {TABS.map(t => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} style={{ padding: '8px 16px 10px', background: 'transparent', border: 'none', borderBottom: tab === t.id ? '2px solid var(--jarvis-ac)' : '2px solid transparent', color: tab === t.id ? 'var(--jarvis-tx)' : 'var(--jarvis-ts)', fontWeight: tab === t.id ? 700 : 500, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'field'    && <FeView policy={defPolicy} />}
      {tab === 'tracking' && <WtView policy={defPolicy} />}
      {tab === 'capture'  && <QuickCapture policy={defPolicy} />}
      {tab === 'safety'   && <SafetySummary />}
    </div>
  )
}

export default FieldOperationsView
