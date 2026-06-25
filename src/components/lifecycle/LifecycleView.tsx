/**
 * Denver Engineering — Project Lifecycle (v4.34.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * Workflow Redesign W3 (see WORKFLOW_REDESIGN.md §4 + §8). A visual EPC lifecycle
 * timeline plus the approval gate that controls advancement — with each gate's
 * outstanding requirements computed live from records.
 *
 * Data: GET /api/v1/projects/:id/lifecycle
 *       POST /api/v1/projects/:id/gates/:gateKey { action }
 *       POST /api/v1/projects/:id/advance
 */
import React, { useEffect, useState, useCallback } from 'react'

interface Project { id: string; name: string }
interface Requirement { key: string; label: string; satisfied: boolean; detail: string }
interface Gate {
  key: string; name: string; phase: string; approvalStatus: 'pending' | 'approved' | 'waived'
  ownerId: string | null; expectedDate: string | null; approvedBy: string | null; approvedAt: string | null
  requirements: Requirement[]; requirementsSatisfied: boolean
}
interface Stage { key: string; label: string; status: 'done' | 'active' | 'upcoming'; gate: Gate | null }
interface Lifecycle {
  projectId: string; generatedAt: string; currentPhase: string
  stages: Stage[]; currentGate: Gate | null; nextGate: Gate | null; canAdvance: boolean
}

const STAGE_COLOR: Record<Stage['status'], string> = {
  done: '#22c55e', active: 'var(--jarvis-ac)', upcoming: 'var(--jarvis-bd)',
}

function GatePanel({ gate, busy, onAction, onAdvance, canAdvance, advanceLabel }: {
  gate: Gate; busy: boolean; canAdvance: boolean; advanceLabel: string
  onAction: (action: 'approve' | 'waive' | 'reset') => void; onAdvance: () => void
}) {
  const statusColor = gate.approvalStatus === 'approved' ? '#22c55e'
    : gate.approvalStatus === 'waived' ? '#f59e0b' : 'var(--jarvis-ts)'
  return (
    <div style={{ background: 'var(--jarvis-bg2)', border: '1px solid var(--jarvis-bd)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--jarvis-ts)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Next gate</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--jarvis-tx)' }}>{gate.name}</div>
        </div>
        <span style={{ fontSize: 12, fontWeight: 700, color: statusColor, textTransform: 'capitalize' }}>{gate.approvalStatus}</span>
      </div>

      {/* Requirements checklist */}
      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {gate.requirements.map(r => (
          <div key={r.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <span aria-hidden style={{ color: r.satisfied ? '#22c55e' : '#ef4444' }}>{r.satisfied ? '✓' : '✗'}</span>
            <span style={{ color: 'var(--jarvis-tx)' }}>{r.label}</span>
            <span style={{ color: 'var(--jarvis-ts)', fontSize: 12 }}>· {r.detail}</span>
          </div>
        ))}
        {gate.requirements.length === 0 && (
          <div style={{ fontSize: 13, color: 'var(--jarvis-ts)' }}>No automated requirements for this gate.</div>
        )}
      </div>

      {/* Actions */}
      <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={() => onAction('approve')} disabled={busy} style={btn('var(--jarvis-ac)', '#0a0b0f')}>Approve gate</button>
        <button onClick={() => onAction('waive')} disabled={busy} style={btn('transparent', 'var(--jarvis-tx)', true)}>Waive</button>
        {gate.approvalStatus !== 'pending' && (
          <button onClick={() => onAction('reset')} disabled={busy} style={btn('transparent', 'var(--jarvis-ts)', true)}>Reset</button>
        )}
        <button onClick={onAdvance} disabled={busy || !canAdvance} title={!canAdvance ? 'Approve or waive the gate first' : undefined}
          style={{ ...btn('#22c55e', '#0a0b0f'), marginLeft: 'auto', opacity: busy || !canAdvance ? 0.5 : 1 }}>
          {advanceLabel}
        </button>
      </div>
      {!gate.requirementsSatisfied && gate.approvalStatus === 'pending' && (
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--jarvis-ts)' }}>
          Some requirements are still open — approve only if you intend to accept the risk, or waive with a note.
        </div>
      )}
    </div>
  )
}

function btn(bg: string, color: string, bordered = false): React.CSSProperties {
  return {
    padding: '7px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer',
    border: bordered ? '1px solid var(--jarvis-bd)' : 'none', background: bg, color,
  }
}

export default function LifecycleView(_props: { onNavigate?: (tab: string) => void }) {
  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState('')
  const [data, setData] = useState<Lifecycle | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

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

  const load = useCallback(async (pid: string) => {
    if (!pid) return
    setError(''); setData(null)
    try {
      const res = await fetch(`/api/v1/projects/${pid}/lifecycle`, { credentials: 'include' })
      const json = await res.json()
      if (!res.ok) { setError(json.error || 'Failed to load lifecycle'); return }
      setData(json.data)
    } catch { setError('Failed to load lifecycle') }
  }, [])
  useEffect(() => { load(projectId) }, [projectId, load])

  const act = async (action: 'approve' | 'waive' | 'reset') => {
    if (!data?.currentGate || !projectId) return
    setBusy(true)
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/gates/${data.currentGate.key}`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (res.ok) setData((await res.json()).data)
    } finally { setBusy(false) }
  }

  const advance = async () => {
    if (!projectId) return
    setBusy(true)
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/advance`, { method: 'POST', credentials: 'include' })
      const json = await res.json()
      if (json.data) setData(json.data)
    } finally { setBusy(false) }
  }

  return (
    <div style={{ padding: 24, maxWidth: 920, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--jarvis-tx)', margin: 0 }}>🛤️ Project Lifecycle</h1>
          <p style={{ fontSize: 13, color: 'var(--jarvis-ts)', margin: '4px 0 0' }}>Where the project is, the next gate, and what it needs to advance.</p>
        </div>
        <select value={projectId} onChange={e => { setProjectId(e.target.value); localStorage.setItem('jarvis-active-project', e.target.value) }}
          style={{ padding: '7px 10px', borderRadius: 6, border: '1px solid var(--jarvis-bd)', background: 'var(--jarvis-bg2)', color: 'var(--jarvis-tx)', fontSize: 13 }}>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {error && <div style={{ background: 'var(--jarvis-bg2)', border: '1px solid var(--jarvis-bd)', borderRadius: 10, padding: 16, color: 'var(--jarvis-ts)', fontSize: 13 }}>{error}</div>}

      {data && (
        <>
          {/* Timeline */}
          <div style={{ display: 'flex', alignItems: 'stretch', gap: 0, marginBottom: 20, overflowX: 'auto' }}>
            {data.stages.map((s, i) => (
              <div key={s.key} style={{ flex: '1 1 0', minWidth: 92, textAlign: 'center', position: 'relative' }}>
                <div style={{ height: 4, background: STAGE_COLOR[s.status], borderRadius: 2, margin: i === 0 ? '0 0 0 50%' : i === data.stages.length - 1 ? '0 50% 0 0' : 0 }} />
                <div style={{
                  width: 14, height: 14, borderRadius: 7, margin: '-9px auto 6px',
                  background: s.status === 'upcoming' ? 'var(--jarvis-bg)' : STAGE_COLOR[s.status],
                  border: `2px solid ${STAGE_COLOR[s.status]}`,
                }} />
                <div style={{ fontSize: 11, fontWeight: s.status === 'active' ? 700 : 500, color: s.status === 'active' ? 'var(--jarvis-ac)' : 'var(--jarvis-ts)' }}>{s.label}</div>
                {s.gate && (
                  <div style={{ fontSize: 9, marginTop: 2, color: s.gate.approvalStatus === 'approved' ? '#22c55e' : s.gate.approvalStatus === 'waived' ? '#f59e0b' : 'var(--jarvis-td)' }}>
                    {s.gate.approvalStatus === 'approved' ? '● gate' : s.gate.approvalStatus === 'waived' ? '◐ gate' : '○ gate'}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Current gate */}
          {data.currentGate ? (
            <GatePanel
              gate={data.currentGate} busy={busy} canAdvance={data.canAdvance}
              advanceLabel={`Advance to ${data.currentGate.phase.replace('_', ' ')} ›`}
              onAction={act} onAdvance={advance}
            />
          ) : (
            <div style={{ background: 'var(--jarvis-bg2)', border: '1px solid var(--jarvis-bd)', borderRadius: 10, padding: 16, fontSize: 13, color: 'var(--jarvis-ts)' }}>
              ✅ This project is at its final lifecycle phase.
            </div>
          )}
        </>
      )}
    </div>
  )
}
