/**
 * JARVIS EPC — InView · Inspection Notes  (v4.28.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * Work Inspection Record (WIR) management backed by the wirs table.
 *
 * Features:
 *   - WIR list with discipline / system tag / status filters
 *   - WIR detail panel: punch item list, test data fields, result notes
 *   - Create WIR with required-by date, discipline, inspection type
 *   - Status workflow: open → scheduled → in_progress → completed / rejected
 *   - Punch item add/close within each WIR
 *   - KPI strip: total / open / scheduled / completed / punch items outstanding
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { useBizStore, selectProjects } from '../modules/biz/store'
import { KpiCard }     from './KpiCard'
import { StatusBadge } from './StatusBadge'
import type { PolicyConfig } from '../modules/biz/dispatch'

// ─── Types ────────────────────────────────────────────────────────────────────

interface PunchItem {
  id: string; description: string; severity: 'A' | 'B' | 'C'; status: 'open' | 'closed'
  assigned?: string; due?: string; notes?: string
}

interface WIR {
  id:              string
  wir_number:      string
  title:           string
  discipline?:     string
  system_tag?:     string
  status:          string
  inspection_type?:string
  required_by?:    string
  scheduled_at?:   string
  completed_at?:   string
  punch_items:     PunchItem[]
  test_data:       Record<string, string>
  result_notes?:   string
  created_at:      string
}

export interface InViewProps {
  policy?:  Partial<PolicyConfig>
  onToast?: (msg: string, type: string) => void
  onAudit?: (entry: unknown) => void
}

const WIR_STATUSES = ['open','scheduled','in_progress','completed','rejected']
const DISCIPLINES  = ['Civil','Structural','Mechanical','Electrical','Instrumentation & Controls','Piping','HVAC','Fire Protection','Water Treatment','Wastewater','General']
const INSP_TYPES   = ['Visual Inspection','Hydrostatic Test','Pneumatic Test','Functional Test','Loop Check','Continuity Check','Insulation Test','Calibration','Commissioning Check','Pre-startup Check']

const STATUS_COLOR: Record<string, string> = {
  open: 'var(--jarvis-ts)', scheduled: 'var(--jarvis-blue)', in_progress: 'var(--jarvis-amb)',
  completed: 'var(--jarvis-grn)', rejected: 'var(--jarvis-red)',
}

const EMPTY_WIR = {
  title: '', discipline: '', system_tag: '', inspection_type: '', required_by: '',
}

const EMPTY_PUNCH = { description: '', severity: 'B' as const, assigned: '', due: '' }

// ─── Component ────────────────────────────────────────────────────────────────

export function InView({ policy: pProp, onToast, onAudit }: InViewProps) {
  const policy   = { writesEnabled: false, activeRole: 'viewer', ...pProp }
  const canWrite = policy.writesEnabled && policy.activeRole !== 'viewer'

  const projects = useBizStore(selectProjects) as { id: string; name?: string; code?: string }[]
  const [selectedProject, setSelectedProject] = useState('')

  const [wirs,     setWirs]     = useState<WIR[]>([])
  const [loading,  setLoading]  = useState(false)
  const [selected, setSelected] = useState<WIR | null>(null)

  // Filters
  const [filterStatus, setFilterStatus] = useState('')
  const [filterDisc,   setFilterDisc]   = useState('')
  const [search,       setSearch]       = useState('')

  // Add WIR form
  const [showAdd,  setShowAdd]  = useState(false)
  const [wirForm,  setWirForm]  = useState({ ...EMPTY_WIR })
  const [saving,   setSaving]   = useState(false)

  // Add punch item
  const [showPunch,  setShowPunch]  = useState(false)
  const [punchForm,  setPunchForm]  = useState({ ...EMPTY_PUNCH })

  // ── Fetch WIRs ──────────────────────────────────────────────────────────────

  const loadWIRs = useCallback(async (projectId: string) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: '100' })
      if (filterStatus) params.set('status', filterStatus)
      if (filterDisc)   params.set('discipline', filterDisc)
      const res = await fetch(`/api/v1/projects/${projectId}/wirs?${params}`)
      if (res.ok) { const d = await res.json(); setWirs(d.wirs ?? []) }
    } catch { setWirs([]) }
    finally  { setLoading(false) }
  }, [filterStatus, filterDisc])

  useEffect(() => { if (selectedProject) loadWIRs(selectedProject) }, [selectedProject, loadWIRs])

  // ── Filtered list ─────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    if (!search) return wirs
    const q = search.toLowerCase()
    return wirs.filter(w =>
      w.title.toLowerCase().includes(q) ||
      (w.wir_number ?? '').toLowerCase().includes(q) ||
      (w.system_tag ?? '').toLowerCase().includes(q) ||
      (w.discipline ?? '').toLowerCase().includes(q)
    )
  }, [wirs, search])

  // ── KPIs ─────────────────────────────────────────────────────────────────

  const kpis = useMemo(() => {
    const allPunch = wirs.flatMap(w => w.punch_items ?? [])
    return {
      total:      wirs.length,
      open:       wirs.filter(w => w.status === 'open').length,
      scheduled:  wirs.filter(w => w.status === 'scheduled').length,
      completed:  wirs.filter(w => w.status === 'completed').length,
      punch_open: allPunch.filter(p => p.status === 'open').length,
    }
  }, [wirs])

  // ── Create WIR ────────────────────────────────────────────────────────────

  async function handleCreateWIR() {
    if (!wirForm.title || !selectedProject) {
      onToast?.('Select a project and enter a title', 'error'); return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/v1/projects/${selectedProject}/wirs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...wirForm, punch_items: [], test_data: {} }),
      })
      if (res.ok) {
        onToast?.('WIR created', 'success')
        onAudit?.({ action: 'add_wir', data: wirForm })
        setWirForm({ ...EMPTY_WIR }); setShowAdd(false)
        await loadWIRs(selectedProject)
      } else {
        const e = await res.json(); onToast?.(e.error ?? 'Create failed', 'error')
      }
    } finally { setSaving(false) }
  }

  // ── Add punch item ────────────────────────────────────────────────────────

  async function handleAddPunch() {
    if (!selected || !punchForm.description) return
    const newPunch: PunchItem = {
      id: `PI-${Date.now()}`, ...punchForm, status: 'open',
    }
    const updated = { punch_items: [...(selected.punch_items ?? []), newPunch] }
    try {
      const res = await fetch(`/api/v1/wirs/${selected.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      })
      if (res.ok) {
        const d = await res.json()
        setSelected(d.wir)
        setWirs(w => w.map(x => x.id === selected.id ? d.wir : x))
        setPunchForm({ ...EMPTY_PUNCH }); setShowPunch(false)
        onToast?.('Punch item added', 'success')
      }
    } catch { onToast?.('Failed to add punch item', 'error') }
  }

  // ── Status advance ────────────────────────────────────────────────────────

  async function advanceStatus(wir: WIR) {
    const idx  = WIR_STATUSES.indexOf(wir.status)
    const next = WIR_STATUSES[idx + 1]
    if (!next || next === 'rejected') return
    try {
      const res = await fetch(`/api/v1/wirs/${wir.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next, ...(next === 'completed' ? { completed_at: new Date().toISOString() } : {}) }),
      })
      if (res.ok) {
        const d = await res.json()
        setWirs(w => w.map(x => x.id === wir.id ? d.wir : x))
        if (selected?.id === wir.id) setSelected(d.wir)
        onToast?.(`WIR status → ${next}`, 'success')
      }
    } catch { onToast?.('Failed to update status', 'error') }
  }

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div role="main" aria-label="Inspection Notes">

      {/* Project selector */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <select className="jarvis-input" style={{ maxWidth: 320 }} value={selectedProject}
          onChange={e => { setSelectedProject(e.target.value); setSelected(null) }}
          aria-label="Select project">
          <option value="">— Select project —</option>
          {projects.map(p => (
            <option key={p.id} value={p.id}>{p.code ? `[${p.code}] ` : ''}{p.name ?? p.id}</option>
          ))}
        </select>
        {loading && <span className="jarvis-small" style={{ color: 'var(--jarvis-ts)' }}>Loading…</span>}
      </div>

      {!selectedProject ? (
        <div className="jarvis-empty">
          <span className="jarvis-empty-icon">🔍</span>
          <span>Select a project to view and manage Work Inspection Records</span>
        </div>
      ) : (
        <>
          {/* KPI strip */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 8, marginBottom: 20 }}>
            <KpiCard label="Total WIRs"    value={kpis.total} />
            <KpiCard label="Open"          value={kpis.open}      color={kpis.open > 0 ? 'var(--jarvis-amb)' : 'var(--jarvis-grn)'} />
            <KpiCard label="Scheduled"     value={kpis.scheduled} color="var(--jarvis-blue)" />
            <KpiCard label="Completed"     value={kpis.completed} color="var(--jarvis-grn)" />
            <KpiCard label="Open Punches"  value={kpis.punch_open} color={kpis.punch_open > 0 ? 'var(--jarvis-red)' : 'var(--jarvis-grn)'} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 1.5fr' : '1fr', gap: 20 }}>

            {/* WIR list panel */}
            <div>
              {/* Toolbar */}
              <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
                <input className="jarvis-input" style={{ flex: 1, minWidth: 120 }} type="search"
                  placeholder="Search WIRs…" value={search} onChange={e => setSearch(e.target.value)} />
                <select className="jarvis-input" style={{ width: 110 }} value={filterStatus}
                  onChange={e => setFilterStatus(e.target.value)}>
                  <option value="">All status</option>
                  {WIR_STATUSES.map(s => <option key={s} value={s}>{s.replace('_',' ')}</option>)}
                </select>
                <select className="jarvis-input" style={{ width: 140 }} value={filterDisc}
                  onChange={e => setFilterDisc(e.target.value)}>
                  <option value="">All disciplines</option>
                  {DISCIPLINES.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
                {canWrite && (
                  <button className="jarvis-btn jarvis-btn-primary" onClick={() => setShowAdd(v => !v)}>
                    + WIR
                  </button>
                )}
              </div>

              {/* Add WIR form */}
              {showAdd && canWrite && (
                <div className="jarvis-card" style={{ padding: 16, marginBottom: 12 }}>
                  <h4 className="jarvis-label" style={{ marginBottom: 12 }}>New Work Inspection Record</h4>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                    {([['title','WIR Title *'],['system_tag','System / Tag No.']] as [string,string][]).map(([k,l]) => (
                      <div key={k}>
                        <label className="jarvis-small" htmlFor={`wir-${k}`}>{l}</label>
                        <input id={`wir-${k}`} className="jarvis-input" value={(wirForm as Record<string,string>)[k]}
                          onChange={e => setWirForm(f => ({...f,[k]:e.target.value}))} />
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 14 }}>
                    <div>
                      <label className="jarvis-small" htmlFor="wir-disc">Discipline</label>
                      <select id="wir-disc" className="jarvis-input" value={wirForm.discipline}
                        onChange={e => setWirForm(f => ({...f, discipline: e.target.value}))}>
                        <option value="">— Select —</option>
                        {DISCIPLINES.map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="jarvis-small" htmlFor="wir-type">Inspection Type</label>
                      <select id="wir-type" className="jarvis-input" value={wirForm.inspection_type}
                        onChange={e => setWirForm(f => ({...f, inspection_type: e.target.value}))}>
                        <option value="">— Select —</option>
                        {INSP_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="jarvis-small" htmlFor="wir-req">Required By</label>
                      <input id="wir-req" className="jarvis-input" type="date" value={wirForm.required_by}
                        onChange={e => setWirForm(f => ({...f, required_by: e.target.value}))} />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="jarvis-btn jarvis-btn-primary" onClick={handleCreateWIR} disabled={saving || !wirForm.title}>
                      {saving ? 'Saving…' : 'Create WIR'}
                    </button>
                    <button className="jarvis-btn jarvis-btn-ghost" onClick={() => { setShowAdd(false); setWirForm({...EMPTY_WIR}) }}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* WIR list */}
              {filtered.length === 0 ? (
                <div className="jarvis-empty">
                  <span className="jarvis-empty-icon">📋</span>
                  <span>{search ? 'No WIRs match' : 'No inspection records yet'}</span>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {filtered.map(wir => {
                    const openPunch = (wir.punch_items ?? []).filter(p => p.status === 'open').length
                    const isActive  = selected?.id === wir.id
                    return (
                      <div
                        key={wir.id}
                        className="jarvis-card"
                        onClick={() => setSelected(isActive ? null : wir)}
                        style={{
                          padding: '12px 14px', cursor: 'pointer',
                          border: isActive ? '2px solid var(--jarvis-ac)' : '1px solid var(--jarvis-bd)',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                          <div>
                            <span style={{ fontFamily: 'var(--jarvis-font-mono)', fontSize: 11, color: 'var(--jarvis-ts)', marginRight: 8 }}>
                              {wir.wir_number}
                            </span>
                            <span style={{ fontWeight: 600, fontSize: 13 }}>{wir.title}</span>
                          </div>
                          <StatusBadge status={wir.status} />
                        </div>
                        <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--jarvis-ts)', flexWrap: 'wrap' }}>
                          {wir.discipline    && <span>📐 {wir.discipline}</span>}
                          {wir.system_tag    && <span>🏷 {wir.system_tag}</span>}
                          {wir.inspection_type && <span>🔍 {wir.inspection_type}</span>}
                          {wir.required_by   && <span>📅 Due {wir.required_by}</span>}
                          {openPunch > 0     && <span style={{ color: 'var(--jarvis-red)', fontWeight: 700 }}>⚠ {openPunch} open punch{openPunch !== 1 ? 'es' : ''}</span>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* WIR detail panel */}
            {selected && (
              <div className="jarvis-card" style={{ padding: 20, alignSelf: 'start' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                  <div>
                    <div style={{ fontFamily: 'var(--jarvis-font-mono)', fontSize: 11, color: 'var(--jarvis-ts)', marginBottom: 4 }}>
                      {selected.wir_number}
                    </div>
                    <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{selected.title}</h3>
                  </div>
                  <button className="jarvis-btn jarvis-btn-ghost" style={{ fontSize: 12, padding: '4px 10px' }}
                    onClick={() => setSelected(null)}>✕</button>
                </div>

                {/* Status workflow */}
                <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
                  {WIR_STATUSES.map(s => {
                    const isActive = selected.status === s
                    const isPast   = WIR_STATUSES.indexOf(s) < WIR_STATUSES.indexOf(selected.status)
                    return (
                      <div key={s} style={{
                        padding: '4px 10px', borderRadius: 12, fontSize: 10, fontWeight: isActive ? 700 : 400,
                        background: isActive ? STATUS_COLOR[s] : isPast ? '#D1FAE5' : 'var(--jarvis-bd)',
                        color: isActive ? '#fff' : isPast ? '#065F46' : 'var(--jarvis-ts)',
                        textTransform: 'capitalize',
                      }}>
                        {s.replace('_',' ')}
                      </div>
                    )
                  })}
                  {canWrite && selected.status !== 'completed' && selected.status !== 'rejected' && (
                    <button className="jarvis-btn jarvis-btn-primary" style={{ fontSize: 11, padding: '3px 12px' }}
                      onClick={() => advanceStatus(selected)}>
                      Advance Status →
                    </button>
                  )}
                </div>

                {/* Metadata grid */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16, fontSize: 12 }}>
                  {[
                    ['Discipline', selected.discipline ?? '—'],
                    ['System / Tag', selected.system_tag ?? '—'],
                    ['Inspection Type', selected.inspection_type ?? '—'],
                    ['Required By', selected.required_by ?? '—'],
                    ['Scheduled', selected.scheduled_at ? new Date(selected.scheduled_at).toLocaleDateString() : '—'],
                    ['Completed', selected.completed_at ? new Date(selected.completed_at).toLocaleDateString() : '—'],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <span style={{ color: 'var(--jarvis-ts)', fontSize: 10, display: 'block' }}>{label}</span>
                      <span style={{ fontWeight: 600 }}>{value}</span>
                    </div>
                  ))}
                </div>

                {/* Result notes */}
                {selected.result_notes && (
                  <div style={{ marginBottom: 16, padding: 10, background: 'var(--jarvis-bg2)', borderRadius: 6, fontSize: 12 }}>
                    <div style={{ fontSize: 10, color: 'var(--jarvis-ts)', marginBottom: 4 }}>RESULT NOTES</div>
                    <div>{selected.result_notes}</div>
                  </div>
                )}

                {/* Punch items */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <h4 className="jarvis-label" style={{ margin: 0 }}>
                      Punch Items ({(selected.punch_items ?? []).filter(p => p.status === 'open').length} open)
                    </h4>
                    {canWrite && (
                      <button className="jarvis-btn jarvis-btn-primary" style={{ fontSize: 11, padding: '3px 10px' }}
                        onClick={() => setShowPunch(v => !v)}>
                        + Punch
                      </button>
                    )}
                  </div>

                  {showPunch && canWrite && (
                    <div style={{ background: 'var(--jarvis-bg2)', borderRadius: 6, padding: 12, marginBottom: 12 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
                        <div>
                          <label className="jarvis-small">Description</label>
                          <input className="jarvis-input" value={punchForm.description}
                            onChange={e => setPunchForm(f => ({...f, description: e.target.value}))} />
                        </div>
                        <div>
                          <label className="jarvis-small">Severity (A/B/C)</label>
                          <select className="jarvis-input" value={punchForm.severity}
                            onChange={e => setPunchForm(f => ({...f, severity: e.target.value as 'A'|'B'|'C'}))}>
                            <option value="A">A — Critical</option>
                            <option value="B">B — Major</option>
                            <option value="C">C — Minor</option>
                          </select>
                        </div>
                        <div>
                          <label className="jarvis-small">Assigned To</label>
                          <input className="jarvis-input" value={punchForm.assigned}
                            onChange={e => setPunchForm(f => ({...f, assigned: e.target.value}))} />
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="jarvis-btn jarvis-btn-primary" onClick={handleAddPunch} disabled={!punchForm.description}>
                          Add Punch
                        </button>
                        <button className="jarvis-btn jarvis-btn-ghost" onClick={() => { setShowPunch(false); setPunchForm({...EMPTY_PUNCH}) }}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {(selected.punch_items ?? []).length === 0 ? (
                    <div style={{ color: 'var(--jarvis-ts)', fontSize: 12, padding: '8px 0' }}>No punch items</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {(selected.punch_items ?? []).map(p => (
                        <div key={p.id} style={{
                          display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                          background: p.status === 'closed' ? 'var(--jarvis-bg2)' : 'rgba(255,0,0,0.04)',
                          borderRadius: 6, fontSize: 12, opacity: p.status === 'closed' ? 0.6 : 1,
                        }}>
                          <span style={{
                            fontWeight: 700, fontSize: 10, padding: '2px 6px', borderRadius: 3,
                            background: p.severity === 'A' ? '#FEE2E2' : p.severity === 'B' ? '#FEF3C7' : '#D1FAE5',
                            color: p.severity === 'A' ? '#991B1B' : p.severity === 'B' ? '#92400E' : '#065F46',
                          }}>
                            {p.severity}
                          </span>
                          <span style={{ flex: 1, textDecoration: p.status === 'closed' ? 'line-through' : 'none' }}>
                            {p.description}
                          </span>
                          {p.assigned && <span style={{ color: 'var(--jarvis-ts)', fontSize: 11 }}>{p.assigned}</span>}
                          <StatusBadge status={p.status} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

export default InView
