/**
 * Denver Engineering — Risk Register View (v10.17.0)
 *
 * 5×5 probability/impact matrix (SVG) · Register table · Detail panel
 */
import React, { useEffect, useState, useCallback } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

type RiskStatus   = 'open' | 'mitigating' | 'accepted' | 'closed' | 'occurred'
type RiskCategory =
  | 'schedule' | 'cost' | 'scope' | 'safety' | 'technical'
  | 'regulatory' | 'environmental' | 'procurement' | 'force_majeure' | 'other'

interface Risk {
  id:                  string
  riskNumber:          number
  title:               string
  description:         string | null
  category:            RiskCategory
  status:              RiskStatus
  probability:         number
  impact:              number
  riskScore:           number
  residualProbability: number | null
  residualImpact:      number | null
  residualScore:       number
  costExposure:        number | null
  owner:               string | null
  mitigationPlan:      string | null
  contingencyPlan:     string | null
  identifiedDate:      string
  targetDate:          string | null
  closedDate:          string | null
}

interface RiskSummary {
  total: number; open: number; mitigating: number; accepted: number
  closed: number; occurred: number
  critical: number; high: number; medium: number; low: number
  totalExposure: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function scoreColor(score: number): string {
  if (score >= 15) return '#dc2626'   // critical
  if (score >= 9)  return '#f97316'   // high
  if (score >= 4)  return '#f59e0b'   // medium
  return '#22c55e'                     // low
}

function scoreLabel(score: number): string {
  if (score >= 15) return 'Critical'
  if (score >= 9)  return 'High'
  if (score >= 4)  return 'Medium'
  return 'Low'
}

const STATUS_COLOR: Record<RiskStatus, string> = {
  open:       '#3b82f6',
  mitigating: '#f59e0b',
  accepted:   '#8b5cf6',
  closed:     '#22c55e',
  occurred:   '#ef4444',
}

const CATEGORY_ICON: Record<RiskCategory, string> = {
  schedule: '📅', cost: '💰', scope: '📋', safety: '⛑️', technical: '⚙️',
  regulatory: '🛡️', environmental: '🌿', procurement: '📦', force_majeure: '🌪️', other: '•',
}

const fmt$ = (n: number | null) =>
  n === null ? '—' : n >= 1_000_000 ? `$${(n/1_000_000).toFixed(1)}M` : n >= 1_000 ? `$${(n/1_000).toFixed(0)}K` : `$${n.toLocaleString()}`

// ─── 5×5 Risk Matrix (SVG) ───────────────────────────────────────────────────

function RiskMatrix({ risks, onSelect }: { risks: Risk[]; onSelect: (r: Risk) => void }) {
  const CELL = 44, LABEL = 28
  const W = LABEL + 5 * CELL + 8
  const H = LABEL + 5 * CELL + 8

  // Cell color: P×I score
  function cellColor(p: number, i: number): string {
    const s = p * i
    if (s >= 15) return '#dc262633'
    if (s >= 9)  return '#f9731633'
    if (s >= 4)  return '#f59e0b22'
    return '#22c55e22'
  }

  // Risks in each cell (use pre-mitigation score for placement)
  function risksAt(p: number, i: number): Risk[] {
    return risks.filter(r => r.probability === p && r.impact === i && r.status !== 'closed')
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: W }}>
      {/* Y-axis label */}
      <text x={10} y={LABEL + 5*CELL/2} textAnchor="middle" fontSize={9} fill="var(--jarvis-ts)"
        transform={`rotate(-90, 10, ${LABEL + 5*CELL/2})`}>Probability →</text>
      {/* X-axis label */}
      <text x={LABEL + 5*CELL/2} y={H - 2} textAnchor="middle" fontSize={9} fill="var(--jarvis-ts)">Impact →</text>

      {/* Grid */}
      {[5,4,3,2,1].map((prob, pi) =>
        [1,2,3,4,5].map((imp, ii) => {
          const x  = LABEL + ii * CELL
          const y  = LABEL + pi * CELL
          const rr = risksAt(prob, imp)
          return (
            <g key={`${prob}-${imp}`}>
              <rect x={x} y={y} width={CELL} height={CELL} fill={cellColor(prob, imp)} stroke="var(--jarvis-b)" strokeWidth={0.5} />
              {/* Dots for risks in this cell */}
              {rr.slice(0, 4).map((r, ri) => (
                <circle
                  key={r.id}
                  cx={x + 8 + (ri % 2) * 14}
                  cy={y + 8 + Math.floor(ri / 2) * 14}
                  r={5}
                  fill={scoreColor(r.riskScore)}
                  opacity={0.9}
                  style={{ cursor: 'pointer' }}
                  onClick={() => onSelect(r)}
                >
                  <title>{r.title}</title>
                </circle>
              ))}
              {rr.length > 4 && (
                <text x={x + CELL - 5} y={y + CELL - 5} fontSize={8} fill="var(--jarvis-ts)" textAnchor="end">+{rr.length - 4}</text>
              )}
            </g>
          )
        })
      )}

      {/* Prob axis labels (1–5) */}
      {[5,4,3,2,1].map((v, i) => (
        <text key={v} x={LABEL - 4} y={LABEL + i*CELL + CELL/2 + 3} textAnchor="end" fontSize={9} fill="var(--jarvis-ts)">{v}</text>
      ))}
      {/* Impact axis labels */}
      {[1,2,3,4,5].map((v, i) => (
        <text key={v} x={LABEL + i*CELL + CELL/2} y={LABEL - 4} textAnchor="middle" fontSize={9} fill="var(--jarvis-ts)">{v}</text>
      ))}

      {/* Corner labels */}
      <text x={LABEL + 2} y={LABEL + 5*CELL - 2} fontSize={7} fill="#22c55e99">Low</text>
      <text x={LABEL + 5*CELL - 2} y={LABEL + 2 + 8} fontSize={7} fill="#dc262699" textAnchor="end">Critical</text>
    </svg>
  )
}

// ─── Detail panel ─────────────────────────────────────────────────────────────

function DetailPanel({
  risk, onClose, onUpdate, onClose2,
}: {
  risk:     Risk
  onClose:  () => void
  onUpdate: (patch: Record<string, unknown>) => Promise<void>
  onClose2: (id: string) => Promise<void>
}) {
  const [editing,  setEditing]  = useState(false)
  const [patch,    setPatch]    = useState<Record<string, unknown>>({})
  const [saving,   setSaving]   = useState(false)

  const set = (k: string, v: unknown) => setPatch(p => ({ ...p, [k]: v }))

  const save = async () => {
    setSaving(true)
    await onUpdate(patch)
    setPatch({}); setEditing(false); setSaving(false)
  }

  const inputS: React.CSSProperties = {
    padding: '5px 8px', borderRadius: 5, border: '1px solid var(--jarvis-b)',
    background: 'var(--jarvis-s)', color: 'var(--jarvis-t)', fontSize: 12,
    width: '100%', boxSizing: 'border-box',
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 100, display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        style={{ width: 460, height: '100vh', overflowY: 'auto', background: 'var(--jarvis-s2)', borderLeft: '1px solid var(--jarvis-b)', padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--jarvis-ts)' }}>R-{String(risk.riskNumber).padStart(3,'0')} · {CATEGORY_ICON[risk.category]} {risk.category}</div>
            <h3 style={{ margin: '4px 0 0', fontSize: 15, fontWeight: 700, color: 'var(--jarvis-t)' }}>{risk.title}</h3>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--jarvis-ts)', cursor: 'pointer', fontSize: 18 }}>✕</button>
        </div>

        {/* Score badges */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 700, color: '#fff', background: scoreColor(risk.riskScore) }}>
            Score {risk.riskScore} — {scoreLabel(risk.riskScore)}
          </span>
          <span style={{ padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600, color: '#fff', background: STATUS_COLOR[risk.status] }}>
            {risk.status}
          </span>
          {risk.residualScore < risk.riskScore && (
            <span style={{ fontSize: 11, color: '#22c55e' }}>→ Residual: {risk.residualScore}</span>
          )}
        </div>

        {/* Grid details */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
          {[
            ['Probability',       `${risk.probability}/5`],
            ['Impact',            `${risk.impact}/5`],
            ['Cost Exposure',     fmt$(risk.costExposure)],
            ['Owner',             risk.owner ?? '—'],
            ['Identified',        risk.identifiedDate ? new Date(risk.identifiedDate).toLocaleDateString() : '—'],
            ['Target Date',       risk.targetDate     ? new Date(risk.targetDate).toLocaleDateString()     : '—'],
          ].map(([label, val]) => (
            <div key={label}>
              <div style={{ fontSize: 10, color: 'var(--jarvis-ts)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
              <div style={{ color: 'var(--jarvis-t)', marginTop: 2 }}>{val}</div>
            </div>
          ))}
        </div>

        {/* Description */}
        {risk.description && (
          <div style={{ fontSize: 12, color: 'var(--jarvis-ts)', background: 'var(--jarvis-s)', borderRadius: 6, padding: '8px 12px', lineHeight: 1.5 }}>
            {risk.description}
          </div>
        )}

        {/* Mitigation */}
        {(risk.mitigationPlan || risk.contingencyPlan) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {risk.mitigationPlan && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--jarvis-t)', marginBottom: 4 }}>Mitigation Plan</div>
                <div style={{ fontSize: 12, color: 'var(--jarvis-ts)', lineHeight: 1.5 }}>{risk.mitigationPlan}</div>
              </div>
            )}
            {risk.contingencyPlan && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--jarvis-t)', marginBottom: 4 }}>Contingency Plan</div>
                <div style={{ fontSize: 12, color: 'var(--jarvis-ts)', lineHeight: 1.5 }}>{risk.contingencyPlan}</div>
              </div>
            )}
          </div>
        )}

        {/* Edit form */}
        {editing && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--jarvis-s)', borderRadius: 8, padding: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {(['open','mitigating','accepted','closed','occurred'] as RiskStatus[]).length > 0 && (
                <div>
                  <label style={{ fontSize: 11, color: 'var(--jarvis-ts)', display: 'block', marginBottom: 3 }}>Status</label>
                  <select defaultValue={risk.status} onChange={e => set('status', e.target.value)} style={inputS}>
                    {(['open','mitigating','accepted','closed','occurred'] as RiskStatus[]).map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label style={{ fontSize: 11, color: 'var(--jarvis-ts)', display: 'block', marginBottom: 3 }}>Owner</label>
                <input defaultValue={risk.owner ?? ''} onChange={e => set('owner', e.target.value)} style={inputS} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--jarvis-ts)', display: 'block', marginBottom: 3 }}>Residual Prob.</label>
                <input type="number" min="1" max="5" defaultValue={risk.residualProbability ?? risk.probability} onChange={e => set('residualProbability', parseInt(e.target.value))} style={inputS} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--jarvis-ts)', display: 'block', marginBottom: 3 }}>Residual Impact</label>
                <input type="number" min="1" max="5" defaultValue={risk.residualImpact ?? risk.impact} onChange={e => set('residualImpact', parseInt(e.target.value))} style={inputS} />
              </div>
            </div>
            <div>
              <label style={{ fontSize: 11, color: 'var(--jarvis-ts)', display: 'block', marginBottom: 3 }}>Mitigation Plan</label>
              <textarea defaultValue={risk.mitigationPlan ?? ''} onChange={e => set('mitigationPlan', e.target.value)} rows={3} style={{ ...inputS, resize: 'vertical', fontFamily: 'inherit' }} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={save} disabled={saving} style={{ flex: 1, padding: '7px', borderRadius: 6, border: 'none', background: 'var(--jarvis-a)', color: '#fff', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
              <button onClick={() => { setEditing(false); setPatch({}) }} style={{ padding: '7px 14px', borderRadius: 6, border: '1px solid var(--jarvis-b)', background: 'none', color: 'var(--jarvis-ts)', cursor: 'pointer', fontSize: 12 }}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Actions */}
        {!editing && (
          <div style={{ display: 'flex', gap: 8, borderTop: '1px solid var(--jarvis-b)', paddingTop: 14 }}>
            <button onClick={() => setEditing(true)}
              style={{ padding: '7px 16px', borderRadius: 7, border: '1px solid var(--jarvis-b)', background: 'none', color: 'var(--jarvis-t)', cursor: 'pointer', fontSize: 13 }}>
              Edit
            </button>
            {risk.status !== 'closed' && risk.status !== 'occurred' && (
              <button onClick={() => onClose2(risk.id)}
                style={{ padding: '7px 16px', borderRadius: 7, border: '1px solid #22c55e', background: 'transparent', color: '#22c55e', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                ✓ Close Risk
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Add risk modal ───────────────────────────────────────────────────────────

const CATEGORIES: RiskCategory[] = ['schedule','cost','scope','safety','technical','regulatory','environmental','procurement','force_majeure','other']

function AddRiskModal({ projectId, onClose, onAdded }: { projectId: string; onClose: () => void; onAdded: () => void }) {
  const [form, setForm] = useState({
    title: '', category: 'schedule' as RiskCategory,
    probability: '3', impact: '3', costExposure: '', owner: '',
    description: '', mitigationPlan: '', targetDate: '',
  })
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState<string | null>(null)

  const set = (k: keyof typeof form, v: string) => setForm(f => ({ ...f, [k]: v }))
  const score = parseInt(form.probability) * parseInt(form.impact)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true); setError(null)
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/risks`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title:          form.title,
          category:       form.category,
          probability:    parseInt(form.probability),
          impact:         parseInt(form.impact),
          costExposure:   form.costExposure ? parseFloat(form.costExposure) : null,
          owner:          form.owner        || null,
          description:    form.description  || null,
          mitigationPlan: form.mitigationPlan || null,
          targetDate:     form.targetDate   || null,
        }),
      })
      if (!res.ok) throw new Error()
      onAdded(); onClose()
    } catch { setError('Failed to add risk') } finally { setSaving(false) }
  }

  const inputS: React.CSSProperties = { padding: '7px 10px', borderRadius: 6, border: '1px solid var(--jarvis-b)', background: 'var(--jarvis-s)', color: 'var(--jarvis-t)', fontSize: 13, width: '100%', boxSizing: 'border-box' }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <form onClick={e => e.stopPropagation()} onSubmit={submit}
        style={{ width: 480, maxHeight: '90vh', overflowY: 'auto', background: 'var(--jarvis-s2)', borderRadius: 12, padding: 24, display: 'flex', flexDirection: 'column', gap: 12, border: '1px solid var(--jarvis-b)' }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--jarvis-t)' }}>Add Risk</h3>
        {error && <div style={{ color: '#dc2626', fontSize: 12 }}>{error}</div>}

        <div>
          <label style={{ fontSize: 11, color: 'var(--jarvis-ts)', display: 'block', marginBottom: 3 }}>Title *</label>
          <input value={form.title} onChange={e => set('title', e.target.value)} required style={inputS} placeholder="e.g. Utility conflict at grid B3" />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <label style={{ fontSize: 11, color: 'var(--jarvis-ts)', display: 'block', marginBottom: 3 }}>Category</label>
            <select value={form.category} onChange={e => set('category', e.target.value as RiskCategory)} style={inputS}>
              {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_ICON[c]} {c.replace('_',' ')}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, color: 'var(--jarvis-ts)', display: 'block', marginBottom: 3 }}>Cost Exposure ($)</label>
            <input type="number" value={form.costExposure} onChange={e => set('costExposure', e.target.value)} style={inputS} placeholder="potential $ impact" />
          </div>

          <div>
            <label style={{ fontSize: 11, color: 'var(--jarvis-ts)', display: 'block', marginBottom: 3 }}>Probability (1–5)</label>
            <input type="range" min="1" max="5" value={form.probability} onChange={e => set('probability', e.target.value)} style={{ width: '100%' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--jarvis-ts)' }}>
              <span>Rare (1)</span><span style={{ fontWeight: 700 }}>{form.probability}</span><span>Certain (5)</span>
            </div>
          </div>

          <div>
            <label style={{ fontSize: 11, color: 'var(--jarvis-ts)', display: 'block', marginBottom: 3 }}>Impact (1–5)</label>
            <input type="range" min="1" max="5" value={form.impact} onChange={e => set('impact', e.target.value)} style={{ width: '100%' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--jarvis-ts)' }}>
              <span>Negligible (1)</span><span style={{ fontWeight: 700 }}>{form.impact}</span><span>Catastrophic (5)</span>
            </div>
          </div>

          <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 700, padding: '4px 12px', borderRadius: 99, background: `${scoreColor(score)}22`, color: scoreColor(score) }}>
              Risk Score: {score} — {scoreLabel(score)}
            </span>
          </div>

          <div>
            <label style={{ fontSize: 11, color: 'var(--jarvis-ts)', display: 'block', marginBottom: 3 }}>Owner</label>
            <input value={form.owner} onChange={e => set('owner', e.target.value)} style={inputS} />
          </div>
          <div>
            <label style={{ fontSize: 11, color: 'var(--jarvis-ts)', display: 'block', marginBottom: 3 }}>Target Date</label>
            <input type="date" value={form.targetDate} onChange={e => set('targetDate', e.target.value)} style={inputS} />
          </div>
        </div>

        <div>
          <label style={{ fontSize: 11, color: 'var(--jarvis-ts)', display: 'block', marginBottom: 3 }}>Description</label>
          <textarea value={form.description} onChange={e => set('description', e.target.value)} rows={2} style={{ ...inputS, resize: 'vertical', fontFamily: 'inherit' }} />
        </div>

        <div>
          <label style={{ fontSize: 11, color: 'var(--jarvis-ts)', display: 'block', marginBottom: 3 }}>Mitigation Plan</label>
          <textarea value={form.mitigationPlan} onChange={e => set('mitigationPlan', e.target.value)} rows={2} style={{ ...inputS, resize: 'vertical', fontFamily: 'inherit' }} />
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <button type="button" onClick={onClose} style={{ padding: '8px 16px', borderRadius: 7, border: '1px solid var(--jarvis-b)', background: 'none', color: 'var(--jarvis-t)', cursor: 'pointer' }}>Cancel</button>
          <button type="submit" disabled={saving || !form.title} style={{ padding: '8px 18px', borderRadius: 7, border: 'none', background: 'var(--jarvis-a)', color: '#fff', fontWeight: 600, cursor: 'pointer', opacity: saving ? .7 : 1 }}>
            {saving ? 'Adding…' : 'Add Risk'}
          </button>
        </div>
      </form>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

interface Props {
  policy?:     Record<string, unknown>
  biz?:        Record<string, unknown>
  onNavigate?: (tab: string) => void
}

export default function RiskRegisterView({ biz }: Props) {
  const projects = (() => { try { return (biz?.projects as {id:string;name:string}[]) ?? [] } catch { return [] } })()
  const [projectId,  setProjectId]  = useState(projects[0]?.id ?? 'demo')
  const [risks,      setRisks]      = useState<Risk[]>([])
  const [summary,    setSummary]    = useState<RiskSummary | null>(null)
  const [selected,   setSelected]   = useState<Risk | null>(null)
  const [showAdd,    setShowAdd]    = useState(false)
  const [loading,    setLoading]    = useState(false)
  const [filterStatus,   setFilterStatus]   = useState<RiskStatus | 'all'>('all')
  const [filterSeverity, setFilterSeverity] = useState<'all'|'critical'|'high'|'medium'|'low'>('all')
  const [view,           setView]           = useState<'matrix' | 'list'>('matrix')

  const load = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filterStatus !== 'all') params.set('status', filterStatus)
      const [rRes, sRes] = await Promise.all([
        fetch(`/api/v1/projects/${projectId}/risks?${params}`),
        fetch(`/api/v1/projects/${projectId}/risks/summary`),
      ])
      const rData = await rRes.json() as { risks: Risk[] }
      const sData = await sRes.json() as { summary: RiskSummary }
      setRisks(rData.risks ?? [])
      setSummary(sData.summary)
    } catch { /* ignore */ } finally { setLoading(false) }
  }, [projectId, filterStatus])

  useEffect(() => { load() }, [load])
  useEffect(() => { setFilterStatus('all'); setFilterSeverity('all') }, [projectId])

  const handleUpdate = async (patch: Record<string, unknown>) => {
    if (!selected) return
    try {
      await fetch(`/api/v1/risks/${selected.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
      })
      await load()
      setSelected(null)
    } catch { /* ignore — load will show stale data */ }
  }

  const handleClose = async (id: string) => {
    try {
      await fetch(`/api/v1/risks/${id}/close`, { method: 'POST' })
      await load()
      setSelected(null)
    } catch { /* ignore */ }
  }

  const displayRisks = risks.filter(r => {
    if (filterSeverity === 'critical') return r.riskScore >= 15
    if (filterSeverity === 'high')     return r.riskScore >= 9 && r.riskScore < 15
    if (filterSeverity === 'medium')   return r.riskScore >= 4 && r.riskScore < 9
    if (filterSeverity === 'low')      return r.riskScore < 4
    return true
  })

  const btnS = (active: boolean): React.CSSProperties => ({
    padding: '5px 12px', borderRadius: 5, fontSize: 12, cursor: 'pointer',
    border: '1px solid var(--jarvis-b)', fontWeight: active ? 600 : 400,
    background: active ? 'var(--jarvis-a)' : 'var(--jarvis-s2)',
    color:      active ? '#fff'            : 'var(--jarvis-t)',
  })

  return (
    <div style={{ padding: 24, maxWidth: 1060, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--jarvis-t)' }}>Risk Register</h2>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--jarvis-ts)' }}>Identify · Assess · Mitigate · Track</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {projects.length > 0 && (
            <select value={projectId} onChange={e => setProjectId(e.target.value)} style={{ ...btnS(false), padding: '6px 10px' }}>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <button style={btnS(view === 'matrix')} onClick={() => setView('matrix')}>⊞ Matrix</button>
          <button style={btnS(view === 'list')}   onClick={() => setView('list')}>≡ List</button>
          {(['all','open','mitigating','accepted','closed'] as const).map(s => (
            <button key={s} style={btnS(filterStatus === s)} onClick={() => setFilterStatus(s)}>
              {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
          <button onClick={() => setShowAdd(true)}
            style={{ padding: '7px 16px', borderRadius: 7, border: 'none', background: 'var(--jarvis-a)', color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
            + Add Risk
          </button>
        </div>
      </div>

      {/* Summary strip */}
      {summary && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {([
            ['Total Risks', String(summary.total),     'var(--jarvis-t)', () => { setFilterStatus('all'); setFilterSeverity('all') }],
            ['Critical',    String(summary.critical),  '#dc2626',         () => { setFilterSeverity('critical'); setView('list') }],
            ['High',        String(summary.high),      '#f97316',         () => { setFilterSeverity('high');     setView('list') }],
            ['Medium',      String(summary.medium),    '#f59e0b',         () => { setFilterSeverity('medium');   setView('list') }],
            ['Low',         String(summary.low),       '#22c55e',         () => { setFilterSeverity('low');      setView('list') }],
            ['Exposure',    fmt$(summary.totalExposure > 0 ? summary.totalExposure : null), '#ef4444', null],
            ['Open',        String(summary.open),      '#3b82f6',         () => { setFilterStatus('open');       setFilterSeverity('all') }],
            ['Mitigating',  String(summary.mitigating),'#f59e0b',         () => { setFilterStatus('mitigating'); setFilterSeverity('all') }],
          ] as [string, string, string, (() => void) | null][]).map(([label, val, color, action]) => (
            <div key={label} onClick={action ?? undefined}
              style={{ flex: '1 1 80px', background: 'var(--jarvis-s2)', border: '1px solid var(--jarvis-b)', borderRadius: 8, padding: '8px 12px', cursor: action ? 'pointer' : 'default' }}
              onMouseEnter={action ? e => (e.currentTarget.style.opacity = '.75') : undefined}
              onMouseLeave={action ? e => (e.currentTarget.style.opacity = '1') : undefined}
            >
              <div style={{ fontSize: 10, color: 'var(--jarvis-ts)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color, marginTop: 2 }}>{val}</div>
            </div>
          ))}
        </div>
      )}

      {/* Matrix view */}
      {view === 'matrix' && (
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div style={{ flex: '0 0 auto', background: 'var(--jarvis-s2)', border: '1px solid var(--jarvis-b)', borderRadius: 10, padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--jarvis-t)', marginBottom: 10 }}>
              5×5 Risk Matrix <span style={{ fontWeight: 400, color: 'var(--jarvis-ts)', fontSize: 11 }}>click a dot to view</span>
            </div>
            <RiskMatrix risks={displayRisks} onSelect={setSelected} />
            <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
              {[['Critical','#dc2626'],['High','#f97316'],['Medium','#f59e0b'],['Low','#22c55e']].map(([label, color]) => (
                <span key={label} style={{ fontSize: 10, color: 'var(--jarvis-ts)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block' }} />{label}
                </span>
              ))}
            </div>
          </div>
          {/* Top risks sidebar */}
          <div style={{ flex: '1 1 240px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--jarvis-t)' }}>Top Risks by Score</div>
            {displayRisks.filter(r => r.status !== 'closed').slice(0, 8).map(r => (
              <div key={r.id} onClick={() => setSelected(r)}
                style={{ background: 'var(--jarvis-s2)', border: '1px solid var(--jarvis-b)', borderRadius: 8, padding: '10px 12px', cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'center' }}>
                <span style={{ fontSize: 13, fontWeight: 700, minWidth: 28, textAlign: 'center', color: scoreColor(r.riskScore), background: `${scoreColor(r.riskScore)}22`, borderRadius: 4, padding: '2px 4px' }}>
                  {r.riskScore}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--jarvis-t)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</div>
                  <div style={{ fontSize: 10, color: 'var(--jarvis-ts)', marginTop: 1 }}>{CATEGORY_ICON[r.category]} {r.category} · P{r.probability}×I{r.impact}</div>
                </div>
                <span style={{ padding: '2px 7px', borderRadius: 99, fontSize: 10, fontWeight: 600, color: '#fff', background: STATUS_COLOR[r.status], flexShrink: 0 }}>
                  {r.status}
                </span>
              </div>
            ))}
            {displayRisks.filter(r => r.status !== 'closed').length === 0 && !loading && (
              <div style={{ fontSize: 12, color: 'var(--jarvis-ts)', padding: '20px 0', textAlign: 'center' }}>No open risks. Add one above.</div>
            )}
          </div>
        </div>
      )}

      {/* List view */}
      {view === 'list' && (
        <div style={{ background: 'var(--jarvis-s2)', border: '1px solid var(--jarvis-b)', borderRadius: 10, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--jarvis-b)' }}>
                {['#','Title','Category','P','I','Score','Exposure','Owner','Status'].map(h => (
                  <th key={h} style={{ padding: '9px 10px', textAlign: 'left', color: 'var(--jarvis-ts)', fontWeight: 600, fontSize: 11, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayRisks.map(r => (
                <tr key={r.id} onClick={() => setSelected(r)} style={{ borderBottom: '1px solid var(--jarvis-b)', cursor: 'pointer' }}>
                  <td style={{ padding: '8px 10px', color: 'var(--jarvis-ts)' }}>R-{String(r.riskNumber).padStart(3,'0')}</td>
                  <td style={{ padding: '8px 10px', color: 'var(--jarvis-t)', fontWeight: 500, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</td>
                  <td style={{ padding: '8px 10px', color: 'var(--jarvis-ts)' }}>{CATEGORY_ICON[r.category]} {r.category}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'center', color: 'var(--jarvis-ts)' }}>{r.probability}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'center', color: 'var(--jarvis-ts)' }}>{r.impact}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                    <span style={{ padding: '2px 8px', borderRadius: 99, fontWeight: 700, fontSize: 11, color: '#fff', background: scoreColor(r.riskScore) }}>{r.riskScore}</span>
                  </td>
                  <td style={{ padding: '8px 10px', color: 'var(--jarvis-ts)' }}>{fmt$(r.costExposure)}</td>
                  <td style={{ padding: '8px 10px', color: 'var(--jarvis-ts)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.owner ?? '—'}</td>
                  <td style={{ padding: '8px 10px' }}>
                    <span style={{ padding: '2px 8px', borderRadius: 99, fontSize: 10, fontWeight: 600, color: '#fff', background: STATUS_COLOR[r.status] }}>{r.status}</span>
                  </td>
                </tr>
              ))}
              {risks.length === 0 && !loading && (
                <tr><td colSpan={9} style={{ padding: 32, textAlign: 'center', color: 'var(--jarvis-ts)' }}>No risks yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {selected && <DetailPanel risk={selected} onClose={() => setSelected(null)} onUpdate={handleUpdate} onClose2={handleClose} />}
      {showAdd   && <AddRiskModal projectId={projectId} onClose={() => setShowAdd(false)} onAdded={load} />}
    </div>
  )
}
