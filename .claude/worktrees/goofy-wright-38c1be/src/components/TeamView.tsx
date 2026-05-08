/**
 * JARVIS EPC — TeamView  ·  Team Roster + Role Management  (P4)
 */
import React, { useState } from 'react'
import { useBizStore } from '../modules/biz/store'
import { StatusBadge } from './StatusBadge'
import type { PolicyConfig } from '../modules/biz/dispatch'

const ROLES = ['owner', 'exec', 'pm', 'engineer', 'viewer'] as const
type Role = typeof ROLES[number]

interface TeamMember {
  id: string
  name: string
  role: Role
  discipline?: string
  email?: string
  phone?: string
  status: 'active' | 'inactive' | 'on_leave'
  projects?: string[]
}

export interface TeamViewProps { policy?: Partial<PolicyConfig>; biz?: Record<string, unknown> }

const ROLE_COLOR: Record<string, string> = {
  owner: 'var(--jarvis-pur,#9b59b6)', exec: 'var(--jarvis-red,#e74c3c)',
  pm: 'var(--jarvis-ac)', engineer: 'var(--jarvis-blue,#3498db)', viewer: 'var(--jarvis-ts)',
}

export function TeamView({ policy }: TeamViewProps) {
  const raw = (useBizStore(s => s.biz.team_members) ?? []) as TeamMember[]
  const [filter, setFilter] = useState<Role | 'all'>('all')
  const [search, setSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [draft, setDraft] = useState({ name: '', role: 'engineer' as Role, discipline: '', email: '' })
  const dispatch = useBizStore(s => s.dispatch)

  const canWrite = policy?.writesEnabled !== false

  const demo: TeamMember[] = raw.length === 0 ? [
    { id: 'tm1', name: 'Alex Reyes',    role: 'pm',       discipline: 'Project Management', email: 'areyes@example.com',  status: 'active',   projects: ['Proj-01','Proj-02'] },
    { id: 'tm2', name: 'Jordan Kim',    role: 'engineer', discipline: 'Mechanical',          email: 'jkim@example.com',    status: 'active',   projects: ['Proj-01'] },
    { id: 'tm3', name: 'Sam Torres',    role: 'engineer', discipline: 'Electrical',          email: 'storres@example.com', status: 'active',   projects: ['Proj-02'] },
    { id: 'tm4', name: 'Casey Morgan',  role: 'viewer',   discipline: 'Safety',              email: 'cmorgan@example.com', status: 'on_leave', projects: [] },
    { id: 'tm5', name: 'Dana Patel',    role: 'exec',     discipline: 'Executive',           email: 'dpatel@example.com',  status: 'active',   projects: ['Proj-01','Proj-02'] },
  ] : raw

  const displayed = demo.filter(m =>
    (filter === 'all' || m.role === filter) &&
    (m.name.toLowerCase().includes(search.toLowerCase()) || (m.discipline ?? '').toLowerCase().includes(search.toLowerCase()))
  )

  const addMember = () => {
    if (!draft.name) return
    dispatch({ type: 'team/add', payload: { id: `TM-${Date.now()}`, ...draft, status: 'active' } })
    setDraft({ name: '', role: 'engineer', discipline: '', email: '' })
    setShowAdd(false)
  }

  return (
    <div role="main" aria-label="Team">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Team Roster</h2>
        <span style={{ fontSize: 12, color: 'var(--jarvis-ts)', marginLeft: 4 }}>{demo.filter(m => m.status === 'active').length} active</span>
        {canWrite && <button onClick={() => setShowAdd(v => !v)} style={{ marginLeft: 'auto', padding: '6px 14px', background: 'var(--jarvis-ac)', color: '#fff', border: 'none', borderRadius: 4, fontSize: 12, cursor: 'pointer' }}>+ Add Member</button>}
      </div>

      {showAdd && (
        <div style={{ border: '1px solid var(--jarvis-bd)', padding: 12, borderRadius: 6, marginBottom: 12, background: 'var(--jarvis-bg2)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px,1fr))', gap: 8 }}>
            <input placeholder="Full name *" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} style={{ padding: '6px 8px', background: 'var(--jarvis-bg)', border: '1px solid var(--jarvis-bd)', borderRadius: 4, color: 'var(--jarvis-tx)', fontSize: 12 }} />
            <select value={draft.role} onChange={e => setDraft({ ...draft, role: e.target.value as Role })} style={{ padding: '6px 8px', background: 'var(--jarvis-bg)', border: '1px solid var(--jarvis-bd)', borderRadius: 4, color: 'var(--jarvis-tx)', fontSize: 12 }}>
              {ROLES.map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
            </select>
            <input placeholder="Discipline" value={draft.discipline} onChange={e => setDraft({ ...draft, discipline: e.target.value })} style={{ padding: '6px 8px', background: 'var(--jarvis-bg)', border: '1px solid var(--jarvis-bd)', borderRadius: 4, color: 'var(--jarvis-tx)', fontSize: 12 }} />
            <input placeholder="Email" type="email" value={draft.email} onChange={e => setDraft({ ...draft, email: e.target.value })} style={{ padding: '6px 8px', background: 'var(--jarvis-bg)', border: '1px solid var(--jarvis-bd)', borderRadius: 4, color: 'var(--jarvis-tx)', fontSize: 12 }} />
          </div>
          <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
            <button onClick={addMember} style={{ padding: '6px 14px', background: 'var(--jarvis-ac)', color: '#fff', border: 'none', borderRadius: 4, fontSize: 12, cursor: 'pointer' }}>Save</button>
            <button onClick={() => setShowAdd(false)} style={{ padding: '6px 10px', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        {(['all', ...ROLES] as const).map(r => (
          <button key={r} onClick={() => setFilter(r)} style={{ padding: '4px 10px', fontSize: 11, background: filter === r ? (ROLE_COLOR[r] ?? 'var(--jarvis-ac)') : 'var(--jarvis-bg2)', color: filter === r ? '#fff' : 'var(--jarvis-ts)', border: '1px solid var(--jarvis-bd)', borderRadius: 12, cursor: 'pointer' }}>
            {r === 'all' ? 'All' : r.charAt(0).toUpperCase() + r.slice(1)}
          </button>
        ))}
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…" style={{ marginLeft: 'auto', padding: '5px 10px', fontSize: 12, background: 'var(--jarvis-bg2)', border: '1px solid var(--jarvis-bd)', borderRadius: 4, color: 'var(--jarvis-tx)' }} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px,1fr))', gap: 10 }}>
        {displayed.map(m => (
          <div key={m.id} style={{ border: '1px solid var(--jarvis-bd)', borderRadius: 8, padding: 14, background: 'var(--jarvis-bg2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 38, height: 38, borderRadius: '50%', background: ROLE_COLOR[m.role] ?? 'var(--jarvis-ac)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 14, flexShrink: 0 }}>
                {m.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</div>
                <div style={{ fontSize: 11, color: 'var(--jarvis-ts)' }}>{m.discipline}</div>
              </div>
              <StatusBadge status={m.status} />
            </div>
            <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ padding: '2px 8px', background: ROLE_COLOR[m.role] ?? 'var(--jarvis-ac)', color: '#fff', borderRadius: 10, fontSize: 10, fontWeight: 600 }}>{m.role}</span>
              {m.email && <span style={{ fontSize: 10, color: 'var(--jarvis-ts)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.email}</span>}
            </div>
            {m.projects && m.projects.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 10, color: 'var(--jarvis-ts)' }}>Projects: {m.projects.join(', ')}</div>
            )}
          </div>
        ))}
        {displayed.length === 0 && <div className="jarvis-empty" style={{ gridColumn: '1/-1' }}><span className="jarvis-empty-icon">👥</span><span>No team members match filter</span></div>}
      </div>
    </div>
  )
}

export default TeamView
