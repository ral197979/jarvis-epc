/**
 * Denver Engineering — Meeting Minutes View (v10.9.0)
 * ─────────────────────────────────────────────────────
 * Formal meeting documentation: list, create, and detail view
 * with agenda items and action items. Draft → Published workflow.
 */
import React, { useState, useEffect, useCallback } from 'react'
import { useBizStore, selectProjects } from '../../modules/biz/store'

// ─── Types ────────────────────────────────────────────────────────────────────

type MeetingType   = 'oac' | 'safety' | 'coordination' | 'progress' | 'kickoff' | 'other'
type MeetingStatus = 'draft' | 'published' | 'archived'

interface Meeting {
  id: string; mtgNumber: number; meetingType: MeetingType; status: MeetingStatus
  title: string; meetingDate: string; startTime: string | null; endTime: string | null
  location: string | null; facilitator: string | null
  attendees: { name: string; company?: string; role?: string }[]
  generalNotes: string | null; nextMeetingDate: string | null
  publishedAt: string | null; createdAt: string
  agendaItemCount?: number; actionItemCount?: number
}

interface AgendaItem {
  id: string; sortOrder: number; topic: string; presenter: string | null
  durationMin: number | null; notes: string | null; decision: string | null
}

interface ActionItem {
  id: string; title: string; assignedTo: string | null
  dueDate: string | null; priority: string; status: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<MeetingType, string> = {
  oac: 'OAC', safety: 'Safety', coordination: 'Coordination',
  progress: 'Progress', kickoff: 'Kickoff', other: 'Other',
}
const TYPE_COLORS: Record<MeetingType, string> = {
  oac: '#3b82f6', safety: '#e74c3c', coordination: '#f39c12',
  progress: '#198754', kickoff: '#8b5cf6', other: '#6c757d',
}
const STATUS_COLOR: Record<MeetingStatus, string> = {
  draft: '#6c757d', published: '#198754', archived: '#adb5bd',
}
const PRIORITY_COLOR: Record<string, string> = {
  low: '#6c757d', medium: '#f39c12', high: '#e74c3c', critical: '#dc3545',
}

function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, background: color + '22', color, border: `1px solid ${color}44` }}>
      {label}
    </span>
  )
}

const inputStyle: React.CSSProperties = {
  background: '#1a1a1a', border: '1px solid #333', borderRadius: 6,
  padding: '7px 10px', color: '#eee', fontSize: 13, width: '100%', boxSizing: 'border-box',
}
const taStyle: React.CSSProperties = { ...inputStyle, resize: 'vertical' }

// ─── Create modal ─────────────────────────────────────────────────────────────

function CreateModal({ projectId, onClose, onCreated }: {
  projectId: string; onClose: () => void; onCreated: (m: Meeting) => void
}) {
  const [form, setForm] = useState({
    title: '', meetingType: 'oac' as MeetingType,
    meetingDate: new Date().toISOString().slice(0, 10),
    startTime: '', endTime: '', location: '', facilitator: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const submit = async () => {
    if (!form.title || !form.meetingDate) { setError('Title and date are required'); return }
    setSaving(true); setError('')
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/meetings`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          startTime: form.startTime || undefined,
          endTime:   form.endTime   || undefined,
          location:  form.location  || undefined,
          facilitator: form.facilitator || undefined,
        }),
      })
      if (!res.ok) throw new Error(await res.text())
      const j = await res.json(); onCreated(j.meeting)
    } catch (e) { setError((e as Error).message) }
    finally { setSaving(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#111', border: '1px solid #333', borderRadius: 12, padding: 24, width: 520, maxWidth: '95vw' }}>
        <h3 style={{ margin: '0 0 18px', fontSize: 15 }}>New Meeting</h3>
        {error && <div style={{ color: '#e74c3c', fontSize: 12, marginBottom: 10 }}>{error}</div>}

        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', fontSize: 11, color: '#888', marginBottom: 3 }}>Title *</label>
          <input value={form.title} onChange={set('title')} style={inputStyle} placeholder="e.g. Week 14 OAC Meeting" />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
          <div>
            <label style={{ display: 'block', fontSize: 11, color: '#888', marginBottom: 3 }}>Type</label>
            <select value={form.meetingType} onChange={set('meetingType')} style={inputStyle}>
              {(Object.keys(TYPE_LABELS) as MeetingType[]).map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, color: '#888', marginBottom: 3 }}>Date *</label>
            <input type="date" value={form.meetingDate} onChange={set('meetingDate')} style={inputStyle} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, color: '#888', marginBottom: 3 }}>Start Time</label>
            <input type="time" value={form.startTime} onChange={set('startTime')} style={inputStyle} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, color: '#888', marginBottom: 3 }}>End Time</label>
            <input type="time" value={form.endTime} onChange={set('endTime')} style={inputStyle} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, color: '#888', marginBottom: 3 }}>Location</label>
            <input value={form.location} onChange={set('location')} style={inputStyle} placeholder="Conference room / Zoom" />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, color: '#888', marginBottom: 3 }}>Facilitator</label>
            <input value={form.facilitator} onChange={set('facilitator')} style={inputStyle} />
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={{ padding: '8px 16px', background: 'transparent', border: '1px solid #444', borderRadius: 6, color: '#aaa', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
          <button onClick={submit} disabled={saving} style={{ padding: '8px 16px', background: '#3b82f6', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer', fontSize: 13, opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Creating…' : 'Create Meeting'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Detail panel ─────────────────────────────────────────────────────────────

function DetailPanel({ meeting, projectId, onClose, onUpdated }: {
  meeting: Meeting; projectId: string; onClose: () => void; onUpdated: (m: Meeting) => void
}) {
  const [agenda, setAgenda]   = useState<AgendaItem[]>([])
  const [actions, setActions] = useState<ActionItem[]>([])
  const [tab, setTab]         = useState<'agenda' | 'actions' | 'notes'>('agenda')
  const [acting, setActing]   = useState(false)

  const [newTopic, setNewTopic]     = useState('')
  const [newPresenter, setNewPresenter] = useState('')
  const [newDuration, setNewDuration]   = useState('')
  const [newDecision, setNewDecision]   = useState('')

  const [newAction, setNewAction]   = useState('')
  const [newAssignee, setNewAssignee] = useState('')
  const [newDue, setNewDue]         = useState('')
  const [newPriority, setNewPriority] = useState('medium')

  const loadAgenda = useCallback(async () => {
    const res = await fetch(`/api/v1/meetings/${meeting.id}/agenda`, { credentials: 'include' })
    if (res.ok) { const j = await res.json(); setAgenda(j.agendaItems ?? []) }
  }, [meeting.id])

  const loadActions = useCallback(async () => {
    const res = await fetch(`/api/v1/meetings/${meeting.id}/actions`, { credentials: 'include' })
    if (res.ok) { const j = await res.json(); setActions(j.actions ?? []) }
  }, [meeting.id])

  useEffect(() => { loadAgenda(); loadActions() }, [loadAgenda, loadActions])

  const addAgenda = async () => {
    if (!newTopic.trim()) return
    setActing(true)
    try {
      await fetch(`/api/v1/meetings/${meeting.id}/agenda`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: newTopic, presenter: newPresenter || undefined, durationMin: newDuration ? Number(newDuration) : undefined, decision: newDecision || undefined }),
      })
      setNewTopic(''); setNewPresenter(''); setNewDuration(''); setNewDecision('')
      await loadAgenda()
    } finally { setActing(false) }
  }

  const deleteAgenda = async (id: string) => {
    await fetch(`/api/v1/meetings/${meeting.id}/agenda/${id}`, { method: 'DELETE', credentials: 'include' })
    await loadAgenda()
  }

  const addAction = async () => {
    if (!newAction.trim()) return
    setActing(true)
    try {
      await fetch(`/api/v1/meetings/${meeting.id}/actions`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newAction, assignedTo: newAssignee || undefined, dueDate: newDue || undefined, priority: newPriority, projectId }),
      })
      setNewAction(''); setNewAssignee(''); setNewDue(''); setNewPriority('medium')
      await loadActions()
    } finally { setActing(false) }
  }

  const publish = async () => {
    setActing(true)
    try {
      const res = await fetch(`/api/v1/meetings/${meeting.id}/publish`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      if (res.ok) { const j = await res.json(); onUpdated(j.meeting) }
    } finally { setActing(false) }
  }

  const TABS = [
    { id: 'agenda' as const,  label: `Agenda (${agenda.length})` },
    { id: 'actions' as const, label: `Actions (${actions.length})` },
    { id: 'notes' as const,   label: 'Notes' },
  ]

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end' }}>
      <div style={{ background: '#111', borderLeft: '1px solid #2a2a2a', width: 520, minHeight: '100vh', padding: 24, overflowY: 'auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 2 }}>
              MTG-{String(meeting.mtgNumber).padStart(3,'0')} · {fmtDate(meeting.meetingDate)}
              {meeting.startTime && ` · ${meeting.startTime}${meeting.endTime ? `–${meeting.endTime}` : ''}`}
            </div>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{meeting.title}</h3>
            <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
              <Badge label={TYPE_LABELS[meeting.meetingType]} color={TYPE_COLORS[meeting.meetingType]} />
              <Badge label={meeting.status} color={STATUS_COLOR[meeting.status]} />
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#aaa', cursor: 'pointer', fontSize: 18 }}>✕</button>
        </div>

        {/* Meta */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px', fontSize: 12, marginBottom: 16 }}>
          {[['Location', meeting.location], ['Facilitator', meeting.facilitator], ['Attendees', `${meeting.attendees.length} people`], ['Next Meeting', fmtDate(meeting.nextMeetingDate)]].map(([k, v]) => v && v !== '—' && (
            <div key={k as string}>
              <span style={{ color: '#666' }}>{k}: </span>
              <span style={{ color: '#ccc' }}>{v}</span>
            </div>
          ))}
        </div>

        {/* Attendee chips */}
        {meeting.attendees.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
            {meeting.attendees.map((a, i) => (
              <span key={i} style={{ background: '#1e1e1e', border: '1px solid #2a2a2a', borderRadius: 12, padding: '2px 10px', fontSize: 12, color: '#ccc' }}>
                {a.name}{a.company ? ` · ${a.company}` : ''}
              </span>
            ))}
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 2, marginBottom: 16, borderBottom: '1px solid #2a2a2a' }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{ padding: '7px 14px', background: 'transparent', border: 'none', borderBottom: tab === t.id ? '2px solid #3b82f6' : '2px solid transparent', color: tab === t.id ? '#3b82f6' : '#888', cursor: 'pointer', fontSize: 13, marginBottom: -1 }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Agenda tab */}
        {tab === 'agenda' && (
          <div>
            {agenda.map((item, idx) => (
              <div key={item.id} style={{ marginBottom: 12, padding: 12, background: '#1a1a1a', borderRadius: 6, border: '1px solid #2a2a2a' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ fontSize: 12, color: '#888', marginBottom: 3 }}>
                    {idx + 1}. {item.presenter && <span>{item.presenter}</span>} {item.durationMin && <span>· {item.durationMin}min</span>}
                  </div>
                  {meeting.status === 'draft' && (
                    <button onClick={() => deleteAgenda(item.id)} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>×</button>
                  )}
                </div>
                <div style={{ fontWeight: 600, marginBottom: item.notes || item.decision ? 6 : 0 }}>{item.topic}</div>
                {item.notes    && <div style={{ fontSize: 12, color: '#aaa', marginBottom: 4 }}>{item.notes}</div>}
                {item.decision && <div style={{ fontSize: 12, color: '#27ae60', fontStyle: 'italic' }}>✓ Decision: {item.decision}</div>}
              </div>
            ))}

            {meeting.status === 'draft' && (
              <div style={{ padding: 12, background: '#161616', borderRadius: 6, border: '1px dashed #2a2a2a' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 60px', gap: 8, marginBottom: 8 }}>
                  <input value={newTopic} onChange={e => setNewTopic(e.target.value)} placeholder="Topic *" style={inputStyle} />
                  <input value={newPresenter} onChange={e => setNewPresenter(e.target.value)} placeholder="Presenter" style={inputStyle} />
                  <input value={newDuration} onChange={e => setNewDuration(e.target.value)} type="number" placeholder="min" style={inputStyle} />
                </div>
                <input value={newDecision} onChange={e => setNewDecision(e.target.value)} placeholder="Decision (if reached)" style={{ ...inputStyle, marginBottom: 8 }} />
                <button onClick={addAgenda} disabled={acting || !newTopic.trim()} style={{ padding: '6px 14px', background: '#3b82f6', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer', fontSize: 13, opacity: acting ? 0.6 : 1 }}>Add Item</button>
              </div>
            )}
          </div>
        )}

        {/* Actions tab */}
        {tab === 'actions' && (
          <div>
            {actions.map(a => (
              <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #1e1e1e' }}>
                <div>
                  <div style={{ fontSize: 13 }}>{a.title}</div>
                  <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
                    {a.assignedTo && `→ ${a.assignedTo}`} {a.dueDate && `· Due ${fmtDate(a.dueDate)}`}
                  </div>
                </div>
                <Badge label={a.priority} color={PRIORITY_COLOR[a.priority] ?? '#888'} />
              </div>
            ))}

            <div style={{ marginTop: 14, padding: 12, background: '#161616', borderRadius: 6, border: '1px dashed #2a2a2a' }}>
              <input value={newAction} onChange={e => setNewAction(e.target.value)} placeholder="Action item *" style={{ ...inputStyle, marginBottom: 8 }} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
                <input value={newAssignee} onChange={e => setNewAssignee(e.target.value)} placeholder="Assigned to" style={inputStyle} />
                <input type="date" value={newDue} onChange={e => setNewDue(e.target.value)} style={inputStyle} />
                <select value={newPriority} onChange={e => setNewPriority(e.target.value)} style={inputStyle}>
                  {['low','medium','high','critical'].map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <button onClick={addAction} disabled={acting || !newAction.trim()} style={{ padding: '6px 14px', background: '#3b82f6', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer', fontSize: 13, opacity: acting ? 0.6 : 1 }}>Add Action</button>
            </div>
          </div>
        )}

        {/* Notes tab */}
        {tab === 'notes' && (
          <div style={{ fontSize: 13, color: '#ccc', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
            {meeting.generalNotes || <span style={{ color: '#555' }}>No general notes recorded.</span>}
          </div>
        )}

        {/* Publish */}
        {meeting.status === 'draft' && (
          <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid #2a2a2a' }}>
            <button onClick={publish} disabled={acting} style={{ width: '100%', padding: '9px 0', background: '#198754', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600, opacity: acting ? 0.6 : 1 }}>
              Publish Meeting Minutes
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main view ────────────────────────────────────────────────────────────────

export function MeetingsView() {
  const projects = useBizStore(selectProjects)
  const [projectId, setProjectId] = useState('')
  const [meetings, setMeetings]   = useState<Meeting[]>([])
  const [loading, setLoading]     = useState(false)
  const [filterType, setFilterType]     = useState('all')
  const [filterStatus, setFilterStatus] = useState('all')
  const [showCreate, setShowCreate]     = useState(false)
  const [selected, setSelected]         = useState<Meeting | null>(null)

  useEffect(() => {
    const saved = localStorage.getItem('jarvis-active-project')
    if (saved && projects.some(p => p.id === saved)) setProjectId(saved)
    else if (projects.length > 0 && projects[0]) setProjectId(projects[0].id)
  }, [projects])

  const load = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const qs = new URLSearchParams()
      if (filterType   !== 'all') qs.set('type',   filterType)
      if (filterStatus !== 'all') qs.set('status', filterStatus)
      const res = await fetch(`/api/v1/projects/${projectId}/meetings?${qs}`, { credentials: 'include' })
      if (res.ok) { const j = await res.json(); setMeetings(j.meetings ?? []) }
    } finally { setLoading(false) }
  }, [projectId, filterType, filterStatus])

  useEffect(() => { load() }, [load])

  const handleCreated = (m: Meeting) => { setShowCreate(false); setMeetings(prev => [m, ...prev]) }
  const handleUpdated = (m: Meeting) => { setMeetings(prev => prev.map(x => x.id === m.id ? m : x)); setSelected(m) }

  // Group by month
  const grouped = meetings.reduce<Record<string, Meeting[]>>((acc, m) => {
    const key = m.meetingDate.slice(0, 7) // YYYY-MM
    if (!acc[key]) acc[key] = []
    acc[key].push(m)
    return acc
  }, {})

  return (
    <div style={{ padding: '20px 24px', color: 'var(--jarvis-text,#eee)', fontFamily: 'inherit' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>📋 Meeting Minutes</h2>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: '#888' }}>OAC, safety, coordination, and progress meeting documentation</p>
        </div>
        <button onClick={() => setShowCreate(true)} style={{ padding: '8px 16px', background: '#3b82f6', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
          + New Meeting
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        <select value={projectId} onChange={e => { setProjectId(e.target.value); localStorage.setItem('jarvis-active-project', e.target.value) }}
          style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, padding: '6px 10px', color: '#eee', fontSize: 13 }}>
          {projects.map(p => <option key={p.id} value={p.id}>{p['name'] as string}</option>)}
        </select>

        <select value={filterType} onChange={e => setFilterType(e.target.value)}
          style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, padding: '6px 10px', color: '#eee', fontSize: 13 }}>
          <option value="all">All Types</option>
          {(Object.keys(TYPE_LABELS) as MeetingType[]).map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
        </select>

        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, padding: '6px 10px', color: '#eee', fontSize: 13 }}>
          <option value="all">All Statuses</option>
          <option value="draft">Draft</option>
          <option value="published">Published</option>
          <option value="archived">Archived</option>
        </select>
      </div>

      {/* Meeting list grouped by month */}
      {loading ? (
        <div style={{ textAlign: 'center', color: '#888', padding: 40 }}>Loading…</div>
      ) : meetings.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#555', padding: 60 }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
          <div style={{ fontSize: 14 }}>No meetings found</div>
          <div style={{ fontSize: 12, color: '#444', marginTop: 6 }}>Create the first meeting minutes for this project</div>
        </div>
      ) : (
        Object.entries(grouped).map(([month, monthMeetings]) => (
          <div key={month} style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
              {new Date(month + '-15').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {monthMeetings.map(m => (
                <div key={m.id} onClick={() => setSelected(m)}
                  style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 16px', background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, cursor: 'pointer', transition: 'border-color 0.15s' }}>
                  {/* Date block */}
                  <div style={{ textAlign: 'center', minWidth: 40 }}>
                    <div style={{ fontSize: 18, fontWeight: 700, color: TYPE_COLORS[m.meetingType], lineHeight: 1 }}>
                      {new Date(m.meetingDate + 'T12:00:00').getDate()}
                    </div>
                    <div style={{ fontSize: 10, color: '#666', textTransform: 'uppercase' }}>
                      {new Date(m.meetingDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' })}
                    </div>
                  </div>

                  {/* Info */}
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                      <span style={{ fontSize: 11, color: '#555' }}>MTG-{String(m.mtgNumber).padStart(3,'0')}</span>
                      <Badge label={TYPE_LABELS[m.meetingType]} color={TYPE_COLORS[m.meetingType]} />
                      <Badge label={m.status} color={STATUS_COLOR[m.status]} />
                    </div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{m.title}</div>
                    <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
                      {m.startTime && `${m.startTime}${m.endTime ? `–${m.endTime}` : ''} · `}
                      {m.location && `${m.location} · `}
                      {m.attendees.length > 0 && `${m.attendees.length} attendees · `}
                      {(m.agendaItemCount ?? 0) > 0 && `${m.agendaItemCount} agenda items · `}
                      {(m.actionItemCount ?? 0) > 0 && `${m.actionItemCount} actions`}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      {showCreate && <CreateModal projectId={projectId} onClose={() => setShowCreate(false)} onCreated={handleCreated} />}
      {selected && <DetailPanel meeting={selected} projectId={projectId} onClose={() => setSelected(null)} onUpdated={handleUpdated} />}
    </div>
  )
}

export default MeetingsView
