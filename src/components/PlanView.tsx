/**
 * Denver Engineering — PlanView  ·  Planning (schedule view with Gantt-style milestones)
 */
import React, { useState, useMemo } from 'react'
import { useBizStore, selectContracts } from '../modules/biz/store'
import { StatusBadge } from './StatusBadge'
import { KpiCard }     from './KpiCard'
import type { PolicyConfig } from '../modules/biz/dispatch'

export interface PlanViewProps { policy?: Partial<PolicyConfig> }

function pbar(pct: number, color?: string) {
  const c = color ?? (pct >= 80 ? 'var(--jarvis-grn)' : pct >= 40 ? 'var(--jarvis-blue)' : 'var(--jarvis-amb)')
  return <div style={{ background: 'var(--jarvis-bl)', borderRadius: 4, height: 8, overflow: 'hidden', flex: 1, minWidth: 80 }}>
    <div style={{ width: `${Math.min(100,pct)}%`, height: '100%', background: c, borderRadius: 4, transition: 'width 0.4s' }} />
  </div>
}

export function PlanView({ policy: _p }: PlanViewProps) {
  const contracts  = useBizStore(selectContracts)
  const manpower   = useBizStore(s => s.biz.manpower ?? []) as Record<string,unknown>[]
  const [view, setView] = useState<'milestone'|'resource'>('milestone')
  const [search, setSearch] = useState('')

  const sorted = useMemo(() => [...contracts].sort((a, b) => String(a['start'] ?? '').localeCompare(String(b['start'] ?? ''))), [contracts])
  const filtered = sorted.filter(c => !search || String(c['project'] ?? '').toLowerCase().includes(search.toLowerCase()))
  const active = contracts.filter(c => ['active','in-progress'].includes(String(c['status'] ?? '')))
  const onSchedule = active.filter(c => Number(c['progress'] ?? 0) >= 50).length
  const delayed    = active.filter(c => Number(c['progress'] ?? 0) < 30).length

  const resources = useMemo(() => {
    const roles = [...new Set(manpower.map(m => String(m['role'] ?? m['trade'] ?? 'Unspecified')))].slice(0, 10)
    return roles.map(role => ({ role, count: manpower.filter(m => (m['role'] ?? m['trade']) === role).reduce((s, m) => s + Number(m['count'] ?? m['headcount'] ?? 1), 0) }))
  }, [manpower])

  return (
    <div role="main" aria-label="Planning">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8, marginBottom: 16 }}>
        <KpiCard label="Total Contracts" value={contracts.length} />
        <KpiCard label="Active"          value={active.length}     color="var(--jarvis-blue)" />
        <KpiCard label="On Schedule"     value={onSchedule}        color="var(--jarvis-grn)" />
        <KpiCard label="Delayed"         value={delayed}           color={delayed > 0 ? 'var(--jarvis-red)' : 'var(--jarvis-grn)'} />
        <KpiCard label="Manpower Types"  value={resources.length}  color="var(--jarvis-pur)" />
      </div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 14, borderBottom: '1px solid var(--jarvis-bd)' }}>
        {(['milestone','resource'] as const).map(v => (
          <button key={v} onClick={() => setView(v)} style={{ padding: '6px 16px 10px', background: 'transparent', border: 'none', borderBottom: view === v ? '2px solid var(--jarvis-ac)' : '2px solid transparent', color: view === v ? 'var(--jarvis-tx)' : 'var(--jarvis-ts)', fontWeight: view === v ? 700 : 500, fontSize: 12, cursor: 'pointer', textTransform: 'capitalize' }}>{v} View</button>
        ))}
      </div>

      {view === 'milestone' && (
        <div>
          <div style={{ marginBottom: 10 }}>
            <input className="jarvis-input" type="search" placeholder="Search contracts…" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search" />
          </div>
          {filtered.length === 0 ? (
            <div className="jarvis-empty"><span className="jarvis-empty-icon">📅</span><span>No contracts to schedule</span></div>
          ) : (
            <div className="jarvis-card" style={{ padding: 16 }}>
              <h4 className="jarvis-label" style={{ marginBottom: 12 }}>Contract Schedule</h4>
              {filtered.map(c => {
                const pct = Number(c['progress'] ?? 0)
                return (
                  <div key={String(c['id'])} style={{ marginBottom: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                      <span className="jarvis-body" style={{ fontWeight: 600, minWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(c['project'] ?? c['id'])}</span>
                      {pbar(pct)}
                      <span style={{ fontSize: 11, fontWeight: 700, color: pct >= 80 ? 'var(--jarvis-grn)' : pct >= 40 ? 'var(--jarvis-blue)' : 'var(--jarvis-amb)', width: 36, textAlign: 'right', flexShrink: 0 }}>{pct}%</span>
                      <StatusBadge status={String(c['status'] ?? 'active')} />
                    </div>
                    <div className="jarvis-small" style={{ color: 'var(--jarvis-ts)', paddingLeft: 170 }}>
                      {String(c['start'] ?? '—')} → {String(c['end'] ?? '—')} · {String(c['client'] ?? '—')}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {view === 'resource' && (
        resources.length === 0 ? (
          <div className="jarvis-empty"><span className="jarvis-empty-icon">👷</span><span>No manpower data — add manpower records to see resource planning</span></div>
        ) : (
          <div className="jarvis-card" style={{ padding: 16 }}>
            <h4 className="jarvis-label" style={{ marginBottom: 12 }}>Resource Allocation by Role</h4>
            {resources.map(({ role, count }) => {
              const max = Math.max(...resources.map(r => r.count), 1)
              return (
                <div key={role} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <span className="jarvis-body" style={{ minWidth: 160, fontWeight: 600 }}>{role}</span>
                  {pbar((count / max) * 100, 'var(--jarvis-pur)')}
                  <span style={{ fontFamily: 'var(--jarvis-font-mono)', fontWeight: 700, color: 'var(--jarvis-pur)', width: 36, textAlign: 'right', flexShrink: 0 }}>{count}</span>
                </div>
              )
            })}
          </div>
        )
      )}
    </div>
  )
}
export default PlanView
