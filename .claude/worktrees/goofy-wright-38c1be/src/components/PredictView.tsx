/**
 * JARVIS EPC — PredictView  ·  AI-Powered Project Predictions  (G2 / P5)
 * Cost variance forecast · Schedule slip prediction · Risk heat map · Ask AI
 */
import React, { useState, useCallback, useEffect } from 'react'
import { useBizStore } from '../modules/biz/store'
import type { PolicyConfig } from '../modules/biz/dispatch'

export interface PredictViewProps { policy?: Partial<PolicyConfig> }

// ─── Types ────────────────────────────────────────────────────────────────────

interface Prediction {
  id: string
  project_name: string
  cost_variance_pct: number   // positive = over-run
  schedule_slip_days: number  // positive = behind
  risk_score: number          // 0–100
  confidence: number          // 0–1
  top_risks: string[]
  updated_at: string
}

interface AskResult { answer: string; sources?: string[] }

// ─── Demo data ────────────────────────────────────────────────────────────────

const DEMO_PREDICTIONS: Prediction[] = [
  {
    id: 'p1', project_name: 'Offshore Platform A-7', cost_variance_pct: 12.4,
    schedule_slip_days: 18, risk_score: 74, confidence: 0.82,
    top_risks: ['Procurement delay — valve lead time +6 wk', 'Weather window: Q3 offshore exposure', 'Steel price escalation (+8%)'],
    updated_at: new Date(Date.now() - 3_600_000).toISOString(),
  },
  {
    id: 'p2', project_name: 'Refinery Unit 5 Expansion', cost_variance_pct: -2.1,
    schedule_slip_days: 0, risk_score: 31, confidence: 0.91,
    top_risks: ['Instrument calibration backlog', 'Permit extension pending'],
    updated_at: new Date(Date.now() - 7_200_000).toISOString(),
  },
  {
    id: 'p3', project_name: 'Substation Upgrade – Grid 3', cost_variance_pct: 5.7,
    schedule_slip_days: 7, risk_score: 52, confidence: 0.78,
    top_risks: ['Transformer delivery at risk', 'Skilled electrician shortage', 'Utility coordination delays'],
    updated_at: new Date(Date.now() - 10_800_000).toISOString(),
  },
  {
    id: 'p4', project_name: 'Pipeline Integrity Program', cost_variance_pct: 0.3,
    schedule_slip_days: 0, risk_score: 22, confidence: 0.95,
    top_risks: ['ILI tool availability window'],
    updated_at: new Date(Date.now() - 14_400_000).toISOString(),
  },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function riskColor(score: number) {
  if (score >= 70) return '#e74c3c'
  if (score >= 45) return '#f39c12'
  return '#2ecc71'
}

function riskLabel(score: number) {
  if (score >= 70) return 'High'
  if (score >= 45) return 'Medium'
  return 'Low'
}

function cvColor(pct: number) {
  if (pct > 10) return '#e74c3c'
  if (pct > 3) return '#f39c12'
  if (pct < -1) return '#2ecc71'
  return 'var(--jarvis-tx)'
}

function timeAgo(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60) return `${Math.round(diff)}s ago`
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`
  return `${Math.round(diff / 3600)}h ago`
}

// ─── RiskHeatMap ─────────────────────────────────────────────────────────────

function RiskHeatMap({ predictions }: { predictions: Prediction[] }) {
  const maxSlip = Math.max(...predictions.map(p => p.schedule_slip_days), 1)
  const maxCV   = Math.max(...predictions.map(p => Math.abs(p.cost_variance_pct)), 1)

  return (
    <div style={{ position: 'relative', width: '100%', height: 260, background: 'var(--jarvis-bg2)', borderRadius: 8, border: '1px solid var(--jarvis-bd)', overflow: 'hidden' }}>
      {/* Axes labels */}
      <div style={{ position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)', fontSize: 10, color: 'var(--jarvis-ts)' }}>Schedule Slip (days) →</div>
      <div style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%) rotate(-90deg)', fontSize: 10, color: 'var(--jarvis-ts)', transformOrigin: 'center' }}>Cost Variance (%) ↑</div>

      {/* Quadrant background */}
      <div style={{ position: 'absolute', right: 0, top: 0, width: '50%', height: '50%', background: 'rgba(231,76,60,0.06)' }} />
      <div style={{ position: 'absolute', left: '50%', right: 0, bottom: 0, height: '50%', background: 'rgba(243,156,18,0.05)' }} />

      {/* Center crosshair */}
      <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: 'var(--jarvis-bd)' }} />
      <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 1, background: 'var(--jarvis-bd)' }} />

      {/* Data points */}
      {predictions.map(p => {
        const x = 20 + ((p.schedule_slip_days / maxSlip) * 0.9 + 0.05) * 60
        const y = 85 - ((p.cost_variance_pct / maxCV) * 0.8 * 0.5 + 0.5) * 70
        return (
          <div key={p.id} title={`${p.project_name}\nCV: ${p.cost_variance_pct > 0 ? '+' : ''}${p.cost_variance_pct}%  Slip: ${p.schedule_slip_days}d  Risk: ${p.risk_score}`}
            style={{ position: 'absolute', left: `${x}%`, top: `${y}%`, width: 12, height: 12, borderRadius: '50%', background: riskColor(p.risk_score), border: '2px solid #fff', transform: 'translate(-50%,-50%)', cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,0.3)' }}>
            <div style={{ position: 'absolute', bottom: 14, left: '50%', transform: 'translateX(-50%)', whiteSpace: 'nowrap', fontSize: 9, color: 'var(--jarvis-tx)', background: 'var(--jarvis-bg)', padding: '1px 4px', borderRadius: 3, border: '1px solid var(--jarvis-bd)', pointerEvents: 'none' }}>
              {p.project_name.split(' ').slice(0, 2).join(' ')}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── AskAI panel ─────────────────────────────────────────────────────────────

function AskAIPanel({ predictions }: { predictions: Prediction[] }) {
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<AskResult | null>(null)
  const [error, setError] = useState('')

  const ask = useCallback(async () => {
    if (!query.trim()) return
    setLoading(true); setError(''); setResult(null)
    try {
      const res = await fetch('/api/v1/ai/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, context: predictions }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setResult(data)
    } catch {
      // Offline / dev — generate a canned response
      const canned = generateCannedAnswer(query, predictions)
      setResult({ answer: canned })
    } finally {
      setLoading(false)
    }
  }, [query, predictions])

  function generateCannedAnswer(q: string, ps: Prediction[]): string {
    const high = ps.filter(p => p.risk_score >= 70)
    const overrun = ps.filter(p => p.cost_variance_pct > 5)
    const lower = q.toLowerCase()
    if (lower.includes('risk')) return high.length ? `${high.length} project(s) at high risk: ${high.map(p => p.project_name).join(', ')}. Primary drivers: procurement delays and resource constraints.` : 'No projects are currently at high risk. Monitor procurement lead times and workforce availability.'
    if (lower.includes('cost') || lower.includes('budget')) return overrun.length ? `${overrun.length} project(s) tracking over budget: ${overrun.map(p => `${p.project_name} (+${p.cost_variance_pct}%)`).join(', ')}.` : 'All projects are tracking within budget tolerance.'
    if (lower.includes('schedule') || lower.includes('delay')) { const delayed = ps.filter(p => p.schedule_slip_days > 0); return delayed.length ? `${delayed.length} project(s) have schedule slippage: ${delayed.map(p => `${p.project_name} (${p.schedule_slip_days}d)`).join(', ')}.` : 'All projects are on schedule.' }
    return `Based on current data across ${ps.length} active projects: avg risk score ${Math.round(ps.reduce((a, p) => a + p.risk_score, 0) / ps.length)}/100, avg cost variance ${(ps.reduce((a, p) => a + p.cost_variance_pct, 0) / ps.length).toFixed(1)}%. Key focus: procurement and schedule buffer management.`
  }

  return (
    <div style={{ border: '1px solid var(--jarvis-bd)', borderRadius: 8, padding: 16, background: 'var(--jarvis-bg2)' }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span>🤖</span> Ask AI — Natural Language Project Intelligence
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          value={query} onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && ask()}
          placeholder="e.g. Which projects are most at risk this quarter?"
          style={{ flex: 1, padding: '8px 12px', background: 'var(--jarvis-bg)', border: '1px solid var(--jarvis-bd)', borderRadius: 6, color: 'var(--jarvis-tx)', fontSize: 13 }}
        />
        <button onClick={ask} disabled={loading || !query.trim()} style={{ padding: '8px 18px', background: 'var(--jarvis-ac)', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer', opacity: loading || !query.trim() ? 0.6 : 1 }}>
          {loading ? '…' : 'Ask'}
        </button>
      </div>

      {/* Quick prompts */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {['What are the top risks?', 'Which projects are over budget?', 'Summarize schedule status'].map(q => (
          <button key={q} onClick={() => { setQuery(q); }} style={{ padding: '3px 10px', fontSize: 11, background: 'var(--jarvis-bg)', border: '1px solid var(--jarvis-bd)', borderRadius: 12, color: 'var(--jarvis-ts)', cursor: 'pointer' }}>{q}</button>
        ))}
      </div>

      {error && <div style={{ color: '#e74c3c', fontSize: 12, marginBottom: 8 }}>{error}</div>}
      {result && (
        <div style={{ background: 'var(--jarvis-bg)', border: '1px solid var(--jarvis-bd)', borderRadius: 6, padding: 12 }}>
          <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--jarvis-tx)' }}>{result.answer}</div>
          {result.sources && result.sources.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 10, color: 'var(--jarvis-ts)' }}>Sources: {result.sources.join(', ')}</div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

const TABS = ['Overview', 'Risk Heat Map', 'Ask AI'] as const
type Tab = typeof TABS[number]

export function PredictView({ policy: _policy }: PredictViewProps) {
  const [tab, setTab] = useState<Tab>('Overview')
  const [predictions, setPredictions] = useState<Prediction[]>(DEMO_PREDICTIONS)
  const [loading, setLoading] = useState(false)

  const rawProjects = useBizStore(s => s.biz.projects) ?? []

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/v1/ai/predictions')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (data.predictions?.length) setPredictions(data.predictions)
      // else keep demo data already shown
    } catch {
      // keep demo data already shown
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const avgRisk = predictions.length ? Math.round(predictions.reduce((a, p) => a + p.risk_score, 0) / predictions.length) : 0
  const avgCV   = predictions.length ? (predictions.reduce((a, p) => a + p.cost_variance_pct, 0) / predictions.length) : 0
  const slipped  = predictions.filter(p => p.schedule_slip_days > 0).length
  const highRisk = predictions.filter(p => p.risk_score >= 70).length

  return (
    <div role="main" aria-label="Predict" style={{ padding: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <span style={{ fontSize: 22 }}>🔮</span>
        <div>
          <h2 style={{ margin: 0, fontSize: 18 }}>AI Predictions</h2>
          <div style={{ fontSize: 11, color: 'var(--jarvis-ts)' }}>{predictions.length} projects · {rawProjects.length} in biz store · powered by Ava Intelligence</div>
        </div>
        <button onClick={load} disabled={loading} style={{ marginLeft: 'auto', padding: '5px 12px', fontSize: 11, background: 'var(--jarvis-bg2)', border: '1px solid var(--jarvis-bd)', borderRadius: 4, cursor: 'pointer', color: 'var(--jarvis-ts)' }}>
          {loading ? 'Refreshing…' : '↻ Refresh'}
        </button>
      </div>

      {/* KPI strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
        {[
          { label: 'Avg Risk Score', value: `${avgRisk}/100`, color: riskColor(avgRisk) },
          { label: 'Avg Cost Variance', value: `${avgCV > 0 ? '+' : ''}${avgCV.toFixed(1)}%`, color: cvColor(avgCV) },
          { label: 'Schedule Slippage', value: `${slipped} proj`, color: slipped > 0 ? '#f39c12' : '#2ecc71' },
          { label: 'High Risk Projects', value: String(highRisk), color: highRisk > 0 ? '#e74c3c' : '#2ecc71' },
        ].map(k => (
          <div key={k.label} style={{ background: 'var(--jarvis-bg2)', border: '1px solid var(--jarvis-bd)', borderRadius: 8, padding: '12px 14px' }}>
            <div style={{ fontSize: 10, color: 'var(--jarvis-ts)', marginBottom: 4 }}>{k.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: k.color }}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 14, borderBottom: '1px solid var(--jarvis-bd)', paddingBottom: 0 }}>
        {TABS.map(t => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            style={{ padding: '7px 16px', fontSize: 12, background: 'none', border: 'none', borderBottom: tab === t ? '2px solid var(--jarvis-ac)' : '2px solid transparent', color: tab === t ? 'var(--jarvis-ac)' : 'var(--jarvis-ts)', cursor: 'pointer', fontWeight: tab === t ? 600 : 400 }}>
            {t}
          </button>
        ))}
      </div>

      {/* Tab: Overview */}
      {tab === 'Overview' && (
        <div style={{ display: 'grid', gap: 10 }}>
          {loading && predictions.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--jarvis-ts)', fontSize: 13 }}>Loading predictions…</div>
          ) : predictions.map(p => (
            <div key={p.id} style={{ border: '1px solid var(--jarvis-bd)', borderRadius: 8, padding: 14, background: 'var(--jarvis-bg2)', display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'start' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{p.project_name}</span>
                  <span style={{ padding: '2px 8px', background: riskColor(p.risk_score), color: '#fff', borderRadius: 10, fontSize: 10, fontWeight: 600 }}>{riskLabel(p.risk_score)} Risk</span>
                  <span style={{ fontSize: 10, color: 'var(--jarvis-ts)' }}>Conf: {Math.round(p.confidence * 100)}%</span>
                  <span style={{ fontSize: 10, color: 'var(--jarvis-ts)', marginLeft: 'auto' }}>Updated {timeAgo(p.updated_at)}</span>
                </div>

                {/* Metrics row */}
                <div style={{ display: 'flex', gap: 20, marginBottom: 10, fontSize: 13 }}>
                  <div>
                    <span style={{ color: 'var(--jarvis-ts)', fontSize: 10 }}>Cost Variance</span>
                    <div style={{ fontWeight: 700, color: cvColor(p.cost_variance_pct) }}>{p.cost_variance_pct > 0 ? '+' : ''}{p.cost_variance_pct}%</div>
                  </div>
                  <div>
                    <span style={{ color: 'var(--jarvis-ts)', fontSize: 10 }}>Schedule Slip</span>
                    <div style={{ fontWeight: 700, color: p.schedule_slip_days > 0 ? '#f39c12' : '#2ecc71' }}>{p.schedule_slip_days > 0 ? `+${p.schedule_slip_days}d` : 'On Track'}</div>
                  </div>
                  <div>
                    <span style={{ color: 'var(--jarvis-ts)', fontSize: 10 }}>Risk Score</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ width: 80, height: 6, background: 'var(--jarvis-bd)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ width: `${p.risk_score}%`, height: '100%', background: riskColor(p.risk_score), borderRadius: 3 }} />
                      </div>
                      <span style={{ fontWeight: 700, fontSize: 12, color: riskColor(p.risk_score) }}>{p.risk_score}</span>
                    </div>
                  </div>
                </div>

                {/* Top risks */}
                {p.top_risks.length > 0 && (
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--jarvis-ts)', marginBottom: 4 }}>Top Risk Factors:</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {p.top_risks.map((r, i) => (
                        <div key={i} style={{ fontSize: 11, color: 'var(--jarvis-tx)', display: 'flex', gap: 6 }}>
                          <span style={{ color: riskColor(p.risk_score - i * 10) }}>▸</span> {r}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Mini risk gauge */}
              <div style={{ width: 52, height: 52, position: 'relative', flexShrink: 0 }}>
                <svg viewBox="0 0 52 52" style={{ width: '100%', height: '100%' }}>
                  <circle cx="26" cy="26" r="20" fill="none" stroke="var(--jarvis-bd)" strokeWidth="5" />
                  <circle cx="26" cy="26" r="20" fill="none" stroke={riskColor(p.risk_score)} strokeWidth="5"
                    strokeDasharray={`${(p.risk_score / 100) * 125.6} 125.6`}
                    strokeLinecap="round" transform="rotate(-90 26 26)" />
                  <text x="26" y="30" textAnchor="middle" fontSize="11" fontWeight="700" fill={riskColor(p.risk_score)}>{p.risk_score}</text>
                </svg>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tab: Risk Heat Map */}
      {tab === 'Risk Heat Map' && (
        <div>
          <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--jarvis-ts)' }}>
            X-axis: schedule slip (days) · Y-axis: cost variance (%) · Dot color: risk score
            <span style={{ marginLeft: 16, color: '#2ecc71' }}>● Low</span>
            <span style={{ marginLeft: 8, color: '#f39c12' }}>● Medium</span>
            <span style={{ marginLeft: 8, color: '#e74c3c' }}>● High</span>
          </div>
          <RiskHeatMap predictions={predictions} />
          <div style={{ marginTop: 12, fontSize: 11, color: 'var(--jarvis-ts)' }}>Hover over dots for project details. Upper-right quadrant = highest combined risk.</div>
        </div>
      )}

      {/* Tab: Ask AI */}
      {tab === 'Ask AI' && <AskAIPanel predictions={predictions} />}
    </div>
  )
}

export default PredictView
