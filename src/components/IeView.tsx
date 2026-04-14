/**
 * JARVIS EPC — IeView · Inspection & Engineering  (v4.28.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * Engineering drawing register linked to Work Inspection Records.
 * Covers the commissioning drawing control workflow:
 *   - Engineering deliverables list (from biz store + API)
 *   - Drawing-to-WIR linkage (which inspection covers which drawing)
 *   - Redline / markup tracking
 *   - As-built status per drawing
 *
 * Data sources:
 *   - biz store: engineering_deliverables, documents
 *   - API: GET /api/v1/projects/:projectId/documents?category=engineering
 *           GET /api/v1/projects/:projectId/wirs
 */

import React, { useState, useMemo, useEffect, useCallback } from 'react'
import { useBizStore, selectProjects, selectDocuments } from '../modules/biz/store'
import { KpiCard }     from './KpiCard'
import { StatusBadge } from './StatusBadge'
import type { PolicyConfig } from '../modules/biz/dispatch'

// ─── Types ────────────────────────────────────────────────────────────────────

interface EngDeliverable {
  id:                 string
  discipline?:        string
  title:              string
  dwg_no?:            string
  rev?:               string
  weight?:            number
  progress?:          number
  status?:            string
  manhours_budget?:   number
  manhours_actual?:   number
  project?:           string
  linked_wirs?:       string[]   // WIR numbers that inspect this drawing
  as_built?:          boolean
  redlines?:          number
}

interface WIRSummary {
  id: string; wir_number: string; title: string; status: string; system_tag?: string
}

export interface IeViewProps {
  policy?:  Partial<PolicyConfig>
  onToast?: (msg: string, type: string) => void
  onAudit?: (entry: unknown) => void
}

const DISCIPLINES = ['Civil','Structural','Mechanical','Electrical','Instrumentation & Controls','Piping','HVAC','Fire Protection','Water Treatment','Wastewater']

const STATUS_BG: Record<string, string> = {
  'not-started': '#F3F4F6', 'in-progress': '#DBEAFE', 'under-review': '#FEF3C7',
  'approved': '#D1FAE5', 'final': '#A7F3D0', 'superseded': '#F3F4F6',
  'draft': '#EDE9FE',
}
const STATUS_FG: Record<string, string> = {
  'not-started': '#6B7280', 'in-progress': '#1D4ED8', 'under-review': '#92400E',
  'approved': '#065F46', 'final': '#065F46', 'superseded': '#9CA3AF',
  'draft': '#5B21B6',
}

// ─── Component ────────────────────────────────────────────────────────────────

export function IeView({ policy: pProp, onToast, onAudit }: IeViewProps) {
  const policy   = { writesEnabled: false, activeRole: 'viewer', ...pProp }
  const canWrite = policy.writesEnabled && policy.activeRole !== 'viewer'

  const projects  = useBizStore(selectProjects) as { id: string; name?: string; code?: string }[]
  const storeDocs = useBizStore(selectDocuments) as Record<string, unknown>[]

  const [selectedProject, setSelectedProject] = useState('')
  const [deliverables,    setDeliverables]    = useState<EngDeliverable[]>([])
  const [wirs,            setWirs]            = useState<WIRSummary[]>([])
  const [loading,         setLoading]         = useState(false)

  // Filters + view state
  const [search,      setSearch]      = useState('')
  const [filterDisc,  setFilterDisc]  = useState('')
  const [filterStatus,setFilterStatus]= useState('')
  const [selected,    setSelected]    = useState<EngDeliverable | null>(null)
  const [activeTab,   setActiveTab]   = useState<'register' | 'matrix'>('register')

  // ── Fetch data ────────────────────────────────────────────────────────────

  const loadData = useCallback(async (projectId: string) => {
    setLoading(true)
    try {
      const [docsRes, wirsRes] = await Promise.all([
        fetch(`/api/v1/projects/${projectId}/documents?category=engineering&limit=200`),
        fetch(`/api/v1/projects/${projectId}/wirs?limit=100`),
      ])

      // Engineering documents → EngDeliverables
      if (docsRes.ok) {
        const d = await docsRes.json()
        const mapped: EngDeliverable[] = (d.documents ?? []).map((doc: Record<string, unknown>) => ({
          id:         String(doc['id'] ?? ''),
          discipline: String(doc['discipline'] ?? doc['category'] ?? ''),
          title:      String(doc['title'] ?? doc['name'] ?? ''),
          dwg_no:     String(doc['dwg_no'] ?? doc['spec_section'] ?? ''),
          rev:        String(doc['version'] ?? doc['rev'] ?? '0'),
          status:     String(doc['status'] ?? 'draft'),
          progress:   doc['progress'] ? Number(doc['progress']) : undefined,
          as_built:   doc['status'] === 'final',
          linked_wirs: (doc['linked_to'] as { ref: string }[] ?? []).filter(l => String(l.ref).startsWith('WIR')).map(l => l.ref),
        }))
        setDeliverables(mapped)
      } else {
        // Fall back to biz store engineering deliverables
        setDeliverables(deriveBizDeliverables(storeDocs, projectId))
      }

      if (wirsRes.ok) {
        const d = await wirsRes.json()
        setWirs((d.wirs ?? []).map((w: Record<string, unknown>) => ({
          id:         String(w['id'] ?? ''),
          wir_number: String(w['wir_number'] ?? ''),
          title:      String(w['title'] ?? ''),
          status:     String(w['status'] ?? 'open'),
          system_tag: w['system_tag'] ? String(w['system_tag']) : undefined,
        })))
      }
    } catch {
      setDeliverables(deriveBizDeliverables(storeDocs, selectedProject))
    } finally {
      setLoading(false)
    }
  }, [storeDocs, selectedProject])

  useEffect(() => { if (selectedProject) loadData(selectedProject) }, [selectedProject, loadData])

  // ── Filtered view ─────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    let rows = deliverables
    if (search)       rows = rows.filter(d =>
      d.title.toLowerCase().includes(search.toLowerCase()) ||
      (d.dwg_no ?? '').toLowerCase().includes(search.toLowerCase()) ||
      (d.discipline ?? '').toLowerCase().includes(search.toLowerCase())
    )
    if (filterDisc)   rows = rows.filter(d => d.discipline === filterDisc)
    if (filterStatus) rows = rows.filter(d => d.status === filterStatus)
    return rows
  }, [deliverables, search, filterDisc, filterStatus])

  // ── KPIs ─────────────────────────────────────────────────────────────────

  const kpis = useMemo(() => {
    const approved  = deliverables.filter(d => d.status === 'approved' || d.status === 'final').length
    const asBuilt   = deliverables.filter(d => d.as_built).length
    const inRev     = deliverables.filter(d => d.status === 'under-review').length
    const linked    = deliverables.filter(d => (d.linked_wirs?.length ?? 0) > 0).length
    const avgProg   = deliverables.length
      ? Math.round(deliverables.reduce((s, d) => s + (d.progress ?? 0), 0) / deliverables.length)
      : 0
    return { total: deliverables.length, approved, asBuilt, inRev, linked, avgProg }
  }, [deliverables])

  // ── Discipline matrix (progress by discipline) ────────────────────────────

  const disciplineMatrix = useMemo(() => {
    const map: Record<string, { total: number; approved: number; inProg: number; avgProgress: number; progs: number[] }> = {}
    for (const d of deliverables) {
      const disc = d.discipline || 'General'
      if (!map[disc]) map[disc] = { total: 0, approved: 0, inProg: 0, avgProgress: 0, progs: [] }
      map[disc].total++
      if (d.status === 'approved' || d.status === 'final') map[disc].approved++
      if (d.status === 'in-progress') map[disc].inProg++
      if (d.progress !== undefined) map[disc].progs.push(d.progress)
    }
    return Object.entries(map).map(([disc, data]) => ({
      discipline: disc, ...data,
      avgProgress: data.progs.length
        ? Math.round(data.progs.reduce((s, p) => s + p, 0) / data.progs.length)
        : Math.round(data.approved / data.total * 100),
    })).sort((a, b) => b.total - a.total)
  }, [deliverables])

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div role="main" aria-label="Inspection & Engineering">

      {/* Project selector */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <select className="jarvis-input" style={{ maxWidth: 360 }} value={selectedProject}
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
          <span className="jarvis-empty-icon">📐</span>
          <span>Select a project to view the engineering drawing register</span>
        </div>
      ) : (
        <>
          {/* KPI strip */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 8, marginBottom: 20 }}>
            <KpiCard label="Total Drawings" value={kpis.total} />
            <KpiCard label="Approved"       value={kpis.approved}  color="var(--jarvis-grn)" />
            <KpiCard label="In Review"      value={kpis.inRev}     color="var(--jarvis-amb)" />
            <KpiCard label="As-Built"       value={kpis.asBuilt}   color="var(--jarvis-blue)" />
            <KpiCard label="WIR Linked"     value={kpis.linked}    color="var(--jarvis-pur)" />
            <KpiCard label="Avg Progress"   value={`${kpis.avgProg}%`} />
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '2px solid var(--jarvis-bd)' }}>
            {(['register','matrix'] as const).map(t => (
              <button key={t} onClick={() => setActiveTab(t)} style={{
                padding: '7px 18px', fontSize: 13, fontWeight: activeTab === t ? 700 : 400,
                background: 'none', border: 'none', cursor: 'pointer', marginBottom: -2,
                borderBottom: activeTab === t ? '2px solid var(--jarvis-ac)' : '2px solid transparent',
                color: activeTab === t ? 'var(--jarvis-ac)' : 'var(--jarvis-ts)',
              }}>
                {t === 'register' ? '📐 Drawing Register' : '📊 Discipline Matrix'}
              </button>
            ))}
          </div>

          {activeTab === 'register' && (
            <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 1.4fr' : '1fr', gap: 20 }}>
              <div>
                {/* Filters */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                  <input className="jarvis-input" style={{ flex: 1, minWidth: 140 }} type="search"
                    placeholder="Search drawings…" value={search} onChange={e => setSearch(e.target.value)} />
                  <select className="jarvis-input" style={{ width: 160 }} value={filterDisc}
                    onChange={e => setFilterDisc(e.target.value)}>
                    <option value="">All disciplines</option>
                    {DISCIPLINES.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                  <select className="jarvis-input" style={{ width: 130 }} value={filterStatus}
                    onChange={e => setFilterStatus(e.target.value)}>
                    <option value="">All status</option>
                    {['draft','in-progress','under-review','approved','final','superseded'].map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>

                {/* Drawing table */}
                {filtered.length === 0 ? (
                  <div className="jarvis-empty">
                    <span className="jarvis-empty-icon">📐</span>
                    <span>{search || filterDisc || filterStatus ? 'No drawings match your filters' : 'No engineering documents found for this project'}</span>
                  </div>
                ) : (
                  <div className="jarvis-scroll-y jarvis-max-h-lg">
                    <table className="jarvis-table" aria-label="Drawing register">
                      <thead>
                        <tr><th>Dwg No.</th><th>Title</th><th>Disc.</th><th>Rev</th><th>Progress</th><th>Status</th><th>WIRs</th></tr>
                      </thead>
                      <tbody>
                        {filtered.map(d => (
                          <tr key={d.id} onClick={() => setSelected(selected?.id === d.id ? null : d)}
                            style={{ cursor: 'pointer', background: selected?.id === d.id ? 'var(--jarvis-bg2)' : undefined }}>
                            <td style={{ fontFamily: 'var(--jarvis-font-mono)', fontSize: 11, whiteSpace: 'nowrap' }}>
                              {d.dwg_no || '—'}
                            </td>
                            <td style={{ fontWeight: 600, maxWidth: 200 }}>{d.title}</td>
                            <td style={{ fontSize: 11 }}>{d.discipline?.split(' ')[0] ?? '—'}</td>
                            <td style={{ fontFamily: 'var(--jarvis-font-mono)', fontSize: 11, textAlign: 'center' }}>
                              {d.rev ?? '0'}
                            </td>
                            <td>
                              {d.progress !== undefined ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <div style={{ width: 50, height: 6, background: 'var(--jarvis-bd)', borderRadius: 3 }}>
                                    <div style={{ width: `${d.progress}%`, height: '100%', borderRadius: 3, background: 'var(--jarvis-ac)' }} />
                                  </div>
                                  <span style={{ fontSize: 10 }}>{d.progress}%</span>
                                </div>
                              ) : '—'}
                            </td>
                            <td>
                              <span style={{
                                fontSize: 10, padding: '1px 7px', borderRadius: 10, fontWeight: 600,
                                background: STATUS_BG[d.status ?? 'draft'] ?? '#F3F4F6',
                                color:      STATUS_FG[d.status ?? 'draft'] ?? '#6B7280',
                              }}>
                                {d.status ?? 'draft'}
                              </span>
                            </td>
                            <td style={{ fontSize: 11 }}>
                              {(d.linked_wirs?.length ?? 0) > 0
                                ? <span style={{ color: 'var(--jarvis-blue)', fontWeight: 600 }}>{d.linked_wirs!.length}</span>
                                : <span style={{ color: 'var(--jarvis-ts)' }}>—</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Drawing detail panel */}
              {selected && (
                <div className="jarvis-card" style={{ padding: 20, alignSelf: 'start' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                    <div>
                      <div style={{ fontFamily: 'var(--jarvis-font-mono)', fontSize: 11, color: 'var(--jarvis-ts)', marginBottom: 4 }}>
                        {selected.dwg_no ? `DWG ${selected.dwg_no} · Rev ${selected.rev ?? '0'}` : `Rev ${selected.rev ?? '0'}`}
                      </div>
                      <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{selected.title}</h3>
                    </div>
                    <button className="jarvis-btn jarvis-btn-ghost" style={{ fontSize: 12, padding: '4px 10px' }}
                      onClick={() => setSelected(null)}>✕</button>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16, fontSize: 12 }}>
                    {[
                      ['Discipline', selected.discipline ?? '—'],
                      ['Status', selected.status ?? '—'],
                      ['Revision', selected.rev ?? '0'],
                      ['As-Built', selected.as_built ? '✓ Yes' : 'No'],
                      ['Budget Hours', selected.manhours_budget ? `${selected.manhours_budget}h` : '—'],
                      ['Actual Hours', selected.manhours_actual ? `${selected.manhours_actual}h` : '—'],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <span style={{ color: 'var(--jarvis-ts)', fontSize: 10, display: 'block' }}>{label}</span>
                        <span style={{ fontWeight: 600 }}>{value}</span>
                      </div>
                    ))}
                  </div>

                  {selected.progress !== undefined && (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12 }}>
                        <span style={{ fontWeight: 600 }}>Design Progress</span>
                        <span>{selected.progress}%</span>
                      </div>
                      <div style={{ height: 10, background: 'var(--jarvis-bd)', borderRadius: 5 }}>
                        <div style={{ width: `${selected.progress}%`, height: '100%', borderRadius: 5, background: 'var(--jarvis-ac)', transition: 'width 0.4s' }} />
                      </div>
                    </div>
                  )}

                  {/* Linked WIRs */}
                  <div>
                    <h4 className="jarvis-label" style={{ marginBottom: 10 }}>
                      Linked Inspection Records
                      {(selected.linked_wirs?.length ?? 0) === 0 && (
                        <span className="jarvis-small" style={{ color: 'var(--jarvis-ts)', fontWeight: 400, marginLeft: 8 }}>
                          None — link WIRs to track inspection of this drawing
                        </span>
                      )}
                    </h4>
                    {(selected.linked_wirs ?? []).length > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {selected.linked_wirs!.map(wirNum => {
                          const wir = wirs.find(w => w.wir_number === wirNum)
                          return (
                            <div key={wirNum} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: 'var(--jarvis-bg2)', borderRadius: 6 }}>
                              <span style={{ fontFamily: 'var(--jarvis-font-mono)', fontSize: 11, color: 'var(--jarvis-ts)' }}>
                                {wirNum}
                              </span>
                              <span style={{ flex: 1, fontSize: 12, fontWeight: 600 }}>
                                {wir?.title ?? wirNum}
                              </span>
                              {wir && <StatusBadge status={wir.status} />}
                            </div>
                          )
                        })}
                      </div>
                    ) : (
                      <div style={{ color: 'var(--jarvis-ts)', fontSize: 12 }}>
                        {wirs.length > 0 ? (
                          <div>
                            <div style={{ marginBottom: 6 }}>Available WIRs to link:</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                              {wirs.slice(0, 8).map(w => (
                                <span key={w.id} style={{
                                  fontSize: 10, padding: '2px 8px', borderRadius: 12,
                                  background: 'var(--jarvis-bd)', cursor: canWrite ? 'pointer' : 'default',
                                  fontFamily: 'var(--jarvis-font-mono)',
                                }}>
                                  {w.wir_number}
                                </span>
                              ))}
                            </div>
                          </div>
                        ) : 'No WIRs in this project'}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Discipline matrix tab */}
          {activeTab === 'matrix' && (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
                {disciplineMatrix.map(d => (
                  <div key={d.discipline} className="jarvis-card" style={{ padding: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12, alignItems: 'flex-start' }}>
                      <h4 style={{ margin: 0, fontSize: 13, fontWeight: 700 }}>{d.discipline}</h4>
                      <span style={{ fontSize: 11, color: 'var(--jarvis-ts)' }}>{d.total} dwgs</span>
                    </div>
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 12 }}>
                        <span>Overall Progress</span>
                        <span style={{ fontWeight: 700 }}>{d.avgProgress}%</span>
                      </div>
                      <div style={{ height: 10, background: 'var(--jarvis-bd)', borderRadius: 5 }}>
                        <div style={{
                          width: `${d.avgProgress}%`, height: '100%', borderRadius: 5,
                          background: d.avgProgress >= 80 ? 'var(--jarvis-grn)' : d.avgProgress >= 50 ? 'var(--jarvis-ac)' : 'var(--jarvis-amb)',
                          transition: 'width 0.4s',
                        }} />
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 11 }}>
                      <div style={{ textAlign: 'center', padding: '6px 0', background: '#D1FAE5', borderRadius: 6 }}>
                        <div style={{ fontWeight: 700, color: '#065F46', fontSize: 16 }}>{d.approved}</div>
                        <div style={{ color: '#065F46' }}>Approved</div>
                      </div>
                      <div style={{ textAlign: 'center', padding: '6px 0', background: '#DBEAFE', borderRadius: 6 }}>
                        <div style={{ fontWeight: 700, color: '#1D4ED8', fontSize: 16 }}>{d.inProg}</div>
                        <div style={{ color: '#1D4ED8' }}>In Progress</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {disciplineMatrix.length === 0 && (
                <div className="jarvis-empty">
                  <span className="jarvis-empty-icon">📐</span>
                  <span>No engineering documents found for this project</span>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── Biz store fallback ───────────────────────────────────────────────────────

function deriveBizDeliverables(docs: Record<string, unknown>[], projectId: string): EngDeliverable[] {
  return docs
    .filter(d => !projectId || d['project'] === projectId || String(d['project'] ?? '').includes(projectId))
    .map(d => ({
      id:         String(d['id'] ?? Math.random()),
      discipline: String(d['discipline'] ?? d['category'] ?? ''),
      title:      String(d['title'] ?? d['name'] ?? ''),
      dwg_no:     String(d['dwg_no'] ?? d['spec_section'] ?? ''),
      rev:        String(d['version'] ?? d['rev'] ?? '0'),
      status:     String(d['status'] ?? 'draft'),
      progress:   d['progress'] ? Number(d['progress']) : undefined,
      linked_wirs: [],
      as_built:   d['status'] === 'final',
    }))
}

export default IeView
