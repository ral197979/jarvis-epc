/**
 * Denver Engineering — RlView  ·  Risk Log (change events and risk history)
 */
import React, { useState } from 'react'
import { useBizStore } from '../modules/biz/store'
import { StatusBadge } from './StatusBadge'
import { KpiCard }     from './KpiCard'
import type { PolicyConfig } from '../modules/biz/dispatch'

export interface RlViewProps { policy?: Partial<PolicyConfig> }

export function RlView({ policy: _p }: RlViewProps) {
  const incidents    = useBizStore(s => s.biz.incidents       ?? []) as Record<string,unknown>[]
  const changeEvents = useBizStore(s => s.biz.ci_change_events ?? []) as Record<string,unknown>[]
  const lessons      = useBizStore(s => s.biz.lessons          ?? []) as Record<string,unknown>[]
  const [search, setSearch] = useState('')

  type LogEntry = { id: string; type: string; description: string; date: string; status: string; impact?: string }
  const log: LogEntry[] = [
    ...incidents.map(i => ({ id: String(i['id']), type: 'incident', description: String(i['title'] ?? i['description'] ?? i['id']), date: String(i['date'] ?? '—'), status: String(i['status'] ?? 'open'), impact: String(i['severity'] ?? '—') })),
    ...changeEvents.map(c => ({ id: String(c['id']), type: 'change', description: String(c['description'] ?? c['id']), date: String(c['ts'] ?? c['date'] ?? '—'), status: String(c['status'] ?? 'open'), impact: String(c['impact'] ?? '—') })),
    ...lessons.map(l => ({ id: String(l['id']), type: 'lesson', description: String(l['lesson'] ?? l['description'] ?? l['id']), date: String(l['date'] ?? '—'), status: 'recorded' })),
  ].sort((a, b) => b.date.localeCompare(a.date))

  const filtered = log.filter(l => !search || l.description.toLowerCase().includes(search.toLowerCase()) || l.type.includes(search.toLowerCase()))
  const typeColor: Record<string,string> = { incident: 'var(--jarvis-red)', change: 'var(--jarvis-amb)', lesson: 'var(--jarvis-blue)' }

  return (
    <div role="main" aria-label="Risk Log">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 8, marginBottom: 16 }}>
        <KpiCard label="Total Entries"  value={log.length} />
        <KpiCard label="Incidents"      value={incidents.length}    color="var(--jarvis-red)" />
        <KpiCard label="Change Events"  value={changeEvents.length} color="var(--jarvis-amb)" />
        <KpiCard label="Lessons Learnt" value={lessons.length}      color="var(--jarvis-blue)" />
      </div>
      <div style={{ marginBottom: 10 }}>
        <input className="jarvis-input" type="search" placeholder="Search risk log…" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search risk log" />
      </div>
      {filtered.length === 0 ? (
        <div className="jarvis-empty"><span className="jarvis-empty-icon">📋</span><span>{search ? 'No entries match' : 'Risk log is empty'}</span></div>
      ) : (
        <div className="jarvis-scroll-y jarvis-max-h-lg">
          {filtered.map(entry => (
            <div key={`${entry.type}-${entry.id}`} className="jarvis-row" style={{ padding: '10px 0' }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', background: `color-mix(in srgb, ${typeColor[entry.type] ?? 'var(--jarvis-blue)'} 15%, transparent)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>
                {entry.type === 'incident' ? '🚨' : entry.type === 'change' ? '🔄' : '📖'}
              </div>
              <div className="jarvis-flex-1">
                <span className="jarvis-body" style={{ fontWeight: 600 }}>{entry.description}</span>
                <span className="jarvis-small" style={{ display: 'block', textTransform: 'capitalize' }}>{entry.type} · {entry.date} {entry.impact && entry.impact !== '—' ? ` · Impact: ${entry.impact}` : ''}</span>
              </div>
              <StatusBadge status={entry.status} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
export default RlView
