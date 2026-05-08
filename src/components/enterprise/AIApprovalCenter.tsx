/**
 * Denver Engineering — AI Approval Center (v4.40.0)
 * ────────────────────────────────────────────────────
 * Ava Phase 4 — Human-in-the-loop AI recommendation review.
 * Supervisors approve, reject, or preview each recommendation
 * before any action is taken. No autonomous execution without approval.
 */
import React, { useEffect, useState, useCallback } from 'react'

interface Recommendation {
  id:                 string
  action_id?:         string
  recommended_action: string
  category:           string
  confidence_score:   number
  impact_score:       number
  urgency_score:      number
  reason:             string
  data_signals:       string[]
  affected_entities:  { entity_type: string; entity_id: string; impact: string }[]
  approval_required:  boolean
  status:             string
  expires_at:         string
}

interface AIApprovalCenterProps {
  onApprove?: (id: string) => void
  onReject?:  (id: string) => void
}

const CATEGORY_COLORS: Record<string, string> = {
  sla:          '#dc2626',
  compliance:   '#7c3aed',
  critical_path:'#f97316',
  workload:     '#2563eb',
  quality:      '#10b981',
}

const ACTION_LABELS: Record<string, string> = {
  escalate:  'Escalate',
  reassign:  'Reassign',
  resolve:   'Resolve',
  pause:     'Pause SLA',
  prioritize:'Prioritize',
  close:     'Close',
}

function ScoreBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#6b7280', marginBottom: 2 }}>
        <span>{label}</span><span>{Math.round(value)}</span>
      </div>
      <div style={{ height: 4, background: '#f3f4f6', borderRadius: 2 }}>
        <div style={{ height: 4, width: `${value}%`, background: color, borderRadius: 2, transition: 'width 0.3s' }} />
      </div>
    </div>
  )
}

export function AIApprovalCenter({ onApprove, onReject }: AIApprovalCenterProps) {
  const [recs, setRecs]       = useState<Recommendation[]>([])
  const [loading, setLoading] = useState(true)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [expanded, setExpanded]   = useState<string | null>(null)
  const [acting, setActing]       = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    fetch('/api/v1/ai/recommendations?limit=20')
      .then(r => r.json())
      .then(j => setRecs(j.data ?? []))
      .catch(() => setRecs([]))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const handleApprove = async (id: string) => {
    setActing(id)
    try {
      await fetch(`/api/v1/ai/recommendations/${id}/approve`, { method: 'POST' })
      setRecs(prev => prev.map(r => r.id === id ? { ...r, status: 'approved' } : r))
      onApprove?.(id)
    } finally { setActing(null) }
  }

  const handleReject = async (id: string, reason?: string) => {
    setActing(id)
    try {
      await fetch(`/api/v1/ai/recommendations/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      })
      setDismissed(prev => new Set([...prev, id]))
      onReject?.(id)
    } finally { setActing(null) }
  }

  const visible = recs.filter(r => !dismissed.has(r.id) && r.status === 'pending')

  if (loading) return <div style={{ padding: 16, color: '#9ca3af', fontSize: 13 }}>Loading recommendations…</div>

  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>AI Approval Center</div>
          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>Review before execution</div>
        </div>
        {visible.length > 0 && (
          <span style={{ background: '#fef2f2', color: '#dc2626', fontSize: 11, padding: '2px 8px', borderRadius: 12, fontWeight: 600 }}>
            {visible.length} pending
          </span>
        )}
      </div>

      {visible.length === 0 ? (
        <div style={{ padding: 24, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>
          No pending recommendations.
        </div>
      ) : visible.map(rec => (
        <div key={rec.id} style={{ padding: '12px 14px', borderBottom: '1px solid #f3f4f6',
          opacity: acting === rec.id ? 0.6 : 1, transition: 'opacity 0.2s' }}>
          {/* Header row */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
            <span style={{
              fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 12,
              background: `${CATEGORY_COLORS[rec.category] ?? '#6b7280'}18`,
              color: CATEGORY_COLORS[rec.category] ?? '#6b7280',
              whiteSpace: 'nowrap',
            }}>
              {rec.category.replace('_', ' ')}
            </span>
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 12,
              background: '#f3f4f6', color: '#374151',
            }}>
              {ACTION_LABELS[rec.recommended_action] ?? rec.recommended_action}
            </span>
            <div style={{ flex: 1 }} />
            <div style={{ fontSize: 10, color: '#9ca3af' }}>
              Expires {new Date(rec.expires_at).toLocaleDateString()}
            </div>
          </div>

          {/* Reason */}
          <div style={{ fontSize: 12, color: '#374151', marginBottom: 8 }}>{rec.reason}</div>

          {/* Score bars */}
          <div style={{ marginBottom: 8 }}>
            <ScoreBar label="Confidence" value={rec.confidence_score} color="#2563eb" />
            <ScoreBar label="Impact"     value={rec.impact_score}     color="#f97316" />
            <ScoreBar label="Urgency"    value={rec.urgency_score}    color="#dc2626" />
          </div>

          {/* Expandable signals */}
          <button onClick={() => setExpanded(expanded === rec.id ? null : rec.id)}
            style={{ fontSize: 11, color: '#6b7280', background: 'none', border: 'none',
              cursor: 'pointer', padding: 0, marginBottom: 8 }}>
            {expanded === rec.id ? '▲ Hide signals' : '▼ Show data signals'}
          </button>

          {expanded === rec.id && (
            <div style={{ background: '#f9fafb', borderRadius: 6, padding: '6px 10px', marginBottom: 8 }}>
              {rec.data_signals.map((s, i) => (
                <div key={i} style={{ fontSize: 11, color: '#6b7280', marginBottom: 2 }}>• {s}</div>
              ))}
              {rec.affected_entities.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  <div style={{ fontSize: 10, color: '#9ca3af', marginBottom: 4 }}>Affected:</div>
                  {rec.affected_entities.map((e, i) => (
                    <div key={i} style={{ fontSize: 11, color: '#374151' }}>
                      {e.entity_type}: {e.entity_id.slice(0, 8)}… — {e.impact}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => handleApprove(rec.id)} disabled={!!acting}
              style={{ flex: 1, padding: '6px 0', borderRadius: 6, fontSize: 12, fontWeight: 600,
                background: '#2563eb', color: '#fff', border: 'none', cursor: 'pointer' }}>
              ✓ Approve
            </button>
            <button onClick={() => handleReject(rec.id)} disabled={!!acting}
              style={{ flex: 1, padding: '6px 0', borderRadius: 6, fontSize: 12, fontWeight: 600,
                background: '#f9fafb', color: '#dc2626', border: '1px solid #fecaca', cursor: 'pointer' }}>
              ✕ Reject
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
