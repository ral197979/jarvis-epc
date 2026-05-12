/**
 * Denver Engineering — Schedule Import View (v10.4.0)
 * ─────────────────────────────────────────────────────
 * Drag-and-drop file upload for Primavera P6 XER and
 * MS Project XML (MSPDI) schedule files.
 */
import React, { useState, useCallback, useRef } from 'react'
import { useBizStore, selectProjects } from '../../modules/biz/store'

interface ImportJob {
  id: string; format: string; status: string; filename: string
  file_size_bytes: number | null
  tasks_imported: number; tasks_updated: number; deps_imported: number
  warnings: string[]; error: string | null
  created_at: string; completed_at: string | null
}

interface ImportResult {
  jobId: string; tasksImported: number; tasksUpdated: number
  depsImported: number; warnings: string[]
}

const STATUS_COLOR: Record<string, string> = {
  completed: '#2ecc71', running: '#f39c12', pending: '#888', failed: '#e74c3c',
}

const fmtBytes = (b: number | null) =>
  b == null ? '—' : b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`

export function ScheduleImportView() {
  const projects  = useBizStore(selectProjects)
  const [projectId, setProjectId] = useState(() => (projects as any[])?.[0]?.id ?? '')
  const [dragging, setDragging]   = useState(false)
  const [uploading, setUploading] = useState(false)
  const [result, setResult]       = useState<ImportResult | null>(null)
  const [error, setError]         = useState('')
  const [jobs, setJobs]           = useState<ImportJob[]>([])
  const [loadingJobs, setLoadingJobs] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const loadJobs = useCallback(async (pid: string) => {
    if (!pid) return
    setLoadingJobs(true)
    try {
      const res = await fetch(`/api/v1/projects/${pid}/schedule/imports`)
      if (res.ok) setJobs((await res.json()).jobs ?? [])
    } finally { setLoadingJobs(false) }
  }, [])

  const handleProjectChange = (pid: string) => {
    setProjectId(pid); setResult(null); setError(''); loadJobs(pid)
  }

  const uploadFile = useCallback(async (file: File) => {
    if (!projectId) { setError('Select a project first'); return }
    setUploading(true); setResult(null); setError('')
    const fd = new FormData()
    fd.append('file', file)
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/schedule/import`, {
        method: 'POST', body: fd,
      })
      const body = await res.json()
      if (!res.ok) { setError(body.detail ?? body.error ?? 'Upload failed'); return }
      setResult(body.import as ImportResult)
      loadJobs(projectId)
    } catch (e) {
      setError((e as Error).message)
    } finally { setUploading(false) }
  }, [projectId, loadJobs])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) uploadFile(file)
  }, [uploadFile])

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) uploadFile(file)
    e.target.value = ''
  }

  return (
    <div style={{ padding: 16, maxWidth: 860 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>📅 Schedule Import</h2>
        <select
          value={projectId}
          onChange={e => handleProjectChange(e.target.value)}
          style={{ padding: 6 }}
        >
          {(projects as any[])?.map((p: any) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      <div style={{ marginBottom: 8, fontSize: 12, color: 'var(--jarvis-ts)' }}>
        Supported formats: <strong>Primavera P6 XER</strong> (.xer) · <strong>MS Project XML</strong> (.xml / MSPDI)
      </div>

      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
        style={{
          border: `2px dashed ${dragging ? 'var(--jarvis-ac)' : 'var(--jarvis-bd)'}`,
          borderRadius: 8, padding: 48, textAlign: 'center',
          background: dragging ? 'rgba(var(--jarvis-ac-rgb, 59,130,246),0.05)' : 'var(--jarvis-bg2)',
          cursor: 'pointer', marginBottom: 20, transition: 'border-color 0.15s',
        }}
      >
        <input ref={fileInputRef} type="file" accept=".xer,.xml" onChange={onFileInput} style={{ display: 'none' }} />
        {uploading ? (
          <div style={{ color: 'var(--jarvis-ts)' }}>⏳ Importing…</div>
        ) : (
          <>
            <div style={{ fontSize: 36, marginBottom: 8 }}>📂</div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Drop your schedule file here</div>
            <div style={{ fontSize: 12, color: 'var(--jarvis-ts)' }}>or click to browse · .xer or .xml · max 50 MB</div>
          </>
        )}
      </div>

      {/* Error */}
      {error && (
        <div style={{ background: 'rgba(231,76,60,0.1)', border: '1px solid #e74c3c', borderRadius: 6, padding: '10px 14px', marginBottom: 16, color: '#e74c3c', fontSize: 13 }}>
          ⚠️ {error}
        </div>
      )}

      {/* Success result */}
      {result && (
        <div style={{ background: 'rgba(46,204,113,0.08)', border: '1px solid #2ecc71', borderRadius: 6, padding: 16, marginBottom: 20 }}>
          <div style={{ fontWeight: 600, color: '#2ecc71', marginBottom: 10 }}>✅ Import complete</div>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 14 }}>
            <div><strong>{result.tasksImported}</strong> tasks created</div>
            <div><strong>{result.tasksUpdated}</strong> tasks updated</div>
            <div><strong>{result.depsImported}</strong> dependencies imported</div>
          </div>
          {result.warnings.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12, color: '#f39c12', marginBottom: 4 }}>⚠️ {result.warnings.length} warning{result.warnings.length > 1 ? 's' : ''}:</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11, color: 'var(--jarvis-ts)' }}>
                {result.warnings.slice(0, 10).map((w, i) => <li key={i}>{w}</li>)}
                {result.warnings.length > 10 && <li>…and {result.warnings.length - 10} more</li>}
              </ul>
            </div>
          )}
          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--jarvis-ts)' }}>
            Job ID: <code style={{ fontFamily: 'monospace' }}>{result.jobId}</code>
          </div>
        </div>
      )}

      {/* Import history */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <div style={{ fontWeight: 600 }}>Import History</div>
        <button onClick={() => loadJobs(projectId)} style={{ fontSize: 11, padding: '2px 8px', cursor: 'pointer' }}>
          Refresh
        </button>
      </div>

      {loadingJobs && <div style={{ color: 'var(--jarvis-ts)', fontSize: 12 }}>Loading…</div>}

      {!loadingJobs && jobs.length === 0 && (
        <div style={{ color: 'var(--jarvis-ts)', fontSize: 12 }}>No imports yet for this project.</div>
      )}

      {jobs.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: 'var(--jarvis-bg2)', textAlign: 'left' }}>
              {['File', 'Format', 'Status', 'Tasks', 'Deps', 'Size', 'Date'].map(h => (
                <th key={h} style={{ padding: '6px 8px', borderBottom: '1px solid var(--jarvis-bd)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {jobs.map(j => (
              <tr key={j.id} style={{ borderBottom: '1px solid var(--jarvis-bd)' }}>
                <td style={{ padding: '6px 8px', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    title={j.filename}>{j.filename}</td>
                <td style={{ padding: '6px 8px', textTransform: 'uppercase', fontFamily: 'monospace' }}>{j.format}</td>
                <td style={{ padding: '6px 8px' }}>
                  <span style={{ color: STATUS_COLOR[j.status] ?? '#888', fontWeight: 600 }}>
                    {j.status}
                  </span>
                  {j.error && <span title={j.error} style={{ marginLeft: 4, cursor: 'help' }}>⚠️</span>}
                </td>
                <td style={{ padding: '6px 8px' }}>
                  {j.tasks_imported > 0 && <span style={{ color: '#2ecc71' }}>+{j.tasks_imported}</span>}
                  {j.tasks_imported > 0 && j.tasks_updated > 0 && ' / '}
                  {j.tasks_updated > 0 && <span style={{ color: '#f39c12' }}>↻{j.tasks_updated}</span>}
                  {j.tasks_imported === 0 && j.tasks_updated === 0 && '—'}
                </td>
                <td style={{ padding: '6px 8px' }}>{j.deps_imported || '—'}</td>
                <td style={{ padding: '6px 8px', color: 'var(--jarvis-ts)' }}>{fmtBytes(j.file_size_bytes)}</td>
                <td style={{ padding: '6px 8px', color: 'var(--jarvis-ts)' }}>
                  {new Date(j.created_at).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

export default ScheduleImportView
