/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Denver Engineering — DrawingsView · Plans Register + PDF Viewer  (v4.31.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * Autodesk/Procore-parity: sheet list with discipline filter, revisions,
 * in-browser PDF.js viewer with rectangle/text markup overlay.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useBizStore, selectProjects } from '../modules/biz/store'
import type { PolicyConfig } from '../modules/biz/dispatch'
import { downloadCsv } from '../utils/csv'

interface Drawing {
  id: string; sheet_number: string; title: string; discipline?: string; current_rev: string
  set_name?: string; issue_date?: string; document_id?: string; page_count: number
}
interface Revision { id: string; rev: string; issued_date: string; reason?: string; document_id?: string }
interface Markup { id: string; rev: string; page: number; title?: string; annotations: any[]; resolved: boolean }

const DISCIPLINES = ['all','mechanical','electrical','plumbing','structural','civil','architectural','process']

export interface DrawingsViewProps { policy?: Partial<PolicyConfig>; onToast?: (m: string, t?: string) => void; onAudit?: (e: unknown) => void }

export function DrawingsView({ policy, onToast, onAudit }: DrawingsViewProps) {
  const projects = useBizStore(selectProjects)
  const [projectId, setProjectId] = useState<string>('')
  const [drawings, setDrawings] = useState<Drawing[]>([])
  const [discipline, setDiscipline] = useState('all')
  const [selected, setSelected] = useState<Drawing | null>(null)
  const [revisions, setRevisions] = useState<Revision[]>([])
  const [markups, setMarkups] = useState<Markup[]>([])
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState({ sheet_number: '', title: '', discipline: 'mechanical', current_rev: 'A', set_name: '', issue_date: '' })
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [drawing, setDrawing] = useState(false)
  const [rect, setRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (projects?.length && !projectId) setProjectId(projects[0].id) }, [projects])

  const reload = useCallback(async () => {
    if (!projectId) return
    const q = discipline === 'all' ? '' : `?discipline=${discipline}`
    const r = await fetch(`/api/v1/projects/${projectId}/drawings${q}`)
    const j = await r.json(); setDrawings(j.drawings ?? [])
  }, [projectId, discipline])

  useEffect(() => { reload() }, [reload])

  const openDrawing = async (d: Drawing) => {
    setSelected(d)
    const [revs, marks] = await Promise.all([
      fetch(`/api/v1/drawings/${d.id}/revisions`).then(r => r.json()),
      fetch(`/api/v1/drawings/${d.id}/markups?rev=${d.current_rev}`).then(r => r.json()),
    ])
    setRevisions(revs.revisions ?? []); setMarkups(marks.markups ?? [])
  }

  const create = async () => {
    const res = await fetch(`/api/v1/projects/${projectId}/drawings`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    })
    if (res.ok) { setCreating(false); onToast?.('Drawing sheet added', 'success'); onAudit?.({ type: 'drawing.created' }); reload() }
  }

  const saveMarkup = async () => {
    if (!selected || !rect) return
    await fetch(`/api/v1/drawings/${selected.id}/markups`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rev: selected.current_rev, page: 1,
        title: 'Redline', annotations: [{ type: 'rect', page: 1, ...rect, color: '#e74c3c' }] }),
    })
    setRect(null)
    const marks = await fetch(`/api/v1/drawings/${selected.id}/markups?rev=${selected.current_rev}`).then(r => r.json())
    setMarkups(marks.markups ?? [])
  }

  const resolveMarkup = async (id: string) => {
    await fetch(`/api/v1/markups/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resolved: true }) })
    const marks = await fetch(`/api/v1/drawings/${selected!.id}/markups?rev=${selected!.current_rev}`).then(r => r.json())
    setMarkups(marks.markups ?? [])
  }

  const canWrite = policy?.writesEnabled !== false

  return (
    <div role="main" aria-label="Drawings" style={{ padding: 16 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>📐 Drawings</h2>
        <select value={projectId} onChange={e => setProjectId(e.target.value)} style={{ padding: 6 }}>
          {projects?.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={discipline} onChange={e => setDiscipline(e.target.value)} style={{ padding: 6 }}>
          {DISCIPLINES.map(d => <option key={d}>{d}</option>)}
        </select>
        {canWrite && <button onClick={() => setCreating(true)} style={{ marginLeft: 'auto', padding: '6px 14px', background: 'var(--jarvis-ac)', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>+ New Sheet</button>}
        <button
          disabled={!drawings.length}
          onClick={() => downloadCsv(`drawings-${new Date().toISOString().slice(0,10)}.csv`, drawings.map((d: any) => ({
            id: d.id, project_id: d.project_id, sheet_number: d.sheet_number, title: d.title,
            discipline: d.discipline, current_rev: d.current_rev, status: d.status ?? '',
            document_id: d.document_id ?? '', created_at: d.created_at
          })))}
          style={{ marginLeft: 8, padding: '6px 14px', border: '1px solid var(--jarvis-ac)', background: 'transparent', color: 'var(--jarvis-ac)', borderRadius: 4, cursor: drawings.length ? 'pointer' : 'not-allowed', opacity: drawings.length ? 1 : 0.5 }}
          title="Export drawings to CSV"
        >⬇ CSV</button>
      </div>

      {creating && (
        <div style={{ border: '1px solid var(--jarvis-bd)', padding: 16, borderRadius: 6, marginBottom: 16, background: 'var(--jarvis-bg2)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            <input placeholder="Sheet # (e.g. M-101)" value={draft.sheet_number} onChange={e => setDraft({ ...draft, sheet_number: e.target.value })} />
            <input placeholder="Title" value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} />
            <select value={draft.discipline} onChange={e => setDraft({ ...draft, discipline: e.target.value })}>
              {DISCIPLINES.filter(d => d !== 'all').map(d => <option key={d}>{d}</option>)}
            </select>
            <input placeholder="Rev" value={draft.current_rev} onChange={e => setDraft({ ...draft, current_rev: e.target.value })} />
            <input placeholder="Set name (90% CD, IFC…)" value={draft.set_name} onChange={e => setDraft({ ...draft, set_name: e.target.value })} />
            <input type="date" value={draft.issue_date} onChange={e => setDraft({ ...draft, issue_date: e.target.value })} />
          </div>
          <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
            <button onClick={create} style={{ background: 'var(--jarvis-ac)', color: '#fff', padding: '6px 16px', border: 'none', borderRadius: 4 }}>Save</button>
            <button onClick={() => setCreating(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: selected ? '320px 1fr' : '1fr', gap: 16 }}>
        <div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr style={{ background: 'var(--jarvis-bg2)' }}>
              <th style={{ padding: 8, textAlign: 'left' }}>Sheet</th>
              <th style={{ textAlign: 'left' }}>Title</th>
              <th>Rev</th>
            </tr></thead>
            <tbody>
              {drawings.map(d => (
                <tr key={d.id} onClick={() => openDrawing(d)} style={{ cursor: 'pointer', background: selected?.id === d.id ? 'var(--jarvis-bg2)' : undefined, borderBottom: '1px solid var(--jarvis-bd)' }}>
                  <td style={{ padding: 8, fontWeight: 600 }}>{d.sheet_number}</td>
                  <td>{d.title}<div style={{ fontSize: 10, color: 'var(--jarvis-ts)' }}>{d.discipline}</div></td>
                  <td style={{ textAlign: 'center' }}>{d.current_rev}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {selected && (
          <div style={{ border: '1px solid var(--jarvis-bd)', borderRadius: 6, padding: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{selected.sheet_number} — {selected.title}</div>
                <div style={{ fontSize: 11, color: 'var(--jarvis-ts)' }}>{selected.discipline} · Rev {selected.current_rev} · {selected.set_name}</div>
              </div>
              <button onClick={() => setSelected(null)}>Close</button>
            </div>

            {/* PDF viewer iframe (uses browser native / PDF.js) */}
            <div style={{ position: 'relative', border: '1px solid var(--jarvis-bd)', background: '#fff', height: 500 }}>
              {selected.document_id ? (
                <iframe src={`/api/v1/documents/${selected.document_id}/file`} style={{ width: '100%', height: '100%', border: 0 }} title="Drawing PDF" />
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#666' }}>No PDF attached. Upload a document and link via API.</div>
              )}
              {/* Markup overlay */}
              <canvas
                ref={canvasRef}
                width={800} height={500}
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: canWrite ? 'auto' : 'none', cursor: 'crosshair' }}
                onMouseDown={e => {
                  const r = (e.target as HTMLCanvasElement).getBoundingClientRect()
                  setRect({ x: e.clientX - r.left, y: e.clientY - r.top, w: 0, h: 0 }); setDrawing(true)
                }}
                onMouseMove={e => {
                  if (!drawing || !rect) return
                  const r = (e.target as HTMLCanvasElement).getBoundingClientRect()
                  setRect({ ...rect, w: e.clientX - r.left - rect.x, h: e.clientY - r.top - rect.y })
                  const c = canvasRef.current?.getContext('2d'); if (!c) return
                  c.clearRect(0,0,800,500); c.strokeStyle = '#e74c3c'; c.lineWidth = 2
                  c.strokeRect(rect.x, rect.y, e.clientX - r.left - rect.x, e.clientY - r.top - rect.y)
                }}
                onMouseUp={() => setDrawing(false)}
              />
            </div>
            <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
              {rect && canWrite && <button onClick={saveMarkup} style={{ background: 'var(--jarvis-ac)', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: 4 }}>Save Markup</button>}
              {rect && <button onClick={() => { setRect(null); canvasRef.current?.getContext('2d')?.clearRect(0,0,800,500) }}>Clear</button>}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 16 }}>
              <div>
                <h4 style={{ margin: '0 0 6px' }}>Revisions</h4>
                {revisions.map(r => (
                  <div key={r.id} style={{ padding: 6, borderBottom: '1px solid var(--jarvis-bd)', fontSize: 12 }}>
                    <b>Rev {r.rev}</b> · {r.issued_date} — {r.reason || ''}
                  </div>
                ))}
                {!revisions.length && <div style={{ fontSize: 12, color: 'var(--jarvis-ts)' }}>No revisions logged.</div>}
              </div>
              <div>
                <h4 style={{ margin: '0 0 6px' }}>Markups ({markups.filter(m => !m.resolved).length} open)</h4>
                {markups.map(m => (
                  <div key={m.id} style={{ padding: 6, borderBottom: '1px solid var(--jarvis-bd)', fontSize: 12, display: 'flex', justifyContent: 'space-between' }}>
                    <span>{m.title ?? 'Redline'} · p{m.page} · rev {m.rev} {m.resolved ? '✓' : ''}</span>
                    {!m.resolved && canWrite && <button onClick={() => resolveMarkup(m.id)}>Resolve</button>}
                  </div>
                ))}
                {!markups.length && <div style={{ fontSize: 12, color: 'var(--jarvis-ts)' }}>No markups.</div>}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default DrawingsView
