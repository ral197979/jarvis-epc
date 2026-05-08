/**
 * JARVIS EPC — BIMViewerView · 3D Model Viewer + Clash Issues  (v4.31.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * Autodesk-parity: IFC/glTF model register, web-based 3D viewer via xeokit CDN
 * iframe, clash/coordination issue tracker.
 */
import React, { useState, useEffect, useCallback } from 'react'
import { useBizStore, selectProjects } from '../modules/biz/store'
import type { PolicyConfig } from '../modules/biz/dispatch'

interface BimModel {
  id: string; name: string; discipline?: string; format: string; document_id?: string
  size_bytes: number; element_count?: number; coord_system?: string; status: string; updated_at: string
}
interface BimIssue {
  id: string; title: string; description?: string; severity: 'minor'|'major'|'critical'
  status: 'open'|'in_review'|'resolved'|'closed'; model_id?: string; element_ids: string[]
  assigned_to?: string; created_at: string
}

export interface BIMViewerViewProps { policy?: Partial<PolicyConfig> }

export function BIMViewerView({ policy }: BIMViewerViewProps) {
  const projects = useBizStore(selectProjects)
  const [projectId, setProjectId] = useState('')
  const [models, setModels] = useState<BimModel[]>([])
  const [issues, setIssues] = useState<BimIssue[]>([])
  const [selected, setSelected] = useState<BimModel | null>(null)
  const [creatingModel, setCreatingModel] = useState(false)
  const [creatingIssue, setCreatingIssue] = useState(false)
  const [mDraft, setMDraft] = useState({ name: '', discipline: 'mechanical', format: 'ifc' as string, coord_system: '' })
  const [iDraft, setIDraft] = useState({ title: '', description: '', severity: 'minor' as string })

  useEffect(() => { if (projects?.length && !projectId) setProjectId(projects[0].id) }, [projects])

  const reload = useCallback(async () => {
    if (!projectId) return
    const [m, i] = await Promise.all([
      fetch(`/api/v1/projects/${projectId}/bim-models`).then(r => r.json()),
      fetch(`/api/v1/projects/${projectId}/bim-issues`).then(r => r.json()),
    ])
    setModels(m.models ?? []); setIssues(i.issues ?? [])
  }, [projectId])

  useEffect(() => { reload() }, [reload])

  const createModel = async () => {
    const res = await fetch(`/api/v1/projects/${projectId}/bim-models`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(mDraft),
    })
    if (res.ok) { setCreatingModel(false); reload() }
  }

  const createIssue = async () => {
    const payload: any = { ...iDraft }
    if (selected) payload.model_id = selected.id
    const res = await fetch(`/api/v1/projects/${projectId}/bim-issues`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    })
    if (res.ok) { setCreatingIssue(false); setIDraft({ title: '', description: '', severity: 'minor' }); reload() }
  }

  const updateIssue = async (id: string, patch: any) => {
    await fetch(`/api/v1/bim-issues/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })
    reload()
  }

  const canWrite = policy?.writesEnabled !== false
  const sev = (s: string) => ({ minor: '#95a5a6', major: '#f39c12', critical: '#e74c3c' } as Record<string,string>)[s] ?? '#999'

  return (
    <div role="main" aria-label="BIM" style={{ padding: 16 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>🏢 BIM Coordination</h2>
        <select value={projectId} onChange={e => setProjectId(e.target.value)} style={{ padding: 6 }}>
          {projects?.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {canWrite && <button onClick={() => setCreatingModel(true)} style={{ marginLeft: 'auto', padding: '6px 14px', background: 'var(--jarvis-ac)', color: '#fff', border: 'none', borderRadius: 4 }}>+ Register Model</button>}
      </div>

      {creatingModel && (
        <div style={{ border: '1px solid var(--jarvis-bd)', padding: 12, marginBottom: 12, background: 'var(--jarvis-bg2)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            <input placeholder="Model name" value={mDraft.name} onChange={e => setMDraft({ ...mDraft, name: e.target.value })} />
            <select value={mDraft.discipline} onChange={e => setMDraft({ ...mDraft, discipline: e.target.value })}>
              {['mechanical','electrical','plumbing','structural','architectural','process','civil'].map(d => <option key={d}>{d}</option>)}
            </select>
            <select value={mDraft.format} onChange={e => setMDraft({ ...mDraft, format: e.target.value })}>
              {['ifc','glb','gltf','nwd','rvt'].map(f => <option key={f}>{f}</option>)}
            </select>
            <input placeholder="Coord system (EPSG:32633…)" value={mDraft.coord_system} onChange={e => setMDraft({ ...mDraft, coord_system: e.target.value })} />
          </div>
          <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
            <button onClick={createModel} style={{ background: 'var(--jarvis-ac)', color: '#fff', padding: '6px 14px', border: 'none', borderRadius: 4 }}>Save</button>
            <button onClick={() => setCreatingModel(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 16 }}>
        <div>
          <h4 style={{ margin: '0 0 8px' }}>Models ({models.length})</h4>
          {models.map(m => (
            <div key={m.id} onClick={() => setSelected(m)} style={{ padding: 10, border: '1px solid var(--jarvis-bd)', borderRadius: 4, marginBottom: 6, cursor: 'pointer', background: selected?.id === m.id ? 'var(--jarvis-bg2)' : undefined }}>
              <div style={{ fontWeight: 600 }}>{m.name}</div>
              <div style={{ fontSize: 11, color: 'var(--jarvis-ts)' }}>{m.discipline} · .{m.format} · {(m.size_bytes / 1024 / 1024).toFixed(1)} MB</div>
            </div>
          ))}
          {!models.length && <div style={{ color: 'var(--jarvis-ts)', fontSize: 12 }}>No models registered.</div>}
        </div>

        <div>
          {selected ? (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{selected.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--jarvis-ts)' }}>{selected.format.toUpperCase()} · {selected.element_count ?? '—'} elements</div>
                </div>
                <button onClick={() => setSelected(null)}>Close</button>
              </div>
              <div style={{ height: 420, background: '#1a1a1a', border: '1px solid var(--jarvis-bd)', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888' }}>
                {selected.document_id ? (
                  <iframe
                    src={`https://xeokit.github.io/xeokit-sdk/examples/loading/#loading_IFC_Duplex?src=${encodeURIComponent(`/api/v1/documents/${selected.document_id}/file`)}`}
                    style={{ width: '100%', height: '100%', border: 0, background: '#1a1a1a' }}
                    title="BIM Viewer" allow="fullscreen"
                  />
                ) : (
                  <div style={{ textAlign: 'center' }}>
                    <div>3D viewer ready.</div>
                    <div style={{ fontSize: 11 }}>Upload an IFC/glTF document and link via API to render.</div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div style={{ color: 'var(--jarvis-ts)', padding: 40, textAlign: 'center' }}>Select a model to view.</div>
          )}
        </div>
      </div>

      <div style={{ marginTop: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>Coordination Issues ({issues.filter(i => i.status === 'open').length} open)</h3>
          {canWrite && <button onClick={() => setCreatingIssue(true)}>+ New Issue</button>}
        </div>
        {creatingIssue && (
          <div style={{ border: '1px solid var(--jarvis-bd)', padding: 10, marginBottom: 10, background: 'var(--jarvis-bg2)' }}>
            <input placeholder="Title" value={iDraft.title} onChange={e => setIDraft({ ...iDraft, title: e.target.value })} style={{ width: '100%' }} />
            <textarea placeholder="Description" value={iDraft.description} onChange={e => setIDraft({ ...iDraft, description: e.target.value })} style={{ width: '100%', marginTop: 6, minHeight: 60 }} />
            <select value={iDraft.severity} onChange={e => setIDraft({ ...iDraft, severity: e.target.value })} style={{ marginTop: 6 }}>
              {['minor','major','critical'].map(s => <option key={s}>{s}</option>)}
            </select>
            <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
              <button onClick={createIssue} style={{ background: 'var(--jarvis-ac)', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: 4 }}>Save</button>
              <button onClick={() => setCreatingIssue(false)}>Cancel</button>
            </div>
          </div>
        )}
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ background: 'var(--jarvis-bg2)', textAlign: 'left' }}>
            <th style={{ padding: 6 }}>Severity</th><th>Title</th><th>Status</th><th>Created</th><th></th>
          </tr></thead>
          <tbody>
            {issues.map(i => (
              <tr key={i.id} style={{ borderBottom: '1px solid var(--jarvis-bd)' }}>
                <td style={{ padding: 6 }}><span style={{ padding: '2px 8px', background: sev(i.severity), color: '#fff', borderRadius: 10, fontSize: 11 }}>{i.severity}</span></td>
                <td>{i.title}</td>
                <td>{i.status}</td>
                <td>{new Date(i.created_at).toLocaleDateString()}</td>
                <td>{canWrite && i.status === 'open' && <button onClick={() => updateIssue(i.id, { status: 'resolved' })}>Resolve</button>}</td>
              </tr>
            ))}
            {!issues.length && <tr><td colSpan={5} style={{ padding: 20, textAlign: 'center', color: 'var(--jarvis-ts)' }}>No issues.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default BIMViewerView
