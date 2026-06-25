/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Denver Engineering — SubmittalsView (REST upgrade)
 * ─────────────────────────────────────────────────────────────────────────────
 * v4.32.0 — Full submittal workflow against /api/v1/submittals.
 *
 * Workflow:
 *   draft → submitted → under_review →
 *     approved | approved_as_noted | revise_resubmit | rejected
 *
 * Stamp action calls POST /api/v1/submittals/:id/review with one of the four
 * terminal statuses + review_notes. Mirrors RFIsView/PunchListView REST
 * conventions: project selector, KPIs, filters, table, modals.
 */
import React, { useState, useEffect, useMemo, useRef } from 'react'
import { useDeepLink } from '../hooks/useDeepLink'
import SubmittalReviewPanel from './submittal/SubmittalReviewPanel'
import RelatedPanel from './related/RelatedPanel'

interface Submittal {
  id: string
  project_id: string
  submittal_number: string
  title: string
  type: string | null
  discipline: string | null
  spec_section: string | null
  status: 'draft' | 'submitted' | 'under_review' | 'approved' | 'approved_as_noted' | 'revise_resubmit' | 'rejected'
  submitted_by: string | null
  submitted_by_name?: string | null
  reviewed_by: string | null
  reviewed_by_name?: string | null
  due_date: string | null
  review_notes: string | null
  reviewed_at: string | null
  metadata: any
  created_at: string
  project_code?: string
}

interface Project {
  id: string
  code?: string
  name: string
}

const TYPE_OPTIONS = [
  'Shop Drawing',
  'Product Data',
  'Sample',
  'Mock-Up',
  'O&M Manual',
  'Test Report',
  'Certificate',
  'Calculation',
  'Coordination Drawing',
  'As-Built',
]

const DISCIPLINE_OPTIONS = [
  'Architectural',
  'Structural',
  'Mechanical',
  'Electrical',
  'Plumbing',
  'Fire Protection',
  'Civil',
  'Process / Water',
  'Controls / BAS',
  'Telecom / Security',
]

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  under_review: 'Under Review',
  approved: 'Approved',
  approved_as_noted: 'Approved as Noted',
  revise_resubmit: 'Revise & Resubmit',
  rejected: 'Rejected',
}

const STATUS_COLOR: Record<string, string> = {
  draft: 'var(--jarvis-ts)',
  submitted: 'var(--jarvis-accent)',
  under_review: 'var(--jarvis-amb)',
  approved: 'var(--jarvis-grn)',
  approved_as_noted: 'var(--jarvis-grn)',
  revise_resubmit: 'var(--jarvis-amb)',
  rejected: 'var(--jarvis-red)',
}

function fmtDate(d: string | null | undefined) {
  if (!d) return '—'
  try { return new Date(d).toLocaleDateString() } catch { return String(d) }
}

function StatusPill({ status }: { status: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        color: STATUS_COLOR[status] ?? 'var(--jarvis-ts)',
        border: `1px solid ${STATUS_COLOR[status] ?? 'var(--jarvis-ts)'}`,
        background: 'transparent',
      }}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  )
}

export default function SubmittalsView(_props: { policy?: any; biz?: any; onNavigate?: (tab: string) => void }) {
  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState<string>('')
  const [submittals, setSubmittals] = useState<Submittal[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [filterDiscipline, setFilterDiscipline] = useState<string>('all')
  const [search, setSearch] = useState('')

  const [showCreate, setShowCreate] = useState(false)
  const [showDetail, setShowDetail] = useState(false)
  const [selected, setSelected] = useState<Submittal | null>(null)
  const deepLink = useDeepLink('submittal')
  const deepLinkOpened = useRef(false)

  const [showReview, setShowReview] = useState(false)
  const [reviewStatus, setReviewStatus] = useState<'approved' | 'approved_as_noted' | 'revise_resubmit' | 'rejected'>('approved')
  const [reviewNotes, setReviewNotes] = useState('')

  const [createForm, setCreateForm] = useState({
    submittal_number: '',
    title: '',
    type: 'Shop Drawing',
    discipline: 'Architectural',
    spec_section: '',
    due_date: '',
  })

  // ─── Load projects ────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/v1/projects', { credentials: 'include' })
        const json = await res.json()
        const list: Project[] = json.data || json.projects || []
        setProjects(list)
        const saved = localStorage.getItem('jarvis-active-project')
        if (saved && list.some(p => p.id === saved)) {
          setProjectId(saved)
        } else if (list.length > 0) {
          setProjectId(list[0].id)
          localStorage.setItem('jarvis-active-project', list[0].id)
        }
      } catch (e) {
        console.error('[submittals] load projects failed', e)
        setError('Failed to load projects')
      }
    })()
  }, [])

  // ─── Load submittals when project changes ────────────────────────────────
  const reload = async () => {
    if (!projectId) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/submittals?project_id=${projectId}&limit=100`, { credentials: 'include' })
      const json = await res.json()
      setSubmittals(json.data || [])
    } catch (e) {
      console.error('[submittals] load failed', e)
      setError('Failed to load submittals')
    } finally {
      setLoading(false)
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reload() }, [projectId])

  // Deep-link: open the submittal a Focus card pointed at, once loaded.
  useEffect(() => {
    if (deepLinkOpened.current || !deepLink?.sourceId || submittals.length === 0) return
    const target = submittals.find(s => s.id === deepLink.sourceId)
    if (target) { setSelected(target); setShowDetail(true); deepLinkOpened.current = true }
  }, [deepLink, submittals])

  // ─── Derived ──────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return submittals.filter(s => {
      if (filterStatus !== 'all' && s.status !== filterStatus) return false
      if (filterDiscipline !== 'all' && s.discipline !== filterDiscipline) return false
      if (search) {
        const q = search.toLowerCase()
        const hay = `${s.submittal_number} ${s.title} ${s.spec_section ?? ''} ${s.type ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [submittals, filterStatus, filterDiscipline, search])

  const kpis = useMemo(() => {
    const total = submittals.length
    const open = submittals.filter(s => ['draft', 'submitted', 'under_review'].includes(s.status)).length
    const approved = submittals.filter(s => s.status === 'approved' || s.status === 'approved_as_noted').length
    const revise = submittals.filter(s => s.status === 'revise_resubmit').length
    const rejected = submittals.filter(s => s.status === 'rejected').length
    const overdue = submittals.filter(s => {
      if (!s.due_date) return false
      if (['approved', 'approved_as_noted', 'rejected'].includes(s.status)) return false
      return new Date(s.due_date) < new Date()
    }).length
    return { total, open, approved, revise, rejected, overdue }
  }, [submittals])

  // ─── Actions ──────────────────────────────────────────────────────────────
  const handleCreate = async () => {
    if (!projectId) return
    if (!createForm.submittal_number || !createForm.title) {
      alert('Submittal number and title are required.')
      return
    }
    try {
      const res = await fetch('/api/v1/submittals', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          submittal_number: createForm.submittal_number,
          title: createForm.title,
          type: createForm.type || null,
          discipline: createForm.discipline || null,
          spec_section: createForm.spec_section || null,
          due_date: createForm.due_date || null,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        alert(`Create failed: ${j.message ?? res.statusText}`)
        return
      }
      setShowCreate(false)
      setCreateForm({
        submittal_number: '',
        title: '',
        type: 'Shop Drawing',
        discipline: 'Architectural',
        spec_section: '',
        due_date: '',
      })
      reload()
    } catch (e) {
      console.error('[submittals] create failed', e)
      alert('Create failed (network error)')
    }
  }

  const handleStatusChange = async (id: string, next: 'submitted' | 'under_review') => {
    // For non-terminal status changes we use PATCH — server.ts/procurement
    // doesn't expose PATCH in the snapshot we read, so fall back to POST review
    // for terminal stamps and use a transitional PATCH if/when added.
    // For now, the workflow goes: create (draft) → submit → review (terminal).
    try {
      const res = await fetch(`/api/v1/submittals/${id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      })
      if (!res.ok) {
        // Some deployments may not expose PATCH yet; surface a clear error.
        const j = await res.json().catch(() => ({}))
        alert(`Status change unavailable: ${j.message ?? res.statusText}`)
        return
      }
      reload()
    } catch (e) {
      console.error('[submittals] status change failed', e)
    }
  }

  const handleReview = async () => {
    if (!selected) return
    try {
      const res = await fetch(`/api/v1/submittals/${selected.id}/review`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: reviewStatus,
          review_notes: reviewNotes || null,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        alert(`Review failed: ${j.message ?? res.statusText}`)
        return
      }
      setShowReview(false)
      setShowDetail(false)
      setReviewNotes('')
      setReviewStatus('approved')
      reload()
    } catch (e) {
      console.error('[submittals] review failed', e)
      alert('Review failed (network error)')
    }
  }

  const openDetail = (s: Submittal) => {
    setSelected(s)
    setShowDetail(true)
  }

  const openReview = (s: Submittal) => {
    setSelected(s)
    setReviewStatus('approved')
    setReviewNotes('')
    setShowReview(true)
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  const activeProject = projects.find(p => p.id === projectId)

  return (
    <div role="main" aria-label="Submittals">
      {/* Header bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ fontSize: 12, color: 'var(--jarvis-ts)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Submittals Register
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--jarvis-accent)' }}>
            {activeProject ? `${activeProject.code ?? ''} ${activeProject.name}`.trim() : '— select a project —'}
          </div>
        </div>
        <select
          className="jarvis-input"
          value={projectId}
          onChange={e => {
            setProjectId(e.target.value)
            localStorage.setItem('jarvis-active-project', e.target.value)
          }}
          aria-label="Active project"
          style={{ minWidth: 220 }}
        >
          <option value="">— project —</option>
          {projects.map(p => (
            <option key={p.id} value={p.id}>{p.code ? `${p.code} · ` : ''}{p.name}</option>
          ))}
        </select>
        <button
          className="jarvis-btn"
          onClick={() => setShowCreate(true)}
          disabled={!projectId}
        >
          + New Submittal
        </button>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginBottom: 16 }}>
        <KpiTile label="Total"     value={kpis.total} />
        <KpiTile label="Open"      value={kpis.open}     color="var(--jarvis-accent)" />
        <KpiTile label="Approved"  value={kpis.approved} color="var(--jarvis-grn)" />
        <KpiTile label="Revise"    value={kpis.revise}   color="var(--jarvis-amb)" />
        <KpiTile label="Rejected"  value={kpis.rejected} color="var(--jarvis-red)" />
        <KpiTile label="Overdue"   value={kpis.overdue}  color="var(--jarvis-red)" />
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <select className="jarvis-input" value={filterStatus} onChange={e => setFilterStatus(e.target.value)} aria-label="Filter by status">
          <option value="all">All statuses</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select className="jarvis-input" value={filterDiscipline} onChange={e => setFilterDiscipline(e.target.value)} aria-label="Filter by discipline">
          <option value="all">All disciplines</option>
          {DISCIPLINE_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <input
          className="jarvis-input"
          type="search"
          placeholder="Search number, title, spec…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          aria-label="Search submittals"
          style={{ flex: 1, minWidth: 180 }}
        />
      </div>

      {/* Body */}
      {error ? (
        <div className="jarvis-empty" style={{ color: 'var(--jarvis-red)' }}>
          <span className="jarvis-empty-icon">⚠</span><span>{error}</span>
        </div>
      ) : loading ? (
        <div className="jarvis-empty"><span className="jarvis-empty-icon">⏳</span><span>Loading submittals…</span></div>
      ) : filtered.length === 0 ? (
        <div className="jarvis-empty">
          <span className="jarvis-empty-icon">📨</span>
          <span>{submittals.length === 0 ? 'No submittals recorded for this project yet.' : 'No submittals match the current filters.'}</span>
        </div>
      ) : (
        <div className="jarvis-scroll-y jarvis-max-h-lg">
          <table className="jarvis-table" aria-label="Submittals">
            <thead>
              <tr>
                <th>#</th>
                <th>Title</th>
                <th>Type</th>
                <th>Discipline</th>
                <th>Spec §</th>
                <th>Due</th>
                <th>Status</th>
                <th style={{ width: 1 }}>—</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(s => {
                const overdue = s.due_date && new Date(s.due_date) < new Date()
                  && !['approved', 'approved_as_noted', 'rejected'].includes(s.status)
                return (
                  <tr key={s.id} style={{ cursor: 'pointer' }} onClick={() => openDetail(s)}>
                    <td style={{ fontFamily: 'var(--jarvis-font-mono)', fontSize: 11, fontWeight: 700 }}>
                      {s.submittal_number}
                    </td>
                    <td style={{ fontWeight: 600 }}>{s.title}</td>
                    <td>{s.type ?? '—'}</td>
                    <td>{s.discipline ?? '—'}</td>
                    <td style={{ fontFamily: 'var(--jarvis-font-mono)', fontSize: 11 }}>{s.spec_section ?? '—'}</td>
                    <td style={{ color: overdue ? 'var(--jarvis-red)' : undefined, fontWeight: overdue ? 700 : undefined }}>
                      {fmtDate(s.due_date)}{overdue ? ' ⚠' : ''}
                    </td>
                    <td><StatusPill status={s.status} /></td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {s.status === 'submitted' || s.status === 'under_review' ? (
                        <button
                          className="jarvis-btn"
                          onClick={e => { e.stopPropagation(); openReview(s) }}
                          style={{ fontSize: 11, padding: '2px 8px' }}
                        >
                          Stamp
                        </button>
                      ) : s.status === 'draft' ? (
                        <button
                          className="jarvis-btn"
                          onClick={e => { e.stopPropagation(); handleStatusChange(s.id, 'submitted') }}
                          style={{ fontSize: 11, padding: '2px 8px' }}
                        >
                          Submit
                        </button>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <Modal title="New Submittal" onClose={() => setShowCreate(false)}>
          <FormRow label="Submittal Number *">
            <input
              className="jarvis-input"
              value={createForm.submittal_number}
              onChange={e => setCreateForm({ ...createForm, submittal_number: e.target.value })}
              placeholder="e.g. SUB-001"
            />
          </FormRow>
          <FormRow label="Title *">
            <input
              className="jarvis-input"
              value={createForm.title}
              onChange={e => setCreateForm({ ...createForm, title: e.target.value })}
              placeholder="e.g. RO Skid Shop Drawings"
            />
          </FormRow>
          <FormRow label="Type">
            <select
              className="jarvis-input"
              value={createForm.type}
              onChange={e => setCreateForm({ ...createForm, type: e.target.value })}
            >
              {TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </FormRow>
          <FormRow label="Discipline">
            <select
              className="jarvis-input"
              value={createForm.discipline}
              onChange={e => setCreateForm({ ...createForm, discipline: e.target.value })}
            >
              {DISCIPLINE_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </FormRow>
          <FormRow label="Spec Section">
            <input
              className="jarvis-input"
              value={createForm.spec_section}
              onChange={e => setCreateForm({ ...createForm, spec_section: e.target.value })}
              placeholder="e.g. 22 31 16"
            />
          </FormRow>
          <FormRow label="Due Date">
            <input
              className="jarvis-input"
              type="date"
              value={createForm.due_date}
              onChange={e => setCreateForm({ ...createForm, due_date: e.target.value })}
            />
          </FormRow>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="jarvis-btn" onClick={() => setShowCreate(false)}>Cancel</button>
            <button className="jarvis-btn" onClick={handleCreate} style={{ background: 'var(--jarvis-accent)', color: 'var(--jarvis-bg)' }}>
              Create
            </button>
          </div>
        </Modal>
      )}

      {/* Detail modal */}
      {showDetail && selected && (
        <Modal title={`${selected.submittal_number} · ${selected.title}`} onClose={() => setShowDetail(false)} wide>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginBottom: 12 }}>
            <KV label="Status"><StatusPill status={selected.status} /></KV>
            <KV label="Type">{selected.type ?? '—'}</KV>
            <KV label="Discipline">{selected.discipline ?? '—'}</KV>
            <KV label="Spec Section">{selected.spec_section ?? '—'}</KV>
            <KV label="Due Date">{fmtDate(selected.due_date)}</KV>
            <KV label="Submitted By">{selected.submitted_by_name ?? '—'}</KV>
            <KV label="Reviewed By">{selected.reviewed_by_name ?? '—'}</KV>
            <KV label="Reviewed At">{fmtDate(selected.reviewed_at)}</KV>
          </div>
          {selected.review_notes && (
            <div style={{ background: 'var(--jarvis-card)', padding: 10, borderRadius: 6, marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--jarvis-ts)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                Review Notes
              </div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{selected.review_notes}</div>
            </div>
          )}
          <SubmittalReviewPanel submittalId={selected.id} />

          <RelatedPanel source="submittal" id={selected.id} projectId={projectId} />

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            {selected.status === 'draft' && (
              <button
                className="jarvis-btn"
                onClick={() => { handleStatusChange(selected.id, 'submitted'); setShowDetail(false) }}
              >
                Submit for Review
              </button>
            )}
            {(selected.status === 'submitted' || selected.status === 'under_review') && (
              <>
                {selected.status === 'submitted' && (
                  <button
                    className="jarvis-btn"
                    onClick={() => handleStatusChange(selected.id, 'under_review')}
                  >
                    Mark Under Review
                  </button>
                )}
                <button
                  className="jarvis-btn"
                  onClick={() => { setShowDetail(false); openReview(selected) }}
                  style={{ background: 'var(--jarvis-accent)', color: 'var(--jarvis-bg)' }}
                >
                  Stamp Review
                </button>
              </>
            )}
            <button className="jarvis-btn" onClick={() => setShowDetail(false)}>Close</button>
          </div>
        </Modal>
      )}

      {/* Review/Stamp modal */}
      {showReview && selected && (
        <Modal title={`Stamp · ${selected.submittal_number}`} onClose={() => setShowReview(false)}>
          <div style={{ marginBottom: 8, color: 'var(--jarvis-ts)' }}>{selected.title}</div>
          <FormRow label="Disposition">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {(['approved', 'approved_as_noted', 'revise_resubmit', 'rejected'] as const).map(opt => (
                <label key={opt} style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: 8,
                  border: `1px solid ${reviewStatus === opt ? STATUS_COLOR[opt] : 'var(--jarvis-ts)'}`,
                  borderRadius: 4,
                  background: reviewStatus === opt ? 'rgba(255,255,255,0.04)' : 'transparent',
                  cursor: 'pointer',
                }}>
                  <input
                    type="radio"
                    name="reviewStatus"
                    value={opt}
                    checked={reviewStatus === opt}
                    onChange={() => setReviewStatus(opt)}
                  />
                  <span style={{ fontWeight: 600, color: STATUS_COLOR[opt] }}>{STATUS_LABELS[opt]}</span>
                </label>
              ))}
            </div>
          </FormRow>
          <FormRow label="Review Notes">
            <textarea
              className="jarvis-input"
              value={reviewNotes}
              onChange={e => setReviewNotes(e.target.value)}
              rows={5}
              placeholder="Conditions, exceptions, references to spec sections…"
            />
          </FormRow>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="jarvis-btn" onClick={() => setShowReview(false)}>Cancel</button>
            <button
              className="jarvis-btn"
              onClick={handleReview}
              style={{ background: STATUS_COLOR[reviewStatus], color: 'var(--jarvis-bg)' }}
            >
              Apply {STATUS_LABELS[reviewStatus]}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ─── Local UI helpers ───────────────────────────────────────────────────────

function KpiTile({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div style={{
      background: 'var(--jarvis-card)',
      padding: 10,
      borderRadius: 6,
      border: '1px solid rgba(255,255,255,0.05)',
    }}>
      <div style={{
        fontSize: 10,
        color: 'var(--jarvis-ts)',
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
      }}>{label}</div>
      <div style={{
        fontSize: 22,
        fontWeight: 700,
        color: color ?? 'var(--jarvis-accent)',
        fontFamily: 'var(--jarvis-font-mono)',
      }}>{value}</div>
    </div>
  )
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{
        fontSize: 11,
        color: 'var(--jarvis-ts)',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        marginBottom: 4,
      }}>{label}</div>
      {children}
    </div>
  )
}

function KV({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--jarvis-card)', padding: 8, borderRadius: 4 }}>
      <div style={{
        fontSize: 10,
        color: 'var(--jarvis-ts)',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        marginBottom: 2,
      }}>{label}</div>
      <div style={{ fontWeight: 600 }}>{children}</div>
    </div>
  )
}

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div
      role="dialog"
      aria-label={title}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--jarvis-bg)',
          border: '1px solid var(--jarvis-accent)',
          borderRadius: 8,
          padding: 20,
          maxWidth: wide ? 720 : 480,
          width: '100%',
          maxHeight: '90vh',
          overflow: 'auto',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          paddingBottom: 8,
        }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--jarvis-accent)' }}>{title}</div>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: 'var(--jarvis-ts)', fontSize: 20, cursor: 'pointer' }}
            aria-label="Close"
          >×</button>
        </div>
        {children}
      </div>
    </div>
  )
}
