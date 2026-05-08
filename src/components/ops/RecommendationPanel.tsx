/**
 * Denver Engineering — Recommendation Panel (v4.35.0)
 * ──────────────────────────────────────────────────────
 * Ava Phase 3 — Displays AI next-best-action recommendations.
 * Explainable outputs. Human approval required before execution.
 */
import React, { useEffect, useState } from 'react'

interface Recommendation {
  action_id:             string
  recommended_action:    string
  recommendation_reason: string
  impact_score:          number
  urgency_score:         number
  confidence_score:      number
  category:              string
}

interface RecommendationPanelProps {
  projectId?:  string
  maxItems?:   number
  onAccept?:   (rec: Recommendation) => void
  onDismiss?:  (rec: Recommendation) => void
}

const CATEGORY_COLORS: Record<string, { bg: string; text: string; icon: string }> = {
  escalation: { bg: '#fff7ed', text: '#ea580c', icon: '⬆' },
  workload:   { bg: '#f0fdf4', text: '#16a34a', icon: '👤' },
  dependency: { bg: '#eff6ff', text: '#2563eb', icon: '🔗' },
  cleanup:    { bg: '#faf5ff', text: '#7c3aed', icon: '🧹' },
  compliance: { bg: '#fef2f2', text: '#dc2626', icon: '⚖' },
  readiness:  { bg: '#f0fdf4', text: '#059669', icon: '📊' },
  sla:        { bg: '#fefce8', text: '#ca8a04', icon: '⏱' },
}

const ACTION_LABELS: Record<string, string> = {
  escalate:          'Escalate',
  reassign:          'Reassign',
  prioritize:        'Prioritize',
  review_duplicates: 'Review Duplicates',
  pause_sla:         'Pause SLA',
}

function ScoreBar({ label, score, color }: { label: string; score: number; color: string }) {
  return (
    <div style={{ marginBottom: 3 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#9ca3af', marginBottom: 1 }}>
        <span>{label}</span>
        <span style={{ color, fontWeight: 600 }}>{Math.round(score)}</span>
      </div>
      <div style={{ height: 3, background: '#f3f4f6', borderRadius: 2 }}>
        <div style={{ width: `${score}%`, height: '100%', background: color,
          borderRadius: 2, transition: 'width 0.4s ease' }} />
      </div>
    </div>
  )
}

function RecCard({ rec, onAccept, onDismiss }: {
  rec:        Recommendation
  onAccept?:  (r: Recommendation) => void
  onDismiss?: (r: Recommendation) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const catCfg = CATEGORY_COLORS[rec.category] ?? { bg: '#f9fafb', text: '#374151', icon: '•' }

  if (dismissed) return null

  const urgencyColor = rec.urgency_score >= 80 ? '#dc2626'
    : rec.urgency_score >= 60 ? '#f97316' : '#d97706'

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, marginBottom: 8,
      overflow: 'hidden', background: '#fff' }}>
      {/* Category tag */}
      <div style={{ background: catCfg.bg, padding: '4px 10px', display: 'flex',
        alignItems: 'center', gap: 6, borderBottom: '1px solid #e5e7eb' }}>
        <span style={{ fontSize: 12 }}>{catCfg.icon}</span>
        <span style={{ fontSize: 10, fontWeight: 600, color: catCfg.text, textTransform: 'uppercase',
          letterSpacing: '0.05em' }}>
          {rec.category}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 10, color: urgencyColor, fontWeight: 700 }}>
          Urgency {Math.round(rec.urgency_score)}
        </span>
      </div>

      {/* Body */}
      <div style={{ padding: '10px 12px' }}>
        {/* Recommended action */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
            background: `${urgencyColor}18`, color: urgencyColor }}>
            {ACTION_LABELS[rec.recommended_action] ?? rec.recommended_action}
          </span>
        </div>

        {/* Reason */}
        <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.5, marginBottom: 8 }}>
          {rec.recommendation_reason}
        </div>

        {/* Scores (expandable) */}
        <div
          onClick={() => setExpanded(e => !e)}
          style={{ fontSize: 11, color: '#9ca3af', cursor: 'pointer', marginBottom: expanded ? 8 : 0 }}>
          {expanded ? '▾' : '▸'} Score details
        </div>
        {expanded && (
          <div style={{ marginBottom: 8 }}>
            <ScoreBar label="Impact"     score={rec.impact_score}     color="#2563eb" />
            <ScoreBar label="Urgency"    score={rec.urgency_score}    color={urgencyColor} />
            <ScoreBar label="Confidence" score={rec.confidence_score} color="#10b981" />
          </div>
        )}

        {/* Actions — require explicit human confirmation */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => onAccept?.(rec)}
            style={{ flex: 1, padding: '5px 0', borderRadius: 5, fontSize: 12, fontWeight: 600,
              background: '#2563eb', color: '#fff', border: 'none', cursor: 'pointer' }}>
            Accept
          </button>
          <button
            onClick={() => { setDismissed(true); onDismiss?.(rec) }}
            style={{ padding: '5px 12px', borderRadius: 5, fontSize: 12,
              background: '#f9fafb', color: '#6b7280', border: '1px solid #e5e7eb', cursor: 'pointer' }}>
            Dismiss
          </button>
        </div>
      </div>
    </div>
  )
}

export function RecommendationPanel({
  projectId, maxItems = 5, onAccept, onDismiss,
}: RecommendationPanelProps) {
  const [recs, setRecs]       = useState<Recommendation[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (projectId) params.set('project_id', projectId)
    fetch(`/api/v1/ops/recommendations?${params}`)
      .then(r => r.json())
      .then(j => setRecs((j.data?.recommendations ?? []).slice(0, maxItems)))
      .catch(() => setRecs([]))
      .finally(() => setLoading(false))
  }, [projectId, maxItems])

  return (
    <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ padding: '10px 12px', borderBottom: '1px solid #e5e7eb', background: '#fff',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>💡 Recommendations</div>
        {!loading && recs.length > 0 && (
          <span style={{ fontSize: 10, color: '#6b7280' }}>{recs.length} suggestions</span>
        )}
      </div>
      <div style={{ padding: 10 }}>
        {loading ? (
          <div style={{ padding: 12, color: '#9ca3af', fontSize: 13 }}>Analyzing…</div>
        ) : recs.length === 0 ? (
          <div style={{ padding: 12, color: '#9ca3af', fontSize: 13, textAlign: 'center' }}>
            No recommendations at this time.
          </div>
        ) : (
          recs.map(rec => (
            <RecCard key={rec.action_id} rec={rec} onAccept={onAccept} onDismiss={onDismiss} />
          ))
        )}
      </div>
    </div>
  )
}
