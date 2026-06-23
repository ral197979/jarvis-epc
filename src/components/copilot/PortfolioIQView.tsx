/**
 * Denver Engineering — Portfolio Copilot (v4.44.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * Cross-project comparison: benchmarks (best/worst/median per metric), resource
 * conflicts (people over-allocated across projects), exemplars (best practices),
 * and outliers (worst on multiple metrics). Deterministic.
 *
 * Data: GET /api/v1/copilot/portfolio.
 */
import React, { useEffect, useState, useCallback } from 'react'

interface BenchmarkEnd { projectId: string; name: string | null; value: number }
interface Benchmark { metric: string; unit: string; lowerIsBetter: boolean; best: BenchmarkEnd | null; worst: BenchmarkEnd | null; median: number }
interface ResourceConflict { userId: string; projectCount: number; totalOpen: number; totalOverdue: number; severity: 'critical' | 'high' | 'medium'; projects: { projectId: string; name: string | null; open: number; overdue: number }[]; summary: string }
interface PortfolioInsights {
  generatedAt: string
  headline: string
  summary: { projects: number; resourceConflicts: number; exemplars: number; outliers: number }
  benchmarks: Benchmark[]
  resourceConflicts: ResourceConflict[]
  exemplars: { projectId: string; name: string | null; reason: string }[]
  outliers: { projectId: string; name: string | null; reasons: string[] }[]
}

const SEV_COLOR: Record<ResourceConflict['severity'], string> = { critical: '#ef4444', high: '#f59e0b', medium: '#3b82f6' }

export default function PortfolioIQView(_props: { onNavigate?: (tab: string) => void }) {
  const [data, setData] = useState<PortfolioInsights | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError(false)
    try {
      const res = await fetch('/api/v1/copilot/portfolio')
      if (!res.ok) throw new Error(String(res.status))
      const json = await res.json() as { data: PortfolioInsights }
      setData(json.data)
    } catch { setError(true) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const card: React.CSSProperties = { background: 'var(--jarvis-bg2)', border: '1px solid var(--jarvis-bd)', borderRadius: 10, padding: 16, marginBottom: 16 }
  const heading: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: 'var(--jarvis-tx)', marginBottom: 10 }

  return (
    <div style={{ padding: 24, maxWidth: 980, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--jarvis-tx)', margin: 0 }}>🗂️ Portfolio IQ</h1>
          <p style={{ fontSize: 13, color: 'var(--jarvis-ts)', margin: '4px 0 0' }}>Compare projects, spot over-allocated people, and learn from your best.</p>
        </div>
        <button onClick={load} disabled={loading} style={{ padding: '7px 14px', borderRadius: 6, fontSize: 13, cursor: loading ? 'default' : 'pointer', border: '1px solid var(--jarvis-bd)', background: 'var(--jarvis-bg2)', color: 'var(--jarvis-tx)', opacity: loading ? 0.6 : 1 }}>{loading ? 'Refreshing…' : '↻ Refresh'}</button>
      </div>

      {error && <div style={{ padding: 24, textAlign: 'center', color: 'var(--jarvis-ts)', fontSize: 13 }}>Couldn&apos;t load. <button onClick={load} style={{ background: 'none', border: 'none', color: 'var(--jarvis-ac)', cursor: 'pointer', textDecoration: 'underline' }}>Retry</button></div>}
      {!error && loading && !data && <div style={{ padding: 24, textAlign: 'center', color: 'var(--jarvis-ts)', fontSize: 13 }}>Comparing projects…</div>}

      {data && (
        <>
          <div style={{ ...card, fontSize: 14, color: 'var(--jarvis-tx)', lineHeight: 1.5 }}>{data.headline}</div>

          {/* Benchmarks */}
          <div style={card}>
            <div style={heading}>Benchmarks across {data.summary.projects} active project{data.summary.projects === 1 ? '' : 's'}</div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {data.benchmarks.map(b => (
                <div key={b.metric} style={{ flex: '1 1 200px', minWidth: 200, border: '1px solid var(--jarvis-bd)', borderRadius: 8, padding: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--jarvis-tx)', marginBottom: 6 }}>{b.metric} <span style={{ fontWeight: 400, color: 'var(--jarvis-ts)' }}>({b.unit}, lower is better)</span></div>
                  <div style={{ fontSize: 12, color: 'var(--jarvis-ts)', display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <span style={{ color: '#22c55e' }}>▼ Best: {b.best?.name ?? '—'} ({b.best?.value ?? '—'})</span>
                    <span>Median: {b.median}</span>
                    <span style={{ color: '#ef4444' }}>▲ Worst: {b.worst?.name ?? '—'} ({b.worst?.value ?? '—'})</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Resource conflicts */}
          <div style={card}>
            <div style={heading}>Resource conflicts ({data.resourceConflicts.length})</div>
            {data.resourceConflicts.length === 0 && <div style={{ fontSize: 13, color: 'var(--jarvis-ts)' }}>No one is over-allocated across projects.</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {data.resourceConflicts.map(c => (
                <div key={c.userId} style={{ border: '1px solid var(--jarvis-bd)', borderLeft: `3px solid ${SEV_COLOR[c.severity]}`, borderRadius: 8, padding: '10px 12px' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: '#0a0b0f', background: SEV_COLOR[c.severity], padding: '2px 7px', borderRadius: 99 }}>{c.severity}</span>
                    <span style={{ fontSize: 13, color: 'var(--jarvis-tx)' }}>User {c.userId.slice(0, 8)}</span>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--jarvis-tx)' }}>{c.summary}</div>
                  <div style={{ fontSize: 11, color: 'var(--jarvis-ts)', marginTop: 4 }}>{c.projects.map(p => `${p.name ?? p.projectId.slice(0, 6)} (${p.overdue}/${p.open} overdue)`).join(' · ')}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Exemplars + Outliers */}
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ ...card, flex: '1 1 280px', minWidth: 280 }}>
              <div style={heading}>✅ Exemplars — best practices ({data.exemplars.length})</div>
              {data.exemplars.length === 0 && <div style={{ fontSize: 13, color: 'var(--jarvis-ts)' }}>No standout exemplars this cycle.</div>}
              {data.exemplars.map(e => (
                <div key={e.projectId} style={{ fontSize: 13, color: 'var(--jarvis-tx)', marginBottom: 6 }}>
                  <strong>{e.name ?? e.projectId.slice(0, 8)}</strong> — <span style={{ color: 'var(--jarvis-ts)' }}>{e.reason}</span>
                </div>
              ))}
            </div>
            <div style={{ ...card, flex: '1 1 280px', minWidth: 280 }}>
              <div style={heading}>⚠️ Outliers — need attention ({data.outliers.length})</div>
              {data.outliers.length === 0 && <div style={{ fontSize: 13, color: 'var(--jarvis-ts)' }}>No projects are outliers on multiple metrics.</div>}
              {data.outliers.map(o => (
                <div key={o.projectId} style={{ fontSize: 13, color: 'var(--jarvis-tx)', marginBottom: 6 }}>
                  <strong>{o.name ?? o.projectId.slice(0, 8)}</strong> — <span style={{ color: 'var(--jarvis-ts)' }}>{o.reasons.join(', ')}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
