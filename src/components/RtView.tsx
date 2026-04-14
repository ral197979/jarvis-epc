/**
 * JARVIS EPC — RtView · Risk Tracking  (v4.28.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * Trend analysis and tracking dashboard for the risk register.
 *
 * Panels:
 *   1. Risk aging — days since creation by band
 *   2. Open vs closed trend (bar chart via SVG)
 *   3. Risk score distribution histogram
 *   4. Category breakdown table
 */

import React, { useState, useEffect, useMemo } from 'react'
import { useBizStore, selectProjects } from '../modules/biz/store'
import { KpiCard } from './KpiCard'
import type { PolicyConfig } from '../modules/biz/dispatch'

interface Risk {
  id: string; risk_number: string; title: string
  likelihood: string; impact: string; risk_score: number; band: string
  category?: string; status: string; created_at: string; updated_at: string
}

export interface RtViewProps {
  policy?:  Partial<PolicyConfig>
  onToast?: (msg: string, type: string) => void
}

const BAND_COLOR: Record<string, string> = {
  low: '#065F46', medium: '#92400E', high: '#991B1B', critical: '#FF2D2D',
}
const BAND_BG: Record<string, string> = {
  low: '#D1FAE5', medium: '#FEF3C7', high: '#FEE2E2', critical: '#FEF2F2',
}

export function RtView({ policy: _p }: RtViewProps) {
  const projects = useBizStore(selectProjects) as { id: string; name?: string; code?: string }[]
  const [selectedProject, setSelectedProject] = useState('')
  const [risks,   setRisks]   = useState<Risk[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!selectedProject) return
    setLoading(true)
    fetch(`/api/v1/projects/${selectedProject}/risks?limit=200`)
      .then(r => r.ok ? r.json() : { risks: [] })
      .then(d => setRisks(d.risks ?? []))
      .catch(() => setRisks([]))
      .finally(() => setLoading(false))
  }, [selectedProject])

  // ── Aging analysis ────────────────────────────────────────────────────────

  const aging = useMemo(() => {
    const now = Date.now()
    return risks.filter(r => r.status === 'open').map(r => ({
      ...r,
      age_days: Math.floor((now - new Date(r.created_at).getTime()) / 86400000),
    })).sort((a, b) => b.age_days - a.age_days)
  }, [risks])

  // ── Category breakdown ────────────────────────────────────────────────────

  const byCategory = useMemo(() => {
    const map: Record<string, { open: number; closed: number; avg_score: number; scores: number[] }> = {}
    risks.forEach(r => {
      const cat = r.category || 'Uncategorized'
      if (!map[cat]) map[cat] = { open: 0, closed: 0, avg_score: 0, scores: [] }
      if (r.status === 'open') map[cat].open++
      else map[cat].closed++
      map[cat].scores.push(r.risk_score)
    })
    return Object.entries(map).map(([cat, d]) => ({
      category: cat, ...d,
      avg_score: d.scores.length ? Math.round(d.scores.reduce((a,b) => a+b, 0) / d.scores.length * 10) / 10 : 0,
    })).sort((a, b) => b.open - a.open)
  }, [risks])

  // ── Score distribution (histogram bins 1–5, 6–10, 11–15, 16–20, 21–25) ──

  const bins = useMemo(() => {
    const openRisks = risks.filter(r => r.status === 'open')
    const labels = ['1–4 Low', '5–9 Medium', '10–16 High', '17–25 Critical']
    const counts = [
      openRisks.filter(r => r.risk_score <= 4).length,
      openRisks.filter(r => r.risk_score >= 5 && r.risk_score <= 9).length,
      openRisks.filter(r => r.risk_score >= 10 && r.risk_score <= 16).length,
      openRisks.filter(r => r.risk_score >= 17).length,
    ]
    const max = Math.max(...counts, 1)
    return labels.map((label, i) => ({ label, count: counts[i], pct: Math.round(counts[i] / max * 100) }))
  }, [risks])

  const openCount    = risks.filter(r => r.status === 'open').length
  const closedCount  = risks.filter(r => r.status === 'closed').length
  const criticalOpen = risks.filter(r => r.status === 'open' && r.band === 'critical').length
  const avgAge       = aging.length ? Math.round(aging.reduce((s, r) => s + r.age_days, 0) / aging.length) : 0

  if (!selectedProject) {
    return (
      <div role="main" aria-label="Risk Tracking">
        <div style={{ marginBottom: 16 }}>
          <label className="jarvis-small" style={{ display: 'block', marginBottom: 6 }}>Select a project to view risk tracking</label>
          <select className="jarvis-input" style={{ maxWidth: 320 }} value={selectedProject}
            onChange={e => setSelectedProject(e.target.value)}>
            <option value="">— Select project —</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.code ? `[${p.code}] ` : ''}{p.name ?? p.id}</option>
            ))}
          </select>
        </div>
        <div className="jarvis-empty">
          <span className="jarvis-empty-icon">📊</span>
          <span>Risk tracking shows trends and aging analysis for a selected project</span>
        </div>
      </div>
    )
  }

  return (
    <div role="main" aria-label="Risk Tracking">
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
        <select className="jarvis-input" style={{ maxWidth: 320 }} value={selectedProject}
          onChange={e => setSelectedProject(e.target.value)}>
          {projects.map(p => (
            <option key={p.id} value={p.id}>{p.code ? `[${p.code}] ` : ''}{p.name ?? p.id}</option>
          ))}
        </select>
        {loading && <span className="jarvis-small" style={{ color: 'var(--jarvis-ts)' }}>Loading…</span>}
      </div>

      {/* KPI strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginBottom: 24 }}>
        <KpiCard label="Open Risks"      value={openCount}    color={openCount > 0 ? 'var(--jarvis-amb)' : 'var(--jarvis-grn)'} />
        <KpiCard label="Closed Risks"    value={closedCount}  color="var(--jarvis-grn)" />
        <KpiCard label="Critical Open"   value={criticalOpen} color={criticalOpen > 0 ? 'var(--jarvis-red)' : 'var(--jarvis-grn)'} />
        <KpiCard label="Avg Age (days)"  value={avgAge}       color={avgAge > 30 ? 'var(--jarvis-red)' : 'var(--jarvis-ts)'} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>

        {/* Score distribution histogram */}
        <div className="jarvis-card" style={{ padding: 16 }}>
          <h4 className="jarvis-label" style={{ marginBottom: 14 }}>Open Risk Score Distribution</h4>
          {bins.map((bin, i) => {
            const band = ['low','medium','high','critical'][i]
            return (
              <div key={bin.label} style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 12 }}>
                  <span style={{ color: BAND_COLOR[band], fontWeight: 600 }}>{bin.label}</span>
                  <span style={{ color: 'var(--jarvis-ts)' }}>{bin.count}</span>
                </div>
                <div style={{ height: 14, background: 'var(--jarvis-bd)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', width: `${bin.pct}%`,
                    background: BAND_BG[band], border: `1px solid ${BAND_COLOR[band]}`,
                    borderRadius: 3, transition: 'width 0.4s',
                  }} />
                </div>
              </div>
            )
          })}
          {openCount === 0 && (
            <div className="jarvis-empty" style={{ marginTop: 8 }}>
              <span className="jarvis-empty-icon">✅</span>
              <span style={{ fontSize: 12 }}>No open risks</span>
            </div>
          )}
        </div>

        {/* Category breakdown */}
        <div className="jarvis-card" style={{ padding: 16 }}>
          <h4 className="jarvis-label" style={{ marginBottom: 14 }}>Risk by Category</h4>
          {byCategory.length === 0 ? (
            <div className="jarvis-empty"><span>No data</span></div>
          ) : (
            <table className="jarvis-table" style={{ width: '100%' }}>
              <thead><tr><th>Category</th><th>Open</th><th>Closed</th><th>Avg Score</th></tr></thead>
              <tbody>
                {byCategory.map(row => (
                  <tr key={row.category}>
                    <td style={{ fontWeight: 600, fontSize: 12 }}>{row.category}</td>
                    <td style={{ color: row.open > 0 ? 'var(--jarvis-red)' : 'var(--jarvis-ts)', fontWeight: row.open > 0 ? 700 : 400 }}>
                      {row.open}
                    </td>
                    <td style={{ color: 'var(--jarvis-grn)' }}>{row.closed}</td>
                    <td>
                      <span style={{
                        fontSize: 11, fontWeight: 700, padding: '1px 6px', borderRadius: 3,
                        background: row.avg_score >= 17 ? BAND_BG.critical : row.avg_score >= 10 ? BAND_BG.high : row.avg_score >= 5 ? BAND_BG.medium : BAND_BG.low,
                        color: row.avg_score >= 17 ? BAND_COLOR.critical : row.avg_score >= 10 ? BAND_COLOR.high : row.avg_score >= 5 ? BAND_COLOR.medium : BAND_COLOR.low,
                      }}>
                        {row.avg_score}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Aging table */}
      <div className="jarvis-card" style={{ padding: 16 }}>
        <h4 className="jarvis-label" style={{ marginBottom: 14 }}>Open Risk Aging (oldest first)</h4>
        {aging.length === 0 ? (
          <div className="jarvis-empty"><span className="jarvis-empty-icon">✅</span><span>No open risks</span></div>
        ) : (
          <div className="jarvis-scroll-y jarvis-max-h-lg">
            <table className="jarvis-table" aria-label="Risk aging">
              <thead>
                <tr><th>No.</th><th>Title</th><th>Category</th><th>Score</th><th>Age</th><th>Age Bar</th></tr>
              </thead>
              <tbody>
                {aging.map(r => {
                  const maxAge = aging[0]?.age_days || 1
                  const pct    = Math.min(r.age_days / maxAge * 100, 100)
                  const ageColor = r.age_days > 90 ? 'var(--jarvis-red)' : r.age_days > 30 ? 'var(--jarvis-amb)' : 'var(--jarvis-grn)'
                  return (
                    <tr key={r.id}>
                      <td style={{ fontFamily: 'var(--jarvis-font-mono)', fontSize: 11 }}>{r.risk_number}</td>
                      <td style={{ fontWeight: 600 }}>{r.title}</td>
                      <td style={{ fontSize: 12 }}>{r.category ?? '—'}</td>
                      <td>
                        <span style={{
                          fontSize: 11, fontWeight: 700, padding: '1px 6px', borderRadius: 3,
                          background: BAND_BG[r.band] ?? '#f5f5f5',
                          color: BAND_COLOR[r.band] ?? '#333',
                        }}>
                          {r.risk_score}
                        </span>
                      </td>
                      <td style={{ color: ageColor, fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap' }}>
                        {r.age_days}d
                      </td>
                      <td style={{ minWidth: 100 }}>
                        <div style={{ height: 8, background: 'var(--jarvis-bd)', borderRadius: 4 }}>
                          <div style={{ width: `${pct}%`, height: '100%', background: ageColor, borderRadius: 4, transition: 'width 0.4s' }} />
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export default RtView
