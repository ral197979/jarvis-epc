/**
 * Denver Engineering — Team & Workforce View (v10.13.0)
 *
 * Roster grid · Member detail with assignments · Add member / assign to project
 */
import React, { useEffect, useState, useCallback } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

type MemberStatus   = 'active' | 'inactive' | 'on_leave'
type AssignmentRole =
  | 'project_manager' | 'superintendent' | 'engineer' | 'foreman'
  | 'inspector' | 'safety_officer' | 'estimator' | 'coordinator' | 'other'

interface TeamMember {
  id:             string
  firstName:      string
  lastName:       string
  fullName:       string
  email:          string | null
  phone:          string | null
  role:           string
  trade:          string | null
  hourlyRate:     number | null
  status:         MemberStatus
  notes:          string | null
  activeProjects: number
  totalAllocation: number
}

interface Assignment {
  id:             string
  memberId:       string
  projectId:      string
  projectName?:   string
  assignmentRole: AssignmentRole
  allocationPct:  number
  startDate:      string
  endDate:        string | null
  memberFirstName?: string
  memberLastName?:  string
  memberRole?:      string
}

interface TeamSummary {
  totalActive:   number
  totalInactive: number
  onLeave:       number
  byRole:        Record<string, number>
  avgAllocation: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<MemberStatus, string> = {
  active:   '#22c55e',
  inactive: '#6b7280',
  on_leave: '#f59e0b',
}
const STATUS_LABEL: Record<MemberStatus, string> = {
  active:   'Active',
  inactive: 'Inactive',
  on_leave: 'On Leave',
}

const ROLE_LABEL: Record<AssignmentRole, string> = {
  project_manager: 'Project Manager',
  superintendent:  'Superintendent',
  engineer:        'Engineer',
  foreman:         'Foreman',
  inspector:       'Inspector',
  safety_officer:  'Safety Officer',
  estimator:       'Estimator',
  coordinator:     'Coordinator',
  other:           'Other',
}

const TRADE_COLOR: Record<string, string> = {
  electrical:  '#f59e0b',
  mechanical:  '#3b82f6',
  civil:       '#8b5cf6',
  structural:  '#ef4444',
  plumbing:    '#06b6d4',
  hvac:        '#10b981',
  general:     '#6b7280',
}

function tradeColor(trade: string | null): string {
  if (!trade) return '#6b7280'
  return TRADE_COLOR[trade.toLowerCase()] ?? '#6b7280'
}

function initials(m: TeamMember) {
  return `${m.firstName[0] ?? ''}${m.lastName[0] ?? ''}`.toUpperCase()
}

function AllocationBar({ pct }: { pct: number }) {
  const over = pct > 100
  const fill = Math.min(pct, 100)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ flex: 1, height: 5, borderRadius: 3, background: 'var(--jarvis-b)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${fill}%`, background: over ? '#ef4444' : pct >= 80 ? '#f59e0b' : '#22c55e', borderRadius: 3 }} />
      </div>
      <span style={{ fontSize: 10, color: over ? '#ef4444' : 'var(--jarvis-ts)', whiteSpace: 'nowrap', minWidth: 28, textAlign: 'right' }}>
        {pct}%
      </span>
    </div>
  )
}

// ─── Member card ──────────────────────────────────────────────────────────────

function MemberCard({ m, onClick }: { m: TeamMember; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: 'var(--jarvis-s2)', border: '1px solid var(--jarvis-b)',
        borderRadius: 10, padding: 14, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 8,
      }}
    >
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        {/* Avatar */}
        <div style={{
          width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
          background: m.trade ? `${tradeColor(m.trade)}33` : 'var(--jarvis-b)',
          border: `2px solid ${tradeColor(m.trade)}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, fontWeight: 700, color: tradeColor(m.trade),
        }}>
          {initials(m)}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--jarvis-t)', lineHeight: 1.2 }}>{m.fullName}</div>
          <div style={{ fontSize: 11, color: 'var(--jarvis-ts)', marginTop: 1 }}>{m.role}</div>
          {m.trade && (
            <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 99, background: `${tradeColor(m.trade)}22`, color: tradeColor(m.trade), fontWeight: 600, display: 'inline-block', marginTop: 3 }}>
              {m.trade}
            </span>
          )}
        </div>
        <span style={{ marginLeft: 'auto', padding: '2px 7px', borderRadius: 99, fontSize: 10, fontWeight: 600, color: '#fff', background: STATUS_COLOR[m.status], flexShrink: 0 }}>
          {STATUS_LABEL[m.status]}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, fontSize: 11 }}>
        <span style={{ color: 'var(--jarvis-ts)' }}>
          📋 {m.activeProjects} project{m.activeProjects !== 1 ? 's' : ''}
        </span>
        {m.hourlyRate && (
          <span style={{ color: 'var(--jarvis-ts)' }}>${m.hourlyRate}/hr</span>
        )}
      </div>

      <AllocationBar pct={m.totalAllocation} />
    </div>
  )
}

// ─── Detail panel ─────────────────────────────────────────────────────────────

function DetailPanel({
  member, onClose, onUpdated,
}: {
  member:    TeamMember
  onClose:   () => void
  onUpdated: () => void
}) {
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [tab,         setTab]         = useState<'info' | 'assignments'>('info')
  const [showAssign,  setShowAssign]  = useState(false)
  const [assignForm,  setAssignForm]  = useState({ projectId: '', assignmentRole: 'engineer' as AssignmentRole, allocationPct: '100', startDate: new Date().toISOString().slice(0,10), endDate: '' })
  const [saving,      setSaving]      = useState(false)

  useEffect(() => {
    fetch(`/api/v1/team/members/${member.id}/assignments`)
      .then(r => r.json() as Promise<{ assignments: Assignment[] }>)
      .then(d => setAssignments(d.assignments ?? []))
      .catch(() => {})
  }, [member.id])

  const handleEnd = async (aId: string) => {
    await fetch(`/api/v1/team/assignments/${aId}/end`, { method: 'POST' })
    setAssignments(prev => prev.map(a => a.id === aId ? { ...a, endDate: new Date().toISOString().slice(0,10) } : a))
    onUpdated()
  }

  const handleAssign = async () => {
    if (!assignForm.projectId) return
    setSaving(true)
    try {
      await fetch('/api/v1/team/assignments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          memberId:       member.id,
          projectId:      assignForm.projectId,
          assignmentRole: assignForm.assignmentRole,
          allocationPct:  parseInt(assignForm.allocationPct) || 100,
          startDate:      assignForm.startDate,
          endDate:        assignForm.endDate || null,
        }),
      })
      const res = await fetch(`/api/v1/team/members/${member.id}/assignments`)
      const d = await res.json() as { assignments: Assignment[] }
      setAssignments(d.assignments ?? [])
      setShowAssign(false)
      onUpdated()
    } catch { /* ignore */ } finally { setSaving(false) }
  }

  const isActive = (a: Assignment) => !a.endDate || new Date(a.endDate) >= new Date()

  const inputS: React.CSSProperties = {
    padding: '6px 8px', borderRadius: 5, border: '1px solid var(--jarvis-b)',
    background: 'var(--jarvis-s)', color: 'var(--jarvis-t)', fontSize: 12, width: '100%', boxSizing: 'border-box',
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 100, display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        style={{ width: 440, height: '100vh', overflowY: 'auto', background: 'var(--jarvis-s2)', borderLeft: '1px solid var(--jarvis-b)', padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <div style={{ width: 48, height: 48, borderRadius: '50%', background: `${tradeColor(member.trade)}33`, border: `2px solid ${tradeColor(member.trade)}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 700, color: tradeColor(member.trade) }}>
              {initials(member)}
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--jarvis-t)' }}>{member.fullName}</h3>
              <div style={{ fontSize: 12, color: 'var(--jarvis-ts)' }}>{member.role}{member.trade ? ` · ${member.trade}` : ''}</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--jarvis-ts)', cursor: 'pointer', fontSize: 18 }}>✕</button>
        </div>

        {/* Status + allocation */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600, color: '#fff', background: STATUS_COLOR[member.status] }}>{STATUS_LABEL[member.status]}</span>
          <span style={{ fontSize: 12, color: 'var(--jarvis-ts)' }}>{member.totalAllocation}% allocated · {member.activeProjects} active project{member.activeProjects !== 1 ? 's' : ''}</span>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--jarvis-b)', paddingBottom: 0 }}>
          {(['info', 'assignments'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={{ padding: '6px 14px', border: 'none', borderBottom: `2px solid ${tab === t ? 'var(--jarvis-a)' : 'transparent'}`, background: 'none', color: tab === t ? 'var(--jarvis-a)' : 'var(--jarvis-ts)', fontWeight: tab === t ? 600 : 400, fontSize: 13, cursor: 'pointer', marginBottom: -1 }}>
              {t === 'info' ? 'Info' : `Assignments (${assignments.length})`}
            </button>
          ))}
        </div>

        {tab === 'info' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[
              ['Email',       member.email       ?? '—'],
              ['Phone',       member.phone       ?? '—'],
              ['Hourly Rate', member.hourlyRate   ? `$${member.hourlyRate}/hr` : '—'],
            ].map(([label, val]) => (
              <div key={label} style={{ display: 'flex', gap: 8 }}>
                <span style={{ fontSize: 11, color: 'var(--jarvis-ts)', minWidth: 90 }}>{label}</span>
                <span style={{ fontSize: 12, color: 'var(--jarvis-t)' }}>{val}</span>
              </div>
            ))}
            {member.notes && (
              <div style={{ fontSize: 12, color: 'var(--jarvis-ts)', background: 'var(--jarvis-s)', borderRadius: 6, padding: '8px 12px', lineHeight: 1.5 }}>
                {member.notes}
              </div>
            )}
          </div>
        )}

        {tab === 'assignments' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {assignments.length === 0 && <p style={{ fontSize: 12, color: 'var(--jarvis-ts)' }}>No assignments yet.</p>}
            {assignments.map(a => (
              <div key={a.id} style={{ background: 'var(--jarvis-s)', borderRadius: 8, padding: '10px 12px', border: `1px solid ${isActive(a) ? '#22c55e44' : 'var(--jarvis-b)'}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--jarvis-t)' }}>{a.projectName ?? a.projectId}</div>
                    <div style={{ fontSize: 11, color: 'var(--jarvis-ts)', marginTop: 2 }}>{ROLE_LABEL[a.assignmentRole]} · {a.allocationPct}%</div>
                    <div style={{ fontSize: 10, color: 'var(--jarvis-ts)', marginTop: 3 }}>
                      {new Date(a.startDate).toLocaleDateString()} → {a.endDate ? new Date(a.endDate).toLocaleDateString() : 'Ongoing'}
                    </div>
                  </div>
                  {isActive(a) && (
                    <button onClick={() => handleEnd(a.id)}
                      style={{ fontSize: 11, padding: '3px 8px', borderRadius: 5, border: '1px solid var(--jarvis-b)', background: 'none', color: 'var(--jarvis-ts)', cursor: 'pointer' }}>
                      End
                    </button>
                  )}
                </div>
              </div>
            ))}

            {!showAssign ? (
              <button onClick={() => setShowAssign(true)}
                style={{ padding: '7px 0', borderRadius: 7, border: '1px dashed var(--jarvis-b)', background: 'none', color: 'var(--jarvis-ts)', cursor: 'pointer', fontSize: 12 }}>
                + Assign to Project
              </button>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--jarvis-s)', borderRadius: 8, padding: 12 }}>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--jarvis-ts)', display: 'block', marginBottom: 3 }}>Project ID</label>
                  <input value={assignForm.projectId} onChange={e => setAssignForm(f => ({ ...f, projectId: e.target.value }))} placeholder="paste project UUID" style={inputS} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--jarvis-ts)', display: 'block', marginBottom: 3 }}>Role</label>
                    <select value={assignForm.assignmentRole} onChange={e => setAssignForm(f => ({ ...f, assignmentRole: e.target.value as AssignmentRole }))} style={inputS}>
                      {(Object.keys(ROLE_LABEL) as AssignmentRole[]).map(r => (
                        <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--jarvis-ts)', display: 'block', marginBottom: 3 }}>Allocation %</label>
                    <input type="number" min="1" max="100" value={assignForm.allocationPct} onChange={e => setAssignForm(f => ({ ...f, allocationPct: e.target.value }))} style={inputS} />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--jarvis-ts)', display: 'block', marginBottom: 3 }}>Start Date</label>
                    <input type="date" value={assignForm.startDate} onChange={e => setAssignForm(f => ({ ...f, startDate: e.target.value }))} style={inputS} />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--jarvis-ts)', display: 'block', marginBottom: 3 }}>End Date</label>
                    <input type="date" value={assignForm.endDate} onChange={e => setAssignForm(f => ({ ...f, endDate: e.target.value }))} style={inputS} />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={handleAssign} disabled={saving || !assignForm.projectId}
                    style={{ flex: 1, padding: '7px 0', borderRadius: 6, border: 'none', background: 'var(--jarvis-a)', color: '#fff', fontWeight: 600, fontSize: 12, cursor: 'pointer', opacity: saving ? .6 : 1 }}>
                    {saving ? 'Saving…' : 'Assign'}
                  </button>
                  <button onClick={() => setShowAssign(false)}
                    style={{ padding: '7px 14px', borderRadius: 6, border: '1px solid var(--jarvis-b)', background: 'none', color: 'var(--jarvis-ts)', cursor: 'pointer', fontSize: 12 }}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Add Member Modal ─────────────────────────────────────────────────────────

function AddMemberModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const TRADES = ['electrical','mechanical','civil','structural','plumbing','hvac','general']
  const [form, setForm] = useState({ firstName: '', lastName: '', role: '', trade: '', email: '', phone: '', hourlyRate: '', notes: '' })
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState<string | null>(null)

  const set = (k: keyof typeof form, v: string) => setForm(f => ({ ...f, [k]: v }))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.firstName || !form.lastName || !form.role) { setError('First name, last name, and role are required'); return }
    setSaving(true); setError(null)
    try {
      const res = await fetch('/api/v1/team/members', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName:  form.firstName,
          lastName:   form.lastName,
          role:       form.role,
          trade:      form.trade      || null,
          email:      form.email      || null,
          phone:      form.phone      || null,
          hourlyRate: form.hourlyRate ? parseFloat(form.hourlyRate) : null,
          notes:      form.notes      || null,
        }),
      })
      if (!res.ok) throw new Error()
      onAdded(); onClose()
    } catch { setError('Failed to add member') } finally { setSaving(false) }
  }

  const inputS: React.CSSProperties = { padding: '7px 10px', borderRadius: 6, border: '1px solid var(--jarvis-b)', background: 'var(--jarvis-s)', color: 'var(--jarvis-t)', fontSize: 13, width: '100%', boxSizing: 'border-box' }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <form onClick={e => e.stopPropagation()} onSubmit={submit}
        style={{ width: 420, background: 'var(--jarvis-s2)', borderRadius: 12, padding: 24, display: 'flex', flexDirection: 'column', gap: 12, border: '1px solid var(--jarvis-b)' }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--jarvis-t)' }}>Add Team Member</h3>
        {error && <div style={{ color: '#dc2626', fontSize: 12 }}>{error}</div>}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {[['First Name *', 'firstName'], ['Last Name *', 'lastName']].map(([label, key]) => (
            <div key={key}>
              <label style={{ fontSize: 11, color: 'var(--jarvis-ts)', display: 'block', marginBottom: 3 }}>{label}</label>
              <input value={form[key as keyof typeof form]} onChange={e => set(key as keyof typeof form, e.target.value)} style={inputS} required />
            </div>
          ))}
        </div>

        <div>
          <label style={{ fontSize: 11, color: 'var(--jarvis-ts)', display: 'block', marginBottom: 3 }}>Role / Title *</label>
          <input value={form.role} onChange={e => set('role', e.target.value)} placeholder="e.g. Senior Engineer" style={inputS} required />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <label style={{ fontSize: 11, color: 'var(--jarvis-ts)', display: 'block', marginBottom: 3 }}>Trade</label>
            <select value={form.trade} onChange={e => set('trade', e.target.value)} style={inputS}>
              <option value="">— none —</option>
              {TRADES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, color: 'var(--jarvis-ts)', display: 'block', marginBottom: 3 }}>Hourly Rate</label>
            <input type="number" min="0" step="0.01" value={form.hourlyRate} onChange={e => set('hourlyRate', e.target.value)} placeholder="$/hr" style={inputS} />
          </div>
          <div>
            <label style={{ fontSize: 11, color: 'var(--jarvis-ts)', display: 'block', marginBottom: 3 }}>Email</label>
            <input type="email" value={form.email} onChange={e => set('email', e.target.value)} style={inputS} />
          </div>
          <div>
            <label style={{ fontSize: 11, color: 'var(--jarvis-ts)', display: 'block', marginBottom: 3 }}>Phone</label>
            <input value={form.phone} onChange={e => set('phone', e.target.value)} style={inputS} />
          </div>
        </div>

        <div>
          <label style={{ fontSize: 11, color: 'var(--jarvis-ts)', display: 'block', marginBottom: 3 }}>Notes</label>
          <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} style={{ ...inputS, resize: 'vertical', fontFamily: 'inherit' }} />
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={{ padding: '8px 16px', borderRadius: 7, border: '1px solid var(--jarvis-b)', background: 'none', color: 'var(--jarvis-t)', cursor: 'pointer' }}>Cancel</button>
          <button type="submit" disabled={saving} style={{ padding: '8px 18px', borderRadius: 7, border: 'none', background: 'var(--jarvis-a)', color: '#fff', fontWeight: 600, cursor: 'pointer', opacity: saving ? .7 : 1 }}>
            {saving ? 'Adding…' : 'Add Member'}
          </button>
        </div>
      </form>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

interface Props {
  policy?:     Record<string, unknown>
  biz?:        Record<string, unknown>
  onNavigate?: (tab: string) => void
}

export default function TeamView(_: Props) {
  const [members,    setMembers]    = useState<TeamMember[]>([])
  const [summary,    setSummary]    = useState<TeamSummary | null>(null)
  const [selected,   setSelected]   = useState<TeamMember | null>(null)
  const [showAdd,    setShowAdd]    = useState(false)
  const [filterStatus, setFilterStatus] = useState<MemberStatus | 'all'>('active')
  const [search,     setSearch]     = useState('')
  const [loading,    setLoading]    = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filterStatus !== 'all') params.set('status', filterStatus)
      if (search) params.set('q', search)

      const [mRes, sRes] = await Promise.all([
        fetch(`/api/v1/team/members?${params}`),
        fetch('/api/v1/team/summary'),
      ])
      const mData = await mRes.json() as { members: TeamMember[] }
      const sData = await sRes.json() as { summary: TeamSummary }
      setMembers(mData.members ?? [])
      setSummary(sData.summary)
    } catch { /* ignore */ } finally { setLoading(false) }
  }, [filterStatus, search])

  useEffect(() => { load() }, [load])

  const selectS = (active: boolean): React.CSSProperties => ({
    padding: '5px 12px', borderRadius: 5, fontSize: 12, cursor: 'pointer',
    border: '1px solid var(--jarvis-b)', fontWeight: active ? 600 : 400,
    background: active ? 'var(--jarvis-a)' : 'var(--jarvis-s2)',
    color:      active ? '#fff'            : 'var(--jarvis-t)',
  })

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--jarvis-t)' }}>Team & Workforce</h2>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--jarvis-ts)' }}>Roster · Project assignments · Utilization</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name / role…"
            style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--jarvis-b)', background: 'var(--jarvis-s2)', color: 'var(--jarvis-t)', fontSize: 12, width: 180 }} />
          {(['all', 'active', 'inactive', 'on_leave'] as const).map(s => (
            <button key={s} onClick={() => setFilterStatus(s)} style={selectS(filterStatus === s)}>
              {s === 'all' ? 'All' : STATUS_LABEL[s as MemberStatus] ?? s}
            </button>
          ))}
          <button onClick={() => setShowAdd(true)}
            style={{ padding: '7px 16px', borderRadius: 7, border: 'none', background: 'var(--jarvis-a)', color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
            + Add Member
          </button>
        </div>
      </div>

      {/* Summary strip */}
      {summary && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {[
            ['Active',      String(summary.totalActive),   '#22c55e'],
            ['On Leave',    String(summary.onLeave),        '#f59e0b'],
            ['Inactive',    String(summary.totalInactive),  '#6b7280'],
            ['Avg Allocation', `${summary.avgAllocation}%`, summary.avgAllocation > 90 ? '#ef4444' : summary.avgAllocation > 70 ? '#f59e0b' : '#22c55e'],
          ].map(([label, val, color]) => (
            <div key={label} style={{ flex: '1 1 100px', background: 'var(--jarvis-s2)', border: '1px solid var(--jarvis-b)', borderRadius: 8, padding: '10px 14px' }}>
              <div style={{ fontSize: 10, color: 'var(--jarvis-ts)', textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color, marginTop: 2 }}>{val}</div>
            </div>
          ))}
          {/* Top roles */}
          {Object.entries(summary.byRole).slice(0, 4).map(([role, cnt]) => (
            <div key={role} style={{ flex: '1 1 90px', background: 'var(--jarvis-s2)', border: '1px solid var(--jarvis-b)', borderRadius: 8, padding: '10px 14px' }}>
              <div style={{ fontSize: 10, color: 'var(--jarvis-ts)', textTransform: 'uppercase', letterSpacing: '.05em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{role}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--jarvis-t)', marginTop: 2 }}>{cnt}</div>
            </div>
          ))}
        </div>
      )}

      {/* Roster grid */}
      {loading ? (
        <div style={{ color: 'var(--jarvis-ts)', fontSize: 13 }}>Loading…</div>
      ) : members.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--jarvis-ts)', fontSize: 13 }}>
          No team members found.{' '}
          <button onClick={() => setShowAdd(true)} style={{ background: 'none', border: 'none', color: 'var(--jarvis-a)', cursor: 'pointer', textDecoration: 'underline', fontSize: 13 }}>Add the first one.</button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
          {members.map(m => (
            <MemberCard key={m.id} m={m} onClick={() => setSelected(m)} />
          ))}
        </div>
      )}

      {/* Panels */}
      {selected && (
        <DetailPanel member={selected} onClose={() => setSelected(null)} onUpdated={load} />
      )}
      {showAdd && (
        <AddMemberModal onClose={() => setShowAdd(false)} onAdded={load} />
      )}
    </div>
  )
}
