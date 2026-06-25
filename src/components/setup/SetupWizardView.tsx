/**
 * Denver Engineering — Project Setup Wizard (v4.37.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * Workflow Redesign W6 (see WORKFLOW_REDESIGN.md §6). A resumable, multi-step flow
 * that initializes a real project (POST /api/v1/projects) and then routes the user
 * to the existing screens for the heavier subsystem setup (team, cost codes,
 * schedule import, templates, automation, documents).
 *
 * Resumable: the draft is saved to localStorage on every change and restored on
 * mount; it is cleared once the project is created.
 */
import React, { useEffect, useState } from 'react'
import {
  EMPTY_DRAFT, STEPS, CONTRACT_TYPES, NEXT_STEPS,
  validateDraft, stepValid, buildProjectPayload, type SetupDraft,
} from './wizardModel'

const DRAFT_KEY = 'jarvis-setup-wizard-draft'

const field: React.CSSProperties = {
  width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--jarvis-bd)',
  background: 'var(--jarvis-bg)', color: 'var(--jarvis-tx)', fontSize: 13, marginTop: 4,
}
const labelS: React.CSSProperties = { fontSize: 12, color: 'var(--jarvis-ts)', display: 'block', marginBottom: 8 }

export default function SetupWizardView({ onNavigate }: { onNavigate?: (tab: string) => void }) {
  const [draft, setDraft] = useState<SetupDraft>(EMPTY_DRAFT)
  const [stepIdx, setStepIdx] = useState(0)
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<{ id: string; code: string; name: string } | null>(null)
  const [error, setError] = useState('')

  // Restore draft
  useEffect(() => {
    try { const raw = localStorage.getItem(DRAFT_KEY); if (raw) setDraft({ ...EMPTY_DRAFT, ...JSON.parse(raw) }) } catch { /* ignore */ }
  }, [])
  // Persist draft
  useEffect(() => {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)) } catch { /* ignore */ }
  }, [draft])

  const set = (k: keyof SetupDraft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setDraft(d => ({ ...d, [k]: e.target.value }))

  const step = STEPS[stepIdx]
  const v = validateDraft(draft)
  const canGoLive = v.ok

  const goLive = async () => {
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/v1/projects', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildProjectPayload(draft)),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.message || json.error || 'Failed to create project'); return }
      const p = json.data
      try { localStorage.setItem('jarvis-active-project', p.id); localStorage.removeItem(DRAFT_KEY) } catch { /* ignore */ }
      setCreated({ id: p.id, code: p.code, name: p.name })
    } catch { setError('Failed to create project') } finally { setBusy(false) }
  }

  // ── Success screen ──────────────────────────────────────────────────────────
  if (created) {
    return (
      <div style={{ padding: 24, maxWidth: 720, margin: '0 auto' }}>
        <div style={{ background: 'var(--jarvis-bg2)', border: '1px solid var(--jarvis-bd)', borderRadius: 10, padding: 20, marginBottom: 16 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--jarvis-tx)' }}>✅ {created.name} created</div>
          <div style={{ fontSize: 13, color: 'var(--jarvis-ts)', marginTop: 4 }}>
            Project <strong>{created.code}</strong> is live at the <em>Feasibility</em> phase. Finish setting it up:
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {NEXT_STEPS.map(s => (
            <button key={s.tab} onClick={() => onNavigate?.(s.tab)} style={{
              display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', cursor: 'pointer',
              padding: '12px 14px', borderRadius: 8, border: '1px solid var(--jarvis-bd)', background: 'var(--jarvis-bg2)', color: 'var(--jarvis-tx)', width: '100%',
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{s.label}</div>
                <div style={{ fontSize: 12, color: 'var(--jarvis-ts)' }}>{s.detail}</div>
              </div>
              <span style={{ color: 'var(--jarvis-td)' }}>›</span>
            </button>
          ))}
        </div>
        <button onClick={() => { setCreated(null); setDraft(EMPTY_DRAFT); setStepIdx(0) }} style={{
          marginTop: 16, padding: '8px 14px', borderRadius: 6, fontSize: 13, cursor: 'pointer',
          border: '1px solid var(--jarvis-bd)', background: 'transparent', color: 'var(--jarvis-ts)',
        }}>+ Set up another project</button>
      </div>
    )
  }

  // ── Wizard ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: 24, maxWidth: 720, margin: '0 auto' }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--jarvis-tx)', margin: 0 }}>🧙 New Project</h1>
      <p style={{ fontSize: 13, color: 'var(--jarvis-ts)', margin: '4px 0 16px' }}>Step {stepIdx + 1} of {STEPS.length}: {step.title}</p>

      {/* Stepper */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, flexWrap: 'wrap' }}>
        {STEPS.map((s, i) => (
          <div key={s.id} style={{
            flex: '1 1 0', minWidth: 60, height: 4, borderRadius: 2,
            background: i <= stepIdx ? 'var(--jarvis-ac)' : 'var(--jarvis-bd)',
          }} title={s.title} />
        ))}
      </div>

      <div style={{ background: 'var(--jarvis-bg2)', border: '1px solid var(--jarvis-bd)', borderRadius: 10, padding: 20, marginBottom: 16 }}>
        {step.id === 'info' && (
          <>
            <label style={labelS}>Project code *<input style={field} value={draft.code} onChange={set('code')} placeholder="e.g. DC-CACTUS-01" /></label>
            {v.errors.code && draft.code !== '' && <Err msg={v.errors.code} />}
            <label style={labelS}>Project name *<input style={field} value={draft.name} onChange={set('name')} placeholder="e.g. Cactus Data Center" /></label>
            <label style={labelS}>Client<input style={field} value={draft.client_name} onChange={set('client_name')} /></label>
            <div style={{ display: 'flex', gap: 12 }}>
              <label style={{ ...labelS, flex: 1 }}>Location<input style={field} value={draft.location} onChange={set('location')} /></label>
              <label style={{ ...labelS, width: 120 }}>Country (ISO-2)<input style={field} value={draft.country} onChange={set('country')} placeholder="US" maxLength={2} /></label>
            </div>
            <label style={labelS}>Description<textarea style={{ ...field, minHeight: 64 }} value={draft.description} onChange={set('description')} /></label>
          </>
        )}
        {step.id === 'contract' && (
          <>
            <label style={labelS}>Contract type
              <select style={field} value={draft.contract_type} onChange={set('contract_type')}>
                <option value="">—</option>
                {CONTRACT_TYPES.map(c => <option key={c} value={c}>{c.replace('_', ' ').toUpperCase()}</option>)}
              </select>
            </label>
            <div style={{ display: 'flex', gap: 12 }}>
              <label style={{ ...labelS, width: 120 }}>Currency<input style={field} value={draft.currency} onChange={set('currency')} maxLength={3} /></label>
              <label style={{ ...labelS, flex: 1 }}>Budget<input style={field} value={draft.budget} onChange={set('budget')} placeholder="e.g. 250000000" inputMode="numeric" /></label>
            </div>
            {v.errors.budget && <Err msg={v.errors.budget} />}
          </>
        )}
        {step.id === 'schedule' && (
          <div style={{ display: 'flex', gap: 12 }}>
            <label style={{ ...labelS, flex: 1 }}>Planned start<input type="date" style={field} value={draft.planned_start} onChange={set('planned_start')} /></label>
            <label style={{ ...labelS, flex: 1 }}>Planned finish<input type="date" style={field} value={draft.planned_finish} onChange={set('planned_finish')} /></label>
            {v.errors.planned_finish && <Err msg={v.errors.planned_finish} />}
          </div>
        )}
        {step.id === 'next' && (
          <>
            <div style={{ fontSize: 13, color: 'var(--jarvis-ts)', marginBottom: 12 }}>
              After the project is created, finish setup in these screens (you can do this anytime):
            </div>
            {NEXT_STEPS.map(s => (
              <div key={s.tab} style={{ padding: '8px 0', borderBottom: '1px solid var(--jarvis-bd)' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--jarvis-tx)' }}>{s.label}</div>
                <div style={{ fontSize: 12, color: 'var(--jarvis-ts)' }}>{s.detail}</div>
              </div>
            ))}
          </>
        )}
        {step.id === 'review' && (
          <>
            <div style={{ fontSize: 13, color: 'var(--jarvis-tx)', lineHeight: 1.9 }}>
              <div><strong>{draft.code || '—'}</strong> · {draft.name || '—'}</div>
              <div style={{ color: 'var(--jarvis-ts)' }}>{draft.client_name || 'No client'} · {draft.location || 'No location'}{draft.country ? `, ${draft.country.toUpperCase()}` : ''}</div>
              <div style={{ color: 'var(--jarvis-ts)' }}>
                {draft.contract_type ? draft.contract_type.replace('_', ' ').toUpperCase() : 'No contract type'}
                {draft.budget ? ` · ${draft.currency} ${Number(draft.budget).toLocaleString()}` : ''}
              </div>
              <div style={{ color: 'var(--jarvis-ts)' }}>{draft.planned_start || '—'} → {draft.planned_finish || '—'}</div>
            </div>
            {!canGoLive && <Err msg="Project code and name are required before going live." />}
            {error && <Err msg={error} />}
          </>
        )}
      </div>

      {/* Nav */}
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <button onClick={() => setStepIdx(i => Math.max(0, i - 1))} disabled={stepIdx === 0} style={{
          padding: '8px 16px', borderRadius: 6, fontSize: 13, cursor: stepIdx === 0 ? 'default' : 'pointer',
          border: '1px solid var(--jarvis-bd)', background: 'transparent', color: 'var(--jarvis-ts)', opacity: stepIdx === 0 ? 0.5 : 1,
        }}>‹ Back</button>
        {step.id === 'review' ? (
          <button onClick={goLive} disabled={busy || !canGoLive} style={{
            padding: '8px 20px', borderRadius: 6, fontSize: 13, fontWeight: 700,
            cursor: busy || !canGoLive ? 'default' : 'pointer', border: 'none',
            background: '#22c55e', color: '#0a0b0f', opacity: busy || !canGoLive ? 0.5 : 1,
          }}>{busy ? 'Creating…' : 'Go Live ✓'}</button>
        ) : (
          <button onClick={() => setStepIdx(i => Math.min(STEPS.length - 1, i + 1))} disabled={!stepValid(step.id, draft)} style={{
            padding: '8px 20px', borderRadius: 6, fontSize: 13, fontWeight: 700,
            cursor: stepValid(step.id, draft) ? 'pointer' : 'default', border: 'none',
            background: 'var(--jarvis-ac)', color: '#0a0b0f', opacity: stepValid(step.id, draft) ? 1 : 0.5,
          }}>Next ›</button>
        )}
      </div>
    </div>
  )
}

function Err({ msg }: { msg: string }) {
  return <div style={{ fontSize: 12, color: '#ef4444', marginTop: 4 }}>{msg}</div>
}
