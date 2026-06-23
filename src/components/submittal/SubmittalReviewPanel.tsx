/**
 * Denver Engineering — Submittal Review Assistant panel (v4.47.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * Renders in the submittal detail modal: readiness checks, precedent (similar
 * prior submittals + outcome), suggested reviewers, and deviation risk.
 *
 * Data: GET /api/v1/submittals/:id/review.
 */
import React, { useEffect, useState } from 'react'

interface ReviewCheck { label: string; status: 'ok' | 'warn' | 'missing'; detail: string }
interface SimilarSubmittal { id: string; number: string; title: string; status: string; similarity: number; wasReturned: boolean }
interface SuggestedReviewer { userId: string; reviewed: number }
interface SubmittalRisk { level: 'high' | 'medium' | 'low'; reasons: string[] }
interface ReviewResult {
  submittal: { id: string; number: string; title: string; discipline: string | null; specSection: string | null; status: string }
  checks: ReviewCheck[]
  similar: SimilarSubmittal[]
  suggestedReviewers: SuggestedReviewer[]
  risk: SubmittalRisk
}

const RISK_COLOR: Record<SubmittalRisk['level'], string> = { high: '#ef4444', medium: '#f59e0b', low: '#22c55e' }
const CHECK_ICON: Record<ReviewCheck['status'], string> = { ok: '✅', warn: '⚠️', missing: '⛔' }

export default function SubmittalReviewPanel({ submittalId }: { submittalId: string }) {
  const [data, setData] = useState<ReviewResult | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let alive = true
    setLoading(true)
    fetch(`/api/v1/submittals/${submittalId}/review`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(j => { if (alive) setData(j.data) })
      .catch(() => { if (alive) setData(null) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [submittalId])

  const box: React.CSSProperties = { background: 'var(--jarvis-card)', padding: 12, borderRadius: 6, marginBottom: 12 }
  if (loading && !data) return <div style={box}><div style={{ fontSize: 12, color: 'var(--jarvis-ts)' }}>🤖 Review assistant analysing…</div></div>
  if (!data) return null

  return (
    <div style={box}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--jarvis-tx)' }}>🤖 Review assistant</span>
        <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: '#0a0b0f', background: RISK_COLOR[data.risk.level], padding: '2px 8px', borderRadius: 99 }}>{data.risk.level} risk</span>
        <span style={{ fontSize: 11, color: 'var(--jarvis-ts)' }}>{data.risk.reasons.join(' · ')}</span>
      </div>

      {/* Readiness checks */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
        {data.checks.map(c => (
          <div key={c.label} style={{ display: 'flex', gap: 8, fontSize: 12, color: 'var(--jarvis-tx)' }}>
            <span aria-hidden>{CHECK_ICON[c.status]}</span>
            <span style={{ width: 130, color: 'var(--jarvis-ts)' }}>{c.label}</span>
            <span style={{ flex: 1 }}>{c.detail}</span>
          </div>
        ))}
      </div>

      {/* Suggested reviewers */}
      {data.suggestedReviewers.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--jarvis-tx)', marginBottom: 4 }}>Suggested reviewer <span style={{ fontWeight: 400, color: 'var(--jarvis-ts)' }}>(by {data.submittal.discipline ?? 'project'} history)</span></div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {data.suggestedReviewers.map(r => (
              <span key={r.userId} style={{ fontSize: 11, color: 'var(--jarvis-tx)', background: 'var(--jarvis-bg)', border: '1px solid var(--jarvis-bd)', padding: '2px 8px', borderRadius: 99 }}>
                {r.userId.slice(0, 8)} · reviewed {r.reviewed}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Precedent */}
      {data.similar.length > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--jarvis-tx)', marginBottom: 4 }}>Similar prior submittals</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {data.similar.map(s => (
              <div key={s.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: 'var(--jarvis-tx)' }}>
                <span style={{ width: 44, color: 'var(--jarvis-ts)', fontFamily: 'var(--jarvis-font-mono)' }}>{Math.round(s.similarity * 100)}%</span>
                <span style={{ color: 'var(--jarvis-ts)' }}>{s.number}</span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</span>
                {s.wasReturned && <span style={{ fontSize: 10, color: '#f59e0b', border: '1px solid #f59e0b', padding: '0 6px', borderRadius: 99 }}>was returned</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
