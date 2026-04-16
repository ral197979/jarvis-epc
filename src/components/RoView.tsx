/**
 * JARVIS EPC — RoView · Risk Overview  (v4.28.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * Replaces the incident-derived proxy with the proper risks table.
 *
 * Panels:
 *   1. KPI strip    — open / critical / high / medium / low counts + avg score
 *   2. 5×5 Risk Heatmap — likelihood × impact matrix with cell-click filter
 *   3. Risk Register — paginated, searchable, filterable table with add/edit
 *
 * Data flow:
 *   - Reads from GET /api/v1/projects/:projectId/risks and /risks/matrix
 *   - Falls back to biz store incidents if no project selected
 *   - Writes via POST /api/v1/projects/:projectId/risks
 *
 * Offline / biz-store mode remains for field use without connectivity.
 */

import React, { useState, useMemo, useEffect, useCallback } from 'react'
import { useBizStore, selectProjects } from '../modules/biz/store'
import { KpiCard }     from './KpiCard'
import { StatusBadge } from './StatusBadge'
import type { PolicyConfig } from '../modules/biz/dispatch'

// ─── Types ────────────────────────────────────────────────────────────────────

type Likelihood = 'rare' | 'unlikely' | 'possible' | 'likely' | 'almost_certain'
type Impact     = 'negligible' | 'minor' | 'moderate' | 'major' | 'catastrophic'
type RiskBand   = 'low' | 'medium' | 'high' | 'critical'

interface Risk {
  id:           string
  risk_number:  string
  title:        string
  description?: string
  category?:    string
  likelihood:   Likelihood
  impact:       Impact
  risk_score:   number
  band:         RiskBand
  mitigation?:  string
  contingency?: string
  owner_name?:  string
  status:       string
  created_at:   string
  updated_at:   string
}

interface MatrixCell {
  likelihood: Likelihood; impact: Impact
  score: number; band: RiskBand
  count: number; avg_score: number
}

interface RiskStats {
  summary:   { open: string; closed: string; critical: string; high: string; avg_score: string }
  by_band:   { low: string; medium: string; high: string; critical: string }
  top_risks: Risk[]
}

export interface RoViewProps {
  policy?:   Partial<PolicyConfig>
  onToast?:  (msg: string, type: string) => void
  onAudit?:  (entry: unknown) => void
  biz?:      Record<string, unknown>
}

// ─── Constants ────────────────────────────────────────────────────────────────

const LIKELIHOOD_LABELS: Record<Likelihood, string> = {
  rare: 'Rare', unlikely: 'Unlikely', possible: 'Possible',
  likely: 'Likely', almost_certain: 'Almost Certain',
}
const IMPACT_LABELS: Record<Impact, string> = {
  negligible: 'Negligible', minor: 'Minor', moderate: 'Moderate',
  major: 'Major', catastrophic: 'Catastrophic',
}

const BAND_COLOR: Record<RiskBand, { bg: string; fg: string; border: string }> = {
  low:      { bg: '#D1FAE5', fg: '#065F46', border: '#6EE7B7' },
  medium:   { bg: '#FEF3C7', fg: '#92400E', border: '#FCD34D' },
  high:     { bg: '#FEE2E2', fg: '#991B1B', border: '#FCA5A5' },
  critical: { bg: '#FF2D2D', fg: '#FFFFFF', border: '#DC2626' },
}

const LIKELIHOOD_ORDER: Likelihood[] = ['almost_certain','likely','possible','unlikely','rare']
const IMPACT_ORDER:     Impact[]     = ['negligible','minor','moderate','major','catastrophic']

const CATEGORIES = ['Schedule','Cost','Technical','Safety','Environmental','Commercial','Regulatory','Force Majeure']

const EMPTY_FORM = {
  title: '', description: '', category: '', likelihood: 'possible' as Likelihood,
  impact: 'moderate' as Impact, mitigation: '', contingency: '', owner: '',
}

// ─── Component ────────────────────────────────────────────────────────────────

export function RoView({ policy: pProp, onToast, onAudit }: RoViewProps) {
  const policy   = { writesEnabled: false, activeRole: 'viewer', ...pProp }
  const canWrite = policy.writesEnabled && policy.activeRole !== 'viewer'

  // Project selection
  const projects  = useBizStore(selectProjects)
  const [selectedProject, setSelectedProject] = useState<string>('')

  // Remote data
  const [risks,      setRisks]      = useState<Risk[]>([])
  const [matrix,     setMatrix]     = useState<MatrixCell[][] | null>(null)
  const [stats,      setStats]      = useState<RiskStats | null>(null)
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState<string | null>(null)

  // UI state
  const [search,     setSearch]     = useState('')
  const [filterBand, setFilterBand] = useState<RiskBand | ''>('')
  const [filterCell, setFilterCell] = useState<{ l: Likelihood; i: Impact } | null>(null)
  const [showAdd,    setShowAdd]    = useState(false)
  const [form,       setForm]       = useState({ ...EMPTY_FORM })
  const [saving,     setSaving]     = useState(false)
  const [activeTab,  setActiveTab]  = useState<'matrix' | 'register'>('matrix')

  // ── Data fetching ──────────────────────────────────────────────────────────

  const loadRisks = useCallback(async (projectId: string) => {
    if (!projectId) return
    setLoading(true); setError(null)
    try {
      const [rRes, mRes, sRes] = await Promise.all([
        fetch(`/api/v1/projects/${projectId}/risks?limit=100`),
        fetch(`/api/v1/projects/${projectId}/risks/matrix`),
        fetch(`/api/v1/projects/${projectId}/risks/stats`),
      ])
      if (rRes.ok) { const d = await rRes.json(); setRisks(d.risks ?? []) }
      if (mRes.ok) { const d = await mRes.json(); setMatrix(d.matrix ?? null) }
      if (sRes.ok) { const d = await sRes.json(); setStats(d) }
    } catch { setError('Could not reach the API — showing local data only.') }
    finally   { setLoading(false) }
  }, [])

  useEffect(() => { if (selectedProject) loadRisks(selectedProject) }, [selectedProject, loadRisks])

  // ── Fallback biz-store risks (for offline / no project) ──────────────────

  const storeIncidents = useBizStore(s => s.biz.incidents ?? []) as Record<string, unknown>[]
  const storeRisks: Risk[] = useMemo(() => selectedProject ? risks : storeIncidents.map((inc, i) => ({
    id:          String(inc['id'] ?? i),
    risk_number: `RSK-${String(i + 1).padStart(3, '0')}`,
    title:       String(inc['title'] ?? inc['description'] ?? 'Untitled'),
    category:    'Safety',
    likelihood:  'possible' as Likelihood,
    impact:      inc['severity'] === 'high' ? 'major' as Impact : 'moderate' as Impact,
    risk_score:  inc['severity'] === 'high' ? 12 : 9,
    band:        inc['severity'] === 'high' ? 'high' : 'medium' as RiskBand,
    status:      String(inc['status'] ?? 'open'),
    created_at:  String(inc['date'] ?? new Date().toISOString()),
    updated_at:  String(inc['date'] ?? new Date().toISOString()),
  })), [selectedProject, risks, storeIncidents])

  const displayRisks = selectedProject ? risks : storeRisks

  // ── Filtered risks ─────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    let r = displayRisks
    if (search)     r = r.filter(x => x.title.toLowerCase().includes(search.toLowerCase()) || (x.category ?? '').toLowerCase().includes(search.toLowerCase()))
    if (filterBand) r = r.filter(x => x.band === filterBand)
    if (filterCell) r = r.filter(x => x.likelihood === filterCell.l && x.impact === filterCell.i)
    return r
  }, [displayRisks, search, filterBand, filterCell])

  // ── KPIs ──────────────────────────────────────────────────────────────────

  const kpis = useMemo(() => {
    if (stats) return {
      open:     parseInt(stats.summary.open),
      critical: parseInt(stats.summary.critical),
      high:     parseInt(stats.by_band.high),
      medium:   parseInt(stats.by_band.medium),
      low:      parseInt(stats.by_band.low),
      avg:      parseFloat(stats.summary.avg_score) || 0,
    }
    return {
      open:     displayRisks.filter(r => r.status !== 'closed').length,
      critical: displayRisks.filter(r => r.band === 'critical').length,
      high:     displayRisks.filter(r => r.band === 'high').length,
      medium:   displayRisks.filter(r => r.band === 'medium').length,
      low:      displayRisks.filter(r => r.band === 'low').length,
      avg:      displayRisks.length ? displayRisks.reduce((s, r) => s + (r.risk_score ?? 0), 0) / displayRisks.length : 0,
    }
  }, [stats, displayRisks])

  // ── Add risk ───────────────────────────────────────────────────────────────

  async function handleAdd() {
    if (!form.title) return
    setSaving(true)
    try {
      if (selectedProject) {
        const res = await fetch(`/api/v1/projects/${selectedProject}/risks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        })
        if (res.ok) {
          onToast?.('Risk added to register', 'success')
          onAudit?.({ action: 'add_risk', data: form })
          setForm({ ...EMPTY_FORM }); setShowAdd(false)
          await loadRisks(selectedProject)
        } else {
          const e = await res.json()
          onToast?.(e.error ?? 'Save failed', 'error')
        }
      } else {
        onToast?.('Select a project to save risks to the database', 'info')
      }
    } finally { setSaving(false) }
  }

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div role="main" aria-label="Risk Overview">

      {/* ── Project selector ─────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <select
          className="jarvis-input"
          style={{ maxWidth: 320 }}
          value={selectedProject}
          onChange={e => { setSelectedProject(e.target.value); setFilterCell(null) }}
          aria-label="Select project"
        >
          <option value="">— Biz store (no project) —</option>
          {(projects as { id: string; name?: string; code?: string }[]).map(p => (
            <option key={p.id} value={p.id}>{p.code ? `[${p.code}] ` : ''}{p.name ?? p.id}</option>
          ))}
        </select>
        {loading && <span className="jarvis-small" style={{ color: 'var(--jarvis-ts)' }}>Loading…</span>}
        {error   && <span className="jarvis-small" style={{ color: 'var(--jarvis-red)' }}>{error}</span>}
      </div>

      {/* ── KPI strip ────────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 8, marginBottom: 20 }}>
        <KpiCard label="Open"      value={kpis.open}     />
        <KpiCard label="Critical"  value={kpis.critical}  color={kpis.critical > 0 ? BAND_COLOR.critical.fg : 'var(--jarvis-grn)'} />
        <KpiCard label="High"      value={kpis.high}      color={kpis.high > 0 ? BAND_COLOR.high.fg : 'var(--jarvis-grn)'} />
        <KpiCard label="Medium"    value={kpis.medium}    color={kpis.medium > 0 ? BAND_COLOR.medium.fg : 'var(--jarvis-grn)'} />
        <KpiCard label="Low"       value={kpis.low}       color="var(--jarvis-grn)" />
        <KpiCard label="Avg Score" value={kpis.avg.toFixed(1)} color="var(--jarvis-blue)" />
      </div>

      {/* ── Tabs ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '2px solid var(--jarvis-bd)' }}>
        {(['matrix','register'] as const).map(t => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            style={{
              padding: '8px 20px', fontSize: 13, fontWeight: activeTab === t ? 700 : 400,
              background: 'none', border: 'none', cursor: 'pointer',
              borderBottom: activeTab === t ? '2px solid var(--jarvis-ac)' : '2px solid transparent',
              color: activeTab === t ? 'var(--jarvis-ac)' : 'var(--jarvis-ts)',
              marginBottom: -2,
            }}
          >
            {t === 'matrix' ? '🔶 Risk Matrix' : '📋 Risk Register'}
          </button>
        ))}
        {canWrite && (
          <button
            className="jarvis-btn jarvis-btn-primary"
            style={{ marginLeft: 'auto', marginBottom: 4 }}
            onClick={() => { setShowAdd(v => !v); setActiveTab('register') }}
          >
            + Add Risk
          </button>
        )}
      </div>

      {/* ── 5×5 Heatmap ─────────────────────────────────────────────────── */}
      {activeTab === 'matrix' && (
        <div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 540 }}>
              <thead>
                <tr>
                  <th style={thStyle}>Likelihood ↓ / Impact →</th>
                  {IMPACT_ORDER.map(im => (
                    <th key={im} style={{ ...thStyle, textAlign: 'center', fontSize: 11, fontWeight: 600 }}>
                      {IMPACT_LABELS[im]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {LIKELIHOOD_ORDER.map(lk => (
                  <tr key={lk}>
                    <td style={{ ...thStyle, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {LIKELIHOOD_LABELS[lk]}
                    </td>
                    {IMPACT_ORDER.map(im => {
                      const cell = matrix
                        ? matrix.find(row => row.find(c => c.likelihood === lk && c.impact === im))
                              ?.find(c => c.likelihood === lk && c.impact === im)
                        : null
                      const score = cell?.score ?? (LIKELIHOOD_ORDER.indexOf(lk) * IMPACT_ORDER.indexOf(im))
                      const band  = cell?.band ?? bandFromScore(score)
                      const cols  = BAND_COLOR[band]
                      const count = cell?.count ?? 0
                      const isActive = filterCell?.l === lk && filterCell?.i === im
                      return (
                        <td
                          key={im}
                          onClick={() => setFilterCell(isActive ? null : { l: lk, i: im })}
                          style={{
                            background: cols.bg, color: cols.fg,
                            border: isActive ? `3px solid ${cols.fg}` : `1px solid ${cols.border}`,
                            textAlign: 'center', padding: '10px 6px',
                            cursor: 'pointer', minWidth: 80,
                            fontWeight: isActive ? 700 : 400,
                            transition: 'all 0.1s',
                          }}
                          title={`${LIKELIHOOD_LABELS[lk]} × ${IMPACT_LABELS[im]} — Score ${score} (${band})`}
                          aria-label={`${lk} ${im} — ${count} risks`}
                        >
                          <div style={{ fontSize: 16, fontWeight: 700 }}>{count || ''}</div>
                          <div style={{ fontSize: 9, opacity: 0.8 }}>{score}</div>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
            {(['low','medium','high','critical'] as RiskBand[]).map(b => (
              <div key={b} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                <span style={{ width: 14, height: 14, borderRadius: 3, display: 'inline-block',
                  background: BAND_COLOR[b].bg, border: `1px solid ${BAND_COLOR[b].border}` }} />
                <span style={{ color: BAND_COLOR[b].fg, fontWeight: 600, textTransform: 'capitalize' }}>{b}</span>
              </div>
            ))}
            {filterCell && (
              <button className="jarvis-btn jarvis-btn-ghost" style={{ fontSize: 11, padding: '2px 8px' }}
                onClick={() => setFilterCell(null)}>
                ✕ Clear cell filter
              </button>
            )}
          </div>

          {/* Top risks from stats */}
          {stats && (stats.top_risks?.length ?? 0) > 0 && (
            <div style={{ marginTop: 24 }}>
              <h4 className="jarvis-label" style={{ marginBottom: 10 }}>Top Risks by Score</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {stats.top_risks!.map(r => (
                  <div key={r.id} className="jarvis-card"
                    style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}
                    onClick={() => setActiveTab('register')}
                  >
                    <span style={{ fontFamily: 'var(--jarvis-font-mono)', fontSize: 11, color: 'var(--jarvis-ts)', minWidth: 64 }}>
                      {r.risk_number}
                    </span>
                    <span style={{ flex: 1, fontWeight: 600, fontSize: 13 }}>{r.title}</span>
                    <BandBadge band={r.band} score={r.risk_score} />
                    <StatusBadge status={r.status} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Risk Register ────────────────────────────────────────────────── */}
      {activeTab === 'register' && (
        <div>
          {/* Add form */}
          {showAdd && canWrite && (
            <div className="jarvis-card" style={{ padding: 18, marginBottom: 20 }}>
              <h4 className="jarvis-label" style={{ marginBottom: 14 }}>Register New Risk</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
                <Field label="Risk Title *" id="r-title">
                  <input id="r-title" className="jarvis-input" value={form.title}
                    onChange={e => setForm(f => ({...f, title: e.target.value}))} />
                </Field>
                <Field label="Likelihood" id="r-lk">
                  <select id="r-lk" className="jarvis-input" value={form.likelihood}
                    onChange={e => setForm(f => ({...f, likelihood: e.target.value as Likelihood}))}>
                    {LIKELIHOOD_ORDER.slice().reverse().map(l => (
                      <option key={l} value={l}>{LIKELIHOOD_LABELS[l]}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Impact" id="r-im">
                  <select id="r-im" className="jarvis-input" value={form.impact}
                    onChange={e => setForm(f => ({...f, impact: e.target.value as Impact}))}>
                    {IMPACT_ORDER.map(i => (
                      <option key={i} value={i}>{IMPACT_LABELS[i]}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <Field label="Category" id="r-cat">
                  <select id="r-cat" className="jarvis-input" value={form.category}
                    onChange={e => setForm(f => ({...f, category: e.target.value}))}>
                    <option value="">— Select —</option>
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Field>
                <Field label="Risk Owner" id="r-own">
                  <input id="r-own" className="jarvis-input" value={form.owner}
                    onChange={e => setForm(f => ({...f, owner: e.target.value}))} />
                </Field>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                <Field label="Mitigation Plan" id="r-mit">
                  <textarea id="r-mit" className="jarvis-input" rows={3} value={form.mitigation}
                    onChange={e => setForm(f => ({...f, mitigation: e.target.value}))} />
                </Field>
                <Field label="Contingency Plan" id="r-con">
                  <textarea id="r-con" className="jarvis-input" rows={3} value={form.contingency}
                    onChange={e => setForm(f => ({...f, contingency: e.target.value}))} />
                </Field>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button className="jarvis-btn jarvis-btn-primary" onClick={handleAdd} disabled={saving || !form.title}>
                  {saving ? 'Saving…' : 'Save Risk'}
                </button>
                <button className="jarvis-btn jarvis-btn-ghost" onClick={() => { setShowAdd(false); setForm({...EMPTY_FORM}) }}>
                  Cancel
                </button>
                {!selectedProject && (
                  <span className="jarvis-small" style={{ color: 'var(--jarvis-amb)' }}>
                    ⚠ Select a project above to persist to database
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Filters */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            <input className="jarvis-input" style={{ flex: 1, minWidth: 160 }} type="search"
              placeholder="Search risks…" value={search}
              onChange={e => { setSearch(e.target.value); setFilterCell(null) }} />
            <select className="jarvis-input" style={{ width: 120 }} value={filterBand}
              onChange={e => setFilterBand(e.target.value as RiskBand | '')}>
              <option value="">All bands</option>
              {(['critical','high','medium','low'] as RiskBand[]).map(b => (
                <option key={b} value={b}>{b.charAt(0).toUpperCase() + b.slice(1)}</option>
              ))}
            </select>
            {(filterCell || filterBand) && (
              <button className="jarvis-btn jarvis-btn-ghost" style={{ fontSize: 11 }}
                onClick={() => { setFilterBand(''); setFilterCell(null) }}>
                ✕ Clear filters
              </button>
            )}
            <span className="jarvis-small" style={{ color: 'var(--jarvis-ts)', marginLeft: 'auto' }}>
              {filtered.length} risk{filtered.length !== 1 ? 's' : ''}
              {filterCell ? ` matching ${LIKELIHOOD_LABELS[filterCell.l]} × ${IMPACT_LABELS[filterCell.i]}` : ''}
            </span>
          </div>

          {/* Table */}
          {filtered.length === 0 ? (
            <div className="jarvis-empty">
              <span className="jarvis-empty-icon">✅</span>
              <span>{search || filterBand || filterCell ? 'No risks match your filters' : 'No open risks — project is clean'}</span>
            </div>
          ) : (
            <div className="jarvis-scroll-y jarvis-max-h-lg">
              <table className="jarvis-table" aria-label="Risk register">
                <thead>
                  <tr>
                    <th>No.</th><th>Risk Title</th><th>Category</th>
                    <th>Likelihood</th><th>Impact</th><th>Score</th>
                    <th>Mitigation</th><th>Owner</th><th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(risk => (
                    <tr key={risk.id}>
                      <td style={{ fontFamily: 'var(--jarvis-font-mono)', fontSize: 11, whiteSpace: 'nowrap' }}>
                        {risk.risk_number}
                      </td>
                      <td style={{ fontWeight: 600, maxWidth: 200 }}>{risk.title}</td>
                      <td style={{ fontSize: 12 }}>{risk.category ?? '—'}</td>
                      <td style={{ fontSize: 11 }}>{LIKELIHOOD_LABELS[risk.likelihood] ?? risk.likelihood}</td>
                      <td style={{ fontSize: 11 }}>{IMPACT_LABELS[risk.impact] ?? risk.impact}</td>
                      <td><BandBadge band={risk.band} score={risk.risk_score} /></td>
                      <td style={{ maxWidth: 180, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {risk.mitigation ?? '—'}
                      </td>
                      <td style={{ fontSize: 12 }}>{risk.owner_name ?? '—'}</td>
                      <td><StatusBadge status={risk.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function BandBadge({ band, score }: { band: RiskBand; score: number }) {
  const c = BAND_COLOR[band]
  return (
    <span style={{
      background: c.bg, color: c.fg, border: `1px solid ${c.border}`,
      borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 700,
      display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap',
    }}>
      {score} {band.toUpperCase()}
    </span>
  )
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="jarvis-small" htmlFor={id} style={{ display: 'block', marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  )
}

const thStyle: React.CSSProperties = {
  padding: '8px 10px', background: 'var(--jarvis-bg2)', fontSize: 11,
  fontWeight: 600, textAlign: 'left', border: '1px solid var(--jarvis-bd)',
}

function bandFromScore(score: number): RiskBand {
  if (score <= 4) return 'low'
  if (score <= 9) return 'medium'
  if (score <= 16) return 'high'
  return 'critical'
}

export default RoView
