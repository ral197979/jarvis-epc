/**
 * Denver Engineering — RFI Copilot panel (v4.46.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * Renders inside the RFI detail modal: precedent (similar prior RFIs), suggested
 * responders (by discipline answer history), and schedule-impact analysis.
 *
 * Data: GET /api/v1/rfis/:id/copilot.
 */
import React, { useEffect, useState } from 'react'

interface SimilarRfi { id: string; rfiNumber: string; title: string; status: string; similarity: number; hasResponse: boolean }
interface SuggestedResponder { userId: string; answered: number }
interface RfiImpact { scheduleRisk: 'high' | 'medium' | 'low'; blockingCount: number; daysOverdue: number | null; reasons: string[] }
interface RfiCopilotResult {
  rfi: { id: string; rfiNumber: string; title: string; discipline: string | null; status: string }
  similar: SimilarRfi[]
  suggestedResponders: SuggestedResponder[]
  impact: RfiImpact
}

const RISK_COLOR: Record<RfiImpact['scheduleRisk'], string> = { high: '#ef4444', medium: '#f59e0b', low: '#22c55e' }

export default function RfiCopilotPanel({ rfiId }: { rfiId: string }) {
  const [data, setData] = useState<RfiCopilotResult | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let alive = true
    setLoading(true)
    fetch(`/api/v1/rfis/${rfiId}/copilot`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(j => { if (alive) setData(j.data) })
      .catch(() => { if (alive) setData(null) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [rfiId])

  const wrap: React.CSSProperties = { borderTop: '1px solid var(--jarvis-bg)', paddingTop: 16, marginBottom: 16 }
  if (loading && !data) return <div style={wrap}><div style={{ fontSize: 12, color: 'var(--jarvis-ts)' }}>🤖 RFI Copilot analysing…</div></div>
  if (!data) return null

  const i = data.impact
  return (
    <div style={wrap}>
      <h3 style={{ margin: '0 0 12px 0', fontSize: 14 }}>🤖 RFI Copilot</h3>

      {/* Impact */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: '#0a0b0f', background: RISK_COLOR[i.scheduleRisk], padding: '2px 8px', borderRadius: 99 }}>{i.scheduleRisk} schedule risk</span>
        {i.blockingCount > 0 && <span style={{ fontSize: 11, color: 'var(--jarvis-tx)' }}>⛔ blocking {i.blockingCount} item{i.blockingCount === 1 ? '' : 's'}</span>}
        <span style={{ fontSize: 11, color: 'var(--jarvis-ts)' }}>{i.reasons.join(' · ')}</span>
      </div>

      {/* Suggested responders */}
      {data.suggestedResponders.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--jarvis-tx)', marginBottom: 4 }}>Who should answer? <span style={{ fontWeight: 400, color: 'var(--jarvis-ts)' }}>(by {data.rfi.discipline ?? 'project'} history)</span></div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {data.suggestedResponders.map(r => (
              <span key={r.userId} style={{ fontSize: 11, color: 'var(--jarvis-tx)', background: 'var(--jarvis-bg)', border: '1px solid var(--jarvis-bd)', padding: '2px 8px', borderRadius: 99 }}>
                {r.userId.slice(0, 8)} · answered {r.answered}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Precedent — similar prior RFIs */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--jarvis-tx)', marginBottom: 4 }}>Has this been asked before?</div>
        {data.similar.length === 0 && <div style={{ fontSize: 12, color: 'var(--jarvis-ts)' }}>No similar prior RFIs found — this looks new.</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {data.similar.map(s => (
            <div key={s.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: 'var(--jarvis-tx)' }}>
              <span style={{ width: 44, color: 'var(--jarvis-ts)', fontFamily: 'var(--jarvis-font-mono)' }}>{Math.round(s.similarity * 100)}%</span>
              <span style={{ color: 'var(--jarvis-ts)' }}>RFI {s.rfiNumber}</span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</span>
              {s.hasResponse && <span style={{ fontSize: 10, color: '#22c55e', border: '1px solid #22c55e', padding: '0 6px', borderRadius: 99 }}>answered</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
