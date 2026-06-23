/**
 * Denver Engineering — Executive Copilot (v4.43.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * Board-level briefing: portfolio health, status mix, systemic issues recurring
 * across projects, and a worst-first project health table. Deterministic — every
 * number traces to the project financials + the Focus and Coordination engines.
 *
 * Data: GET /api/v1/copilot/report (portfolio roll-up).
 */
import React, { useEffect, useState, useCallback } from 'react'

type HealthStatus = 'on_track' | 'watch' | 'at_risk' | 'critical'

interface ProjectRow { projectId: string; projectName: string | null; healthScore: number; healthStatus: HealthStatus; topConcern: string }
interface PortfolioReport {
  generatedAt: string
  headline: string
  portfolioHealth: number
  summary: { projects: number; onTrack: number; watch: number; atRisk: number; critical: number }
  systemicIssues: { label: string; affectedProjects: number }[]
  projects: ProjectRow[]
}

const STATUS_COLOR: Record<HealthStatus, string> = { on_track: '#22c55e', watch: '#3b82f6', at_risk: '#f59e0b', critical: '#ef4444' }
const STATUS_LABEL: Record<HealthStatus, string> = { on_track: 'On track', watch: 'Watch', at_risk: 'At risk', critical: 'Critical' }
const healthColor = (n: number) => (n >= 80 ? '#22c55e' : n >= 65 ? '#3b82f6' : n >= 45 ? '#f59e0b' : '#ef4444')

export default function ExecutiveView(_props: { onNavigate?: (tab: string) => void }) {
  const [report, setReport] = useState<PortfolioReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError(false)
    try {
      const res = await fetch('/api/v1/copilot/report')
      if (!res.ok) throw new Error(String(res.status))
      const json = await res.json() as { data: PortfolioReport }
      setReport(json.data)
    } catch { setError(true) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const card: React.CSSProperties = { background: 'var(--jarvis-bg2)', border: '1px solid var(--jarvis-bd)', borderRadius: 10, padding: 16 }

  return (
    <div style={{ padding: 24, maxWidth: 980, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--jarvis-tx)', margin: 0 }}>📋 Executive Briefing</h1>
          <p style={{ fontSize: 13, color: 'var(--jarvis-ts)', margin: '4px 0 0' }}>Board-level portfolio health — deterministic, no black box.</p>
        </div>
        <button onClick={load} disabled={loading} style={{ padding: '7px 14px', borderRadius: 6, fontSize: 13, cursor: loading ? 'default' : 'pointer', border: '1px solid var(--jarvis-bd)', background: 'var(--jarvis-bg2)', color: 'var(--jarvis-tx)', opacity: loading ? 0.6 : 1 }}>{loading ? 'Refreshing…' : '↻ Refresh'}</button>
      </div>

      {error && (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--jarvis-ts)', fontSize: 13 }}>
          Couldn&apos;t load the briefing. <button onClick={load} style={{ background: 'none', border: 'none', color: 'var(--jarvis-ac)', cursor: 'pointer', textDecoration: 'underline' }}>Retry</button>
        </div>
      )}
      {!error && loading && !report && <div style={{ padding: 24, textAlign: 'center', color: 'var(--jarvis-ts)', fontSize: 13 }}>Compiling portfolio briefing…</div>}

      {report && (
        <>
          {/* Health + headline */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
            <div style={{ ...card, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minWidth: 140 }}>
              <div style={{ fontSize: 40, fontWeight: 800, color: healthColor(report.portfolioHealth), lineHeight: 1 }}>{report.portfolioHealth}</div>
              <div style={{ fontSize: 11, color: 'var(--jarvis-ts)', marginTop: 4 }}>Portfolio health</div>
            </div>
            <div style={{ ...card, flex: 1, minWidth: 240, display: 'flex', alignItems: 'center', fontSize: 14, color: 'var(--jarvis-tx)', lineHeight: 1.5 }}>{report.headline}</div>
          </div>

          {/* Status mix */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
            {([['on_track', report.summary.onTrack], ['watch', report.summary.watch], ['at_risk', report.summary.atRisk], ['critical', report.summary.critical]] as [HealthStatus, number][]).map(([s, n]) => (
              <div key={s} style={{ ...card, flex: '1 1 120px', minWidth: 120, padding: 12, borderLeft: `3px solid ${STATUS_COLOR[s]}` }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--jarvis-tx)' }}>{n}</div>
                <div style={{ fontSize: 11, color: 'var(--jarvis-ts)' }}>{STATUS_LABEL[s]}</div>
              </div>
            ))}
          </div>

          {/* Systemic issues */}
          {report.systemicIssues.length > 0 && (
            <div style={{ ...card, marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--jarvis-tx)', marginBottom: 8 }}>Systemic issues (recurring across projects)</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {report.systemicIssues.map(s => (
                  <div key={s.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--jarvis-tx)' }}>
                    <span>⚠️ {s.label}</span>
                    <span style={{ color: 'var(--jarvis-ts)' }}>{s.affectedProjects} projects</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Project health table (worst first) */}
          <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', fontSize: 13, fontWeight: 700, color: 'var(--jarvis-tx)', borderBottom: '1px solid var(--jarvis-bd)' }}>Projects by health (worst first)</div>
            {report.projects.length === 0 && <div style={{ padding: 24, textAlign: 'center', color: 'var(--jarvis-ts)', fontSize: 13 }}>No active projects.</div>}
            {report.projects.map(p => (
              <div key={p.projectId} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px', borderBottom: '1px solid var(--jarvis-bd)' }}>
                <div style={{ width: 40, fontWeight: 700, color: healthColor(p.healthScore), fontFamily: 'var(--jarvis-font-mono)' }}>{p.healthScore}</div>
                <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: '#0a0b0f', background: STATUS_COLOR[p.healthStatus], padding: '2px 7px', borderRadius: 99 }}>{STATUS_LABEL[p.healthStatus]}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: 'var(--jarvis-tx)' }}>{p.projectName ?? p.projectId.slice(0, 8)}</div>
                  <div style={{ fontSize: 11, color: 'var(--jarvis-ts)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.topConcern}</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
