/**
 * Denver Engineering — Billing / Pay Applications (v4.45.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * AIA G702/G703 progress billing: schedule of values, pay applications, and the
 * computed continuation sheet (completed-to-date, retention, current payment due).
 *
 * API: /api/v1/projects/:id/sov-items · /projects/:id/pay-applications ·
 *      /pay-applications/:id (computed) · PATCH /pay-applications/:id(/lines)
 */
import React, { useEffect, useState, useCallback } from 'react'

interface Project { id: string; code?: string; name: string }
interface SovItem { id: string; item_no: string; description: string; scheduled_value: number | string }
interface PayAppSummary { id: string; application_number: number; status: string; retention_pct: number | string; period_end?: string | null }
interface G703Line { sovItemId: string; itemNo: string; description: string; scheduledValue: number; fromPrevious: number; thisPeriod: number; materialsStored: number; completedAndStored: number; pctComplete: number; balanceToFinish: number; retainage: number }
interface PayAppView {
  application: { id: string; application_number: number; status: string; retention_pct: number | string }
  retentionPct: number
  lines: G703Line[]
  summary: { originalContractSum: number; totalCompletedAndStored: number; totalRetainage: number; totalEarnedLessRetainage: number; lessPreviousCertificates: number; currentPaymentDue: number; balanceToFinishPlusRetainage: number }
}

const money = (n: number) => `$${(Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const STATUS_COLOR: Record<string, string> = { draft: '#6b7280', submitted: '#3b82f6', approved: '#22c55e', paid: '#22c55e', rejected: '#ef4444' }

export default function BillingView(_props: { onNavigate?: (tab: string) => void }) {
  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState('')
  const [sov, setSov] = useState<SovItem[]>([])
  const [payApps, setPayApps] = useState<PayAppSummary[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [view, setView] = useState<PayAppView | null>(null)
  const [edits, setEdits] = useState<Record<string, { work_completed: number; materials_stored: number }>>({})
  const [busy, setBusy] = useState(false)
  const [sovForm, setSovForm] = useState({ item_no: '', description: '', scheduled_value: '' })

  // Load projects
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/v1/projects', { credentials: 'include' })
        const json = await res.json()
        const list: Project[] = json.data || json.projects || []
        setProjects(list)
        const saved = localStorage.getItem('jarvis-active-project')
        if (saved && list.some(p => p.id === saved)) setProjectId(saved)
        else if (list.length) { setProjectId(list[0].id); localStorage.setItem('jarvis-active-project', list[0].id) }
      } catch { /* ignore */ }
    })()
  }, [])

  const loadProject = useCallback(async (pid: string) => {
    if (!pid) return
    try {
      const [s, a] = await Promise.all([
        fetch(`/api/v1/projects/${pid}/sov-items`, { credentials: 'include' }).then(r => r.json()),
        fetch(`/api/v1/projects/${pid}/pay-applications`, { credentials: 'include' }).then(r => r.json()),
      ])
      setSov(s.data || [])
      setPayApps(a.data || [])
    } catch { /* ignore */ }
  }, [])
  useEffect(() => { loadProject(projectId) }, [projectId, loadProject])

  const loadView = useCallback(async (id: string) => {
    if (!id) { setView(null); return }
    try {
      const res = await fetch(`/api/v1/pay-applications/${id}`, { credentials: 'include' })
      const json = await res.json()
      setView(json.data)
      const e: Record<string, { work_completed: number; materials_stored: number }> = {}
      for (const l of (json.data?.lines ?? []) as G703Line[]) e[l.sovItemId] = { work_completed: l.thisPeriod, materials_stored: l.materialsStored }
      setEdits(e)
    } catch { /* ignore */ }
  }, [])
  useEffect(() => { loadView(selectedId) }, [selectedId, loadView])

  const addSov = async () => {
    if (!sovForm.item_no || !sovForm.description) return
    setBusy(true)
    try {
      await fetch(`/api/v1/projects/${projectId}/sov-items`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_no: sovForm.item_no, description: sovForm.description, scheduled_value: Number(sovForm.scheduled_value) || 0 }),
      })
      setSovForm({ item_no: '', description: '', scheduled_value: '' })
      await loadProject(projectId)
    } finally { setBusy(false) }
  }

  const createPayApp = async () => {
    setBusy(true)
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/pay-applications`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ retention_pct: 10, seed_from_sov: true }),
      })
      const json = await res.json()
      await loadProject(projectId)
      if (json.data?.id) setSelectedId(json.data.id)
    } finally { setBusy(false) }
  }

  const saveLines = async () => {
    if (!view) return
    setBusy(true)
    try {
      const lines = Object.entries(edits).map(([sov_item_id, v]) => ({ sov_item_id, work_completed: v.work_completed, materials_stored: v.materials_stored }))
      await fetch(`/api/v1/pay-applications/${view.application.id}/lines`, {
        method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lines }),
      })
      await loadView(view.application.id)
    } finally { setBusy(false) }
  }

  const setStatus = async (status: string) => {
    if (!view) return
    setBusy(true)
    try {
      await fetch(`/api/v1/pay-applications/${view.application.id}`, {
        method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
      })
      await Promise.all([loadView(view.application.id), loadProject(projectId)])
    } finally { setBusy(false) }
  }

  const card: React.CSSProperties = { background: 'var(--jarvis-bg2)', border: '1px solid var(--jarvis-bd)', borderRadius: 10, padding: 16, marginBottom: 16 }
  const editable = view && ['draft', 'rejected'].includes(view.application.status)
  const inp: React.CSSProperties = { width: 90, padding: '4px 6px', borderRadius: 4, border: '1px solid var(--jarvis-bd)', background: 'var(--jarvis-bg)', color: 'var(--jarvis-tx)', fontSize: 12 }

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--jarvis-tx)', margin: 0 }}>🧾 Billing — Pay Applications</h1>
          <p style={{ fontSize: 13, color: 'var(--jarvis-ts)', margin: '4px 0 0' }}>AIA G702/G703 progress billing against the schedule of values.</p>
        </div>
        <select value={projectId} onChange={e => { setProjectId(e.target.value); setSelectedId(''); localStorage.setItem('jarvis-active-project', e.target.value) }}
          style={{ padding: '7px 10px', borderRadius: 6, border: '1px solid var(--jarvis-bd)', background: 'var(--jarvis-bg2)', color: 'var(--jarvis-tx)', fontSize: 13 }}>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {/* Schedule of Values */}
      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--jarvis-tx)', marginBottom: 10 }}>Schedule of Values ({sov.length} items · {money(sov.reduce((s, i) => s + Number(i.scheduled_value || 0), 0))})</div>
        {sov.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 10 }}>
            {sov.map(i => (
              <div key={i.id} style={{ display: 'flex', fontSize: 12, color: 'var(--jarvis-tx)', gap: 8 }}>
                <span style={{ width: 40, color: 'var(--jarvis-ts)' }}>{i.item_no}</span>
                <span style={{ flex: 1 }}>{i.description}</span>
                <span style={{ fontFamily: 'var(--jarvis-font-mono)' }}>{money(Number(i.scheduled_value || 0))}</span>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <input placeholder="No." value={sovForm.item_no} onChange={e => setSovForm({ ...sovForm, item_no: e.target.value })} style={{ ...inp, width: 56 }} />
          <input placeholder="Description" value={sovForm.description} onChange={e => setSovForm({ ...sovForm, description: e.target.value })} style={{ ...inp, width: 240 }} />
          <input placeholder="Scheduled value" value={sovForm.scheduled_value} onChange={e => setSovForm({ ...sovForm, scheduled_value: e.target.value })} style={{ ...inp, width: 120 }} />
          <button onClick={addSov} disabled={busy} style={{ padding: '5px 12px', borderRadius: 6, fontSize: 12, border: '1px solid var(--jarvis-bd)', background: 'var(--jarvis-bg)', color: 'var(--jarvis-tx)', cursor: 'pointer' }}>+ Add line</button>
        </div>
      </div>

      {/* Pay applications */}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--jarvis-tx)' }}>Pay Applications</span>
          <button onClick={createPayApp} disabled={busy || sov.length === 0} style={{ padding: '6px 12px', borderRadius: 6, fontSize: 12, border: '1px solid var(--jarvis-bd)', background: 'var(--jarvis-bg)', color: 'var(--jarvis-tx)', cursor: sov.length === 0 ? 'not-allowed' : 'pointer', opacity: sov.length === 0 ? 0.5 : 1 }}>+ New application</button>
        </div>
        {payApps.length === 0 && <div style={{ fontSize: 13, color: 'var(--jarvis-ts)' }}>No pay applications yet. Add SOV lines, then create one.</div>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {payApps.map(a => (
            <button key={a.id} onClick={() => setSelectedId(a.id)} style={{
              padding: '6px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
              border: `1px solid ${selectedId === a.id ? 'var(--jarvis-ac)' : 'var(--jarvis-bd)'}`,
              background: selectedId === a.id ? 'var(--jarvis-bg)' : 'transparent', color: 'var(--jarvis-tx)',
            }}>App #{a.application_number} <span style={{ color: STATUS_COLOR[a.status], fontWeight: 700 }}>· {a.status}</span></button>
          ))}
        </div>
      </div>

      {/* Computed G702/G703 */}
      {view && (
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--jarvis-tx)' }}>
              Application #{view.application.application_number}
              <span style={{ color: STATUS_COLOR[view.application.status], marginLeft: 8 }}>· {view.application.status}</span>
              <span style={{ color: 'var(--jarvis-ts)', fontWeight: 400, marginLeft: 8 }}>(retention {view.retentionPct}%)</span>
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              {editable && <button onClick={saveLines} disabled={busy} style={{ padding: '5px 12px', borderRadius: 6, fontSize: 12, border: 'none', background: 'var(--jarvis-ac)', color: '#0a0b0f', fontWeight: 700, cursor: 'pointer' }}>Save lines</button>}
              {view.application.status === 'draft' && <button onClick={() => setStatus('submitted')} disabled={busy} style={{ padding: '5px 12px', borderRadius: 6, fontSize: 12, border: '1px solid var(--jarvis-bd)', background: 'var(--jarvis-bg)', color: 'var(--jarvis-tx)', cursor: 'pointer' }}>Submit</button>}
              {view.application.status === 'submitted' && <>
                <button onClick={() => setStatus('approved')} disabled={busy} style={{ padding: '5px 12px', borderRadius: 6, fontSize: 12, border: '1px solid var(--jarvis-bd)', background: 'var(--jarvis-bg)', color: 'var(--jarvis-tx)', cursor: 'pointer' }}>Approve</button>
                <button onClick={() => setStatus('rejected')} disabled={busy} style={{ padding: '5px 12px', borderRadius: 6, fontSize: 12, border: '1px solid var(--jarvis-bd)', background: 'var(--jarvis-bg)', color: 'var(--jarvis-tx)', cursor: 'pointer' }}>Reject</button>
              </>}
              {view.application.status === 'approved' && <button onClick={() => setStatus('paid')} disabled={busy} style={{ padding: '5px 12px', borderRadius: 6, fontSize: 12, border: '1px solid var(--jarvis-bd)', background: 'var(--jarvis-bg)', color: 'var(--jarvis-tx)', cursor: 'pointer' }}>Mark paid</button>}
            </div>
          </div>

          {/* G703 lines */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ color: 'var(--jarvis-ts)', textAlign: 'right' }}>
                  <th style={{ textAlign: 'left', padding: '4px 6px' }}>Item</th>
                  <th style={{ textAlign: 'right', padding: '4px 6px' }}>Scheduled</th>
                  <th style={{ textAlign: 'right', padding: '4px 6px' }}>Previous</th>
                  <th style={{ textAlign: 'right', padding: '4px 6px' }}>This period</th>
                  <th style={{ textAlign: 'right', padding: '4px 6px' }}>Stored</th>
                  <th style={{ textAlign: 'right', padding: '4px 6px' }}>To date</th>
                  <th style={{ textAlign: 'right', padding: '4px 6px' }}>%</th>
                  <th style={{ textAlign: 'right', padding: '4px 6px' }}>Retainage</th>
                </tr>
              </thead>
              <tbody>
                {view.lines.map(l => (
                  <tr key={l.sovItemId} style={{ borderTop: '1px solid var(--jarvis-bd)', color: 'var(--jarvis-tx)' }}>
                    <td style={{ textAlign: 'left', padding: '5px 6px' }}>{l.itemNo} · {l.description}</td>
                    <td style={{ textAlign: 'right', padding: '5px 6px', fontFamily: 'var(--jarvis-font-mono)' }}>{money(l.scheduledValue)}</td>
                    <td style={{ textAlign: 'right', padding: '5px 6px', fontFamily: 'var(--jarvis-font-mono)', color: 'var(--jarvis-ts)' }}>{money(l.fromPrevious)}</td>
                    <td style={{ textAlign: 'right', padding: '5px 6px' }}>
                      {editable
                        ? <input type="number" value={edits[l.sovItemId]?.work_completed ?? 0} onChange={e => setEdits({ ...edits, [l.sovItemId]: { ...edits[l.sovItemId], work_completed: Number(e.target.value), materials_stored: edits[l.sovItemId]?.materials_stored ?? 0 } })} style={inp} />
                        : <span style={{ fontFamily: 'var(--jarvis-font-mono)' }}>{money(l.thisPeriod)}</span>}
                    </td>
                    <td style={{ textAlign: 'right', padding: '5px 6px' }}>
                      {editable
                        ? <input type="number" value={edits[l.sovItemId]?.materials_stored ?? 0} onChange={e => setEdits({ ...edits, [l.sovItemId]: { ...edits[l.sovItemId], materials_stored: Number(e.target.value), work_completed: edits[l.sovItemId]?.work_completed ?? 0 } })} style={inp} />
                        : <span style={{ fontFamily: 'var(--jarvis-font-mono)' }}>{money(l.materialsStored)}</span>}
                    </td>
                    <td style={{ textAlign: 'right', padding: '5px 6px', fontFamily: 'var(--jarvis-font-mono)' }}>{money(l.completedAndStored)}</td>
                    <td style={{ textAlign: 'right', padding: '5px 6px' }}>{l.pctComplete}%</td>
                    <td style={{ textAlign: 'right', padding: '5px 6px', fontFamily: 'var(--jarvis-font-mono)' }}>{money(l.retainage)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* G702 summary */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 14 }}>
            {[
              ['Contract sum', view.summary.originalContractSum],
              ['Completed & stored', view.summary.totalCompletedAndStored],
              ['Retainage', view.summary.totalRetainage],
              ['Earned less retainage', view.summary.totalEarnedLessRetainage],
              ['Less previous', view.summary.lessPreviousCertificates],
              ['Balance to finish', view.summary.balanceToFinishPlusRetainage],
            ].map(([label, val]) => (
              <div key={label as string} style={{ flex: '1 1 150px', minWidth: 150, border: '1px solid var(--jarvis-bd)', borderRadius: 8, padding: 10 }}>
                <div style={{ fontSize: 11, color: 'var(--jarvis-ts)' }}>{label as string}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--jarvis-tx)', fontFamily: 'var(--jarvis-font-mono)' }}>{money(val as number)}</div>
              </div>
            ))}
            <div style={{ flex: '1 1 180px', minWidth: 180, border: '1px solid var(--jarvis-ac)', borderRadius: 8, padding: 10, background: 'var(--jarvis-bg)' }}>
              <div style={{ fontSize: 11, color: 'var(--jarvis-ac)' }}>Current payment due</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--jarvis-ac)', fontFamily: 'var(--jarvis-font-mono)' }}>{money(view.summary.currentPaymentDue)}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
